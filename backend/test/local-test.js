'use strict';
/**
 * 로컬 테스트 — 실제 네트워크 없이 global.fetch 를 가짜로 바꿔 handler 를 검증합니다.
 * 실행: node test/local-test.js   (또는 npm test)
 * 실제 Gemini 키는 절대 사용하지 않습니다(가짜 키 사용).
 */

const assert = require('assert/strict');

const FAKE_KEY = 'TEST-ONLY-FAKE-KEY-0123456789';
process.env.GEMINI_API_KEY = `  ${FAKE_KEY}\n`; // 앞뒤 공백/줄바꿈 → trim 확인
delete process.env.GEMINI_MODEL;

const handler = require('../api/index.js');
const gemini = require('../lib/gemini');
const recipeLib = require('../lib/recipe');
const fallbackLib = require('../lib/fallback');
const { buildFallbackRecipe, buildFallbackExplore, comboKey } = fallbackLib;
const { normalizeExplore, nameKey, uninstalledLineAbv } = require('../lib/explore');
const { looksAlcoholic } = require('../lib/alcohol');
const { abvToStrengthLevel } = require('../lib/flavor');
const { buildUserPrompt, buildRecipeSchema, buildExploreOnlySchema } = require('../lib/prompt');

// 실제 배포 기본값(테스트용으로 줄이기 전) — 앱 타임아웃과의 관계 검사용
const DEFAULT_SETTINGS = { ...gemini.settings };
/**
 * 앱이 서버 응답을 기다리는 최대 시간 = app/src/lib/ai/recommend.ts 의 SERVER_TIMEOUT_MS (SPEC §3.1: 50초).
 * 앱 소스가 옆에 있으면 그 값을 읽어 관계를 검사하고, 없으면 SPEC 값을 씀.
 * (AI_TIMEOUT_MS 25초는 앱이 Gemini 를 직접 부를 때만 쓰는 값이라 서버 한도와 무관)
 */
const SPEC_APP_SERVER_TIMEOUT_MS = 50000;
const APP_SERVER_TIMEOUT_MS = (() => {
  try {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/src/lib/ai/recommend.ts'), 'utf8');
    const m = src.match(/export\s+const\s+SERVER_TIMEOUT_MS\s*=\s*([\d_]+)/);
    return m ? Number(m[1].replace(/_/g, '')) : SPEC_APP_SERVER_TIMEOUT_MS;
  } catch (_) {
    return SPEC_APP_SERVER_TIMEOUT_MS;
  }
})();
/** 콜드스타트·네트워크·fallback 생성 여유 */
const SERVER_MARGIN_MS = 5000;

// 테스트는 빠르게: 대기 시간 축소
Object.assign(gemini.settings, { retryDelayMs: 5, timeoutMs: 200, totalBudgetMs: 5000, minAttemptMs: 50, maxRetryAfterMs: 3000 });

// 로그 수집(키 노출 검사용) + 출력 억제
const logs = [];
console.warn = (...a) => logs.push(a.join(' '));
console.error = (...a) => logs.push(a.join(' '));

// ───────── fetch 모킹 ─────────
let queue = [];
let calls = [];
global.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts, body: JSON.parse(opts.body) });
  const next = queue.shift();
  if (!next) throw new Error('예상하지 못한 fetch 호출');
  return typeof next === 'function' ? next(url, opts) : next;
};
function mockResponse(status, json, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() in headers ? headers[k.toLowerCase()] : null) },
    json: async () => {
      if (json === undefined) throw new Error('no json');
      return json;
    },
  };
}
function geminiText(text) {
  return mockResponse(200, { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] });
}
const geminiJson = (obj) => geminiText(JSON.stringify(obj));
const geminiError = (status, message = 'error') => mockResponse(status, { error: { code: status, message, status: 'ERR' } });
function hang(url, opts) {
  return new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
}

// ───────── 가짜 req/res ─────────
const allBodies = [];
async function call(method, body) {
  const req = { method, headers: { 'content-type': 'application/json' }, body };
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k) {
      return this.headers[k.toLowerCase()];
    },
    end(b) {
      this.body = b;
      this.ended = true;
    },
  };
  await handler(req, res);
  assert.ok(res.ended, 'res.end() 가 호출되어야 함');
  if (res.body) allBodies.push(String(res.body));
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, headers: res.headers };
}

// ───────── 공통 데이터 ─────────
const INGREDIENTS = [
  { pump: 1, name: '보드카', category: 'spirit', abv: 40, remainingMl: 650, notes: '' },
  { pump: 2, name: '오렌지주스', category: 'juice', abv: 0, remainingMl: 900, notes: '' },
  { pump: 3, name: '레몬주스', category: 'juice', abv: 0, remainingMl: 300, notes: '' },
  { pump: 4, name: '사이다', category: 'soda', abv: 0, remainingMl: 1000, notes: '' },
];
function v2(userOverride = {}, ingredients = INGREDIENTS, extra = {}) {
  return {
    version: 2,
    user: {
      moods: ['피곤함', '설렘'],
      taste: { sweet: 3, sour: 2, bitter: 1, fizzy: 4 },
      strength: 'none',
      weather: { condition: '맑음', tempC: 18.5, humidity: 60 },
      situation: '혼술',
      preference: '',
      cupMl: 200,
      ...userOverride,
    },
    ingredients,
    history: [{ name: '선셋 피즈', liked: true, ingredients: [{ name: '오렌지주스', ml: 120 }] }],
    ...extra,
  };
}
const GOOD_AI = {
  name: '미드나잇 시트러스',
  nameEn: 'Midnight Citrus',
  description: '상큼한 오렌지에 탄산을 더한 가벼운 에이드',
  reason: '피곤하다고 하셔서 비타민C가 풍부한 오렌지와 청량한 탄산으로 기분 전환을 도와드려요.',
  ingredients: [
    { pump: 2, name: '오렌지주스', ml: 90 },
    { pump: 4, name: '사이다', ml: 100 }, // 합계 190 → 200 으로 비례 보정되어야 함
  ],
  estimatedAbv: 3, // 틀린 값 → 0 으로 재계산되어야 함
  flavor: { sweet: 3, sour: 2, bitter: 0, fizzy: 4, strength: 2 },
  garnish: '얼음 + 레몬 슬라이스 (선택)',
  tips: '잔에 얼음을 먼저 채우고 제조를 시작하세요.',
  suggestions: [
    { type: 'add_ingredient', ingredient: '토닉워터', message: '토닉워터를 추가 장착하면 진토닉 스타일도 만들 수 있어요.' },
    { type: 'add_ingredient', ingredient: '사이다', message: '사이다를 장착하세요' }, // 이미 장착 → 제거
    { type: 'weird', message: '알 수 없는 타입 → info' },
  ],
};

function assertRecipeShape(r, cupMl = 200) {
  assert.equal(typeof r.name, 'string');
  assert.ok(r.name.length > 0);
  assert.ok(Array.isArray(r.ingredients) && r.ingredients.length > 0);
  for (const i of r.ingredients) {
    assert.ok(Number.isInteger(i.pump) && i.pump >= 1 && i.pump <= 8);
    assert.ok(i.ml > 0 && i.ml <= 500);
    assert.equal(Math.round(i.ml * 10) / 10, i.ml, '소수 1자리');
  }
  const sum = Math.round(r.ingredients.reduce((s, i) => s + i.ml, 0) * 10) / 10;
  assert.equal(r.totalMl, sum);
  assert.ok(r.totalMl <= cupMl + 0.05);
  for (const k of ['sweet', 'sour', 'bitter', 'fizzy', 'strength']) assert.ok(Number.isInteger(r.flavor[k]) && r.flavor[k] >= 0 && r.flavor[k] <= 5);
  assert.ok(Array.isArray(r.suggestions));
  for (const s of r.suggestions) assert.ok(recipeLib.SUGGESTION_TYPES.includes(s.type) && s.message);
}
function abvOf(r, ingredients = INGREDIENTS) {
  const by = new Map(ingredients.map((i) => [i.pump, i]));
  const tot = r.ingredients.reduce((s, i) => s + i.ml, 0);
  return Math.round((r.ingredients.reduce((s, i) => s + i.ml * by.get(i.pump).abv, 0) / tot) * 10) / 10;
}

// ───────── 테스트 목록 ─────────
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// (a) 정상 Gemini JSON → 보정된 recipe
test('(a) 정상 Gemini 응답 → source:gemini, 총량 200 보정, 도수 재계산, 제안 정리', async () => {
  queue = [geminiJson(GOOD_AI)];
  calls = [];
  const { status, json } = await call('POST', v2());
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.source, 'gemini');
  assert.equal(json.model, 'gemini-3.6-flash');
  const r = json.recipe;
  assertRecipeShape(r);
  assert.equal(r.totalMl, 200);
  assert.deepEqual(r.ingredients.map((i) => i.pump), [2, 4]);
  assert.equal(r.ingredients[0].ml, 94.7); // 90 × 200/190
  assert.equal(r.ingredients[1].ml, 105.3);
  assert.equal(r.estimatedAbv, 0);
  assert.equal(r.flavor.strength, 0);
  assert.equal(r.name, '미드나잇 시트러스');
  assert.equal(r.nameEn, 'Midnight Citrus');
  assert.ok(r.suggestions.some((s) => s.type === 'add_ingredient' && s.ingredient === '토닉워터'));
  assert.ok(!r.suggestions.some((s) => s.ingredient === '사이다'), '이미 장착된 재료 add_ingredient 제거');
  assert.ok(r.suggestions.some((s) => s.type === 'info' && s.message.includes('알 수 없는')));
  assert.ok(Array.isArray(json.adjustments) && json.adjustments.some((a) => a.includes('190ml → 200ml')));
  // Gemini 요청 형식
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent');
  assert.ok(!c.url.includes(FAKE_KEY), 'URL 에 키 없음');
  assert.equal(c.opts.headers['x-goog-api-key'], FAKE_KEY, 'trim 된 키를 헤더로');
  assert.equal(c.body.generationConfig.responseMimeType, 'application/json');
  assert.ok(c.body.generationConfig.responseJsonSchema, 'JSON 스키마 포함');
  assert.deepEqual(c.body.generationConfig.responseJsonSchema.properties.ingredients.items.properties.pump.enum, [2, 3, 4], '무알콜 → 보드카(1) 펌프 제외');
  assert.deepEqual(c.body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
  assert.equal(c.body.generationConfig.temperature, undefined, 'Gemini 3 이상에는 temperature 미전송(공식 문서 권장)');
  assert.equal(c.body.generationConfig.maxOutputTokens, 8192);
  const ex = c.body.generationConfig.responseJsonSchema.properties.explore;
  assert.ok(ex && ex.minItems === 0 && ex.maxItems === 1, 'normal 모드 explore 0~1');
  assert.ok(c.body.generationConfig.responseJsonSchema.required.includes('explore'));
  assert.equal(json.mode, 'normal');
  assert.deepEqual(json.explore, [], 'AI 가 explore 를 안 주면 빈 배열');
  assert.ok(c.body.systemInstruction.parts[0].text.includes('바텐더'));
  const prompt = c.body.contents[0].parts[0].text;
  assert.ok(prompt.includes('펌프 2: 오렌지주스') && prompt.includes('피곤함') && prompt.includes('맑음') && prompt.includes('선셋 피즈'));
  assert.ok(prompt.includes('[요청 모드] normal'));
  assert.ok(!prompt.includes('[피해야 할 조합]'), '거절 기록 없으면 섹션 없음');
});

test('(a2) GEMINI_MODEL 환경변수로 모델 교체 / 잘못된 이름은 기본값', async () => {
  process.env.GEMINI_MODEL = ' gemini-3.8-flash ';
  queue = [geminiJson(GOOD_AI)];
  calls = [];
  let r = await call('POST', v2());
  assert.equal(r.json.model, 'gemini-3.8-flash');
  assert.ok(calls[0].url.includes('/models/gemini-3.8-flash:generateContent'));
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';
  queue = [geminiJson(GOOD_AI)];
  calls = [];
  r = await call('POST', v2());
  assert.equal(calls[0].body.generationConfig.thinkingConfig, undefined, 'Gemini 2.x 에는 thinkingLevel 미전송');
  assert.equal(calls[0].body.generationConfig.temperature, 0.9, 'Gemini 2.x 에는 temperature 전송');
  process.env.GEMINI_MODEL = '../evil?key=1';
  assert.equal(gemini.resolveModel(), 'gemini-3.6-flash');
  delete process.env.GEMINI_MODEL;
});

test('(a3) 코드블록으로 감싼 JSON / {recipe:{...}} 형태도 파싱', async () => {
  queue = [geminiText('여기 레시피입니다\n```json\n' + JSON.stringify({ recipe: GOOD_AI }) + '\n```')];
  calls = [];
  const { json } = await call('POST', v2());
  assert.equal(json.source, 'gemini');
  assert.equal(json.recipe.totalMl, 200);
  assert.equal(calls.length, 1);
});

// (b) 정규화 규칙
test('(b1) 미장착 펌프 제거 / 중복 펌프 합산 / 음수 제거 / 무알콜 시 주류 제거 / 비례 보정', async () => {
  const ai = {
    ...GOOD_AI,
    ingredients: [
      { pump: 1, name: '보드카', ml: 40 }, // strength none → 제거
      { pump: 2, name: '오렌지주스', ml: 50 },
      { pump: 7, name: '라임주스', ml: 20 }, // 미장착 → 제거
      { pump: 2, name: '오렌지주스', ml: 30 }, // 중복 → 합산(80)
      { pump: 3, name: '레몬주스', ml: -15 }, // 음수 → 0 → 제거
      { pump: 4, name: '사이다', ml: 20 },
    ],
  };
  queue = [geminiJson(ai)];
  const { status, json } = await call('POST', v2({ strength: 'none' }));
  assert.equal(status, 200);
  assert.equal(json.source, 'gemini');
  const r = json.recipe;
  assertRecipeShape(r);
  assert.deepEqual(r.ingredients, [
    { pump: 2, name: '오렌지주스', ml: 160 }, // 80 × 200/100
    { pump: 4, name: '사이다', ml: 40 },
  ]);
  assert.equal(r.estimatedAbv, 0);
  const adj = json.adjustments.join(' / ');
  assert.ok(adj.includes('라임주스'), adj);
  assert.ok(adj.includes('보드카'), adj);
  assert.ok(adj.includes('합쳤'), adj);
});

test('(b2) 잔량 초과 → 잔량까지만 사용 + low_stock 제안', async () => {
  const ings = INGREDIENTS.map((i) => (i.pump === 2 ? { ...i, remainingMl: 50 } : i));
  const ai = { ...GOOD_AI, ingredients: [{ pump: 2, name: '오렌지주스', ml: 120 }, { pump: 4, name: '사이다', ml: 80 }], suggestions: [] };
  queue = [geminiJson(ai)];
  const { json } = await call('POST', v2({}, ings));
  const r = json.recipe;
  assertRecipeShape(r);
  assert.deepEqual(r.ingredients, [
    { pump: 2, name: '오렌지주스', ml: 50 },
    { pump: 4, name: '사이다', ml: 80 },
  ]);
  assert.equal(r.totalMl, 130);
  const ls = r.suggestions.find((s) => s.type === 'low_stock');
  assert.ok(ls && ls.pump === 2 && ls.message.includes('50ml'), JSON.stringify(r.suggestions));
});

test('(b3) normalizeRecipe 단위: 이름 우선 매칭, 반올림 잔차, 도수 계산, 빈 레시피 오류', () => {
  const ings = recipeLib.sanitizeIngredients(INGREDIENTS).ingredients;
  // 펌프 번호가 틀려도 이름이 정확하면 이름 기준
  let n = recipeLib.normalizeRecipe({ ingredients: [{ pump: 9, name: '오렌지 주스', ml: 10 }, { pump: 4, name: '사이다', ml: 10 }] }, ings, { cupMl: 100, strength: 'none' });
  assert.ok(n.ok);
  assert.deepEqual(n.recipe.ingredients.map((i) => i.pump), [2, 4]);
  // 1:1:1 → 66.7 + 66.7 + 66.6 = 200
  n = recipeLib.normalizeRecipe({ ingredients: [{ pump: 2, ml: 1 }, { pump: 3, ml: 1 }, { pump: 4, ml: 1 }] }, ings, { cupMl: 200, strength: 'none' });
  assert.equal(n.recipe.totalMl, 200);
  assert.deepEqual(n.recipe.ingredients.map((i) => i.ml).sort(), [66.6, 66.7, 66.7].sort());
  // 도수: 보드카 30 + 오렌지 170 → 6.0%
  n = recipeLib.normalizeRecipe({ ingredients: [{ pump: 1, ml: 30 }, { pump: 2, ml: 170 }] }, ings, { cupMl: 200, strength: 'medium' });
  assert.equal(n.recipe.estimatedAbv, 6);
  assert.equal(n.recipe.flavor.strength, 2);
  // 무알콜인데 주류만 → 오류
  n = recipeLib.normalizeRecipe({ ingredients: [{ pump: 1, ml: 50 }] }, ings, { cupMl: 200, strength: 'none' });
  assert.equal(n.ok, false);
  assert.equal(n.code, 'EMPTY_RECIPE');
  // 잘못된 원본
  assert.equal(recipeLib.normalizeRecipe(null, ings, {}).ok, false);
  assert.equal(recipeLib.normalizeRecipe({ ingredients: 'x' }, ings, {}).ok, false);
});

test('(b4) 도수 상한 보정: light 에 보드카 50% → 5% 이하로, 총량 유지', () => {
  const ings = recipeLib.sanitizeIngredients(INGREDIENTS).ingredients;
  let f = recipeLib.finalizeRecipe({ ingredients: [{ pump: 1, ml: 100 }, { pump: 2, ml: 100 }] }, ings, { cupMl: 200, strength: 'light' });
  assert.ok(f.ok);
  assert.ok(f.recipe.estimatedAbv <= 5, `abv=${f.recipe.estimatedAbv}`);
  assert.equal(f.recipe.totalMl, 200);
  assert.equal(abvOf(f.recipe), f.recipe.estimatedAbv);
  // 주류만 있는 레시피(strong) → 무알콜 재료(사이다) 자동 추가 후 20% 이하
  f = recipeLib.finalizeRecipe({ ingredients: [{ pump: 1, ml: 200 }] }, ings, { cupMl: 200, strength: 'strong' });
  assert.ok(f.recipe.estimatedAbv <= 20 && f.recipe.estimatedAbv >= 15, `abv=${f.recipe.estimatedAbv}`);
  assert.ok(f.recipe.ingredients.some((i) => i.pump === 4), '탄산(사이다) 추가');
  assert.equal(f.recipe.totalMl, 200);
  // 섞을 무알콜 재료가 전혀 없으면 상한을 지킬 수 없음 → 실패 NO_MIXER (예전: 술 200ml 그대로 + info 경고)
  const onlySpirit = recipeLib.sanitizeIngredients([INGREDIENTS[0]]).ingredients;
  f = recipeLib.finalizeRecipe({ ingredients: [{ pump: 1, ml: 200 }] }, onlySpirit, { cupMl: 200, strength: 'strong' });
  assert.equal(f.ok, false);
  assert.equal(f.code, 'NO_MIXER');
  assert.equal(f.recipe, undefined, '레시피를 돌려주지 않음');
  assert.ok(f.error.includes('무알콜') && f.error.includes('20%'), f.error);
});

// (c) 오류 → 재시도 → fallback
test('(c1) Gemini 500 → 1회 재시도 후 fallback 200 (UPSTREAM)', async () => {
  queue = [geminiError(500, 'internal'), geminiError(503, 'unavailable')];
  calls = [];
  const { status, json } = await call('POST', v2());
  assert.equal(status, 200);
  assert.equal(calls.length, 2, '정확히 2번 호출(최초+재시도)');
  assert.equal(json.source, 'fallback');
  assert.equal(json.model, 'rule-based');
  assert.equal(json.warningCode, 'UPSTREAM');
  assert.ok(json.warning.includes('기본 추천'));
  assertRecipeShape(json.recipe);
  assert.equal(json.recipe.totalMl, 200);
  assert.equal(json.recipe.estimatedAbv, 0);
  assert.ok(!json.recipe.ingredients.some((i) => i.pump === 1), '무알콜 → 보드카 없음');
});

test('(c2) 500 후 재시도 성공 → source:gemini', async () => {
  queue = [geminiError(500), geminiJson(GOOD_AI)];
  calls = [];
  const { json } = await call('POST', v2());
  assert.equal(calls.length, 2);
  assert.equal(json.source, 'gemini');
});

test('(c3) 429(짧은 Retry-After) → 재시도 성공 / 429(긴 retryDelay) → 바로 fallback', async () => {
  queue = [mockResponse(429, { error: { code: 429, message: 'quota' } }, { 'retry-after': '0' }), geminiJson(GOOD_AI)];
  calls = [];
  let r = await call('POST', v2());
  assert.equal(calls.length, 2);
  assert.equal(r.json.source, 'gemini');
  queue = [mockResponse(429, { error: { code: 429, message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' }] } })];
  calls = [];
  r = await call('POST', v2());
  assert.equal(calls.length, 1, '37초 대기 대신 즉시 대체');
  assert.equal(r.json.source, 'fallback');
  assert.equal(r.json.warningCode, 'RATE_LIMIT');
});

test('(c4) 타임아웃 → 재시도 없이 fallback(TIMEOUT)', async () => {
  queue = [hang];
  calls = [];
  const t0 = Date.now();
  const { status, json } = await call('POST', v2());
  assert.equal(status, 200);
  assert.equal(calls.length, 1);
  assert.equal(json.source, 'fallback');
  assert.equal(json.warningCode, 'TIMEOUT');
  assert.ok(Date.now() - t0 < 2000);
});

test('(c5) JSON 파싱 실패 → 1회 재요청 성공 / 두 번 실패 → fallback(BAD_RESPONSE)', async () => {
  queue = [geminiText('죄송해요, 레시피는... (JSON 아님)'), geminiJson(GOOD_AI)];
  calls = [];
  let r = await call('POST', v2());
  assert.equal(calls.length, 2);
  assert.equal(r.json.source, 'gemini');
  queue = [geminiText('not json'), geminiText('{"name": "깨진 json"')];
  calls = [];
  r = await call('POST', v2());
  assert.equal(calls.length, 2);
  assert.equal(r.json.source, 'fallback');
  assert.equal(r.json.warningCode, 'BAD_RESPONSE');
});

test('(c6) 검증 후 빈 레시피(미장착 재료만) → 재요청 → 그래도 실패 시 fallback', async () => {
  const badAi = { ...GOOD_AI, ingredients: [{ pump: 8, name: '럼', ml: 200 }] };
  queue = [geminiJson(badAi), geminiJson(badAi)];
  calls = [];
  const { json } = await call('POST', v2());
  assert.equal(calls.length, 2);
  assert.equal(json.source, 'fallback');
  assertRecipeShape(json.recipe);
});

test('(c7) 400(스키마/thinking 미지원) → 호환 모드(스키마·thinking 제거)로 재요청', async () => {
  queue = [geminiError(400, 'Invalid JSON payload: unknown field responseJsonSchema'), geminiJson(GOOD_AI)];
  calls = [];
  const { json } = await call('POST', v2());
  assert.equal(calls.length, 2);
  assert.equal(json.source, 'gemini');
  assert.ok(calls[0].body.generationConfig.responseJsonSchema);
  assert.equal(calls[1].body.generationConfig.responseJsonSchema, undefined);
  assert.equal(calls[1].body.generationConfig.thinkingConfig, undefined);
  assert.equal(calls[1].body.generationConfig.responseMimeType, 'application/json');
  assert.ok(calls[1].body.contents[0].parts[0].text.includes('[출력 JSON 형식]'));
});

test('(c8) 잘못된 키(400 API_KEY_INVALID) → 재시도 없이 fallback(AUTH), 키 미노출', async () => {
  queue = [mockResponse(400, { error: { code: 400, message: `API key not valid. key=${FAKE_KEY}`, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } })];
  calls = [];
  const { json } = await call('POST', v2());
  assert.equal(calls.length, 1);
  assert.equal(json.warningCode, 'AUTH');
  assert.ok(!JSON.stringify(json).includes(FAKE_KEY));
});

test('(c9) 네트워크 오류 → 재시도 → fallback(NETWORK)', async () => {
  queue = [() => Promise.reject(new TypeError('fetch failed')), () => Promise.reject(new TypeError('fetch failed'))];
  calls = [];
  const { json } = await call('POST', v2());
  assert.equal(calls.length, 2);
  assert.equal(json.warningCode, 'NETWORK');
});

// (d) 키 없음
test('(d) 키 없음 → fetch 호출 없이 fallback(NO_API_KEY), GET keyConfigured:false', async () => {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '   ';
  queue = [];
  calls = [];
  const { status, json } = await call('POST', v2({ strength: 'medium' }));
  assert.equal(status, 200);
  assert.equal(calls.length, 0);
  assert.equal(json.source, 'fallback');
  assert.equal(json.warningCode, 'NO_API_KEY');
  assertRecipeShape(json.recipe);
  assert.ok(json.recipe.estimatedAbv >= 5 && json.recipe.estimatedAbv <= 12, `medium abv=${json.recipe.estimatedAbv}`);
  const g = await call('GET');
  assert.equal(g.json.keyConfigured, false);
  process.env.GEMINI_API_KEY = saved;
});

// (e) 하위호환
test('(e) legacy {prompt} → {result} 텍스트', async () => {
  queue = [geminiText('{"pump1": 80, "pump3": 70}')];
  calls = [];
  const { status, json } = await call('POST', { prompt: '상큼한 무알콜 칵테일을 만들어줘.', ingredients: ['진로토닉', '레몬즙'] });
  assert.equal(status, 200);
  assert.equal(json.result, '{"pump1": 80, "pump3": 70}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.contents[0].parts[0].text, '상큼한 무알콜 칵테일을 만들어줘.');
  assert.equal(calls[0].body.generationConfig.responseMimeType, undefined);
  assert.equal(calls[0].body.systemInstruction, undefined);
});

test('(e2) legacy: 키 없음 → 503 {ok:false,error}, Gemini 오류 → 502', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  let r = await call('POST', { prompt: '안녕' });
  assert.equal(r.status, 503);
  assert.equal(r.json.ok, false);
  assert.ok(r.json.error.includes('GEMINI_API_KEY'));
  process.env.GEMINI_API_KEY = saved;
  queue = [geminiError(500), geminiError(500)];
  r = await call('POST', { prompt: '안녕' });
  assert.equal(r.status, 502);
  r = await call('POST', { prompt: '   ' });
  assert.equal(r.status, 400);
});

// (f) 잘못된 요청 → 400
test('(f) 잘못된 요청 → 400 / 만들 재료 없음 → 422', async () => {
  const cases = [
    ['{깨진 json', 400],
    ['', 400],
    [undefined, 400],
    [[1, 2, 3], 400],
    [{ version: 3, ingredients: INGREDIENTS }, 400],
    [{ foo: 'bar' }, 400], // version 도 prompt 도 없음
    [v2({}, []), 400], // 재료 0개
    [v2({}, [{ pump: 1, name: '   ' }]), 400], // 이름 없는 슬롯만
    [v2({}, 'not-array'), 400],
    [v2({ cupMl: 1000 }), 400],
    [v2({ cupMl: 10 }), 400],
    [v2({ cupMl: 'abc' }), 400],
    [v2({ strength: 'super' }), 400],
    [v2({}, [{ pump: 1, name: 'a' }, { pump: 1, name: 'b' }]), 400], // 펌프 중복
    [v2({}, [{ pump: 9, name: 'a' }]), 400], // 펌프 범위
    [{ version: 2, user: 'x', ingredients: INGREDIENTS }, 400],
  ];
  queue = [];
  calls = [];
  for (const [body, expected] of cases) {
    const { status, json } = await call('POST', body);
    assert.equal(status, expected, `body=${JSON.stringify(body)} → ${status}`);
    assert.equal(json.ok, false);
    assert.equal(typeof json.error, 'string');
  }
  assert.equal(calls.length, 0, '잘못된 요청은 Gemini 호출 안 함');
  // 무알콜인데 주류만 장착 → 422
  let r = await call('POST', v2({ strength: 'none' }, [INGREDIENTS[0]]));
  assert.equal(r.status, 422);
  assert.ok(r.json.error.includes('무알콜'));
  // 전부 잔량 0 → 422
  r = await call('POST', v2({ strength: 'light' }, INGREDIENTS.map((i) => ({ ...i, remainingMl: 0 }))));
  assert.equal(r.status, 422);
  assert.equal(calls.length, 0);
  // 기본값: user 생략 → strength none, cupMl 200 (키 없이 fallback 로 확인)
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  r = await call('POST', { version: 2, ingredients: INGREDIENTS });
  assert.equal(r.status, 200);
  assert.equal(r.json.recipe.totalMl, 200);
  assert.equal(r.json.recipe.estimatedAbv, 0);
  r = await call('POST', JSON.stringify(v2({ cupMl: '300' }))); // 문자열 본문 + 숫자 문자열
  assert.equal(r.status, 200);
  assert.equal(r.json.recipe.totalMl, 300);
  process.env.GEMINI_API_KEY = saved;
});

// (g) GET / OPTIONS / 기타
test('(g) GET 상태 / OPTIONS 204 + CORS / PUT 405', async () => {
  let r = await call('GET');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.service, 'smart-bartender-ai');
  assert.equal(r.json.version, '2.1.0');
  assert.equal(r.json.model, 'gemini-3.6-flash');
  assert.equal(r.json.keyConfigured, true);
  assert.equal(r.headers['access-control-allow-origin'], '*');
  r = await call('OPTIONS');
  assert.equal(r.status, 204);
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.ok(r.headers['access-control-allow-methods'].includes('POST'));
  assert.ok(r.headers['access-control-allow-headers'].includes('Content-Type'));
  r = await call('PUT', {});
  assert.equal(r.status, 405);
});

// 규칙기반 추천 품질
test('(h) 규칙기반 추천: 도수 단계·탄산 선호·싫어하는 재료·기록 반영', () => {
  const ings = recipeLib.sanitizeIngredients(INGREDIENTS).ingredients;
  const mk = (u) => recipeLib.validateRecipeRequest(v2(u)).value;
  for (const [strength, lo, hi] of [['none', 0, 0], ['light', 1, 5], ['medium', 5, 12], ['strong', 12, 20]]) {
    const req = mk({ strength });
    const f = recipeLib.finalizeRecipe(buildFallbackRecipe(req.user, ings, req.history), ings, { cupMl: 200, strength });
    assert.ok(f.ok);
    assertRecipeShape(f.recipe);
    assert.equal(f.recipe.totalMl, 200);
    assert.ok(f.recipe.estimatedAbv >= lo && f.recipe.estimatedAbv <= hi, `${strength}: ${f.recipe.estimatedAbv}`);
    assert.ok(f.recipe.reason.length > 10);
  }
  // 탄산 5 → 사이다 포함, 마지막 순서
  let req = mk({ taste: { sweet: 2, sour: 2, bitter: 0, fizzy: 5 } });
  let raw = buildFallbackRecipe(req.user, ings, []);
  assert.equal(raw.ingredients[raw.ingredients.length - 1].name, '사이다');
  // "사이다 싫어요" → 사이다 제외
  req = mk({ preference: '사이다는 싫어요', taste: { sweet: 2, sour: 2, bitter: 0, fizzy: 5 } });
  raw = buildFallbackRecipe(req.user, ings, []);
  assert.ok(!raw.ingredients.some((i) => i.name === '사이다'));
  // 탄산 0 → 사이다 제외
  req = mk({ taste: { sweet: 3, sour: 2, bitter: 0, fizzy: 0 } });
  raw = buildFallbackRecipe(req.user, ings, []);
  assert.ok(!raw.ingredients.some((i) => i.name === '사이다'));
  // 레몬주스 비중은 20% 이하
  req = mk({ taste: { sweet: 0, sour: 5, bitter: 0, fizzy: 1 } });
  const f = recipeLib.finalizeRecipe(buildFallbackRecipe(req.user, ings, []), ings, { cupMl: 200, strength: 'none' });
  const lemon = f.recipe.ingredients.find((i) => i.name === '레몬주스');
  assert.ok(!lemon || lemon.ml <= 40.1, JSON.stringify(f.recipe.ingredients));
  // 주류 없는데 strength light → 무알콜 + info
  const soft = recipeLib.sanitizeIngredients(INGREDIENTS.slice(1)).ingredients;
  req = mk({ strength: 'light' });
  raw = buildFallbackRecipe(req.user, soft, []);
  assert.ok(raw.suggestions.some((s) => s.type === 'info' && s.message.includes('주류')));
});

test('(i) 프롬프트/스키마: 무알콜 시 주류 펌프 제외, 잔량 0 펌프 제외, 계절 표기', () => {
  const ings = INGREDIENTS.map((i) => (i.pump === 3 ? { ...i, remainingMl: 0 } : i));
  const req = recipeLib.validateRecipeRequest(v2({ strength: 'none' }, ings)).value;
  const schema = buildRecipeSchema(req);
  assert.deepEqual(schema.properties.ingredients.items.properties.pump.enum, [2, 4]);
  const p = buildUserPrompt(req, { now: new Date('2026-11-17T05:00:00Z') }); // KST 14시
  assert.ok(p.includes('가을, 낮'));
  assert.ok(p.includes('1번 보드카') && p.includes('3번 레몬주스(잔량 0)'));
});

// ───────── v2.1: 탐색(explore) 모드 · 거절 처리 · 규칙 6/8/9 · 결제 오류 ─────────

/** explore 항목 공통 검사 */
function assertExploreItem(e, ingredients = INGREDIENTS, cupMl = 200) {
  assert.equal(typeof e.addIngredient, 'string');
  assert.ok(e.addIngredient.length > 0);
  assert.ok(recipeLib.CATEGORIES.includes(e.category));
  assert.ok(Number.isFinite(e.abv) && e.abv >= 0 && e.abv <= 100);
  assert.ok(e.recipeName && typeof e.description === 'string' && e.message);
  const installed = new Map(ingredients.map((i) => [nameKey(i.name), i]));
  assert.ok(!installed.has(nameKey(e.addIngredient)), `이미 장착된 재료는 addIngredient 불가: ${e.addIngredient}`);
  assert.ok(Array.isArray(e.ingredients) && e.ingredients.length >= 1 && e.ingredients.length <= 5);
  const un = e.ingredients.filter((l) => !l.installed);
  assert.ok(un.length >= 1 && un.length <= 2, `미장착 재료 1~2개: ${JSON.stringify(e.ingredients)}`);
  assert.ok(un.some((l) => nameKey(l.name) === nameKey(e.addIngredient)), 'addIngredient 가 재료 목록에 있음');
  for (const l of e.ingredients) {
    assert.ok(l.ml > 0 && l.ml <= 300);
    assert.equal(Math.round(l.ml * 10) / 10, l.ml, '소수 1자리');
    const m = installed.get(nameKey(l.name));
    if (l.installed) {
      assert.ok(m, `installed:true 면 장착 재료: ${l.name}`);
      assert.equal(l.pump, m.pump);
    } else {
      assert.ok(!m, `installed:false 면 미장착: ${l.name}`);
      assert.equal(l.pump, undefined);
    }
  }
  const sum = Math.round(e.ingredients.reduce((s, l) => s + l.ml, 0) * 10) / 10;
  assert.ok(Math.abs(sum - cupMl) <= 0.05 || e.ingredients.some((l) => l.ml === 300), `합계 ${sum} ≈ cupMl ${cupMl}`);
}

const exploreLine = (name, ml, installed = false) => ({ name, ml, installed });
const exploreItem = (addIngredient, lines, extra = {}) => ({
  addIngredient,
  category: 'soda',
  abv: 0,
  recipeName: `${addIngredient} 레시피`,
  description: '설명',
  ingredients: lines,
  message: `${addIngredient}를 장착해 보세요.`,
  ...extra,
});

test('(j1) explore 모드: installed/pump 재계산 · 장착 재료 제안 제거 · 중복 제거 · 미장착 2개 제한 · 최대 3개 · ml 보정', async () => {
  const aiExplore = [
    // A: '오렌지 주스'(띄어쓰기)·installed:false 로 왔지만 장착 재료 → installed:true, pump 2 / 합 150 → 200
    exploreItem('토닉워터', [exploreLine('오렌지 주스', 50, false), exploreLine('토닉워터', 100, true)]),
    // B: 이미 장착된 사이다 → 제거
    exploreItem('사이다', [exploreLine('사이다', 200)]),
    // C: '토닉 워터' = A 와 같은 재료(공백 무시) → 중복 제거
    exploreItem('토닉 워터', [exploreLine('토닉 워터', 200)]),
    // D: 미장착 3개 → addIngredient + 가장 많은 것 1개만
    exploreItem('그레나딘 시럽', [exploreLine('그레나딘 시럽', 20), exploreLine('라임주스', 30), exploreLine('민트시럽', 10), exploreLine('사이다', 140, false)], { category: 'syrup' }),
    // E: 정상
    exploreItem('진저에일', [exploreLine('진저에일', 120), exploreLine('레몬주스', 30, true), exploreLine('레몬주스', -5, true)]),
    // F: 4번째 유효 항목 → 개수 제한(3)으로 제외
    exploreItem('크랜베리주스', [exploreLine('크랜베리주스', 100), exploreLine('사이다', 100, true)], { category: 'juice' }),
  ];
  queue = [geminiJson({ ...GOOD_AI, explore: aiExplore })];
  calls = [];
  const { status, json } = await call('POST', v2({}, INGREDIENTS, { mode: 'explore' }));
  assert.equal(status, 200);
  assert.equal(json.source, 'gemini');
  assert.equal(json.mode, 'explore');
  assertRecipeShape(json.recipe);
  assert.deepEqual(json.explore.map((e) => e.addIngredient), ['토닉워터', '그레나딘 시럽', '진저에일']);
  for (const e of json.explore) assertExploreItem(e);
  const a = json.explore[0];
  assert.deepEqual(a.ingredients, [
    { name: '오렌지주스', ml: 66.7, installed: true, pump: 2 },
    { name: '토닉워터', ml: 133.3, installed: false },
  ]);
  const d = json.explore[1];
  assert.deepEqual(d.ingredients.map((l) => l.name), ['그레나딘 시럽', '라임주스', '사이다'], '민트시럽(미장착 3번째) 제외');
  assert.equal(d.ingredients[2].installed, true);
  assert.equal(d.ingredients[2].pump, 4);
  const e = json.explore[2];
  assert.equal(e.ingredients.find((l) => l.name === '레몬주스').pump, 3);
  // 요청: explore 스키마 1~3, 프롬프트 모드 안내
  const body = calls[0].body;
  const sx = body.generationConfig.responseJsonSchema.properties.explore;
  assert.equal(sx.minItems, 1);
  assert.equal(sx.maxItems, 3);
  assert.deepEqual(sx.items.properties.abv, { type: 'number', minimum: 0, maximum: 0 }, '무알콜이면 abv 최대 0');
  assert.ok(!sx.items.properties.category.enum.includes('spirit'));
  assert.ok(body.contents[0].parts[0].text.includes('[요청 모드] explore'));
  assert.ok(body.systemInstruction.parts[0].text.includes('explore(탐색 제안)'));
});

test('(j2) explore 모드: AI 가 explore 를 비워 보내면 규칙기반 후보로 1개 이상 채움', async () => {
  queue = [geminiJson({ ...GOOD_AI, explore: [exploreItem('사이다', [exploreLine('사이다', 200)])] })];
  const { json } = await call('POST', v2({}, INGREDIENTS, { mode: 'explore' }));
  assert.equal(json.source, 'gemini');
  assert.ok(json.explore.length >= 1 && json.explore.length <= 3, `explore ${json.explore.length}개`);
  for (const e of json.explore) assertExploreItem(e);
});

test('(j3) 빈 기기 explore → 200 + recipe:null + explore 1~3 (AI 탐색 전용 스키마 / 키 없음 fallback) · normal 은 400', async () => {
  const empty = v2({}, [], { mode: 'explore' });
  const aiExplore = [
    exploreItem('탄산수', [exploreLine('레몬즙', 30), exploreLine('탄산수', 170)]),
    exploreItem('토닉워터', [exploreLine('토닉워터', 150), exploreLine('레몬즙', 20), exploreLine('설탕시럽', 10)]), // 미장착 3개 → 2개
  ];
  queue = [geminiJson({ explore: aiExplore })];
  calls = [];
  let r = await call('POST', empty);
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'gemini');
  assert.equal(r.json.recipe, null);
  assert.equal(typeof r.json.notice, 'string');
  assert.equal(r.json.explore.length, 2);
  for (const e of r.json.explore) {
    assertExploreItem(e, []);
    assert.ok(e.ingredients.every((l) => l.installed === false));
  }
  const schema = calls[0].body.generationConfig.responseJsonSchema;
  assert.deepEqual(Object.keys(schema.properties), ['explore'], '탐색 전용 스키마');
  assert.equal(schema.properties.explore.minItems, 1);
  assert.ok(calls[0].body.contents[0].parts[0].text.includes('없음 (빈 기기)'));
  // AI 가 explore 를 못 주면 → 재요청 → fallback 으로 recipe:null + explore
  queue = [geminiJson({ explore: [] }), geminiJson({ explore: [exploreItem('사이다x', [])] })];
  r = await call('POST', empty);
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'fallback');
  assert.equal(r.json.warningCode, 'BAD_RESPONSE');
  assert.equal(r.json.recipe, null);
  assert.ok(r.json.explore.length >= 1 && r.json.explore.length <= 3);
  // 키 없음
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  for (const strength of ['none', 'light', 'strong']) {
    for (const body of [v2({ strength }, [], { mode: 'explore' }), { version: 2, mode: 'explore', user: { strength } }]) {
      r = await call('POST', body);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.source, 'fallback');
      assert.equal(r.json.recipe, null);
      assert.ok(r.json.notice.includes('장착'));
      assert.ok(r.json.explore.length >= 1 && r.json.explore.length <= 3);
      for (const e of r.json.explore) {
        assertExploreItem(e, []);
        if (strength === 'none') assert.equal(e.abv, 0);
      }
    }
  }
  process.env.GEMINI_API_KEY = saved;
  // normal 모드는 기존대로 (재료 0개 → 400)
  r = await call('POST', v2({}, []));
  assert.equal(r.status, 400);
});

test('(j4) explore + 무알콜인데 술만 장착 → recipe:null + 무알콜 explore / normal 은 422', async () => {
  const onlyVodka = [INGREDIENTS[0]];
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  let r = await call('POST', v2({ strength: 'none' }, onlyVodka, { mode: 'explore' }));
  assert.equal(r.status, 200);
  assert.equal(r.json.recipe, null);
  assert.ok(r.json.notice.includes('무알콜'));
  for (const e of r.json.explore) {
    assertExploreItem(e, onlyVodka);
    assert.equal(e.abv, 0);
    assert.ok(!e.ingredients.some((l) => l.name === '보드카'), '무알콜 → 보드카 줄 없음');
  }
  process.env.GEMINI_API_KEY = saved;
  r = await call('POST', v2({ strength: 'none' }, onlyVodka));
  assert.equal(r.status, 422);
  // 잔량이 모두 0 → explore 는 200, normal 은 422
  const zero = INGREDIENTS.map((i) => ({ ...i, remainingMl: 0 }));
  queue = [geminiJson({ explore: [exploreItem('탄산수', [exploreLine('오렌지주스', 60, true), exploreLine('탄산수', 140)])] })];
  r = await call('POST', v2({ strength: 'light' }, zero, { mode: 'explore' }));
  assert.equal(r.status, 200);
  assert.equal(r.json.recipe, null);
  assert.equal(r.json.explore[0].ingredients[0].pump, 2);
  r = await call('POST', v2({ strength: 'light' }, zero));
  assert.equal(r.status, 422);
});

test('(j5) normal 모드: explore 는 0~1개 (AI 3개 → 1개, fallback → 1개)', async () => {
  const three = [
    exploreItem('토닉워터', [exploreLine('토닉워터', 150), exploreLine('오렌지주스', 50, true)]),
    exploreItem('진저에일', [exploreLine('진저에일', 200)]),
    exploreItem('크랜베리주스', [exploreLine('크랜베리주스', 200)]),
  ];
  queue = [geminiJson({ ...GOOD_AI, explore: three })];
  let r = await call('POST', v2());
  assert.equal(r.json.source, 'gemini');
  assert.equal(r.json.mode, 'normal');
  assert.equal(r.json.explore.length, 1);
  assert.equal(r.json.explore[0].addIngredient, '토닉워터');
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  r = await call('POST', v2());
  assert.equal(r.json.source, 'fallback');
  assert.ok(r.json.explore.length <= 1);
  assert.equal(r.json.explore.length, 1, 'fallback 은 explore 1개 생성 (SPEC §5.4)');
  assertExploreItem(r.json.explore[0]);
  r = await call('POST', v2({}, INGREDIENTS, { mode: 'explore' }));
  assert.ok(r.json.recipe && r.json.explore.length >= 1 && r.json.explore.length <= 3);
  for (const e of r.json.explore) assertExploreItem(e);
  process.env.GEMINI_API_KEY = saved;
});

test('(j6) normalizeExplore 단위: 무알콜 술 제거 · 도수 상한 · 300ml · addIngredient 누락 · 음수', () => {
  const ings = recipeLib.sanitizeIngredients(INGREDIENTS).ingredients;
  // 무알콜: 술 addIngredient 제거, 장착 술(보드카) 줄 제거
  let n = normalizeExplore(
    [
      exploreItem('진', [exploreLine('진', 50), exploreLine('사이다', 150, true)], { category: 'spirit', abv: 40 }),
      exploreItem('트리플섹', [exploreLine('트리플섹', 50)], { category: 'soda', abv: 0 }), // 이름으로 술 판정
      exploreItem('토닉워터', [exploreLine('보드카', 50, true), exploreLine('토닉워터', 150)]),
    ],
    ings,
    { cupMl: 200, strength: 'none', mode: 'explore' }
  );
  assert.deepEqual(n.items.map((e) => e.addIngredient), ['토닉워터']);
  assert.deepEqual(n.items[0].ingredients, [{ name: '토닉워터', ml: 200, installed: false }]);
  // light: 보드카 100 + 토닉 100(50%) → 5% 이하로 (술 줄이고 무알콜 늘림, 총량 유지)
  n = normalizeExplore([exploreItem('토닉워터', [exploreLine('보드카', 100, true), exploreLine('토닉워터', 100)])], ings, { cupMl: 200, strength: 'light', mode: 'normal' });
  const it = n.items[0];
  const vodka = it.ingredients.find((l) => l.name === '보드카');
  const abv = (vodka.ml * 40) / it.ingredients.reduce((s, l) => s + l.ml, 0);
  assert.ok(abv <= 5, `abv=${abv}`);
  assertExploreItem(it);
  // 술만 있는 탐색 제안(무알콜 재료 없음, strong 40%) → 도수를 못 낮추므로 제거
  n = normalizeExplore([exploreItem('진', [exploreLine('진', 100), exploreLine('보드카', 100, true)], { category: 'spirit', abv: 40 })], ings, { cupMl: 200, strength: 'strong', mode: 'explore' });
  assert.equal(n.items.length, 0);
  // cupMl 500, 한 줄 → 300ml 로 자름
  n = normalizeExplore([exploreItem('탄산수', [exploreLine('탄산수', 400), exploreLine('오렌지주스', 100, true)])], ings, { cupMl: 500, strength: 'none', mode: 'normal' });
  assert.deepEqual(n.items[0].ingredients.map((l) => l.ml), [300, 100]);
  // addIngredient 가 재료 목록에 없음 / 0ml → 제거, 음수 → 0 → 제거
  n = normalizeExplore(
    [exploreItem('탄산수', [exploreLine('오렌지주스', 200, true)]), exploreItem('설탕시럽', [exploreLine('설탕시럽', -10), exploreLine('사이다', 190, true)]), 'x', null, {}],
    ings,
    { cupMl: 200, strength: 'none', mode: 'explore' }
  );
  assert.equal(n.items.length, 0);
  assert.equal(normalizeExplore('not-array', ings, {}).items.length, 0);
});

test('(j7) fallback 탐색 후보 목록(SPEC §5.4): 조건 · 무알콜 술 제외 · 채우기 순서 · 거절 반복 제외', () => {
  const ings = recipeLib.sanitizeIngredients([
    { pump: 1, name: '사이다', category: 'soda', abv: 0 },
    { pump: 2, name: '레몬주스', category: 'juice', abv: 0 },
    { pump: 3, name: '오렌지주스', category: 'juice', abv: 0 },
    { pump: 4, name: '그레나딘', category: 'syrup', abv: 0 },
  ]).ingredients;
  const user = (u) => recipeLib.validateRecipeRequest(v2(u, ings)).value.user;
  const names = (u, mode, history = []) =>
    normalizeExplore(buildFallbackExplore(user(u), ings, history, { mode }), ings, { ...user(u), mode }).items.map((e) => e.addIngredient);
  // 탄산·시럽·산미·주스2 장착, 쓴맛 0 → 조건 맞는 무알콜 후보 없음 → light + 성인 확인이면 진 · 트리플섹
  assert.deepEqual(names({ strength: 'light', adultVerified: true, taste: { sweet: 3, sour: 2, bitter: 0, fizzy: 3 } }, 'explore'), ['진', '트리플섹']);
  // 성인 확인 전(adultVerified 생략)이면 술 후보 조건 불만족 → 0개 → 탄산수 → 레몬즙 → 설탕시럽 (SPEC §5.4)
  assert.deepEqual(names({ strength: 'light', taste: { sweet: 3, sour: 2, bitter: 0, fizzy: 3 } }, 'explore'), ['탄산수', '레몬즙', '설탕시럽']);
  // 무알콜이면 술 후보 제외 → 조건 만족 후보 없음 → 탄산수 → 레몬즙 → 설탕시럽
  assert.deepEqual(names({ strength: 'none', taste: { sweet: 3, sour: 2, bitter: 0, fizzy: 3 } }, 'explore'), ['탄산수', '레몬즙', '설탕시럽']);
  // normal 은 1개
  assert.deepEqual(names({ strength: 'none', taste: { sweet: 3, sour: 2, bitter: 0, fizzy: 3 } }, 'normal'), ['탄산수']);
  // 쓴맛 2 → 토닉워터 조건 만족
  assert.deepEqual(names({ strength: 'none', taste: { sweet: 3, sour: 2, bitter: 2, fizzy: 3 } }, 'explore'), ['토닉워터']);
  // 기본 기기(보드카·오렌지·레몬·사이다): 설탕시럽 → 그레나딘 시럽
  const base = recipeLib.sanitizeIngredients(INGREDIENTS).ingredients;
  const u0 = recipeLib.validateRecipeRequest(v2()).value.user;
  let list = buildFallbackExplore(u0, base, [], { mode: 'explore' }).map((e) => e.addIngredient);
  assert.deepEqual(list, ['설탕시럽', '그레나딘 시럽']);
  // 거절 기록에 2번 이상 나온 재료(설탕시럽)는 제외
  const rej = [
    { name: 'a', liked: false, rejected: true, ingredients: [{ name: '설탕 시럽', ml: 20 }] },
    { name: 'b', liked: false, rejected: true, ingredients: [{ name: '설탕시럽', ml: 20 }, { name: '사이다', ml: 180 }] },
  ];
  list = buildFallbackExplore(u0, base, rej, { mode: 'explore' }).map((e) => e.addIngredient);
  assert.deepEqual(list, ['그레나딘 시럽']);
  // 성향에 '우유 알레르기' → 우유 제외 (휴식 상황이라 원래는 후보)
  const relax = recipeLib.validateRecipeRequest(v2({ situation: '휴식', preference: '우유 알레르기 있어요' }, ings)).value.user;
  assert.ok(!buildFallbackExplore(relax, ings, [], { mode: 'explore' }).some((e) => e.addIngredient === '우유'));
});

test('(k1) 거절 처리(fallback): 거절된 레시피와 같은 재료 조합을 피함', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const rejectOf = (recipe) => ({ name: recipe.name, liked: false, rejected: true, ingredients: recipe.ingredients.map((i) => ({ name: i.name, ml: i.ml })) });
  const comboOf = (recipe) => comboKey(recipe.ingredients.map((i) => i.name));
  try {
    for (const strength of ['none', 'medium']) {
      let r = await call('POST', v2({ strength }, INGREDIENTS, { history: [] }));
      const first = r.json.recipe;
      r = await call('POST', v2({ strength }, INGREDIENTS, { history: [rejectOf(first)] }));
      assert.equal(r.status, 200);
      const second = r.json.recipe;
      assertRecipeShape(second);
      assert.notEqual(comboOf(second), comboOf(first), `${strength}: 다른 재료 조합`);
      if (strength === 'medium') assert.ok(second.estimatedAbv >= 5 && second.estimatedAbv <= 12, `abv=${second.estimatedAbv}`);
      // 두 번째도 거절 → 세 번째는 둘 다 피함
      r = await call('POST', v2({ strength }, INGREDIENTS, { history: [rejectOf(second), rejectOf(first)] }));
      const third = comboOf(r.json.recipe);
      assert.ok(third !== comboOf(first) && third !== comboOf(second), `${strength}: 세 번째도 다른 조합`);
    }
    // 점수 감점만으로는 조합이 안 바뀌는 경우(무알콜 재료 2개뿐) → 재료를 바꿔 다른 조합 + 안내
    const two = [INGREDIENTS[1], INGREDIENTS[3]];
    let r = await call('POST', v2({}, two, { history: [] }));
    assert.equal(comboOf(r.json.recipe), comboKey(['오렌지주스', '사이다']));
    r = await call('POST', v2({}, two, { history: [rejectOf(r.json.recipe)] }));
    assert.notEqual(comboOf(r.json.recipe), comboKey(['오렌지주스', '사이다']));
    assert.equal(r.json.recipe.totalMl, 200);
    assert.ok(r.json.recipe.suggestions.some((s) => s.type === 'info' && s.message.includes('겹치지 않게')));
    // 재료가 1개뿐이라 다른 조합이 없으면 → 같은 재료 + 새 재료 장착 안내 (+ explore 1개)
    r = await call('POST', v2({}, [INGREDIENTS[1]], { history: [{ name: 'x', liked: false, rejected: true, ingredients: [{ name: '오렌지주스', ml: 200 }] }] }));
    assert.equal(r.status, 200);
    assert.ok(r.json.recipe.suggestions.some((s) => s.message.includes('새 재료')));
    assert.equal(r.json.explore.length, 1);
  } finally {
    process.env.GEMINI_API_KEY = saved;
  }
});

test('(k2) 거절 처리(프롬프트): rejected 를 "피해야 할 조합"으로 명시, history 최근 10개로 자름', () => {
  const history = [];
  for (let k = 0; k < 12; k += 1) history.push({ name: `기록${k}`, liked: k % 2 === 0, ingredients: [{ name: '오렌지주스', ml: 100 }] });
  history.unshift({ name: '거절한 에이드', liked: false, rejected: true, ingredients: [{ name: '레몬주스', ml: 40 }, { name: '사이다', ml: 160 }] });
  history.splice(1, 0, { name: '또 거절', rejected: 'true', ingredients: [{ name: '사이다', ml: 160 }, { name: '레몬주스', ml: 40 }] }); // 같은 조합(순서만 다름)
  const v = recipeLib.validateRecipeRequest(v2({}, INGREDIENTS, { history }));
  assert.ok(v.ok);
  assert.equal(v.value.history.length, 10, '최근 10개만');
  assert.equal(v.value.history[0].name, '거절한 에이드', '앞(최신)부터 10개');
  assert.equal(v.value.history[1].rejected, true);
  assert.equal(v.value.history[1].liked, false, 'rejected 면 liked 없음 → false');
  assert.equal(v.value.history[2].rejected, false);
  const p = buildUserPrompt(v.value);
  assert.ok(p.includes('[피해야 할 조합]'));
  assert.ok(p.includes('- 거절한 에이드: 레몬주스 + 사이다'));
  assert.ok(!p.includes('- 또 거절: '), '같은 조합은 한 번만');
  assert.ok(p.includes('🙅 거절'));
  assert.ok(p.includes('기록7') && !p.includes('기록8'), '11번째 이후 기록은 버림');
});

test('(l) mode 오류 → 400 / 대소문자·공백 허용 / 생략 시 normal', async () => {
  queue = [];
  calls = [];
  for (const mode of ['abc', 1, true, ['explore'], { m: 1 }, 'explorer']) {
    const r = await call('POST', v2({}, INGREDIENTS, { mode }));
    assert.equal(r.status, 400, `mode=${JSON.stringify(mode)}`);
    assert.ok(r.json.error.includes('mode'));
  }
  assert.equal(calls.length, 0);
  assert.equal(recipeLib.parseMode(' Explore '), 'explore');
  assert.equal(recipeLib.parseMode(undefined), 'normal');
  assert.equal(recipeLib.parseMode(''), 'normal');
  assert.equal(recipeLib.validateRecipeRequest(v2()).value.mode, 'normal');
  // explore 에서도 ingredients 가 배열이 아니면 400
  const r = await call('POST', v2({}, 'not-array', { mode: 'explore' }));
  assert.equal(r.status, 400);
});

test('(m6) 규칙 6: 재료당 최대 300ml (cupMl 500)', async () => {
  const ings = recipeLib.sanitizeIngredients(INGREDIENTS).ingredients;
  let n = recipeLib.normalizeRecipe({ ingredients: [{ pump: 2, ml: 450 }, { pump: 4, ml: 50 }] }, ings, { cupMl: 500, strength: 'none' });
  assert.ok(n.ok);
  assert.deepEqual(n.recipe.ingredients.map((i) => i.ml), [300, 50]);
  assert.equal(n.recipe.totalMl, 350);
  assert.ok(n.adjustments.some((a) => a.includes('300ml')));
  n = recipeLib.normalizeRecipe({ ingredients: [{ pump: 4, ml: 999 }] }, ings, { cupMl: 500, strength: 'none' });
  assert.deepEqual(n.recipe.ingredients, [{ pump: 4, name: '사이다', ml: 300 }]);
  // AI 응답 경로에서도 적용
  queue = [geminiJson({ ...GOOD_AI, ingredients: [{ pump: 2, name: '오렌지주스', ml: 400 }, { pump: 4, name: '사이다', ml: 100 }] })];
  const r = await call('POST', v2({ cupMl: 500 }));
  assert.equal(r.json.source, 'gemini');
  assert.ok(r.json.recipe.ingredients.every((i) => i.ml <= 300));
  assert.equal(r.json.recipe.ingredients[0].ml, 300);
  // 스키마에도 ml 최대 300
  const req = recipeLib.validateRecipeRequest(v2()).value;
  assert.equal(buildRecipeSchema(req).properties.ingredients.items.properties.ml.maximum, 300);
});

test('(m8) 규칙 8(capStrength): 무알콜 재료를 늘릴 때도 재료당 300ml·잔량을 넘지 않음', () => {
  const ings = recipeLib.sanitizeIngredients(INGREDIENTS).ingredients;
  // light, cupMl 500: 보드카 300 + 오렌지 200 → 24% → 5% 이하. 오렌지는 300ml 를 넘지 않게
  let f = recipeLib.finalizeRecipe({ ingredients: [{ pump: 1, ml: 300 }, { pump: 2, ml: 200 }] }, ings, { cupMl: 500, strength: 'light' });
  assert.ok(f.ok);
  assert.ok(f.recipe.estimatedAbv <= 5, `abv=${f.recipe.estimatedAbv}`);
  assert.ok(f.recipe.ingredients.every((i) => i.ml <= 300), JSON.stringify(f.recipe.ingredients));
  assert.equal(f.recipe.estimatedAbv, abvOf(f.recipe));
  // medium 상한 12%, strong 상한 20%
  for (const [strength, max] of [['medium', 12], ['strong', 20]]) {
    f = recipeLib.finalizeRecipe({ ingredients: [{ pump: 1, ml: 150 }, { pump: 4, ml: 50 }] }, ings, { cupMl: 200, strength });
    assert.ok(f.recipe.estimatedAbv <= max && f.recipe.estimatedAbv > max - 2, `${strength} abv=${f.recipe.estimatedAbv}`);
    assert.equal(f.recipe.totalMl, 200);
    assert.ok(f.adjustments.some((a) => a.includes(`최대 ${max}%`)));
  }
  // 상한 이하면 그대로
  f = recipeLib.finalizeRecipe({ ingredients: [{ pump: 1, ml: 20 }, { pump: 2, ml: 180 }] }, ings, { cupMl: 200, strength: 'light' });
  assert.deepEqual(f.recipe.ingredients.map((i) => i.ml), [20, 180]);
  assert.equal(f.recipe.estimatedAbv, 4);
});

test('(m9) 규칙 9: estimatedAbv·flavor.strength 재계산 (AI 값 무시, 경계값)', async () => {
  for (const [abv, lv] of [[0, 0], [0.1, 1], [5, 1], [5.1, 2], [10, 2], [10.1, 3], [15, 3], [15.1, 4], [20, 4], [20.1, 5]]) assert.equal(abvToStrengthLevel(abv), lv, `abv ${abv}`);
  // AI 가 estimatedAbv 0, strength 0 이라고 해도 실제 도수(보드카 30/200 = 6%)로 다시 계산
  queue = [geminiJson({ ...GOOD_AI, ingredients: [{ pump: 1, name: '보드카', ml: 30 }, { pump: 2, name: '오렌지주스', ml: 170 }], estimatedAbv: 0, flavor: { ...GOOD_AI.flavor, strength: 0 } })];
  let r = await call('POST', v2({ strength: 'medium' }));
  assert.equal(r.json.recipe.estimatedAbv, 6);
  assert.equal(r.json.recipe.flavor.strength, 2);
  // 도수 보정(규칙 8) 후에도 다시 계산: light 에 보드카 100/200(20%) → ≤5%, strength 1
  queue = [geminiJson({ ...GOOD_AI, ingredients: [{ pump: 1, name: '보드카', ml: 100 }, { pump: 2, name: '오렌지주스', ml: 100 }], estimatedAbv: 20, flavor: { ...GOOD_AI.flavor, strength: 5 } })];
  r = await call('POST', v2({ strength: 'light' }));
  assert.ok(r.json.recipe.estimatedAbv <= 5);
  assert.equal(r.json.recipe.estimatedAbv, abvOf(r.json.recipe));
  assert.equal(r.json.recipe.flavor.strength, 1);
});

test('(n) 결제 크레딧 소진(402 / "prepayment credits are depleted") → 재시도 없이 fallback(BILLING)', async () => {
  queue = [mockResponse(402, { error: { code: 402, message: 'Payment required', status: 'FAILED_PRECONDITION' } })];
  calls = [];
  let r = await call('POST', v2());
  assert.equal(calls.length, 1);
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'fallback');
  assert.equal(r.json.warningCode, 'BILLING');
  assert.ok(r.json.warning.includes('크레딧'));
  queue = [mockResponse(429, { error: { code: 429, message: 'Your prepayment credits are depleted. Please go to AI Studio to manage your billing.', status: 'RESOURCE_EXHAUSTED' } })];
  calls = [];
  r = await call('POST', v2());
  assert.equal(calls.length, 1, '크레딧 소진은 기다려도 안 풀리므로 재시도 안 함');
  assert.equal(r.json.warningCode, 'BILLING');
  // legacy 는 502
  queue = [mockResponse(402, { error: { code: 402, message: 'Payment required' } })];
  r = await call('POST', { prompt: '안녕' });
  assert.equal(r.status, 502);
  assert.ok(r.json.error.includes('크레딧'));
});

test('(o) 호환 모드 프롬프트에 explore 형식 포함 / 탐색 전용 스키마', () => {
  const req = recipeLib.validateRecipeRequest(v2({ strength: 'medium', adultVerified: true }, INGREDIENTS, { mode: 'explore' })).value;
  const p = buildUserPrompt(req, { includeFormat: true });
  assert.ok(p.includes('"explore":[{"addIngredient"'));
  const s = buildRecipeSchema(req);
  assert.equal(s.properties.explore.minItems, 1);
  assert.ok(s.properties.explore.items.properties.category.enum.includes('spirit'), 'medium + 성인 확인이면 술 재료 제안 가능');
  assert.equal(s.properties.explore.items.properties.abv.maximum, 100);
  const eo = buildExploreOnlySchema(req);
  assert.deepEqual(eo.required, ['explore']);
  const p2 = buildUserPrompt(req, { includeFormat: true, exploreOnly: true });
  assert.ok(p2.includes('recipe 는 만들지 말고') && !p2.includes('"ingredients":[{"pump"'));
});

// ───────── v2.1 리뷰 수정 회귀 테스트 (r1~r12) ─────────

const sanitize = (list) => recipeLib.sanitizeIngredients(list).ingredients;
const VODKA = INGREDIENTS[0];
const TRIPLE = { pump: 2, name: '트리플섹', category: 'liqueur', abv: 30, remainingMl: 650, notes: '' };
const MILK = { pump: 2, name: '우유', category: 'dairy', abv: 0, remainingMl: 900, notes: '' };
const CIDER = INGREDIENTS[3];
const capOf = (strength) => recipeLib.STRENGTH_ABV[strength].max;
/**
 * explore 카드 도수(%): 장착 재료는 장착 도수, addIngredient 는 카드 abv,
 * 그 밖의 미장착 재료는 프리셋 술 도수 / 술 이름이면 40 / 그 외 0 (uninstalledLineAbv — 앱 parseExplore 와 같은 규칙)
 */
function exploreAbv(e, ingredients) {
  const by = new Map(ingredients.map((i) => [nameKey(i.name), i]));
  const tot = e.ingredients.reduce((s, l) => s + l.ml, 0);
  const alc = e.ingredients.reduce((s, l) => {
    const abv = l.installed
      ? by.get(nameKey(l.name)).abv
      : nameKey(l.name) === nameKey(e.addIngredient)
        ? e.abv
        : uninstalledLineAbv(l.name);
    return s + l.ml * abv;
  }, 0);
  return alc / tot;
}
async function withoutKey(fn) {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    return await fn();
  } finally {
    process.env.GEMINI_API_KEY = saved;
  }
}

test('(r1) 규칙 8: 술만 장착 × light/medium/strong × cup 200/500 → NO_MIXER (normal 422·AI 미호출 / explore recipe:null)', async () => {
  const onlyAlc = sanitize([VODKA, TRIPLE]);
  for (const strength of ['light', 'medium', 'strong']) {
    for (const cupMl of [200, 500]) {
      const req = recipeLib.validateRecipeRequest(v2({ strength, cupMl }, onlyAlc, { history: [] })).value;
      // 규칙기반 원본(술 소량) / AI 원본(보드카 20 + 트리플섹 10) — 예전에는 규칙 4 가 cupMl 까지 불린 술이 그대로 나감
      for (const raw of [buildFallbackRecipe(req.user, onlyAlc, []), { ingredients: [{ pump: 1, ml: 20 }, { pump: 2, ml: 10 }] }]) {
        const f = recipeLib.finalizeRecipe(raw, onlyAlc, { cupMl, strength });
        assert.equal(f.ok, false, `${strength}/${cupMl}: ${JSON.stringify(f.recipe && f.recipe.ingredients)}`);
        assert.equal(f.code, 'NO_MIXER');
        assert.ok(f.error.includes(`최대 ${capOf(strength)}%`), f.error);
      }
      assert.equal(recipeLib.lacksMixer(onlyAlc, strength), true);
      queue = [];
      calls = [];
      let r = await call('POST', v2({ strength, cupMl }, onlyAlc));
      assert.equal(r.status, 422, JSON.stringify(r.json));
      assert.equal(calls.length, 0, 'AI 를 부르지 않음');
      assert.ok(r.json.error.includes('무알콜'), r.json.error);
      r = await withoutKey(() => call('POST', v2({ strength, cupMl }, onlyAlc, { mode: 'explore' })));
      assert.equal(r.status, 200);
      assert.equal(r.json.recipe, null);
      assert.ok(r.json.notice.includes('무알콜'), r.json.notice);
      assert.ok(r.json.explore.length >= 1 && r.json.explore.length <= 3);
      for (const e of r.json.explore) {
        assertExploreItem(e, onlyAlc, cupMl);
        assert.ok(exploreAbv(e, onlyAlc) <= capOf(strength) + 0.05, `${strength}/${cupMl} 카드 도수 ${exploreAbv(e, onlyAlc)}`);
      }
    }
  }
  // explore + 키 있음 → 탐색 전용 스키마로 AI 호출
  queue = [geminiJson({ explore: [exploreItem('탄산수', [exploreLine('보드카', 20, true), exploreLine('탄산수', 180)])] })];
  calls = [];
  const r = await call('POST', v2({ strength: 'light' }, onlyAlc, { mode: 'explore' }));
  assert.equal(r.json.source, 'gemini');
  assert.equal(r.json.recipe, null);
  assert.deepEqual(Object.keys(calls[0].body.generationConfig.responseJsonSchema.properties), ['explore']);
  // 상한 이하의 술(4.5%)이 있으면 미리 막지 않음 / 무알콜 요청은 해당 없음
  assert.equal(recipeLib.lacksMixer(sanitize([VODKA, { pump: 3, name: '맥주', category: 'wine', abv: 4.5 }]), 'light'), false);
  assert.equal(recipeLib.lacksMixer(onlyAlc, 'none'), false);
});

test('(r2) 규칙 8: 무알콜 재료 잔량 8ml(섞을 재료 기준 10ml 미달) → AI 레시피 NO_MIXER → 재요청 → fallback 도 상한 이하', async () => {
  const ings = sanitize([VODKA, { ...CIDER, remainingMl: 8 }]);
  const f = recipeLib.finalizeRecipe({ ingredients: [{ pump: 1, ml: 20 }] }, ings, { cupMl: 200, strength: 'light' });
  assert.equal(f.ok, false);
  assert.equal(f.code, 'NO_MIXER');
  assert.equal(recipeLib.lacksMixer(ings, 'light'), false, '무알콜 재료가 조금이라도 있으면 보정 단계에서 판단');
  const vodkaOnly = { ...GOOD_AI, ingredients: [{ pump: 1, name: '보드카', ml: 20 }] };
  queue = [geminiJson(vodkaOnly), geminiJson(vodkaOnly)];
  calls = [];
  const r = await call('POST', v2({ strength: 'light' }, ings));
  assert.equal(calls.length, 2, '검증 실패 → 1회 재요청');
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'fallback');
  assert.equal(r.json.warningCode, 'BAD_RESPONSE');
  assertRecipeShape(r.json.recipe);
  assert.ok(r.json.recipe.estimatedAbv <= 5, `abv=${r.json.recipe.estimatedAbv}`);
  assert.equal(r.json.recipe.estimatedAbv, abvOf(r.json.recipe, ings));
  assert.ok(r.json.recipe.ingredients.every((i) => i.pump !== 4 || i.ml <= 8), '사이다는 잔량 8ml 이내');
});

test('(r3) 성향의 알레르기·싫어하는 재료는 도수 보정(섞을 재료)에서도 다시 넣지 않음', async () => {
  const pref = '우유 알레르기가 있어요';
  const vm = sanitize([VODKA, MILK]);
  const ex = fallbackLib.preferenceExcludedPumps(vm, pref);
  assert.deepEqual([...ex], [2]);
  // 예전: [보드카 24, 우유 176]. 이제 우유는 0ml → 섞을 재료가 없어 NO_MIXER
  for (const raw of [{ ingredients: [{ pump: 1, ml: 30 }] }, { ingredients: [{ pump: 1, ml: 30 }, { pump: 2, ml: 170 }] }]) {
    const f = recipeLib.finalizeRecipe(raw, vm, { cupMl: 200, strength: 'light', excludePumps: ex });
    assert.equal(f.ok, false);
    assert.equal(f.code, 'NO_MIXER');
  }
  queue = [];
  calls = [];
  let r = await call('POST', v2({ strength: 'light', preference: pref }, vm));
  assert.equal(r.status, 422, JSON.stringify(r.json));
  assert.equal(calls.length, 0);
  r = await withoutKey(() => call('POST', v2({ strength: 'light', preference: pref }, vm)));
  assert.equal(r.status, 422);
  // 사이다도 있으면: AI 가 우유를 넣어도 빼고(규칙 1), 도수 보정에는 사이다를 씀
  const vmc = sanitize([VODKA, MILK, CIDER]);
  queue = [geminiJson({ ...GOOD_AI, ingredients: [{ pump: 1, name: '보드카', ml: 30 }, { pump: 2, name: '우유', ml: 170 }] })];
  r = await call('POST', v2({ strength: 'light', preference: pref }, vmc));
  assert.equal(r.json.source, 'gemini');
  assert.ok(!r.json.recipe.ingredients.some((i) => i.pump === 2), JSON.stringify(r.json.recipe.ingredients));
  assert.ok(r.json.recipe.ingredients.some((i) => i.pump === 4));
  assert.ok(r.json.recipe.estimatedAbv <= 5);
  assert.ok(r.json.adjustments.some((a) => a.includes('성향') && a.includes('우유')), r.json.adjustments.join(' / '));
  r = await withoutKey(() => call('POST', v2({ strength: 'light', preference: pref }, vmc)));
  assert.equal(r.json.source, 'fallback');
  assert.ok(!r.json.recipe.ingredients.some((i) => i.pump === 2));
  assert.ok(r.json.recipe.estimatedAbv <= 5);
  // '사이다는 빼 주세요' → 도수 보정에 사이다 대신 오렌지주스
  const ings = sanitize(INGREDIENTS);
  const f = recipeLib.finalizeRecipe({ ingredients: [{ pump: 1, ml: 100 }] }, ings, {
    cupMl: 200,
    strength: 'light',
    excludePumps: fallbackLib.preferenceExcludedPumps(ings, '사이다는 빼 주세요'),
  });
  assert.ok(f.ok);
  assert.deepEqual(f.recipe.ingredients.map((i) => i.pump), [1, 2]);
  // 무알콜인데 쓸 수 있는 무알콜 재료가 알레르기 재료뿐 → 422 (성향 안내)
  r = await call('POST', v2({ strength: 'none', preference: pref }, sanitize([MILK, { ...TRIPLE, pump: 3 }])));
  assert.equal(r.status, 422);
  assert.ok(r.json.error.includes('성향'), r.json.error);
});

const QUOTA_BODY = (delay) => ({
  error: {
    code: 429,
    message:
      'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay },
    ],
  },
});

test('(r4) 일반 429 ("…check your plan and billing details") → BILLING 이 아니라 RATE_LIMIT, 1회 재시도', async () => {
  assert.equal(gemini.classify({ status: 429, data: QUOTA_BODY('1s') }), 'RATE_LIMIT');
  assert.equal(
    gemini.classify({ status: 429, data: { error: { message: 'Your prepayment credits are depleted. Please go to AI Studio to manage your billing.' } } }),
    'BILLING'
  );
  queue = [mockResponse(429, QUOTA_BODY('1s')), geminiJson(GOOD_AI)];
  calls = [];
  let r = await call('POST', v2());
  assert.equal(calls.length, 2, 'RetryInfo 1s → 기다렸다가 재시도');
  assert.equal(r.json.source, 'gemini');
  queue = [mockResponse(429, QUOTA_BODY('0.01s')), mockResponse(429, QUOTA_BODY('0.01s'))];
  calls = [];
  r = await call('POST', v2());
  assert.equal(calls.length, 2);
  assert.equal(r.json.source, 'fallback');
  assert.equal(r.json.warningCode, 'RATE_LIMIT');
  assert.ok(!r.json.warning.includes('크레딧'), r.json.warning);
  queue = [mockResponse(429, QUOTA_BODY('0.01s')), mockResponse(429, QUOTA_BODY('0.01s'))];
  calls = [];
  r = await call('POST', { prompt: '안녕' });
  assert.equal(calls.length, 2);
  assert.equal(r.status, 429, 'legacy: 한도 초과는 429 (크레딧 소진 502 아님)');
});

test('(r5) explore·fallback 의 이름 비교도 SPEC §3.1 normName (기호 무시)', () => {
  const ings = sanitize([{ pump: 1, name: '오렌지주스', category: 'juice', abv: 0 }, { pump: 2, name: '진저-에일', category: 'soda', abv: 0 }]);
  const opts = { cupMl: 200, strength: 'none', mode: 'explore' };
  let n = normalizeExplore(
    [
      exploreItem('진저에일', [exploreLine('진저에일', 200)]),
      exploreItem('토닉워터', [exploreLine('토닉워터', 100), exploreLine('진저 에일', 50), exploreLine('진저에일', 50)]),
    ],
    ings,
    opts
  );
  assert.deepEqual(n.items.map((e) => e.addIngredient), ['토닉워터'], '이미 장착된 진저-에일 카드 제거');
  assert.deepEqual(n.items[0].ingredients, [
    { name: '토닉워터', ml: 100, installed: false },
    { name: '진저-에일', ml: 100, installed: true, pump: 2 },
  ]);
  // 레시피 규칙 1 매칭과 같은 판정
  const f = recipeLib.finalizeRecipe({ ingredients: [{ name: '진저에일', ml: 200 }] }, ings, { cupMl: 200, strength: 'none' });
  assert.equal(f.recipe.ingredients[0].pump, 2);
  // 'Ginger-Ale' ↔ 'ginger ale', '그레나딘-시럽' ↔ '그레나딘 시럽'
  const ings2 = sanitize([{ pump: 1, name: 'Ginger-Ale', category: 'soda', abv: 0 }, { pump: 2, name: '그레나딘-시럽', category: 'syrup', abv: 0 }]);
  n = normalizeExplore(
    [
      exploreItem('그레나딘 시럽', [exploreLine('그레나딘 시럽', 200)], { category: 'syrup' }),
      exploreItem('레몬즙', [exploreLine('레몬즙', 40), exploreLine('ginger ale', 160)], { category: 'juice' }),
    ],
    ings2,
    opts
  );
  assert.deepEqual(n.items.map((e) => e.addIngredient), ['레몬즙']);
  assert.deepEqual(n.items[0].ingredients[1], { name: 'Ginger-Ale', ml: 160, installed: true, pump: 1 });
  // fallback 후보 제외: '설탕-시럽'(other)·'토닉-워터' 장착 → '설탕시럽'·'토닉워터' 를 새로 권하지 않음
  const ings3 = sanitize([
    { pump: 1, name: '설탕-시럽', category: 'other', abv: 0 },
    { pump: 2, name: '토닉-워터', category: 'soda', abv: 0 },
    { pump: 3, name: '오렌지주스', category: 'juice', abv: 0 },
  ]);
  const u = recipeLib.validateRecipeRequest(v2({ strength: 'none', taste: { sweet: 4, sour: 0, bitter: 4, fizzy: 0 } }, ings3)).value.user;
  const list = buildFallbackExplore(u, ings3, [], { mode: 'explore' }).map((e) => e.addIngredient);
  assert.ok(list.length >= 1 && !list.includes('설탕시럽') && !list.includes('토닉워터'), JSON.stringify(list));
  // 거절 조합 비교 키도 같은 정규화
  assert.equal(comboKey(['진저-에일', '오렌지 주스']), comboKey(['진저에일', '오렌지주스']));
  assert.equal(nameKey('Ginger-Ale'), recipeLib.normName('ginger ale'));
});

test('(r6) 거절 조합 피하기는 최종 보정 결과로 판단 (규칙 8 이 뺀 재료를 다시 넣는 경우)', async () => {
  const rejected = comboKey(['보드카', '오렌지주스']);
  const vo = sanitize([VODKA, INGREDIENTS[1]]);
  const rej = { name: 'x', liked: false, rejected: true, ingredients: [{ name: '보드카', ml: 50 }, { name: '오렌지주스', ml: 150 }] };
  const r = await withoutKey(() => call('POST', v2({ strength: 'medium' }, vo, { history: [rej] })));
  assert.equal(r.status, 200);
  const combo = comboKey(r.json.recipe.ingredients.map((i) => i.name));
  const notes = r.json.recipe.suggestions.map((s) => s.message).join(' / ');
  assert.notEqual(combo, rejected, `예전: [보드카 59, 오렌지주스 141] + '다른 조합' 안내 → ${JSON.stringify(r.json.recipe.ingredients)}`);
  assert.ok(notes.includes('겹치지 않게'), notes);
  // 여러 장착·도수 조합: '다른 조합' 안내가 붙으면 최종 조합은 거절 조합과 다르고, 같으면 반드시 '새 조합이 없어' 안내
  const sets = [
    [VODKA, INGREDIENTS[1]],
    [VODKA, CIDER],
    [VODKA, INGREDIENTS[1], CIDER],
    [VODKA, INGREDIENTS[2]],
    [VODKA, { ...TRIPLE, pump: 5 }, INGREDIENTS[1]],
    INGREDIENTS,
    [INGREDIENTS[1], CIDER],
  ];
  let checked = 0;
  for (const set of sets) {
    const ings = sanitize(set);
    for (const strength of ['none', 'light', 'medium', 'strong']) {
      const user = recipeLib.validateRecipeRequest(v2({ strength }, ings)).value.user;
      const opts = { cupMl: 200, strength };
      const first = recipeLib.finalizeRecipe(buildFallbackRecipe(user, ings, []), ings, opts);
      if (!first.ok) continue;
      const firstKey = comboKey(first.recipe.ingredients.map((i) => i.name));
      const hist = [{ name: 'r', liked: false, rejected: true, ingredients: first.recipe.ingredients.map((i) => ({ name: i.name, ml: i.ml })) }];
      const second = recipeLib.finalizeRecipe(buildFallbackRecipe(user, ings, hist), ings, opts);
      if (!second.ok) continue;
      checked += 1;
      const key = comboKey(second.recipe.ingredients.map((i) => i.name));
      const msg = second.recipe.suggestions.map((s) => s.message).join(' / ');
      const label = `${strength} ${JSON.stringify(set.map((i) => i.name))}`;
      if (msg.includes('겹치지 않게')) assert.notEqual(key, firstKey, label);
      if (key === firstKey) assert.ok(msg.includes('새 조합이 없어'), `${label}: ${msg}`);
    }
  }
  assert.ok(checked >= 15, `checked=${checked}`);
});

test('(r7) 성향 문장: 부정 표현이 걸린 재료만 제외 (A 좋아요. B 싫어요)', () => {
  const ex = fallbackLib.excludedByPreference;
  const cases = [
    ['오렌지주스 정말 좋아해요. 탄산은 싫어요', '오렌지주스', false],
    ['오렌지주스 좋아요 탄산 싫어요', '오렌지주스', false],
    ['탄산수 좋아요, 우유는 싫어요', '탄산수', false],
    ['탄산수 좋아요, 우유는 싫어요', '우유', true],
    ['우유는 좋고 사이다는 싫어요', '우유', false],
    ['우유는 좋고 사이다는 싫어요', '사이다', true],
    ['우유는 좋지만 사이다는 별로예요', '사이다', true],
    ['우유, 사이다는 빼 주세요', '우유', true],
    ['우유, 사이다는 빼 주세요', '사이다', true],
    ['우유 알레르기가 있어요', '우유', true],
    ['알레르기: 우유, 땅콩', '우유', true],
    ['땅콩 알레르기 있는데 우유는 괜찮아요', '우유', false],
    ['우유는 안 좋아해요', '우유', true],
    ['우유 넣지 마세요', '우유', true],
    ['우유 넣어 주세요', '우유', false],
    ['사이다 빼고 오렌지주스 많이', '오렌지주스', false],
    ['사이다는 싫어요', '사이다', true],
    ['', '사이다', false],
  ];
  for (const [pref, name, want] of cases) assert.equal(ex({ name }, pref), want, `'${pref}' → ${name}`);
  // '탄산은 싫어요'(조사) → 탄산 0
  assert.equal(fallbackLib.desiredTaste({ preference: '탄산은 싫어요' }).d.fizzy, 0);
  assert.ok(fallbackLib.desiredTaste({ preference: '탄산수 좋아요, 우유는 싫어요' }).d.fizzy > 0);
  // fallback 레시피: 좋아한다는 오렌지주스는 남고 탄산(사이다)은 빠짐 (예전: [우유, 사이다])
  const soft = sanitize([INGREDIENTS[1], CIDER, { ...MILK, pump: 5 }]);
  const user = recipeLib.validateRecipeRequest(v2({ strength: 'none', preference: '오렌지주스 정말 좋아해요. 탄산은 싫어요' }, soft)).value.user;
  const raw = buildFallbackRecipe(user, soft, []);
  assert.ok(raw.ingredients.some((i) => i.name === '오렌지주스'), JSON.stringify(raw.ingredients));
  assert.ok(!raw.ingredients.some((i) => i.name === '사이다'), JSON.stringify(raw.ingredients));
  // explore: '탄산수 좋아요, 우유는 싫어요' + fizzy 4 → 1순위 탄산수 유지
  const noSoda = sanitize(INGREDIENTS.slice(0, 3));
  const u2 = recipeLib.validateRecipeRequest(v2({ strength: 'none', preference: '탄산수 좋아요, 우유는 싫어요', taste: { fizzy: 4 } }, noSoda)).value.user;
  assert.equal(buildFallbackExplore(u2, noSoda, [], { mode: 'explore' })[0].addIngredient, '탄산수');
});

test('(r8) 규칙 8 반올림 나머지: totalMl ≤ cupMl, cup 500 → Σ ≤ 500 (펌웨어 LIMIT 방지)', () => {
  const ings = sanitize(INGREDIENTS);
  // 예전: [60, 121.7, 26.4, 292] = 500.1
  const f = recipeLib.finalizeRecipe(
    { ingredients: [{ pump: 1, ml: 66 }, { pump: 2, ml: 120 }, { pump: 3, ml: 26 }, { pump: 4, ml: 288 }] },
    ings,
    { cupMl: 500, strength: 'light' }
  );
  assert.ok(f.ok);
  assert.equal(f.recipe.totalMl, 500);
  assert.ok(f.recipe.estimatedAbv <= 5);
  // 무작위(고정 시드, mulberry32) 3000건
  let seed = 7;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const CATS = [['spirit', 40], ['liqueur', 30], ['wine', 12], ['juice', 0], ['soda', 0], ['syrup', 0], ['water', 0]];
  let okCount = 0;
  for (let n = 0; n < 3000; n += 1) {
    const list = [];
    const k = 1 + Math.floor(rnd() * 5);
    for (let p = 1; p <= k; p += 1) {
      const [category, abv] = CATS[Math.floor(rnd() * CATS.length)];
      list.push({ pump: p, name: `재료${p}`, category, abv, remainingMl: rnd() < 0.3 ? Math.round(rnd() * 400) : null });
    }
    const ing = sanitize(list);
    const cupMl = [100, 200, 333, 450, 500][Math.floor(rnd() * 5)];
    const strength = ['light', 'medium', 'strong'][Math.floor(rnd() * 3)];
    const raw = { ingredients: ing.map((i) => ({ pump: i.pump, ml: Math.round(rnd() * 300) })) };
    const r = recipeLib.finalizeRecipe(raw, ing, { cupMl, strength });
    if (!r.ok) {
      assert.ok(['EMPTY_RECIPE', 'NO_MIXER'].includes(r.code), r.code);
      continue;
    }
    okCount += 1;
    const sum = Math.round(r.recipe.ingredients.reduce((s, i) => s + i.ml, 0) * 10) / 10;
    assert.equal(r.recipe.totalMl, sum);
    assert.ok(sum <= cupMl + 1e-9 && sum <= 500, `Σ ${sum} > cup ${cupMl}`);
    assert.ok(r.recipe.ingredients.every((i) => i.ml > 0 && i.ml <= 300));
    assert.ok(r.recipe.estimatedAbv <= capOf(strength), `${strength} abv ${r.recipe.estimatedAbv}`);
    // 규칙 9 재계산 (소수 1자리 반올림 — 9.15 같은 경계는 부동소수 오차가 있어 ±0.05 로 비교)
    const by = new Map(ing.map((i) => [i.pump, i]));
    const exact = r.recipe.ingredients.reduce((s, i) => s + i.ml * by.get(i.pump).abv, 0) / sum;
    assert.ok(Math.abs(r.recipe.estimatedAbv - exact) <= 0.05 + 1e-9, `abv ${r.recipe.estimatedAbv} vs ${exact}`);
  }
  assert.ok(okCount > 1500, `okCount=${okCount}`);
});

test('(r9) explore 카드: 300ml 로 자른 뒤에도 도수 상한 유지 (cup 500)', () => {
  const v = sanitize([VODKA]);
  for (const strength of ['light', 'medium']) {
    const n = normalizeExplore([exploreItem('탄산수', [exploreLine('보드카', 50, true), exploreLine('탄산수', 150)])], v, { cupMl: 500, strength, mode: 'normal' });
    assert.equal(n.items.length, 1);
    const e = n.items[0];
    assertExploreItem(e, v, 500);
    assert.ok(exploreAbv(e, v) <= capOf(strength), `${strength}: ${JSON.stringify(e.ingredients)} → ${exploreAbv(e, v)}%`);
  }
  // 트리플섹 30% + light + cup 500 의 fallback 카드 (예전: [트리플섹 66.7, 탄산수 300] = 5.46%)
  const t = sanitize([{ ...TRIPLE, pump: 1 }]);
  const u = recipeLib.validateRecipeRequest(v2({ strength: 'light', cupMl: 500 }, t)).value.user;
  const cards = normalizeExplore(buildFallbackExplore(u, t, [], { mode: 'explore' }), t, { cupMl: 500, strength: 'light', mode: 'explore' }).items;
  assert.ok(cards.length >= 1);
  for (const e of cards) {
    assertExploreItem(e, t, 500);
    assert.ok(exploreAbv(e, t) <= 5, `${JSON.stringify(e.ingredients)} → ${exploreAbv(e, t)}%`);
  }
});

test('(r10) 무알콜 요청: AI 의 술 추가 장착·대체 제안 제거', async () => {
  const sugg = [
    { type: 'add_ingredient', ingredient: '진', message: '진을 장착하면 진토닉을 만들 수 있어요.' },
    { type: 'add_ingredient', ingredient: '트리플섹', message: '트리플섹을 장착하면 오렌지 향이 살아나요.' },
    { type: 'substitute', ingredient: '레몬주스', message: '보드카 대신 레몬주스를 더 넣었어요.' },
    { type: 'substitute', pump: 1, message: '이 재료로 대신하세요.' },
    { type: 'add_ingredient', ingredient: '토닉워터', message: "토닉워터를 추가 장착하면 쌉싸름한 '진토닉 스타일'도 만들 수 있어요." },
    { type: 'info', message: '무알콜이라 보드카는 뺐어요.' },
  ];
  queue = [geminiJson({ ...GOOD_AI, suggestions: sugg })];
  let r = await call('POST', v2({ strength: 'none' }));
  const kept = r.json.recipe.suggestions.map((s) => s.ingredient || s.message);
  assert.deepEqual(kept, ['토닉워터', '무알콜이라 보드카는 뺐어요.'], JSON.stringify(r.json.recipe.suggestions));
  // 도수가 있는 요청 + 성인 확인(adultVerified:true)이면 그대로
  const vodkaAi = { ...GOOD_AI, ingredients: [{ pump: 1, name: '보드카', ml: 20 }, { pump: 2, name: '오렌지주스', ml: 180 }], suggestions: sugg };
  queue = [geminiJson(vodkaAi)];
  r = await call('POST', v2({ strength: 'light', adultVerified: true }));
  assert.ok(r.json.recipe.suggestions.some((s) => s.ingredient === '진'));
  assert.ok(r.json.recipe.suggestions.some((s) => s.ingredient === '트리플섹'));
  // 도수가 있어도 성인 확인 전(생략)이면 무알콜과 같은 판정으로 지움 (SPEC §3.2, 2026-11-07)
  queue = [geminiJson(vodkaAi)];
  r = await call('POST', v2({ strength: 'light' }));
  assert.deepEqual(r.json.recipe.suggestions.map((s) => s.ingredient || s.message), ['토닉워터', '무알콜이라 보드카는 뺐어요.']);
});

test('(r11) SPEC §5.4 후보 조건 정규식: 편안한 밤 → 우유 후보, 매실주스 장착 → 레몬즙 제외', () => {
  assert.ok(fallbackLib.RELAX_RE.test('편안한 밤'));
  assert.ok(fallbackLib.SOUR_NAME_RE.test('매실주스'));
  const base = sanitize(INGREDIENTS);
  const u = recipeLib.validateRecipeRequest(v2({ situation: '편안한 밤', taste: { sweet: 0, sour: 0, bitter: 0, fizzy: 0 } })).value.user;
  const list = buildFallbackExplore(u, base, [], { mode: 'explore' }).map((e) => e.addIngredient);
  assert.ok(list.includes('우유'), JSON.stringify(list));
  const plum = sanitize([{ pump: 1, name: '매실주스', category: 'juice', abv: 0 }, { pump: 2, name: '사이다', category: 'soda', abv: 0 }]);
  const u2 = recipeLib.validateRecipeRequest(v2({ strength: 'none', taste: { sweet: 2, sour: 4, bitter: 0, fizzy: 2 } }, plum)).value.user;
  const list2 = buildFallbackExplore(u2, plum, [], { mode: 'explore' }).map((e) => e.addIngredient);
  assert.ok(list2.length >= 1 && !list2.includes('레몬즙'), JSON.stringify(list2));
});

test('(r12) Gemini 재시도 전체 한도(20초) + 여유 < 앱 서버 대기(SERVER_TIMEOUT_MS 50초), 최악의 경우에도 한도 안에 응답', async () => {
  const d = DEFAULT_SETTINGS;
  assert.equal(d.timeoutMs, 14000, 'SPEC §3.1: 1회 14초');
  assert.equal(d.totalBudgetMs, 20000, 'SPEC §3.1: 재시도 포함 20초');
  assert.ok(d.totalBudgetMs + SERVER_MARGIN_MS < APP_SERVER_TIMEOUT_MS, `서버 ${d.totalBudgetMs}ms + 여유 ${SERVER_MARGIN_MS}ms ≥ 앱 ${APP_SERVER_TIMEOUT_MS}ms`);
  assert.ok(d.timeoutMs <= d.totalBudgetMs && d.minAttemptMs < d.timeoutMs);
  assert.ok(d.totalBudgetMs + SERVER_MARGIN_MS < 60000, 'vercel.json maxDuration 60초');
  // 1/100 로 줄인 설정으로 최악 경로 측정: 첫 응답이 타임아웃 직전에 (불량 / 503) → 재시도는 남은 시간 안에서 끊김
  const saved = { ...gemini.settings };
  const scale = 100;
  Object.assign(gemini.settings, {
    timeoutMs: d.timeoutMs / scale,
    totalBudgetMs: d.totalBudgetMs / scale,
    minAttemptMs: d.minAttemptMs / scale,
    retryDelayMs: d.retryDelayMs / scale,
  });
  const delayed = (ms, make) => (url, opts) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(make()), ms);
      opts.signal.addEventListener('abort', () => {
        clearTimeout(t);
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
  try {
    const badAi = { ...GOOD_AI, ingredients: [{ pump: 8, name: '럼', ml: 200 }] };
    const near = d.timeoutMs / scale - 5;
    for (const first of [delayed(near, () => geminiJson(badAi)), delayed(near, () => geminiError(503))]) {
      queue = [first, hang, hang];
      calls = [];
      const t0 = Date.now();
      const r = await call('POST', v2());
      const took = Date.now() - t0;
      assert.equal(r.json.source, 'fallback');
      assert.equal(calls.length, 2);
      assert.ok(took <= d.totalBudgetMs / scale + 60, `took ${took}ms > ${d.totalBudgetMs / scale}ms`);
    }
  } finally {
    Object.assign(gemini.settings, saved);
  }
});

// ───────── v2.1 교차검증: user.adultVerified (SPEC §3.1 · §5.4) ─────────

/** 성인 확인 전 explore 카드: 술을 새로 장착하라는 항목이 없어야 함 */
function assertNoAlcoholMount(list) {
  for (const e of list) {
    assert.equal(e.abv, 0, `술 장착 제안: ${e.addIngredient}`);
    assert.ok(!['spirit', 'liqueur', 'wine'].includes(e.category), `술 종류: ${e.addIngredient}/${e.category}`);
    for (const l of e.ingredients) assert.ok(l.installed || !looksAlcoholic(l.name), `미장착 술 줄: ${l.name}`);
  }
}
const NO_SPIRIT = [
  { pump: 1, name: '사이다', category: 'soda', abv: 0, remainingMl: 1000, notes: '' },
  { pump: 2, name: '레몬주스', category: 'juice', abv: 0, remainingMl: 500, notes: '' },
  { pump: 3, name: '오렌지주스', category: 'juice', abv: 0, remainingMl: 900, notes: '' },
  { pump: 4, name: '그레나딘', category: 'syrup', abv: 0, remainingMl: 500, notes: '' },
];
const NO_FIT_TASTE = { sweet: 3, sour: 2, bitter: 0, fizzy: 3 }; // NO_SPIRIT 에서 조건 맞는 무알콜 후보 없음
const aiAlcExplore = () => [
  exploreItem('진', [exploreLine('진', 40), exploreLine('토닉워터', 160)], { category: 'spirit', abv: 40 }),
  exploreItem('트리플섹', [exploreLine('트리플섹', 30), exploreLine('탄산수', 170)], { category: 'liqueur', abv: 30 }),
];

test('(s1) adultVerified 파싱: === true 일 때만 true, 그 외·생략·잘못된 타입은 false (400 아님)', async () => {
  const parse = (u) => recipeLib.validateRecipeRequest(v2(u));
  for (const [val, want] of [[true, true], [false, false], [undefined, false], [null, false], ['true', false], [1, false], [{}, false], [[true], false]]) {
    const r = parse(val === undefined ? {} : { adultVerified: val });
    assert.equal(r.ok, true, `adultVerified=${JSON.stringify(val)} → 400 이면 안 됨`);
    assert.equal(r.value.user.adultVerified, want, `adultVerified=${JSON.stringify(val)}`);
  }
  // user 생략 → false
  assert.equal(recipeLib.validateRecipeRequest({ version: 2, ingredients: INGREDIENTS }).value.user.adultVerified, false);
  // 서버 전체 경로: 문자열 "yes" 여도 200 (키 없음 → fallback)
  await withoutKey(async () => {
    const r = await call('POST', v2({ adultVerified: 'yes', strength: 'light' }, NO_SPIRIT, { mode: 'explore' }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assertNoAlcoholMount(r.json.explore);
  });
});

test('(s2) fallback 후보(SPEC §5.4 표): 진·보드카·화이트 럼 / 트리플섹 은 adultVerified 일 때만, 채우기·안전장치에서도 술 제외', () => {
  const ings = sanitize(NO_SPIRIT);
  // user 정리 결과는 mode 와 무관 → 빈 기기도 검증되도록 explore 로 검증
  const userOf = (u, list = ings) => recipeLib.validateRecipeRequest(v2(u, list, { mode: 'explore' })).value.user;
  const names = (u, mode = 'explore', list = ings) =>
    normalizeExplore(buildFallbackExplore(userOf(u, list), list, [], { mode }), list, { ...userOf(u, list), mode }).items;
  for (const strength of ['light', 'medium', 'strong']) {
    assert.deepEqual(names({ strength, adultVerified: true, taste: NO_FIT_TASTE }).map((e) => e.addIngredient), ['진', '트리플섹'], strength);
    const minor = names({ strength, taste: NO_FIT_TASTE });
    assert.deepEqual(minor.map((e) => e.addIngredient), ['탄산수', '레몬즙', '설탕시럽'], `${strength}: 조건 0개 → 채우기`);
    assertNoAlcoholMount(minor);
  }
  // '진' 이 거절 기록에 2번 나오면 보드카 (성인 확인 시) — 한 후보 안에서 제외되지 않은 첫 번째
  const rejGin = [1, 2].map((k) => ({ name: `r${k}`, liked: false, rejected: true, ingredients: [{ name: '진', ml: 40 }, { name: '사이다', ml: 160 }] }));
  const uGin = userOf({ strength: 'light', adultVerified: true, taste: NO_FIT_TASTE });
  assert.equal(buildFallbackExplore(uGin, ings, rejGin, { mode: 'explore' })[0].addIngredient, '보드카');
  // 안전장치: 무알콜 후보 7개를 모두 성향으로 빼면 성인 확인 전에는 술로 채우지 않음(빈 목록), 성인 확인이면 술 후보
  const hateAll = '탄산수 싫어요. 토닉워터 싫어요. 레몬즙 싫어요. 설탕시럽 싫어요. 그레나딘 시럽 싫어요. 크랜베리주스 싫어요. 우유 싫어요.';
  const raw = buildFallbackExplore(userOf({ strength: 'light', taste: NO_FIT_TASTE, preference: hateAll }), ings, [], { mode: 'explore' });
  assert.deepEqual(raw, [], '성인 확인 전 → 술 후보로 채우지 않음');
  const rawAdult = buildFallbackExplore(userOf({ strength: 'light', adultVerified: true, taste: NO_FIT_TASTE, preference: hateAll }), ings, [], { mode: 'explore' });
  assert.ok(rawAdult.length >= 1 && rawAdult.every((e) => e.abv > 0));
  // 빈 기기 · 술만 장착(NO_MIXER) · 기본 기기 × 도수 × 모드: 성인 확인 전 fallback 은 술 장착 제안 없음
  for (const list of [[], sanitize([VODKA]), sanitize(INGREDIENTS), ings]) {
    for (const strength of ['none', 'light', 'medium', 'strong']) {
      for (const mode of ['normal', 'explore']) {
        const items = names({ strength, taste: { sweet: 1, sour: 1, bitter: 4, fizzy: 0 } }, mode, list);
        assertNoAlcoholMount(items);
        if (mode === 'explore') assert.ok(items.length >= 1, `${list.length}개 장착 ${strength}: explore 1개 이상`);
      }
    }
  }
});

test('(s3) normalizeExplore: 성인 확인 전이면 술 장착 항목 제거 (abv>0 · 술 종류 · 미장착 술 이름) — 장착된 술은 허용', () => {
  const ings = sanitize(INGREDIENTS); // 보드카(1) 장착
  const list = [
    exploreItem('진', [exploreLine('진', 40), exploreLine('사이다', 160, true)], { category: 'spirit', abv: 40 }), // abv>0
    exploreItem('깔루아', [exploreLine('깔루아', 30), exploreLine('오렌지주스', 170, true)], { category: 'liqueur', abv: 0 }), // 종류
    exploreItem('트리플섹', [exploreLine('트리플섹', 30), exploreLine('사이다', 170, true)], { category: 'soda', abv: 0 }), // 이름
    exploreItem('탄산수', [exploreLine('화이트 럼', 30), exploreLine('탄산수', 170)]), // 미장착 술 줄(이름)
    exploreItem('토닉워터', [exploreLine('보드카', 10, false), exploreLine('토닉워터', 190)]), // 보드카는 장착됨 → installed:true 로 재계산 → 허용
    exploreItem('그레나딘 시럽', [exploreLine('그레나딘 시럽', 20), exploreLine('사이다', 180, true)], { category: 'syrup' }),
  ];
  const opts = { cupMl: 200, strength: 'light', mode: 'explore' };
  let n = normalizeExplore(list, ings, opts); // adultVerified 생략 = false
  assert.deepEqual(n.items.map((e) => e.addIngredient), ['토닉워터', '그레나딘 시럽']);
  assert.equal(n.removedAdult, 4);
  assert.equal(n.items[0].ingredients.find((l) => l.name === '보드카').installed, true);
  assertNoAlcoholMount(n.items);
  for (const bad of ['true', 1, null]) assert.equal(normalizeExplore(list, ings, { ...opts, adultVerified: bad }).removedAdult, 4, `adultVerified=${bad}`);
  // 성인 확인 → 술 제안 유지(도수 상한만 적용), removedAdult 0
  n = normalizeExplore(list, ings, { ...opts, adultVerified: true });
  assert.deepEqual(n.items.map((e) => e.addIngredient), ['진', '깔루아', '트리플섹']);
  assert.equal(n.removedAdult, 0);
  for (const e of n.items) assert.ok(exploreAbv(e, ings) <= capOf('light') + 0.05);
  // 무알콜 + 성인 확인 전: 무알콜 규칙이 미장착 술 줄을 먼저 빼므로 '탄산수' 카드는 술 없이 남음 (카드를 버리지 않으니 removedAdult 에는 안 셈)
  // 무알콜 규칙으로 버린 술 카드 3개(진·깔루아·트리플섹)는 성인 확인 전 요청이라 removedAdult 에 셈
  // → 0개가 되면 AI 재호출 없이 규칙기반으로 채우는 근거 (README 5번 explore 보정 6, (t8) 참고)
  n = normalizeExplore(list, ings, { ...opts, strength: 'none' });
  assert.deepEqual(n.items.map((e) => e.addIngredient), ['탄산수', '토닉워터', '그레나딘 시럽']);
  assert.deepEqual(n.items[0].ingredients, [{ name: '탄산수', ml: 200, installed: false }]);
  assert.equal(n.removedAdult, 3);
  // 무알콜 + 성인 확인: 같은 카드를 버리지만 성인 확인 전 때문이 아니므로 0
  assert.equal(normalizeExplore(list, ings, { ...opts, strength: 'none', adultVerified: true }).removedAdult, 0);
});

test('(s4) AI explore: 성인 확인 전 술 항목 제거 → 0개면 규칙기반 후보로 채움 (normal · explore · 빈 기기 recipe:null), AI 재호출 없음', async () => {
  // explore 모드 + 레시피 있음
  queue = [geminiJson({ ...GOOD_AI, explore: aiAlcExplore() })];
  calls = [];
  let r = await call('POST', v2({ strength: 'light', taste: NO_FIT_TASTE }, NO_SPIRIT, { mode: 'explore' }));
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'gemini');
  assert.equal(calls.length, 1, '재요청 없음');
  assert.ok(r.json.recipe);
  assert.deepEqual(r.json.explore.map((e) => e.addIngredient), ['탄산수', '레몬즙', '설탕시럽']);
  assertNoAlcoholMount(r.json.explore);
  for (const e of r.json.explore) assertExploreItem(e, NO_SPIRIT);
  // 프롬프트에 성인 확인 전 안내 + 스키마에서 술 종류·도수 차단
  const body = calls[0].body;
  assert.ok(body.contents[0].parts[0].text.includes('성인 확인 전'));
  const sx = body.generationConfig.responseJsonSchema.properties.explore.items.properties;
  assert.equal(sx.abv.maximum, 0);
  assert.ok(!sx.category.enum.some((c) => ['spirit', 'liqueur', 'wine'].includes(c)));
  // 술 항목 + 무알콜 항목이 섞여 있으면 남은 것만 (채우지 않음 — 0개일 때만)
  queue = [geminiJson({ ...GOOD_AI, explore: [...aiAlcExplore(), exploreItem('진저에일', [exploreLine('진저에일', 150), exploreLine('오렌지주스', 50, true)])] })];
  r = await call('POST', v2({ strength: 'light', taste: NO_FIT_TASTE }, NO_SPIRIT, { mode: 'explore' }));
  assert.deepEqual(r.json.explore.map((e) => e.addIngredient), ['진저에일']);
  // normal 모드: AI 의 1개가 술이라 0개 → 규칙기반 1개
  queue = [geminiJson({ ...GOOD_AI, explore: aiAlcExplore().slice(0, 1) })];
  r = await call('POST', v2({ strength: 'light', taste: NO_FIT_TASTE }, NO_SPIRIT));
  assert.equal(r.json.source, 'gemini');
  assert.deepEqual(r.json.explore.map((e) => e.addIngredient), ['탄산수']);
  // 빈 기기 explore(recipe:null): AI 가 술만 권해도 explore 가 0개가 되지 않음
  for (const adultVerified of [undefined, false, 'true']) {
    queue = [geminiJson({ explore: aiAlcExplore() })];
    calls = [];
    r = await call('POST', v2({ strength: 'medium', adultVerified }, [], { mode: 'explore' }));
    assert.equal(r.status, 200);
    assert.equal(r.json.source, 'gemini');
    assert.equal(r.json.recipe, null);
    assert.equal(calls.length, 1);
    assert.equal(typeof r.json.notice, 'string');
    assert.ok(r.json.explore.length >= 1 && r.json.explore.length <= 3, JSON.stringify(r.json.explore));
    assertNoAlcoholMount(r.json.explore);
    for (const e of r.json.explore) assertExploreItem(e, []);
  }
  // 술만 장착(NO_MIXER → recipe:null) + 성인 확인 전 → 무알콜 탐색만
  queue = [geminiJson({ explore: aiAlcExplore() })];
  r = await call('POST', v2({ strength: 'light' }, [VODKA], { mode: 'explore' }));
  assert.equal(r.json.recipe, null);
  assert.ok(r.json.explore.length >= 1);
  assertNoAlcoholMount(r.json.explore);
  // 성인 확인(true) → AI 의 술 항목 그대로 (도수 상한 보정만)
  queue = [geminiJson({ ...GOOD_AI, explore: aiAlcExplore() })];
  calls = [];
  r = await call('POST', v2({ strength: 'light', adultVerified: true, taste: NO_FIT_TASTE }, NO_SPIRIT, { mode: 'explore' }));
  assert.deepEqual(r.json.explore.map((e) => e.addIngredient), ['진', '트리플섹']);
  assert.ok(!calls[0].body.contents[0].parts[0].text.includes('성인 확인 전'));
  assert.equal(calls[0].body.generationConfig.responseJsonSchema.properties.explore.items.properties.abv.maximum, 100);
  for (const e of r.json.explore) assert.ok(exploreAbv(e, NO_SPIRIT) <= capOf('light') + 0.05);
});

test('(s5) fallback 응답(키 없음·AI 실패)도 adultVerified 반영 (SPEC §5.4)', async () => {
  await withoutKey(async () => {
    let r = await call('POST', v2({ strength: 'light', taste: NO_FIT_TASTE }, NO_SPIRIT, { mode: 'explore' }));
    assert.equal(r.json.source, 'fallback');
    assert.deepEqual(r.json.explore.map((e) => e.addIngredient), ['탄산수', '레몬즙', '설탕시럽']);
    r = await call('POST', v2({ strength: 'light', adultVerified: true, taste: NO_FIT_TASTE }, NO_SPIRIT, { mode: 'explore' }));
    assert.deepEqual(r.json.explore.map((e) => e.addIngredient), ['진', '트리플섹']);
    for (const strength of ['light', 'strong']) {
      r = await call('POST', v2({ strength }, [], { mode: 'explore' }));
      assert.equal(r.json.recipe, null);
      assert.ok(r.json.explore.length >= 1);
      assertNoAlcoholMount(r.json.explore);
    }
  });
  // AI 실패(500 ×2) → fallback 도 같은 규칙
  queue = [geminiError(500), geminiError(500)];
  const r = await call('POST', v2({ strength: 'medium', taste: NO_FIT_TASTE }, NO_SPIRIT));
  assert.equal(r.json.warningCode, 'UPSTREAM');
  assert.deepEqual(r.json.explore.map((e) => e.addIngredient), ['탄산수']);
});

test('(s6) 프롬프트·스키마: 성인 확인 전이면 "술 장착 제안 금지" 한 줄 + explore 스키마에서 술 종류·도수 차단', () => {
  const reqOf = (u, ings = INGREDIENTS, extra = {}) => recipeLib.validateRecipeRequest(v2(u, ings, extra)).value;
  const minor = reqOf({ strength: 'strong' }, INGREDIENTS, { mode: 'explore' });
  const p = buildUserPrompt(minor);
  assert.equal(p.split('\n').filter((l) => l.includes('성인 확인 전')).length, 1, '한 줄');
  assert.ok(/성인 확인 전.*술\(증류주·리큐르·와인/.test(p));
  for (const schema of [buildRecipeSchema(minor), buildExploreOnlySchema(minor)]) {
    const it = schema.properties.explore.items.properties;
    assert.equal(it.abv.maximum, 0);
    assert.deepEqual(it.category.enum, ['syrup', 'juice', 'soda', 'dairy', 'water', 'other']);
  }
  const adult = reqOf({ strength: 'strong', adultVerified: true }, INGREDIENTS, { mode: 'explore' });
  assert.ok(!buildUserPrompt(adult).includes('성인 확인 전'));
  assert.ok(buildRecipeSchema(adult).properties.explore.items.properties.category.enum.includes('liqueur'));
  // 무알콜이면 성인 확인과 상관없이 술 차단(기존 규칙)
  const softAdult = reqOf({ strength: 'none', adultVerified: true });
  assert.equal(buildRecipeSchema(softAdult).properties.explore.items.properties.abv.maximum, 0);
});

// ───────── v2.1 마무리 (2026-11-07): 성인 확인 전 suggestions · NO_MIXER explore 카드 (SPEC §3.2 · §3.3-8) ─────────

const exploreLib = require('../lib/explore');
const { addsSoftIngredient, filterNoMixerExplore } = exploreLib;

/** handler 를 직접 지정해 부르는 call() (stub 으로 다시 불러온 api/index.js 용) */
async function callWith(h, method, body) {
  const req = { method, headers: { 'content-type': 'application/json' }, body };
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(b) {
      this.body = b;
      this.ended = true;
    },
  };
  await h(req, res);
  assert.ok(res.ended, 'res.end() 가 호출되어야 함');
  if (res.body) allBodies.push(String(res.body));
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}
/**
 * lib/fallback 의 함수를 잠시 바꾼 api/index.js 로 fn(callStub) 실행 (require 캐시 사용, 끝나면 원래대로).
 * api/index.js 는 불러올 때 fallback 함수를 구조분해하므로 캐시를 지우고 다시 불러야 바뀐 함수를 씀.
 */
async function withFallbackStub(makeOverrides, fn) {
  const fbPath = require.resolve('../lib/fallback');
  const apiPath = require.resolve('../api/index.js');
  const orig = require.cache[fbPath].exports;
  const origApi = require.cache[apiPath];
  require.cache[fbPath].exports = { ...orig, ...makeOverrides(orig) };
  delete require.cache[apiPath];
  try {
    const h = require('../api/index.js');
    return await fn((method, body) => callWith(h, method, body));
  } finally {
    require.cache[fbPath].exports = orig;
    require.cache[apiPath] = origApi;
  }
}
/** 술(이름·장착된 술·문구)을 장착·대체하라는 제안 목록 — SPEC §3.2 판정 예시 */
const ALC_SUGG = [
  { type: 'add_ingredient', ingredient: '진', message: '진을 장착하면 진토닉을 만들 수 있어요.' }, // 술 이름
  { type: 'substitute', ingredient: '레몬주스', message: '보드카 대신 레몬주스를 더 넣었어요.' }, // 문구에 술 이름
  { type: 'substitute', pump: 1, message: '이 재료로 대신하세요.' }, // 장착된 술 펌프
  { type: 'add_ingredient', ingredient: '토닉워터', message: "토닉워터를 추가 장착하면 쌉싸름한 '진토닉 스타일'도 만들 수 있어요." }, // 무알콜 → 유지
  { type: 'info', message: '보드카는 천천히 즐기세요.' }, // info 는 판정 대상 아님 → 유지
];
/** NO_MIXER 판정 예시 카드 — 술만 새로 더함(이름·category) */
const ALC_ONLY_CARDS = () => [
  // addIngredient 가 술 + 다른 미장착 줄도 술 이름(화이트 럼 = 프리셋 도수 40%) → 무알콜 줄이 없어 light~strong 도수 상한을
  // 못 맞춤 → normalizeExplore 단계에서 버려짐(removedNoMixer). NO_MIXER 탐색 전용이면 이것도 '술만 더하는 카드'로 셈
  exploreItem('데킬라', [exploreLine('데킬라', 30), exploreLine('보드카', 20, true), exploreLine('화이트 럼', 150)], { category: 'spirit', abv: 40 }),
  // category 가 liqueur·이름도 술(오렌지 큐라소)이지만 abv 0 으로 옴 → 도수 계산에서는 무알콜 줄로 보여 normalizeExplore 는 통과,
  // filterNoMixerExplore 가 버림
  exploreItem('오렌지 큐라소', [exploreLine('오렌지 큐라소', 150), exploreLine('보드카', 50, true)], { category: 'liqueur', abv: 0 }),
];

test('(t1) isAlcoholSuggestion · sanitizeSuggestions: 성인 확인 전이면 strength=none 과 같은 판정으로 술 장착·대체 제안 제거 (SPEC §3.2)', () => {
  const ings = sanitize([...INGREDIENTS, { pump: 5, name: '매실주', category: 'wine', abv: 14 }]);
  const byPump = new Map(ings.map((i) => [i.pump, i]));
  const isAlc = (s) => recipeLib.isAlcoholSuggestion(s, ings, byPump);
  // 판정 (a) 이름이 술 / 장착된 술(이름 목록에 없어도 normName 일치) (b) 장착된 술 펌프 (c) 문구에 술 이름
  assert.equal(isAlc({ type: 'add_ingredient', ingredient: '트리플섹', message: '장착해 보세요' }), true);
  assert.equal(isAlc({ type: 'substitute', ingredient: '매 실주', message: '대신 써요' }), true);
  assert.equal(isAlc({ type: 'substitute', pump: 5, message: '이 재료로 대신해요' }), true);
  assert.equal(isAlc({ type: 'add_ingredient', ingredient: '토닉워터', message: '보드카와 잘 어울려요' }), true);
  assert.equal(isAlc({ type: 'add_ingredient', ingredient: '토닉워터', message: '청량하게' }), false);
  assert.equal(isAlc({ type: 'info', ingredient: '진', message: '진' }), false, 'info 는 대상 아님');
  assert.equal(isAlc({ type: 'low_stock', pump: 1, message: '보드카 부족' }), false, 'low_stock 은 대상 아님');
  assert.equal(recipeLib.blocksAlcoholSuggestions('light', true), false);
  for (const [s, a] of [['none', true], ['light', false], ['light', undefined], ['strong', 'true'], ['medium', 1]]) {
    assert.equal(recipeLib.blocksAlcoholSuggestions(s, a), true, `${s}/${a}`);
  }
  const kept = (strength, adult) =>
    recipeLib.sanitizeSuggestions(ALC_SUGG, ings, byPump, strength, adult).map((s) => s.ingredient || s.message);
  const soft = ['토닉워터', '보드카는 천천히 즐기세요.'];
  for (const strength of ['none', 'light', 'medium', 'strong']) {
    assert.deepEqual(kept(strength), soft, `${strength}: adultVerified 생략 = 성인 확인 전`);
    assert.deepEqual(kept(strength, false), soft);
    assert.deepEqual(kept(strength, 'true'), soft, '=== true 일 때만 성인 확인');
  }
  assert.deepEqual(kept('none', true), soft, '무알콜은 성인 확인과 상관없이 제거');
  assert.equal(kept('light', true).length, ALC_SUGG.length, '성인 확인 + 도수 있음 → 모두 유지');
  // normalizeRecipe / finalizeRecipe 의 opts.adultVerified (=== true 일 때만)
  const raw = { ingredients: [{ pump: 1, ml: 20 }, { pump: 2, ml: 180 }], suggestions: ALC_SUGG };
  for (const adultVerified of [undefined, false, 'true', 1]) {
    const f = recipeLib.finalizeRecipe(raw, ings, { cupMl: 200, strength: 'light', adultVerified });
    assert.ok(f.ok);
    assert.deepEqual(f.recipe.suggestions.map((s) => s.ingredient || s.message), soft, `adultVerified=${adultVerified}`);
  }
  const fa = recipeLib.finalizeRecipe(raw, ings, { cupMl: 200, strength: 'light', adultVerified: true });
  assert.equal(fa.recipe.suggestions.length, ALC_SUGG.length);
});

test('(t2) 성인 확인 전 suggestions: AI 응답·fallback 레시피 모두 술 장착·대체 제안 제거, 규칙기반 info 문구도 술 장착을 권하지 않음', async () => {
  const vodkaAi = { ...GOOD_AI, ingredients: [{ pump: 1, name: '보드카', ml: 20 }, { pump: 2, name: '오렌지주스', ml: 180 }], suggestions: ALC_SUGG };
  // AI: normal · explore 모드 × 성인 확인 여부
  for (const mode of ['normal', 'explore']) {
    for (const [adultVerified, n] of [[undefined, 2], [false, 2], ['true', 2], [true, ALC_SUGG.length]]) {
      queue = [geminiJson(vodkaAi)];
      const r = await call('POST', v2({ strength: 'medium', adultVerified }, INGREDIENTS, { mode }));
      assert.equal(r.json.source, 'gemini');
      assert.equal(r.json.recipe.suggestions.length, n, `${mode}/${adultVerified}: ${JSON.stringify(r.json.recipe.suggestions)}`);
    }
  }
  // fallback 레시피(키 없음): 규칙기반 원본에 술 제안이 섞여 있어도 서버가 finalizeRecipe(adultVerified) 로 지움
  await withFallbackStub(
    (orig) => ({
      buildFallbackRecipe: (...a) => {
        const raw = orig.buildFallbackRecipe(...a);
        if (raw) raw.suggestions = [...ALC_SUGG, ...raw.suggestions];
        return raw;
      },
    }),
    async (callStub) => {
      await withoutKey(async () => {
        let r = await callStub('POST', v2({ strength: 'light' }));
        assert.equal(r.json.source, 'fallback');
        const msgs = r.json.recipe.suggestions.map((s) => s.ingredient || s.message);
        assert.ok(!msgs.some((m) => ['진', '레몬주스', '이 재료로 대신하세요.'].includes(m)), JSON.stringify(msgs));
        assert.ok(msgs.includes('토닉워터') && msgs.includes('보드카는 천천히 즐기세요.'), JSON.stringify(msgs));
        r = await callStub('POST', v2({ strength: 'light', adultVerified: true }));
        const adultMsgs = r.json.recipe.suggestions.map((s) => s.ingredient || s.message);
        assert.ok(adultMsgs.includes('진') && adultMsgs.includes('레몬주스'), JSON.stringify(adultMsgs));
      });
    }
  );
  // 규칙기반 info: 도수를 골랐는데 장착된 술이 없음 → 성인 확인 전이면 앞 문장까지만
  assert.equal(fallbackLib.NO_ALCOHOL_INFO, '장착된 주류가 없어 무알콜로 만들었어요.');
  assert.equal(fallbackLib.NO_ALCOHOL_INFO_ADULT, '장착된 주류가 없어 무알콜로 만들었어요. 보드카·럼 같은 술을 장착하면 칵테일도 만들 수 있어요.');
  const soft = sanitize(INGREDIENTS.slice(1));
  const infoOf = (u) =>
    buildFallbackRecipe(recipeLib.validateRecipeRequest(v2(u, soft)).value.user, soft, []).suggestions.filter((s) => s.message.startsWith('장착된 주류가'));
  for (const adultVerified of [undefined, false, 'true']) {
    assert.deepEqual(infoOf({ strength: 'light', adultVerified }).map((s) => s.message), ['장착된 주류가 없어 무알콜로 만들었어요.'], `${adultVerified}`);
  }
  assert.deepEqual(infoOf({ strength: 'light', adultVerified: true }).map((s) => s.message), [fallbackLib.NO_ALCOHOL_INFO_ADULT]);
  assert.deepEqual(infoOf({ strength: 'none' }), [], '무알콜 요청에는 안내 없음');
  await withoutKey(async () => {
    let r = await call('POST', v2({ strength: 'strong' }, soft));
    assert.equal(r.json.source, 'fallback');
    assert.equal(r.json.recipe.estimatedAbv, 0);
    assert.ok(
      r.json.recipe.suggestions.some((s) => s.type === 'info' && s.message === '장착된 주류가 없어 무알콜로 만들었어요.'),
      JSON.stringify(r.json.recipe.suggestions)
    );
    for (const s of r.json.recipe.suggestions) assert.ok(!looksAlcoholic(s.message), `술 이름이 든 문구: ${s.message}`);
    r = await call('POST', v2({ strength: 'strong', adultVerified: true }, soft));
    assert.ok(r.json.recipe.suggestions.some((s) => s.message === fallbackLib.NO_ALCOHOL_INFO_ADULT));
  });
});

test('(t3) addsSoftIngredient · filterNoMixerExplore: 무알콜 재료를 새로 더하는 카드 판정 (SPEC §3.3-8, 앱과 같은 정의)', () => {
  const card = (addIngredient, lines, extra = {}) => ({ addIngredient, category: 'soda', abv: 0, ingredients: lines, ...extra });
  const L = (name, installed = false) => (installed ? { name, ml: 50, installed: true, pump: 1 } : { name, ml: 150, installed: false });
  const cases = [
    [card('탄산수', [L('보드카', true), L('탄산수')]), true, '무알콜 새 재료'],
    [card('트리플섹', [L('보드카', true), L('트리플섹')], { category: 'liqueur', abv: 30 }), false, '술만 더함'],
    [card('트리플섹', [L('트리플섹'), L('토닉워터')], { category: 'liqueur', abv: 30 }), true, '술 + 무알콜 짝 재료'],
    [card('진', [L('진'), L('화이트 럼')], { category: 'spirit', abv: 40 }), false, '다른 미장착 줄도 술 이름'],
    [card('오렌지 큐라소', [L('오렌지 큐라소')], { category: 'liqueur', abv: 0 }), false, 'abv 0 이어도 category 가 술'],
    [card('오렌지 큐라소', [L('오렌지 큐라소')], { category: 'wine', abv: 0 }), false, 'wine 도 술 종류'],
    [card('샤르트뢰즈', [L('샤르트뢰즈')], { category: 'liqueur', abv: 0 }), false, '술 이름 목록에 없어도 category 가 술'],
    [card('매실원액', [L('매실원액')], { category: 'other', abv: 15 }), false, 'abv > 0'],
    [card('매실원액', [L('매실원액')], { category: 'other', abv: undefined }), true, 'abv 없으면 0'],
    [card('매실원액', [L('매실원액')], { category: 'other', abv: null }), true, 'abv null → 0'],
    [card('토닉-워터', [L('토닉워터')], { category: 'other', abv: 5 }), false, 'addIngredient 와 normName 일치 → 카드 abv 로 판정'],
    [card('진', [L('진'), L('토닉 워터')], { category: 'spirit', abv: 40 }), true, 'addIngredient 가 아닌 미장착 줄은 술 이름만 봄'],
    [card('깔루아', [L('깔루아')], { category: 'other', abv: 0 }), false, '술 이름 목록(깔루아)'],
    [card('탄산수', [L('보드카', true), L('사이다', true)]), false, '미장착 줄 없음'],
    [card('탄산수', []), false, '재료 없음'],
    [{ addIngredient: '탄산수' }, false, 'ingredients 없음'],
    [null, false, 'null'],
  ];
  for (const [c, want, why] of cases) assert.equal(addsSoftIngredient(c), want, why);
  const list = cases.map((c) => c[0]).filter(Boolean);
  const f = filterNoMixerExplore(list);
  assert.equal(f.items.length, cases.filter((c) => c[1]).length);
  assert.equal(f.removed, list.length - f.items.length);
  assert.ok(f.items.every(addsSoftIngredient));
  assert.deepEqual(filterNoMixerExplore(undefined), { items: [], removed: 0 });
  // 성인 확인 전 normalizeExplore 결과는 항상 통과 (술 장착 항목은 이미 빠짐) → 이 필터는 성인 확인 시에만 의미가 있음
  const onlyAlc = sanitize([VODKA, TRIPLE]);
  const raw = [...ALC_ONLY_CARDS(), exploreItem('탄산수', [exploreLine('보드카', 20, true), exploreLine('탄산수', 180)])];
  const minor = normalizeExplore(raw, onlyAlc, { cupMl: 200, strength: 'light', mode: 'explore' }).items;
  assert.deepEqual(minor.map((e) => e.addIngredient), ['탄산수']);
  assert.ok(minor.every(addsSoftIngredient));
  // 성인 확인: 데킬라 카드는 무알콜 줄이 없어 도수 상한을 못 맞춰 normalizeExplore 가 버림(removedNoMixer 1),
  // 오렌지 큐라소 카드(abv 0)는 통과 → filterNoMixerExplore 가 버림
  const adultN = normalizeExplore(raw, onlyAlc, { cupMl: 200, strength: 'light', mode: 'explore', adultVerified: true });
  const adult = adultN.items;
  assert.deepEqual(adult.map((e) => e.addIngredient), ['오렌지 큐라소', '탄산수'], '성인 확인이면 술 카드도 normalizeExplore 통과(도수 상한을 맞출 수 있으면)');
  assert.equal(adultN.removedNoMixer, 1);
  assert.equal(adultN.removedAdult, 0);
  assert.deepEqual(filterNoMixerExplore(adult).items.map((e) => e.addIngredient), ['탄산수']);
});

test('(t4) NO_MIXER explore(recipe:null) + AI: 술만 더하는 카드 버림 → 0개면 AI 재호출 없이 규칙기반으로 채움, NO_MIXER 가 아니면 필터 안 함', async () => {
  const onlyAlc = sanitize([VODKA, TRIPLE]);
  const tonic = exploreItem('토닉워터', [exploreLine('보드카', 30, true), exploreLine('토닉워터', 170)]);
  const NM = '도수를 낮출 무알콜 재료가 없습니다';
  for (const strength of ['light', 'medium', 'strong']) {
    // 섞여 있으면 무알콜 재료를 더하는 카드만 남음 (채우지 않음)
    queue = [geminiJson({ explore: [...ALC_ONLY_CARDS(), tonic] })];
    calls = [];
    let r = await call('POST', v2({ strength, adultVerified: true }, onlyAlc, { mode: 'explore' }));
    assert.equal(r.status, 200);
    assert.equal(r.json.source, 'gemini');
    assert.equal(r.json.recipe, null);
    assert.equal(calls.length, 1);
    assert.ok(r.json.notice.includes('무알콜'), r.json.notice);
    assert.deepEqual(r.json.explore.map((e) => e.addIngredient), ['토닉워터'], strength);
    // 프롬프트에 NO_MIXER 안내 (탐색 전용 스키마)
    assert.ok(calls[0].body.contents[0].parts[0].text.includes(NM));
    assert.deepEqual(Object.keys(calls[0].body.generationConfig.responseJsonSchema.properties), ['explore']);
    // 전부 술만 더하는 카드 → 0개 → AI 재호출 없이 규칙기반 후보(같은 필터)로 채움
    queue = [geminiJson({ explore: ALC_ONLY_CARDS() })];
    calls = [];
    r = await call('POST', v2({ strength, adultVerified: true }, onlyAlc, { mode: 'explore' }));
    assert.equal(r.json.source, 'gemini');
    assert.equal(calls.length, 1, '재요청 없음');
    assert.equal(r.json.recipe, null);
    assert.ok(r.json.explore.length >= 1 && r.json.explore.length <= 3, JSON.stringify(r.json.explore));
    for (const e of r.json.explore) {
      assert.ok(addsSoftIngredient(e), JSON.stringify(e));
      assertExploreItem(e, onlyAlc);
      assert.ok(exploreAbv(e, onlyAlc) <= capOf(strength) + 0.05);
    }
    assert.ok(!r.json.explore.some((e) => ['데킬라', '오렌지 큐라소'].includes(e.addIngredient)));
  }
  // 성향으로 무알콜 재료를 빼서 NO_MIXER 가 된 경우도 같음 (lacksMixer 는 excludePumps 반영)
  const vm = sanitize([VODKA, MILK]);
  queue = [geminiJson({ explore: ALC_ONLY_CARDS() })];
  calls = [];
  let r = await call('POST', v2({ strength: 'light', adultVerified: true, preference: '우유 알레르기가 있어요' }, vm, { mode: 'explore' }));
  assert.equal(r.json.recipe, null);
  assert.equal(calls.length, 1);
  assert.ok(r.json.explore.length >= 1 && r.json.explore.every(addsSoftIngredient), JSON.stringify(r.json.explore));
  // NO_MIXER 가 아닌 explore(레시피 있음): 술 카드도 그대로 (성인 확인 시) — 이 필터는 NO_MIXER 일 때만
  // (데킬라 카드는 무알콜 줄이 없어 도수 상한을 못 맞추므로 어느 경우든 normalizeExplore 에서 빠짐)
  queue = [geminiJson({ ...GOOD_AI, ingredients: [{ pump: 1, name: '보드카', ml: 20 }, { pump: 2, name: '오렌지주스', ml: 180 }], explore: ALC_ONLY_CARDS() })];
  calls = [];
  r = await call('POST', v2({ strength: 'light', adultVerified: true }, INGREDIENTS, { mode: 'explore' }));
  assert.ok(r.json.recipe);
  assert.deepEqual(r.json.explore.map((e) => e.addIngredient), ['오렌지 큐라소']);
  assert.ok(!calls[0].body.contents[0].parts[0].text.includes(NM));
  // 빈 기기(recipe:null 이지만 NO_MIXER 아님) → 필터 대상 아님, 프롬프트 안내도 없음
  queue = [geminiJson({ explore: [exploreItem('진', [exploreLine('진', 40), exploreLine('토닉워터', 160)], { category: 'spirit', abv: 40 })] })];
  calls = [];
  r = await call('POST', v2({ strength: 'light', adultVerified: true }, [], { mode: 'explore' }));
  assert.equal(r.json.recipe, null);
  assert.deepEqual(r.json.explore.map((e) => e.addIngredient), ['진']);
  assert.ok(!calls[0].body.contents[0].parts[0].text.includes(NM));
});

test('(t5) NO_MIXER explore(recipe:null) + 규칙기반(fallback): 같은 필터 적용 (탐색 전용 · fallback 레시피 NO_MIXER · AI 카드 0개 채우기)', async () => {
  const onlyAlc = sanitize([VODKA, TRIPLE]);
  // 사이다 잔량 3ml: lacksMixer 는 false(무알콜 재료가 있음)지만 규칙기반 레시피는 5ml 미만이라 못 쓰고
  // 도수 보정에 섞을 재료(10ml 이상)도 없어 NO_MIXER
  const lowCider = sanitize([VODKA, { ...CIDER, pump: 2, remainingMl: 3 }]);
  assert.equal(recipeLib.lacksMixer(lowCider, 'light'), false);
  const lowUser = recipeLib.validateRecipeRequest(v2({ strength: 'light' }, lowCider)).value.user;
  assert.equal(recipeLib.finalizeRecipe(buildFallbackRecipe(lowUser, lowCider, []), lowCider, { cupMl: 200, strength: 'light' }).code, 'NO_MIXER');
  // 규칙기반 후보 자체는 술만 더하는 카드를 거의 만들지 않으므로(짝 재료가 무알콜), 술만 더하는 카드를 끼워 넣어 필터가 걸리는지 확인
  const injected = (orig) => ({ buildFallbackExplore: (...a) => [...ALC_ONLY_CARDS(), ...orig.buildFallbackExplore(...a)] });
  await withFallbackStub(injected, async (callStub) => {
    await withoutKey(async () => {
      for (const strength of ['light', 'medium', 'strong']) {
        // ① 탐색 전용(lacksMixer) — 키 없음 → fallback
        const r1 = await callStub('POST', v2({ strength, adultVerified: true }, onlyAlc, { mode: 'explore' }));
        assert.equal(r1.json.source, 'fallback');
        assert.equal(r1.json.recipe, null);
        assert.ok(r1.json.notice.includes('무알콜'));
        assert.ok(r1.json.explore.length >= 1, strength);
        assert.ok(r1.json.explore.every(addsSoftIngredient), JSON.stringify(r1.json.explore.map((e) => e.addIngredient)));
      }
      // ② fallback 레시피가 NO_MIXER → recipe:null + 같은 필터
      let r = await callStub('POST', v2({ strength: 'light', adultVerified: true }, lowCider, { mode: 'explore' }));
      assert.equal(r.json.source, 'fallback');
      assert.equal(r.json.recipe, null);
      assert.ok(r.json.notice.includes('무알콜'), r.json.notice);
      assert.ok(r.json.explore.length >= 1 && r.json.explore.every(addsSoftIngredient), JSON.stringify(r.json.explore.map((e) => e.addIngredient)));
      // normal 모드는 422 (NO_MIXER 문구)
      r = await callStub('POST', v2({ strength: 'light', adultVerified: true }, lowCider));
      assert.equal(r.status, 422);
      assert.ok(r.json.error.includes('무알콜'), r.json.error);
      // ③ NO_MIXER 가 아니면(레시피 있음) 규칙기반 explore 에 이 필터를 걸지 않음
      //    (데킬라 카드는 무알콜 줄이 없어 도수 상한 단계에서 빠짐 — 필터와 무관)
      r = await callStub('POST', v2({ strength: 'light', adultVerified: true }, INGREDIENTS, { mode: 'explore' }));
      assert.ok(r.json.recipe);
      assert.deepEqual(r.json.explore.slice(0, 1).map((e) => e.addIngredient), ['오렌지 큐라소']);
      assert.ok(!r.json.explore.some((e) => e.addIngredient === '데킬라'));
    });
    // ④ AI 의 카드가 모두 술만 더해서 버려짐 → 규칙기반으로 채울 때도 필터 (AI 재호출 없음)
    queue = [geminiJson({ explore: ALC_ONLY_CARDS() })];
    calls = [];
    const r = await callStub('POST', v2({ strength: 'medium', adultVerified: true }, onlyAlc, { mode: 'explore' }));
    assert.equal(r.json.source, 'gemini');
    assert.equal(calls.length, 1);
    assert.ok(r.json.explore.length >= 1 && r.json.explore.every(addsSoftIngredient), JSON.stringify(r.json.explore.map((e) => e.addIngredient)));
  });
  // stub 해제 확인: 원래 handler 는 그대로
  await withoutKey(async () => {
    const r = await call('POST', v2({ strength: 'light', adultVerified: true }, INGREDIENTS, { mode: 'explore' }));
    assert.ok(!r.json.explore.some((e) => ['데킬라', '오렌지 큐라소'].includes(e.addIngredient)));
  });
  // 실제 규칙기반 후보(끼워 넣기 없음): NO_MIXER 장착 조합 × 도수 × 성인 확인 × 맛에서 술만 더하는 카드 없음, 1개 이상
  const lists = [onlyAlc, sanitize([VODKA]), sanitize([TRIPLE]), lowCider, sanitize([VODKA, { ...MILK, remainingMl: 0 }])];
  for (const list of lists) {
    for (const strength of ['light', 'medium', 'strong']) {
      for (const adultVerified of [true, false]) {
        for (const taste of [NO_FIT_TASTE, { sweet: 0, sour: 0, bitter: 0, fizzy: 0 }, { sweet: 5, sour: 5, bitter: 5, fizzy: 5 }]) {
          const r = await withoutKey(() => call('POST', v2({ strength, adultVerified, taste }, list, { mode: 'explore' })));
          const tag = `${list.map((i) => i.name)} ${strength}/${adultVerified}/${JSON.stringify(taste)}`;
          assert.equal(r.status, 200, tag);
          assert.equal(r.json.recipe, null, tag);
          assert.ok(r.json.explore.length >= 1, tag);
          for (const e of r.json.explore) {
            assert.ok(addsSoftIngredient(e), `${tag}: ${JSON.stringify(e)}`);
            assertExploreItem(e, list);
          }
          if (adultVerified !== true) assertNoAlcoholMount(r.json.explore);
        }
      }
    }
  }
});

test('(t6) 프롬프트: 성인 확인 전 안내에 suggestions(add_ingredient·substitute) 포함, NO_MIXER 탐색 전용일 때만 무알콜 재료 안내', () => {
  const reqOf = (u, ings = INGREDIENTS, extra = {}) => recipeLib.validateRecipeRequest(v2(u, ings, extra)).value;
  const minor = buildUserPrompt(reqOf({ strength: 'light' }));
  assert.ok(/성인 확인 전: explore 와 suggestions\(add_ingredient·substitute\)/.test(minor), minor);
  const onlyAlc = sanitize([VODKA, TRIPLE]);
  const NM = '도수를 낮출 무알콜 재료가 없습니다';
  assert.ok(buildUserPrompt(reqOf({ strength: 'light', adultVerified: true }, onlyAlc, { mode: 'explore' }), { exploreOnly: true }).includes(NM));
  assert.ok(!buildUserPrompt(reqOf({ strength: 'light' }, [], { mode: 'explore' }), { exploreOnly: true }).includes(NM), '빈 기기');
  assert.ok(!buildUserPrompt(reqOf({ strength: 'light' }, INGREDIENTS, { mode: 'explore' })).includes(NM), '레시피 있음');
  // 성향으로 우유를 빼서 NO_MIXER → 안내
  const vm = sanitize([VODKA, MILK]);
  assert.ok(buildUserPrompt(reqOf({ strength: 'light', preference: '우유 알레르기' }, vm, { mode: 'explore' }), { exploreOnly: true }).includes(NM));
});

test('(t7) 술 이름 목록: 앱 재료 프리셋의 술 이름·별칭(피치트리·말리부·피치슈냅스·코코넛 럼)도 술 → 성인 확인 전 제안·탐색 줄 제거 (SPEC §3.2·§5.4 "같은 목록")', () => {
  for (const n of ['피치트리', '피치 트리', 'Peach Tree', '말리부', 'Malibu', '피치슈냅스', '피치 슈냅스', 'schnapps', '코코넛 럼']) assert.ok(looksAlcoholic(n), n);
  for (const n of ['피치 시럽', '피치 아이스티', '코코넛 밀크', '코코넛워터', '복숭아 주스', '진저에일', '럼주스']) assert.ok(!looksAlcoholic(n), n);
  const ings = sanitize([MILK, { pump: 3, name: '사이다', category: 'soda', abv: 0, remainingMl: 900 }]);
  const byPump = new Map(ings.map((i) => [i.pump, i]));
  const list = [
    { type: 'add_ingredient', ingredient: '피치트리', message: '피치트리를 장착하면 복숭아 향 칵테일도 돼요.' },
    { type: 'substitute', ingredient: '코코넛 럼', message: '코코넛 럼으로 바꿔도 좋아요.' },
    { type: 'add_ingredient', ingredient: '탄산수', message: '탄산수를 장착하면 청량해요.' },
  ];
  assert.deepEqual(recipeLib.sanitizeSuggestions(list, ings, byPump, 'light', false).map((x) => x.ingredient), ['탄산수']);
  assert.equal(recipeLib.sanitizeSuggestions(list, ings, byPump, 'light', true).length, 3);
  const cards = [
    { addIngredient: '토닉워터', category: 'soda', abv: 0, ingredients: [{ name: '토닉워터', ml: 160 }, { name: '말리부', ml: 30 }] },
    { addIngredient: '탄산수', category: 'soda', abv: 0, ingredients: [{ name: '탄산수', ml: 160 }, { name: '사이다', ml: 30 }] },
  ];
  const minor = normalizeExplore(cards, ings, { cupMl: 200, strength: 'strong', mode: 'explore', adultVerified: false });
  assert.deepEqual(minor.items.map((x) => x.addIngredient), ['탄산수']);
  assert.equal(minor.removedAdult, 1);
  assert.equal(normalizeExplore(cards, ings, { cupMl: 200, strength: 'strong', mode: 'explore', adultVerified: true }).items.length, 2);
});

// ───────── 2026-11-07 review3 수정: NO_MIXER 재호출 · 술 이름 · 탐색 카드 도수 · 성향 제외 ─────────

test('(t8) NO_MIXER 탐색 전용: 도수를 못 낮춰 normalizeExplore 가 버린 술만 더하는 카드도 → 0개면 AI 재호출 없이 규칙기반으로 채움 · 성인 확인 전 무알콜 빈 기기도 같음 · 형식 오류는 기존대로 1회 재요청', async () => {
  const onlyVodka = sanitize([VODKA]);
  // 장착 보드카 + 미장착 술만: 무알콜 줄이 없어 도수 상한을 못 맞춤 → normalizeExplore 에서 빠짐(removedNoMixer)
  const vodkaTriple = () => exploreItem('트리플섹', [exploreLine('보드카', 60, true), exploreLine('트리플섹', 140)], { category: 'liqueur', abv: 30 });
  const vodkaGin = () => exploreItem('진', [exploreLine('보드카', 40, true), exploreLine('진', 60), exploreLine('화이트 럼', 100)], { category: 'spirit', abv: 40 });
  for (const strength of ['light', 'medium', 'strong']) {
    const n = normalizeExplore([vodkaTriple(), vodkaGin()], onlyVodka, { cupMl: 200, strength, mode: 'explore', adultVerified: true });
    assert.equal(n.items.length, 0, strength);
    assert.equal(n.removedNoMixer, 2, strength);
    for (const cards of [[vodkaTriple()], [vodkaTriple(), vodkaGin()]]) {
      queue = [geminiJson({ explore: cards }), geminiJson({ explore: cards })];
      calls = [];
      const r = await call('POST', v2({ strength, adultVerified: true }, onlyVodka, { mode: 'explore' }));
      assert.equal(r.status, 200);
      assert.equal(calls.length, 1, `${strength}: 재요청 없음`);
      assert.equal(r.json.source, 'gemini', strength);
      assert.equal(r.json.warningCode, undefined);
      assert.equal(r.json.recipe, null);
      assert.ok(r.json.notice.includes('무알콜'), r.json.notice);
      assert.ok(r.json.explore.length >= 1 && r.json.explore.length <= 3, JSON.stringify(r.json.explore));
      for (const e of r.json.explore) {
        assert.ok(addsSoftIngredient(e), JSON.stringify(e));
        assertExploreItem(e, onlyVodka);
        assert.ok(exploreAbv(e, onlyVodka) <= capOf(strength) + 0.05);
      }
    }
  }
  // 기본 요청(strength 생략 = none, adultVerified 생략 = 성인 확인 전) + 빈 기기: 무알콜 규칙이 버린 술 카드도 removedAdult 로 셈
  // (성인 확인 전 스키마에 맞춰 abv 0·무알콜 category 로 온 '진' 카드)
  const ginTonic = () => exploreItem('진', [exploreLine('진', 50), exploreLine('토닉워터', 150)], { category: 'other', abv: 0 });
  for (const user of [{}, { adultVerified: false }, { strength: 'light' }]) {
    queue = [geminiJson({ explore: [ginTonic()] }), geminiJson({ explore: [ginTonic()] })];
    calls = [];
    const r = await call('POST', v2(user, [], { mode: 'explore' }));
    assert.equal(r.status, 200);
    assert.equal(calls.length, 1, `${JSON.stringify(user)}: 재요청 없음`);
    assert.equal(r.json.source, 'gemini');
    assert.equal(r.json.recipe, null);
    assert.ok(r.json.explore.length >= 1);
    assertNoAlcoholMount(r.json.explore);
    for (const e of r.json.explore) assertExploreItem(e, []);
  }
  // 형식이 깨진 카드(addIngredient 없음)만 오면 기존대로 1회 재요청 → 그래도 0개면 fallback(BAD_RESPONSE) (README 5번 warningCode 표)
  const broken = { explore: [{ category: 'soda', abv: 0, ingredients: [{ name: '탄산수', ml: 200, installed: false }] }] };
  for (const ings of [[], onlyVodka]) {
    queue = [geminiJson(broken), geminiJson(broken)];
    calls = [];
    const r = await call('POST', v2({ strength: 'light', adultVerified: true }, ings, { mode: 'explore' }));
    assert.equal(calls.length, 2, ings.length ? 'NO_MIXER' : '빈 기기');
    assert.equal(r.json.source, 'fallback');
    assert.equal(r.json.warningCode, 'BAD_RESPONSE');
    assert.equal(r.json.recipe, null);
    assert.ok(r.json.explore.length >= 1);
  }
});

test('(t9) 술 이름 목록: 문장 속 럼·진, 흔한 변형명(라이트·스파이스드 럼, 런던 드라이 진, 아마레또, 샴페인, 매실주 …)도 술 → 성인 확인 전 제안·탐색에서 제거, 오탐 없음 (SPEC §3.2·§5.4)', () => {
  const yes = [
    '라이트 럼', '스파이스드 럼', '블랙럼', '런던 드라이 진', '드라이진', '아마레또', 'Amaretto', '샴페인', 'Champagne', '매실주', '복분자주', '고량주', '동동주',
    '압생트', '미도리', '그랑 마르니에', '오렌지 큐라소', '리큐어', '럼주',
    '럼을 장착하면 모히토도 만들 수 있어요.', '진을 추가로 장착하면 진토닉을 만들 수 있어요.', '진과 토닉워터를 섞어요', "'럼'으로 바꿔 보세요",
  ];
  for (const n of yes) assert.ok(looksAlcoholic(n), n);
  const no = [
    '진저에일', '진저 시럽', '진토닉', "토닉워터를 추가 장착하면 쌉싸름한 '진토닉 스타일'도 만들 수 있어요.", '진로토닉', '진로 토닉', '더 진한 맛', '진하게', '진짜 맛있어요', '진도',
    '드럼', '럼주스', '럼블', '구름처럼 부드러워요', '바다처럼 시원한 맛', '매실주스', '매실청', '복분자주스', '블루큐라소', '블루큐라소시럽', '그레나딘 시럽', '탄산수',
  ];
  for (const n of no) assert.ok(!looksAlcoholic(n), n);
  // sanitizeSuggestions(light, 성인 확인 생략): 술 장착 제안 제거 (앞 8개만 쓰므로 두 번에 나눔)
  const ings = sanitize(INGREDIENTS);
  const byPump = new Map(ings.map((i) => [i.pump, i]));
  const kept = (list, adult) => recipeLib.sanitizeSuggestions(list, ings, byPump, 'light', adult).map((s) => s.ingredient || s.message);
  const named = ['라이트 럼', '스파이스드 럼', '런던 드라이 진', '아마레또', '샴페인', '매실주'].map((n) => ({ type: 'add_ingredient', ingredient: n, message: `${n} 장착을 추천해요.` }));
  named.push({ type: 'add_ingredient', ingredient: '매실주스', message: '매실주스를 장착하면 새콤달콤해요.' });
  assert.deepEqual(kept(named, undefined), ['매실주스']);
  assert.equal(kept(named, true).length, named.length, '성인 확인이면 모두 유지');
  const msgs = [
    { type: 'add_ingredient', message: '럼을 장착하면 모히토도 만들 수 있어요.' },
    { type: 'add_ingredient', ingredient: '토닉워터', message: '진을 추가로 장착하면 진토닉을 만들 수 있어요.' },
    { type: 'add_ingredient', ingredient: '토닉워터', message: "토닉워터를 추가 장착하면 쌉싸름한 '진토닉 스타일'도 만들 수 있어요." },
    { type: 'add_ingredient', ingredient: '진저에일', message: '진저에일로 더 진하게 즐겨 보세요.' },
  ];
  assert.deepEqual(kept(msgs, undefined), ['토닉워터', '진저에일']);
  assert.equal(kept(msgs, true).length, msgs.length);
  // normalizeExplore: 성인 확인 전 스키마대로 abv 0·무알콜 category 로 와도 이름으로 판정해 술 장착 카드 제거
  const cards = [
    exploreItem('토닉워터', [exploreLine('보드카', 20, true), exploreLine('라이트 럼', 30), exploreLine('토닉워터', 150)]),
    exploreItem('아마레또', [exploreLine('보드카', 20, true), exploreLine('아마레또', 180)], { category: 'syrup', abv: 0 }),
    exploreItem('진저에일', [exploreLine('보드카', 20, true), exploreLine('진저에일', 180)]),
  ];
  const n = normalizeExplore(cards, ings, { cupMl: 200, strength: 'light', mode: 'explore', adultVerified: false });
  assert.deepEqual(n.items.map((e) => e.addIngredient), ['진저에일']);
  assert.equal(n.removedAdult, 2);
  assertNoAlcoholMount(n.items);
});

test('(t10) explore 카드 도수 상한: addIngredient 가 아닌 미장착 술 줄은 프리셋 도수(없으면 술 이름 40%)로 계산 — 앱 parseExplore 와 같은 규칙', () => {
  for (const [n, a] of [
    ['진', 40], ['화이트 럼', 40], ['다크럼', 40], ['보드카', 40], ['위스키', 40], ['데킬라', 38], ['소주', 16.5], ['말리부', 21], ['코코넛 럼', 21], ['피치 리큐르', 20],
    ['커피 리큐르', 20], ['맥주', 4.5], ['화이트와인', 12], ['Gin', 40], ['아마레또', 40], ['라이트 럼', 40],
    ['진저에일', 0], ['진로토닉', 0], ['블루큐라소', 0], ['그레나딘 시럽', 0], ['토닉워터', 0],
  ]) {
    assert.equal(uninstalledLineAbv(n), a, n);
  }
  const ings = sanitize([VODKA, { pump: 2, name: '오렌지주스', category: 'juice', abv: 0, remainingMl: 900 }]);
  const card = () => exploreItem('화이트 럼', [exploreLine('화이트 럼', 20), exploreLine('진', 100), exploreLine('오렌지주스', 80, true)], { category: 'spirit', abv: 40 });
  for (const strength of ['light', 'medium', 'strong']) {
    const n = normalizeExplore([card()], ings, { cupMl: 200, strength, mode: 'explore', adultVerified: true });
    assert.equal(n.items.length, 1, strength);
    const e = n.items[0];
    assertExploreItem(e, ings);
    // 진을 40% 로 본 실제 도수가 상한 이하 (예전에는 진을 0% 로 봐 24% 카드가 그대로 나감)
    const real = e.ingredients.reduce((s, l) => s + l.ml * (l.name === '오렌지주스' ? 0 : 40), 0) / e.ingredients.reduce((s, l) => s + l.ml, 0);
    assert.ok(real <= capOf(strength) + 0.05, `${strength}: ${JSON.stringify(e.ingredients)} → ${real}%`);
    assert.ok(exploreAbv(e, ings) <= capOf(strength) + 0.05);
  }
  // 소주(프리셋 16.5%)는 40% 가 아니라 16.5% 로 계산 → strong(20%)에서는 줄이지 않음
  const soju = exploreItem('토닉워터', [exploreLine('소주', 150), exploreLine('토닉워터', 50)]);
  const s = normalizeExplore([soju], ings, { cupMl: 200, strength: 'strong', mode: 'explore', adultVerified: true }).items[0];
  assert.deepEqual(s.ingredients.map((l) => [l.name, l.ml]), [['소주', 150], ['토닉워터', 50]]);
});

test('(t11) explore 카드도 성향(알레르기·싫어하는 재료)으로 뺀 재료를 쓰지 않음 (SPEC §3.3-1, 규칙기반 후보와 같은 판정)', async () => {
  // 우유 알레르기로 우유가 빠져 NO_MIXER(recipe:null) — AI 카드가 그 우유를 섞을 재료로 쓰면 그 줄을 뺌
  const vm = sanitize([VODKA, MILK]);
  const grenadine = () => exploreItem('그레나딘 시럽', [exploreLine('보드카', 20, true), exploreLine('그레나딘 시럽', 20), exploreLine('우유', 160, true)], { category: 'syrup' });
  for (const adultVerified of [false, true]) {
    queue = [geminiJson({ explore: [grenadine()] })];
    calls = [];
    const r = await call('POST', v2({ strength: 'light', adultVerified, preference: '우유 알레르기가 있어요' }, vm, { mode: 'explore' }));
    assert.equal(r.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(r.json.recipe, null);
    assert.ok(r.json.explore.length >= 1);
    for (const e of r.json.explore) {
      assert.ok(!e.ingredients.some((l) => nameKey(l.name) === nameKey('우유')), JSON.stringify(e.ingredients));
      assertExploreItem(e, vm);
      assert.ok(exploreAbv(e, vm) <= capOf('light') + 0.05);
    }
  }
  // 단위: 장착 줄(excludePumps)·미장착 줄(excludeName) 제거, 새 재료(addIngredient) 자체가 성향 제외면 카드 제거
  const ings = sanitize(INGREDIENTS);
  const pref = '토닉워터는 싫어요. 레몬즙 빼 주세요. 오렌지주스 알레르기';
  const opts = {
    cupMl: 200,
    strength: 'light',
    mode: 'explore',
    adultVerified: true,
    excludePumps: fallbackLib.preferenceExcludedPumps(ings, pref),
    excludeName: (name) => fallbackLib.excludedByPreference({ name }, pref),
  };
  const cards = [
    exploreItem('토닉워터', [exploreLine('보드카', 20, true), exploreLine('토닉워터', 180)]),
    exploreItem('탄산수', [exploreLine('오렌지주스', 100, true), exploreLine('레몬즙', 20), exploreLine('탄산수', 80)]),
  ];
  const n = normalizeExplore(cards, ings, opts);
  assert.deepEqual(n.items.map((e) => e.addIngredient), ['탄산수']);
  assert.deepEqual(n.items[0].ingredients, [{ name: '탄산수', ml: 200, installed: false }]);
  // 성향 옵션이 없으면 그대로
  assert.equal(normalizeExplore(cards, ings, { ...opts, excludePumps: undefined, excludeName: undefined }).items.length, 2);
});

test('(z) 모든 응답·로그에 키가 노출되지 않음', () => {
  for (const b of allBodies) assert.ok(!b.includes(FAKE_KEY), `응답에 키 노출: ${b.slice(0, 80)}`);
  for (const l of logs) assert.ok(!l.includes(FAKE_KEY), `로그에 키 노출: ${l.slice(0, 80)}`);
  assert.ok(logs.some((l) => l.includes('***')), '로그 마스킹 동작 확인');
});

// ───────── 실행 ─────────
(async () => {
  let pass = 0;
  let fail = 0;
  const out = (s) => process.stdout.write(s + '\n');
  const envKey = process.env.GEMINI_API_KEY;
  for (const t of tests) {
    try {
      await t.fn();
      pass += 1;
      out(`  ✓ ${t.name}`);
    } catch (e) {
      fail += 1;
      out(`  ✗ ${t.name}\n      ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join('\n      ')}`);
    }
    // 테스트가 중간에 실패해도 다음 테스트에 영향이 없도록 상태 복구
    queue = [];
    process.env.GEMINI_API_KEY = envKey;
    delete process.env.GEMINI_MODEL;
  }
  out(`\n결과: ${pass} 통과 / ${fail} 실패 (총 ${tests.length})`);
  process.exit(fail ? 1 : 0);
})();
