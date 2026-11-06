import { useEffect } from 'react';

import { keepScreenOn } from './wakeLock';

/** active 인 동안 화면 켜 두기 (제조 진행 화면 등) */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let release: (() => void) | null = null;
    let cancelled = false;
    void keepScreenOn().then((r) => {
      if (cancelled) r();
      else release = r;
    });
    return () => {
      cancelled = true;
      release?.();
    };
  }, [active]);
}
