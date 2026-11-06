/// <reference types="node" />
/**
 * 백그라운드 완료 알림 (RC-1) — APK 는 앱이 백그라운드면 WebView 의 JS 가 거의 멈춰 완료 알림이 앱을 다시 열 때에야 뜸.
 * 그래서 제조가 시작되면 끝 시각에 OS 가 띄우는 예비 알림을 예약하고, 실제 결과가 오면 같은 id 의 결과 알림으로 바꿈.
 *  - notify.ts: scheduleReminder · notify({ replaces }) · cancelReminder (예약이 늦게 끝나도 순서가 꼬이지 않음)
 *  - capacitor/backends.ts: 예약은 schedule.at + allowWhileIdle, 교체는 같은 id 로 다시 schedule, 취소는 cancel + 알림 목록에서 지움
 *  - brew.ts: 실제 client.ts + 데모 가상 기기로 제조 시작 → 예약 1번 → 완료·비상 정지 때 같은 id 로 교체
 * 실제 네이티브·블루투스·Gemini 호출 없음 (대역만)
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

/** 기록용 알림 구현 — show/scheduleAt/cancel 호출을 순서대로 남김 */
function recorder(opts: { scheduleDelayMs?: number; scheduleNever?: boolean } = {}) {
  let next = 100;
  const log: { op: 'show' | 'schedule' | 'cancel'; id: number; kind?: string; title?: string; atMs?: number }[] = [];
  return {
    log,
    backend: {
      permission: async () => 'granted' as const,
      requestPermission: async () => true,
      show: async (kind: any, title: string, _body: string, id?: number) => {
        log.push({ op: 'show', id: id ?? ++next, kind, title });
        return true;
      },
      scheduleAt: (kind: any, title: string, _body: string, atMs: number) => {
        if (opts.scheduleNever) return new Promise<number | null>(() => undefined);
        const run = () => {
          const id = ++next;
          log.push({ op: 'schedule', id, kind, title, atMs });
          return id;
        };
        return opts.scheduleDelayMs ? wait(opts.scheduleDelayMs).then(run) : Promise.resolve(run());
      },
      cancel: async (id: number) => {
        log.push({ op: 'cancel', id });
      },
    },
  };
}

// ───────────────────────── notify.ts ─────────────────────────

test('notify: 예비 알림 예약 → 결과 알림이 같은 id 로 바꿈 (예약은 태그당 1번)', async () => {
  const n = await import('../src/platform/notify');
  const r = recorder();
  n.registerNotifyBackend(r.backend);
  n.scheduleReminder('job-a', 'done', '끝났을 거예요', '확인해 주세요', Date.now() + 60_000);
  n.scheduleReminder('job-a', 'done', '두 번째', '무시돼야 함', Date.now() + 60_000);
  await wait(5);
  assert.equal(r.log.filter((x) => x.op === 'schedule').length, 1, '같은 태그는 1번만 예약');
  const reminderId = r.log[0].id;
  await n.notify('done', '완성됐어요!', '맛있게 즐기세요', { replaces: 'job-a' });
  assert.deepEqual(r.log[1], { op: 'show', id: reminderId, kind: 'done', title: '완성됐어요!' }, '같은 id 로 띄워 예비 알림을 바꿈');
  assert.deepEqual(n.pendingReminderTags(), []);
  // 교체 뒤 cancelReminder 는 아무것도 하지 않음
  await n.cancelReminder('job-a');
  assert.equal(r.log.length, 2);
  n.registerNotifyBackend(null);
});

test('notify: cancelReminder — 예약이 아직 끝나지 않았어도 끝난 뒤 그 id 를 취소 (주인 없는 알림이 남지 않음)', async () => {
  const n = await import('../src/platform/notify');
  const r = recorder({ scheduleDelayMs: 40 });
  n.registerNotifyBackend(r.backend);
  n.scheduleReminder('job-b', 'done', 't', 'b', Date.now() + 60_000);
  await n.cancelReminder('job-b'); // 예약 진행 중에 취소
  assert.deepEqual(
    r.log.map((x) => x.op),
    ['schedule', 'cancel'],
  );
  assert.equal(r.log[1].id, r.log[0].id);
  n.registerNotifyBackend(null);
});

test('notify: 예약이 응답하지 않아도 결과 알림은 제때 뜸 (새 id), 시스템 알림을 못 띄우면 예비 알림 취소 + 토스트', { timeout: 8000 }, async () => {
  const n = await import('../src/platform/notify');
  const { useToast } = await import('../src/store/toast');
  const saved = { ...n.notifyTimeouts };
  n.notifyTimeouts.showMs = 50;
  try {
    const r = recorder({ scheduleNever: true });
    n.registerNotifyBackend(r.backend);
    n.scheduleReminder('job-c', 'done', 't', 'b', Date.now() + 60_000);
    const t0 = Date.now();
    await n.notify('done', '완성', '본문', { replaces: 'job-c' });
    assert.ok(Date.now() - t0 < 1000, '예약 답을 오래 기다리지 않음');
    assert.equal(r.log.length, 1);
    assert.equal(r.log[0].op, 'show');
    // 알림 권한이 사라져 띄우지 못함 → 예비 알림 취소 + 토스트
    const r2 = recorder();
    n.registerNotifyBackend({ ...r2.backend, show: async () => false });
    n.scheduleReminder('job-d', 'done', 't', 'b', Date.now() + 60_000);
    await wait(5);
    useToast.getState().hide();
    await n.notify('stopped', '제조를 멈췄어요', '앱에서 멈췄어요.', { replaces: 'job-d' });
    await wait(5);
    assert.deepEqual(
      r2.log.map((x) => x.op),
      ['schedule', 'cancel'],
    );
    assert.equal(useToast.getState().message, '제조를 멈췄어요 — 앱에서 멈췄어요.');
  } finally {
    Object.assign(n.notifyTimeouts, saved);
    n.registerNotifyBackend(null);
  }
});

test('notify: 예약 기능이 없는 구현(웹·EXE)에서는 예약하지 않고 결과 알림만', async () => {
  const n = await import('../src/platform/notify');
  const shown: (number | undefined)[] = [];
  n.registerNotifyBackend({
    permission: async () => 'granted',
    requestPermission: async () => true,
    show: async (_k, _t, _b, id) => {
      shown.push(id);
      return true;
    },
  });
  n.scheduleReminder('job-e', 'done', 't', 'b', Date.now() + 60_000);
  assert.deepEqual(n.pendingReminderTags(), []);
  await n.notify('done', '완성', '본문', { replaces: 'job-e' });
  assert.deepEqual(shown, [undefined]);
  n.registerNotifyBackend(null);
});

// ───────────────────────── capacitor/backends.ts ─────────────────────────

test('APK 알림 구현: 예약은 schedule.at + allowWhileIdle, 교체는 같은 id, 취소는 cancel + 알림 목록에서 지움', { timeout: 3000 }, async () => {
  const { capacitorNotifyBackend, setCapacitorModulesForTest } = await import('../src/platform/capacitor/backends');
  const calls: { m: string; a: any }[] = [];
  // Capacitor 플러그인처럼 thenable Proxy (없는 메서드는 끝나지 않음)
  const impl: Record<string, (a: any) => any> = {
    checkPermissions: () => ({ display: 'granted' }),
    schedule: (a) => ({ notifications: a.notifications.map((x: any) => ({ id: String(x.id) })) }),
    cancel: () => undefined,
    removeDeliveredNotificationsById: () => undefined,
  };
  const LN = new Proxy(
    {},
    {
      get(_t, prop) {
        return (a: any) => {
          calls.push({ m: String(prop), a });
          const f = impl[String(prop)];
          return f ? Promise.resolve().then(() => f(a)) : new Promise(() => undefined);
        };
      },
    },
  );
  setCapacitorModulesForTest({ localNotifications: async () => ({ LocalNotifications: LN }) });
  const at = Date.now() + 30_000;
  const id = await capacitorNotifyBackend.scheduleAt!('done', '끝났을 거예요', '확인해 주세요', at);
  assert.equal(typeof id, 'number');
  const sch = calls.find((c) => c.m === 'schedule')!.a.notifications[0];
  assert.equal(sch.id, id);
  assert.equal(sch.channelId, 'brew');
  assert.equal(sch.schedule.at.getTime(), at);
  assert.equal(sch.schedule.allowWhileIdle, true);
  assert.equal(sch.isExactNotification, false, '정확한 알람을 요구하면 플러그인이 "알람 및 리마인더" 설정 화면을 엶');
  calls.length = 0;
  assert.equal(await capacitorNotifyBackend.show('done', '완성됐어요!', '본문', id!), true);
  const shown = calls.find((c) => c.m === 'schedule')!.a.notifications[0];
  assert.equal(shown.id, id, '같은 id 로 다시 띄움 → 플러그인이 예약을 취소하고 바꿈');
  assert.equal(shown.schedule, undefined, '결과 알림은 바로 뜸');
  assert.equal(shown.isExactNotification, false);
  calls.length = 0;
  await capacitorNotifyBackend.cancel!(id!);
  assert.deepEqual(
    calls.map((c) => c.m),
    ['cancel', 'removeDeliveredNotificationsById'],
  );
  assert.deepEqual(calls[0].a, { notifications: [{ id }] });
  assert.deepEqual(calls[1].a, { ids: [id] });
  // 권한이 없으면 예약하지 않음
  impl.checkPermissions = () => ({ display: 'denied' });
  calls.length = 0;
  assert.equal(await capacitorNotifyBackend.scheduleAt!('done', 't', 'b', at), null);
  assert.ok(!calls.some((c) => c.m === 'schedule'));
});

// ───────────────────────── brew.ts + 데모 기기 ─────────────────────────

type Mods = Record<string, any>;
let M: Mods | null = null;
async function load(): Promise<Mods> {
  if (M) return M;
  const { deviceClient } = await import('../src/lib/device/client');
  const { useDevice, isBusy } = await import('../src/store/device');
  const { useSettings } = await import('../src/store/settings');
  const { useSlots } = await import('../src/store/slots');
  const { useSession } = await import('../src/store/draft');
  const { useHistory } = await import('../src/store/history');
  const notify = await import('../src/platform/notify');
  const brew = await import('../src/lib/brew');
  const off = brew.registerJobEffects();
  installDialogStub();
  const pushes = installRouterStub();
  M = { deviceClient, useDevice, isBusy, useSettings, useSlots, useSession, useHistory, notify, brew, off, pushes };
  return M;
}

after(async () => {
  if (!M) return;
  M.off?.();
  M.notify.registerNotifyBackend(null);
  await M.deviceClient.init(false, { autoConnect: false }).catch(() => undefined);
});

async function ready(m: Mods, ml: number) {
  const c = m.deviceClient;
  await c.init(false, { autoConnect: false }).catch(() => undefined);
  await c.init(true, { autoConnect: false });
  await c.connect('demo-device', 'SmartBartender-DEMO');
  assert.ok(await until(() => !!m.useDevice.getState().info), '데모 기기 연결');
  m.useSettings.setState({ notifyAsked: true, dispenseMode: 'seq', adultVerifiedAt: null });
  m.useHistory.setState({ entries: [] });
  m.useSlots.setState({
    slots: [1, 2, 3, 4].map((p) => ({ pump: p, name: `음료${p}`, category: 'soda', abv: 0, capacityMl: 1000, remainingMl: 500, color: '#fff', notes: '', updatedAt: 0 })),
  });
  m.useSession.setState({
    current: {
      recipe: {
        name: '예비 알림 음료',
        description: '',
        reason: '',
        ingredients: [{ pump: 1, name: '음료1', ml }],
        totalMl: ml,
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
      input: { moods: [], taste: { sweet: 0, sour: 0, bitter: 0, fizzy: 0 }, strength: 'none', weather: null, situation: '', preference: '', cupMl: ml },
      variation: 0,
    },
  });
}

test('brew: 제조가 시작되면 끝 시각(ack + 예상 시간 + 여유)에 예비 알림 1번 예약 → 완료되면 같은 id 의 완료 알림으로 바꿈', { timeout: 20000 }, async () => {
  const m = await load();
  const r = recorder();
  m.notify.registerNotifyBackend(r.backend);
  await ready(m, 5);
  assert.equal(await m.brew.startBrew(), true);
  assert.ok(await until(() => r.log.some((x) => x.op === 'schedule')), '예비 알림 예약');
  const job = m.useDevice.getState().job;
  const sch = r.log.find((x) => x.op === 'schedule')!;
  assert.equal(sch.title, '제조가 끝났을 거예요');
  assert.equal(sch.atMs, m.brew.reminderAt(job));
  assert.ok(sch.atMs! >= job.ackAt + job.totalMs + m.brew.REMINDER_SLACK_MIN_MS, '예상 시간보다 늦게');
  assert.ok(await until(() => m.useDevice.getState().job?.status === 'done', 15000), '제조 완료');
  assert.ok(await until(() => r.log.some((x) => x.op === 'show')));
  await wait(20);
  assert.equal(r.log.filter((x) => x.op === 'schedule').length, 1, '진행 중 상태가 여러 번 바뀌어도 예약은 1번');
  const shown = r.log.find((x) => x.op === 'show')!;
  assert.equal(shown.id, sch.id, '같은 id → 예비 알림이 완료 알림으로 바뀜');
  assert.equal(shown.title, '완성됐어요! 맛있게 즐기세요');
  assert.ok(!r.log.some((x) => x.op === 'cancel'));
  m.deviceClient.clearJob();
});

test('brew: 비상 정지하면 예비 알림 자리에 "멈췄어요" 알림 (예비 알림이 나중에 혼자 뜨지 않음)', { timeout: 20000 }, async () => {
  const m = await load();
  const r = recorder();
  m.notify.registerNotifyBackend(r.backend);
  await ready(m, 40);
  assert.equal(await m.brew.startBrew(), true);
  assert.ok(await until(() => r.log.some((x) => x.op === 'schedule')), '예비 알림 예약');
  await m.deviceClient.stop();
  assert.ok(await until(() => !m.isBusy(m.useDevice.getState().job), 6000), '멈춤');
  assert.ok(await until(() => r.log.some((x) => x.op === 'show')));
  const sch = r.log.find((x) => x.op === 'schedule')!;
  const shown = r.log.find((x) => x.op === 'show')!;
  assert.equal(shown.id, sch.id);
  assert.equal(shown.kind, 'stopped');
  m.deviceClient.clearJob();
});
