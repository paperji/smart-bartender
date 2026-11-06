/**
 * 진동 피드백 (WEBAPP_DESIGN §5 — haptics → navigator.vibrate)
 *  - 지원하는 브라우저(안드로이드 Chrome 등)에서만 진동, 나머지는 조용히 무시
 *  - APK 는 앱 시작 때 capacitor/backends.ts 가 registerHapticsBackend 로 @capacitor/haptics 를 끼움
 */
export type HapticKind = 'tap' | 'press' | 'heavy' | 'success' | 'warning' | 'error';

const PATTERN: Record<HapticKind, number | number[]> = {
  tap: 8,
  press: 15,
  heavy: 30,
  success: [20, 60, 20],
  warning: [40, 60, 40],
  error: [60, 50, 60],
};

export interface HapticsBackend {
  vibrate(kind: HapticKind): void | Promise<void>;
}

let backend: HapticsBackend | null = null;

/** 진동 구현 교체 (APK: capacitor/backends.ts) */
export function registerHapticsBackend(b: HapticsBackend | null): void {
  backend = b;
}

function vibrate(kind: HapticKind) {
  try {
    if (backend) {
      void Promise.resolve(backend.vibrate(kind)).catch(() => undefined);
      return;
    }
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav || typeof nav.vibrate !== 'function') return;
    // 사용자가 화면을 한 번도 누르지 않았으면 브라우저가 막고 콘솔 오류를 남기므로 부르지 않음
    if (nav.userActivation && nav.userActivation.hasBeenActive === false) return;
    nav.vibrate(PATTERN[kind]);
  } catch {
    /* 지원 안 함 */
  }
}

export const haptic = {
  tap: () => vibrate('tap'),
  press: () => vibrate('press'),
  heavy: () => vibrate('heavy'),
  success: () => vibrate('success'),
  warning: () => vibrate('warning'),
  error: () => vibrate('error'),
};
