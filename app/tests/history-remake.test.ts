/// <reference types="node" />
/**
 * 기록·즐겨찾기 "다시 만들기"(screens/history/remake) — 펌프 다시 맞춤·성향 알레르기 제외·만들 수 없음 안내·출처
 * 화면 작업자가 만든 확인용 테스트를 tests/ 로 모음 (v3.0 통합). 순수 함수·대역만 — 실제 Gemini·기기 호출 없음
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('history remake helpers', async () => {
  const { alerts, installDialogStub } = await import('./stubs/dialog');
  const { pushes, installRouterStub } = await import('./stubs/router');
  installDialogStub();
  installRouterStub();
  const rm = await import('../src/screens/history/remake');
  const { useSlots } = await import('../src/store/slots');
  const { useDraft, useSession } = await import('../src/store/draft');
  const slots = [
    { pump: 1, name: '우유', category: 'dairy', abv: 0, capacityMl: 1000, remainingMl: 800, color: '#ffffff', notes: '', updatedAt: 0 },
    { pump: 2, name: '사이다', category: 'soda', abv: 0, capacityMl: 1000, remainingMl: 800, color: '#ffffff', notes: '', updatedAt: 0 },
    { pump: 3, name: '그레나딘 시럽', category: 'syrup', abv: 0, capacityMl: 1000, remainingMl: 800, color: '#ff0000', notes: '', updatedAt: 0 },
  ];
  useSlots.setState({ slots: slots as any });
  const base = { name: '핑크 밀크', description: '', reason: '', totalMl: 200, estimatedAbv: 0, flavor: { sweet: 0, sour: 0, bitter: 0, fizzy: 0, strength: 0 }, garnish: '', tips: '', suggestions: [] };
  const saved = { ...base, ingredients: [ { pump: 5, name: '우유', ml: 100 }, { pump: 6, name: '사이다', ml: 80 }, { pump: 7, name: '그레나딘 시럽', ml: 20 } ] };

  // 1) 성향 없음 → 펌프 번호 다시 매칭, 레시피 화면으로
  useDraft.setState({ input: { ...useDraft.getState().input, preference: '' } });
  assert.equal(rm.remakeSaved(saved as any, 'offline', 'none'), true);
  const cur = useSession.getState().current!;
  assert.deepEqual(cur.recipe.ingredients.map((i: any) => i.pump), [1, 2, 3]);
  assert.equal(cur.fromSaved, true);
  assert.equal(cur.source, 'offline');
  assert.equal(cur.input.cupMl, 200);
  assert.equal(pushes.at(-1), '/recipe');

  // 2) 성향 알레르기 → 우유 빼고 안내
  useDraft.setState({ input: { ...useDraft.getState().input, preference: '우유 알레르기' } });
  assert.equal(rm.remakeSaved(saved as any, 'direct'), true);
  const cur2 = useSession.getState().current!;
  assert.deepEqual(cur2.recipe.ingredients.map((i: any) => i.name), ['사이다', '그레나딘 시럽']);
  assert.ok(cur2.warnings.some((w: string) => w.includes("성향에 적힌 대로 '우유'")), JSON.stringify(cur2.warnings));
  assert.equal(cur2.input.strength, 'none');

  // 3) 우유만 → 다시 만들 수 없어요 + 이유
  const n = pushes.length;
  assert.equal(rm.remakeSaved({ ...saved, ingredients: [{ pump: 1, name: '우유', ml: 200 }] } as any, 'direct'), false);
  await new Promise((r) => setTimeout(r, 10));
  const a = alerts.at(-1)!;
  assert.equal(a.title, '다시 만들 수 없어요');
  assert.ok(a.msg.includes("'우유'"), a.msg);
  assert.equal(pushes.length, n);

  // 4) 미장착 재료 → 안내
  useDraft.setState({ input: { ...useDraft.getState().input, preference: '' } });
  rm.remakeSaved({ ...saved, ingredients: [...saved.ingredients, { pump: 4, name: '보드카', ml: 10 }] } as any, 'direct');
  assert.ok(useSession.getState().current!.warnings.some((w: string) => w.includes('지금 장착되지 않은 재료(보드카)')));

  // 5) favoriteOrigin
  const entry = { id: 'h1', createdAt: 0, recipe: saved, source: 'offline', status: 'done', dispensed: [], feedback: null, moods: [], strength: 'light' };
  assert.deepEqual(rm.favoriteOrigin(saved as any, [entry as any]), { source: 'offline', strength: 'light' });
  assert.deepEqual(rm.favoriteOrigin({ ...saved, name: 'x' } as any, [entry as any]), { source: 'direct' });

  // 6) error text
  assert.equal(rm.remakeErrorText(null), '지금 장착된 재료로는 이 레시피를 만들 수 없어요.');
  assert.equal(rm.remakeErrorText({ message: 'A', adjustments: ['b', 3, 'c'] }), 'A\nb\nc');
});
