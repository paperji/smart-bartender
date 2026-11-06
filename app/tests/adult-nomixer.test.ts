/// <reference types="node" />
/**
 * SPEC 2026-11-07 개정분 (앱) 테스트
 *  - §3.2 성인 확인 전(adultVerified !== true)이면 레시피 suggestions 에서도 술 장착·대체 제안 제거
 *    (normalize.ts sanitizeSuggestions·isAlcoholSuggestion — Gemini 응답 재검증·오프라인·ml 조정 재검증 모두)
 *  - 오프라인 추천: 술이 없어(미장착·잔량 0·성향 제외) 무알콜로 만든 경우 항상 info 안내 — 술 장착 권유 문장은 성인 확인 뒤에만 (백엔드 fallback 과 같은 문구)
 *  - §3.3 규칙 8 NO_MIXER explore: 무알콜 재료를 새로 더하지 않는 카드는 버리고(addsSoftIngredient), 0개면 오프라인 탐색(같은 필터)으로 채움
 * fetch 는 가짜만 사용 — 실제 Gemini 를 부르지 않음 (정해지지 않은 주소는 오류).
 * v3.0: 서버 모드 제거 — 서버 응답 재검증으로 확인하던 성질(예전 서버가 거르지 않은 술 제안·NO_MIXER 카드를 앱이 거름)은
 *       같은 원본을 Gemini(사용자 키) 응답으로 넣어 확인. aiMode 'direct' → 'gemini'
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { looksAlcoholic } from '../src/lib/ai/alcohol';
import { addsSoftIngredient, filterNoMixerExplore } from '../src/lib/ai/explore';
import { isAlcoholSuggestion, normalizeRecipe, normName, revalidateRecipe, sanitizeSuggestions } from '../src/lib/ai/normalize';
import { OFFLINE_NO_ALCOHOL_INFO, OFFLINE_NO_ALCOHOL_INFO_ADULT, offlineRecipe } from '../src/lib/ai/offline';
import { buildRequest, generateRecipe } from '../src/lib/ai/recommend';
import { defaultSlots } from '../src/lib/presets';
import type { IngredientInfo, PumpSlot, Strength, Suggestion, UserInput } from '../src/lib/types';

const GEMINI_PREFIX = 'https://generativelanguage.googleapis.com/';
const FAKE_KEY = 'test-key-not-real';

const slot = (pump: number, name: string, category: PumpSlot['category'], abv = 0, remainingMl = 800): PumpSlot => ({
  pump,
  name,
  category,
  abv,
  capacityMl: 1000,
  remainingMl,
  color: '#fff',
  notes: '',
  updatedAt: 0,
});

const input: UserInput = {
  moods: ['피곤함'],
  taste: { sweet: 3, sour: 2, bitter: 1, fizzy: 3 },
  strength: 'medium',
  weather: null,
  situation: '',
  preference: '',
  cupMl: 200,
};

/** 술을 장착·대체하라는 제안 (술 이름·장착된 술 이름·장착된 술 펌프·문구의 술 이름) */
function alcoholPushes(list: Suggestion[], ing: IngredientInfo[]): Suggestion[] {
  const alcPumps = new Set(ing.filter((i) => i.abv > 0).map((i) => i.pump));
  const alcNames = new Set(ing.filter((i) => i.abv > 0).map((i) => normName(i.name)));
  return list.filter(
    (s) =>
      (s.type === 'add_ingredient' || s.type === 'substitute') &&
      (looksAlcoholic(s.ingredient) ||
        (!!s.ingredient && alcNames.has(normName(s.ingredient))) ||
        looksAlcoholic(s.message) ||
        (s.pump != null && alcPumps.has(s.pump))),
  );
}

/** fetch 를 가짜로 바꿔 실행. calls: 불린 주소와 요청 본문 */
async function withFakeFetch<T>(
  routes: { aiJson?: unknown },
  fn: (calls: { url: string; body: any }[]) => Promise<T>,
): Promise<T> {
  const real = globalThis.fetch;
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    if (routes.aiJson !== undefined && u.startsWith(GEMINI_PREFIX)) {
      const text = JSON.stringify(routes.aiJson);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    }
    throw new TypeError(`가짜 fetch: 정해지지 않은 주소(${u})는 부르지 않음`);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

// ───────────────────────── §3.2 성인 확인 전 레시피 suggestions ─────────────────────────

const ING: IngredientInfo[] = [
  { pump: 1, name: '보드카', category: 'spirit', abv: 40, remainingMl: 500, notes: '' },
  { pump: 2, name: '오렌지주스', category: 'juice', abv: 0, remainingMl: 800, notes: '' },
  { pump: 3, name: '사이다', category: 'soda', abv: 0, remainingMl: 800, notes: '' },
];
const BY_PUMP = new Map(ING.map((i) => [i.pump, i] as const));
const RAW_SUG = [
  { type: 'add_ingredient', ingredient: '진', message: '진을 장착하면 진토닉도 만들 수 있어요.' },
  { type: 'substitute', ingredient: '럼', message: '럼 대신 써도 좋아요.' },
  { type: 'substitute', pump: 1, message: '펌프 1 재료를 조금 줄여 보세요.' },
  { type: 'add_ingredient', ingredient: '탄산수', message: '탄산수를 장착하면 위스키 하이볼도 가능해요.' },
  { type: 'add_ingredient', ingredient: '토닉워터', message: '토닉워터를 장착하면 쌉싸름한 맛을 낼 수 있어요.' },
  { type: 'substitute', ingredient: '레몬즙', message: '레몬즙 대신 라임즙도 좋아요.' },
  { type: 'info', message: '보드카는 천천히 즐기세요.' },
  { type: 'low_stock', pump: 1, message: '보드카가 얼마 안 남았어요.' },
];
const ALCOHOL_MSGS = ['진을 장착하면', '럼 대신', '펌프 1 재료', '위스키 하이볼'];

test('sanitizeSuggestions: 성인 확인 전(false·생략)이면 술 허용 도수여도 무알콜과 같은 판정으로 술 장착·대체 제안 제거', () => {
  const msgs = (l: Suggestion[]) => l.map((s) => s.message);
  const has = (l: Suggestion[], m: string) => l.some((s) => s.message.includes(m));
  for (const strength of ['light', 'medium', 'strong'] as Strength[]) {
    const adult = sanitizeSuggestions(RAW_SUG, ING, BY_PUMP, strength, true);
    assert.equal(adult.length, RAW_SUG.length, '성인 확인 + 술 허용이면 모두 유지');
    for (const m of ALCOHOL_MSGS) assert.ok(has(adult, m), m);
    const kid = sanitizeSuggestions(RAW_SUG, ING, BY_PUMP, strength, false);
    for (const m of ALCOHOL_MSGS) assert.ok(!has(kid, m), `${strength}: '${m}' 남음`);
    assert.deepEqual(msgs(kid), ['토닉워터를 장착하면 쌉싸름한 맛을 낼 수 있어요.', '레몬즙 대신 라임즙도 좋아요.', '보드카는 천천히 즐기세요.', '보드카가 얼마 안 남았어요.']);
    assert.deepEqual(sanitizeSuggestions(RAW_SUG, ING, BY_PUMP, strength), kid, '생략 = 성인 확인 전 (SPEC §3.1)');
    assert.deepEqual(kid, sanitizeSuggestions(RAW_SUG, ING, BY_PUMP, 'none', true), '무알콜과 같은 판정');
    assert.deepEqual(alcoholPushes(kid, ING), []);
  }
  // 판정 함수: 지운 것 = isAlcoholSuggestion 이 true 인 add_ingredient/substitute
  const alcNames = new Set(['보드카']);
  const all = sanitizeSuggestions(RAW_SUG, ING, BY_PUMP, 'medium', true);
  assert.deepEqual(
    all.filter((s) => isAlcoholSuggestion(s, alcNames, BY_PUMP)).map((s) => s.message),
    all.filter((s) => !sanitizeSuggestions(RAW_SUG, ING, BY_PUMP, 'medium', false).some((k) => k.message === s.message)).map((s) => s.message),
  );
  assert.equal(isAlcoholSuggestion({ type: 'info', message: '보드카' }, alcNames, BY_PUMP), false, 'info 는 대상 아님');
  assert.equal(isAlcoholSuggestion({ type: 'low_stock', pump: 1, message: '보드카 부족' }, alcNames, BY_PUMP), false, 'low_stock 은 대상 아님');
});

test('normalizeRecipe·revalidateRecipe: ctx.adultVerified 가 true 일 때만 술 장착·대체 제안 유지 (ml 조정 뒤 재검증도 같은 값)', () => {
  const raw = { name: '스크루드라이버', ingredients: [{ pump: 1, name: '보드카', ml: 30 }, { pump: 2, name: '오렌지주스', ml: 170 }], suggestions: RAW_SUG };
  const base = { ingredients: ING, strength: 'medium' as Strength, cupMl: 200 };
  const kid = normalizeRecipe(raw, base).recipe; // 생략 = 성인 확인 전
  assert.deepEqual(alcoholPushes(kid.suggestions, ING), []);
  assert.deepEqual(normalizeRecipe(raw, { ...base, adultVerified: false }).recipe.suggestions, kid.suggestions);
  const adult = normalizeRecipe(raw, { ...base, adultVerified: true }).recipe;
  assert.ok(adult.suggestions.some((s) => s.message.includes('진을 장착하면')), JSON.stringify(adult.suggestions));
  assert.ok(adult.estimatedAbv > 0, '레시피 자체(장착된 술)는 그대로 — 지우는 것은 제안뿐');
  assert.deepEqual(adult.ingredients, kid.ingredients);
  // 사용자가 ml 를 조정한 뒤 다시 검증: 설정의 성인 확인 값을 그대로 넘김
  const bumped = { ...adult, ingredients: adult.ingredients.map((i) => (i.pump === 2 ? { ...i, ml: i.ml + 10 } : i)) };
  assert.deepEqual(revalidateRecipe(bumped, { ...base, adultVerified: true }).recipe.suggestions, adult.suggestions);
  assert.deepEqual(alcoholPushes(revalidateRecipe(bumped, { ...base, adultVerified: false }).recipe.suggestions, ING), []);
});

test("오프라인 추천: 술이 없어 무알콜로 만든 경우 info 안내 — '…술을 장착하면…' 문장은 성인 확인 뒤에만 (§3.2)", () => {
  for (const strength of ['light', 'medium', 'strong'] as Strength[]) {
    for (let v = 0; v < 6; v++) {
      const kid = offlineRecipe(buildRequest({ ...input, strength }, defaultSlots(), [], 'normal', false), { variation: v }) as any;
      const s: Suggestion[] = kid.suggestions;
      assert.ok(s.some((x) => x.type === 'info' && x.message === OFFLINE_NO_ALCOHOL_INFO), JSON.stringify(s));
      assert.equal(OFFLINE_NO_ALCOHOL_INFO, '장착된 주류가 없어 무알콜로 만들었어요.'); // SPEC §3.2 예시 문장 (백엔드와 같음)
      assert.ok(!s.some((x) => looksAlcoholic(x.ingredient) || looksAlcoholic(x.message)), JSON.stringify(s));
      const adult = offlineRecipe(buildRequest({ ...input, strength }, defaultSlots(), [], 'normal', true), { variation: v }) as any;
      assert.ok(
        adult.suggestions.some((x: Suggestion) => x.type === 'info' && x.message === OFFLINE_NO_ALCOHOL_INFO_ADULT),
        JSON.stringify(adult.suggestions),
      );
    }
  }
  // 무알콜 요청은 안내 없음 (원래부터 술을 원하지 않음)
  const none = offlineRecipe(buildRequest({ ...input, strength: 'none' }, defaultSlots(), [], 'normal', false)) as any;
  assert.ok(!none.suggestions.some((x: Suggestion) => x.message.includes('무알콜로 만들었어요')));
});

test('오프라인 추천: 술이 장착돼 있지만 못 쓰면(잔량 0·성향 제외) 성인 확인 뒤에도 무알콜로 만든 이유를 안내 — 최종 결과(normalize 거침)에서 지워지지 않음', async () => {
  const cases: { name: string; slots: PumpSlot[]; preference: string }[] = [
    { name: '보드카 잔량 0', slots: [slot(1, '보드카', 'spirit', 40, 0), slot(2, '오렌지주스', 'juice'), slot(3, '사이다', 'soda')], preference: '' },
    { name: '보드카 성향 제외', slots: [slot(1, '보드카', 'spirit', 40), slot(2, '오렌지주스', 'juice'), slot(3, '사이다', 'soda')], preference: '보드카는 싫어요' },
    { name: '술 미장착', slots: [slot(1, '오렌지주스', 'juice'), slot(2, '사이다', 'soda')], preference: '' },
  ];
  for (const c of cases) {
    for (const adultVerified of [false, true]) {
      const u = { ...input, strength: 'medium' as Strength, preference: c.preference };
      const r = await generateRecipe({ input: u, slots: c.slots, aiMode: 'offline', adultVerified });
      assert.equal(r.recipe!.estimatedAbv, 0, c.name);
      const sug = r.recipe!.suggestions;
      const want = adultVerified ? OFFLINE_NO_ALCOHOL_INFO_ADULT : OFFLINE_NO_ALCOHOL_INFO;
      assert.ok(sug.some((s) => s.type === 'info' && s.message === want), `${c.name} adult=${adultVerified}: ${JSON.stringify(sug)}`);
      if (!adultVerified) assert.deepEqual(alcoholPushes(sug, buildRequest(u, c.slots).ingredients), [], c.name);
    }
  }
});

test('generateRecipe 모든 경로(오프라인·Gemini 응답 재검증): 성인 확인 전이면 레시피 suggestions 의 술 권유 제거 (가짜 fetch)', async () => {
  const slots = [slot(1, '보드카', 'spirit', 40, 500), slot(2, '오렌지주스', 'juice'), slot(3, '사이다', 'soda')];
  const ingredients = buildRequest(input, slots).ingredients;
  const aiRecipe = {
    name: '서버 스크루드라이버',
    ingredients: [{ pump: 1, name: '보드카', ml: 30 }, { pump: 2, name: '오렌지주스', ml: 170 }],
    totalMl: 200,
    estimatedAbv: 6,
    flavor: { sweet: 3, sour: 2, bitter: 0, fizzy: 0, strength: 2 },
    suggestions: RAW_SUG,
  };
  // Gemini 가 제안을 거르지 않고 보냈다고 가정 — 앱 재검증이 걸러야 함 (v2.1 의 "예전 서버 응답 재검증"과 같은 성질)
  for (const adultVerified of [false, true]) {
    const results: { path: string; sug: Suggestion[] }[] = [];
    assert.equal(buildRequest(input, slots, [], 'normal', adultVerified).user.adultVerified, adultVerified, '요청 user.adultVerified');
    const direct = await withFakeFetch({ aiJson: { recipe: aiRecipe, explore: [] } }, async (calls) => {
      const r = await generateRecipe({ input, slots, aiMode: 'gemini', geminiKey: FAKE_KEY, adultVerified });
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.startsWith(GEMINI_PREFIX));
      const prompt: string = calls[0].body.contents[0].parts[0].text;
      assert.equal(prompt.includes('- 성인 확인 전'), !adultVerified, '직접 Gemini 프롬프트의 성인 확인 전 안내');
      return r;
    });
    assert.equal(direct.source, 'direct');
    results.push({ path: 'direct', sug: direct.recipe!.suggestions });
    for (const { path, sug } of results) {
      if (adultVerified) assert.ok(sug.some((s) => s.message.includes('진을 장착하면')), `${path}: ${JSON.stringify(sug)}`);
      else assert.deepEqual(alcoholPushes(sug, ingredients), [], `${path}: ${JSON.stringify(sug)}`);
    }
  }
  // 오프라인: 술이 없는 기기 + 도수 요청
  for (const adultVerified of [false, true]) {
    const r = await generateRecipe({ input, slots: defaultSlots(), aiMode: 'offline', adultVerified });
    const sug = r.recipe!.suggestions;
    if (adultVerified) assert.ok(sug.some((s) => s.type === 'info' && s.message === OFFLINE_NO_ALCOHOL_INFO_ADULT), JSON.stringify(sug));
    else {
      assert.deepEqual(alcoholPushes(sug, []), []);
      assert.ok(sug.some((s) => s.type === 'info' && s.message === OFFLINE_NO_ALCOHOL_INFO), JSON.stringify(sug));
    }
  }
});

// ───────────────────────── §3.3 규칙 8 NO_MIXER explore ─────────────────────────

test('addsSoftIngredient: 무알콜 재료를 새로 더하는 카드 판정 (술 이름·새 재료의 abv·category)', () => {
  const card = (addIngredient: string, category: string, abv: number | undefined, lines: [string, boolean][]) => ({
    addIngredient,
    category,
    ...(abv === undefined ? {} : { abv }),
    ingredients: lines.map(([name, installed]) => ({ name, ml: 100, installed })),
  });
  assert.equal(addsSoftIngredient(card('토닉워터', 'soda', 0, [['보드카', true], ['토닉워터', false]])), true);
  assert.equal(addsSoftIngredient(card('탄산수', 'soda', undefined, [['탄산수', false]])), true, 'abv 없음 = 0');
  assert.equal(addsSoftIngredient(card('진', 'spirit', 40, [['진', false], ['우유', true]])), false, '술만 새로 더함 (우유는 장착 재료)');
  assert.equal(addsSoftIngredient(card('진', 'spirit', 40, [['진', false], ['토닉워터', false]])), true, '두 번째 새 재료가 무알콜');
  assert.equal(addsSoftIngredient(card('라거', 'wine', 5, [['라거', false]])), false, '술 이름 목록에 없어도 새 재료 abv>0');
  assert.equal(addsSoftIngredient(card('무알콜 진', 'spirit', 0, [['무알콜 진', false]])), false, '새 재료 category 가 spirit');
  assert.equal(addsSoftIngredient(card('오렌지 리큐르', 'other', 0, [['오렌지 리큐르', false]])), false, '술 이름(리큐르)');
  assert.equal(addsSoftIngredient(card('그레나딘 시럽', 'syrup', 0, [['그레나딘-시럽', false]])), true, 'normName 일치');
  assert.equal(addsSoftIngredient(card('사이다', 'soda', 0, [['사이다', true]])), false, '장착 줄만');
  assert.equal(addsSoftIngredient(null), false);
  const list = [
    card('진', 'spirit', 40, [['진', false], ['우유', true]]),
    card('토닉워터', 'soda', 0, [['토닉워터', false]]),
    card('맥주', 'wine', 4.5, [['맥주', false]]),
  ];
  const f = filterNoMixerExplore(list);
  assert.deepEqual(f.items.map((x) => x.addIngredient), ['토닉워터']);
  assert.equal(f.removed, 2);
});

const GIN_MILK = { addIngredient: '진', category: 'spirit', abv: 40, recipeName: '진 밀크', ingredients: [{ name: '진', ml: 20 }, { name: '우유', ml: 180 }] };
const TONIC = { addIngredient: '토닉워터', category: 'soda', abv: 0, recipeName: '보드카 토닉', ingredients: [{ name: '보드카', ml: 20 }, { name: '토닉워터', ml: 180 }] };
const BEER = { addIngredient: '맥주', category: 'wine', abv: 4.5, recipeName: '비어', ingredients: [{ name: '맥주', ml: 200 }] };
const LAGER = { addIngredient: '라거', category: 'wine', abv: 5, recipeName: '라거', ingredients: [{ name: '라거', ml: 200 }] };
const CIDER = { addIngredient: '애플 사이더', category: 'wine', abv: 4.5, recipeName: '사이더', ingredients: [{ name: '애플 사이더', ml: 200 }] };
/** 보드카 + 우유(성향으로 제외) + 약하게 → 도수 상한을 맞출 무알콜 재료 없음 (NO_MIXER) */
const MILK_ALLERGY = { slots: [slot(1, '보드카', 'spirit', 40), slot(2, '우유', 'dairy')], u: { ...input, strength: 'light' as Strength, preference: '우유 알레르기' } };
const NO_MIXER_NOTICE = /도수를 맞출 무알콜 재료가 없어요/;

test('NO_MIXER explore — 직접 Gemini(가짜): 술만 새로 더하는 카드는 버림, 0개면 AI 재호출 없이 오프라인 탐색(같은 필터)으로 채움', async () => {
  const run = (ai: unknown, adultVerified = true) =>
    withFakeFetch({ aiJson: ai }, async (calls) => {
      const r = await generateRecipe({
        input: MILK_ALLERGY.u,
        slots: MILK_ALLERGY.slots,
        aiMode: 'gemini',
        geminiKey: FAKE_KEY,
        mode: 'explore',
        adultVerified,
      });
      assert.equal(calls.filter((c) => c.url.startsWith(GEMINI_PREFIX)).length, 1, 'AI 재호출 없음');
      assert.equal(calls.length, 1, '다른 곳으로 넘어가지 않음');
      return r;
    });
  const a = await run({ recipe: null, explore: [GIN_MILK, TONIC, BEER] });
  assert.equal(a.source, 'direct');
  assert.equal(a.recipe, null);
  assert.deepEqual(a.explore.map((x) => x.addIngredient), ['토닉워터']);
  assert.match(a.warnings[0], NO_MIXER_NOTICE);
  // 앞 3장(탐색 최대 개수)이 모두 술만 더함 → 버린 뒤 0개 → 오프라인 탐색으로 채움 (4번째 카드는 최대 개수 밖이라 보지 않음 — 백엔드와 같음)
  // (GIN_MILK 는 성향 제외로 우유 줄이 지워져 도수 상한을 못 맞춰 먼저 빠지므로, 여기서는 '약하게' 상한 안의 술만 카드 3장을 씀)
  const b = await run({ explore: [BEER, LAGER, CIDER, TONIC] });
  assert.equal(b.recipe, null);
  assert.ok(b.explore.length >= 1);
  assert.ok(b.explore.every((x) => addsSoftIngredient(x)), JSON.stringify(b.explore));
  assert.ok(b.warnings.includes('AI 제안에 무알콜 재료를 새로 더하는 카드가 없어 앱이 대신 골랐어요.'), JSON.stringify(b.warnings));
  // AI 가 카드를 하나도 주지 않으면 원래 안내 그대로
  const c = await run({ explore: [] });
  assert.ok(c.explore.length >= 1 && c.explore.every((x) => addsSoftIngredient(x)));
  assert.ok(c.warnings.includes('AI 가 새 재료 제안을 주지 않아 앱이 대신 골랐어요.'), JSON.stringify(c.warnings));
  // 성인 확인 전: 술 장착 카드는 원래 규칙(§5.4)으로 빠지고, 남은 카드도 무알콜 재료를 더하는 것만
  const d = await run({ explore: [GIN_MILK, TONIC] }, false);
  assert.deepEqual(d.explore.map((x) => x.addIngredient), ['토닉워터']);
});

test('NO_MIXER explore — Gemini 응답 재검증(거르지 않은 카드)·오프라인 경로도 같은 필터, 안내 문구는 백엔드 notice 와 같음', async () => {
  // Gemini: recipe:null + 술만 더하는 카드가 섞인 explore (가짜 fetch) — v2.1 의 "예전 서버 응답 재검증" 사례를 Gemini 경로로
  const backendNotice = "지금 장착된 재료로는 '약하게'(최대 5%) 도수를 맞출 무알콜 재료가 없어요. 아래 재료를 장착해 보세요.";
  const s = await withFakeFetch({ aiJson: { recipe: null, explore: [GIN_MILK, TONIC] } }, () =>
    generateRecipe({ input: MILK_ALLERGY.u, slots: MILK_ALLERGY.slots, aiMode: 'gemini', geminiKey: FAKE_KEY, mode: 'explore', adultVerified: true }),
  );
  assert.equal(s.source, 'direct');
  assert.deepEqual(s.explore.map((x) => x.addIngredient), ['토닉워터']);
  assert.equal(s.warnings[0], backendNotice);
  // 오프라인: NO_MIXER 기기에서 나온 카드는 모두 무알콜 재료를 새로 더함
  const cases: { slots: PumpSlot[]; u: UserInput }[] = [
    MILK_ALLERGY,
    { slots: [slot(1, '보드카', 'spirit', 40)], u: { ...input, strength: 'light' } },
    { slots: [slot(1, '보드카', 'spirit', 40), slot(2, '트리플섹', 'liqueur', 30)], u: { ...input, strength: 'strong' } },
    { slots: [slot(1, '보드카', 'spirit', 40), slot(2, '사이다', 'soda', 0, 0)], u: { ...input, strength: 'medium' } },
  ];
  for (const c of cases) {
    for (const adultVerified of [false, true]) {
      const r = await generateRecipe({ input: c.u, slots: c.slots, aiMode: 'offline', mode: 'explore', adultVerified });
      assert.equal(r.recipe, null);
      assert.ok(r.explore.length >= 1, JSON.stringify(c.slots.map((x) => x.name)));
      assert.ok(r.explore.every((x) => addsSoftIngredient(x)), JSON.stringify(r.explore));
      assert.match(r.warnings[0], NO_MIXER_NOTICE);
    }
  }
});

test('NO_MIXER 가 레시피 보정에서 나온 경우(도수 상한 이하 술만 섞을 수 있음)에도 필터, NO_MIXER 가 아니면 필터 안 함', async () => {
  // 보드카 + 맥주(4.5%): lacksMixer 는 false(맥주 ≤ 5%) 이지만 AI 레시피(보드카만)를 약하게로 낮출 무알콜 재료가 없음 → NO_MIXER → recipe:null
  const slots = [slot(1, '보드카', 'spirit', 40), slot(2, '맥주', 'wine', 4.5)];
  const u = { ...input, strength: 'light' as Strength };
  const CIDER = { addIngredient: '사이다', category: 'soda', abv: 0, recipeName: '비어 샌디', ingredients: [{ name: '맥주', ml: 100 }, { name: '사이다', ml: 100 }] };
  const ai = { recipe: { name: '보드카 스트레이트', ingredients: [{ pump: 1, name: '보드카', ml: 200 }] }, explore: [LAGER, CIDER] };
  const r = await withFakeFetch({ aiJson: ai }, () =>
    generateRecipe({ input: u, slots, aiMode: 'gemini', geminiKey: FAKE_KEY, mode: 'explore', adultVerified: true }),
  );
  assert.equal(r.recipe, null);
  assert.deepEqual(r.explore.map((x) => x.addIngredient), ['사이다']);
  assert.match(r.warnings[0], NO_MIXER_NOTICE);
  // 무알콜 재료(오렌지주스)가 있어 레시피가 성립하면 NO_MIXER 아님 → 술 장착 카드(성인 확인)도 그대로
  const slots2 = [slot(1, '보드카', 'spirit', 40), slot(2, '오렌지주스', 'juice')];
  const ai2 = { recipe: { name: '스크루드라이버', ingredients: [{ pump: 1, name: '보드카', ml: 20 }, { pump: 2, name: '오렌지주스', ml: 180 }] }, explore: [LAGER] };
  const r2 = await withFakeFetch({ aiJson: ai2 }, () =>
    generateRecipe({ input: u, slots: slots2, aiMode: 'gemini', geminiKey: FAKE_KEY, mode: 'explore', adultVerified: true }),
  );
  assert.ok(r2.recipe);
  assert.deepEqual(r2.explore.map((x) => x.addIngredient), ['라거']);
});
