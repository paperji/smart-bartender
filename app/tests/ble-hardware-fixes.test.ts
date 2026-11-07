/// <reference types="node" />
/**
 * 실제 ESP32 와 처음 연결해 본 뒤(2026-11-07) 고친 것들의 테스트
 *  1) 결과(done/stopped) 줄을 놓쳐도 제조 화면이 99% 에 갇히지 않음: 끝날 시각이 지나면 status 로 직접 확인 (client.ts jobOverdue)
 *  2) 예전 펌웨어(v2.1.0)가 반쪽 줄 뒤에 다음 줄을 붙여 보내도 붙어 온 이벤트를 살림 (protocol.ts parseEvent)
 *  3) Windows 앱(EXE): 기기를 못 찾아도 "검색 중지"·선택 창 "취소"가 바로 끝남, 못 찾음·PC 블루투스 꺼짐은 안내 (web-ble.ts)
 *  4) Windows 앱(EXE) 메인: 기기를 찾기 전에 취소한 요청은 나중에 기기를 찾아도 선택 창 없이 끝냄 (electron/main.cjs)
 * 1)은 실제 client.ts 를 데모 가상 기기와 함께 실행 — 1초 이상 타이머(ping 5초 등)는 50배 빠르게.
 * 끝날 시각 판단(OVERDUE_GRACE_MS 3초)은 실제 시계(Date.now) 기준이라 그대로 기다림.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { installFakeDocument } from './stubs/document';

installFakeDocument();

const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
(globalThis as any).setTimeout = ((fn: any, ms?: number, ...a: any[]) =>
  realSetTimeout(fn, ms && ms >= 1000 ? Math.max(1, ms / 50) : ms, ...a)) as typeof setTimeout;
(globalThis as any).setInterval = ((fn: any, ms?: number, ...a: any[]) =>
  realSetInterval(fn, ms && ms >= 1000 ? Math.max(1, ms / 50) : ms, ...a)) as typeof setInterval;
const wait = (ms: number) => new Promise((r) => realSetTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000, step = 10) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await wait(step);
  }
  return cond();
}

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ───────────────────────── 1) jobOverdue ─────────────────────────

test('jobOverdue: 끝날 시각(ack + totalMs) + 3초가 지난 running 작업, ack 없이 되살린 작업, ack 를 못 받은 작업만', async () => {
  const { jobOverdue, OVERDUE_GRACE_MS } = await import('../src/lib/device/client');
  const base = { id: 'r1', kind: 'make', pct: 50, pumps: [] } as any;
  const t0 = 1_000_000;
  const running = { ...base, status: 'running', ackAt: t0, totalMs: 10_000 };
  assert.equal(OVERDUE_GRACE_MS, 3000);
  assert.equal(jobOverdue(running, t0 + 10_000 + 2_999), false, '끝날 시각 + 3초 전에는 묻지 않음');
  assert.equal(jobOverdue(running, t0 + 10_000 + 3_001), true, '지나면 status 로 확인');
  assert.equal(jobOverdue({ ...running, totalMs: -5 }, t0 + 3_001), true, 'totalMs 이상값은 0 으로');
  const seen = { ...base, status: 'running', ackAt: null, totalMs: 0, runningSeenAt: t0 };
  assert.equal(jobOverdue(seen, t0 + 2_000), false);
  assert.equal(jobOverdue(seen, t0 + 3_001), true, 'ack 없이 status running 으로 되살린 작업은 확인 뒤 3초부터 계속');
  assert.equal(jobOverdue({ ...seen, runningSeenAt: undefined }, t0 + 99_999), false);
  assert.equal(jobOverdue({ ...base, status: 'pending', uncertain: true, ackAt: null, totalMs: 0 }, t0), true, 'ack 를 못 받은 작업');
  assert.equal(jobOverdue({ ...base, status: 'pending', ackAt: null, totalMs: 0 }, t0 + 99_999), false, '아직 ack 기다리는 중(6초) 은 startJob 이 처리');
  for (const s of ['done', 'stopped', 'error'])
    assert.equal(jobOverdue({ ...running, status: s }, t0 + 999_999), false, `${s} 는 끝난 작업`);
  assert.equal(jobOverdue(null, t0), false);
});

// ───────────────────────── 2) parseEvent 줄 맞춤 ─────────────────────────

test('parseEvent: 반쪽 줄 뒤에 붙어 온 온전한 이벤트(done)를 살림, 정상 줄·쓰레기 줄은 그대로', async () => {
  const { parseEvent } = await import('../src/lib/protocol');
  const done = '{"ev":"done","id":"r1","kind":"make","ms":4075,"dispensed":[{"p":1,"ml":45},{"p":3,"ml":30.5}]}';
  const half = '{"ev":"status","state":"running","job":{"id":"r1","kind":"make","pct":41},"last":{"id":"r0","kind":"ma';
  const glued = parseEvent(half + done) as any;
  assert.equal(glued?.ev, 'done', '붙어 온 done 을 살림');
  assert.deepEqual(glued.dispensed, [{ p: 1, ml: 45 }, { p: 3, ml: 30.5 }]);
  // 반쪽 줄 2개 + 온전한 줄 → 마지막 것
  assert.equal((parseEvent(half + half + '{"ev":"pong","up":12345}') as any)?.ev, 'pong');
  // 정상 줄은 통째로 먼저 읽음: 뒤쪽에 '{"ev":' 가 들어 있어도(중첩 객체) 줄 맞춤으로 잘라 읽지 않음
  const nested = '{"ev":"error","code":"X","msg":"m","x":{"ev":"done","id":"r1","kind":"make","ms":1,"dispensed":[]}}';
  assert.equal((parseEvent(nested) as any)?.ev, 'error', '통째로 읽히는 줄은 그대로');
  // 문자열 안의 이스케이프된 따옴표는 '{"ev":' 와 다름 → 그대로 통째로
  const escaped = '{"ev":"error","code":"UNKNOWN_CMD","msg":"알 수 없는 명령입니다: {\\"ev\\":"}';
  assert.equal((parseEvent(escaped) as any)?.code, 'UNKNOWN_CMD');
  // 반쪽 줄만 / 뒤에 붙은 것도 반쪽 / 모르는 이벤트 → null
  assert.equal(parseEvent(half), null);
  assert.equal(parseEvent(half + '{"ev":"done","id":"r1"'), null);
  assert.equal(parseEvent(half + '{"ev":"nope","x":1}'), null);
  assert.equal(parseEvent('garbage{"ev":"done"}'), null, "'{' 로 시작하지 않는 줄은 그대로 버림");
  assert.equal((parseEvent('  ' + done + '  ') as any)?.ev, 'done');
});

// ───────────────────────── 1) 결과 줄을 놓친 제조 ─────────────────────────

type Mods = { deviceClient: any; useDevice: any; useSettings: any; isBusy: (j: any) => boolean };
let mods: Mods | null = null;
async function load(): Promise<Mods> {
  if (mods) return mods;
  const { deviceClient } = await import('../src/lib/device/client');
  const { useDevice, isBusy } = await import('../src/store/device');
  const { useSettings } = await import('../src/store/settings');
  mods = { deviceClient, useDevice, useSettings, isBusy };
  return mods;
}
const ends: any[] = [];
let offEnd: (() => void) | null = null;

/** 새 데모 연결 + 기기→앱 줄을 골라 버리는 장치 + 앱→기기 명령 기록 */
async function fresh() {
  const m = await load();
  const c = m.deviceClient;
  await c.init(false).catch(() => undefined);
  await c.init(true, { autoConnect: false });
  m.useSettings.setState({ autoReconnect: true });
  ends.length = 0;
  offEnd?.();
  offEnd = c.onJobEnd((j: any) => ends.push({ id: j.id, status: j.status, reason: j.reason, uncertain: !!j.uncertain, dispensed: j.dispensed }));
  let sawStatus = false;
  const offLine = c.transport.onLine((l: string) => {
    if (l.includes('"ev":"status"')) sawStatus = true;
  });
  await c.connect('demo-device', 'SmartBartender-DEMO');
  assert.ok(await until(() => !!m.useDevice.getState().info && sawStatus), '연결 직후 info·status 응답');
  offLine();
  await wait(300); // 가상 기기 부팅 시각과 작업 시작 시각을 떨어뜨림 (재부팅 오판 방지)
  const t = c.transport;
  const ctl = {
    /** 이 조건에 맞는 기기→앱 줄은 버림 (블루투스 혼잡으로 펌웨어가 줄을 포기한 상황) */
    dropIf: (_line: string) => false,
    dropped: [] as string[],
    sent: [] as string[],
  };
  const realDeliver = (t as any).deliver.bind(t);
  (t as any).deliver = (id: string, line: string) => {
    if (ctl.dropIf(line)) {
      ctl.dropped.push(line);
      return;
    }
    realDeliver(id, line);
  };
  const realWrite = t.write.bind(t);
  t.write = (line: string) => {
    ctl.sent.push(line);
    return realWrite(line);
  };
  return { m, c, ctl };
}

after(async () => {
  if (!mods) return;
  offEnd?.();
  await mods.deviceClient.init(false).catch(() => undefined);
});

test('done 줄을 놓침(연결은 그대로) → 끝날 시각 + 3초 뒤 status 로 확인해 실제 결과로 완료 (99% 에 갇히지 않음)', async () => {
  const { m, c, ctl } = await fresh();
  ctl.dropIf = (l) => l.includes('"ev":"done"');
  await c.make([{ p: 1, ml: 10 }, { p: 2, ml: 6 }], 'seq'); // 20ml/s → 0.5 + 0.3 + 0.3 = 1.1초
  const job0 = m.useDevice.getState().job;
  assert.equal(job0.status, 'running');
  const statusBefore = ctl.sent.filter((s) => s.includes('"cmd":"status"')).length;
  assert.ok(await until(() => ctl.dropped.length === 1, 4000), '기기는 done 을 보냈지만 앱에 닿지 않음');
  await wait(500);
  assert.equal(m.useDevice.getState().job.status, 'running', '끝날 시각 직후에는 아직 기다림');
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'done', 8000), 'status.last 로 완료 확정');
  const job = m.useDevice.getState().job;
  assert.equal(job.uncertain, undefined, '추정이 아니라 기기가 알려 준 실제 결과');
  assert.deepEqual(job.dispensed, [{ p: 1, ml: 10 }, { p: 2, ml: 6 }]);
  assert.equal(ends.length, 1, '기록·잔량 차감 1번');
  assert.equal(ends[0].status, 'done');
  assert.ok(ctl.sent.filter((s) => s.includes('"cmd":"status"')).length > statusBefore, 'status 로 직접 물어봄');
  const elapsed = (job.finishedAt ?? 0) - (job0.ackAt ?? 0);
  assert.ok(elapsed >= 1100 + 2800, `끝날 시각(마지막 기기 줄) + 3초 뒤에야 확인 (${elapsed}ms)`);
});

test('비상 정지 뒤 stopped 줄을 놓침 → 끝날 시각까지 기다리지 않고 1.5초 뒤 status.last 의 실제 중단 결과로 정리', async () => {
  const { m, c, ctl } = await fresh();
  ctl.dropIf = (l) => l.includes('"ev":"stopped"');
  await c.make([{ p: 1, ml: 200 }], 'seq'); // 10초짜리 (가상 기기 펌프 시간은 실제 ms)
  await until(() => m.useDevice.getState().job?.pumps?.[0]?.done > 0);
  await wait(400);
  const stopAt = Date.now();
  await c.stop();
  assert.ok(m.useDevice.getState().job.stopSentAt >= stopAt, '정지 명령을 보낸 시각을 남김');
  assert.ok(await until(() => ctl.dropped.length === 1, 3000), 'stopped 를 놓침');
  assert.equal(m.useDevice.getState().job.status, 'running');
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'stopped', 4000), 'status.last 로 중단 확정');
  const took = Date.now() - stopAt;
  assert.ok(took < 3500, `끝날 시각(10초)까지 기다리지 않음 (${took}ms)`);
  const job = m.useDevice.getState().job;
  assert.equal(job.reason, 'user');
  assert.equal(job.uncertain, undefined);
  assert.ok(job.dispensed.length === 1 && job.dispensed[0].ml > 0 && job.dispensed[0].ml < 200, JSON.stringify(job.dispensed));
  assert.equal(ends.length, 1);
});

test('기기의 물리 버튼으로 멈췄는데 stopped 를 놓침 → 기기 줄이 3초 끊기면 status 로 확인 (끝날 시각 전)', async () => {
  const { m, c, ctl } = await fresh();
  ctl.dropIf = (l) => l.includes('"ev":"stopped"');
  await c.make([{ p: 2, ml: 200 }], 'seq'); // 10초짜리
  await until(() => m.useDevice.getState().job?.pumps?.[0]?.done > 0);
  await wait(300);
  const pressAt = Date.now();
  c.pressDemoButton(); // 가상 기기의 물리 버튼 → 기기가 스스로 멈춤 (앱은 stop 을 보내지 않음)
  assert.ok(await until(() => ctl.dropped.length === 1, 3000), 'stopped 를 놓침');
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'stopped', 6000), '조용해진 뒤 status 로 확정');
  const took = Date.now() - pressAt;
  assert.ok(took >= 2900 && took < 6000, `기기 줄이 3초 끊긴 뒤 (${took}ms, 끝날 시각은 약 9.7초 뒤)`);
  assert.equal(m.useDevice.getState().job.reason, 'button');
  assert.equal(ends.length, 1);
});

test('ack 와 done 을 모두 놓친 제조 → 확인 중(status running 으로 되살림) → status.last 로 완료, 기록 1번', async () => {
  const { m, c, ctl } = await fresh();
  ctl.dropIf = (l) => l.includes('"ev":"ack"') || l.includes('"ev":"done"');
  await assert.rejects(c.make([{ p: 1, ml: 30 }], 'seq'), (e: any) => e.code === 'UNCERTAIN'); // ack 기다림(6초 → 테스트 0.12초)
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'running', 3000), 'status running 으로 되살림');
  assert.ok(m.useDevice.getState().job.ackAt == null && m.useDevice.getState().job.runningSeenAt != null);
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'done', 9000), '기기 줄이 끊긴 뒤 status.last 로 완료');
  const job = m.useDevice.getState().job;
  assert.equal(job.uncertain, undefined, 'status.last 의 실제 결과');
  assert.deepEqual(job.dispensed, [{ p: 1, ml: 30 }]);
  assert.equal(ends.length, 1);
});

test('프라이밍(run)의 ack 와 stopped 를 놓침 → 기기가 하는 것을 본 run 이면 status.last 의 실제 양으로 (계획량 20초분으로 잡지 않음)', async () => {
  const { m, c, ctl } = await fresh();
  ctl.dropIf = (l) => l.includes('"ev":"ack"') || l.includes('"ev":"stopped"');
  await assert.rejects(c.run(2, 20000, { purpose: 'prime' }), (e: any) => e.code === 'UNCERTAIN');
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'running', 3000));
  await wait(700);
  await c.stop(); // 버튼에서 손을 뗌
  assert.ok(await until(() => ['stopped', 'done'].includes(m.useDevice.getState().job?.status), 5000));
  const job = m.useDevice.getState().job;
  assert.equal(job.status, 'stopped', JSON.stringify({ s: job.status, r: job.reason, d: job.dispensed }));
  assert.equal(job.reason, 'user');
  assert.equal(job.uncertain, undefined);
  assert.ok(job.dispensed[0].ml > 0 && job.dispensed[0].ml < 100, `실제 나온 양 (${job.dispensed[0].ml}ml, 계획량 400ml 아님)`);
  assert.equal(ends.length, 1);
});

test('done 이 늦게(끝날 시각 + 3초 뒤) 오고 바로 뒤에 status 응답 → 결과 처리는 1번만', async () => {
  const { m, c, ctl } = await fresh();
  const held: string[] = [];
  ctl.dropIf = (l) => {
    if (l.includes('"ev":"done"')) {
      held.push(l);
      return true;
    }
    return false;
  };
  // 앱이 status 를 물으면 그 직전에 붙잡아 둔 done 을 먼저 전달 (실제 BLE 순서: 기기가 먼저 보낸 done → status 응답)
  const t = c.transport;
  const write = t.write;
  t.write = (line: string) => {
    if (line.includes('"cmd":"status"') && held.length) {
      const id = 'demo-device';
      const realDeliver = Object.getPrototypeOf(t).deliver.bind(t);
      for (const l of held.splice(0)) realDeliver(id, l);
    }
    return write(line);
  };
  await c.make([{ p: 4, ml: 10 }], 'seq');
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'done', 9000));
  await wait(800);
  assert.equal(ends.length, 1, 'done 1번만 처리 (뒤이은 status idle 이 또 끝내지 않음)');
  assert.equal(ends[0].uncertain, false);
});

test('평소 제조(done 을 받음)에는 status 를 따로 묻지 않음 (불필요한 블루투스 전송 없음)', async () => {
  const { m, c, ctl } = await fresh();
  await c.make([{ p: 3, ml: 8 }], 'seq');
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'done', 4000));
  await wait(3600 + 300); // 끝난 뒤 grace 이상 지나도
  assert.equal(ctl.sent.filter((s) => s.includes('"cmd":"status"')).length, 0, '끝난 작업은 묻지 않음');
  assert.ok(ctl.sent.some((s) => s.includes('"cmd":"ping"')), 'ping 은 계속');
});

// ───────────────────────── 3) Web Bluetooth / EXE 검색 ─────────────────────────

/** window·navigator.bluetooth·sbElectron 대역 */
function installWeb(opts: { electron: boolean }) {
  const g = globalThis as any;
  const target = new EventTarget();
  const prevWindow = g.window;
  const log: string[] = [];
  const listListeners = new Set<(list: any[]) => void>();
  const bridge = opts.electron
    ? {
        isElectron: true,
        onBleDevices: (cb: (list: any[]) => void) => {
          listListeners.add(cb);
          return () => listListeners.delete(cb);
        },
        cancelBle: () => log.push('cancelBle'),
        bleRequestStart: () => log.push('bleRequestStart'),
      }
    : undefined;
  g.window = {
    isSecureContext: true,
    sbElectron: bridge,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
  const phases: string[] = [];
  target.addEventListener('sb-ble-scan', (e: any) => phases.push(e.detail?.phase));
  const requests: { resolve: (d: any) => void; reject: (e: any) => void }[] = [];
  const nav: any = globalThis.navigator;
  Object.defineProperty(nav, 'bluetooth', {
    configurable: true,
    value: {
      getAvailability: async () => true,
      requestDevice: () => {
        log.push('requestDevice');
        return new Promise((resolve, reject) => requests.push({ resolve, reject }));
      },
    },
  });
  return {
    log,
    phases,
    requests,
    sendList: (list: any[]) => listListeners.forEach((cb) => cb(list)),
    dispatch: (name: string) => target.dispatchEvent(new Event(name)),
    restore() {
      g.window = prevWindow;
      delete nav.bluetooth;
    },
  };
}
const notFound = () => Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' });

test('EXE: 기기를 못 찾는 동안 "검색 중지" → 검색이 바로 끝남 (예전: 몇 분 동안 scanning 에 갇힘)', async () => {
  const w = installWeb({ electron: true });
  try {
    const { WebBleTransport } = await import('../src/lib/transport/web-ble');
    const t = new WebBleTransport();
    const states: string[] = [];
    t.onState((s) => states.push(s));
    const found: any[] = [];
    const p = t.scan((d) => found.push(d));
    await wait(5);
    assert.deepEqual(states, ['scanning']);
    assert.deepEqual(w.phases, ['start'], '선택 창을 바로 엶 ("찾는 중"·취소 버튼)');
    assert.deepEqual(w.log, ['bleRequestStart', 'requestDevice'], 'requestDevice 직전에 앞 요청의 취소 예약을 지움');
    await t.stopScan(); // requestDevice 는 아무 응답 없음 (Electron 이 기기를 못 찾음)
    await p;
    assert.deepEqual(states, ['scanning', 'idle']);
    assert.deepEqual(w.phases, ['start', 'end'], '선택 창 닫힘');
    assert.ok(w.log.includes('cancelBle'), '메인에 취소 알림(나중에 찾아도 선택 창을 띄우지 않게)');
    assert.equal(found.length, 0);
    w.requests[0].reject(notFound()); // 늦게 끝난 요청은 무시
    await wait(5);
    assert.deepEqual(states, ['scanning', 'idle']);
  } finally {
    w.restore();
  }
});

test('EXE: 선택 창의 "취소"(기기 목록 없음) → 검색도 끝남', async () => {
  const w = installWeb({ electron: true });
  try {
    const { WebBleTransport, BLE_SCAN_CANCEL_EVENT } = await import('../src/lib/transport/web-ble');
    const t = new WebBleTransport();
    const p = t.scan(() => undefined);
    await wait(5);
    w.dispatch(BLE_SCAN_CANCEL_EVENT);
    await p; // 오류 없이 끝남 (사용자가 취소)
    assert.deepEqual(w.phases, ['start', 'end']);
  } finally {
    w.restore();
  }
});

test('EXE: 목록을 한 번도 못 받은 채 끝남(PC 블루투스 꺼짐·못 찾음) → 안내 오류, 목록을 본 뒤 닫으면 조용히', async () => {
  const w = installWeb({ electron: true });
  try {
    const { WebBleTransport, ELECTRON_NOT_FOUND_MESSAGE } = await import('../src/lib/transport/web-ble');
    const t = new WebBleTransport();
    const states: string[] = [];
    t.onState((s) => states.push(s));
    const p = t.scan(() => undefined);
    await wait(5);
    w.requests[0].reject(notFound()); // 블루투스 꺼짐 → Electron 이 바로 CANCELLED
    await assert.rejects(p, (e: any) => e.message === ELECTRON_NOT_FOUND_MESSAGE && /블루투스가 켜져 있는지/.test(e.message));
    assert.equal(states.at(-1), 'idle');
    assert.deepEqual(w.phases, ['start', 'end']);
    // 목록을 받은 뒤 사용자가 닫음(선택 창 취소 → BLE_SCAN_CANCEL_EVENT, 메인이 요청을 끝냄) → 조용히
    const { BLE_SCAN_CANCEL_EVENT, ELECTRON_SCAN_LOST_MESSAGE } = await import('../src/lib/transport/web-ble');
    const p2 = t.scan(() => undefined);
    await wait(5);
    w.sendList([{ deviceId: 'a', deviceName: 'SmartBartender-606A' }]);
    w.dispatch(BLE_SCAN_CANCEL_EVENT);
    w.requests[1].reject(notFound());
    await p2;
    // 목록을 받은 뒤 사용자가 고르기 전에 Electron 이 스스로 끝냄(검색 중 PC 블루투스 꺼짐) → 안내
    const pLost = t.scan(() => undefined);
    await wait(5);
    w.sendList([{ deviceId: 'a', deviceName: 'SmartBartender-606A' }]);
    w.requests[2].reject(notFound());
    await assert.rejects(pLost, (e: any) => e.message === ELECTRON_SCAN_LOST_MESSAGE);
    // 기기를 고름 → onFound
    const found: any[] = [];
    const p3 = t.scan((d) => found.push(d));
    await wait(5);
    w.sendList([{ deviceId: 'a', deviceName: 'SmartBartender-606A' }]);
    w.requests.at(-1)!.resolve({ id: 'dev-a', name: 'SmartBartender-606A' });
    await p3;
    assert.deepEqual(found, [{ id: 'dev-a', name: 'SmartBartender-606A', likely: true }]);
  } finally {
    w.restore();
  }
});

test('EXE: 앞 검색이 남은 채 새 검색 → 앞 검색을 먼저 끝내고 정리한 뒤 시작 (앞 검색의 "끝"이 새 선택 창을 닫지 않음)', async () => {
  const w = installWeb({ electron: true });
  try {
    const { WebBleTransport } = await import('../src/lib/transport/web-ble');
    const t = new WebBleTransport();
    const p1 = t.scan(() => undefined);
    await wait(5);
    const p2 = t.scan(() => undefined);
    await p1;
    await wait(5);
    assert.deepEqual(w.phases, ['start', 'end', 'start'], '두 번째 시작 뒤에는 끝 알림이 없어야 함');
    await t.stopScan();
    await p2;
    assert.deepEqual(w.phases, ['start', 'end', 'start', 'end']);
  } finally {
    w.restore();
  }
});

test('웹(Chrome): 선택 창을 닫으면(NotFoundError) 조용히 끝남, 안내 오류 없음 — 브라우저가 자기 창에서 안내함', async () => {
  const w = installWeb({ electron: false });
  try {
    const { WebBleTransport } = await import('../src/lib/transport/web-ble');
    const t = new WebBleTransport();
    const p = t.scan(() => undefined);
    await wait(5);
    w.requests[0].reject(notFound());
    await p;
    assert.deepEqual(w.phases, [], '웹에서는 앱 안 선택 창 이벤트 없음');
    const p2 = t.scan(() => undefined);
    await wait(5);
    await t.stopScan();
    await p2;
  } finally {
    w.restore();
  }
});

// ───────────────────────── 4) electron/main.cjs ─────────────────────────

async function loadMainBle() {
  const require = createRequire(import.meta.url);
  const mainPath = path.join(APP, 'electron', 'main.cjs');
  const noop = () => undefined;
  const wcHandlers: Record<string, (...a: any[]) => void> = {};
  const ipc: Record<string, (...a: any[]) => void> = {};
  const sent: { ch: string; payload: any }[] = [];
  let webContents: any = null;
  class FakeWindow {
    webContents = {
      setWindowOpenHandler: noop,
      on: (ev: string, fn: any) => (wcHandlers[ev] = fn),
      once: noop,
      send: (ch: string, payload: any) => sent.push({ ch, payload }),
      isDestroyed: () => false,
      getURL: () => '',
    };
    once = noop;
    on = noop;
    setMenuBarVisibility = noop;
    isDestroyed = () => false;
    loadURL = noop;
    constructor() {
      webContents = this.webContents;
    }
  }
  const fake = {
    app: {
      isPackaged: true,
      commandLine: { appendSwitch: noop },
      setPath: noop,
      setAppUserModelId: noop,
      requestSingleInstanceLock: () => true,
      on: noop,
      whenReady: () => Promise.resolve(),
      getVersion: () => '3.0.0',
      quit: noop,
      exit: noop,
    },
    BrowserWindow: FakeWindow,
    Menu: { setApplicationMenu: noop },
    Notification: class {},
    ipcMain: { on: (ch: string, fn: any) => (ipc[ch] = fn), handle: noop },
    protocol: { registerSchemesAsPrivileged: noop, handle: noop },
    session: { defaultSession: { setPermissionRequestHandler: noop, setBluetoothPairingHandler: noop } },
    shell: { openExternal: async () => undefined },
  };
  const electronId = require.resolve('electron');
  const prev = require.cache[electronId];
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: fake } as any;
  delete require.cache[mainPath];
  try {
    require(mainPath);
    await wait(20);
  } finally {
    delete require.cache[mainPath];
    if (prev) require.cache[electronId] = prev;
    else delete require.cache[electronId];
  }
  const fromApp = { sender: webContents };
  const select = (devices: any[]) => {
    const calls: string[] = [];
    let prevented = false;
    wcHandlers['select-bluetooth-device']({ preventDefault: () => (prevented = true) }, devices, (id: string) => calls.push(id));
    return { calls, prevented };
  };
  return { ipc, sent, fromApp, select };
}

test('EXE 메인: 기기를 찾기 전에 취소한 요청은 나중에 기기를 찾아도 선택 창 없이 끝냄, 새 요청은 정상', async () => {
  const { ipc, sent, fromApp, select } = await loadMainBle();
  assert.ok(ipc['sb:ble-start'] && ipc['sb:ble-cancel'] && ipc['sb:ble-choose']);
  // 1) 시작 → 기기 못 찾은 채 취소 → 나중에 기기 발견
  ipc['sb:ble-start'](fromApp);
  ipc['sb:ble-cancel'](fromApp);
  const late = select([{ deviceId: 'x', deviceName: 'SmartBartender-606A' }]);
  assert.equal(late.prevented, true);
  assert.deepEqual(late.calls, [''], '바로 취소');
  assert.equal(sent.filter((s) => s.ch === 'sb:ble-devices').length, 0, '선택 창에 목록을 보내지 않음');
  // 2) 새 요청: 목록이 화면으로 가고, 고르면 그 기기
  ipc['sb:ble-start'](fromApp);
  const first = select([{ deviceId: 'x', deviceName: 'SmartBartender-606A' }]);
  assert.deepEqual(first.calls, [], '고를 때까지 기다림');
  assert.equal(sent.filter((s) => s.ch === 'sb:ble-devices').length, 1);
  // select-bluetooth-device 의 callback 은 마지막 것을 씀 → 고르기
  const again = select([{ deviceId: 'x', deviceName: 'SmartBartender-606A' }]);
  ipc['sb:ble-choose'](fromApp, 'x');
  assert.deepEqual(again.calls, ['x']);
  assert.ok(sent.some((s) => s.ch === 'sb:ble-end'));
  // 3) 목록을 받은 뒤 취소 → 바로 끝(취소 예약 아님) → 다음 요청은 정상
  ipc['sb:ble-start'](fromApp);
  const shown = select([{ deviceId: 'y', deviceName: 'Other' }]);
  ipc['sb:ble-cancel'](fromApp);
  assert.deepEqual(shown.calls, ['']);
  ipc['sb:ble-start'](fromApp);
  const next = select([{ deviceId: 'y', deviceName: 'Other' }]);
  assert.deepEqual(next.calls, [], '다음 요청은 선택 창으로');
  // 다른 화면(sender)이 보낸 취소는 무시 — 그때 살아 있던 요청(next)이 끝나지 않아야 함
  const endsBefore = sent.filter((s) => s.ch === 'sb:ble-end').length;
  ipc['sb:ble-cancel']({ sender: {} });
  assert.deepEqual(next.calls, [], '살아 있는 요청을 끝내지 않음');
  assert.equal(sent.filter((s) => s.ch === 'sb:ble-end').length, endsBefore);
  const still = select([{ deviceId: 'y', deviceName: 'Other' }]);
  assert.deepEqual(still.calls, [], '취소 예약도 안 됨');
});

test('EXE 메인: 취소 예약 직후 새 검색(sb:ble-start)은 예약을 지움 → 새 요청의 첫 기기는 선택 창으로', async () => {
  const { ipc, sent, fromApp, select } = await loadMainBle();
  ipc['sb:ble-start'](fromApp);
  ipc['sb:ble-cancel'](fromApp); // 기기를 찾기 전에 취소 → 예약
  const before = sent.filter((s) => s.ch === 'sb:ble-devices').length;
  ipc['sb:ble-start'](fromApp); // 바로 새 검색
  const s = select([{ deviceId: 'z', deviceName: 'SmartBartender-606A' }]);
  assert.deepEqual(s.calls, [], '새 요청을 취소하지 않음');
  assert.equal(sent.filter((x) => x.ch === 'sb:ble-devices').length, before + 1, '목록이 화면으로 감');
});

test('EXE 메인: Chromium 이 스스로 끝낸 요청의 callback 이 남아 있어도 새 검색에서 지움 → 그 뒤 이른 취소가 예약됨', async () => {
  const { ipc, sent, fromApp, select } = await loadMainBle();
  ipc['sb:ble-start'](fromApp);
  const dead = select([{ deviceId: 'a', deviceName: 'SmartBartender-606A' }]); // 목록을 보여 줌 → callback 저장
  // (여기서 PC 블루투스가 꺼져 Chromium 이 요청을 끝냄 — 메인에는 알림이 없어 callback 이 그대로 남음)
  ipc['sb:ble-start'](fromApp); // 새 검색
  ipc['sb:ble-cancel'](fromApp); // 새 검색에서 기기를 찾기 전에 취소
  assert.deepEqual(dead.calls, [], '죽은 callback 을 부르지 않음(지웠음)');
  const devicesBefore = sent.filter((x) => x.ch === 'sb:ble-devices').length;
  const late = select([{ deviceId: 'a', deviceName: 'SmartBartender-606A' }]); // 나중에 기기가 보임
  assert.deepEqual(late.calls, [''], '예약대로 바로 취소 — 주인 없는 선택 창이 뜨지 않음');
  assert.equal(sent.filter((x) => x.ch === 'sb:ble-devices').length, devicesBefore);
});
