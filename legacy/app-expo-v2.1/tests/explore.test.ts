/// <reference types="node" />
/**
 * 탐색(explore) 모드 테스트 — SPEC §5.3 거절 회피, §5.4 explore 파싱·오프라인 후보·펌프 추천
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { exploreToRawRecipe, missingIngredients, nameKey, parseExplore, pumpUsage, recommendPump } from '../src/lib/ai/explore';
import { normalizeRecipe } from '../src/lib/ai/normalize';
import { comboKey, offlineRecipe, rejectedCombos } from '../src/lib/ai/offline';
import { exploreCandidates, offlineExplore } from '../src/lib/ai/offline-explore';
import { buildResponseSchema, buildUserPrompt, DEFAULT_GEMINI_MODEL } from '../src/lib/ai/prompt';
import { buildRequest, generateRecipe, parseServerBody, splitGeminiJson } from '../src/lib/ai/recommend';
import { defaultSlots, emptySlot } from '../src/lib/presets';
import type { HistoryHint, IngredientInfo, PumpSlot, UserInput } from '../src/lib/types';

const input: UserInput = {
  moods: ['피곤함'],
  taste: { sweet: 3, sour: 3, bitter: 0, fizzy: 4 },
  strength: 'none',
  weather: null,
  situation: '',
  preference: '',
  cupMl: 200,
};

const ING: IngredientInfo[] = [
  { pump: 1, name: '사이다', category: 'soda', abv: 0, remainingMl: 1000, notes: '' },
  { pump: 3, name: '레몬즙', category: 'juice', abv: 0, remainingMl: 500, notes: '' },
];

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

// ───────────────────────── parseExplore ─────────────────────────

test('parseExplore: installed·pump 를 이름(공백·대소문자 무시)으로 다시 계산 + ml 합 = cupMl', () => {
  const items = parseExplore(
    [
      {
        addIngredient: '토닉워터',
        category: 'soda',
        abv: 0,
        recipeName: '시트러스 토닉',
        description: '쌉싸름하고 청량한',
        ingredients: [
          { name: '레몬 즙', ml: 20, installed: false, pump: 9 }, // AI 가 틀리게 표시 → 앱이 장착됨(펌프 3)으로 고침
          { name: '토닉 워터', ml: 160, installed: true, pump: 1 }, // AI 가 틀리게 표시 → 미장착
        ],
        message: '',
      },
    ],
    { ingredients: ING, strength: 'none', cupMl: 200, mode: 'explore' },
  );
  assert.equal(items.length, 1);
  const it = items[0];
  assert.deepEqual(
    it.ingredients.map((i) => [i.name, i.installed, i.pump ?? null]),
    [
      ['레몬즙', true, 3],
      ['토닉워터', false, null],
    ],
  );
  assert.equal(Math.round(it.ingredients.reduce((a, b) => a + b.ml, 0) * 10) / 10, 200);
  assert.ok(it.message.includes('토닉워터'), '메시지 기본값');
  assert.deepEqual(missingIngredients(it), ['토닉워터']);
});

test('parseExplore: 이미 장착된 재료·미장착 0개/3개·무알콜 요청의 술은 버림, normal 모드는 최대 1개', () => {
  const raw = [
    { addIngredient: '사이다', ingredients: [{ name: '사이다', ml: 100 }] }, // 이미 장착
    { addIngredient: '보드카', abv: 40, ingredients: [{ name: '보드카', ml: 40 }, { name: '사이다', ml: 160 }] }, // 무알콜에 술
    { addIngredient: '우유', ingredients: [{ name: '우유', ml: 100 }, { name: '꿀', ml: 10 }, { name: '시나몬', ml: 5 }] }, // 미장착 3개
    { addIngredient: '탄산수', ingredients: [{ name: '사이다', ml: 100 }] }, // 새 재료가 레시피에 없음
    { addIngredient: '그레나딘 시럽', ingredients: [{ name: '그레나딘시럽', ml: 15 }, { name: '사이다', ml: 185 }] },
    { addIngredient: '크랜베리주스', ingredients: [{ name: '크랜베리주스', ml: 100 }, { name: '사이다', ml: 100 }] },
  ];
  const ex = parseExplore(raw, { ingredients: ING, strength: 'none', cupMl: 200, mode: 'explore' });
  assert.deepEqual(ex.map((e) => e.addIngredient), ['그레나딘 시럽', '크랜베리주스']);
  assert.equal(ex[0].category, 'syrup', '프리셋으로 카테고리 추정');
  const normal = parseExplore(raw, { ingredients: ING, strength: 'none', cupMl: 200, mode: 'normal' });
  assert.equal(normal.length, 1);
  assert.deepEqual(parseExplore('x', { ingredients: ING, strength: 'none', cupMl: 200, mode: 'explore' }), []);
});

test('서버 응답: explore 모드는 recipe:null 허용, normal 모드는 recipe 필수', () => {
  const r = parseServerBody(200, { ok: true, source: 'fallback', recipe: null, explore: [{ addIngredient: '탄산수' }] }, 'explore');
  assert.equal(r.recipe, null);
  assert.equal(r.source, 'fallback');
  assert.throws(() => parseServerBody(200, { ok: true, recipe: null, explore: [] }, 'normal'), /v2/);
  assert.throws(() => parseServerBody(200, { ok: true }, 'explore'), /explore/);
  assert.throws(() => parseServerBody(422, { ok: false, error: '재료 없음' }, 'normal'), /재료 없음/);
  // Gemini 직접 모드 응답
  assert.deepEqual(splitGeminiJson({ recipe: { name: 'a' }, explore: [] }), { recipe: { name: 'a' }, explore: [] });
  assert.deepEqual(splitGeminiJson({ name: 'old', ingredients: [] }), { recipe: { name: 'old', ingredients: [] }, explore: [] });
});

// ───────────────────────── 오프라인 explore (SPEC §5.4 후보 목록) ─────────────────────────

test('후보 조건: 탄산수(soda 없음+fizzy≥2) → 토닉 → 레몬즙 → 설탕시럽 → 그레나딘 → 크랜베리 순', () => {
  const req = buildRequest({ ...input, taste: { sweet: 3, sour: 3, bitter: 0, fizzy: 4 } }, [slot(1, '오렌지주스', 'juice')], [], 'explore');
  assert.deepEqual(
    exploreCandidates(req).map((c) => c.name),
    ['탄산수', '토닉워터', '레몬즙', '설탕시럽', '그레나딘 시럽', '크랜베리주스'],
  );
  // soda·syrup 장착, 산미 재료 있음, juice 2개 → 토닉은 bitter≥2 일 때만
  const full = [slot(1, '사이다', 'soda'), slot(2, '레몬즙', 'juice'), slot(3, '오렌지주스', 'juice'), slot(4, '설탕시럽', 'syrup')];
  // 조건을 만족하는 후보가 없음 → 탄산수 → 레몬즙 → 설탕시럽 으로 채우되, 이미 장착된 레몬즙·설탕시럽은 제외
  assert.deepEqual(exploreCandidates(buildRequest(input, full, [], 'explore')).map((c) => c.name), ['탄산수']);
});

test('후보: 조건이 하나도 맞지 않으면 탄산수 → 레몬즙 → 설탕시럽 (장착된 이름은 제외)', () => {
  const full = [slot(1, '사이다', 'soda'), slot(2, '자몽주스', 'juice'), slot(3, '오렌지주스', 'juice'), slot(4, '꿀시럽', 'syrup')];
  const req = buildRequest({ ...input, taste: { sweet: 0, sour: 0, bitter: 0, fizzy: 0 } }, full, [], 'explore');
  assert.deepEqual(exploreCandidates(req).map((c) => c.name), ['탄산수', '레몬즙', '설탕시럽']);
  // normal 모드는 채우지 않음 → 0개
  assert.deepEqual(exploreCandidates(req, {}, false), []);
});

test('후보: 술은 strength≠none 이고 만 19세 확인된 경우만 (진·보드카·화이트 럼, 트리플섹 모두 — SPEC §5.4)', () => {
  const s = [slot(1, '사이다', 'soda'), slot(2, '레몬즙', 'juice'), slot(3, '오렌지주스', 'juice'), slot(4, '설탕시럽', 'syrup')];
  const t = { sweet: 0, sour: 0, bitter: 0, fizzy: 0 };
  const none = exploreCandidates(buildRequest({ ...input, taste: t, strength: 'none' }, s, [], 'explore'), { adultVerified: true });
  assert.ok(!none.some((c) => c.abv > 0));
  const notAdult = exploreCandidates(buildRequest({ ...input, taste: t, strength: 'medium' }, s, [], 'explore'), { adultVerified: false });
  // 술 후보가 모두 빠져 조건을 만족하는 후보가 0개 → 탄산수 → 레몬즙 → 설탕시럽 순으로 채움(장착된 것 제외)
  assert.deepEqual(notAdult.map((c) => c.name), ['탄산수']);
  // 옵션을 생략하면 요청의 user.adultVerified 를 씀
  assert.deepEqual(exploreCandidates(buildRequest({ ...input, taste: t, strength: 'medium' }, s, [], 'explore', false)).map((c) => c.name), ['탄산수']);
  assert.deepEqual(exploreCandidates(buildRequest({ ...input, taste: t, strength: 'medium' }, s, [], 'explore', true)).map((c) => c.name), ['진', '트리플섹']);
  const adult = exploreCandidates(buildRequest({ ...input, taste: t, strength: 'medium' }, s, [], 'explore'), { adultVerified: true });
  assert.deepEqual(adult.map((c) => [c.name, c.abv]), [
    ['진', 40],
    ['트리플섹', 30],
  ]);
});

test('후보: 우유는 dairy 미장착 + 휴식/디저트 상황', () => {
  const s = [slot(1, '사이다', 'soda'), slot(2, '레몬즙', 'juice'), slot(3, '오렌지주스', 'juice'), slot(4, '설탕시럽', 'syrup')];
  const t = { sweet: 0, sour: 0, bitter: 0, fizzy: 0 };
  assert.deepEqual(exploreCandidates(buildRequest({ ...input, taste: t, situation: '휴식' }, s, [], 'explore')).map((c) => c.name), ['우유']);
  assert.deepEqual(exploreCandidates(buildRequest({ ...input, taste: t, preference: '디저트로' }, s, [], 'explore')).map((c) => c.name), ['우유']);
});

test('후보: 거절 기록에 2번 이상 나온 재료는 제외', () => {
  const rejected: HistoryHint[] = [
    { name: 'a', liked: false, rejected: true, ingredients: [{ name: '탄산수', ml: 100 }] },
    { name: 'b', liked: false, rejected: true, ingredients: [{ name: '탄산수', ml: 80 }, { name: '오렌지주스', ml: 20 }] },
    { name: 'c', liked: false, rejected: false, ingredients: [{ name: '토닉워터', ml: 100 }] }, // 👎 는 거절이 아님
    { name: 'd', liked: false, rejected: true, ingredients: [{ name: '토닉워터', ml: 100 }] }, // 1번뿐
  ];
  const names = exploreCandidates(buildRequest(input, [slot(1, '오렌지주스', 'juice')], rejected, 'explore')).map((c) => c.name);
  assert.ok(!names.includes('탄산수'));
  assert.ok(names.includes('토닉워터'));
});

test('offlineExplore: normal 모드 0~1개, explore 모드 1~3개, 미장착은 1개 (짝 재료가 없을 때만 2개)', () => {
  const slots = defaultSlots(); // 사이다·오렌지주스·레몬즙·콜라
  for (const strength of ['none', 'light'] as const) {
    const ex = offlineExplore(buildRequest({ ...input, strength }, slots, [], 'explore'), { adultVerified: true });
    assert.ok(ex.length >= 1 && ex.length <= 3, `explore ${ex.length}개`);
    const parsed = parseExplore(ex, { ingredients: buildRequest(input, slots).ingredients, strength, cupMl: 200, mode: 'explore', adultVerified: true });
    assert.equal(parsed.length, ex.length, '오프라인 결과는 모두 검증 통과');
    for (const p of parsed) {
      assert.equal(p.ingredients.filter((i) => !i.installed).length, 1);
      assert.equal(Math.round(p.ingredients.reduce((a, b) => a + b.ml, 0)), 200);
      if (strength === 'none') assert.ok(p.abv === 0);
    }
  }
  const normal = offlineExplore(buildRequest(input, slots, [], 'normal'));
  assert.ok(normal.length <= 1);
  // 빈 기기: 새 재료 2개짜리 레시피
  const empty = offlineExplore(buildRequest(input, [emptySlot(1), emptySlot(2)], [], 'explore'));
  assert.ok(empty.length >= 1);
  const pe = parseExplore(empty, { ingredients: [], strength: 'none', cupMl: 200, mode: 'explore' });
  assert.ok(pe.length >= 1);
  assert.ok(pe.every((p) => p.ingredients.every((i) => !i.installed) && p.ingredients.length <= 2));
});

test('offlineExplore: 레몬즙·시럽은 상한(15%·10%) 이하, 술은 목표 도수 근처', () => {
  const slots = [slot(1, '사이다', 'soda'), slot(2, '오렌지주스', 'juice')];
  const ex = parseExplore(
    offlineExplore(buildRequest({ ...input, taste: { sweet: 4, sour: 4, bitter: 0, fizzy: 0 } }, slots, [], 'explore')),
    { ingredients: buildRequest(input, slots).ingredients, strength: 'none', cupMl: 200, mode: 'explore' },
  );
  for (const e of ex) {
    for (const i of e.ingredients) {
      if (/레몬즙/.test(i.name)) assert.ok(i.ml <= 200 * 0.15 + 1, `레몬즙 ${i.ml}`);
      if (/시럽/.test(i.name)) assert.ok(i.ml <= 200 * 0.1 + 1, `시럽 ${i.ml}`);
    }
  }
  const s2 = [slot(1, '오렌지주스', 'juice'), slot(2, '사이다', 'soda')];
  const req = buildRequest({ ...input, strength: 'medium', taste: { sweet: 0, sour: 0, bitter: 0, fizzy: 0 } }, s2, [], 'explore');
  const gin = parseExplore(offlineExplore(req, { adultVerified: true }), { ingredients: req.ingredients, strength: 'medium', cupMl: 200, mode: 'explore', adultVerified: true }).find(
    (e) => e.addIngredient === '진',
  )!;
  assert.ok(gin, '진 후보');
  const ginMl = gin.ingredients.find((i) => i.name === '진')!.ml;
  const abv = (ginMl * 40) / 200;
  assert.ok(abv >= 5 && abv <= 12, `완성 도수 ${abv}%`);
});

// ───────────────────────── 거절 회피 (SPEC §5.3) ─────────────────────────

test('거절 회피: 오프라인 추천은 거절한 레시피와 같은 재료 조합을 내지 않음', () => {
  const slots = defaultSlots();
  const base = buildRequest(input, slots);
  const first = offlineRecipe(base, { variation: 3 }) as any;
  const firstCombo = comboKey(first.ingredients.map((i: any) => i.name));
  const history: HistoryHint[] = [{ name: first.name, liked: false, rejected: true, ingredients: first.ingredients }];
  assert.ok(rejectedCombos(history).has(firstCombo));
  for (let v = 0; v < 15; v++) {
    const next = offlineRecipe(buildRequest(input, slots, history), { variation: 3 + v }) as any;
    assert.notEqual(comboKey(next.ingredients.map((i: any) => i.name)), firstCombo, `variation ${3 + v}`);
  }
});

test('거절 회피: 두 번 거절해도 다음 추천은 재료 2가지 이상 (그냥 음료 한 가지로 도망가지 않음)', () => {
  const slots = defaultSlots();
  const base: UserInput = { ...input, moods: [], taste: { sweet: 3, sour: 2, bitter: 0, fizzy: 3 } };
  let single = 0;
  for (let v = 0; v < 30; v++) {
    const hist: HistoryHint[] = [];
    for (let round = 0; round < 3; round++) {
      const r = offlineRecipe(buildRequest(base, slots, hist), { variation: v * 1000 + round }) as any;
      if (round === 2 && r.ingredients.length < 2) single++;
      hist.push({ name: r.name, liked: false, rejected: true, ingredients: r.ingredients });
    }
  }
  assert.equal(single, 0, `30번 중 ${single}번 한 가지 재료`);
});

test('거절 회피: 탐색 항목도 거절한 조합은 만들지 않음', () => {
  const slots = [slot(1, '오렌지주스', 'juice'), slot(2, '사이다', 'soda')];
  const req = buildRequest(input, slots, [], 'explore');
  const first = parseExplore(offlineExplore(req), { ingredients: req.ingredients, strength: 'none', cupMl: 200, mode: 'explore' })[0];
  const hist: HistoryHint[] = [
    { name: first.recipeName, liked: false, rejected: true, ingredients: first.ingredients.map((i) => ({ name: i.name, ml: i.ml })) },
  ];
  const again = parseExplore(offlineExplore(buildRequest(input, slots, hist, 'explore')), {
    ingredients: req.ingredients,
    strength: 'none',
    cupMl: 200,
    mode: 'explore',
  });
  const key = comboKey(first.ingredients.map((i) => i.name));
  assert.ok(again.every((e) => comboKey(e.ingredients.map((i) => i.name)) !== key));
});

test('요청 본문: mode·history(최신 기록부터 최대 10개 — SPEC §3.1, liked/rejected) 포함', () => {
  // 입력도 최신 기록부터: h13(가장 최근) … h0(가장 오래됨)
  const hist: HistoryHint[] = Array.from({ length: 14 }, (_, k) => {
    const i = 13 - k;
    return {
      name: `h${i}`,
      liked: i % 3 === 0,
      rejected: i % 3 === 1,
      ingredients: [{ name: '사이다', ml: 100 }],
    };
  });
  const req = buildRequest(input, defaultSlots(), hist, 'explore');
  assert.equal(req.mode, 'explore');
  assert.equal(req.history.length, 10);
  assert.equal(req.history[0].name, 'h13', '맨 앞 = 가장 최근');
  assert.equal(req.history[9].name, 'h4', '최근 10개까지 (h3~h0 은 버림)');
  assert.equal(req.history[0].rejected, true, 'h13 = 거절');
  assert.equal(req.history[0].liked, false);
  assert.equal(req.history[1].liked, true, 'h12 = 좋아요');
  assert.equal(req.history[1].rejected, false);
  assert.equal(buildRequest(input, defaultSlots()).mode, 'normal');
});

test('직접 Gemini 프롬프트: 거절 표시·explore 지시·스키마(pump enum, explore) + 기본 모델', () => {
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.6-flash');
  const req = buildRequest(input, defaultSlots(), [{ name: '거절된 잔', liked: false, rejected: true, ingredients: [{ name: '콜라', ml: 200 }] }], 'explore');
  const text = buildUserPrompt(req);
  assert.match(text, /거절\(다른 추천 요청\)/);
  assert.match(text, /explore/);
  const schema: any = buildResponseSchema(req);
  assert.deepEqual(schema.required, ['recipe', 'explore']);
  assert.deepEqual(schema.properties.recipe.properties.ingredients.items.properties.pump.enum, [1, 2, 3, 4]);
  assert.ok(schema.properties.explore.items.required.includes('addIngredient'));
  // 빈 기기: enum 없음(빈 enum 은 잘못된 스키마)
  const empty: any = buildResponseSchema(buildRequest(input, [emptySlot(1)], [], 'explore'));
  assert.equal(empty.properties.recipe.properties.ingredients.items.properties.pump.enum, undefined);
});

// ───────────────────────── 펌프 추천 + generateRecipe ─────────────────────────

test('recommendPump: 빈 펌프 우선 → 없으면 기록상 가장 적게 쓰인 펌프(레시피에 쓰는 펌프는 피함)', () => {
  const item = parseExplore(
    [{ addIngredient: '토닉워터', ingredients: [{ name: '레몬즙', ml: 20 }, { name: '토닉워터', ml: 180 }] }],
    { ingredients: ING, strength: 'none', cupMl: 200, mode: 'explore' },
  )[0];
  const withEmpty = [slot(1, '사이다', 'soda'), emptySlot(2), slot(3, '레몬즙', 'juice'), emptySlot(4)];
  assert.deepEqual(recommendPump(withEmpty, new Map(), item), { pump: 2, reason: 'empty' });

  const full = [slot(1, '사이다', 'soda'), slot(2, '콜라', 'soda'), slot(3, '레몬즙', 'juice'), slot(4, '오렌지주스', 'juice')];
  const entries = [
    { recipe: { ingredients: [{ pump: 1, name: '사이다' }, { pump: 2, name: '콜라' }] } },
    { recipe: { ingredients: [{ pump: 1, name: '사이다' }, { pump: 4, name: '오렌지주스' }] } },
    { recipe: { ingredients: [{ pump: 3, name: '레몬즙' }, { pump: 4, name: '오렌지주스' }] } },
    { recipe: { ingredients: [{ pump: 2, name: '진저에일' }] } }, // 예전 재료 → 지금 콜라 사용 횟수에 안 셈
  ];
  const usage = pumpUsage(full, entries);
  assert.deepEqual([...usage.entries()], [
    [1, 2],
    [2, 1],
    [3, 1],
    [4, 2],
  ]);
  const pick = recommendPump(full, usage, item)!;
  assert.equal(pick.pump, 2, '펌프 3(레몬즙)은 레시피에 필요하므로 제외, 남은 것 중 최소 사용');
  assert.equal(pick.reason, 'least_used');
  assert.equal(pick.current, '콜라');
});

test('generateRecipe: explore 모드 + 빈 기기(오프라인) → recipe:null + explore 1~3개', async () => {
  const res = await generateRecipe({ input, slots: [emptySlot(1), emptySlot(2)], aiMode: 'offline', serverUrl: '', mode: 'explore' });
  assert.equal(res.mode, 'explore');
  assert.equal(res.recipe, null);
  assert.ok(res.explore.length >= 1 && res.explore.length <= 3);
});

test('generateRecipe: explore 모드 + 재료 있음 → 지금 재료 레시피도 함께, 서버 실패 시 오프라인', async () => {
  const res = await generateRecipe({
    input,
    slots: defaultSlots(),
    aiMode: 'server',
    serverUrl: 'http://127.0.0.1:9/api',
    timeoutMs: 3000,
    mode: 'explore',
  });
  assert.equal(res.source, 'offline');
  assert.ok(res.recipe && res.recipe.totalMl === 200);
  assert.ok(res.explore.length >= 1);
  assert.ok(res.fallbackReason);
});

test('generateRecipe: 탐색 카드로 장착 후 재요청(target) → 오프라인이면 "해당 레시피" 그대로', async () => {
  const before = [slot(1, '오렌지주스', 'juice'), emptySlot(2)];
  const ex = await generateRecipe({ input, slots: before, aiMode: 'offline', serverUrl: '', mode: 'explore' });
  const target = ex.explore[0];
  assert.ok(target);
  const after = [slot(1, '오렌지주스', 'juice'), slot(2, target.addIngredient, target.category, target.abv)];
  const res = await generateRecipe({ input, slots: after, aiMode: 'offline', serverUrl: '', mode: 'normal', target });
  assert.equal(res.mode, 'normal');
  assert.equal(res.recipe!.name, target.recipeName);
  assert.ok(res.recipe!.ingredients.some((i) => nameKey(i.name) === nameKey(target.addIngredient)));
  // exploreToRawRecipe 는 normalize 를 통과
  assert.ok(normalizeRecipe(exploreToRawRecipe(target), { ingredients: buildRequest(input, after).ingredients, strength: 'none', cupMl: 200 }).recipe);
});
