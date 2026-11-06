/// <reference types="node" />
/**
 * 제조 결과 처리(brew.ts registerJobEffects: 잔량 차감·기록·알림) + 실제 client.ts + 데모 가상 기기 테스트
 *  - 결과를 모른 채 닫은 제조도 재연결 뒤 status.last 로 바로잡음 (SPEC §2.4 ②, "기기 탭에서 다시 연결" 흐름)
 *  - 같은 작업이 다시 끝나면 잔량은 차이만 — 프라이밍(run, purpose 'prime')도 같음
 *  - 기록·알림은 그 작업을 시작할 때의 레시피 (나중에 화면의 레시피가 바뀌어도)
 *  - 같은 id 로 다시 만든 작업(펌웨어 BUTTON_REPEAT_LAST)은 새 작업: 잔량 차감·새 기록·알림
 *  - 기록/즐겨찾기 "다시 만들기": 지금 성향의 알레르기 재료는 처음부터 빼고 안내 (SPEC §3.3 규칙 1, cleanText 정리 문장)
 * v3.0: 화면 이동(lib/nav)·확인창(ui/dialog)·알림(platform/notify) 은 tests/stubs 의 대역을 끼워 기록만 함
 * (v2.1 의 react-native · AsyncStorage · expo-router · lib/ui · AdultGate 대역 대신). 저장소는 Node 에 localStorage 가 없어 메모리. 실제 Gemini 호출 없음.
 * 재연결 대기(1~30초)처럼 1초 이상인 타이머는 50배 빠르게 (기기 응답 지연 25ms·progress 250ms 는 그대로)
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { alerts, installDialogStub } from './stubs/dialog';
import { installNotifyStub } from './stubs/notify';
import { installRouterStub } from './stubs/router';

const skip = false;

const realSetTimeout = globalThis.setTimeout;
(globalThis as any).setTimeout = ((fn: any, ms?: number, ...a: any[]) =>
  realSetTimeout(fn, ms && ms >= 1000 ? Math.max(1, ms / 50) : ms, ...a)) as typeof setTimeout;
const wait = (ms: number) => new Promise((r) => realSetTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000, step = 10) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await wait(step);
  }
  return cond();
}

type Mods = Record<string, any>;
let M: Mods | null = null;
async function load(): Promise<Mods> {
  if (M) return M;
  const { deviceClient } = await import('../src/lib/device/client');
  const { useDevice, isBusy } = await import('../src/store/device');
  const { useSettings } = await import('../src/store/settings');
  const { useSlots } = await import('../src/store/slots');
  const { useHistory } = await import('../src/store/history');
  const { useDraft, useSession } = await import('../src/store/draft');
  const brew = await import('../src/lib/brew');
  const off = brew.registerJobEffects();
  installDialogStub();
  const sent = installNotifyStub();
  const pushes = installRouterStub();
  M = { deviceClient, useDevice, isBusy, useSettings, useSlots, useHistory, useDraft, useSession, brew, off, sent, pushes, alerts };
  return M;
}

after(async () => {
  if (!M) return;
  M.off?.();
  await M.deviceClient.init(false).catch(() => undefined);
});

const NAMES = ['사이다', '오렌지주스', '레몬즙', '콜라'];
const ends: any[] = [];
let offEnd: (() => void) | null = null;

/** 새 데모 연결 + 재료 4종(잔량 500ml) + 기록·알림 비움. 앱이 연결 직후 보낸 status 응답까지 받고, 가상 기기가 300ms 켜져 있은 뒤 돌려줌 */
async function fresh() {
  const m = await load();
  const c = m.deviceClient;
  await c.init(false).catch(() => undefined);
  await c.init(true, { autoConnect: false });
  m.useSettings.setState({ autoReconnect: true, notifyAsked: true, dispenseMode: 'seq' });
  m.useSlots.setState({
    slots: [1, 2, 3, 4].map((p) => ({
      pump: p,
      name: NAMES[p - 1],
      category: p === 2 ? 'juice' : 'soda',
      abv: 0,
      capacityMl: 1000,
      remainingMl: 500,
      color: '#fff',
      notes: '',
      updatedAt: 0,
    })),
  });
  m.useHistory.setState({ entries: [] });
  m.useSession.setState({ current: null, brewHistoryId: null });
  m.sent.length = 0;
  m.pushes.length = 0;
  ends.length = 0;
  offEnd?.();
  offEnd = c.onJobEnd((j: any) => ends.push({ id: j.id, localKey: j.localKey, kind: j.kind, status: j.status, reason: j.reason, uncertain: !!j.uncertain, dispensed: j.dispensed }));
  let sawStatus = false;
  const offLine = c.transport.onLine((l: string) => {
    if (l.includes('"ev":"status"')) sawStatus = true;
  });
  const t0 = Date.now();
  await c.connect('demo-device', 'SmartBartender-DEMO');
  assert.ok(await until(() => !!m.useDevice.getState().info && sawStatus));
  offLine();
  if (Date.now() - t0 < 300) await wait(300 - (Date.now() - t0));
  const t = c.transport;
  const realConnect = t.connect.bind(t);
  const ctl = {
    t,
    vd: () => t.device('demo-device'),
    allow: true,
    drop() {
      t.connected = false;
      t.states.emit('disconnected', { deviceId: 'demo-device', unexpected: true });
    },
  };
  t.connect = async (id: string, opts?: unknown) => {
    if (!ctl.allow) throw new Error('연결 시간이 초과됐어요');
    return realConnect(id, opts);
  };
  return { m, c, ctl };
}

const rem = (m: Mods, p: number) => m.useSlots.getState().slots.find((s: any) => s.pump === p).remainingMl;
const recipe = (name: string, p: number, ml: number) => ({
  name,
  description: '',
  reason: '',
  ingredients: [{ pump: p, name: NAMES[p - 1], ml }],
  totalMl: ml,
  estimatedAbv: 0,
  flavor: { sweet: 0, sour: 0, bitter: 0, fizzy: 0, strength: 0 },
  garnish: '',
  tips: '',
  suggestions: [],
});
/** 레시피 화면의 현재 레시피(세션) 바꾸기 — 다른 추천을 받은 것과 같음 */
function setCurrent(m: Mods, name: string, p: number, ml: number, mood = '피곤함') {
  m.useSession.setState({
    current: {
      recipe: recipe(name, p, ml),
      explore: [],
      mode: 'normal',
      source: 'offline',
      warnings: [],
      createdAt: Date.now() + Math.random(),
      input: { moods: [mood], taste: { sweet: 0, sour: 0, bitter: 0, fizzy: 0 }, strength: 'none', weather: null, situation: '', preference: '', cupMl: ml },
      variation: 0,
    },
  });
}
const giveUp = (m: Mods) => until(() => m.useDevice.getState().conn === 'disconnected' && !m.isBusy(m.useDevice.getState().job), 8000);

test('결과 모름 → "기기 탭에서 다시 연결"(abandonJob + clearJob) → 다시 연결: 잔량은 실제 나온 양만, 기록은 실제 결과로 (SPEC §2.4 ②)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  setCurrent(m, '레시피A', 1, 20);
  assert.equal(await m.brew.startBrew(), true);
  await until(() => m.useDevice.getState().job?.pumps?.[0]?.done > 0);
  ctl.allow = false;
  ctl.drop();
  assert.ok(await giveUp(m), '자동 재연결 포기');
  const firstMl = ends[0].dispensed[0].ml;
  assert.ok(firstMl > 0 && firstMl < 20);
  assert.equal(rem(m, 1), Math.round((500 - firstMl) * 10) / 10, '받은 진행량만 먼저 차감');
  c.abandonJob();
  c.clearJob(); // goReconnect
  assert.ok(await until(() => ctl.vd().state === 'idle', 3000));
  ctl.allow = true;
  await c.connect('demo-device', 'SmartBartender-DEMO');
  assert.ok(await until(() => ends.length === 2, 3000));
  await wait(50);
  assert.equal(rem(m, 1), 480, '실제 20ml 만큼만 (차이만 더 뺌)');
  const hist = m.useHistory.getState().entries;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].status, 'done');
  assert.equal(hist[0].uncertain, undefined, '결과 확인 필요 표시 없앰');
  assert.deepEqual(hist[0].dispensed, [{ p: 1, ml: 20 }]);
  assert.equal(m.useDevice.getState().job, null, '닫은 화면은 다시 열지 않음');
});

test('프라이밍(run, prime)이 "결과 모름" 뒤 status.last 로 다시 끝남 → 잔량은 처음 뺀 양과의 차이만 (이중 차감 없음)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  await c.run(1, 1500, { purpose: 'prime' }); // 20ml/s → 30ml
  await until(() => m.useDevice.getState().job?.pumps?.[0]?.done > 0);
  ctl.allow = false;
  ctl.drop();
  assert.ok(await giveUp(m));
  const first = ends[0];
  assert.equal(first.kind, 'run');
  assert.equal(first.reason, 'disconnected');
  assert.equal(rem(m, 1), Math.round((500 - first.dispensed[0].ml) * 10) / 10);
  assert.ok(await until(() => ctl.vd().state === 'idle', 3000));
  ctl.allow = true;
  await c.connect('demo-device', 'SmartBartender-DEMO'); // 기기 탭에서 다시 연결 (유지보수 카드는 닫지 않음)
  assert.ok(await until(() => ends.length === 2, 3000));
  await wait(50);
  assert.equal(ends[1].status, 'done');
  assert.equal(ends[1].localKey, first.localKey, '같은 작업');
  assert.deepEqual(ends[1].dispensed, [{ p: 1, ml: 30 }]);
  assert.equal(rem(m, 1), 470, '실제 나온 30ml 만 (예전: 35ml 안팎 차감)');
});

test('프라이밍이 "결과 모름" 뒤 되살아나 끝까지 구동 → done: 잔량은 차이만', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  await c.run(1, 5000, { purpose: 'prime' }); // 100ml
  await until(() => m.useDevice.getState().job?.pumps?.[0]?.done > 0);
  ctl.allow = false;
  ctl.drop();
  assert.ok(await giveUp(m));
  ctl.allow = true;
  await c.connect('demo-device', 'SmartBartender-DEMO');
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'running', 2000), '되살아남');
  assert.ok(await until(() => ends.length === 2, 6000));
  await wait(50);
  assert.equal(ends[1].status, 'done');
  assert.equal(rem(m, 1), 400);
});

test('재확정된 제조 결과는 그 작업을 시작할 때의 레시피로 기록·알림 (나중에 받은 다른 추천으로 덮어쓰지 않음)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  setCurrent(m, '레시피A', 1, 20, '피곤함');
  assert.equal(await m.brew.startBrew(), true);
  const jobId = m.useDevice.getState().job.id;
  await until(() => m.useDevice.getState().job?.pumps?.[0]?.done > 0);
  ctl.allow = false;
  ctl.drop();
  assert.ok(await giveUp(m));
  const before = m.useHistory.getState().entries;
  assert.equal(before.length, 1);
  assert.equal(before[0].recipe.name, '레시피A');
  assert.equal(m.useSession.getState().brewHistoryId, 'h' + jobId);
  // 뒤로가기로 진행 화면을 나간 뒤(작업은 그대로) 새 추천 B 를 받음
  setCurrent(m, '레시피B', 2, 150, '신남');
  m.useSession.setState({ brewHistoryId: null });
  m.sent.length = 0;
  ctl.allow = true;
  await c.connect('demo-device', 'SmartBartender-DEMO');
  assert.ok(await until(() => ends.length === 2, 3000));
  await wait(50);
  const after = m.useHistory.getState().entries;
  assert.equal(after.length, 1);
  assert.equal(after[0].id, 'h' + jobId);
  assert.equal(after[0].recipe.name, '레시피A', '레시피 이름 유지');
  assert.deepEqual(after[0].recipe.ingredients, [{ pump: 1, name: '사이다', ml: 20 }], '재료 유지');
  assert.deepEqual(after[0].moods, ['피곤함'], '입력 유지');
  assert.equal(after[0].status, 'done', '결과만 갱신');
  assert.deepEqual(after[0].dispensed, [{ p: 1, ml: 20 }]);
  assert.equal(m.sent.length, 1);
  assert.match(m.sent[0].body, /^레시피A /, '알림도 그 작업의 레시피 이름');
  assert.equal(m.useSession.getState().brewHistoryId, null, '지금 세션(B)의 기록 ID 를 A 로 바꾸지 않음');
  assert.equal(m.brew.brewSnapshotOf(m.useDevice.getState().job)?.recipe.name, '레시피A', '진행 화면 이름도 그 작업의 레시피');
});

test('같은 id 로 다시 만든 작업(펌웨어 BUTTON_REPEAT_LAST) → 새 작업: 잔량 차감·새 기록·완료 알림', { skip }, async () => {
  const { m, ctl } = await fresh();
  setCurrent(m, '레시피D', 1, 20);
  assert.equal(await m.brew.startBrew(), true);
  assert.ok(await until(() => ends.length === 1, 4000));
  await wait(50);
  const id = ends[0].id;
  assert.equal(rem(m, 1), 480);
  m.pushes.length = 0;
  ctl.vd().receive(JSON.stringify({ cmd: 'make', id, steps: [{ p: 1, ml: 20 }] }) + '\n'); // 버튼 길게 → 같은 id 로 다시
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'running', 1000));
  assert.deepEqual(m.pushes, ['/brewing'], '진행 화면을 엶');
  assert.ok(await until(() => ends.length === 2, 4000));
  await wait(50);
  assert.equal(rem(m, 1), 460, '두 번째 잔도 차감');
  const hist = m.useHistory.getState().entries;
  assert.deepEqual(hist.map((h: any) => h.id).sort(), ['h' + id, 'h' + id + '-2'], '기록 2건 (첫 기록을 덮어쓰지 않음)');
  assert.ok(hist.every((h: any) => h.recipe.name === '레시피D' && h.status === 'done'));
  assert.equal(m.sent.filter((s: any) => s.kind === 'done').length, 2, '완료 알림 2번');
  assert.equal(m.useSession.getState().brewHistoryId, 'h' + id + '-2', '피드백은 두 번째 잔의 기록에');
});

test('기록 "다시 만들기": 지금 성향의 알레르기 재료는 처음부터 빼고 안내 → 레시피 화면 ml 조정과 같은 기준 (SPEC §3.3 규칙 1)', { skip }, async () => {
  const m = await load();
  const { normalizeRecipe, revalidateRecipe, cleanText } = await import('../src/lib/ai/normalize');
  const { preferenceExcludedPumps } = await import('../src/lib/ai/preference');
  const { slotsToIngredients } = await import('../src/lib/ai/recommend');
  const slots = [
    { pump: 1, name: '우유', category: 'dairy', abv: 0, capacityMl: 1000, remainingMl: 800, color: '#fff', notes: '', updatedAt: 0 },
    { pump: 2, name: '사이다', category: 'soda', abv: 0, capacityMl: 1000, remainingMl: 800, color: '#fff', notes: '', updatedAt: 0 },
    { pump: 3, name: '그레나딘 시럽', category: 'syrup', abv: 0, capacityMl: 1000, remainingMl: 800, color: '#fff', notes: '', updatedAt: 0 },
  ];
  const saved = {
    ...recipe('핑크 밀크', 1, 100),
    ingredients: [
      { pump: 1, name: '우유', ml: 100 },
      { pump: 2, name: '사이다', ml: 80 },
      { pump: 3, name: '그레나딘 시럽', ml: 20 },
    ],
    totalMl: 200,
  };
  // 바텐더 탭 성향(저장된 초안) — 줄바꿈·연속 공백도 서버와 같게 정리해서 판정
  const preference = '  우유\n 알레르기 ';
  m.useDraft.setState({ input: { ...m.useDraft.getState().input, preference } });
  const res = m.brew.remapSavedRecipe(saved, slots, 'none', false); // 기본값: 바텐더 탭 성향
  assert.deepEqual(res.recipe.ingredients.map((i: any) => i.name), ['사이다', '그레나딘 시럽'], '우유는 처음부터 뺌');
  assert.ok(res.warnings.some((w: string) => w.includes("성향에 적힌 대로 '우유'")), JSON.stringify(res.warnings));
  assert.deepEqual(m.brew.remapSavedRecipe(saved, slots, 'none', false, '').recipe.ingredients.length, 3, '성향이 없으면 그대로');
  // 레시피 화면(recipe.tsx)과 같은 ctx 로 ml 조정해도 더 빠지는 재료 없음 → 안내 없이 사라지는 일 없음
  const ingredients = slotsToIngredients(slots as any);
  const ctx = { ingredients, strength: 'none' as const, excludePumps: preferenceExcludedPumps(ingredients, cleanText(preference, 300)), adultVerified: false };
  const bumped = { ...res.recipe, ingredients: res.recipe.ingredients.map((i: any) => (i.pump === 2 ? { ...i, ml: i.ml + 5 } : i)) };
  assert.deepEqual(m.brew.removalNotes(bumped, revalidateRecipe(bumped, ctx)), []);
  // (예전 흐름) 성향 제외 없이 불러온 레시피를 조정·잔 맞춤하면 우유가 빠짐 → removalNotes 가 그 안내를 돌려줌 (화면 배너·토스트)
  const adj = { ...saved, ingredients: saved.ingredients.map((i) => (i.pump === 2 ? { ...i, ml: 85 } : i)) };
  assert.deepEqual(m.brew.removalNotes(adj, revalidateRecipe(adj, ctx)), ["성향에 적힌 대로 '우유'는 뺐어요."]);
  assert.deepEqual(m.brew.removalNotes(saved, normalizeRecipe(saved, { ...ctx, cupMl: 200 })), ["성향에 적힌 대로 '우유'는 뺐어요."]);
  // 우유만 든 기록은 처음부터 "만들 수 없어요" (+ 이유)
  assert.throws(
    () => m.brew.remapSavedRecipe({ ...recipe('밀크', 1, 200), ingredients: [{ pump: 1, name: '우유', ml: 200 }] }, slots, 'none', false),
    (e: any) => e.code === 'EMPTY_RECIPE' && e.adjustments.some((w: string) => w.includes("'우유'")),
  );
  m.useDraft.setState({ input: { ...m.useDraft.getState().input, preference: '' } });
});
