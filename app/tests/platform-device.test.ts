/// <reference types="node" />
/**
 * 기기 연결 플랫폼 고침 확인 (DEV-1~4, UI-8) — 실제 client.ts + 실제 CapacitorBleTransport(BleClient 만 대역)
 *  - DEV-1: 검색 없이 자동 재연결(APK)해도 기억한 기기 이름(SmartBartender-A1B2)이 'SmartBartender' 로 바뀌지 않음
 *  - DEV-2: 플러그인의 영어 연결 오류('Connection timeout.', status 133)를 한국어 안내로
 *  - DEV-3: Windows 앱(EXE) 기기 화면 안내는 브라우저용 문구가 아니라 앱 안 기기 선택 창
 *  - DEV-4: 보안 주소(https·localhost)가 아니면 "브라우저 미지원"이 아니라 HTTPS 안내
 *  - UI-8: 캘리브레이션 구동 남은 시간은 0~전체 시간으로 자름 (화면 시계가 늦어도 '29초' 가 보이지 않게)
 * 플러그인 대역은 플러그인 8.3.0 처럼 연결 시간 제한·오류 문구를 흉내 (scratchpad 리뷰 하네스를 옮김). 실제 블루투스 없음
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { installFakeDocument } from './stubs/document';

installFakeDocument();
// APK 처럼 보이게 (platform/detect isCapacitor) — 앱 모듈을 불러오기 전에
const fakeWindow: any = { Capacitor: { isNativePlatform: () => true }, isSecureContext: true };
(globalThis as any).window = fakeWindow;

const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const ID = 'AA:BB:CC:DD:A1:B2';
const REAL_NAME = 'SmartBartender-A1B2';
const enc = (s: string) => {
  const b = new TextEncoder().encode(s);
  return new DataView(b.buffer);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000, step = 10) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await wait(step);
  }
  return cond();
}

/** BleClient 대역 — mode 'ok' 면 연결되고 hello 에 info(name) 로 답함, 아니면 플러그인처럼 영어 오류로 실패 */
function makeBle() {
  const ble: any = {
    mode: 'ok' as 'ok' | 'timeout' | 'gatt133',
    notify: null as null | ((v: DataView) => void),
    initialize: async () => undefined,
    startEnabledNotifications: async () => undefined,
    stopEnabledNotifications: async () => undefined,
    isEnabled: async () => true,
    disconnect: async () => undefined,
    stopLEScan: async () => undefined,
    connect: async () => {
      if (ble.mode === 'timeout') throw new Error('Connection timeout.'); // 플러그인 Device.kt 의 문구 (15초 뒤)
      if (ble.mode === 'gatt133') throw new Error('Connection failed with status 133');
      await wait(5);
    },
    getMtu: async () => 247,
    getServices: async () => [{ uuid: NUS }],
    startNotifications: async (_i: string, _s: string, _c: string, cb: (v: DataView) => void) => {
      ble.notify = cb;
    },
    stopNotifications: async () => undefined,
    requestConnectionPriority: async () => undefined,
    write: async (_i: string, _s: string, _c: string, dv: DataView) => {
      const txt = new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
      setTimeout(() => {
        if (txt.includes('"hello"'))
          ble.notify?.(
            enc(
              `{"ev":"info","fw":"2.1.0","name":"${REAL_NAME}","pumps":4,"maxMl":500,"maxStepMl":300,"cal":[20,20,20,20],"calSet":[1,1,1,1],"maxPumpMs":120000,"state":"idle"}\n`,
            ),
          );
        if (txt.includes('"status"')) ble.notify?.(enc('{"ev":"status","state":"idle"}\n'));
        if (txt.includes('"ping"')) ble.notify?.(enc('{"ev":"pong","up":100000}\n'));
      }, 5);
    },
  };
  return ble;
}

type Mods = Record<string, any>;
let M: Mods | null = null;
async function load(): Promise<Mods> {
  if (M) return M;
  const { registerTransportFactory } = await import('../src/platform/transport/factory');
  const capBle = await import('../src/platform/transport/capacitor-ble');
  const { deviceClient } = await import('../src/lib/device/client');
  const { useDevice } = await import('../src/store/device');
  const { useSettings } = await import('../src/store/settings');
  const ble = makeBle();
  registerTransportFactory('capacitor', () => {
    const t: any = new capBle.CapacitorBleTransport();
    t.ble = async () => ble; // 플러그인 모듈 대신 대역 (BleClient 는 thenable 이 아닌 보통 객체)
    return t;
  });
  M = { deviceClient, useDevice, useSettings, ble, capBle };
  return M;
}

after(async () => {
  if (!M) return;
  await M.deviceClient.disconnect().catch(() => undefined);
  await M.deviceClient.init(true, { autoConnect: false }).catch(() => undefined);
  await M.deviceClient.init(false, { autoConnect: false }).catch(() => undefined);
});

test('DEV-1: APK 자동 재연결(검색 없음) 뒤에도 기억한 기기 이름은 SmartBartender-A1B2 그대로, 화면 이름도 기본 이름으로 바뀌지 않음', { timeout: 8000 }, async () => {
  const m = await load();
  m.useSettings.setState({ demoMode: false, autoReconnect: true, lastDevices: { native: { id: ID, name: REAL_NAME, at: 1 } } });
  const names: string[] = [];
  const off = m.useDevice.subscribe((s: any) => {
    if (s.conn === 'connected') names.push(String(s.deviceName));
  });
  await m.deviceClient.init(false);
  assert.ok(await until(() => !!m.useDevice.getState().info), '연결 뒤 info 받음');
  await wait(50);
  off();
  assert.equal(m.useDevice.getState().conn, 'connected');
  assert.ok(names.length > 0 && names.every((n) => n === REAL_NAME), `연결 중 표시 이름: ${names.join(' → ')}`);
  assert.equal(m.useSettings.getState().lastDevices.native?.name, REAL_NAME, '기억한 이름 유지');
});

test('DEV-1: 기억한 이름이 기본 이름이었어도 기기가 알려 준 실제 이름(info.name)으로 고쳐 기억', { timeout: 8000 }, async () => {
  const m = await load();
  await m.deviceClient.disconnect();
  m.useSettings.setState({ lastDevices: { native: { id: ID, name: 'SmartBartender', at: 1 } } });
  m.useDevice.setState({ deviceName: null, info: null });
  await m.deviceClient.connect(ID); // 이름 없이 연결 (자동 재연결과 같음)
  assert.ok(await until(() => m.useSettings.getState().lastDevices.native?.name === REAL_NAME), JSON.stringify(m.useSettings.getState().lastDevices));
  assert.equal(m.useDevice.getState().deviceName, REAL_NAME);
});

test('DEV-2: 플러그인 연결 시간 초과·GATT 133 은 한국어 안내로 (던진 오류 · 빨간 배너 모두)', { timeout: 8000 }, async () => {
  const m = await load();
  const { CONNECT_TIMEOUT_TEXT, CONNECT_FAILED_TEXT } = m.capBle;
  await m.deviceClient.disconnect();
  for (const [mode, text] of [
    ['timeout', CONNECT_TIMEOUT_TEXT],
    ['gatt133', CONNECT_FAILED_TEXT],
  ] as const) {
    m.ble.mode = mode;
    await assert.rejects(m.deviceClient.connect(ID, REAL_NAME), (e: Error) => e.message === text);
    assert.equal(m.useDevice.getState().lastError, text);
    assert.doesNotMatch(String(m.useDevice.getState().lastError), /Connection|timeout/);
  }
  m.ble.mode = 'ok';
  await m.deviceClient.disconnect();
});

test('DEV-2: connectErrorText — 영어 플러그인 문구만 바꾸고 앱의 한국어 문구는 그대로', async () => {
  const { connectErrorText, CONNECT_TIMEOUT_TEXT, CONNECT_FAILED_TEXT } = (await load()).capBle;
  assert.equal(connectErrorText('Connection timeout.'), CONNECT_TIMEOUT_TEXT);
  assert.equal(connectErrorText('Timed out'), CONNECT_TIMEOUT_TEXT);
  assert.equal(connectErrorText('Connection failed with status 133'), CONNECT_FAILED_TEXT);
  assert.equal(connectErrorText('Disconnected'), CONNECT_FAILED_TEXT);
  assert.equal(connectErrorText('알림 구독에 실패했어요'), '알림 구독에 실패했어요');
  assert.equal(connectErrorText(CONNECT_TIMEOUT_TEXT), CONNECT_TIMEOUT_TEXT);
  assert.equal(connectErrorText('Something else'), 'Something else');
});

test('DEV-3: Windows 앱(EXE) 연결 안내는 앱 안 기기 선택 창 — 브라우저(Chrome·Edge) 안내가 없음', async () => {
  const { connectionGuide, kindLabel, KIND_LABEL, EXE_KIND_LABEL } = await import('../src/screens/device/deviceText');
  const exe = connectionGuide('electron', false);
  assert.equal(exe.label, EXE_KIND_LABEL);
  const text = exe.notes.join('\n');
  assert.match(text, /앱 안의 기기 선택 창/);
  assert.match(text, /앱을 다시 켜면 기기를 다시 골라야 해요/);
  assert.doesNotMatch(text, /Chrome|Edge|브라우저/);
  assert.equal(connectionGuide('electron', true).notes.some((n) => n.includes('다시 골라야')), false);
  const web = connectionGuide('web', false);
  assert.equal(web.label, KIND_LABEL.web);
  assert.match(web.notes.join('\n'), /Chrome 또는 Edge/);
  assert.match(web.notes.join('\n'), /이 브라우저에서는 앱을 다시 열면/);
  const apk = connectionGuide('capacitor', false);
  assert.equal(apk.label, KIND_LABEL.native);
  assert.doesNotMatch(apk.notes.join('\n'), /브라우저/);
  assert.equal(kindLabel('web', true), EXE_KIND_LABEL);
  assert.equal(kindLabel('web', false), KIND_LABEL.web);
  assert.equal(kindLabel('demo', true), KIND_LABEL.demo);
});

test('DEV-4: http(보안 주소 아님)에서는 Chrome 이어도 navigator.bluetooth 가 없음 → HTTPS 안내, https 에서 없으면 브라우저 미지원', async () => {
  const { WebBleTransport } = await import('../src/lib/transport/web-ble');
  const nav: any = globalThis.navigator;
  assert.equal(nav?.bluetooth, undefined, 'Node 의 navigator 에는 bluetooth 없음');
  try {
    fakeWindow.isSecureContext = false;
    const insecure = await new WebBleTransport().availability();
    assert.equal(insecure.ok, false);
    assert.match(String(insecure.reason), /HTTPS 주소\(또는 localhost\)/);
    fakeWindow.isSecureContext = true;
    const unsupported = await new WebBleTransport().availability();
    assert.match(String(unsupported.reason), /Chrome 또는 Edge/);
    Object.defineProperty(nav, 'bluetooth', { value: { getAvailability: async () => true }, configurable: true });
    assert.deepEqual(await new WebBleTransport().availability(), { ok: true });
  } finally {
    fakeWindow.isSecureContext = true;
    if (nav && 'bluetooth' in nav) delete nav.bluetooth;
  }
});

test('UI-8: 캘리브레이션 구동 남은 시간·진행률은 0~전체로 자름 (화면 시계가 ack 보다 이르면 처음 상태)', async () => {
  const { runCountdown } = await import('../src/screens/device/deviceText');
  const job = { ackAt: 100_000, totalMs: 10_000 };
  // 화면에 들어온 지 19초 된 시계(ack 보다 이름) — 예전에는 29초로 보였음
  assert.deepEqual(runCountdown(job, 100_000 - 19_000), { remainingMs: 10_000, progress: 0 });
  assert.deepEqual(runCountdown(job, 104_000), { remainingMs: 6_000, progress: 0.4 });
  assert.deepEqual(runCountdown(job, 130_000), { remainingMs: 0, progress: 1 });
  assert.equal(runCountdown({ ackAt: null, totalMs: 10_000 }, 1), null);
  assert.deepEqual(runCountdown({ ackAt: 5, totalMs: 0 }, 10), { remainingMs: 0, progress: 0 });
});
