/// <reference types="node" />
/**
 * 재료 편집 화면 계산(screens/ingredients/logic) — 첫 값·프리셋 검색·종류별 도수·술 0% 확인·추천 펌프·요약
 * 화면 작업자가 만든 확인용 테스트를 tests/ 로 모음 (v3.0 통합). 순수 함수·대역만 — 실제 Gemini·기기 호출 없음
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultSlots, emptySlot, PRESETS } from '../src/lib/presets';
import type { PumpSlot } from '../src/lib/types';
import { isLowStock } from '../src/store/slots';
import {
  abvForCategoryChange,
  alcoholZeroCheck,
  clampAbv,
  doneKeysOf,
  filterPresets,
  initialForm,
  isInstalled,
  isMaterialChanged,
  looksAlcoholic,
  pumpSummary,
  suggestPumpPick,
} from '../src/screens/ingredients/logic';

const slots = (): PumpSlot[] => defaultSlots(4);

test('initialForm: existing slot', () => {
  const s = slots()[1];
  const f = initialForm({ ...s, remainingMl: 300 }, {});
  assert.equal(f.name, '오렌지주스');
  assert.equal(f.remainingMl, 300);
  assert.equal(f.category, 'juice');
});

test('initialForm: empty slot → remaining = capacity', () => {
  const f = initialForm(emptySlot(3), {});
  assert.equal(f.name, '');
  assert.equal(f.remainingMl, 1000);
});

test('initialForm: suggest from explore keeps AI name, params category/abv', () => {
  const f = initialForm(slots()[0], { suggest: '  보드카 ', from: 'explore', category: 'spirit', abv: '40' });
  assert.equal(f.name, '보드카');
  assert.equal(f.category, 'spirit');
  assert.equal(f.abv, 40);
  assert.equal(f.remainingMl, f.capacityMl);
  assert.equal(f.notes, '');
});

test('initialForm: suggest (not explore) uses preset name; bad category ignored; abv capped 96', () => {
  const f = initialForm(slots()[0], { suggest: '스프라이트', category: 'nope', abv: '200' });
  assert.equal(f.name, '사이다');
  assert.equal(f.category, 'soda');
  assert.equal(f.abv, 96);
  const g = initialForm(slots()[0], { suggest: '이상한재료' });
  assert.equal(g.category, 'other');
  assert.equal(g.abv, 0);
  assert.equal(g.color, slots()[0].color);
});

test('filterPresets: unchanged name shows 12 or all, typing searches', () => {
  assert.equal(filterPresets('콜라', '콜라', false).list.length, Math.min(12, PRESETS.length));
  assert.equal(filterPresets('콜라', '콜라', true).list.length, PRESETS.length);
  const r = filterPresets('토닉', '', false);
  assert.ok(r.searching);
  assert.ok(r.list.some((p) => p.name === '토닉워터'));
  const al = filterPresets('스프라이트', '', false);
  assert.ok(al.list.some((p) => p.name === '사이다'));
});

test('abvForCategoryChange (legacy rules)', () => {
  assert.equal(abvForCategoryChange('juice', 'spirit', 0), 40);
  assert.equal(abvForCategoryChange('juice', 'liqueur', 0), 20);
  assert.equal(abvForCategoryChange('juice', 'wine', 0), 12);
  assert.equal(abvForCategoryChange('spirit', 'liqueur', 40), 40);
  assert.equal(abvForCategoryChange('spirit', 'juice', 40), 0);
  assert.equal(abvForCategoryChange('juice', 'juice', 5), 5);
});

test('alcoholZeroCheck', () => {
  assert.equal(alcoholZeroCheck('보드카', 'spirit', 40), null);
  assert.equal(alcoholZeroCheck('오렌지주스', 'juice', 0), null);
  const a = alcoholZeroCheck('보드카', 'other', 0);
  assert.ok(a && a.message.includes('보드카는 보통 도수'));
  assert.equal(a?.fix, 40);
  const b = alcoholZeroCheck('내 술', 'liqueur', 0);
  assert.ok(b && b.message.includes("'리큐르'(술)"));
  assert.equal(b?.fix, 20);
  assert.ok(looksAlcoholic('보드카', 'juice'));
  assert.ok(!looksAlcoholic('진저 시럽', 'syrup'));
  assert.equal(clampAbv(12.345), 12.3);
  assert.equal(clampAbv(-1), 0);
});

test('isMaterialChanged / doneKeysOf', () => {
  assert.ok(!isMaterialChanged(emptySlot(1), 'x', 'juice'));
  assert.ok(isMaterialChanged(slots()[0], '콜라', 'soda'));
  assert.ok(isMaterialChanged(slots()[0], '사이다', 'water'));
  assert.ok(!isMaterialChanged(slots()[0], ' 사이다 ', 'soda'));
  const d = doneKeysOf('보드카|토닉워터', '라임 주스', '라임주스');
  assert.deepEqual([...d].sort(), ['라임주스', '보드카', '토닉워터'].sort());
});

test('suggestPumpPick: empty pump first, else least used avoiding current recipe pumps', () => {
  const s = slots();
  s[2] = emptySlot(3);
  assert.deepEqual(suggestPumpPick(s, [], '보드카'), { pump: 3, reason: 'empty' });
  const full = slots();
  const entries = [
    { recipe: { ingredients: [{ pump: 1, name: '사이다' }, { pump: 2, name: '오렌지주스' }] } },
    { recipe: { ingredients: [{ pump: 1, name: '사이다' }, { pump: 4, name: '콜라' }] } },
  ];
  const p = suggestPumpPick(full, entries, '보드카');
  assert.equal(p?.pump, 3); // 레몬즙 0회
  assert.equal(p?.reason, 'least_used');
  const q = suggestPumpPick(full, entries, '보드카', [{ pump: 3, name: '레몬즙', ml: 20 }]);
  assert.notEqual(q?.pump, 3);
  assert.equal(q?.pump, 2);
});

test('isInstalled / pumpSummary', () => {
  assert.ok(isInstalled(slots(), '오렌지 주스'));
  assert.ok(!isInstalled(slots(), '보드카'));
  const s = slots();
  s[0] = { ...s[0], remainingMl: 10 };
  s[3] = { ...emptySlot(4) };
  s[2] = { ...s[2], name: '보드카', abv: 40, category: 'spirit' };
  assert.deepEqual(pumpSummary(s, isLowStock), { installed: 3, total: 4, low: 1, alcohol: 1 });
});
