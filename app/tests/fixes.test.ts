/// <reference types="node" />
/**
 * 리뷰 결함 수정 회귀 테스트
 *  - history 최신 기록부터(SPEC §3.1) · normName 이름 비교(SPEC §3.1)
 *  - 탐색 줄을 다시 잔 용량에 맞추지 않는 옵션(scaleToCup:false) · 탐색 줄 도수 상한
 *  - 빈 기기 탐색(새 재료 2개) 장착 흐름 · 오프라인 탐색 후보 정규식/성향 제외(백엔드와 같게)
 *  - make 검증의 0.0001ml 정리·정수 ms 비교(§2.3) · 프리셋 정확 일치 · 잔량 차감 차이
 *  - 직접 Gemini 시간 제한 25초 (SPEC §3.1), 시간 초과 표시
 * v3.0: 서버 모드 제거 — 서버 응답 해석(parseServerBody)·서버가 보정한 레시피를 다시 맞추지 않음·서버 연결 테스트·
 *       서버 시간 제한(50초) 테스트는 지움 (Gemini 키 확인은 gemini-byok.test.ts)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { missingIngredients, nameKey, parseExplore, remainingToInstall } from '../src/lib/ai/explore';
import { comboKey } from '../src/lib/ai/offline';
import { excludedByPreference, exploreCandidates } from '../src/lib/ai/offline-explore';
import { buildUserPrompt } from '../src/lib/ai/prompt';
import { AI_TIMEOUT_MS, buildRequest, generateRecipe } from '../src/lib/ai/recommend';
import { historyHints } from '../src/lib/history-hints';
import { emptySlot, findExactPreset } from '../src/lib/presets';
import { dispensedDelta, quantizeMl, validateMake } from '../src/lib/protocol';
import type { IngredientInfo, PumpSlot, UserInput } from '../src/lib/types';

const input: UserInput = {
  moods: [],
  taste: { sweet: 3, sour: 3, bitter: 0, fizzy: 4 },
  strength: 'none',
  weather: null,
  situation: '',
  preference: '',
  cupMl: 200,
};

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
const info = (pump: number, name: string, category: IngredientInfo['category'], abv = 0, remainingMl = 800): IngredientInfo => ({
  pump,
  name,
  category,
  abv,
  remainingMl,
  notes: '',
});

/** fetch 를 잠시 바꿔 실행 */
async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

// ───────────────────────── history 순서 (SPEC §3.1) ─────────────────────────

test('historyHints: 최신 기록부터(피드백 시각·거절 시각 기준) 최대 10개, 피드백 없는 기록은 제외', () => {
  const r = (name: string) => ({ name, ingredients: [{ name: '사이다', ml: 100 }] });
  const hints = historyHints(
    [
      { createdAt: 1000, feedback: 'dislike', recipe: r('OLD') },
      { createdAt: 500, feedbackAt: 3000, feedback: 'like', recipe: r('NEW') },
      { createdAt: 4000, feedback: null, recipe: r('NOFB') },
    ],
    [{ at: 2000, ...r('MID') }],
  );
  assert.deepEqual(
    hints.map((h) => [h.name, h.liked, h.rejected]),
    [
      ['NEW', true, false],
      ['MID', false, true],
      ['OLD', false, false],
    ],
  );
  const many = historyHints([], Array.from({ length: 13 }, (_, i) => ({ at: i, ...r(`x${i}`) })));
  assert.equal(many.length, 10);
  assert.equal(many[0].name, 'x12');
  assert.equal(many[9].name, 'x3');
  // 요청 본문은 앞에서 10개 그대로, 직접 Gemini 프롬프트도 "최근 것부터"
  const req = buildRequest(input, [slot(1, '사이다', 'soda')], hints, 'normal');
  assert.equal(req.history[0].name, 'NEW');
  assert.match(buildUserPrompt(req), /\[이전 기록\] \(최근 것부터\)/);
});

// ───────────────────────── normName (SPEC §3.1) ─────────────────────────

test('nameKey = normName: 기호(- · . 괄호 등)까지 무시해 explore installed 판정·거절 조합 비교', () => {
  assert.equal(nameKey('그레나딘-시럽'), nameKey('그레나딘 시럽'));
  assert.equal(nameKey('레몬·라임주스'), nameKey('레몬라임주스'));
  assert.equal(nameKey('Ginger-Ale'), nameKey('ginger ale'));
  assert.equal(comboKey(['레몬·라임주스', '토닉워터']), comboKey(['토닉 워터', '레몬라임주스']));

  const ings = [info(1, '그레나딘-시럽', 'syrup'), info(2, 'Ginger-Ale', 'soda'), info(3, '레몬·라임주스', 'juice')];
  const ctx = { ingredients: ings, strength: 'none' as const, cupMl: 200, mode: 'explore' as const };
  // 이미 장착된 재료(기호만 다름)는 "새 재료"로 제안하지 않음
  assert.equal(parseExplore([{ addIngredient: '그레나딘 시럽', ingredients: [{ name: '그레나딘 시럽', ml: 20 }, { name: 'ginger ale', ml: 180 }] }], ctx).length, 0);
  const [it] = parseExplore(
    [{ addIngredient: '토닉워터', ingredients: [{ name: '레몬라임주스', ml: 20 }, { name: 'ginger ale', ml: 80 }, { name: '토닉워터', ml: 100 }] }],
    ctx,
  );
  assert.ok(it, '미장착은 토닉워터 1개 → 항목 유지');
  assert.deepEqual(
    it.ingredients.map((i) => [i.name, i.installed, i.pump ?? null]),
    [
      ['레몬·라임주스', true, 3],
      ['Ginger-Ale', true, 2],
      ['토닉워터', false, null],
    ],
  );
  assert.deepEqual(missingIngredients(it), ['토닉워터']);
});

test('탐색 줄: scaleToCup:false 면 다시 늘리지 않고, 도수 상한(light 5%)·줄당 300ml 를 지킴 (300 으로 자른 뒤에도)', () => {
  const ings = [info(1, '보드카', 'spirit', 40, 1000)];
  const raw = [{ addIngredient: '탄산수', category: 'soda', abv: 0, ingredients: [{ name: '보드카', ml: 60 }, { name: '탄산수', ml: 300 }] }];
  const abvOf = (lines: { name: string; ml: number }[]) =>
    lines.reduce((s, l) => s + l.ml * (l.name === '보드카' ? 40 : 0), 0) / lines.reduce((s, l) => s + l.ml, 0);
  for (const scaleToCup of [false, true]) {
    const [it] = parseExplore(raw, { ingredients: ings, strength: 'light', cupMl: 500, mode: 'explore', scaleToCup });
    assert.ok(it);
    const vodka = it.ingredients.find((i) => i.name === '보드카')!;
    const soda = it.ingredients.find((i) => i.name === '탄산수')!;
    assert.ok(soda.ml <= 300, `탄산수 ${soda.ml}`);
    assert.ok(vodka.ml < 60, `술이 늘지 않음 (${vodka.ml})`);
    assert.ok(abvOf(it.ingredients) <= 5.05, `도수 ${abvOf(it.ingredients)}`);
  }
});

test('explore + 장착 재료가 모두 술 + 무알콜 (오프라인) → 이유(notice)를 안내 맨 앞에', async () => {
  const res = await generateRecipe({ input, slots: [slot(1, '보드카', 'spirit', 40)], aiMode: 'offline', mode: 'explore' });
  assert.equal(res.recipe, null);
  assert.ok(res.explore.length >= 1);
  assert.match(res.warnings[0], /모두 술이라 무알콜로는/);
  // 술만 장착 + 약하게: 도수 상한을 맞출 무알콜 재료가 없음 → normal 은 오류(NO_MIXER), explore 는 이유 안내
  const vodkaOnly = [slot(1, '보드카', 'spirit', 40)];
  const light = { ...input, strength: 'light' as const };
  await assert.rejects(
    generateRecipe({ input: light, slots: vodkaOnly, aiMode: 'offline', mode: 'normal' }),
    (e: any) => e.code === 'NO_MIXER',
  );
  const ex = await generateRecipe({ input: light, slots: vodkaOnly, aiMode: 'offline', mode: 'explore' });
  assert.equal(ex.recipe, null);
  assert.match(ex.warnings[0], /도수를 맞출 무알콜 재료가 없어요/);
});

// ───────────────────────── 빈 기기 탐색: 새 재료 2개 (SPEC §5.4) ─────────────────────────

test('빈 기기 탐색 카드(새 재료 2개): 1개만 장착하면 남은 재료 안내 + 재추천은 이름만 같은 다른 음료가 되지 않음', async () => {
  const ex = await generateRecipe({ input, slots: [emptySlot(1), emptySlot(2), emptySlot(3)], aiMode: 'offline', mode: 'explore' });
  const target = ex.explore.find((e) => e.ingredients.filter((i) => !i.installed).length === 2);
  assert.ok(target, '새 재료 2개짜리 카드');
  const [first, second] = missingIngredients(target);
  const one = [slot(1, first, target.category, target.abv), emptySlot(2), emptySlot(3)];
  assert.deepEqual(remainingToInstall(target, one), [second]);
  const r1 = await generateRecipe({ input, slots: one, aiMode: 'offline', mode: 'normal', target });
  assert.notEqual(r1.recipe!.name, target.recipeName, '재료 1개만으로 "해당 레시피" 이름을 붙이지 않음');
  const both = [slot(1, first, target.category, target.abv), slot(2, second, 'juice'), emptySlot(3)];
  assert.deepEqual(remainingToInstall(target, both), []);
  const r2 = await generateRecipe({ input, slots: both, aiMode: 'offline', mode: 'normal', target });
  assert.equal(r2.recipe!.name, target.recipeName, '둘 다 장착하면 해당 레시피 그대로');
  assert.equal(r2.recipe!.ingredients.length, 2);
});

// ───────────────────────── 오프라인 탐색 후보 (백엔드 fallback 과 같은 조건) ─────────────────────────

test('오프라인 탐색 후보: 매실은 산미 재료, 편안/힐링도 휴식 상황, 성향에 "싫어" 적힌 재료는 제외', () => {
  const names = (u: Partial<UserInput>, slots: PumpSlot[]) =>
    exploreCandidates(buildRequest({ ...input, ...u }, slots, [], 'explore'), { adultVerified: true }).map((c) => c.name);
  const base = [slot(1, '오렌지주스', 'juice'), slot(2, '물', 'water'), slot(3, '탄산수', 'soda'), slot(4, '매실청', 'syrup')];
  assert.ok(!names({ strength: 'light', taste: { sweet: 2, sour: 5, bitter: 0, fizzy: 2 } }, base).includes('레몬즙'), '매실 = 산미 재료');
  assert.ok(names({ preference: '오늘은 편안하게 쉬고 싶어요' }, [slot(1, '사이다', 'soda')]).includes('우유'));
  assert.ok(!names({ preference: '오늘은 그냥' }, [slot(1, '사이다', 'soda')]).includes('우유'));
  assert.ok(names({ taste: { sweet: 0, sour: 0, bitter: 3, fizzy: 0 } }, [slot(1, '사이다', 'soda')]).includes('토닉워터'));
  assert.ok(
    !names({ taste: { sweet: 0, sour: 0, bitter: 3, fizzy: 0 }, preference: '토닉워터는 싫어요' }, [slot(1, '사이다', 'soda')]).includes('토닉워터'),
  );
  assert.equal(excludedByPreference('우유', '우유 알레르기가 있어요'), true);
  assert.equal(excludedByPreference('우유', '우유 좋아요'), false);
});

// ───────────────────────── make 검증 (SPEC §2.3, 펌웨어와 같게) ─────────────────────────

test('validateMake: ml 은 0.0001 단위로 정리, 구동시간은 정수 ms 로 반올림해 120초와 비교 (펌웨어와 같은 판정)', () => {
  const cal = (v: number) => [v, 20, 20, 20];
  assert.equal(quantizeMl(300.00004), 300);
  assert.equal(validateMake([{ p: 1, ml: 300.00004 }], 4, cal(20)).ok, true);
  assert.equal(validateMake([{ p: 1, ml: 150.1 }, { p: 1, ml: 149.9 }], 4, cal(20)).ok, true);
  const exact = validateMake([{ p: 1, ml: 60 }], 4, cal(0.5));
  assert.equal(exact.ok, true);
  assert.deepEqual(exact.durations, [120000]);
  assert.equal(validateMake([{ p: 1, ml: 60.0002 }], 4, cal(0.5)).ok, true, '120000.4ms → 120000');
  assert.equal(validateMake([{ p: 1, ml: 200.4 }], 4, cal(1.67)).ok, true, '200.4/1.67*1000 = 120000.00000000001');
  const over = validateMake([{ p: 1, ml: 60.01 }], 4, cal(0.5));
  assert.equal(over.code, 'LIMIT');
  assert.match(over.msg!, /120\.1초가 최대 120초/);
});

// ───────────────────────── 그 밖 ─────────────────────────

test('프리셋 정확 일치: 술 이름은 잡고, 부분 일치 오탐은 없음', () => {
  assert.equal(findExactPreset('보드카')?.abv, 40);
  assert.equal(findExactPreset(' 진 ')?.name, '진');
  assert.equal(findExactPreset('화이트럼')?.name, '럼');
  assert.equal(findExactPreset('진저 시럽'), undefined);
  assert.equal(findExactPreset('무알콜 진'), undefined);
});

test('같은 작업이 두 번 끝나면(결과 모름 → 실제 결과) 잔량은 차이만 더 뺌', () => {
  assert.deepEqual(dispensedDelta([{ p: 1, ml: 100 }, { p: 2, ml: 20 }], [{ p: 1, ml: 30 }]), [
    { p: 1, ml: 70 },
    { p: 2, ml: 20 },
  ]);
  assert.deepEqual(dispensedDelta([{ p: 1, ml: 30 }], [{ p: 1, ml: 30 }]), []);
  assert.deepEqual(dispensedDelta([{ p: 1, ml: 10 }], undefined), [{ p: 1, ml: 10 }]);
});

test('AI 시간 제한 (SPEC §3.1): 직접 Gemini 25초, 시간 초과면 오프라인 추천 + timedOut 표시 (가짜 fetch)', async () => {
  assert.equal(AI_TIMEOUT_MS, 25000);
  const hang = ((_u: unknown, init?: RequestInit) =>
    new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as typeof fetch;
  const res = await withFetch(hang, () =>
    generateRecipe({ input, slots: [slot(1, '사이다', 'soda')], aiMode: 'ai', aiKey: 'test-key-not-real', mode: 'normal', timeoutMs: 30 }),
  );
  assert.equal(res.source, 'offline');
  assert.equal(res.timedOut, true);
  assert.equal(res.fallbackCode, 'TIMEOUT');
  assert.match(res.fallbackReason ?? '', /응답 시간이 넘었어요/);
});
