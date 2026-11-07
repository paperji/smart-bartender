/// <reference types="node" />
/**
 * 오프라인(규칙기반) 추천기 + generateRecipe 대체 경로 테스트
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeRecipe } from '../src/lib/ai/normalize';
import { offlineRecipe } from '../src/lib/ai/offline';
import { buildRequest, generateRecipe } from '../src/lib/ai/recommend';
import { defaultSlots } from '../src/lib/presets';
import type { PumpSlot, UserInput } from '../src/lib/types';

const baseInput: UserInput = {
  moods: ['피곤함'],
  taste: { sweet: 3, sour: 3, bitter: 0, fizzy: 4 },
  strength: 'none',
  weather: { condition: '맑음', tempC: 28, humidity: 60 },
  situation: '휴식',
  preference: '',
  cupMl: 200,
};

const alcoholSlots: PumpSlot[] = [
  { pump: 1, name: '보드카', category: 'spirit', abv: 40, capacityMl: 700, remainingMl: 700, color: '#fff', notes: '', updatedAt: 0 },
  { pump: 2, name: '오렌지주스', category: 'juice', abv: 0, capacityMl: 1000, remainingMl: 1000, color: '#f90', notes: '', updatedAt: 0 },
  { pump: 3, name: '토닉워터', category: 'soda', abv: 0, capacityMl: 1000, remainingMl: 1000, color: '#ddd', notes: '', updatedAt: 0 },
  { pump: 4, name: '그레나딘시럽', category: 'syrup', abv: 0, capacityMl: 500, remainingMl: 500, color: '#f00', notes: '', updatedAt: 0 },
];

test('무알콜: 기본 재료로 그럴듯한 레시피 (총량=잔 용량, 도수 0, 레몬즙 15% 이하)', () => {
  const req = buildRequest(baseInput, defaultSlots());
  for (let v = 0; v < 20; v++) {
    const raw = offlineRecipe(req, { variation: v });
    const { recipe } = normalizeRecipe(raw, { ingredients: req.ingredients, strength: 'none', cupMl: 200 });
    assert.equal(recipe.totalMl, 200);
    assert.equal(recipe.estimatedAbv, 0);
    assert.ok(recipe.ingredients.length >= 1 && recipe.ingredients.length <= 3);
    const lemon = recipe.ingredients.find((i) => i.name === '레몬즙');
    if (lemon) assert.ok(lemon.ml <= 200 * 0.15 + 0.5, `레몬즙 ${lemon.ml}ml 가 너무 많음`);
    assert.ok(recipe.name.length > 0 && recipe.reason.length > 0);
  }
});

test('도수 선택 시 주류 포함, 강할수록 도수가 높음', () => {
  const abvOf = (strength: UserInput['strength']) => {
    const req = buildRequest({ ...baseInput, strength }, alcoholSlots);
    const raw = offlineRecipe(req, { variation: 1 });
    return normalizeRecipe(raw, { ingredients: req.ingredients, strength, cupMl: 200 }).recipe.estimatedAbv;
  };
  const light = abvOf('light');
  const medium = abvOf('medium');
  const strong = abvOf('strong');
  assert.ok(light > 0, `light=${light}`);
  assert.ok(light < medium && medium < strong, `${light} < ${medium} < ${strong}`);
  assert.equal(abvOf('none'), 0);
});

test('주류 미장착 + 도수 요청 → 무알콜 + 안내 info (술 장착 권유 문장은 성인 확인 뒤에만 — SPEC §3.2, 백엔드 fallback 과 같은 문구)', () => {
  const adult = buildRequest({ ...baseInput, strength: 'medium' }, defaultSlots(), [], 'normal', true);
  const raw = offlineRecipe(adult) as any;
  assert.ok(
    raw.suggestions.some((s: any) => s.type === 'info' && s.message === '장착된 주류가 없어 무알콜로 만들었어요. 보드카·럼 같은 술을 장착하면 칵테일도 만들 수 있어요.'),
    JSON.stringify(raw.suggestions),
  );
  const kid = buildRequest({ ...baseInput, strength: 'medium' }, defaultSlots(), [], 'normal', false);
  const raw2 = offlineRecipe(kid) as any;
  assert.ok(!raw2.suggestions.some((s: any) => s.ingredient === '보드카' || /보드카/.test(s.message)), JSON.stringify(raw2.suggestions));
  assert.ok(raw2.suggestions.some((s: any) => s.type === 'info' && s.message === '장착된 주류가 없어 무알콜로 만들었어요.'));
});

test('다시 추천(variation) 시 결과가 달라질 수 있음', () => {
  const req = buildRequest(baseInput, defaultSlots());
  const outs = new Set<string>();
  for (let v = 0; v < 10; v++) outs.add(JSON.stringify((offlineRecipe(req, { variation: v }) as any).ingredients));
  assert.ok(outs.size >= 2, '변형이 전혀 없음');
});

test('generateRecipe: Gemini 실패(연결 안 됨) 시 자동으로 오프라인 추천 + 사유 기록 (가짜 fetch — 실제 호출 없음)', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  let res;
  try {
    res = await generateRecipe({ input: baseInput, slots: defaultSlots(), aiMode: 'ai', aiKey: 'test-key-not-real', timeoutMs: 3000 });
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(res.source, 'offline');
  assert.ok(res.fallbackReason && res.fallbackReason.length > 0);
  assert.equal(res.fallbackCode, 'NETWORK');
  assert.equal(res.recipe?.totalMl, 200);
});

test('generateRecipe: 오프라인 모드', async () => {
  const res = await generateRecipe({ input: baseInput, slots: defaultSlots(), aiMode: 'offline' });
  assert.equal(res.source, 'offline');
  assert.equal(res.fallbackReason, undefined);
});

test('generateRecipe: 재료가 없으면 오류', async () => {
  await assert.rejects(
    generateRecipe({ input: baseInput, slots: [], aiMode: 'offline' }),
    /재료/,
  );
});
