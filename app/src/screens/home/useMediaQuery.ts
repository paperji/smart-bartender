/**
 * 미디어 쿼리 구독 (PC ≥ 900px 판정 등). 서버 렌더·테스트처럼 window 가 없으면 false
 */
import { useCallback, useSyncExternalStore } from 'react';

export const WIDE_QUERY = '(min-width: 900px)';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    [query],
  );
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(subscribe, get, () => false);
}
