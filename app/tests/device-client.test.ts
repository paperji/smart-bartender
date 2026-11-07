/// <reference types="node" />
/**
 * DeviceClient(연결 끊김·재연결·작업 정리) 테스트 — 실제 client.ts 를 데모 가상 기기와 함께 실행
 * v3.0: 앱 앞/뒤 상태는 platform/appState(document.visibilitychange) — tests/stubs/document 의 가짜 document 로 흉내
 * (v2.1 의 react-native AppState 대역 대신). 저장소는 Node 에 localStorage 가 없어 메모리.
 * 재연결 대기(1~30초)처럼 1초 이상인 타이머는 50배 빠르게 (기기 응답 지연 25ms·progress 250ms 는 그대로)
 * 재연결 후 판정(SPEC §2.4): status.last 로 끊긴 동안의 실제 결과 확인 → 없거나 다르면 재부팅 여부·경과 시간으로 판단
 * (가상 기기 reportLast=false 로 예전 펌웨어(last 없음)도 확인)
 * 하네스 경쟁 방지: fresh() 는 앱이 연결 직후 보낸 status 의 응답까지 받고, 가상 기기가 켜진 지 SETTLE_MS 가 지난 뒤 돌려줌
 * (가상 기기는 연결 순간에 새로 만들어지므로, 곧바로 make 하면 부팅→작업 시작이 수십 ms 뿐이라 응답 지연만으로 재부팅으로 오판될 수 있었음)
 * 화면 닫기 흐름은 실제 UI 와 같게 abandonJob() 뒤 clearJob() 까지 부름 (brewing.tsx closeWhileLost·goReconnect)
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { installFakeDocument, type FakeDocument } from './stubs/document';

// 앱 모듈을 불러오기 전에 가짜 document 설치 (client.ts 가 init 때 visibilitychange 를 구독)
const fakeDoc = installFakeDocument();
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

type Mods = {
  deviceClient: any;
  useDevice: any;
  useSettings: any;
  isBusy: (j: any) => boolean;
  doc: FakeDocument;
};
let mods: Mods | null = null;
async function load(): Promise<Mods> {
  if (mods) return mods;
  const { deviceClient } = await import('../src/lib/device/client');
  const { useDevice, isBusy } = await import('../src/store/device');
  const { useSettings } = await import('../src/store/settings');
  mods = { deviceClient, useDevice, useSettings, isBusy, doc: fakeDoc };
  return mods;
}

const ends: any[] = [];
let offEnd: (() => void) | null = null;

/** 연결 뒤 가상 기기가 켜져 있던 시간 — 부팅 시각과 작업 시작 시각이 충분히 떨어지게 (재부팅 오판 방지) */
const SETTLE_MS = 300;

/** 새 데모 연결 (가상 기기 새로 만들기) — 앱이 연결 직후 보낸 status 의 응답까지 받은 뒤 돌려줌 */
async function fresh() {
  const m = await load();
  const c = m.deviceClient;
  await c.init(false).catch(() => undefined); // 다른 통신으로 바꿨다가
  await c.init(true, { autoConnect: false }); // 데모로 다시 → 가상 기기 새로
  m.useSettings.setState({ autoReconnect: true });
  ends.length = 0;
  offEnd?.();
  offEnd = c.onJobEnd((j: any) =>
    ends.push({ id: j.id, localKey: j.localKey, status: j.status, reason: j.reason, uncertain: !!j.uncertain, dispensed: j.dispensed }),
  );
  let sawStatus = false;
  const offLine = c.transport.onLine((l: string) => {
    if (l.includes('"ev":"status"')) sawStatus = true;
  });
  const connectedAt = Date.now();
  await c.connect('demo-device', 'SmartBartender-DEMO');
  assert.ok(await until(() => !!m.useDevice.getState().info && sawStatus), '연결 직후 info·status 응답');
  offLine();
  const rest = SETTLE_MS - (Date.now() - connectedAt);
  if (rest > 0) await wait(rest);
  const t = c.transport;
  const realConnect = t.connect.bind(t);
  const ctl = {
    t,
    vd: () => t.device('demo-device'),
    /** 재연결 시도 허용 여부 */
    allow: true,
    btOff: false,
    /** 링크 끊김 (기기는 계속 동작) */
    drop(times = 1) {
      t.connected = false;
      for (let i = 0; i < times; i++) t.states.emit('disconnected', { deviceId: 'demo-device', unexpected: true });
    },
  };
  t.connect = async (id: string, opts?: unknown) => {
    if (ctl.btOff) throw Object.assign(new Error('블루투스가 꺼져 있어요'), { code: 'BT_OFF' });
    if (!ctl.allow) throw new Error('연결 시간이 초과됐어요');
    return realConnect(id, opts);
  };
  return { m, c, ctl };
}


after(async () => {
  // 가상 기기·ping 타이머 정리 (프로세스가 끝나도록)
  if (!mods) return;
  offEnd?.();
  await mods.deviceClient.init(false).catch(() => undefined);
});

test('제조 중 끊김 + 재연결 10번 실패 → 작업을 "결과 모름"(stopped/disconnected)으로 정리, 화면에 갇히지 않음', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  await c.make([{ p: 1, ml: 100 }], 'seq');
  await until(() => m.useDevice.getState().job?.pumps?.[0]?.done > 0);
  ctl.allow = false;
  ctl.drop();
  assert.equal(m.useDevice.getState().conn, 'reconnecting');
  assert.ok(await until(() => m.useDevice.getState().conn === 'disconnected' && !m.isBusy(m.useDevice.getState().job), 6000));
  const st = m.useDevice.getState();
  assert.equal(st.job.status, 'stopped');
  assert.equal(st.job.reason, 'disconnected');
  assert.equal(st.job.uncertain, true);
  assert.ok(st.job.dispensed.length === 1 && st.job.dispensed[0].ml > 0 && st.job.dispensed[0].ml < 100, '받은 진행량(하한값)');
  assert.equal(ends.length, 1);
  c.clearJob();
  assert.equal(m.useDevice.getState().job, null, '닫기 가능');
});

test('자동 재연결이 꺼져 있으면 끊기자마자 정리', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  m.useSettings.setState({ autoReconnect: false });
  await c.make([{ p: 1, ml: 100 }], 'seq');
  ctl.drop();
  const st = m.useDevice.getState();
  assert.equal(st.conn, 'disconnected');
  assert.equal(st.job.status, 'stopped');
  assert.equal(st.job.reason, 'disconnected');
});

test('가상 기기 status 의 last: 펌웨어와 같은 형식 (부팅 후 없음 → null, 끝난 작업 → id·kind·result·reason·dispensed)', { skip }, async () => {
  const { ctl } = await fresh();
  const vd = ctl.vd();
  const lines: string[] = [];
  const off = ctl.t.onLine((l: string) => lines.push(l));
  const status = async () => {
    lines.length = 0;
    vd.receive('{"cmd":"status"}\n');
    assert.ok(await until(() => lines.some((l) => l.includes('"ev":"status"')), 2000));
    return JSON.parse(lines.find((l) => l.includes('"ev":"status"'))!);
  };
  assert.deepEqual(await status(), { ev: 'status', state: 'idle', job: null, last: null }, '부팅 후 끝난 작업 없음');
  vd.receive('{"cmd":"make","id":"t1","steps":[{"p":2,"ml":10}]}\n'); // 0.5초
  const running = await status();
  assert.equal(running.state, 'running');
  assert.equal(running.job.id, 't1');
  assert.equal(running.last, null, '작업 중에도 last 는 "이전에 끝난" 작업');
  assert.ok(await until(() => vd.state === 'idle', 3000));
  assert.deepEqual((await status()).last, { id: 't1', kind: 'make', result: 'done', dispensed: [{ p: 2, ml: 10 }] });
  vd.receive('{"cmd":"run","p":1,"ms":5000}\n');
  await wait(400);
  vd.pressButton();
  const st = await status();
  assert.equal(st.last.id, 'run');
  assert.equal(st.last.kind, 'run');
  assert.equal(st.last.result, 'stopped');
  assert.equal(st.last.reason, 'button');
  assert.deepEqual(Object.keys(st.last), ['id', 'kind', 'result', 'reason', 'dispensed'], '필드 순서');
  assert.ok(st.last.dispensed[0].ml > 0 && st.last.dispensed[0].ml < 100);
  vd.simulateReboot();
  assert.equal((await status()).last, null, '재부팅하면 last 없음');
  off();
});

test('끊긴 동안 기기 정지 버튼 → 재연결 뒤 status.last 로 실제 결과: stopped(button) + 기기가 알려 준 양 (uncertain 아님)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  await c.make([{ p: 1, ml: 100 }], 'seq'); // 20ml/s → 5초
  await wait(800);
  ctl.allow = false;
  ctl.drop();
  await wait(200);
  ctl.vd().pressButton();
  assert.equal(ctl.vd().state, 'idle');
  const devLast = ctl.vd().lastJob;
  assert.equal(devLast.result, 'stopped');
  ctl.allow = true;
  assert.ok(await until(() => ends.length > 0, 6000));
  const job = m.useDevice.getState().job;
  assert.equal(job.status, 'stopped');
  assert.equal(job.reason, 'button', '추정(unknown)이 아니라 기기가 알려 준 사유');
  assert.equal(job.uncertain, undefined);
  assert.deepEqual(job.dispensed, devLast.dispensed, '기기의 stopped dispensed 그대로');
  assert.ok(job.dispensed[0].ml > 0 && job.dispensed[0].ml < 100);
  assert.equal(ends.length, 1);
  assert.equal(ends[0].status, 'stopped');
});

test('끊긴 동안 기기 재부팅(last 없음 + 가동시간이 작업 시작 후 경과보다 짧음) → stopped(reboot, 양 모름)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  await c.make([{ p: 1, ml: 60 }], 'seq'); // 3초
  await wait(500);
  ctl.allow = false;
  ctl.drop();
  ctl.vd().simulateReboot(); // 전원이 꺼졌다 켜짐 → 작업 중단, last 없음, 가동시간 0 부터
  // 예상 시간(3초)에서 1초 여유를 뺀 2초가 지난 뒤 재연결 → 시간만으로는 정상 완료와 구분 불가 → 가동시간으로 판단
  // (재연결 10번(가속 약 2.5초)을 다 쓰기 전에 허용)
  await wait(1700);
  ctl.allow = true;
  assert.ok(await until(() => ends.length > 0, 6000));
  const job = m.useDevice.getState().job;
  assert.equal(job.status, 'stopped');
  assert.equal(job.reason, 'reboot');
  assert.equal(job.uncertain, true, '양 모름');
});

test('재부팅 판정은 경과시간 기준: 작업이 끝난 뒤 재부팅해도 last 가 없으면 "재부팅으로 중단(양 모름)" (SPEC §2.4)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  await c.make([{ p: 1, ml: 20 }], 'seq'); // 1초
  ctl.allow = false;
  ctl.drop();
  await wait(1400);
  assert.equal(ctl.vd().state, 'idle');
  ctl.vd().simulateReboot(); // 끝난 뒤 전원을 껐다 켬 → last 사라짐
  ctl.allow = true;
  assert.ok(await until(() => ends.length > 0, 6000));
  const job = m.useDevice.getState().job;
  assert.equal(job.status, 'stopped');
  assert.equal(job.reason, 'reboot');
  assert.equal(job.uncertain, true);
});

test('끊긴 동안 정상 완료(재부팅 없음) → status.last 로 done 확정 (uncertain 아님, 기기 dispensed)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  await c.make([{ p: 1, ml: 20 }], 'seq'); // 1초
  ctl.allow = false;
  ctl.drop();
  await wait(1600);
  assert.equal(ctl.vd().state, 'idle');
  assert.equal(ctl.vd().lastJob.result, 'done');
  ctl.allow = true;
  assert.ok(await until(() => ends.length > 0, 6000));
  const job = m.useDevice.getState().job;
  assert.equal(job.status, 'done');
  assert.equal(job.uncertain, undefined);
  assert.deepEqual(job.dispensed, [{ p: 1, ml: 20 }]);
  assert.equal(job.pct, 100);
});

test('예전 펌웨어(status 에 last 없음): 정상 완료 → done + uncertain(계획량) / 예상 시간 전 정지 → stopped(unknown)', { skip }, async () => {
  {
    const { m, c, ctl } = await fresh();
    ctl.vd().reportLast = false;
    await c.make([{ p: 1, ml: 20 }], 'seq'); // 1초
    ctl.allow = false;
    ctl.drop();
    await wait(1600);
    ctl.allow = true;
    assert.ok(await until(() => ends.length > 0, 6000));
    const job = m.useDevice.getState().job;
    assert.equal(job.status, 'done');
    assert.equal(job.uncertain, true, '결과 확인 필요');
    assert.deepEqual(job.dispensed, [{ p: 1, ml: 20 }]);
  }
  {
    const { m, c, ctl } = await fresh();
    ctl.vd().reportLast = false;
    await c.make([{ p: 1, ml: 100 }], 'seq'); // 5초
    await wait(800);
    ctl.allow = false;
    ctl.drop();
    await wait(200);
    ctl.vd().pressButton();
    ctl.allow = true;
    assert.ok(await until(() => ends.length > 0, 6000));
    const job = m.useDevice.getState().job;
    assert.equal(job.status, 'stopped');
    assert.equal(job.reason, 'unknown');
    assert.equal(job.uncertain, true);
    assert.ok(job.dispensed[0].ml < 100);
  }
});

test('last 가 다른 작업(끊긴 동안 다른 명령이 끝남) + 재부팅 없음 → "결과 확인 필요"(done, uncertain)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  await c.make([{ p: 1, ml: 20 }], 'seq'); // 1초
  ctl.allow = false;
  ctl.drop();
  await wait(1300);
  const vd = ctl.vd();
  assert.equal(vd.state, 'idle');
  vd.receive('{"cmd":"run","p":2,"ms":100}\n'); // 다른 앱·시리얼에서 보낸 명령이라고 가정
  assert.ok(await until(() => vd.lastJob?.id === 'run', 2000));
  ctl.allow = true;
  assert.ok(await until(() => ends.length > 0, 6000));
  const job = m.useDevice.getState().job;
  assert.equal(job.status, 'done');
  assert.equal(job.uncertain, true);
});

test('이미 "결과 모름"으로 정리한 작업에 나중에 last 가 오면 같은 id 로 다시 끝남 (실제 결과로 바로잡음)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  await c.make([{ p: 1, ml: 20 }], 'seq'); // 1초
  await until(() => m.useDevice.getState().job?.pumps?.[0]?.done > 0);
  ctl.allow = false;
  ctl.drop();
  // 제조 화면 "제조 화면 닫기"(closeWhileLost) = abandonJob() + close() → clearJob(): 결과 모름(stopped/disconnected, 받은 진행량)
  c.abandonJob();
  c.clearJob();
  assert.equal(m.useDevice.getState().job, null, '화면에서는 지워짐');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].reason, 'disconnected');
  assert.ok(ends[0].dispensed[0].ml < 20);
  await wait(1400); // 끊긴 동안 기기는 끝까지 수행
  assert.equal(ctl.vd().lastJob.result, 'done');
  ctl.allow = true;
  assert.ok(await until(() => ends.length === 2, 6000));
  assert.equal(ends[1].id, ends[0].id, '같은 작업');
  assert.equal(ends[1].localKey, ends[0].localKey, '같은 작업(앱 키)');
  assert.equal(ends[1].status, 'done');
  assert.equal(ends[1].uncertain, false);
  assert.deepEqual(ends[1].dispensed, [{ p: 1, ml: 20 }]);
  assert.equal(m.useDevice.getState().job, null, '닫은 화면은 다시 열지 않음 (기록·잔량만 바로잡음)');
  // brew.ts 는 같은 작업이 다시 끝나면 잔량을 '차이만' 뺌 (dispensedDelta 재사용)
  const { dispensedDelta } = await import('../src/lib/protocol');
  assert.deepEqual(dispensedDelta(ends[1].dispensed, ends[0].dispensed), [{ p: 1, ml: Math.round((20 - ends[0].dispensed[0].ml) * 10) / 10 }]);
  // 다시 연결·status 를 받아도 이미 확정된 결과는 또 끝내지 않음
  await c.send({ cmd: 'status' });
  await wait(300);
  assert.equal(ends.length, 2);
});

test('make 가 기기에 닿은 뒤 ack 전에 끊김 → 끊긴 동안 끝남 → 재연결 뒤 last 로 done (시작 못 함으로 단정하지 않음)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  ctl.allow = false;
  const p = c.make([{ p: 1, ml: 20 }], 'seq'); // 1초
  ctl.drop(); // 명령은 이미 가상 기기에 도달 (ack 는 25ms 뒤라 못 받음)
  await assert.rejects(p, (e: any) => e.code === 'UNCERTAIN');
  assert.equal(m.useDevice.getState().job.status, 'pending');
  await wait(1300);
  assert.equal(ctl.vd().lastJob?.result, 'done');
  ctl.allow = true;
  assert.ok(await until(() => ends.length > 0, 6000));
  const job = m.useDevice.getState().job;
  assert.equal(job.status, 'done');
  assert.equal(job.uncertain, undefined);
  assert.deepEqual(job.dispensed, [{ p: 1, ml: 20 }]);
});

test('make 가 기기에 닿은 뒤 ack 전에 끊김 → UNCERTAIN(실패로 단정 안 함) → 재연결 뒤 running → done', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  const p = c.make([{ p: 1, ml: 20 }], 'seq');
  ctl.drop(); // 명령은 이미 가상 기기에 도달 (ack 는 25ms 뒤)
  await assert.rejects(p, (e: any) => e.code === 'UNCERTAIN');
  let job = m.useDevice.getState().job;
  assert.equal(job.status, 'pending');
  assert.equal(job.uncertain, true);
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'running' || ends.length > 0, 4000));
  job = m.useDevice.getState().job;
  assert.equal(job.pumps.length, 1, '펌프 목록 유지');
  assert.ok(await until(() => ends.length > 0, 4000));
  assert.equal(ends[0].status, 'done');
});

test('제조 화면에서 "닫기"(재연결 중) → 결과 모름으로 정리 → 재연결 뒤 아직 작업 중이면 되살아남 → 실제 완료', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  await c.make([{ p: 1, ml: 60 }], 'seq'); // 3초
  ctl.allow = false;
  ctl.drop();
  c.abandonJob();
  assert.equal(m.useDevice.getState().job.reason, 'disconnected');
  c.clearJob(); // closeWhileLost → close() → clearJob (실제 UI 흐름)
  assert.equal(m.useDevice.getState().job, null);
  assert.equal(ends.length, 1);
  ctl.allow = true;
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'running', 4000), '되살아남');
  const job = m.useDevice.getState().job;
  assert.equal(job.pumps.length, 1, '펌프 목록 유지');
  assert.equal(job.localKey, ends[0].localKey, '같은 작업(앱 키)');
  assert.ok(await until(() => ends.length === 2, 6000));
  assert.equal(ends[1].status, 'done');
  assert.equal(ends[1].id, ends[0].id, '같은 작업');
});

test('재연결 포기 뒤 "기기 탭에서 다시 연결"(abandonJob + clearJob) → 직접 다시 연결하면 status.last 로 실제 결과 (화면은 다시 열지 않음, SPEC §2.4 ②)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  await c.make([{ p: 1, ml: 20 }], 'seq'); // 1초
  await until(() => m.useDevice.getState().job?.pumps?.[0]?.done > 0);
  ctl.allow = false;
  ctl.drop();
  assert.ok(await until(() => m.useDevice.getState().conn === 'disconnected' && !m.isBusy(m.useDevice.getState().job), 6000), '자동 재연결 포기');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].reason, 'disconnected');
  // goReconnect: abandonJob() + clearJob() → 제조 화면을 닫고 기기 탭으로
  c.abandonJob();
  c.clearJob();
  assert.equal(m.useDevice.getState().job, null);
  assert.ok(await until(() => ctl.vd().state === 'idle', 3000));
  assert.equal(ctl.vd().lastJob.result, 'done');
  ctl.allow = true;
  await c.connect('demo-device', 'SmartBartender-DEMO'); // 기기 탭에서 다시 연결
  assert.ok(await until(() => ends.length === 2, 3000), '닫은 작업도 결과를 바로잡음');
  assert.equal(ends[1].id, ends[0].id);
  assert.equal(ends[1].localKey, ends[0].localKey);
  assert.equal(ends[1].status, 'done');
  assert.equal(ends[1].uncertain, false);
  assert.deepEqual(ends[1].dispensed, [{ p: 1, ml: 20 }]);
  assert.equal(m.useDevice.getState().job, null, '화면은 다시 열지 않음');
  // 한 번 바로잡으면 끝 — 다시 status 를 받아도 또 끝내지 않음
  await c.send({ cmd: 'status' });
  await wait(300);
  assert.equal(ends.length, 2);
});

test('ack 를 못 받은 작업이 재연결 뒤 status running 으로 확인됨 → 다시 끊긴 사이 기기 재부팅 → "재부팅으로 중단(양 모름)" (SPEC §2.4 ③, 계획량 완료로 보지 않음)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  const p = c.make([{ p: 1, ml: 60 }], 'seq'); // 3초
  ctl.drop(); // 명령은 가상 기기에 도달, ack(25ms 뒤)는 끊긴 동안 버려짐 → 자동 재연결
  await assert.rejects(p, (e: any) => e.code === 'UNCERTAIN');
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'running', 4000), '재연결 뒤 status running');
  const j1 = m.useDevice.getState().job;
  assert.equal(j1.ackAt, null, 'ack 는 다시 오지 않음');
  assert.equal(typeof j1.runningSeenAt, 'number', 'status running 을 받은 시각 = 작업 시작 시각의 상한');
  await wait(300);
  ctl.allow = false;
  ctl.drop();
  ctl.vd().simulateReboot(); // 펌프 기동 전압 강하 등으로 재부팅 → 작업 중단, last 없음
  await wait(1500);
  ctl.allow = true;
  assert.ok(await until(() => ends.length > 0, 6000));
  const job = m.useDevice.getState().job;
  assert.equal(job.status, 'stopped');
  assert.equal(job.reason, 'reboot');
  assert.equal(job.uncertain, true);
  assert.ok(job.dispensed.every((d: any) => d.ml < 60), '받은 진행량(하한값) — 계획량 60ml 전부가 아님');
});

test('같은 id 로 다시 시작된 작업(펌웨어 BUTTON_REPEAT_LAST 다시 만들기) → 결과가 확정된 작업을 되살리지 않고 새 작업(새 localKey, 같은 펌프 목록)', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  await c.make([{ p: 1, ml: 20 }], 'seq'); // 1초
  assert.ok(await until(() => ends.length === 1, 4000));
  const first = m.useDevice.getState().job;
  assert.equal(first.status, 'done');
  // 연결된 채 버튼 길게 → repeatLast(): 같은 id 로 ack·progress·done (가상 기기에 같은 id 의 make 를 넣어 흉내)
  ctl.vd().receive(JSON.stringify({ cmd: 'make', id: first.id, steps: [{ p: 1, ml: 20 }] }) + '\n');
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'running', 1000));
  const second = m.useDevice.getState().job;
  assert.equal(second.id, first.id);
  assert.notEqual(second.localKey, first.localKey, '새 작업');
  assert.deepEqual(second.pumps.map((x: any) => [x.p, x.target]), [[1, 20]], '같은 레시피의 펌프 목록');
  assert.ok(await until(() => ends.length === 2, 4000));
  assert.equal(ends[1].status, 'done');
  assert.notEqual(ends[1].localKey, ends[0].localKey);
  // 끊긴 동안 같은 id 로 다시 시작 → 재연결 뒤 status running 도 새 작업으로
  ctl.allow = false;
  ctl.drop();
  ctl.vd().receive(JSON.stringify({ cmd: 'make', id: first.id, steps: [{ p: 1, ml: 60 }] }) + '\n'); // 3초
  ctl.allow = true;
  assert.ok(await until(() => m.useDevice.getState().conn === 'connected' && m.useDevice.getState().job?.status === 'running', 4000));
  const third = m.useDevice.getState().job;
  assert.notEqual(third.localKey, ends[1].localKey);
  assert.ok(await until(() => ends.length === 3, 6000));
  assert.equal(new Set(ends.map((e) => e.localKey)).size, 3, '세 작업 모두 다른 키');
});

test('블루투스 꺼짐: 끊김이 두 번 보고돼도 재연결 1번만 예약, 재시도에서 BT_OFF → 멈추고 켜지면 다시 시작', { skip }, async () => {
  const { m, c, ctl } = await fresh();
  ctl.btOff = true;
  ctl.drop(2);
  assert.equal(m.useDevice.getState().reconnectAttempt, 1, '중복 보고로 시도 횟수가 건너뛰지 않음');
  assert.ok(await until(() => m.useDevice.getState().conn === 'disconnected', 3000));
  assert.match(m.useDevice.getState().lastError, /블루투스가 꺼져/);
  await wait(800);
  assert.equal(m.useDevice.getState().conn, 'disconnected', '꺼져 있는 동안 재시도하지 않음');
  ctl.btOff = false;
  c.onAdapter(true);
  assert.ok(await until(() => m.useDevice.getState().conn === 'connected', 4000));
});

test('백그라운드에서 돌아온 직후 첫 ping 틱: 타이머가 멈췄던 것이면 끊지 않음 / 응답 없는 ping 3번이면 끊고 재연결', { skip }, async () => {
  const { m, c } = await fresh();
  // 화면 꺼짐 20초: 그동안 ping 타이머가 멈춰 lastSeenAt 이 묵음
  c.lastTickAt = Date.now() - 20000;
  m.useDevice.setState({ lastSeenAt: Date.now() - 20000 });
  c.pingTick();
  assert.equal(m.useDevice.getState().conn, 'connected');
  assert.ok(Date.now() - m.useDevice.getState().lastSeenAt < 1000, '응답 시계를 다시 시작');
  // 앱 복귀 이벤트도 같은 처리
  m.useDevice.setState({ lastSeenAt: Date.now() - 20000 });
  m.doc.emit('background');
  m.doc.emit('active');
  assert.ok(Date.now() - m.useDevice.getState().lastSeenAt < 1000);
  // 정말 응답이 없는 경우: 응답 없는 ping 3번 + 16초 → 끊고 재연결
  c.lastTickAt = Date.now();
  c.unansweredPings = 3;
  m.useDevice.setState({ lastSeenAt: Date.now() - 20000 });
  c.pingTick();
  assert.ok(await until(() => m.useDevice.getState().conn === 'reconnecting' || m.useDevice.getState().conn === 'connected', 2000));
});

test('v3.1: 기기를 다시 시작해도(데모 ↔ 실제) 방금 끝난 작업은 남김 — 완료 화면·피드백이 사라지지 않게, 진행 중인 작업은 남기지 않음', { skip }, async () => {
  const { m, c } = await fresh();
  await c.make([{ p: 1, ml: 10 }], 'seq');
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'done', 6000), '작업 끝남');
  const done = m.useDevice.getState().job;
  await c.init(false).catch(() => undefined);
  assert.equal(m.useDevice.getState().job?.id, done.id, '끝난 작업은 그대로');
  assert.equal(m.useDevice.getState().job?.status, 'done');
  c.clearJob();
  assert.equal(m.useDevice.getState().job, null);
  // 진행 중 작업은 다시 시작하면 지움(예전과 같음 — 연결이 바뀌면 그 작업을 이어 볼 수 없으므로)
  m.useDevice.setState({ job: { ...done, status: 'running' } });
  await c.init(true, { autoConnect: false });
  assert.equal(m.useDevice.getState().job, null);
});
