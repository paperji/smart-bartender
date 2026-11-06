/// <reference types="node" />
/**
 * v3.0 웹 이식 서비스 테스트 (WEBAPP_DESIGN §5·§7)
 *  - 화면 이동 서비스(lib/nav): 등록 전 이동 요청 보관, 쿼리 주소, 재료 편집 주소(탐색 카드 → #/ingredients/:pump?…)
 *  - 확인창 서비스(ui/dialog/service): 차례대로 답하기, confirm → true/false, alert → 끝남
 *  - brew.startBrew: 기기 미연결 확인창 → 기기 화면, 재료 구성 바뀜 안내, 술이 든 레시피는 성인 확인(store/adultGate)
 *  - 저장 키 'sb3.' (v2.1 과 겹치지 않음), 앱 앞/뒤 상태(Node 기본 active)
 *  - scripts/check-no-secrets.mjs: 키 모양·개발용 키 이름을 찾으면 실패하고 값은 출력하지 않음
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ingredientEditPath, openInstall } from '../src/lib/flow';
import { go, setNavigator, withQuery } from '../src/lib/nav';
import type { ExploreItem, Recipe } from '../src/lib/types';
import { currentAppState, isAppActive, onAppStateChange } from '../src/platform/appState';
import { answerAdultGate, ensureAdult, useAdultGate } from '../src/store/adultGate';
import { setDevice } from '../src/store/device';
import { useSession } from '../src/store/draft';
import { useSettings } from '../src/store/settings';
import { useSlots } from '../src/store/slots';
import { STORAGE_KEYS } from '../src/store/storage';
import { useToast } from '../src/store/toast';
import { alert, confirm, resolveDialog, useDialogs } from '../src/ui/dialog/service';

import { alerts, installDialogStub, setConfirmAnswer } from './stubs/dialog';
import { installRouterStub, pushes } from './stubs/router';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('화면 이동 서비스: 등록 전 이동은 기억했다가 등록되면 실행, replace 옵션 전달, 쿼리 주소', () => {
  setNavigator(null);
  go('/recipe', { replace: true });
  const got: { to: string | number; opts?: unknown }[] = [];
  setNavigator((to, opts) => got.push({ to, opts }));
  assert.deepEqual(got, [{ to: '/recipe', opts: { replace: true } }]);
  go('/device');
  assert.deepEqual(got[1], { to: '/device', opts: undefined });
  setNavigator(null);
  assert.equal(withQuery('/x', { a: '1', b: undefined, c: '', d: null, e: 2 }), '/x?a=1&e=2');
  assert.equal(withQuery('/x', {}), '/x');
});

test('탐색 카드 "펌프 N에 장착하기" → #/ingredients/:pump?suggest=…&category=…&abv=…&from=explore&done=… (v2.1 ingredient-edit 매개변수 그대로)', () => {
  const p = installRouterStub();
  p.length = 0;
  const item: ExploreItem = {
    addIngredient: '토닉워터',
    category: 'soda',
    abv: 0,
    recipeName: '보드카 토닉',
    description: '',
    ingredients: [{ name: '토닉워터', ml: 150, installed: false }],
    message: '',
  };
  openInstall(item, { pump: 2, reason: 'empty' } as any);
  openInstall(item, { pump: 3, reason: 'least_used' } as any, { ingredient: { name: '레몬 & 라임', category: 'juice', abv: 0 }, done: ['토닉워터', '진'], replace: true });
  assert.equal(p[0], '/ingredients/2?suggest=%ED%86%A0%EB%8B%89%EC%9B%8C%ED%84%B0&category=soda&abv=0&from=explore');
  const u = new URL(`http://x${p[1]}`);
  assert.equal(u.pathname, '/ingredients/3');
  assert.equal(u.searchParams.get('suggest'), '레몬 & 라임');
  assert.equal(u.searchParams.get('category'), 'juice');
  assert.equal(u.searchParams.get('abv'), '0');
  assert.equal(u.searchParams.get('from'), 'explore');
  assert.equal(u.searchParams.get('done'), '토닉워터|진');
  assert.equal(useSession.getState().installTarget, item);
  assert.equal(ingredientEditPath(1), '/ingredients/1');
});

test('확인창 서비스: 들어온 차례대로 보이고, confirm 은 true/false, alert 는 확인으로 끝남', async () => {
  const a = confirm('제목1', '내용1', { confirmText: '모두 초기화', destructive: true });
  const b = alert('제목2', '내용2');
  const q = useDialogs.getState().queue;
  assert.equal(q.length, 2);
  assert.deepEqual([q[0].kind, q[0].confirmText, q[0].cancelText, q[0].destructive, q[0].tone], ['confirm', '모두 초기화', '취소', true, 'danger']);
  assert.deepEqual([q[1].kind, q[1].confirmText], ['alert', '확인']);
  resolveDialog(q[0].id, false);
  assert.equal(await a, false);
  resolveDialog(useDialogs.getState().queue[0].id, false);
  assert.equal(await b, undefined, 'alert 는 어떤 답이든 끝남');
  assert.equal(useDialogs.getState().queue.length, 0);
});

const RECIPE: Recipe = {
  name: '테스트',
  description: '',
  reason: '',
  ingredients: [{ pump: 1, name: '사이다', ml: 100 }],
  totalMl: 100,
  estimatedAbv: 0,
  flavor: { sweet: 0, sour: 0, bitter: 0, fizzy: 0, strength: 0 },
  garnish: '',
  tips: '',
  suggestions: [],
};

function setCurrent(recipe: Recipe) {
  useSession.setState({
    current: {
      recipe,
      explore: [],
      mode: 'normal',
      source: 'offline',
      warnings: [],
      createdAt: Date.now(),
      input: { moods: [], taste: { sweet: 0, sour: 0, bitter: 0, fizzy: 0 }, strength: 'none', weather: null, situation: '', preference: '', cupMl: 100 },
      variation: 0,
    },
  });
}

test('brew.startBrew: 기기가 연결되어 있지 않으면 확인창 → "기기 탭으로" 누르면 #/device, 닫기면 이동 없음', async () => {
  const brew = await import('../src/lib/brew');
  installDialogStub();
  const p = installRouterStub();
  setCurrent(RECIPE);
  setDevice({ conn: 'idle', job: null });
  for (const answer of [true, false]) {
    p.length = 0;
    alerts.length = 0;
    setConfirmAnswer(answer);
    assert.equal(await brew.startBrew(), false);
    assert.equal(alerts[0]?.title, '기기가 연결되어 있지 않아요');
    assert.deepEqual(p, answer ? ['/device'] : []);
  }
  setConfirmAnswer(true);
});

test('brew.startBrew: 재료 구성이 바뀌었으면 안내창, 술이 든 레시피는 성인 확인 창(거절하면 제조 안 함)', async () => {
  const brew = await import('../src/lib/brew');
  installDialogStub();
  setDevice({ conn: 'connected', job: null });
  // 펌프 1 의 재료가 레시피(사이다)와 다름
  useSlots.setState({ slots: [{ pump: 1, name: '콜라', category: 'soda', abv: 0, capacityMl: 1000, remainingMl: 800, color: '#fff', notes: '', updatedAt: 0 }] });
  alerts.length = 0;
  setCurrent(RECIPE);
  assert.equal(await brew.startBrew(), false);
  assert.equal(alerts[0]?.title, '재료 구성이 바뀌었어요');
  // 술(보드카) → 성인 확인 창
  useSlots.setState({ slots: [{ pump: 1, name: '보드카', category: 'spirit', abv: 40, capacityMl: 1000, remainingMl: 800, color: '#fff', notes: '', updatedAt: 0 }] });
  useSettings.getState().set({ adultVerifiedAt: null });
  setCurrent({ ...RECIPE, ingredients: [{ pump: 1, name: '보드카', ml: 30 }], totalMl: 30 });
  const started = brew.startBrew();
  await wait(10);
  assert.equal(useAdultGate.getState().visible, true, '성인 확인 창이 뜸');
  answerAdultGate(false);
  assert.equal(await started, false);
  assert.equal(useSettings.getState().adultVerifiedAt, null);
  assert.equal(useToast.getState().message, '무알콜로 설정하고 다시 추천받아 보세요.');
  // 확인하면 시각 저장, 다음부터는 묻지 않음
  const again = ensureAdult();
  answerAdultGate(true);
  assert.equal(await again, true);
  assert.ok(useSettings.getState().adultVerifiedAt);
  assert.equal(await ensureAdult(), true);
  assert.equal(useAdultGate.getState().visible, false);
  useSettings.getState().set({ adultVerifiedAt: null });
  setDevice({ conn: 'idle', job: null });
});

test('저장 키는 sb3. 으로 시작 (v2.1 앱 sb. 과 겹치지 않음), Node 에서는 앱 상태가 늘 active', () => {
  for (const k of Object.values(STORAGE_KEYS)) assert.match(k, /^sb3\./);
  assert.equal(currentAppState(), 'active');
  assert.equal(isAppActive(), true);
  const off = onAppStateChange(() => undefined);
  off();
});

test('check-no-secrets: 키 모양(AQ.·AIza)·개발용 키 이름이 든 파일을 찾으면 exit 1 + 파일 이름만 출력(값은 출력 안 함)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sb3-secret-'));
  const script = path.join(import.meta.dirname, '..', 'scripts', 'check-no-secrets.mjs');
  try {
    // 가짜 값은 실행 중에 만들어 이 테스트 파일 자체에는 키 모양 문자열이 없게 함
    const fakeAq = ['AQ', '.', 'Zz9'.repeat(10)].join('');
    const fakeAiza = ['AI', 'za', 'Yy8_'.repeat(9)].join('');
    writeFileSync(path.join(dir, 'clean.js'), 'console.log("hello");');
    const clean = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
    // dist 가 이미 있으면 그것도 함께 검사하므로, dist 가 깨끗하다는 전제에서 통과해야 함
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    for (const [name, content] of [
      ['aq.js', `const k = "${fakeAq}";`],
      ['aiza.txt', `key=${fakeAiza}`],
      ['envname.js', 'import.meta.env.VITE_DEV_GEMINI_KEY'],
    ] as const) {
      const f = path.join(dir, name);
      writeFileSync(f, content);
      const r = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
      assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
      assert.ok((r.stdout + r.stderr).includes(name), '파일 이름 표시');
      assert.ok(!(r.stdout + r.stderr).includes(fakeAq) && !(r.stdout + r.stderr).includes(fakeAiza), '값은 출력하지 않음');
      rmSync(f);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
