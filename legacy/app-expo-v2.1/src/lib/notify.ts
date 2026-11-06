/**
 * 제조 알림 (웹) — SPEC §5.1
 * - 브라우저 Notification API (권한이 허용된 경우)
 * - 권한이 없거나 지원하지 않으면(예: 안드로이드 Chrome 은 서비스워커 없이 new Notification 불가) 화면 토스트
 * (안드로이드/iOS 는 notify.native.ts 사용)
 */
import { toast, type ToastKind } from '@/store/toast';

export type NotifyKind = 'done' | 'stopped' | 'error' | 'disconnect';

export const BREW_CHANNEL_ID = 'brew';

function api(): any | null {
  const N = (globalThis as any).Notification;
  return typeof N === 'function' ? N : null;
}

export function notificationsAvailable(): boolean {
  return !!api();
}

export async function initNotifications(): Promise<void> {
  // 웹은 준비할 것 없음 (권한은 첫 제조 때 요청)
}

/** 첫 제조 때 1회 호출: 브라우저 알림 권한 요청 */
export async function requestNotifyPermission(): Promise<boolean> {
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

export async function notify(kind: NotifyKind, title: string, body: string): Promise<void> {
  const N = api();
  let shown = false;
  if (N && N.permission === 'granted') {
    try {
      // eslint-disable-next-line no-new
      new N(title, { body, icon: '/favicon.png', tag: `brew-${kind}` });
      shown = true;
    } catch {
      shown = false; // 안드로이드 Chrome 등: 생성자 알림 미지원
    }
  }
  // 시스템 알림을 못 띄우면 화면 토스트 (탭이 가려져 있어도 돌아오면 볼 수 있게)
  if (!shown) toast(`${title} — ${body}`, TOAST_KIND[kind]);
  // 진동 (지원하는 브라우저만)
  try {
    (navigator as any)?.vibrate?.(kind === 'done' ? [120, 80, 120] : [250]);
  } catch {
    /* ignore */
  }
}
