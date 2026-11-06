/**
 * 제조 알림 (SPEC §5.1, WEBAPP_DESIGN §7)
 *  - 웹: Notification API — 권한은 첫 제조 때 1번 요청(requestNotifyPermission).
 *        서비스 워커가 있으면 registration.showNotification(안드로이드 Chrome 은 생성자 알림 미지원), 없으면 new Notification
 *  - 시스템 알림을 못 띄우면(권한 없음·미지원) 화면 토스트로 대신 안내
 *  - APK: @capacitor/local-notifications 구현을 앱 시작 때 등록 (capacitor/backends.ts — boot.ts), EXE: Windows 알림(boot.ts)
 *  - 진동: haptics
 *  - 알림 구현(네이티브·서비스 워커)이 늦거나 응답하지 않아도 화면이 멈추지 않게 시간 제한 → 넘으면 토스트로 대신 (ANDROID-4)
 *  - APK 예비 알림: 백그라운드에서 JS 가 멈춰도 완료 알림이 뜨게 제조 시작 때 OS 예약 알림을 걸어 둠 (scheduleReminder, RC-1)
 */
import { toast, type ToastKind } from '@/store/toast';

import { haptic } from './haptics';

export type NotifyKind = 'done' | 'stopped' | 'error' | 'disconnect';

export const BREW_CHANNEL_ID = 'brew';

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** 알림 구현 (Capacitor LocalNotifications 등) */
export interface NotifyBackend {
  init?(): Promise<void>;
  permission(): Promise<NotifyPermission>;
  requestPermission(): Promise<boolean>;
  /** 알림을 띄웠으면 true. id 를 주면 그 id 의 알림(예약된 예비 알림 포함)을 이 알림으로 바꿈 */
  show(kind: NotifyKind, title: string, body: string, id?: number): Promise<boolean>;
  /**
   * (선택) atMs 에 OS 가 띄우는 예약 알림 — 앱이 백그라운드라 화면 JS 가 멈춰도 뜸 (APK 만, RC-1).
   * 예약했으면 알림 id, 못 했으면(권한 없음 등) null
   */
  scheduleAt?(kind: NotifyKind, title: string, body: string, atMs: number): Promise<number | null>;
  /** (선택) 예약 알림 취소 — 아직 안 떴으면 예약을 지우고, 이미 떴으면 알림 목록에서 지움 */
  cancel?(id: number): Promise<void>;
}

let backend: NotifyBackend | null = null;

/** 알림 구현 교체 — APK 는 capacitor/backends.ts 의 capacitorNotifyBackend, EXE 는 boot.ts 의 electronNotifyBackend, 테스트는 대역 */
export function registerNotifyBackend(b: NotifyBackend | null): void {
  backend = b;
  reminders.clear(); // 예약은 그 구현의 id — 구현이 바뀌면 의미 없음
}

/**
 * 시간 제한 (ms) — 테스트에서 줄일 수 있게 객체로
 *  - showMs: 시스템 알림을 띄웠는지 답을 기다리는 시간. 넘으면 화면 토스트로 대신 (늦게라도 뜨면 둘 다 보일 수 있음)
 *  - permissionMs: 지금 권한 상태 확인을 기다리는 시간. 넘으면 'unsupported'
 * 권한 요청(requestNotifyPermission)은 사용자가 시스템 창에 답할 때까지 기다리므로 제한 없음 — 제조는 brew.ts 가 오래 기다리지 않음
 */
export const notifyTimeouts = { showMs: 2500, permissionMs: 3000 };

/** p 가 ms 안에 끝나지 않거나 실패하면 fallback */
function settleWithin<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

function api(): any | null {
  const N = (globalThis as any).Notification;
  return typeof N === 'function' ? N : null;
}

/** 시스템 알림을 쓸 수 있는 환경인지 */
export function notificationsAvailable(): boolean {
  return !!backend || !!api();
}

/** 앱 시작 시 1회 (웹은 준비할 것 없음 — 권한은 첫 제조 때) */
export async function initNotifications(): Promise<void> {
  try {
    await backend?.init?.();
  } catch {
    /* ignore */
  }
}

export async function notifyPermission(): Promise<NotifyPermission> {
  if (backend) {
    let p: Promise<NotifyPermission>;
    try {
      p = backend.permission();
    } catch {
      return 'unsupported';
    }
    return settleWithin(p, notifyTimeouts.permissionMs, 'unsupported');
  }
  const N = api();
  if (!N) return 'unsupported';
  return N.permission === 'granted' || N.permission === 'denied' ? N.permission : 'default';
}

/** 첫 제조 때 1회 호출: 알림 권한 요청 (이미 허용/거부했으면 다시 묻지 않음) */
export async function requestNotifyPermission(): Promise<boolean> {
  if (backend) {
    try {
      return await backend.requestPermission();
    } catch {
      return false;
    }
  }
  const N = api();
  if (!N) return false;
  if (N.permission === 'granted') return true;
  if (N.permission === 'denied') return false;
  try {
    return (await N.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

const TOAST_KIND: Record<NotifyKind, ToastKind> = { done: 'success', stopped: 'warning', error: 'error', disconnect: 'warning' };

const ICON = './icons/icon-192.png';

async function showWeb(kind: NotifyKind, title: string, body: string): Promise<boolean> {
  const N = api();
  if (!N || N.permission !== 'granted') return false;
  const options = { body, icon: ICON, badge: ICON, tag: `brew-${kind}`, lang: 'ko' };
  // 서비스 워커가 있으면 그쪽으로 (안드로이드 Chrome 은 new Notification 을 막음)
  try {
    const sw: any = typeof navigator !== 'undefined' ? (navigator as any).serviceWorker : null;
    const reg = sw && typeof sw.getRegistration === 'function' ? await sw.getRegistration() : null;
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, options);
      return true;
    }
  } catch {
    /* 아래 생성자로 */
  }
  try {
    // eslint-disable-next-line no-new
    new N(title, options);
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── 예비 알림 (RC-1) ─────────────────────────
// 안드로이드 APK 는 앱이 백그라운드로 가면 WebView 의 JS 가 거의 멈춰서, 제조가 끝나도 완료 처리와 notify() 가
// 앱을 다시 열 때에야 실행됨. 그래서 제조를 시작할 때 "끝났을 시각"에 OS 가 띄우는 예비 알림을 예약해 두고,
// 실제 결과를 처리하면(앱이 깨어 있으면 제때, 아니면 다시 열 때) 같은 id 의 알림으로 바꾸거나 취소함.
// 예약 기능이 없는 구현(웹·EXE)에서는 아무것도 하지 않음 — 웹 블루투스 이벤트는 백그라운드 탭에서도 전달됨.

/** 태그(작업 키) → 예약 결과(알림 id). 예약이 끝나기 전에 취소·교체가 와도 순서가 꼬이지 않게 Promise 로 보관 */
const reminders = new Map<string, Promise<number | null>>();
const MAX_REMINDERS = 30;

/** 예비 알림 예약 (같은 태그는 1번만). 예약 기능이 없거나 실패하면 조용히 넘어감 */
export function scheduleReminder(tag: string, kind: NotifyKind, title: string, body: string, atMs: number): void {
  const b = backend;
  if (!b?.scheduleAt || reminders.has(tag)) return;
  let p: Promise<number | null>;
  try {
    p = b.scheduleAt(kind, title, body, atMs).then(
      (id) => (typeof id === 'number' ? id : null),
      () => null,
    );
  } catch {
    return;
  }
  reminders.set(tag, p);
  while (reminders.size > MAX_REMINDERS) reminders.delete(reminders.keys().next().value as string);
}

/** 예약 기다리는 시간 제한 — 넘으면 늦게 끝난 예약은 끝나는 대로 취소 (주인 없는 알림이 남지 않게) */
async function takeReminder(tag: string): Promise<number | null> {
  const p = reminders.get(tag);
  if (!p) return null;
  reminders.delete(tag);
  const TIMEOUT = Symbol('timeout');
  const r = await settleWithin<number | null | typeof TIMEOUT>(p, notifyTimeouts.showMs, TIMEOUT);
  if (r === TIMEOUT) {
    p.then((late) => {
      if (late != null) backend?.cancel?.(late).catch(() => undefined);
    }).catch(() => undefined);
    return null;
  }
  return r;
}

/** 예비 알림 취소 (예약한 적 없으면 아무것도 안 함) */
export async function cancelReminder(tag: string): Promise<void> {
  const id = await takeReminder(tag);
  if (id == null || !backend?.cancel) return;
  try {
    await settleWithin(backend.cancel(id), notifyTimeouts.showMs, undefined);
  } catch {
    /* ignore */
  }
}

/** 테스트용: 지금 예약해 둔 태그 */
export function pendingReminderTags(): string[] {
  return [...reminders.keys()];
}

/**
 * 알림 + 진동. 시스템 알림을 띄울 수 없으면 화면 토스트.
 * opts.replaces: 이 태그로 예약한 예비 알림을 이 알림으로 바꿈 (예약이 아직이면 예약은 취소되고, 이미 떴으면 내용이 바뀜)
 */
export async function notify(kind: NotifyKind, title: string, body: string, opts?: { replaces?: string }): Promise<void> {
  if (kind === 'done') haptic.success();
  else haptic.warning();
  const replaceId = opts?.replaces != null ? await takeReminder(opts.replaces) : null;
  let shown = false;
  try {
    const p = backend ? backend.show(kind, title, body, replaceId ?? undefined) : showWeb(kind, title, body);
    // 알림 구현이 제때 답하지 않으면(네이티브 멈춤 등) 띄우지 못한 것으로 보고 토스트
    shown = await settleWithin(p, notifyTimeouts.showMs, false);
  } catch {
    shown = false;
  }
  // 바꾸지 못했으면 예비 알림이 나중에 혼자 뜨지 않게 취소
  if (!shown && replaceId != null && backend?.cancel) {
    backend.cancel(replaceId).catch(() => undefined);
  }
  // 시스템 알림을 못 띄우면 화면 토스트 (탭이 가려져 있어도 돌아오면 볼 수 있게)
  if (!shown) toast(`${title} — ${body}`, TOAST_KIND[kind]);
}
