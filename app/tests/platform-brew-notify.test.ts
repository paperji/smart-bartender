/// <reference types="node" />
/**
 * 첫 제조 때 알림 권한 요청이 제조를 막지 않음 (ANDROID-3) — 실제 brew.ts + client.ts + 데모 가상 기기
 *  - 알림 구현(권한 창·네이티브)이 답하지 않아도 startBrew 는 NOTIFY_ASK_WAIT_MS 남짓 뒤 제조를 시작하고 진행 화면으로
 *  - 권한은 첫 제조 때 1번만 묻고(notifyAsked), 늦게 "거부"로 답해도 "화면에서 알려 드릴게요" 안내
 * 화면 이동·확인창은 tests/stubs 대역. 실제 Gemini·블루투스 없음
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { installFakeDocument } from './stubs/document';
import { installDialogStub } from './stubs/dialog';
import { installRouterStub } from './stubs/router';

installFakeDocument();

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
  const { useSession } = await import('../src/store/draft');
  const { useToast } = await import('../src/store/toast');
  const notify = await import('../src/platform/notify');
  const brew = await import('../src/lib/brew');
  installDialogStub();
  const pushes = installRouterStub();
  M = { deviceClient, useDevice, isBusy, useSettings, useSlots, useSession, useToast, notify, brew, pushes };
  return M;
}

after(async () => {
  if (!M) return;
  M.notify.registerNotifyBackend(null);
  await M.deviceClient.init(false, { autoConnect: false }).catch(() => undefined);
});

async function ready(m: Mods) {
  const c = m.deviceClient;
  await c.init(false, { autoConnect: false }).catch(() => undefined);
  await c.init(true, { autoConnect: false });
  await c.connect('demo-device', 'SmartBartender-DEMO');
  assert.ok(await until(() => !!m.useDevice.getState().info), '데모 기기 연결');
  m.useSlots.setState({
    slots: [1, 2, 3, 4].map((p) => ({ pump: p, name: `음료${p}`, category: 'soda', abv: 0, capacityMl: 1000, remainingMl: 500, color: '#fff', notes: '', updatedAt: 0 })),
  });
  m.useSession.setState({
    current: {
      recipe: {
        name: '테스트 음료',
        description: '',
        reason: '',
        ingredients: [{ pump: 1, name: '음료1', ml: 10 }],
        totalMl: 10,
        estimatedAbv: 0,
        flavor: { sweet: 0, sour: 0, bitter: 0, fizzy: 0, strength: 0 },
        garnish: '',
        tips: '',
        suggestions: [],
      },
      explore: [],
      mode: 'normal',
      source: 'offline',
      warnings: [],
      createdAt: Date.now(),
      input: { moods: [], taste: { sweet: 0, sour: 0, bitter: 0, fizzy: 0 }, strength: 'none', weather: null, situation: '', preference: '', cupMl: 10 },
      variation: 0,
    },
  });
}

async function stopJob(m: Mods) {
  if (m.isBusy(m.useDevice.getState().job)) await m.deviceClient.stop().catch(() => undefined);
  assert.ok(await until(() => !m.isBusy(m.useDevice.getState().job), 6000), '작업 끝남');
  m.deviceClient.clearJob();
}

test('ANDROID-3: 알림 권한 요청이 끝나지 않아도 첫 제조는 시작되고(진행 화면), 권한은 1번만 물음', { timeout: 15000 }, async () => {
  const m = await load();
  await ready(m);
  let asked = 0;
  m.notify.registerNotifyBackend({
    permission: async () => 'default',
    requestPermission: () => {
      asked++;
      return new Promise<boolean>(() => undefined); // 권한 창·네이티브가 답하지 않음
    },
    show: async () => true,
  });
  m.useSettings.setState({ notifyAsked: false, dispenseMode: 'seq', adultVerifiedAt: null });
  m.pushes.length = 0;
  const t0 = Date.now();
  const started = await m.brew.startBrew();
  const took = Date.now() - t0;
  assert.equal(started, true, '제조 시작');
  assert.ok(took < m.brew.NOTIFY_ASK_WAIT_MS + 2000, `권한 답을 기다리느라 오래 멈추지 않음 (${took}ms)`);
  assert.deepEqual(m.pushes, ['/brewing']);
  assert.equal(asked, 1);
  assert.equal(m.useSettings.getState().notifyAsked, true);
  await stopJob(m);
  // 두 번째 제조: 다시 묻지 않음
  m.pushes.length = 0;
  assert.equal(await m.brew.startBrew(), true);
  assert.equal(asked, 1, '첫 제조 때만 물음');
  await stopJob(m);
});

test('ANDROID-3: 권한 창에 늦게 "거부"로 답해도 제조는 먼저 시작되고, 답이 오면 "화면에서 알려 드릴게요" 안내', { timeout: 15000 }, async () => {
  const m = await load();
  await ready(m);
  let answer: ((v: boolean) => void) | null = null;
  m.notify.registerNotifyBackend({
    permission: async () => 'default',
    requestPermission: () => new Promise<boolean>((r) => (answer = r)),
    show: async () => true,
  });
  m.useSettings.setState({ notifyAsked: false });
  m.useToast.getState().hide();
  assert.equal(await m.brew.startBrew(), true);
  assert.notEqual(m.useToast.getState().message, '알림이 꺼져 있어요. 완료되면 화면에서 알려 드릴게요.');
  answer!(false);
  assert.ok(await until(() => m.useToast.getState().message === '알림이 꺼져 있어요. 완료되면 화면에서 알려 드릴게요.', 1000));
  await stopJob(m);
  // 곧바로 답하면(이미 허용·거부한 상태) 기다림 없이 바로 시작
  m.notify.registerNotifyBackend({ permission: async () => 'granted', requestPermission: async () => true, show: async () => true });
  m.useSettings.setState({ notifyAsked: false });
  const t0 = Date.now();
  assert.equal(await m.brew.startBrew(), true);
  assert.ok(Date.now() - t0 < m.brew.NOTIFY_ASK_WAIT_MS, '답이 빠르면 기다리지 않음');
  await stopJob(m);
});
