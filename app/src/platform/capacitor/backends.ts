/**
 * 안드로이드 APK(Capacitor) 전용 구현 — 앱 시작 때 installCapacitorBackends() 가 register…() 자리에 끼움 (WEBAPP_DESIGN §7)
 *  - 키 저장: @capacitor/preferences (앱 전용 저장소). 예전에 localStorage 에 저장된 키가 있으면 옮겨 담고 지움
 *  - 알림: @capacitor/local-notifications — 채널 'brew'(제조 알림, 중요도 높음·진동), 안드로이드 13+ 알림 권한,
 *          제조 끝 시각의 예비 알림 예약·교체·취소 (백그라운드에서 JS 가 멈춰도 뜨게 — notify.ts scheduleReminder)
 *  - 진동: @capacitor/haptics (v2.1 의 expo-haptics 와 같은 세기)
 *  - 뒤로 버튼: @capacitor/app (backButton.ts)
 *  - 날씨 위치: WebView 의 navigator.geolocation 그대로 (Capacitor 가 대략적 위치 권한을 대신 물어봄 — weather.ts)
 * 플러그인은 처음 쓸 때 동적 import → 웹·EXE 번들의 첫 화면에는 포함되지 않음 (테스트는 setCapacitorModulesForTest 로 대역을 끼움).
 * 플러그인 객체는 thenable Proxy 라 Promise 결과로 그대로 돌려주면 끝나지 않음 → plugins.ts 의 pluginLoader 로 상자에 담아 씀.
 * 네이티브가 응답하지 않아도 화면이 멈추지 않게 키 저장·알림 호출에는 시간 제한을 둠 (권한 요청 창은 사용자가 답할 때까지 기다림)
 */
import { registerHapticsBackend, type HapticKind, type HapticsBackend } from '../haptics';
import { BREW_CHANNEL_ID, registerNotifyBackend, type NotifyBackend, type NotifyKind, type NotifyPermission } from '../notify';
import { GEMINI_KEY_STORAGE, registerSecretBackend, type SecretBackend } from '../secrets';
import { kv } from '../storage';
import { installBackButton } from './backButton';
import { pluginLoader, withTimeout } from './plugins';

const ACCENT = '#FF7A2F';

/** 키 저장소(Preferences) 한 번 호출의 시간 제한 — 보통 수십 ms */
export const PREFS_TIMEOUT_MS = 5000;
/** 알림 채널 만들기·권한 확인·알림 띄우기 한 번의 시간 제한 */
export const NOTIFY_CALL_TIMEOUT_MS = 5000;

const PREFS_SLOW = '키 저장소가 응답하지 않아요. 앱을 다시 열어 주세요.';
const NOTIFY_SLOW = '알림 기능이 응답하지 않아요.';

/** 플러그인 모듈 (테스트는 setCapacitorModulesForTest 로 대역을 끼움) */
const modules = {
  preferences: () => import('@capacitor/preferences'),
  localNotifications: () => import('@capacitor/local-notifications'),
  haptics: () => import('@capacitor/haptics'),
};

const prefs = pluginLoader(() => modules.preferences(), (m) => m.Preferences);
const notifications = pluginLoader(() => modules.localNotifications(), (m) => m.LocalNotifications);
const haptics = pluginLoader(() => modules.haptics(), (m) => m);

// ───────────────────────── 키 저장 (Preferences) ─────────────────────────

let migrated: Promise<void> | null = null;

/** localStorage 에 남아 있던 키(웹 방식으로 저장된 것)를 Preferences 로 옮기고 지움 — 성공할 때까지(보통 1번) */
function migrateFromLocalStorage(): Promise<void> {
  if (!migrated) {
    migrated = (async () => {
      const old = kv.getItem(GEMINI_KEY_STORAGE);
      if (!old) return;
      const { plugin: P } = await prefs();
      const cur = (await withTimeout(P.get({ key: GEMINI_KEY_STORAGE }), PREFS_TIMEOUT_MS, PREFS_SLOW)).value;
      if (!cur) await withTimeout(P.set({ key: GEMINI_KEY_STORAGE, value: old }), PREFS_TIMEOUT_MS, PREFS_SLOW);
      kv.removeItem(GEMINI_KEY_STORAGE);
    })().catch(() => {
      migrated = null; // 다음에 다시 시도 (옮기지 못한 키는 localStorage 에 그대로 남아 있음)
    });
  }
  return migrated;
}

export const capacitorSecretBackend: SecretBackend = {
  async get(name) {
    await migrateFromLocalStorage();
    const { plugin: P } = await prefs();
    return (await withTimeout(P.get({ key: name }), PREFS_TIMEOUT_MS, PREFS_SLOW)).value;
  },
  async set(name, value) {
    await migrateFromLocalStorage();
    const { plugin: P } = await prefs();
    await withTimeout(P.set({ key: name, value }), PREFS_TIMEOUT_MS, PREFS_SLOW);
  },
  async remove(name) {
    await migrateFromLocalStorage();
    const { plugin: P } = await prefs();
    await withTimeout(P.remove({ key: name }), PREFS_TIMEOUT_MS, PREFS_SLOW);
    kv.removeItem(name);
  },
};

// ───────────────────────── 알림 (LocalNotifications) ─────────────────────────

function mapPermission(display: string | undefined): NotifyPermission {
  if (display === 'granted') return 'granted';
  if (display === 'denied') return 'denied';
  return 'default'; // prompt · prompt-with-rationale
}

let nextId = Math.floor(Date.now() / 1000) % 1_000_000_000;
function allocId(): number {
  nextId = (nextId + 1) % 2_000_000_000;
  return nextId;
}

function brewNotification(id: number, kind: NotifyKind, title: string, body: string) {
  return {
    id,
    title,
    body,
    channelId: BREW_CHANNEL_ID,
    smallIcon: 'ic_stat_notify',
    iconColor: ACCENT,
    autoCancel: true,
    // 정확한 시각 알람을 요구하지 않음 — 기본값(true)이면 SCHEDULE_EXACT_ALARM 권한이 없을 때 플러그인이
    // 알림을 띄울 때마다 "알람 및 리마인더" 설정 화면을 열어 버림 (에뮬레이터에서 제조 시작 직후 확인)
    isExactNotification: false,
    extra: { kind },
  };
}

export const capacitorNotifyBackend: NotifyBackend = {
  async init() {
    const { plugin: LN } = await notifications();
    // 안드로이드 8+ 는 채널이 있어야 하고, 13+ 는 채널이 있어야 권한 창이 뜸 (v2.1 과 같은 이름·설명)
    await withTimeout(
      LN.createChannel({
        id: BREW_CHANNEL_ID,
        name: '제조 알림',
        description: '음료 제조 완료 · 중단 · 연결 끊김을 알려 드려요',
        importance: 4,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: ACCENT,
      }),
      NOTIFY_CALL_TIMEOUT_MS,
      NOTIFY_SLOW,
    );
  },
  async permission() {
    const { plugin: LN } = await notifications();
    return mapPermission((await withTimeout(LN.checkPermissions(), NOTIFY_CALL_TIMEOUT_MS, NOTIFY_SLOW)).display);
  },
  async requestPermission() {
    const { plugin: LN } = await notifications();
    const cur = (await withTimeout(LN.checkPermissions(), NOTIFY_CALL_TIMEOUT_MS, NOTIFY_SLOW)).display;
    if (cur === 'granted') return true;
    if (cur === 'denied') return false; // 다시 묻지 않음 (설정에서 직접 허용)
    // 시스템 권한 창 — 사용자가 답할 때까지 기다림 (제조는 brew.ts 가 이 답을 오래 기다리지 않고 시작)
    return (await LN.requestPermissions()).display === 'granted';
  },
  async show(kind: NotifyKind, title: string, body: string, id?: number) {
    const { plugin: LN } = await notifications();
    if ((await withTimeout(LN.checkPermissions(), NOTIFY_CALL_TIMEOUT_MS, NOTIFY_SLOW)).display !== 'granted') return false;
    // 같은 id 로 다시 띄우면 플러그인이 떠 있던 알림을 지우고 그 id 의 예약도 취소한 뒤 새로 띄움 → 예비 알림 교체
    await withTimeout(
      LN.schedule({ notifications: [brewNotification(id ?? allocId(), kind, title, body)] }),
      NOTIFY_CALL_TIMEOUT_MS,
      NOTIFY_SLOW,
    );
    return true;
  },
  async scheduleAt(kind: NotifyKind, title: string, body: string, atMs: number) {
    const { plugin: LN } = await notifications();
    if ((await withTimeout(LN.checkPermissions(), NOTIFY_CALL_TIMEOUT_MS, NOTIFY_SLOW)).display !== 'granted') return null;
    const id = allocId();
    // 정확한 시각 알람 권한(SCHEDULE_EXACT_ALARM)은 받지 않음 → 안드로이드가 조금(보통 수 초~수십 초) 늦게 띄울 수 있음.
    // allowWhileIdle: 화면이 꺼져 절전(Doze) 중이어도 뜨게
    await withTimeout(
      LN.schedule({
        notifications: [{ ...brewNotification(id, kind, title, body), schedule: { at: new Date(atMs), allowWhileIdle: true } }],
      }),
      NOTIFY_CALL_TIMEOUT_MS,
      NOTIFY_SLOW,
    );
    return id;
  },
  async cancel(id: number) {
    const { plugin: LN } = await notifications();
    // 아직 안 뜬 예약은 cancel, 이미 뜬 알림은 알림 목록에서 지움 (cancel 은 뜬 알림을 지우지 않음)
    await withTimeout(LN.cancel({ notifications: [{ id }] }), NOTIFY_CALL_TIMEOUT_MS, NOTIFY_SLOW);
    await withTimeout(LN.removeDeliveredNotificationsById({ ids: [id] }), NOTIFY_CALL_TIMEOUT_MS, NOTIFY_SLOW).catch(() => undefined);
  },
};

// ───────────────────────── 진동 (Haptics) ─────────────────────────

export const capacitorHapticsBackend: HapticsBackend = {
  async vibrate(kind: HapticKind) {
    const { plugin: m } = await haptics();
    const { Haptics, ImpactStyle, NotificationType } = m;
    // 플러그인 메서드가 돌려준 Promise 만 기다림 — Haptics 자체는 돌려주지 않음
    switch (kind) {
      case 'tap':
        await Haptics.impact({ style: ImpactStyle.Light });
        return;
      case 'press':
        await Haptics.impact({ style: ImpactStyle.Medium });
        return;
      case 'heavy':
        await Haptics.impact({ style: ImpactStyle.Heavy });
        return;
      case 'success':
        await Haptics.notification({ type: NotificationType.Success });
        return;
      case 'warning':
        await Haptics.notification({ type: NotificationType.Warning });
        return;
      case 'error':
        await Haptics.notification({ type: NotificationType.Error });
        return;
    }
  },
};

let installed = false;

/** APK 에서 앱 시작 때 1번 (platform/boot.ts) */
export function installCapacitorBackends(): void {
  if (installed) return;
  installed = true;
  registerSecretBackend(capacitorSecretBackend);
  registerNotifyBackend(capacitorNotifyBackend);
  registerHapticsBackend(capacitorHapticsBackend);
  installBackButton().catch(() => undefined);
}

// ───────────────────────── 테스트용 ─────────────────────────

type CapacitorModules = typeof modules;

/** 테스트: 플러그인 모듈 대역 끼우기 (예: thenable Proxy 대역) + 불러온 것·키 옮기기 기억 지우기 */
export function setCapacitorModulesForTest(o: { [K in keyof CapacitorModules]?: () => Promise<unknown> }): void {
  Object.assign(modules, o as Partial<CapacitorModules>);
  prefs.reset();
  notifications.reset();
  haptics.reset();
  migrated = null;
}
