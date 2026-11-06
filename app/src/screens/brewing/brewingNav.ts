/**
 * 제조 진행 화면 전용 이동·보호 (v2.1 expo-router fullScreenModal 동작을 웹으로)
 *  - dismissTo(path): v2.1 router.dismissTo — 앱 안 이전 기록의 path 화면까지 돌아가고, 없으면 지금 자리를 path 로 바꿈 (lib/nav.dismissTo)
 *  - useBrewBackGuard: 제조 중 뒤로가기(브라우저·안드로이드 뒤로 버튼)로 화면이 닫히지 않게 (v2.1 BackHandler)
 *  - useLeaveWarning: 제조 중 웹 탭을 닫거나 새로고침하려 하면 브라우저가 한 번 더 물어봄 (웹만 — EXE·APK 는 창 닫기를 막지 않음)
 *  - useToastLift: 아래에 붙은 비상 정지 버튼 높이만큼 --tabbar-offset 을 올림 (예비 장치 — 지금 토스트는 모바일 제조 화면에서 화면 위,
 *    PC 에서는 bottom 24px 고정이라 실제로 영향받는 요소는 없음. ui/components.css '모바일 제조 화면' 참고)
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { dismissTo as navDismissTo, go } from '@/lib/nav';
import { isWeb } from '@/platform/detect';

export const BREWING_PATH = '/brewing';

/** 지금 화면 경로 (HashRouter: '#/recipe?x=1' → '/recipe') */
export function currentPath(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.hash.replace(/^#/, '').split('?')[0] || '/';
}

/** v2.1 router.dismissTo(path) — 앱 안 이전 기록에 path 가 있으면 그 화면까지 돌아가고(기록이 겹치지 않게), 없으면 지금 자리를 path 로 바꿈 (lib/nav) */
export const dismissTo = navDismissTo;

/**
 * active 인 동안 뒤로가기로 이 화면을 벗어나면 곧바로 제조 화면으로 되돌리고 onBlocked 실행.
 * (HashRouter 라 react-router 의 useBlocker 를 쓸 수 없어 popstate 로 처리 — react-router 보다 먼저 같은 이벤트 안에서
 *  다시 이동하므로 화면이 바뀌지 않음. 기록은 [… 이전 화면, 제조] 그대로)
 */
export function useBrewBackGuard(active: boolean, onBlocked: () => void): void {
  const cb = useRef(onBlocked);
  useLayoutEffect(() => {
    cb.current = onBlocked;
  });
  useEffect(() => {
    if (!active) return;
    const token = {};
    guard = { token, onBlocked: () => cb.current() };
    return () => {
      if (guard?.token === token) guard = null;
    };
  }, [active]);
}

/** 지금 켜져 있는 뒤로가기 막기 (제조 화면이 제조 중일 때만) */
let guard: { token: object; onBlocked: () => void } | null = null;

function onPopGuard() {
  if (!guard || currentPath() === BREWING_PATH) return;
  const blocked = guard.onBlocked;
  go(BREWING_PATH);
  blocked();
}

/*
 * popstate 리스너는 이 모듈을 불러올 때(앱 시작, react-router 가 리스너를 달기 전) 1번만 담음.
 * 같은 대상(window)의 리스너는 단 순서대로 불리고(캡처 여부와 무관), React 19 는 popstate 안의 화면 갱신을 곧바로 처리해서
 * react-router 보다 늦게 불리면 그사이 제조 화면이 사라져 막을 수 없음. 개발 중 모듈을 다시 불러와도(HMR) 리스너는 하나만
 */
const HOOK = '__sbBrewBackGuard';
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, { handle: () => void } | undefined>;
  if (!w[HOOK]) {
    const slot = { handle: onPopGuard };
    w[HOOK] = slot;
    window.addEventListener('popstate', () => slot.handle());
  } else {
    w[HOOK]!.handle = onPopGuard;
  }
}

/** active 인 동안 웹 탭 닫기·새로고침 전에 브라우저 확인창 (Electron 은 확인창 없이 창 닫기가 막혀서 웹에서만) */
export function useLeaveWarning(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined' || !isWeb()) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}

/**
 * active 인 동안 화면 아래 토스트를 el 위로 (모바일에서 아래에 붙은 비상 정지 버튼을 가려 누를 수 없게 되지 않도록).
 * 토스트 위치는 --tabbar-offset 을 따르므로 <html> 에 그 값을 잠시 덮어씀 — 화면을 떠나면 원래대로
 * (지금은 모바일 제조 화면(sb-no-rail)에서 토스트가 화면 위에 떠서 이 값이 토스트에 쓰이지 않음 — 아래 토스트로 되돌릴 때를 위한 예비)
 */
export function useToastLift(el: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const node = el.current;
    if (!active || !node || typeof document === 'undefined') return;
    const root = document.documentElement;
    // 내용이 짧으면 버튼 묶음이 화면 맨 아래가 아니라 더 위에 있음 → 묶음 위쪽부터 화면 아래까지의 거리만큼 올림
    const apply = () => {
      const r = node.getBoundingClientRect();
      const vh = window.innerHeight || root.clientHeight;
      const fromBottom = r.top < vh ? Math.ceil(vh - r.top) : 0;
      const lift = Math.min(Math.max(Math.ceil(r.height), fromBottom), vh);
      root.style.setProperty('--tabbar-offset', `${lift}px`);
    };
    apply();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    ro?.observe(node);
    ro?.observe(root);
    window.addEventListener('scroll', apply, { passive: true });
    window.addEventListener('resize', apply);
    return () => {
      ro?.disconnect();
      window.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      root.style.removeProperty('--tabbar-offset');
    };
  }, [el, active]);
}
