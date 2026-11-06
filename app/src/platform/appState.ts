/**
 * 앱 앞/뒤 상태 (React Native AppState 대신 — WEBAPP_DESIGN §5)
 *  - 웹·PWA·Electron·Capacitor WebView 모두 document.visibilitychange 로 판단
 *  - document 가 없는 Node(테스트)에서는 늘 'active'
 * device/client.ts(ping 시계 다시 시작)·brew.ts(백그라운드일 때만 알림) 가 사용
 */
export type AppStateStatus = 'active' | 'background';

function doc(): Document | null {
  return typeof document !== 'undefined' ? document : null;
}

export function currentAppState(): AppStateStatus {
  const d = doc();
  if (!d || typeof d.visibilityState !== 'string') return 'active';
  return d.visibilityState === 'hidden' ? 'background' : 'active';
}

export function isAppActive(): boolean {
  return currentAppState() === 'active';
}

/** 앱 상태가 바뀔 때마다 호출. 해제 함수 반환 */
export function onAppStateChange(cb: (state: AppStateStatus) => void): () => void {
  const d = doc();
  if (!d || typeof d.addEventListener !== 'function') return () => undefined;
  let last = currentAppState();
  const handler = () => {
    const s = currentAppState();
    if (s === last) return;
    last = s;
    cb(s);
  };
  d.addEventListener('visibilitychange', handler);
  return () => {
    d.removeEventListener('visibilitychange', handler);
  };
}
