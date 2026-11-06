/// <reference types="node" />
/**
 * 추천 흐름·저장값 회귀 테스트 (리뷰 FLOW-1 · FLOW-5) — 실제 Gemini·기기 호출 없음 (오프라인 추천만)
 *  - FLOW-1: 레시피 화면의 탐색 카드로 장착 → 다시 추천은 그 레시피의 입력값(잔 용량·도수·맛)으로. 예전 탐색 입력이 끼어들지 않음
 *  - FLOW-5: 저장값(sb3.draft·slots·history·settings)이 깨져 있어도 불러올 때 고쳐서 화면이 하얗게 멈추지 않음
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installRequestInput, openInstall, recommendAfterInstall } from '../src/lib/flow';
import type { ExploreItem, Recipe, UserInput } from '../src/lib/types';
import { kv } from '../src/platform/storage';
import { DEFAULT_INPUT, sanitizeInput, useDraft, useSession } from '../src/store/draft';
import { sanitizeHistory, sanitizeRecipe, useHistory } from '../src/store/history';
import { sanitizeSettings, SETTINGS_DEFAULTS, useSettings } from '../src/store/settings';
import { sanitizeSlots, useSlots } from '../src/store/slots';
import { STORAGE_KEYS } from '../src/store/storage';

import { installDialogStub } from './stubs/dialog';
import { installRouterStub, pushes } from './stubs/router';

const input = (cupMl: number, patch: Partial<UserInput> = {}): UserInput => ({ ...DEFAULT_INPUT, cupMl, ...patch });

const RECIPE: Recipe = {
  name: '하우스 사이다 스파클러',
  description: '',
  reason: '',
  ingredients: [
    { pump: 1, name: '사이다', ml: 200 },
    { pump: 2, name: '오렌지주스', ml: 100 },
  ],
  totalMl: 300,
  estimatedAbv: 0,
  flavor: { sweet: 3, sour: 1, bitter: 0, fizzy: 4, strength: 0 },
  garnish: '',
  tips: '',
  suggestions: [],
};

const ITEM: ExploreItem = {
  addIngredient: '설탕시럽',
  category: 'syrup',
  abv: 0,
  recipeName: '스위트 사이다',
  description: '',
  ingredients: [
    { name: '설탕시럽', ml: 15, installed: false },
    { name: '오렌지주스', ml: 55, installed: true, pump: 2 },
    { name: '사이다', ml: 80, installed: true, pump: 1 },
  ],
  message: '',
};

test('FLOW-1: 레시피 화면 카드로 장착 → 다시 추천은 그 레시피 입력(300ml)으로 — 예전 탐색 입력(150ml)이 아님', async () => {
  installRouterStub();
  installDialogStub();
  useSettings.setState({ aiMode: 'offline', adultVerifiedAt: null });
  // (1) 예전 탐색: 150ml · 다른 맛
  useSession.setState({
    explore: {
      items: [],
      recipe: null,
      source: 'offline',
      warnings: [],
      input: input(150, { taste: { sweet: 5, sour: 5, bitter: 3, fizzy: 0 } }),
      createdAt: 1,
      round: 0,
    },
  });
  // (2) 지금 레시피: 300ml
  const cur = input(300, { moods: ['행복'] });
  useSession.setState({
    current: { recipe: RECIPE, explore: [ITEM], mode: 'normal', source: 'offline', warnings: [], createdAt: 2, input: cur, variation: 0 },
  });
  useDraft.setState({ input: input(250) });
  // (3) 레시피 화면 카드 "펌프 3에 장착하기" → 저장(설탕시럽 장착) → 다시 추천
  pushes.length = 0;
  openInstall(ITEM, { pump: 3, reason: 'least_used', current: '레몬즙', uses: 0 } as any, { input: cur });
  assert.equal(useSession.getState().installTarget, ITEM);
  assert.equal(useSession.getState().installInput, cur);
  assert.equal(installRequestInput().cupMl, 300, '탐색 입력(150)이 아니라 카드가 나온 레시피 입력(300)');
  useSlots.setState({
    slots: [
      { pump: 1, name: '사이다', category: 'soda', abv: 0, capacityMl: 1000, remainingMl: 1000, color: '#C9D6E8', notes: '', updatedAt: 0 },
      { pump: 2, name: '오렌지주스', category: 'juice', abv: 0, capacityMl: 1000, remainingMl: 1000, color: '#FF9F43', notes: '', updatedAt: 0 },
      { pump: 3, name: '설탕시럽', category: 'syrup', abv: 0, capacityMl: 500, remainingMl: 500, color: '#ffffff', notes: '', updatedAt: 0 },
      { pump: 4, name: '콜라', category: 'soda', abv: 0, capacityMl: 1000, remainingMl: 1000, color: '#B0794F', notes: '', updatedAt: 0 },
    ],
  });
  const res = await recommendAfterInstall();
  assert.ok(res?.recipe, '오프라인 추천 결과');
  const now = useSession.getState();
  assert.equal(now.current?.input.cupMl, 300);
  assert.deepEqual(now.current?.input.moods, ['행복'], '입력 전체가 지금 레시피의 것');
  assert.ok(Math.abs((now.current?.recipe.totalMl ?? 0) - 300) <= 10, `총량이 300ml 근처 (받은 값 ${now.current?.recipe.totalMl})`);
  assert.equal(now.installTarget, null, '장착 정보는 지움');
  assert.equal(now.installInput, null);
  assert.equal(now.rejectStreak, 0);
  assert.ok(!pushes.includes('/recipe'), '화면 이동은 부른 쪽(dismissTo)이 함');
});

test('FLOW-1: 탐색 화면 카드는 그 탐색의 입력, 입력을 안 넘긴 옛 호출은 지금 레시피 → 홈 입력 (탐색 입력 우선 아님)', () => {
  installRouterStub();
  const exIn = input(180);
  useSession.setState({ explore: { items: [ITEM], recipe: null, source: 'offline', warnings: [], input: exIn, createdAt: 3, round: 0 } });
  openInstall(ITEM, { pump: 3, reason: 'empty' } as any, { input: exIn });
  assert.equal(installRequestInput(), exIn);
  // 두 번째 재료 장착 화면으로 이어질 때(replace) 같은 입력을 넘김
  openInstall(ITEM, { pump: 4, reason: 'empty' } as any, { replace: true, input: useSession.getState().installInput });
  assert.equal(installRequestInput(), exIn);
  // 입력 없이 열면 → 지금 레시피 입력
  useSession.setState({ current: { recipe: RECIPE, explore: [], mode: 'normal', source: 'offline', warnings: [], createdAt: 4, input: input(320), variation: 0 } });
  openInstall(ITEM, { pump: 3, reason: 'empty' } as any);
  assert.equal(installRequestInput().cupMl, 320);
  useSession.getState().setInstallTarget(null);
  assert.equal(useSession.getState().installInput, null, '장착 정보를 지우면 입력도 지움');
});

test('FLOW-5: 칸이 빠진 입력값(sb3.draft) → 기본값으로 채움 (기분 목록이 없어 홈 화면이 깨지던 문제)', async () => {
  kv.setItem(STORAGE_KEYS.draft, JSON.stringify({ state: { input: { strength: 'medium' } }, version: 1 }));
  await useDraft.persist.rehydrate();
  const i = useDraft.getState().input;
  assert.deepEqual(i.moods, []);
  assert.deepEqual(i.taste, DEFAULT_INPUT.taste);
  assert.equal(i.strength, 'medium', '맞는 값은 그대로');
  assert.equal(i.cupMl, 200);
  assert.equal(i.weather, null);
  assert.equal(typeof useDraft.getState().setInput, 'function');

  kv.setItem(STORAGE_KEYS.draft, JSON.stringify({ state: { input: 'junk' }, version: 1 }));
  await useDraft.persist.rehydrate();
  assert.deepEqual(useDraft.getState().input, { ...DEFAULT_INPUT });

  kv.setItem(STORAGE_KEYS.draft, '{not json');
  await useDraft.persist.rehydrate(); // JSON 이 아니면 zustand 가 오류를 삼키고 지금 값 유지
  assert.deepEqual(useDraft.getState().input.moods, []);

  const s = sanitizeInput({ moods: ['행복', 3, null], taste: { sweet: 9, sour: '2', bitter: -1 }, strength: 'very', cupMl: 5000, situation: 7, preference: '땅콩 알레르기' });
  assert.deepEqual(s.moods, ['행복']);
  assert.deepEqual(s.taste, { sweet: 5, sour: DEFAULT_INPUT.taste.sour, bitter: 0, fizzy: DEFAULT_INPUT.taste.fizzy });
  assert.equal(s.strength, 'none');
  assert.equal(s.cupMl, 400);
  assert.equal(s.situation, '');
  assert.equal(s.preference, '땅콩 알레르기');
});

test('FLOW-5: 깨진 펌프 슬롯(sb3.slots) → 기본 재료 / 빈틈없는 펌프 번호', async () => {
  const before = useSlots.getState().slots;
  kv.setItem(STORAGE_KEYS.slots, JSON.stringify({ state: { slots: 'junk' }, version: 1 }));
  await useSlots.persist.rehydrate();
  assert.equal(useSlots.getState().slots, before, '배열이 아니면 지금 재료 그대로');

  kv.setItem(
    STORAGE_KEYS.slots,
    JSON.stringify({ state: { slots: [null, { pump: 3, name: '진', abv: 'x', remainingMl: 99999, capacityMl: 700 }, { pump: 1, name: 5 }, { pump: 3, name: '중복' }] }, version: 1 }),
  );
  await useSlots.persist.rehydrate();
  const slots = useSlots.getState().slots;
  assert.deepEqual(
    slots.map((x) => x.pump),
    [1, 2, 3],
    '빠진 2번은 빈 슬롯',
  );
  assert.equal(slots[0].name, '');
  assert.equal(slots[1].name, '');
  assert.equal(slots[2].name, '진');
  assert.equal(slots[2].abv, 0);
  assert.equal(slots[2].remainingMl, 700, '잔량은 용량 안으로');
  assert.equal(typeof useSlots.getState().updateSlot, 'function');
  assert.equal(sanitizeSlots([]), null);
  assert.equal(sanitizeSlots([{ pump: 0 }, { pump: 9 }, { pump: 1.5 }]), null);
});

test('FLOW-5: 깨진 기록(sb3.history) → 레시피·재료가 없는 항목은 버리고 빠진 칸은 기본값', async () => {
  const good = { id: 'h1', createdAt: 5, recipe: RECIPE, source: 'offline', status: 'done', dispensed: [{ p: 1, ml: 200 }], feedback: 'like', moods: [], strength: 'none' };
  kv.setItem(
    STORAGE_KEYS.history,
    JSON.stringify({
      state: {
        entries: [null, { id: 'bad', recipe: {} }, good, { recipe: { name: '반쪽', ingredients: [{ pump: 1, name: '사이다', ml: 100 }] } }],
        favorites: 'junk',
        rejections: [{ name: '거절', ingredients: [{ name: '콜라', ml: 100 }, 'x'] }, { name: 1 }],
      },
      version: 1,
    }),
  );
  await useHistory.persist.rehydrate();
  const h = useHistory.getState();
  assert.equal(h.entries.length, 2);
  assert.equal(h.entries[0].id, 'h1');
  assert.equal(h.entries[0].feedback, 'like');
  const half = h.entries[1];
  assert.equal(half.recipe.name, '반쪽');
  assert.deepEqual(half.recipe.flavor, { sweet: 0, sour: 0, bitter: 0, fizzy: 0, strength: 0 });
  assert.deepEqual(half.recipe.suggestions, []);
  assert.equal(half.recipe.totalMl, 100);
  assert.deepEqual(half.dispensed, []);
  assert.equal(half.status, 'done');
  assert.deepEqual(h.favorites, []);
  assert.equal(h.rejections.length, 1);
  assert.deepEqual(h.rejections[0].ingredients, [{ name: '콜라', ml: 100 }]);
  assert.equal(typeof h.addRejection, 'function');
  assert.equal(sanitizeRecipe({ name: 'x', ingredients: [] }), null, '재료가 없으면 버림');
  assert.deepEqual(sanitizeHistory(undefined), { entries: [], favorites: [], rejections: [] });
});

test('FLOW-5: 깨진 설정(sb3.settings) → 알 수 없는 값은 기본값, set·reset 같은 함수는 덮어쓰지 않음', async () => {
  kv.setItem(
    STORAGE_KEYS.settings,
    JSON.stringify({
      state: { set: 1, reset: 'x', aiMode: 'server', demoMode: 'yes', notifyAsked: true, lastDevices: { web: { id: 'AA' }, cap: 'junk' }, adultVerifiedAt: 'today' },
      version: 1,
    }),
  );
  await useSettings.persist.rehydrate();
  const st = useSettings.getState();
  assert.equal(typeof st.set, 'function');
  assert.equal(typeof st.reset, 'function');
  assert.equal(st.aiMode, SETTINGS_DEFAULTS.aiMode);
  assert.equal(st.demoMode, SETTINGS_DEFAULTS.demoMode);
  assert.equal(st.notifyAsked, true);
  assert.deepEqual(st.lastDevices, { web: { id: 'AA', name: null, at: 0 } });
  assert.equal(st.adultVerifiedAt, null);
  assert.deepEqual(sanitizeSettings('junk'), { ...SETTINGS_DEFAULTS, lastDevices: {} });
});
