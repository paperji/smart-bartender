/**
 * 제조 알림 (안드로이드/iOS) — SPEC §5.1
 * - expo-notifications 로컬 알림 (안드로이드 채널 'brew'), 앱이 백그라운드여도 표시
 * - 진동: expo-haptics
 * - 네이티브 모듈이 없는 환경(구버전 APK 등)에서도 크래시 나지 않게 동적 require + try/catch
 *   → 알림을 못 띄우면 화면 토스트로 대신 안내
 */
import { AppState, Platform } from 'react-native';

import { toast, type ToastKind } from '@/store/toast';

import { haptic } from './ui';

export type NotifyKind = 'done' | 'stopped' | 'error' | 'disconnect';

export const BREW_CHANNEL_ID = 'brew';

type NotificationsModule = typeof import('expo-notifications');

let mod: NotificationsModule | null | undefined;

function load(): NotificationsModule | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('expo-notifications') as NotificationsModule;
    mod = m && typeof m.scheduleNotificationAsync === 'function' ? m : null;
  } catch (e) {
    console.warn('[notify] expo-notifications 를 불러오지 못했어요 (토스트로 대신 안내)', e);
    mod = null;
  }
  return mod;
}

/** 알림 기능을 쓸 수 있는지 (네이티브 모듈 존재) */
export function notificationsAvailable(): boolean {
  return !!load();
}

/** 앱 시작 시 1회: 포그라운드 표시 방식 + 안드로이드 채널 'brew' 생성 (안드로이드 13+ 는 채널이 있어야 권한 창이 뜸) */
export async function initNotifications(): Promise<void> {
  const N = load();
  if (!N) return;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync(BREW_CHANNEL_ID, {
        name: '제조 알림',
        description: '음료 제조 완료 · 중단 · 연결 끊김을 알려 드려요',
        importance: N.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 150, 250],
        enableVibrate: true,
        lightColor: '#FF7A1A',
        sound: 'default',
      });
    }
  } catch (e) {
    console.warn('[notify] 알림 초기화 실패', e);
  }
}

/** 첫 제조 때 1회 호출: 알림 권한 요청 (이미 허용/거부했으면 다시 묻지 않음) */
export async function requestNotifyPermission(): Promise<boolean> {
  const N = load();
  if (!N) return false;
  try {
    const cur = await N.getPermissionsAsync();
    if (cur.granted) return true;
    if (cur.canAskAgain === false) return false;
    const r = await N.requestPermissionsAsync();
    return !!r.granted;
  } catch {
    return false;
  }
}

const TOAST_KIND: Record<NotifyKind, ToastKind> = { done: 'success', stopped: 'warning', error: 'error', disconnect: 'warning' };

/** 알림 + 진동. 알림을 띄울 수 없으면(권한 없음/모듈 없음) 화면 토스트 */
export async function notify(kind: NotifyKind, title: string, body: string): Promise<void> {
  if (kind === 'done') haptic.success();
  else haptic.warning();
  const N = load();
  let shown = false;
  if (N) {
    try {
      const perm = await N.getPermissionsAsync();
      if (perm.granted) {
        await N.scheduleNotificationAsync({
          content: { title, body, sound: 'default', data: { kind }, color: '#FF7A1A' },
          trigger: Platform.OS === 'android' ? { channelId: BREW_CHANNEL_ID } : null,
        });
        shown = true;
      }
    } catch (e) {
      console.warn('[notify] 알림 표시 실패', e);
    }
  }
  if (!shown && AppState.currentState === 'active') toast(`${title} — ${body}`, TOAST_KIND[kind]);
}
