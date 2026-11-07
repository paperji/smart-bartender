/**
 * 화면 이동 서비스 (expo-router 의 router 대신 — WEBAPP_DESIGN §5)
 *  - App 루트(HashRouter 안)에서 setNavigator(navigate) 로 react-router 의 navigate 를 등록
 *  - 화면 밖 로직(lib/flow.ts·lib/brew.ts)은 go('/recipe')·go('/brewing', { replace: true })·back()·dismissTo('/recipe') 만 사용
 *  - 등록 전(테스트·첫 렌더 전)에는 마지막 이동 요청을 기억했다가 등록되면 실행
 * 경로는 HashRouter 경로 ('/', '/recipe', '/ingredients/2?suggest=…' 등)
 *
 * 이동 기록(dismissTo 용): react-router 가 history.state.idx 에 앱 안 순번을 남기므로, 순번별 경로를 기억해 둠
 *  - go() 직후 · 뒤로/앞으로(popstate) · 화면이 바뀌어 navigate 가 다시 등록될 때(NavBridge) · noteLocation() 을 부를 때 기록
 *  - 새로고침하면 비어 있음 → 모르는 칸을 만나면 더 찾지 않고 바꿔 열기(replace)로 대신 (안전한 쪽)
 */
export interface GoOptions {
  replace?: boolean;
}

export type NavigateFn = (to: string | number, opts?: GoOptions) => void;

let navigator_: NavigateFn | null = null;
let pending: { to: string | number; opts?: GoOptions } | null = null;

export function setNavigator(fn: NavigateFn | null): void {
  navigator_ = fn;
  if (fn) noteLocation();
  if (fn && pending) {
    const p = pending;
    pending = null;
    fn(p.to, p.opts);
    noteLocation();
  }
}

/** 지금 주소가 path(쿼리 포함)와 같은지 — HashRouter: '#/recipe?x=1' */
function isCurrent(path: string): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  const now = window.location.hash.replace(/^#/, '') || '/';
  return now === path;
}

export function go(path: string, opts?: GoOptions): void {
  if (navigator_) {
    // 같은 화면을 기록에 두 번 쌓지 않음 (빠르게 두 번 누름 등)
    if (!opts?.replace && isCurrent(path)) return;
    navigator_(path, opts);
    noteLocation();
  } else pending = { to: path, opts };
}

/** 앱 안 순번 (react-router 가 history.state.idx 에 남김). 모르면 null */
function historyIdx(): number | null {
  try {
    const idx = typeof window !== 'undefined' ? (window.history?.state as { idx?: number } | null)?.idx : undefined;
    return typeof idx === 'number' && idx >= 0 ? idx : null;
  } catch {
    return null;
  }
}

/** 지금 화면 경로 (쿼리 제외 — '#/recipe?x=1' → '/recipe') */
export function locationPath(): string {
  if (typeof window === 'undefined' || !window.location) return '/';
  return window.location.hash.replace(/^#/, '').split('?')[0] || '/';
}

/** 앱 안 이동 기록: 순번(history.state.idx) → 경로 */
const stack: (string | undefined)[] = [];

/** 지금 화면을 이동 기록에 남김 (그 뒤 칸은 지움 — 새로 이동하면 앞으로 가기 기록이 사라지므로) */
export function noteLocation(): void {
  const idx = historyIdx();
  if (idx === null) return;
  stack[idx] = locationPath();
  stack.length = idx + 1;
}

/** 테스트용: 이동 기록 보기·비우기 */
export function navStackForTest(): readonly (string | undefined)[] {
  return stack.slice();
}
export function resetNavStackForTest(): void {
  stack.length = 0;
}

/**
 * dismissTo 가 이 화면을 넘어 더 뒤로 찾지 않는 탭 첫 화면 (appTabs TABS 와 같게).
 * v2.1 은 탭 묶음 위에 레시피·탐색·재료 편집 화면이 쌓였기 때문에, 탭 화면 앞의 기록까지 돌아가지 않음
 */
const ROOT_PATHS = new Set(['/', '/shared', '/ingredients', '/history', '/device']);

/**
 * v2.1 router.dismissTo(path): 앱 안 이전 기록에 path 가 있으면 그 화면까지 뒤로 돌아가고(사이 화면은 닫힘 — 기록이 겹치지 않게),
 * 없으면 지금 화면 자리를 path 로 바꿈.
 *  [바텐더, 레시피, 탐색] → [바텐더, 레시피] · [바텐더, 레시피, 탐색, 재료 편집] → [바텐더, 레시피] · [바텐더, 탐색, 재료 편집] → [바텐더, 탐색, 레시피]
 */
export function dismissTo(path: string): void {
  noteLocation();
  const idx = historyIdx();
  if (navigator_ && idx !== null) {
    for (let j = idx - 1; j >= 0; j--) {
      const p = stack[j];
      if (p === path) {
        navigator_(j - idx);
        return;
      }
      if (p === undefined || ROOT_PATHS.has(p)) break;
    }
  }
  go(path, { replace: true });
}

/** 앱 안에서 뒤로 갈 기록이 있는지 (react-router 가 history.state.idx 에 앱 안 순번을 남김) */
export function canGoBack(): boolean {
  const idx = historyIdx();
  return idx !== null && idx > 0;
}

/** 뒤로 (앱 안 기록이 없으면 fallback 으로 바꿔 이동 — 처음 연 주소가 상세 화면일 때 앱 밖으로 나가지 않게) */
export function back(fallback = '/'): void {
  if (navigator_ && canGoBack()) navigator_(-1);
  else go(fallback, { replace: true });
}

/** 쿼리 문자열 만들기 (값이 undefined·null·'' 이면 뺌) */
export function withQuery(path: string, params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/*
 * 뒤로/앞으로(popstate)도 기록 — popstate 때 history.state 는 이미 새 칸의 것.
 * 개발 중 모듈을 다시 불러와도(HMR) 리스너는 하나만 (새 모듈의 noteLocation 으로 바꿔 끼움)
 */
const HOOK = '__sbNavStack';
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const w = window as unknown as Record<string, { handle: () => void } | undefined>;
  if (!w[HOOK]) {
    const slot = { handle: noteLocation };
    w[HOOK] = slot;
    window.addEventListener('popstate', () => slot.handle());
  } else {
    w[HOOK]!.handle = noteLocation;
  }
}
