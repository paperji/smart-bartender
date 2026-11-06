/// <reference types="node" />
/**
 * SPEC §3.3 레시피 검증·보정 규칙 1~9 테스트 (+ 백엔드 recipe.js 와 결과 비교)
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

import { abvToStrengthLevel } from '../src/lib/ai/flavor';
import { capStrength, clampCup, normalizeRecipe, RecipeError, revalidateRecipe, strengthForAbv } from '../src/lib/ai/normalize';
import type { IngredientInfo, Strength } from '../src/lib/types';

const ING: IngredientInfo[] = [
  { pump: 1, name: '보드카', category: 'spirit', abv: 40, remainingMl: 650, notes: '' },
  { pump: 2, name: '오렌지주스', category: 'juice', abv: 0, remainingMl: 900, notes: '' },
  { pump: 3, name: '레몬즙', category: 'juice', abv: 0, remainingMl: 30, notes: '' },
  { pump: 4, name: '사이다', category: 'soda', abv: 0, remainingMl: 1000, notes: '' },
];

const sum = (xs: { ml: number }[]) => Math.round(xs.reduce((a, b) => a + b.ml, 0) * 10) / 10;

test('1. 장착되지 않은 재료 제거 + 같은 펌프 합산', () => {
  const { recipe, warnings } = normalizeRecipe(
    {
      name: 't',
      ingredients: [
        { pump: 2, name: '오렌지주스', ml: 50 },
        { pump: 9, name: '없는재료', ml: 50 },
        { pump: 2, name: '오렌지주스', ml: 50 },
        { pump: 4, name: '사이다', ml: 100 },
      ],
    },
    { ingredients: ING, strength: 'none', cupMl: 200 },
  );
  assert.deepEqual(
    recipe.ingredients.map((i) => [i.pump, i.ml]),
    [
      [2, 100],
      [4, 100],
    ],
  );
  assert.ok(warnings.some((w) => w.includes('없는재료')));
  assert.ok(warnings.some((w) => w.includes('합쳤어요')));
});

test('1-b. 이름 정확 일치가 펌프 번호보다 우선 (펌프 번호가 틀려도 이름으로 매칭)', () => {
  const { recipe } = normalizeRecipe(
    { ingredients: [{ pump: 2, name: '사이다', ml: 200 }] }, // 펌프 2 는 오렌지주스지만 이름은 사이다
    { ingredients: ING, strength: 'none', cupMl: 200 },
  );
  assert.equal(recipe.ingredients[0].pump, 4);
  assert.equal(recipe.ingredients[0].name, '사이다');
  // 이름이 없거나 모르는 이름이면 펌프 번호로
  const r2 = normalizeRecipe({ ingredients: [{ pump: 2, ml: 200 }] }, { ingredients: ING, strength: 'none', cupMl: 200 });
  assert.equal(r2.recipe.ingredients[0].name, '오렌지주스');
  // 공백·대소문자·기호 무시
  const r3 = normalizeRecipe({ ingredients: [{ name: '오렌지 주스', ml: 200 }] }, { ingredients: ING, strength: 'none', cupMl: 200 });
  assert.equal(r3.recipe.ingredients[0].pump, 2);
});

test('1-c. 합산 전 음수는 0 (음수가 다른 항목을 깎지 않음)', () => {
  const { recipe } = normalizeRecipe(
    {
      ingredients: [
        { pump: 2, name: '오렌지주스', ml: 100 },
        { pump: 2, name: '오렌지주스', ml: -50 },
        { pump: 4, name: '사이다', ml: 100 },
      ],
    },
    { ingredients: ING, strength: 'none', cupMl: 200 },
  );
  assert.deepEqual(recipe.ingredients.map((i) => i.ml), [100, 100]);
});

test('2. strength=none 이면 알코올 재료 제거', () => {
  const { recipe } = normalizeRecipe(
    {
      ingredients: [
        { pump: 1, name: '보드카', ml: 50 },
        { pump: 2, name: '오렌지주스', ml: 150 },
      ],
    },
    { ingredients: ING, strength: 'none', cupMl: 200 },
  );
  assert.equal(recipe.ingredients.length, 1);
  assert.equal(recipe.ingredients[0].pump, 2);
  assert.equal(recipe.estimatedAbv, 0);
  assert.equal(recipe.flavor.strength, 0);
});

test('3. 음수 → 0 제거, 소수 1자리 반올림', () => {
  const { recipe } = normalizeRecipe(
    {
      ingredients: [
        { pump: 2, name: '오렌지주스', ml: 33.333 },
        { pump: 4, name: '사이다', ml: -5 },
        { pump: 1, name: '보드카', ml: 0 },
      ],
    },
    { ingredients: ING, strength: 'medium', cupMl: 100, scaleToCup: false },
  );
  assert.deepEqual(recipe.ingredients, [{ pump: 2, name: '오렌지주스', ml: 33.3 }]);
});

test('4. 총량을 cupMl 에 맞게 비례 보정 (합계 정확히 일치)', () => {
  const { recipe } = normalizeRecipe(
    {
      ingredients: [
        { pump: 2, name: '오렌지주스', ml: 1 },
        { pump: 4, name: '사이다', ml: 2 },
      ],
    },
    { ingredients: ING, strength: 'none', cupMl: 250 },
  );
  assert.equal(recipe.totalMl, 250);
  assert.equal(sum(recipe.ingredients), 250);
  assert.equal(recipe.ingredients[0].ml, 83.3);
  assert.equal(recipe.ingredients[1].ml, 166.7);
});

test('4-b. 반올림 나머지는 가장 많은 재료에 더함', () => {
  // 1:1:1 → 200/3 = 66.7 ×3 = 200.1 → 나머지 -0.1 은 (같으면 첫) 최대 재료에
  const { recipe } = normalizeRecipe(
    {
      ingredients: [
        { pump: 2, name: '오렌지주스', ml: 10 },
        { pump: 4, name: '사이다', ml: 10 },
        { pump: 3, name: '레몬즙', ml: 10 },
      ],
    },
    { ingredients: [...ING.slice(0, 2), { ...ING[2], remainingMl: 500 }, ING[3]], strength: 'none', cupMl: 200 },
  );
  assert.equal(sum(recipe.ingredients), 200);
  assert.deepEqual(recipe.ingredients.map((i) => i.ml), [66.6, 66.7, 66.7]);
});

test('4-c. cupMl 허용 범위 30~500, 기본 200', () => {
  assert.equal(clampCup(undefined), 200);
  assert.equal(clampCup(10), 30);
  assert.equal(clampCup(9999), 500);
  assert.equal(clampCup('300'), 300);
});

test('5. 잔량 초과 시 잔량까지만(내림) + low_stock 제안, totalMl 은 cupMl 보다 작아질 수 있음', () => {
  const { recipe } = normalizeRecipe(
    {
      ingredients: [
        { pump: 3, name: '레몬즙', ml: 40 },
        { pump: 4, name: '사이다', ml: 160 },
      ],
    },
    { ingredients: ING, strength: 'none', cupMl: 200 },
  );
  const lemon = recipe.ingredients.find((i) => i.pump === 3)!;
  assert.equal(lemon.ml, 30);
  assert.ok(recipe.suggestions.some((s) => s.type === 'low_stock' && s.pump === 3));
  assert.equal(recipe.totalMl, 190);
  // 내림: 잔량 12.37 → 12.3
  const r2 = normalizeRecipe(
    { ingredients: [{ pump: 3, name: '레몬즙', ml: 100 }] },
    { ingredients: [{ ...ING[2], remainingMl: 12.37 }], strength: 'none', cupMl: 100 },
  );
  assert.equal(r2.recipe.ingredients[0].ml, 12.3);
});

test('6. 재료당 최대 300ml (펌웨어 maxStepMl)', () => {
  const { recipe, warnings } = normalizeRecipe(
    { ingredients: [{ pump: 4, name: '사이다', ml: 400 }] },
    { ingredients: ING, strength: 'none', cupMl: 400 },
  );
  assert.equal(recipe.ingredients[0].ml, 300);
  assert.equal(recipe.totalMl, 300);
  assert.ok(warnings.some((w) => w.includes('300ml')));
  // 큰 잔(500ml)에 2가지: 450/50 → 300/50 (나머지는 자르기만)
  const r2 = normalizeRecipe(
    {
      ingredients: [
        { pump: 4, name: '사이다', ml: 90 },
        { pump: 2, name: '오렌지주스', ml: 10 },
      ],
    },
    { ingredients: ING, strength: 'none', cupMl: 500 },
  );
  assert.deepEqual(r2.recipe.ingredients.map((i) => [i.pump, i.ml]), [
    [4, 300],
    [2, 50],
  ]);
  // 기기가 알려준 다른 한도
  const r3 = normalizeRecipe({ ingredients: [{ pump: 4, name: '사이다', ml: 200 }] }, { ingredients: ING, strength: 'none', cupMl: 200, maxStepMl: 150 });
  assert.equal(r3.recipe.ingredients[0].ml, 150);
});

test('7. 재료가 하나도 남지 않으면 오류', () => {
  assert.throws(
    () =>
      normalizeRecipe(
        { ingredients: [{ pump: 1, name: '보드카', ml: 100 }] },
        { ingredients: ING, strength: 'none', cupMl: 200 },
      ),
    RecipeError,
  );
  assert.throws(() => normalizeRecipe(null, { ingredients: ING, strength: 'none' }), RecipeError);
  // 잔량이 모두 0
  assert.throws(
    () =>
      normalizeRecipe(
        { ingredients: [{ pump: 2, name: '오렌지주스', ml: 100 }] },
        { ingredients: [{ ...ING[1], remainingMl: 0 }], strength: 'none', cupMl: 100 },
      ),
    (e: unknown) => e instanceof RecipeError && e.code === 'EMPTY_RECIPE',
  );
});

test('8. 도수 상한: light ≤5%, medium ≤12%, strong ≤20% — 술을 줄이고 무알콜을 늘려 총량 유지', () => {
  const raw = {
    ingredients: [
      { pump: 1, name: '보드카', ml: 100 }, // 100/200 = 20%
      { pump: 2, name: '오렌지주스', ml: 100 },
    ],
  };
  const caps: [Strength, number][] = [
    ['light', 5],
    ['medium', 12],
    ['strong', 20],
  ];
  for (const [strength, max] of caps) {
    const { recipe, capped, warnings } = normalizeRecipe(raw, { ingredients: ING, strength, cupMl: 200 });
    assert.ok(recipe.estimatedAbv <= max, `${strength}: ${recipe.estimatedAbv}% > ${max}%`);
    assert.ok(Math.abs(recipe.totalMl - 200) <= 0.2, `${strength}: 총량 ${recipe.totalMl}`);
    if (strength !== 'strong') {
      assert.equal(capped, true);
      assert.ok(warnings.some((w) => w.includes('술을 줄이고')));
    }
  }
  // 20% 이하인 strong 은 그대로
  const strong = normalizeRecipe(raw, { ingredients: ING, strength: 'strong', cupMl: 200 });
  assert.equal(strong.recipe.estimatedAbv, 20);
  assert.equal(strong.capped, false);
});

test('8-b. 레시피에 무알콜 재료가 없으면 장착된 무알콜 재료(탄산 우선) 1개 추가', () => {
  const { recipe } = normalizeRecipe(
    { ingredients: [{ pump: 1, name: '보드카', ml: 200 }] }, // 40%
    { ingredients: ING, strength: 'medium', cupMl: 200 },
  );
  assert.ok(recipe.estimatedAbv <= 12);
  const added = recipe.ingredients.find((i) => i.pump !== 1)!;
  assert.equal(added.name, '사이다', '탄산 > 주스 > 물 순');
  assert.equal(recipe.ingredients[recipe.ingredients.length - 1].name, '사이다', '무알콜은 마지막(탄산 손실 방지)');
});

test('8-c. 늘린 무알콜 재료도 잔량·300ml 한도를 넘지 않음 (넘으면 술을 더 줄여 상한 유지)', () => {
  const ing: IngredientInfo[] = [
    { pump: 1, name: '보드카', category: 'spirit', abv: 40, remainingMl: 1000, notes: '' },
    { pump: 2, name: '토닉워터', category: 'soda', abv: 0, remainingMl: 1000, notes: '' },
  ];
  // 500ml 잔, 보드카 300 + 토닉 200 → 24% → light(5%) 로 맞추려면 토닉이 437ml 필요 → 300 에서 자름
  const { recipe } = normalizeRecipe(
    {
      ingredients: [
        { pump: 1, name: '보드카', ml: 300 },
        { pump: 2, name: '토닉워터', ml: 200 },
      ],
    },
    { ingredients: ing, strength: 'light', cupMl: 500 },
  );
  for (const i of recipe.ingredients) assert.ok(i.ml <= 300, `${i.name} ${i.ml}ml > 300`);
  assert.ok(recipe.estimatedAbv <= 5, `${recipe.estimatedAbv}%`);
  // 잔량 제한
  const r2 = normalizeRecipe(
    { ingredients: [{ pump: 1, name: '보드카', ml: 100 }, { pump: 2, name: '토닉워터', ml: 100 }] },
    { ingredients: [ing[0], { ...ing[1], remainingMl: 120 }], strength: 'light', cupMl: 200 },
  );
  assert.ok(r2.recipe.ingredients.find((i) => i.pump === 2)!.ml <= 120);
  assert.ok(r2.recipe.estimatedAbv <= 5);
});

test('8-d. 섞을 무알콜 재료가 없으면 상한을 지킬 수 없음 → 오류 NO_MIXER (백엔드와 같음, 독한 술을 그대로 내지 않음)', () => {
  const only: IngredientInfo[] = [{ pump: 1, name: '보드카', category: 'spirit', abv: 40, remainingMl: 700, notes: '' }];
  assert.throws(
    () => normalizeRecipe({ ingredients: [{ pump: 1, name: '보드카', ml: 50 }] }, { ingredients: only, strength: 'light', cupMl: 50 }),
    (e: any) => e instanceof RecipeError && e.code === 'NO_MIXER' && /무알콜/.test(e.message) && /5%/.test(e.message),
  );
  // 무알콜 재료가 있어도 잔량이 10ml 미만이면 섞을 재료로 쓰지 않음 → NO_MIXER
  assert.throws(
    () =>
      normalizeRecipe(
        { ingredients: [{ pump: 1, name: '보드카', ml: 200 }] },
        { ingredients: [...only, { pump: 2, name: '사이다', category: 'soda', abv: 0, remainingMl: 8, notes: '' }], strength: 'strong', cupMl: 200 },
      ),
    (e: any) => e.code === 'NO_MIXER',
  );
  // 반올림 나머지 정리: 보정 뒤 합계가 잔 용량(500)을 넘지 않음 (500.1 이면 펌웨어가 LIMIT)
  const ing4: IngredientInfo[] = [
    { pump: 1, name: '보드카', category: 'spirit', abv: 40, remainingMl: 1000, notes: '' },
    { pump: 2, name: '오렌지주스', category: 'juice', abv: 0, remainingMl: 1000, notes: '' },
    { pump: 3, name: '트리플섹', category: 'liqueur', abv: 30, remainingMl: 1000, notes: '' },
    { pump: 4, name: '사이다', category: 'soda', abv: 0, remainingMl: 1000, notes: '' },
  ];
  for (const strength of ['light', 'medium', 'strong'] as Strength[]) {
    const { recipe } = normalizeRecipe(
      { ingredients: [{ pump: 1, ml: 120 }, { pump: 2, ml: 130 }, { pump: 3, ml: 60 }, { pump: 4, ml: 190 }] },
      { ingredients: ing4, strength, cupMl: 500 },
    );
    assert.ok(recipe.totalMl <= 500, `${strength}: ${recipe.totalMl}`);
  }
});

test('8-e. capStrength 단독 (none 은 대상 아님)', () => {
  const base = normalizeRecipe(
    { ingredients: [{ pump: 1, name: '보드카', ml: 100 }, { pump: 2, name: '오렌지주스', ml: 100 }] },
    { ingredients: ING, strength: 'strong', cupMl: 200 },
  ).recipe;
  assert.equal(capStrength(base, ING, 'none').capped, false);
  assert.ok(capStrength(base, ING, 'light').recipe.estimatedAbv <= 5);
});

test('9. estimatedAbv 재계산 Σ(ml×abv)/총ml + flavor.strength 매핑', () => {
  const { recipe } = normalizeRecipe(
    {
      estimatedAbv: 99,
      flavor: { strength: 5, sweet: 9, sour: -1, bitter: 2.4 },
      ingredients: [
        { pump: 1, name: '보드카', ml: 50 },
        { pump: 2, name: '오렌지주스', ml: 150 },
      ],
    },
    { ingredients: ING, strength: 'medium', cupMl: 200 },
  );
  assert.equal(recipe.estimatedAbv, 10);
  assert.equal(recipe.flavor.strength, 2);
  assert.equal(recipe.flavor.sweet, 5, '0~5 로 자름');
  assert.equal(recipe.flavor.sour, 0);
  assert.equal(recipe.flavor.bitter, 2);
  assert.ok(recipe.flavor.fizzy >= 0 && recipe.flavor.fizzy <= 5, 'AI 가 안 준 값은 재료로 추정');
  // 매핑 경계: 0→0, ≤5→1, ≤10→2, ≤15→3, ≤20→4, 그 이상→5
  const table: [number, number][] = [
    [0, 0],
    [0.1, 1],
    [5, 1],
    [5.1, 2],
    [10, 2],
    [10.1, 3],
    [15, 3],
    [15.1, 4],
    [20, 4],
    [20.1, 5],
    [40, 5],
  ];
  for (const [abv, lv] of table) assert.equal(abvToStrengthLevel(abv), lv, `abv ${abv}`);
  assert.equal(strengthForAbv(0), 'none');
  assert.equal(strengthForAbv(4), 'light');
  assert.equal(strengthForAbv(9), 'medium');
  assert.equal(strengthForAbv(16), 'strong');
});

test('사용자 조정(revalidate)은 잔 용량 맞춤 없이 규칙 1·2·3·5·6·7·8·9 적용', () => {
  const r = revalidateRecipe(
    {
      name: 'x',
      description: '',
      reason: '',
      ingredients: [
        { pump: 2, name: '오렌지주스', ml: 120 },
        { pump: 4, name: '사이다', ml: 100 },
      ],
      totalMl: 220,
      estimatedAbv: 0,
      flavor: { sweet: 3, sour: 2, bitter: 0, fizzy: 3, strength: 0 },
      garnish: '',
      tips: '',
      suggestions: [],
    },
    { ingredients: ING, strength: 'none', cupMl: 200 },
  );
  assert.equal(r.recipe.totalMl, 220);
});

test('제안 정리: 응답 래퍼 허용, 이미 장착된 재료 add_ingredient 제거, 모르는 type 은 info', () => {
  const { recipe } = normalizeRecipe(
    {
      ok: true,
      recipe: {
        name: '미드나잇 시트러스',
        ingredients: [{ pump: 2, name: '오렌지주스', ml: 200 }],
        suggestions: [
          { type: 'add_ingredient', ingredient: '사이다', message: '사이다를 추가하세요' },
          { type: 'add_ingredient', ingredient: '토닉워터', message: '토닉워터를 추가하세요' },
          { type: 'weird', message: 'x' },
          { type: 'low_stock', message: '펌프 없음' },
        ],
      },
    },
    { ingredients: ING, strength: 'none', cupMl: 200 },
  );
  assert.equal(recipe.name, '미드나잇 시트러스');
  assert.deepEqual(
    recipe.suggestions.map((s) => [s.type, s.ingredient ?? null]),
    [
      ['add_ingredient', '토닉워터'],
      ['info', null],
      ['info', null],
    ],
  );
});

// ───────────────────────── 백엔드(recipe.js)와 같은 결과인지 비교 ─────────────────────────

function loadBackend(): any | null {
  try {
    const req = createRequire(path.join(import.meta.dirname, 'x.js'));
    return req('../../backend/lib/recipe.js');
  } catch {
    return null;
  }
}

test('백엔드 finalizeRecipe 와 같은 결과 (규칙 1~5·7·8·9, 재료당 300ml 이하 범위)', (t) => {
  const backend = loadBackend();
  if (!backend || typeof backend.finalizeRecipe !== 'function') {
    t.skip('backend/lib/recipe.js 를 불러올 수 없음');
    return;
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const strengths: Strength[] = ['none', 'light', 'medium', 'strong'];
  let compared = 0;
  for (let n = 0; n < 300; n++) {
    const cupMl = [100, 150, 200, 250, 300][Math.floor(rnd() * 5)];
    const strength = strengths[Math.floor(rnd() * 4)];
    const ing = ING.map((i) => ({ ...i, remainingMl: Math.round(rnd() * 400) }));
    const items = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => {
      const pick = ING[Math.floor(rnd() * ING.length)];
      return rnd() < 0.15 ? { pump: 9, name: '없는재료', ml: 30 } : { pump: pick.pump, name: pick.name, ml: Math.round((rnd() * 160 - 10) * 10) / 10 };
    });
    const raw = { name: '테스트', ingredients: items, flavor: { sweet: 3, sour: 2, bitter: 1, fizzy: 4 } };
    let app: any = null;
    try {
      app = normalizeRecipe(raw, { ingredients: ing, strength, cupMl }).recipe;
    } catch {
      app = null;
    }
    const be = backend.finalizeRecipe(raw, ing, { cupMl, strength });
    if (!be.ok) {
      assert.equal(app, null, `#${n} 백엔드는 오류, 앱은 성공`);
      continue;
    }
    assert.ok(app, `#${n} 앱은 오류, 백엔드는 성공`);
    assert.deepEqual(
      app.ingredients.map((i: any) => [i.pump, i.ml]),
      be.recipe.ingredients.map((i: any) => [i.pump, i.ml]),
      `#${n} 재료`,
    );
    assert.equal(app.totalMl, be.recipe.totalMl, `#${n} totalMl`);
    assert.equal(app.estimatedAbv, be.recipe.estimatedAbv, `#${n} abv`);
    assert.equal(app.flavor.strength, be.recipe.flavor.strength, `#${n} strength`);
    compared++;
  }
  assert.ok(compared > 50, `비교한 경우 ${compared}개`);
});
