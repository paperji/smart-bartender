'use strict';
/**
 * Google Gemini REST(generateContent) 클라이언트 — 외부 의존성 없음(Node 18+ 내장 fetch)
 *
 * - 엔드포인트: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * - 키: 헤더 x-goog-api-key = process.env.GEMINI_API_KEY.trim()  (URL 쿼리에 키를 넣지 않음)
 * - 모델: process.env.GEMINI_MODEL || DEFAULT_MODEL
 * - 요청 형식 (2026-11-06 Google AI Studio API 레퍼런스 generate-content 재확인):
 *     systemInstruction.parts[].text, contents[{role:'user', parts:[{text}]}],
 *     generationConfig = { responseMimeType:'application/json', responseJsonSchema:{JSON Schema},
 *                          thinkingConfig:{ thinkingLevel:'LOW' }, maxOutputTokens }
 *     · GenerationConfig 에는 responseJsonSchema 가 있고(responseSchema 는 OpenAPI 부분집합용 옛 필드), JSON 출력에는
 *       responseMimeType 을 함께 지정.
 *     · thinkingLevel 값: MINIMAL | LOW | MEDIUM | HIGH (3.6 Flash 기본 MEDIUM). Gemini 3 이상 전용 —
 *       이전 모델에 보내면 오류이므로 2.x 에는 보내지 않음.
 *     · temperature/topP/topK: 3.6 Flash 이상은 무시되고, 이후 세대에서는 400 이 될 예정이라 공식 문서가
 *       "요청에서 제거"를 권장 → Gemini 3 이상에는 보내지 않음(2.x 에만 전송).
 *   응답: candidates[0].content.parts[].text 를 이어 붙임(part.thought === true 인 생각 요약은 제외),
 *         promptFeedback.blockReason / finishReason(SAFETY·PROHIBITED_CONTENT·BLOCKLIST·SPII) 은 차단으로 처리.
 * - 안정성: 호출당 14초 타임아웃(AbortController), 재시도 포함 전체 20초 한도, 429/5xx/네트워크 오류 1회 재시도,
 *           응답 JSON 파싱·검증 실패 시 1회 재요청, 400(스키마/thinking 미지원 등) 시 호환 모드로 1회 재요청.
 *           결제 크레딧 소진(402·"prepayment credits are depleted")·키 오류·모델 없음·타임아웃은 재시도하지 않음.
 *           (일반 429 RESOURCE_EXHAUSTED 문구에도 "check your plan and billing details" 가 들어 있으므로
 *            'billing' 단어만으로는 BILLING 으로 보지 않음 → RATE_LIMIT 으로 1회 재시도)
 *           ⚠ 전체 한도(20초) + 네트워크·콜드스타트·fallback 생성 여유 < 앱이 서버 응답을 기다리는 시간
 *             (app/src/lib/ai/recommend.ts SERVER_TIMEOUT_MS = 50초, SPEC §3.1 시간 한도)를 지켜야 서버의 재시도 결과·
 *             fallback 이 앱에 도착함 (앱이 먼저 끊으면 오프라인 추천으로 넘어가 서버 작업이 버려짐).
 *             앱의 AI_TIMEOUT_MS(25초)는 앱이 Gemini 를 직접 부를 때(선택 기능)만 쓰는 값이라 이 관계와 무관.
 *           모두 실패하면 { ok:false, code } 를 돌려주고 호출측(api/index.js)이 규칙기반 추천으로 대체.
 * - 오류 코드(= 응답 warningCode, SPEC §3.2): NO_API_KEY, TIMEOUT, RATE_LIMIT, BILLING, AUTH, MODEL,
 *   BAD_REQUEST, BAD_RESPONSE, BLOCKED, NETWORK, UPSTREAM(5xx·기타)
 * - 오류 로그/응답에 키는 절대 포함하지 않음(redact).
 */

const { SYSTEM_INSTRUCTION, buildUserPrompt, buildRecipeSchema, buildExploreOnlySchema } = require('./prompt');

/**
 * 기본 모델 (2026-11-06 확인, Google AI Studio 공식 문서 Models / Deprecations 페이지):
 *  - gemini-2.5-flash : Deprecated(기존 사용자만 API 접근), 2026-12-01 부터 gemini-3.5-flash-lite 로 자동 라우팅
 *  - gemini-3.6-flash : Stable(정식) Flash, 무료 등급 제공, 종료 일정 없음  ← 기본값
 *  - gemini-3.8-flash : 최신(New) Flash — 원하면 GEMINI_MODEL=gemini-3.8-flash 로 교체
 */
const DEFAULT_MODEL = 'gemini-3.6-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** 조정 가능한 값(테스트에서 짧게 바꿔 씀) */
const settings = {
  timeoutMs: 14000, // 1회 호출 타임아웃
  // 재시도 포함 전체 한도. 앱(app/src/lib/ai/recommend.ts SERVER_TIMEOUT_MS = 50초)이 서버 응답을 기다리는 시간보다
  // 충분히 짧아야 함: totalBudgetMs(20초) + 네트워크·콜드스타트·fallback 여유 < 50초. (vercel.json maxDuration 60초보다도 작음)
  totalBudgetMs: 20000,
  minAttemptMs: 4000, // 남은 시간이 이보다 적으면 재시도하지 않음
  retryDelayMs: 700, // 429/5xx 재시도 전 대기
  maxRetryAfterMs: 3000, // 서버가 이보다 오래 기다리라고 하면 재시도 대신 바로 대체 추천
  temperature: 0.9, // Gemini 2.x 에만 전송 (3 이상은 공식 문서 권장대로 보내지 않음)
  maxOutputTokens: 8192, // 생각(thinking) 토큰 포함 상한. explore 카드까지 넉넉히
  thinkingLevel: 'LOW', // Gemini 3 이상에서만 전송. 빠른 응답 위주 (MINIMAL|LOW|MEDIUM|HIGH)
};

function getApiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function resolveModel() {
  const m = String(process.env.GEMINI_MODEL || '').trim().replace(/^models\//, '');
  return m && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(m) ? m : DEFAULT_MODEL;
}

/** 모델 이름의 주 버전 (gemini-3.6-flash → 3). 모르면 null */
function majorVersion(model) {
  const mm = /^gemini-(\d+)/.exec(String(model || ''));
  return mm ? Number(mm[1]) : null;
}

/** thinkingConfig.thinkingLevel 지원(Gemini 3 이상) */
function supportsThinkingLevel(model) {
  const v = majorVersion(model);
  return v != null && v >= 3;
}

/** temperature 를 보낼 모델(Gemini 2.x 이하). 3 이상·이름을 모르는 모델에는 보내지 않음 */
function sendsSampling(model) {
  const v = majorVersion(model);
  return v != null && v < 3;
}

/** 로그용: 키/키 형태 문자열 가리기 + 길이 제한 */
function redact(text, apiKey) {
  let s = String(text == null ? '' : text);
  if (apiKey) s = s.split(apiKey).join('***');
  return s.replace(/AIza[0-9A-Za-z_-]{8,}/g, 'AIza***').slice(0, 300);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postOnce({ model, apiKey, body, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    const retryAfter = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
    return { ok: !!res.ok, status: res.status, data, retryAfter };
  } catch (e) {
    const timeout = ctrl.signal.aborted || (e && e.name === 'AbortError');
    return { ok: false, status: 0, data: null, error: timeout ? 'TIMEOUT' : 'NETWORK', message: e && e.message };
  } finally {
    clearTimeout(timer);
  }
}

/** HTTP 결과 → 오류 코드 (SPEC §3.2 warningCode) */
function classify(r) {
  if (r.error === 'TIMEOUT') return 'TIMEOUT';
  if (r.error === 'NETWORK') return 'NETWORK';
  const detail = JSON.stringify((r.data && r.data.error) || {});
  // 선불(Prepay) 크레딧 0 → 402, 또는 "Your prepayment credits are depleted" (기다려도 풀리지 않음).
  // 'billing' 단어만으로는 판단하지 않음: 무료 등급의 일반 429 문구 "You exceeded your current quota, please check your
  // plan and billing details" 에도 들어 있어, 이것을 BILLING 으로 보면 재시도를 건너뛰고 '크레딧 소진' 으로 잘못 안내함.
  if (r.status === 402 || /prepay|prepayment|credits? (are |is )?depleted/i.test(detail)) return 'BILLING';
  if (r.status === 401 || r.status === 403 || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(detail)) return 'AUTH';
  if (r.status === 429) return 'RATE_LIMIT';
  if (r.status === 404) return 'MODEL';
  if (r.status === 400) return 'BAD_REQUEST';
  return 'UPSTREAM';
}

/** 429 응답의 Retry-After 헤더 또는 google.rpc.RetryInfo.retryDelay("37s") → ms */
function retryDelayOf(r) {
  if (r.retryAfter != null && String(r.retryAfter).trim() !== '') {
    const h = Number(r.retryAfter);
    if (Number.isFinite(h) && h >= 0) return h * 1000;
  }
  const details = r.data && r.data.error && Array.isArray(r.data.error.details) ? r.data.error.details : [];
  for (const d of details) {
    const m = d && typeof d.retryDelay === 'string' ? /^([\d.]+)s$/.exec(d.retryDelay) : null;
    if (m) return Number(m[1]) * 1000;
  }
  return null;
}

/** 응답에서 텍스트만 추출(thought 파트 제외) */
function extractText(data) {
  if (!data || typeof data !== 'object') return { text: '', blocked: false };
  if (data.promptFeedback && data.promptFeedback.blockReason) return { text: '', blocked: true };
  const c = Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = c && c.content && Array.isArray(c.content.parts) ? c.content.parts : [];
  const text = parts
    .filter((p) => p && typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  const blocked = !!c && /SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(String(c.finishReason || '')) && !text;
  return { text, blocked, finishReason: c && c.finishReason };
}

/** JSON 파싱(코드블록/앞뒤 잡문 허용) */
function parseJsonLoose(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const tries = [t];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) tries.push(fence[1].trim());
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const s of tries) {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch (_) {
      /* 다음 후보 */
    }
  }
  return null;
}

/**
 * 공통 재시도 엔진. makeBody(compat) 로 요청 본문 생성, validate(data) → {ok, value} | {ok:false, code}
 * 최대 4회 호출: 최초 1 + (429/5xx/네트워크 1) + (내용 불량 1) + (400 호환 모드 1), 전체 시간 한도 내에서만.
 */
async function runWithRetry(makeBody, { apiKey, model, validate, allowCompat = true, log = console.warn }) {
  const deadline = Date.now() + settings.totalBudgetMs;
  let compat = false;
  let transientUsed = false;
  let contentUsed = false;
  let attempts = 0;
  let lastCode = 'UPSTREAM';
  while (attempts < 4) {
    const remaining = deadline - Date.now();
    if (attempts > 0 && remaining < settings.minAttemptMs) break;
    attempts += 1;
    const r = await postOnce({ model, apiKey, body: makeBody(compat), timeoutMs: Math.max(1, Math.min(settings.timeoutMs, remaining)) });
    if (r.ok) {
      const v = validate(r.data);
      if (v.ok) return { ok: true, value: v.value, attempts };
      lastCode = v.code || 'BAD_RESPONSE';
      log(`[gemini] 시도 ${attempts}: 응답 내용 불량 (${lastCode})`);
      if (!contentUsed) {
        contentUsed = true;
        continue;
      }
      break;
    }
    const code = classify(r);
    lastCode = code;
    const msg = (r.data && r.data.error && r.data.error.message) || r.message || '';
    log(`[gemini] 시도 ${attempts}: ${code} (HTTP ${r.status}) ${redact(msg, apiKey)}`);
    if (code === 'TIMEOUT' || code === 'AUTH' || code === 'MODEL' || code === 'BILLING') break;
    if (code === 'BAD_REQUEST') {
      if (allowCompat && !compat) {
        compat = true; // responseJsonSchema/thinkingConfig 를 빼고 다시 요청
        continue;
      }
      break;
    }
    if (!transientUsed) {
      // RATE_LIMIT, UPSTREAM(5xx), NETWORK → 1회 재시도
      transientUsed = true;
      let wait = settings.retryDelayMs;
      if (code === 'RATE_LIMIT') {
        const ra = retryDelayOf(r);
        if (ra != null && ra > settings.maxRetryAfterMs) break; // 오래 기다려야 하면 바로 대체 추천
        if (ra != null) wait = Math.max(wait, ra);
      }
      wait = Math.min(wait, Math.max(0, deadline - Date.now() - settings.minAttemptMs));
      if (wait > 0) await sleep(wait);
      continue;
    }
    break;
  }
  return { ok: false, code: lastCode, attempts };
}

/** 공통 generationConfig (sampling 은 2.x 에만) */
function baseGenerationConfig(model) {
  const g = { maxOutputTokens: settings.maxOutputTokens };
  if (sendsSampling(model) && settings.temperature != null) g.temperature = settings.temperature;
  return g;
}

/**
 * v2 레시피(+ explore) 생성.
 * finalize(parsedJson) → { ok:true, recipe, explore, adjustments } | { ok:false }
 *   (api/index.js 가 lib/recipe.finalizeRecipe + lib/explore.normalizeExplore 로 만든 함수.
 *    parsedJson 은 Gemini 가 준 JSON 객체 그대로 — {..recipe 필드.., explore:[...]})
 * exploreOnly: 탐색 모드인데 지금 만들 수 있는 재료가 없을 때 → explore 만 받는 스키마/프롬프트
 * 반환: { ok:true, model, recipe, explore, adjustments, attempts } | { ok:false, code, model, attempts }
 */
async function generateRecipe(req, finalize, { now = new Date(), log, exploreOnly = false } = {}) {
  const apiKey = getApiKey();
  const model = resolveModel();
  if (!apiKey) return { ok: false, code: 'NO_API_KEY', model, attempts: 0 };
  const schema = exploreOnly ? buildExploreOnlySchema(req) : buildRecipeSchema(req);
  const makeBody = (compat) => {
    const generationConfig = { ...baseGenerationConfig(model), responseMimeType: 'application/json' };
    if (!compat) {
      generationConfig.responseJsonSchema = schema;
      if (settings.thinkingLevel && supportsThinkingLevel(model)) generationConfig.thinkingConfig = { thinkingLevel: settings.thinkingLevel };
    }
    return {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(req, { now, includeFormat: compat, exploreOnly }) }] }],
      generationConfig,
    };
  };
  const validate = (data) => {
    const { text, blocked } = extractText(data);
    if (blocked) return { ok: false, code: 'BLOCKED' };
    const raw = parseJsonLoose(text);
    if (!raw) return { ok: false, code: 'BAD_RESPONSE' };
    const fin = finalize(raw);
    return fin.ok ? { ok: true, value: fin } : { ok: false, code: 'BAD_RESPONSE' };
  };
  const r = await runWithRetry(makeBody, { apiKey, model, validate, ...(log ? { log } : {}) });
  if (r.ok) {
    const v = r.value;
    return { ok: true, model, recipe: v.recipe, explore: v.explore || [], adjustments: v.adjustments || [], attempts: r.attempts };
  }
  return { ok: false, code: r.code, model, attempts: r.attempts };
}

/** (하위호환) 자유 프롬프트 → 텍스트. 반환: { ok:true, text, model } | { ok:false, code, model } */
async function generateText(prompt, { log } = {}) {
  const apiKey = getApiKey();
  const model = resolveModel();
  if (!apiKey) return { ok: false, code: 'NO_API_KEY', model, attempts: 0 };
  const makeBody = () => ({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: baseGenerationConfig(model),
  });
  const validate = (data) => {
    const { text, blocked } = extractText(data);
    if (blocked) return { ok: false, code: 'BLOCKED' };
    return text.trim() ? { ok: true, value: text } : { ok: false, code: 'BAD_RESPONSE' };
  };
  const r = await runWithRetry(makeBody, { apiKey, model, validate, allowCompat: false, ...(log ? { log } : {}) });
  return r.ok ? { ok: true, text: r.value, model, attempts: r.attempts } : { ok: false, code: r.code, model, attempts: r.attempts };
}

module.exports = {
  DEFAULT_MODEL,
  API_BASE,
  settings,
  getApiKey,
  resolveModel,
  supportsThinkingLevel,
  sendsSampling,
  generateRecipe,
  generateText,
  // 테스트/디버그용
  extractText,
  parseJsonLoose,
  classify,
  redact,
};
