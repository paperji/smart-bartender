'use strict';
/**
 * AI 스마트 바텐더 v2.1 — AI 레시피 백엔드 (Vercel 서버리스, CommonJS, 외부 의존성 없음)
 *
 *   GET     /api  → 상태 확인 { ok, service, version, model, keyConfigured }
 *   OPTIONS /api  → CORS 사전 요청(204)
 *   POST    /api  → (version:2) SPEC §3 레시피 생성 (mode: normal | explore — SPEC §5.4)
 *                   (version 없음 + prompt) 기존 텍스트 방식 {result}
 *
 * 설계 원칙: v2 레시피 요청은 AI 가 실패해도 규칙기반 추천(source:'fallback')으로 항상 200 응답
 *            → 시연이 끊기지 않음. 키는 어떤 응답/로그에도 노출하지 않음.
 * 응답(200): { ok, source, model, mode, recipe | null, explore:[...], adjustments, (warning, warningCode), (notice) }
 *   - normal: recipe 필수(없으면 422), explore 0~1개
 *   - explore: explore 1~3개. 지금 장착 재료로 만들 수 없으면 recipe:null + notice (빈 기기에서도 동작)
 *   - user.adultVerified 가 true 가 아니면 AI·fallback explore 모두 술 장착 항목을 버림(SPEC §5.4).
 *     그 때문에 explore 가 0개가 되면 규칙기반 후보(술 제외)로 채움
 *   - user.adultVerified 가 true 가 아니면 레시피 suggestions 의 술 장착·대체 제안도 지움(SPEC §3.2, AI·fallback 모두)
 *   - NO_MIXER(섞을 무알콜 재료가 없음)로 explore 가 recipe:null 이면 무알콜 재료를 새로 더하는 카드만 남김
 *     (SPEC §3.3-8, AI·fallback 모두). 0개가 되면 AI 재호출 없이 규칙기반 후보(같은 필터)로 채움
 *     (도수를 낮출 무알콜 줄이 없어 normalizeExplore 단계에서 버린 술만 더하는 카드도 같이 셈)
 *   - explore 카드도 성향(알레르기·싫어하는 재료)으로 뺀 재료를 쓰지 않음 (SPEC §3.3-1, 규칙기반 후보와 같은 기준)
 */

const {
  validateRecipeRequest, finalizeRecipe, usableIngredients, lacksMixer, noMixerMessage, STRENGTH_ABV, STRENGTH_KO,
} = require('../lib/recipe');
const { buildFallbackRecipe, buildFallbackExplore, preferenceExcludedPumps, excludedByPreference } = require('../lib/fallback');
const { normalizeExplore, mergeExplore, filterNoMixerExplore, EXPLORE_MAX } = require('../lib/explore');
const gemini = require('../lib/gemini');

const SERVICE = 'smart-bartender-ai';
const VERSION = '2.1.0';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PROMPT_CHARS = 8000;

/** 규칙기반으로 대체했을 때 앱에 보여줄 안내 (warningCode → 문구, SPEC §3.2) */
const FALLBACK_WARNINGS = {
  NO_API_KEY: 'AI 키가 설정되지 않아 기본 추천 규칙으로 레시피를 만들었어요. (관리자: Vercel 환경변수 GEMINI_API_KEY 확인)',
  TIMEOUT: 'AI 응답이 늦어 기본 추천 규칙으로 레시피를 만들었어요.',
  RATE_LIMIT: 'AI 사용량이 많아 기본 추천 규칙으로 레시피를 만들었어요. 잠시 후 다시 시도해 보세요.',
  BILLING: 'AI 사용 크레딧이 없어 기본 추천 규칙으로 레시피를 만들었어요. (관리자: Google AI Studio 결제/크레딧 확인)',
  AUTH: 'AI 키가 올바르지 않아 기본 추천 규칙으로 레시피를 만들었어요. (관리자: GEMINI_API_KEY 확인)',
  MODEL: 'AI 모델을 찾을 수 없어 기본 추천 규칙으로 레시피를 만들었어요. (관리자: GEMINI_MODEL 확인)',
  BAD_REQUEST: 'AI 요청이 거절되어 기본 추천 규칙으로 레시피를 만들었어요.',
  BAD_RESPONSE: 'AI 응답을 해석하지 못해 기본 추천 규칙으로 레시피를 만들었어요.',
  BLOCKED: 'AI 가 이 요청에 답하지 않아 기본 추천 규칙으로 레시피를 만들었어요.',
  NETWORK: 'AI 서버에 연결하지 못해 기본 추천 규칙으로 레시피를 만들었어요.',
  UPSTREAM: 'AI 서버 오류로 기본 추천 규칙으로 레시피를 만들었어요.',
};

/** 하위호환(prompt) 요청 실패 시 상태코드·문구 */
const LEGACY_ERRORS = {
  NO_API_KEY: [503, '서버에 AI 키(GEMINI_API_KEY)가 설정되지 않았습니다.'],
  TIMEOUT: [504, 'AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.'],
  RATE_LIMIT: [429, 'AI 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.'],
  BILLING: [502, 'AI 사용 크레딧이 소진되었습니다. (관리자: Google AI Studio 결제/크레딧 확인)'],
  AUTH: [502, 'AI 키가 올바르지 않거나 권한이 없습니다.'],
  MODEL: [502, 'AI 모델을 찾을 수 없습니다. (GEMINI_MODEL 확인)'],
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

/** 본문 스트림 읽기(Vercel 이 이미 파싱했다면 사용 안 함). 5초 안에 끝나지 않으면 포기. */
function readStream(req, limit) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(v);
      }
    };
    const timer = setTimeout(() => finish({ text: Buffer.concat(chunks).toString('utf8') }), 5000);
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) finish({ tooLarge: true });
      else chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
    });
    req.on('end', () => finish({ text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => finish({ text: '' }));
  });
}

async function readJsonBody(req) {
  let b;
  try {
    b = req.body; // Vercel: 잘못된 JSON 이면 getter 가 예외를 던짐
  } catch (_) {
    return { ok: false, status: 400, error: '요청 본문이 올바른 JSON 이 아닙니다.' };
  }
  if (b === undefined && typeof req.on === 'function' && !req.readableEnded && !req.complete) {
    const s = await readStream(req, MAX_BODY_BYTES);
    if (s.tooLarge) return { ok: false, status: 413, error: '요청 본문이 너무 큽니다.' };
    b = s.text;
  }
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') {
    if (b.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: '요청 본문이 너무 큽니다.' };
    if (!b.trim()) b = undefined;
    else {
      try {
        b = JSON.parse(b);
      } catch (_) {
        return { ok: false, status: 400, error: '요청 본문이 올바른 JSON 이 아닙니다.' };
      }
    }
  }
  if (b === undefined || b === null) return { ok: false, status: 400, error: '요청 본문(JSON)이 비어 있습니다.' };
  return { ok: true, body: b };
}

/** explore 모드용: 도수 상한을 맞출 무알콜 재료가 없을 때 (SPEC §3.3-8) */
function noMixerNotice(strength) {
  const range = STRENGTH_ABV[strength];
  return `지금 장착된 재료로는 '${STRENGTH_KO[strength]}'(최대 ${range ? range.max : 0}%) 도수를 맞출 무알콜 재료가 없어요. 아래 재료를 장착해 보세요.`;
}

/**
 * 지금 만들 수 있는 재료가 없는 이유 (normal 422 오류 문구 / explore notice)
 * excludePumps: 성향(알레르기·싫어하는 재료)으로 뺀 펌프, noMixer: lacksMixer() 결과
 */
function noUsableMessage(req, { explore = false, excludePumps = new Set(), noMixer = false } = {}) {
  const { strength } = req.user;
  if (!req.ingredients.length) {
    return '장착된 재료가 없어요. 아래 재료 중 하나를 펌프에 장착해 보세요.';
  }
  const noSoftIngredient = strength === 'none' && !req.ingredients.some((i) => i.abv === 0);
  if (noSoftIngredient) {
    return explore
      ? '지금 장착된 재료는 모두 술이라 무알콜로는 만들 수 없어요. 아래 무알콜 재료를 장착해 보세요.'
      : '무알콜로 만들 수 있는 재료(도수 0%)가 없습니다. 주스·탄산 같은 무알콜 재료를 장착하거나 도수를 바꿔 주세요.';
  }
  if (noMixer) return explore ? noMixerNotice(strength) : noMixerMessage(strength);
  if (excludePumps.size && usableIngredients(req.ingredients, strength).length) {
    return explore
      ? '성향에 적힌 재료(알레르기·싫어하는 재료)를 빼면 쓸 수 있는 재료가 없어요. 아래 재료를 장착해 보세요.'
      : '성향에 적힌 재료(알레르기·싫어하는 재료)를 빼면 만들 수 있는 재료가 없습니다. 다른 재료를 장착하거나 성향 문구를 확인해 주세요.';
  }
  return explore
    ? '사용할 수 있는 재료의 잔량이 부족해요. 용기를 보충하거나 아래 재료를 장착해 보세요.'
    : '사용할 수 있는 재료의 잔량이 모두 0ml 입니다. 용기를 보충한 뒤 앱에서 잔량을 수정해 주세요.';
}

/** AI 가 준 JSON 에서 레시피 부분과 explore 배열 분리 ({recipe:{...}, explore} 모양도 허용) */
function splitAiJson(raw) {
  let recipeRaw = raw;
  if (raw && !Array.isArray(raw.ingredients) && raw.recipe && typeof raw.recipe === 'object') recipeRaw = raw.recipe;
  const explore = Array.isArray(raw && raw.explore) ? raw.explore : Array.isArray(recipeRaw && recipeRaw.explore) ? recipeRaw.explore : [];
  return { recipeRaw, explore };
}

async function handleRecipe(res, body) {
  const v = validateRecipeRequest(body);
  if (!v.ok) return sendJson(res, v.status || 400, { ok: false, error: v.error });
  const req = v.value;
  const { mode } = req;
  const { cupMl, strength, adultVerified } = req.user;
  // 성향(알레르기·싫어하는 재료)으로 뺄 펌프 — AI 레시피·fallback·도수 보정(섞을 재료 고르기)·explore 카드 모두에서 제외
  const excludePumps = preferenceExcludedPumps(req.ingredients, req.user.preference);
  // explore 카드: 성향으로 뺀 장착 재료 줄·미장착 재료(새 재료 포함)도 쓰지 않음 (규칙기반 후보와 같은 판정)
  const excludeName = (name) => excludedByPreference({ name }, req.user.preference);
  const exploreOpts = { cupMl, strength, mode, adultVerified, excludePumps, excludeName };
  const exploreMax = EXPLORE_MAX[mode];
  /**
   * 규칙기반 explore 후보 (normalizeExplore 로 보정).
   * noMixerCards: NO_MIXER 로 recipe:null 인 응답 → 무알콜 재료를 새로 더하는 카드만 (SPEC §3.3-8, filterNoMixerExplore)
   */
  const fallbackExplore = (noMixerCards = false) => {
    const items = normalizeExplore(buildFallbackExplore(req.user, req.ingredients, req.history, { mode }), req.ingredients, exploreOpts).items;
    return noMixerCards ? filterNoMixerExplore(items).items : items;
  };

  // adultVerified: 성인 확인 전이면 레시피 suggestions 에서 술 장착·대체 제안 제거 (SPEC §3.2)
  const finalOpts = { cupMl, strength, excludePumps, adultVerified };

  // 만들 수 있는 재료가 하나도 없거나(잔량 0·무알콜인데 술만·성향으로 모두 제외),
  // 도수 상한을 맞출 무알콜 재료가 아예 없으면(SPEC §3.3-8, 상한보다 독한 술만 있음):
  //   normal → AI 를 부르지 않고 422 (SPEC §3.3-7·8) / explore → recipe:null + explore 만 (SPEC §5.4)
  const noMixer = lacksMixer(req.ingredients, strength, excludePumps);
  const exploreOnly = !usableIngredients(req.ingredients, strength, excludePumps).length || noMixer;
  const reasonOpts = { excludePumps, noMixer };
  if (exploreOnly && mode !== 'explore') return sendJson(res, 422, { ok: false, error: noUsableMessage(req, reasonOpts) });

  // NO_MIXER 로 recipe:null (탐색 전용) → explore 는 무알콜 재료를 새로 더하는 카드만 (SPEC §3.3-8)
  const noMixerOnly = exploreOnly && noMixer;
  const finalize = (raw) => {
    const { recipeRaw, explore } = splitAiJson(raw);
    const nx = normalizeExplore(explore, req.ingredients, exploreOpts);
    // NO_MIXER: 무알콜 재료를 새로 하나도 더하지 않는 카드(술만 더하는 카드)는 버림
    const nm = noMixerOnly ? filterNoMixerExplore(nx.items) : { items: nx.items, removed: 0 };
    // 성인 확인 전이라 AI 의 술 장착 항목을 버리거나(SPEC §5.4, 무알콜 규칙으로 버린 술 항목 포함)
    // NO_MIXER 라 술만 더하는 카드를 버려(SPEC §3.3-8 — normalizeExplore 가 도수를 못 낮춰 버린 카드 + filterNoMixerExplore)
    // 0개가 되면 → 규칙기반 후보(같은 필터)로 채움 (0개일 때만)
    //   (AI 를 다시 부르지 않음: 같은 요청이면 또 술을 권할 수 있고, recipe:null 인 탐색 응답이 비지 않게)
    //   그 밖의 이유(형식 오류 등)로 탐색 전용 카드가 0개면 기존대로 { ok:false } → AI 1회 재요청(BAD_RESPONSE)
    const dropped = nx.removedAdult + (noMixerOnly ? nx.removedNoMixer + nm.removed : 0);
    const ex = !nm.items.length && dropped > 0 ? fallbackExplore(noMixerOnly) : nm.items;
    if (exploreOnly) return ex.length ? { ok: true, recipe: null, explore: ex, adjustments: [] } : { ok: false };
    const fin = finalizeRecipe(recipeRaw, req.ingredients, finalOpts);
    return fin.ok ? { ok: true, recipe: fin.recipe, explore: ex, adjustments: fin.adjustments } : fin;
  };
  const notice = exploreOnly ? { notice: noUsableMessage(req, { explore: true, ...reasonOpts }) } : {};

  const ai = await gemini.generateRecipe(req, finalize, { exploreOnly });
  if (ai.ok) {
    // 탐색 모드는 explore 1개 이상 보장 (AI 가 0개면 규칙기반 후보로 채움)
    const explore = mode === 'explore' && !ai.explore.length ? mergeExplore(ai.explore, fallbackExplore(noMixerOnly), exploreMax) : ai.explore;
    return sendJson(res, 200, {
      ok: true, source: 'gemini', model: ai.model, mode, recipe: ai.recipe, explore, adjustments: ai.adjustments, ...notice,
    });
  }

  const code = FALLBACK_WARNINGS[ai.code] ? ai.code : 'UPSTREAM';
  let recipe = null;
  let adjustments = [];
  let fallbackNotice = notice;
  // NO_MIXER 로 recipe:null 이면 규칙기반 explore 도 무알콜 재료를 더하는 카드만 (SPEC §3.3-8)
  let noMixerCards = noMixerOnly;
  if (!exploreOnly) {
    const raw = buildFallbackRecipe(req.user, req.ingredients, req.history);
    const fin = raw ? finalizeRecipe(raw, req.ingredients, finalOpts) : { ok: false };
    if (fin.ok) {
      recipe = fin.recipe;
      adjustments = fin.adjustments;
    } else if (mode !== 'explore') {
      const error = fin.code === 'NO_MIXER'
        ? fin.error
        : '장착된 재료와 요청 조건으로 만들 수 있는 레시피가 없습니다. 재료 잔량·도수 설정을 확인해 주세요.';
      return sendJson(res, 422, { ok: false, error });
    } else {
      noMixerCards = fin.code === 'NO_MIXER';
      fallbackNotice = {
        notice: fin.code === 'NO_MIXER'
          ? noMixerNotice(strength)
          : '지금 장착된 재료와 요청 조건으로는 만들 수 있는 레시피가 없어요. 아래 재료를 장착해 보세요.',
      };
    }
  }
  return sendJson(res, 200, {
    ok: true,
    source: 'fallback',
    model: 'rule-based',
    mode,
    recipe,
    explore: fallbackExplore(noMixerCards),
    warning: FALLBACK_WARNINGS[code],
    warningCode: code,
    adjustments,
    ...fallbackNotice,
  });
}

async function handleLegacy(res, prompt) {
  const p = prompt.trim();
  if (!p) return sendJson(res, 400, { ok: false, error: 'prompt 가 비어 있습니다.' });
  if (p.length > MAX_PROMPT_CHARS) return sendJson(res, 413, { ok: false, error: `prompt 가 너무 깁니다. (최대 ${MAX_PROMPT_CHARS}자)` });
  const r = await gemini.generateText(p);
  if (r.ok) return sendJson(res, 200, { ok: true, result: r.text, model: r.model });
  const [status, error] = LEGACY_ERRORS[r.code] || [502, 'AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.'];
  return sendJson(res, status, { ok: false, error });
}

module.exports = async function handler(req, res) {
  try {
    setCors(res);
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    if (method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        service: SERVICE,
        version: VERSION,
        model: gemini.resolveModel(),
        keyConfigured: !!gemini.getApiKey(),
      });
    }
    if (method !== 'POST') return sendJson(res, 405, { ok: false, error: '허용되지 않는 요청 방식입니다. (GET, POST, OPTIONS 만 지원)' });

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, error: parsed.error });
    const body = parsed.body;
    const isObj = body && typeof body === 'object' && !Array.isArray(body);
    if (isObj && body.version == null && typeof body.prompt === 'string') return await handleLegacy(res, body.prompt);
    return await handleRecipe(res, body);
  } catch (e) {
    console.error('[api] 예기치 못한 오류:', gemini.redact(e && e.stack ? e.stack : e, gemini.getApiKey()));
    if (!res.headersSent && !res.writableEnded) return sendJson(res, 500, { ok: false, error: '서버 내부 오류가 발생했습니다.' });
    return undefined;
  }
};

module.exports.SERVICE = SERVICE;
module.exports.VERSION = VERSION;
module.exports.FALLBACK_WARNINGS = FALLBACK_WARNINGS;
