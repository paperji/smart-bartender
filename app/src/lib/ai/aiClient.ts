/**
 * AI 회사별 레시피 요청 (v3.1 — 사용자 본인 키, BYOK) — callAi(회사, 키, 요청, 모델)
 *  - Gemini: generateContent + responseJsonSchema (v3.0 의 callGemini 그대로)
 *  - OpenAI 호환(ChatGPT·Grok·DeepSeek·Mistral·Groq·OpenRouter): POST {apiBase}/chat/completions
 *      ChatGPT·Grok 은 json_schema(엄격하지 않게), 나머지는 json_object + 프롬프트에 JSON 모양(jsonShapeHint)
 *  - Claude: POST /v1/messages + output_config.format(json_schema — 모든 객체에 additionalProperties:false, 숫자 범위 등은 뺌)
 *  - 회사마다 받는 옵션(생각 끄기·토큰 수 이름 등)이 자주 바뀌어, 400·422 로 거절되면 옵션을 줄여 다시 요청
 *    (1차: 회사별 옵션 + JSON 형식 → 2차: JSON 형식만(json_object) → 3차: 기본 요청). 시간 제한은 세 번 합쳐서 하나
 *  - 오류는 AiErrorCode 로 나눔(classifyAiError). 회사 원문은 키 값을 가리고(redactKey) 80자로 잘라 안내에 덧붙임
 * 키는 그 회사 주소로만 보내고, 화면·로그에 남기지 않습니다.
 */
import { AiError, AI_ERROR_TEXT, AI_TIMEOUT_MS, classifyGeminiError, extractJson, fetchJson, splitGeminiJson, type AiErrorCode } from './aiCommon';
import { hasInvalidKeyChars, redactKey } from './apiKey';
import { buildResponseSchema, buildUserPrompt, DEFAULT_GEMINI_MODEL, jsonShapeHint, SYSTEM_PROMPT } from './prompt';
import { guessProvider, providerLabel, providerOf, withJosa, type AiProvider, type AiProviderId } from './providers';
import type { RecipeRequest } from '../types';

export type AiRaw = { recipe: unknown | null; explore: unknown };

/** 응답 토큰 상한 (생각 토큰을 함께 세는 회사가 있어 넉넉히) */
export const MAX_OUTPUT_TOKENS = 4096;

// ───────────────────────── Gemini ─────────────────────────

/** 모델 이름의 주 버전 (gemini-3.6-flash → 3). 모르면 null — 백엔드 majorVersion 과 같음 */
function geminiMajor(model: string): number | null {
  const mm = /^gemini-(\d+)/.exec(String(model || ''));
  return mm ? Number(mm[1]) : null;
}

/**
 * Gemini REST generateContent 직접 호출 (JSON 모드 + responseJsonSchema).
 * temperature 는 Gemini 2.x 이하에만 보냄 (3 이상은 공식 문서 권장대로 보내지 않음 — 백엔드와 같음).
 * 실패하면 AiError(code = classifyGeminiError 결과)
 */
export async function callGemini(apiKey: string, req: RecipeRequest, model = DEFAULT_GEMINI_MODEL, timeoutMs = AI_TIMEOUT_MS): Promise<AiRaw> {
  const m0 = model || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m0)}:generateContent`;
  const major = geminiMajor(m0);
  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
    responseJsonSchema: buildResponseSchema(req),
  };
  if (major != null && major < 3) generationConfig.temperature = 0.9;
  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(req) }] }],
    generationConfig,
  };
  const key = (apiKey ?? '').trim();
  // 보이지 않는 문자·한글 등이 든 키는 헤더로 보낼 수 없어 fetch 가 요청 전에 TypeError → 예전엔 NETWORK 로 오인. 보내지 않고 키 오류로
  if (hasInvalidKeyChars(key)) {
    throw new AiError(`Gemini 오류(AUTH): ${AI_ERROR_TEXT.AUTH} — 키에 쓸 수 없는 문자(보이지 않는 문자·한글 등)가 있어요`, 'AUTH');
  }
  let status: number;
  let body: any;
  try {
    ({ status, body } = await fetchJson(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload) },
      timeoutMs,
    ));
  } catch (e: any) {
    const code = classifyGeminiError({ status: 0, error: e instanceof AiError && e.code === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK' });
    throw new AiError(`Gemini 오류(${code}): ${AI_ERROR_TEXT[code]}`, code);
  }
  if (status >= 400 || body?.error) {
    const code = classifyGeminiError({ status, data: body });
    // Google 원문은 화면(레시피 안내의 괄호)·임시 저장(fallbackReason)에 쓰이므로 키 값을 가린 뒤 자름
    // (정지된 키: "Permission denied: Consumer 'api_key:<키>' has been suspended." — 80자 안에 키 전체가 들어감)
    const m = redactKey(String(body?.error?.message ?? `HTTP ${status}`), key).slice(0, 80);
    throw new AiError(`Gemini 오류(${code}): ${AI_ERROR_TEXT[code]} — ${m}`, code);
  }
  const text: string | undefined = body?.candidates?.[0]?.content?.parts
    ?.filter((p: any) => p?.thought !== true)
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .join('');
  if (!text) {
    const reason = body?.promptFeedback?.blockReason || body?.candidates?.[0]?.finishReason || '빈 응답';
    throw new AiError(`Gemini 가 레시피를 만들지 못했어요 (${reason})`);
  }
  const split = splitGeminiJson(extractJson(text));
  if (req.mode === 'normal' && !split.recipe) throw new AiError('Gemini 응답에 레시피가 없어요');
  return split;
}

// ───────────────────────── 오류 분류 (Gemini 밖) ─────────────────────────

/** 회사 오류 본문에서 사람이 읽을 문구 (OpenAI·Groq·DeepSeek {error:{message}}, xAI {code, error}, Mistral {detail}·{message}, Anthropic {error:{message}}) */
export function errorMessageOf(body: any, status: number): string {
  if (!body || typeof body !== 'object') return `HTTP ${status}`;
  const e = body.error;
  if (e && typeof e === 'object' && typeof e.message === 'string') return e.message;
  if (typeof e === 'string') return e;
  if (typeof body.message === 'string') return body.message;
  if (typeof body.detail === 'string') return body.detail;
  if (typeof body.raw === 'string' && body.raw.trim()) return body.raw.trim();
  return `HTTP ${status}`;
}

const BILLING_RE = /insufficient[_ ]quota|insufficient[_ ]balance|insufficient[_ ]credits|credit[_ ]balance|credit_balance_exhausted|spend(ing)?[_ ]limit|out of credits|doesn't have any credits|used all available credits|purchase credits|billing_error|payment required/i;
const AUTH_TEXT_RE = /invalid[_ ]api[_ ]key|incorrect api key|api key (is )?(invalid|not valid)|invalid x-api-key|authentication[_ ]error|unauthenticated|no credentials/i;
const MODEL_RE = /model[_ ]not[_ ]found|unknown[_ ]model|invalid[_ ]model|not a valid model|model not exist|does not exist|no endpoints found|not_found_error/i;

/**
 * 오류 → 코드 (회사별 차이를 흡수). Gemini 는 classifyGeminiError(백엔드와 같은 규칙) 그대로
 *  - BILLING: 402 · OpenAI 429 insufficient_quota/credit_balance_exhausted · Anthropic 400 "credit balance is too low" ·
 *    xAI 403 "credits" · Mistral 402
 *  - AUTH: 401·403(크레딧 문구가 아니면) · 400 인데 키 오류 문구(xAI 는 틀린 키를 400 으로 줌)
 *  - RATE_LIMIT 429 · MODEL 404 또는 모델 없음 문구 · BAD_REQUEST 400·422 · 그 밖 UPSTREAM(5xx·529 등)
 */
export function classifyAiError(provider: AiProviderId, r: { status: number; data?: any; error?: 'TIMEOUT' | 'NETWORK' }): AiErrorCode {
  if (providerOf(provider).kind === 'gemini') return classifyGeminiError(r);
  if (r.error === 'TIMEOUT') return 'TIMEOUT';
  if (r.error === 'NETWORK') return 'NETWORK';
  const detail = typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? {});
  if (r.status === 402 || BILLING_RE.test(detail)) return 'BILLING';
  if (r.status === 401 || r.status === 403) return 'AUTH';
  if (r.status === 429) return 'RATE_LIMIT';
  if ((r.status === 400 || r.status === 422) && AUTH_TEXT_RE.test(detail)) return 'AUTH';
  if (r.status === 404 || MODEL_RE.test(detail)) return 'MODEL';
  if (r.status === 400 || r.status === 422) return 'BAD_REQUEST';
  if (r.status >= 200 && r.status < 300) return 'UPSTREAM';
  return 'UPSTREAM';
}

// ───────────────────────── 스키마 바꾸기 ─────────────────────────

const ANTHROPIC_DROP = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'pattern']);

/**
 * Claude structured outputs 용 스키마: 모든 객체에 additionalProperties:false, 지원하지 않는 숫자·길이·개수 제한은 뺌
 * (값 범위는 앱의 normalizeRecipe 가 어차피 다시 맞춤)
 */
export function anthropicSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(anthropicSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (ANTHROPIC_DROP.has(k)) continue;
    if (k === 'minItems' && typeof v === 'number' && v > 1) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, anthropicSchema(pv)]));
      continue;
    }
    out[k] = k === 'enum' ? v : anthropicSchema(v);
  }
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}

// ───────────────────────── OpenAI 호환 ─────────────────────────

/** JSON 스키마로 받는 회사 (나머지는 json_object) */
const SCHEMA_PROVIDERS = new Set<AiProviderId>(['openai', 'xai']);
/** max_tokens 를 쓰는 회사 (나머지는 max_completion_tokens) */
const MAX_TOKENS_PROVIDERS = new Set<AiProviderId>(['deepseek', 'mistral']);
/** 1차 요청에만 넣는 회사별 옵션 — 생각(추론)을 끄거나 줄여 빠르고 싸게 */
const EXTRA_BODY: Partial<Record<AiProviderId, Record<string, unknown>>> = {
  openai: { reasoning_effort: 'none' },
  deepseek: { thinking: { type: 'disabled' } },
  mistral: { reasoning_effort: 'none' },
  groq: { reasoning_effort: 'low', include_reasoning: false },
  openrouter: { provider: { require_parameters: true }, plugins: [{ id: 'response-healing' }] },
};

/** chat/completions 요청 본문 — level 0: 회사 옵션 + 선호 JSON 형식 / 1: json_object 만 / 2: 기본 */
export function openAiBody(p: AiProvider, model: string, req: RecipeRequest, level: 0 | 1 | 2): Record<string, unknown> {
  const useSchema = level === 0 && SCHEMA_PROVIDERS.has(p.id);
  const system = useSchema ? SYSTEM_PROMPT : `${SYSTEM_PROMPT}\n\n${jsonShapeHint(req)}`;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: buildUserPrompt(req) },
    ],
    [MAX_TOKENS_PROVIDERS.has(p.id) ? 'max_tokens' : 'max_completion_tokens']: MAX_OUTPUT_TOKENS,
  };
  if (level === 0) Object.assign(body, EXTRA_BODY[p.id] ?? {});
  if (level <= 1) {
    body.response_format = useSchema
      ? { type: 'json_schema', json_schema: { name: 'cocktail_recipe', strict: false, schema: buildResponseSchema(req) } }
      : { type: 'json_object' };
  }
  return body;
}

/** chat/completions 응답 → 글 (Mistral 생각 모드는 content 가 조각 배열) */
export function openAiText(body: any): { text: string; finish?: string; refusal?: string } {
  const choice = body?.choices?.[0];
  const msg = choice?.message;
  const c = msg?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => (x && x.type === 'text' && typeof x.text === 'string' ? x.text : '')).join('') : '';
  return { text, finish: choice?.finish_reason, refusal: typeof msg?.refusal === 'string' && msg.refusal ? msg.refusal : undefined };
}

// ───────────────────────── Anthropic ─────────────────────────

/** /v1/messages 요청 본문 — level 0: 노력(effort) 낮게 + JSON 스키마 / 1: JSON 스키마만 / 2: 기본(프롬프트에 JSON 모양) */
export function anthropicBody(model: string, req: RecipeRequest, level: 0 | 1 | 2): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: level === 2 ? `${SYSTEM_PROMPT}\n\n${jsonShapeHint(req)}` : SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(req) }],
  };
  if (level <= 1) {
    const format = { type: 'json_schema', schema: anthropicSchema(buildResponseSchema(req)) };
    body.output_config = level === 0 ? { effort: 'low', format } : { format };
  }
  return body;
}

export function anthropicHeaders(key: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    // 브라우저(앱)에서 바로 부르려면 필요 — 키는 사용자 본인 것
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/** /v1/messages 응답 → 글 (생각 블록은 건너뜀) */
export function anthropicText(body: any): { text: string; finish?: string } {
  const blocks: any[] = Array.isArray(body?.content) ? body.content : [];
  return { text: blocks.map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join(''), finish: body?.stop_reason };
}

// ───────────────────────── 요청 (모든 회사) ─────────────────────────

/**
 * 붙여 넣은 키가 다른 회사 키 모양이면 보내지 않고 AUTH (키가 엉뚱한 회사로 가지 않게 — v3.1 검토 반영)
 * 회사마다 겹치지 않는 엄격한 모양만 보므로(sk-… 만 있는 키는 모름) 맞는 키를 막지 않음
 */
export function keyOwnerProblem(providerId: AiProviderId, key: string): string | null {
  const owner = guessProvider(key);
  if (!owner || owner === providerId) return null;
  const p = providerOf(providerId);
  return `저장된 키가 ${providerLabel(owner)} 키 모양이에요. 설정에서 AI 를 ${withJosa(owner, '으로/로')} 바꾸거나 ${p.label} 키를 다시 넣어 주세요`;
}

/** 응답이 길이 제한으로 끊겼는지 (같은 상한으로 다시 보내도 또 끊기므로 다시 보내지 않음) */
const isTruncated = (finish: string | undefined) => finish === 'length' || finish === 'max_tokens';

/**
 * 고른 회사로 레시피 요청. 실패하면 AiError(code = AiErrorCode)
 *  - 400·422(옵션 거절)면 옵션을 줄여 다시: 생각(추론) 정도 값이 거절되면 같은 단계에서 'low' 로 → 그다음 json_object 만 → 기본 요청
 *  - OpenRouter 는 옵션을 모두 지원하는 곳이 없으면 404 "No endpoints found…" → 옵션을 줄여 다시
 *  - 빈 글·JSON 해석 실패는 같은 요청으로 한 번만 더, 길이 제한으로 끊긴 응답은 다시 보내지 않음(비용·시간 낭비)
 *  - timeoutMs 는 다시 보내는 것까지 합친 전체 시간, 많아야 3번
 */
export async function callAi(providerId: AiProviderId, apiKey: string, req: RecipeRequest, model?: string, timeoutMs = AI_TIMEOUT_MS): Promise<AiRaw> {
  const p = providerOf(providerId);
  const label = p.label;
  const key = (apiKey ?? '').trim();
  const owner = keyOwnerProblem(p.id, key);
  if (owner) throw new AiError(`${label} 오류(AUTH): ${AI_ERROR_TEXT.AUTH} — ${owner}`, 'AUTH');
  if (p.kind === 'gemini') return callGemini(key, req, model || p.defaultModel, timeoutMs);
  const m0 = (model || p.defaultModel).trim();
  if (hasInvalidKeyChars(key)) {
    throw new AiError(`${label} 오류(AUTH): ${AI_ERROR_TEXT.AUTH} — 키에 쓸 수 없는 문자(보이지 않는 문자·한글 등)가 있어요`, 'AUTH');
  }
  const deadline = Date.now() + timeoutMs;
  let last: AiError | null = null;
  let level: 0 | 1 | 2 = 0;
  let effort: string | undefined;
  let repeated = false;
  let maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const left = deadline - Date.now();
    if (attempt > 0 && left < 1500) break;
    const url = p.kind === 'anthropic' ? `${p.apiBase}/messages` : `${p.apiBase}/chat/completions`;
    const headers = p.kind === 'anthropic' ? anthropicHeaders(key) : { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    const body = p.kind === 'anthropic' ? anthropicBody(m0, req, level) : openAiBody(p, m0, req, level);
    if (effort && 'reasoning_effort' in body) body.reasoning_effort = effort;
    let status: number;
    let res: any;
    try {
      ({ status, body: res } = await fetchJson(url, { method: 'POST', headers, body: JSON.stringify(body) }, left));
    } catch (e: any) {
      const code = classifyAiError(p.id, { status: 0, error: e instanceof AiError && e.code === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK' });
      throw new AiError(`${label} 오류(${code}): ${AI_ERROR_TEXT[code]}`, code);
    }
    // OpenRouter 는 200 인데 error 만 담아 줄 때가 있음
    if (status >= 400 || (res && typeof res === 'object' && res.error && !res.choices && !res.content)) {
      // 200 인데 오류만 담긴 본문은 그 안의 코드(OpenRouter error.code)를 HTTP 상태처럼 봄
      const embedded = Number(res?.error?.code);
      const st = status < 400 && Number.isInteger(embedded) && embedded >= 400 ? embedded : status;
      const code = classifyAiError(p.id, { status: st, data: res });
      const msg = errorMessageOf(res, st);
      last = new AiError(`${label} 오류(${code}): ${AI_ERROR_TEXT[code]} — ${redactKey(msg, key).slice(0, 80)}`, code);
      // 생각(추론) 정도 '값'('none')을 받지 않는 모델 → 같은 단계에서 'low' 로 한 번 (옵션을 통째로 빼면 기본값 'medium' 이라 느리고 비쌈).
      // 옵션 자체를 모르는 모델('Unsupported parameter')이면 바로 다음 단계로. 이 한 번은 3번 한도에 세지 않음(기본 요청까지 갈 수 있게)
      if (
        code === 'BAD_REQUEST' &&
        !effort &&
        typeof body.reasoning_effort === 'string' &&
        body.reasoning_effort !== 'low' &&
        /reasoning/i.test(msg) &&
        /does not support|unsupported value|supported values|not supported with|invalid value/i.test(msg) &&
        !/unsupported parameter|unknown parameter|unrecognized/i.test(msg)
      ) {
        effort = 'low';
        maxAttempts++;
        continue;
      }
      const noEndpoints = p.id === 'openrouter' && /no endpoints found/i.test(msg);
      if ((code === 'BAD_REQUEST' || noEndpoints) && level < 2) {
        level = (level + 1) as 1 | 2;
        continue;
      }
      throw last;
    }
    const { text, finish, refusal } = p.kind === 'anthropic' ? { ...anthropicText(res), refusal: undefined } : openAiText(res);
    if (refusal || finish === 'refusal') throw new AiError(`${label}에서 레시피를 만들어 주지 않았어요 (${(refusal ?? '거절').slice(0, 60)})`);
    if (isTruncated(finish) && !text.trim()) throw new AiError(`${label} 응답이 너무 길어 중간에 끊겼어요`);
    let split: AiRaw | null = null;
    if (text.trim()) {
      try {
        split = splitGeminiJson(extractJson(text));
      } catch {
        if (isTruncated(finish)) throw new AiError(`${label} 응답이 너무 길어 중간에 끊겼어요`);
        last = new AiError('AI 응답을 해석하지 못했어요');
      }
    } else {
      last = new AiError(`${label}에서 레시피를 만들지 못했어요 (${finish || '빈 응답'})`);
    }
    if (split && req.mode === 'normal' && !split.recipe) {
      last = new AiError(`${label} 응답에 레시피가 없어요`);
      split = null;
    }
    if (split) return split;
    // 빈 글(DeepSeek 은 JSON 이 깨지면 빈 글을 줌)·해석 실패는 같은 요청으로 한 번만 더
    if (repeated) break;
    repeated = true;
  }
  throw last ?? new AiError(`${label} 오류(TIMEOUT): ${AI_ERROR_TEXT.TIMEOUT}`, 'TIMEOUT');
}
