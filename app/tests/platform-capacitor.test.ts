/// <reference types="node" />
/**
 * 안드로이드 APK(Capacitor) 플랫폼 고침 확인 (ANDROID-1~5)
 *  - Capacitor 플러그인은 thenable Proxy(어떤 속성이든 함수, then 포함) → Promise 를 플러그인 자체로 끝내면 영영 끝나지 않음.
 *    대역(capacitorLikePlugin)으로 예전 방식이 멈추는 것을 재현하고, 지금 방식(plugins.ts 의 상자)은 바로 끝나는지 확인
 *  - 키 저장(Preferences)·알림(LocalNotifications)·진동(Haptics) 구현이 thenable 대역으로도 끝까지 동작 (짧은 테스트 시간 제한)
 *  - notify(): 알림 구현이 답하지 않아도 화면 토스트로 대신, 권한 확인이 늦으면 'unsupported'
 *  - 뒤로 버튼(@capacitor/app): 창 닫기 · history.back(제조 화면 보호는 popstate) · 탭 첫 화면 → 바텐더 · 바텐더 → 앱 내리기
 * 실제 네이티브 호출 없음 (대역만)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideBack, handleBackButton, installBackButton, setAppModuleForTest, type BackContext, type BackDeps } from '../src/platform/capacitor/backButton';
import {
  capacitorHapticsBackend,
  capacitorNotifyBackend,
  capacitorSecretBackend,
  installCapacitorBackends,
  setCapacitorModulesForTest,
} from '../src/platform/capacitor/backends';
import { pluginLoader, withTimeout } from '../src/platform/capacitor/plugins';
import { notify, notifyPermission, notifyTimeouts, registerNotifyBackend } from '../src/platform/notify';
import { clearGeminiKey, GEMINI_KEY_STORAGE, getGeminiKey, registerSecretBackend, setGeminiKey } from '../src/platform/secrets';
import { kv } from '../src/platform/storage';
import { useToast } from '../src/store/toast';

/** 이 테스트 하나의 최대 시간 — 예전 방식이면 여기서 시간 초과로 실패 */
const QUICK = { timeout: 3000 };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const never = <T = never>() => new Promise<T>(() => undefined);

/**
 * @capacitor/core registerPlugin 이 돌려주는 Proxy 와 같은 모양의 대역:
 * 어떤 속성이든 함수(then 포함). impl 에 없는 메서드는 네이티브에 없는 것 — Capacitor 처럼 resolve/reject 콜백을 부르지 않음
 */
function capacitorLikePlugin(impl: Record<string, (...a: any[]) => any>, calls: string[] = []): any {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '$$typeof') return undefined;
        if (prop === 'toJSON') return () => ({});
        return (...args: any[]) => {
          calls.push(String(prop));
          const f = impl[String(prop)];
          return f ? Promise.resolve().then(() => f(...args)) : never();
        };
      },
    },
  );
}

test('대역 확인: 플러그인 Proxy 는 thenable — 예전 방식(.then((m) => m.Plugin))은 끝나지 않고, 상자(pluginLoader)는 바로 끝남', QUICK, async () => {
  const calls: string[] = [];
  const plugin = capacitorLikePlugin({}, calls);
  assert.equal(typeof plugin.then, 'function', '플러그인 Proxy 에도 then 이 있음');
  // 예전 backends.ts 방식: import(...).then((m) => m.Preferences)
  const old = Promise.resolve({ Preferences: plugin }).then((m) => m.Preferences);
  const r = await Promise.race([old.then(() => 'settled'), wait(200).then(() => 'pending')]);
  assert.equal(r, 'pending', '예전 방식은 끝나지 않음 (ANDROID-1~4 의 원인)');
  assert.ok(calls.includes('then'), 'Promise 가 플러그인의 then 을 부름');
  // 지금 방식: 상자에 담아 돌려줌
  const load = pluginLoader(async () => ({ Preferences: plugin }), (m) => m.Preferences);
  const box = await withTimeout(load(), 500, '상자 방식도 멈춤');
  assert.equal(box.plugin, plugin);
  assert.equal(await load(), box, '두 번째부터는 기억한 상자');
});

test('실제 @capacitor/preferences 의 플러그인도 then 을 가짐 → pluginLoader 로는 끝남 (Node·웹 구현, 네이티브 호출 없음)', QUICK, async () => {
  const mod = await import('@capacitor/preferences');
  assert.equal(typeof (mod.Preferences as any).then, 'function', 'Capacitor 8 플러그인 Proxy 는 thenable');
  const load = pluginLoader(() => import('@capacitor/preferences'), (m) => m.Preferences);
  const { plugin } = await withTimeout(load(), 1000, 'pluginLoader 가 실제 플러그인에서 멈춤');
  assert.equal(plugin, mod.Preferences);
  const app = await import('@capacitor/app');
  assert.equal(typeof (app.App as any).then, 'function', '@capacitor/app 의 App 도 thenable — backButton.ts 도 상자로 다룸');
  // 블루투스: 플러그인(BluetoothLe)은 thenable 이지만 capacitor-ble.ts 가 돌려주는 BleClient 는 보통 객체여야 함
  const ble = await import('@capacitor-community/bluetooth-le');
  assert.equal(typeof (ble.BluetoothLe as any).then, 'function');
  assert.equal((ble.BleClient as any).then, undefined, 'BleClient 가 thenable 이 되면 capacitor-ble.ts 의 ble() 도 상자로 바꿔야 함');
});

/** Preferences 대역 (메모리) */
function fakePreferences() {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const P = capacitorLikePlugin(
    {
      get: ({ key }: { key: string }) => ({ value: store.has(key) ? store.get(key)! : null }),
      set: ({ key, value }: { key: string; value: string }) => {
        store.set(key, value);
      },
      remove: ({ key }: { key: string }) => {
        store.delete(key);
      },
    },
    calls,
  );
  return { P, store, calls };
}

test('ANDROID-1·2: 키 저장소(Preferences, thenable 대역) — 저장·읽기·삭제가 끝나고 getGeminiKey/setGeminiKey 도 멈추지 않음', QUICK, async () => {
  const { P, store } = fakePreferences();
  setCapacitorModulesForTest({ preferences: async () => ({ Preferences: P }) });
  await capacitorSecretBackend.set('k', 'v1');
  assert.equal(await capacitorSecretBackend.get('k'), 'v1');
  await capacitorSecretBackend.remove('k');
  assert.equal(await capacitorSecretBackend.get('k'), null);
  // 앱의 키 저장 흐름(설정 > 저장 → setGeminiKey, AI 추천 → getGeminiKey)
  registerSecretBackend(capacitorSecretBackend);
  try {
    assert.equal(await getGeminiKey(), null, '키가 없으면 null (AI 추천은 오프라인으로)');
    await setGeminiKey('fake-test-key-0000000000');
    assert.equal(store.get(GEMINI_KEY_STORAGE), 'fake-test-key-0000000000');
    assert.equal(await getGeminiKey(), 'fake-test-key-0000000000');
    await clearGeminiKey();
    assert.equal(await getGeminiKey(), null);
  } finally {
    registerSecretBackend(null);
  }
});

test('ANDROID-2: 예전 localStorage 키는 Preferences 로 옮기고 지움 (thenable 대역으로도 끝남)', QUICK, async () => {
  const { P, store } = fakePreferences();
  setCapacitorModulesForTest({ preferences: async () => ({ Preferences: P }) });
  kv.setItem(GEMINI_KEY_STORAGE, 'fake-old-value-000000000');
  assert.equal(await capacitorSecretBackend.get(GEMINI_KEY_STORAGE), 'fake-old-value-000000000');
  assert.equal(store.get(GEMINI_KEY_STORAGE), 'fake-old-value-000000000');
  assert.equal(kv.getItem(GEMINI_KEY_STORAGE), null, 'localStorage 에서는 지움');
});

/** LocalNotifications 대역 */
function fakeLocalNotifications(display: string, answer = 'granted') {
  const calls: string[] = [];
  const scheduled: any[] = [];
  const channels: any[] = [];
  let cur = display;
  const LN = capacitorLikePlugin(
    {
      createChannel: (c: any) => {
        channels.push(c);
      },
      checkPermissions: () => ({ display: cur }),
      requestPermissions: () => {
        cur = answer;
        return { display: cur };
      },
      schedule: (o: any) => {
        scheduled.push(...o.notifications);
        return { notifications: o.notifications.map((n: any) => ({ id: String(n.id) })) };
      },
    },
    calls,
  );
  return { LN, calls, scheduled, channels };
}

test('ANDROID-3·4: 알림(LocalNotifications, thenable 대역) — 채널 만들기·권한 확인·요청·알림 띄우기가 끝남', QUICK, async () => {
  const f = fakeLocalNotifications('prompt', 'granted');
  setCapacitorModulesForTest({ localNotifications: async () => ({ LocalNotifications: f.LN }) });
  await capacitorNotifyBackend.init!();
  assert.equal(f.channels[0]?.id, 'brew');
  assert.equal(f.channels[0]?.name, '제조 알림');
  assert.equal(await capacitorNotifyBackend.permission(), 'default');
  assert.equal(await capacitorNotifyBackend.requestPermission(), true, '첫 요청 → 허용');
  assert.ok(f.calls.includes('requestPermissions'));
  assert.equal(await capacitorNotifyBackend.show('done', '완성!', '맛있게 즐기세요'), true);
  assert.equal(f.scheduled[0]?.channelId, 'brew');
  assert.equal(f.scheduled[0]?.title, '완성!');
  // 거부된 상태: 다시 묻지 않고 false, 알림은 띄우지 않음(→ notify 가 토스트)
  const d = fakeLocalNotifications('denied');
  setCapacitorModulesForTest({ localNotifications: async () => ({ LocalNotifications: d.LN }) });
  assert.equal(await capacitorNotifyBackend.requestPermission(), false);
  assert.ok(!d.calls.includes('requestPermissions'), '거부했으면 다시 묻지 않음');
  assert.equal(await capacitorNotifyBackend.show('stopped', '멈춤', '중단됐어요'), false);
});

test('진동(Haptics, thenable 대역) — vibrate 가 끝남', QUICK, async () => {
  const calls: string[] = [];
  const Haptics = capacitorLikePlugin({ impact: () => undefined, notification: () => undefined }, calls);
  setCapacitorModulesForTest({
    haptics: async () => ({
      Haptics,
      ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
      NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
    }),
  });
  for (const k of ['tap', 'press', 'heavy', 'success', 'warning', 'error'] as const) await capacitorHapticsBackend.vibrate(k);
  assert.deepEqual(calls, ['impact', 'impact', 'impact', 'notification', 'notification', 'notification']);
});

test('ANDROID-4: notify() — 알림 구현이 답하지 않으면 정해진 시간 뒤 토스트로 대신, 권한 확인이 늦으면 unsupported', QUICK, async () => {
  const saved = { ...notifyTimeouts };
  notifyTimeouts.showMs = 60;
  notifyTimeouts.permissionMs = 60;
  registerNotifyBackend({ permission: () => never(), requestPermission: () => never(), show: () => never() });
  try {
    useToast.getState().hide();
    await notify('done', '완성!', '맛있게 즐기세요');
    assert.equal(useToast.getState().message, '완성! — 맛있게 즐기세요');
    assert.equal(useToast.getState().kind, 'success');
    assert.equal(await notifyPermission(), 'unsupported');
    // 제때 띄웠으면 토스트 없음
    registerNotifyBackend({ permission: async () => 'granted', requestPermission: async () => true, show: async () => true });
    useToast.getState().hide();
    await notify('stopped', '멈춤', '중단됐어요');
    assert.equal(useToast.getState().message, null);
  } finally {
    Object.assign(notifyTimeouts, saved);
    registerNotifyBackend(null);
  }
});

// ───────────────────────── 뒤로 버튼 (ANDROID-5) ─────────────────────────

const ctx = (o: Partial<BackContext>): BackContext => ({ path: '/', dialogOpen: false, hasHistory: false, busy: false, ...o });

test('ANDROID-5: 뒤로 버튼 판단 — 창 닫기 · 제조 화면 · 하위 화면 · 탭 첫 화면 → 바텐더 · 바텐더 → 앱 내리기', () => {
  // 창이 열려 있으면 어디서든 창만
  assert.equal(decideBack(ctx({ path: '/recipe', dialogOpen: true, hasHistory: true })), 'close-dialog');
  assert.equal(decideBack(ctx({ path: '/brewing', dialogOpen: true, hasHistory: true, busy: true })), 'close-dialog');
  // 제조 화면: 기록이 있으면 history.back (제조 중이면 popstate 보호가 막음), 없으면 제조 중엔 막고 아니면 바텐더로
  assert.equal(decideBack(ctx({ path: '/brewing', hasHistory: true, busy: true })), 'history-back');
  assert.equal(decideBack(ctx({ path: '/brewing', hasHistory: false, busy: true })), 'blocked');
  assert.equal(decideBack(ctx({ path: '/brewing', hasHistory: false, busy: false })), 'go-home');
  // 하위 화면
  for (const path of ['/recipe', '/explore', '/settings', '/ingredients/2', '/calibrate']) {
    assert.equal(decideBack(ctx({ path, hasHistory: true })), 'history-back', path);
    assert.equal(decideBack(ctx({ path, hasHistory: false })), 'go-home', path);
  }
  // 탭 첫 화면은 기록과 상관없이 바텐더로, 바텐더는 앱 내리기
  for (const path of ['/ingredients', '/history', '/device']) {
    assert.equal(decideBack(ctx({ path, hasHistory: true })), 'go-home', path);
    assert.equal(decideBack(ctx({ path, hasHistory: false })), 'go-home', path);
  }
  assert.equal(decideBack(ctx({ path: '/', hasHistory: true })), 'minimize');
  assert.equal(decideBack(ctx({ path: '/', hasHistory: false })), 'minimize');
});

function recordingDeps(c: BackContext, log: string[]): BackDeps {
  return {
    context: () => c,
    closeDialog: () => log.push('close-dialog'),
    historyBack: () => log.push('history-back'),
    goHome: () => log.push('go-home'),
    minimize: () => log.push('minimize'),
    blocked: () => log.push('blocked'),
  };
}

test('ANDROID-5: handleBackButton 은 판단한 동작 1개만 실행', () => {
  const log: string[] = [];
  assert.equal(handleBackButton(recordingDeps(ctx({ path: '/brewing', hasHistory: true, busy: true }), log)), 'history-back');
  assert.equal(handleBackButton(recordingDeps(ctx({ path: '/device' }), log)), 'go-home');
  assert.equal(handleBackButton(recordingDeps(ctx({ path: '/' }), log)), 'minimize');
  assert.deepEqual(log, ['history-back', 'go-home', 'minimize']);
});

test('ANDROID-5: installBackButton — thenable App 대역에 backButton 리스너를 달고(멈추지 않음), 누르면 처리 · 바텐더면 minimizeApp', QUICK, async () => {
  const got: { listener: ((e: { canGoBack?: boolean }) => void) | null } = { listener: null };
  const calls: string[] = [];
  const App = capacitorLikePlugin(
    {
      addListener: (event: string, cb: any) => {
        assert.equal(event, 'backButton');
        got.listener = cb;
        return { remove: async () => undefined };
      },
      minimizeApp: () => undefined,
    },
    calls,
  );
  setAppModuleForTest(async () => ({ App }));
  let c = ctx({ path: '/ingredients' });
  const log: string[] = [];
  await installBackButton({ context: () => c, goHome: () => log.push('go-home'), historyBack: () => log.push('history-back') });
  await installBackButton(); // 두 번 불러도 리스너는 1개
  assert.equal(calls.filter((x) => x === 'addListener').length, 1);
  assert.ok(got.listener, '리스너 등록');
  got.listener({ canGoBack: true });
  assert.deepEqual(log, ['go-home']);
  c = ctx({ path: '/' });
  got.listener({ canGoBack: false });
  await wait(10);
  assert.ok(calls.includes('minimizeApp'), '바텐더에서 뒤로 → 앱 내리기(종료 아님)');
  setAppModuleForTest(async () => ({ App: capacitorLikePlugin({}) }));
});

test('ANDROID-1~5: installCapacitorBackends — 키·알림·진동 구현 등록 + 뒤로 버튼 리스너 (모두 대역)', QUICK, async () => {
  const { P } = fakePreferences();
  const f = fakeLocalNotifications('granted');
  setCapacitorModulesForTest({ preferences: async () => ({ Preferences: P }), localNotifications: async () => ({ LocalNotifications: f.LN }) });
  let added = 0;
  setAppModuleForTest(async () => ({
    App: capacitorLikePlugin({
      addListener: () => {
        added++;
        return { remove: async () => undefined };
      },
    }),
  }));
  installCapacitorBackends();
  await setGeminiKey('fake-test-key-1111111111');
  assert.equal(await getGeminiKey(), 'fake-test-key-1111111111');
  assert.equal(await notifyPermission(), 'granted');
  for (let i = 0; i < 50 && !added; i++) await wait(5);
  assert.equal(added, 1, '뒤로 버튼 리스너 1개');
  registerSecretBackend(null);
  registerNotifyBackend(null);
});
