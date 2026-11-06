/**
 * UI 공용 헬퍼 — 햅틱, 확인창(웹/앱 공통), 포맷
 */
import * as Haptics from 'expo-haptics';
import { Alert, Platform } from 'react-native';

export const haptic = {
  tap() {
    if (Platform.OS === 'web') return;
    Haptics.selectionAsync().catch(() => undefined);
  },
  press() {
    if (Platform.OS === 'web') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  },
  heavy() {
    if (Platform.OS === 'web') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
  },
  success() {
    if (Platform.OS === 'web') return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  },
  warning() {
    if (Platform.OS === 'web') return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  },
};

/** 확인창 (React Native Web 의 Alert 는 버튼을 지원하지 않아 window.confirm 사용) */
export function confirmAsync(
  title: string,
  message: string,
  opts: { confirmText?: string; cancelText?: string; destructive?: boolean } = {},
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(`${title}\n\n${message}`) : true;
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: opts.cancelText ?? '취소', style: 'cancel', onPress: () => resolve(false) },
        { text: opts.confirmText ?? '확인', style: opts.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function alertMessage(title: string, message: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export function fmtMl(ml: number): string {
  const r = Math.round(ml * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}ml`;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}분 ${r}초` : `${m}분`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `오늘 ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `어제 ${time}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${time}`;
}

export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 4) return '••••';
  return `••••••••${k.slice(-4)}`;
}
