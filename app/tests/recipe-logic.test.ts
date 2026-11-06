/// <reference types="node" />
/**
 * 추천 레시피 화면 로직 테스트 (v2.1 recipe.tsx 의 adjust·fitToCup·안내 문구와 같은지)
 * 실제 Gemini 호출 없음 — 순수 함수만
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PumpSlot, Recipe } from '../src/lib/types';
import {
  adjustIngredient,
  fallbackNotice,
  fitRecipeToCup,
  isTotalOff,
  recheckContext,
  regenerateToast,
  regenerateVariation,
  sharePctOf,
} from '../src/screens/recipe/recipeLogic';

function slot(pump: number, name: string, abv = 0, remainingMl = 1000, category: PumpSlot['category'] = 'juice'): PumpSlot {
  return { pump, name, category, abv, capacityMl: 1000, remainingMl, color: '#ff9900', notes: '', updatedAt: 0 };
}

const SLOTS = [slot(1, '사이다', 0, 1000, 'soda'), slot(2, '오렌지주스'), slot(3, '우유', 0, 1000, 'dairy'), slot(4, '보드카', 40, 1000, 'spirit')];

function recipe(ings: [number, string, number][], abv = 0): Recipe {
  const ingredients = ings.map(([pump, name, ml]) => ({ pump, name, ml }));
  return {
    name: '테스트',
    description: '',
    reason: '',
    ingredients,
    totalMl: ingredients.reduce((a, b) => a + b.ml, 0),
    estimatedAbv: abv,
    flavor: { sweet: 3, sour: 2, bitter: 0, fizzy: 3, strength: 0 },
    garnish: '',
    tips: '',
    suggestions: [],
  };
}

const LIMITS = { maxStepMl: 300, maxTotalMl: 500 };

test('± 조정: 5ml 늘리면 다시 검증된 레시피와 총량이 바뀜', () => {
  const r = recipe([
    [1, '사이다', 100],
    [2, '오렌지주스', 100],
  ]);
  const ctx = recheckContext(SLOTS, { strength: 'none', preference: '' }, LIMITS, false);
  const res = adjustIngredient(r, [], 2, 5, ctx, LIMITS, 'none');
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.recipe.ingredients.find((i) => i.pump === 2)?.ml, 105);
  assert.equal(res.recipe.totalMl, 205);
  assert.deepEqual(res.toasts, []);
  assert.deepEqual(res.warnings, []);
});

test('± 조정: 한 잔 최대·재료 하나 최대·최소 1개 (v2.1 문구)', () => {
  const ctx = recheckContext(SLOTS, { strength: 'none', preference: '' }, LIMITS, false);
  const full = recipe([
    [1, '사이다', 250],
    [2, '오렌지주스', 250],
  ]);
  const over = adjustIngredient(full, [], 1, 5, ctx, LIMITS, 'none');
  assert.equal(over.ok, false);
  assert.deepEqual(over.toasts, [{ message: '한 잔은 최대 500ml 까지 만들 수 있어요.', kind: 'warning' }]);

  const step = adjustIngredient(recipe([[1, '사이다', 298]]), [], 1, 5, ctx, LIMITS, 'none');
  assert.equal(step.ok, true);
  assert.equal(step.toasts[0].message, '재료 하나는 최대 300ml 까지예요.');
  if (step.ok) assert.equal(step.recipe.ingredients[0].ml, 300);

  const one = adjustIngredient(recipe([[1, '사이다', 5]]), [], 1, -5, ctx, LIMITS, 'none');
  assert.equal(one.ok, false);
  assert.deepEqual(one.toasts, [{ message: '재료가 최소 1개는 있어야 해요.', kind: 'warning' }]);
});

test('± 조정: 성향(줄바꿈 포함 문장도 정리해서)으로 뺀 재료는 안내를 배너·토스트에 더함', () => {
  // 예전에 성향 없이 만든 레시피에 우유가 들어 있는데, 지금 성향이 "땅콩 알레르기\n우유 빼 주세요"
  const ctx = recheckContext(SLOTS, { strength: 'none', preference: '땅콩 알레르기\n우유   빼 주세요' }, LIMITS, false);
  assert.ok((ctx.excludePumps as ReadonlySet<number>).has(3));
  const r = recipe([
    [2, '오렌지주스', 100],
    [3, '우유', 100],
  ]);
  const res = adjustIngredient(r, ['원래 안내'], 2, 5, ctx, LIMITS, 'none');
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(!res.recipe.ingredients.some((i) => i.pump === 3));
  assert.equal(res.warnings[0], '원래 안내');
  assert.ok(res.warnings.some((w) => w.includes("'우유'")));
  assert.equal(res.toasts.length, 1);
  assert.equal(res.toasts[0].kind, 'warning');
  // 같은 안내는 두 번 더하지 않음
  const again = adjustIngredient(r, res.warnings, 2, 5, ctx, LIMITS, 'none');
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.warnings.filter((w) => w.includes("'우유'")).length, 1);
});

test('± 조정: 무알콜 레시피에서는 술이 빠지고, 도수 상한을 넘으면 술 양을 맞춤', () => {
  const none = recheckContext(SLOTS, { strength: 'none', preference: '' }, LIMITS, true);
  const r = recipe([
    [2, '오렌지주스', 150],
    [4, '보드카', 30],
  ]);
  const res = adjustIngredient(r, [], 2, 5, none, LIMITS, 'none');
  assert.equal(res.ok, true);
  if (res.ok) assert.ok(!res.recipe.ingredients.some((i) => i.pump === 4));

  const light = recheckContext(SLOTS, { strength: 'light', preference: '' }, LIMITS, true);
  const strong = recipe(
    [
      [2, '오렌지주스', 150],
      [4, '보드카', 20],
    ],
    4,
  );
  const capped = adjustIngredient(strong, [], 4, 5, light, LIMITS, 'light');
  assert.equal(capped.ok, true);
  if (capped.ok) {
    assert.ok(capped.recipe.estimatedAbv <= 5);
    assert.ok(capped.toasts.some((t) => t.message.includes("'약하게'(최대 5%)를 넘지 않게 술 양을 맞췄어요.")));
  }
});

test('잔 맞춤: 총량을 잔 용량에 맞추고 v2.1 문구로 알림', () => {
  const ctx = recheckContext(SLOTS, { strength: 'none', preference: '' }, LIMITS, false);
  const r = recipe([
    [1, '사이다', 120],
    [2, '오렌지주스', 120],
  ]);
  assert.equal(isTotalOff(r, 200), true);
  const res = fitRecipeToCup(r, [], 200, ctx);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(Math.round(res.recipe.totalMl), 200);
  assert.equal(isTotalOff(res.recipe, 200), false);
  assert.deepEqual(res.toasts, [{ message: '잔 용량 200ml 에 맞췄어요.', kind: 'success' }]);
});

test('오프라인 안내: 키 없음·키 오류·사용량 한도·모델은 설정 버튼, 그 밖은 v2.1 문구', () => {
  assert.equal(fallbackNotice({ source: 'direct' }), null);
  assert.equal(fallbackNotice({ source: 'offline' }), null); // AI 방식이 오프라인 (이유 없음)
  const noKey = fallbackNotice({ source: 'offline', fallbackReason: 'Gemini API 키가 설정되지 않았어요', fallbackCode: 'NO_KEY' });
  assert.equal(noKey?.tone, 'info');
  assert.equal(noKey?.settingsLabel, '설정에서 키 등록');
  const auth = fallbackNotice({
    source: 'offline',
    fallbackReason: 'Gemini 오류(AUTH): API 키가 올바르지 않거나 권한이 없어요(설정에서 키 확인) — API key not valid. Please pass a valid API key.',
    fallbackCode: 'AUTH',
  });
  assert.equal(auth?.tone, 'warning');
  assert.equal(auth?.settingsLabel, '설정에서 키 확인');
  assert.ok(auth?.message.includes('올바르지 않거나'));
  // 쉬운 안내는 본문에 있으므로 원문(Google 문구)만 덧붙임
  assert.equal(auth?.detail, 'API key not valid. Please pass a valid API key.');
  assert.equal(fallbackNotice({ source: 'offline', fallbackReason: 'Gemini 오류(AUTH): …', fallbackCode: 'AUTH' })?.detail, undefined);
  const quota = fallbackNotice({ source: 'offline', fallbackReason: 'Gemini 오류(RATE_LIMIT): …', fallbackCode: 'RATE_LIMIT' });
  assert.ok(quota?.message.includes('사용량 한도'));
  assert.equal(quota?.settingsLabel, '설정에서 키 확인');
  assert.ok(fallbackNotice({ source: 'offline', fallbackReason: 'x', fallbackCode: 'BILLING' })?.message.includes('크레딧'));
  assert.equal(fallbackNotice({ source: 'offline', fallbackReason: 'x', fallbackCode: 'MODEL' })?.settingsLabel, '설정에서 모델 확인');
  const net = fallbackNotice({ source: 'offline', fallbackReason: 'Gemini 오류(NETWORK): ' + 'a'.repeat(200), fallbackCode: 'NETWORK' });
  assert.equal(net?.settingsLabel, undefined);
  assert.equal(net?.message, '인터넷 또는 AI 서버 문제로 앱에 내장된 규칙으로 레시피를 만들었어요.');
  assert.equal(net?.detail?.length, 120);
  const slow = fallbackNotice({ source: 'offline', fallbackReason: 't', fallbackCode: 'TIMEOUT', timedOut: true });
  assert.ok(slow?.message.startsWith('AI 응답이 너무 늦어'));
});

test('다른 추천 토스트·다양성 값·비율', () => {
  assert.equal(regenerateToast(1), '방금 레시피는 다음 추천에서 피할게요.');
  assert.equal(regenerateToast(2), '마음에 드는 게 없나요? 아래에서 새 재료를 추천해 드릴게요.');
  assert.equal(regenerateVariation(2, 0.5), 2 * 7919 + 500);
  assert.equal(sharePctOf(50, 200), 25);
  assert.equal(sharePctOf(10, 0), 1000);
});
