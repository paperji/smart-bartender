/**
 * 화면 켜 두기 (Screen Wake Lock API) — 제조 중 화면이 꺼져 블루투스가 끊기지 않게 (WEBAPP_DESIGN §7)
 *  - 지원하지 않는 환경(일부 브라우저·Node)에서는 아무것도 하지 않음
 *  - 탭이 가려지면 브라우저가 잠금을 풀기 때문에, 다시 보일 때 자동으로 다시 요청
 *  - 해제한 뒤에 끝난 요청(다시 요청하는 도중 해제)은 받자마자 바로 풂 — 제조가 끝났는데 화면이 계속 켜져 있지 않게
 * 사용: const release = await keepScreenOn(); … release();  (React 에서는 platform/useWakeLock 의 useWakeLock(active))
 */
export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).wakeLock && typeof (navigator as any).wakeLock.request === 'function';
}

function releaseQuietly(s: any): void {
  try {
    const p = s?.release?.();
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/** 화면 켜 두기 시작. 해제 함수 반환 (여러 번 불러도 안전) */
export async function keepScreenOn(): Promise<() => void> {
  if (!wakeLockSupported()) return () => undefined;
  let sentinel: any = null;
  let released = false;
  /** 요청이 진행 중이면 다시 요청하지 않음 (보임 이벤트가 겹쳐도 잠금은 하나만) */
  let acquiring = false;
  const acquire = async () => {
    if (released || acquiring) return;
    acquiring = true;
    try {
      const s = await (navigator as any).wakeLock.request('screen');
      if (released) {
        // 요청하는 사이에 해제됨 → 받은 잠금도 바로 풂
        releaseQuietly(s);
        return;
      }
      sentinel = s;
    } catch {
      sentinel = null; // 배터리 절약 모드·권한 정책 등
    } finally {
      acquiring = false;
    }
  };
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && (!sentinel || sentinel.released)) {
      void acquire();
    }
  };
  await acquire();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  return () => {
    if (released) return;
    released = true;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    releaseQuietly(sentinel);
    sentinel = null;
  };
}
