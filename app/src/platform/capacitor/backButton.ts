/**
 * 안드로이드 뒤로 버튼 (APK) — @capacitor/app 의 'backButton' 을 앱 안 이동으로 바꿈 (v2.1 expo-router·BackHandler 와 같게)
 *  - 확인창·성인 확인처럼 열린 창이 있으면 그 창만 닫음(Esc 와 같음). AI 추천 로딩처럼 닫을 수 없는 창이면 아무것도 안 함
 *  - 제조 화면: 앱 안 기록이 있으면 history.back() → 제조 중이면 screens/brewing/brewingNav 의 popstate 보호가
 *    제조 화면을 그대로 두고 '제조 중이에요. 멈추려면 비상 정지를 누르세요.' 안내 (연결이 끊겼으면 닫을지 물어봄)
 *  - 하위 화면(레시피·탐색·설정·재료 편집·캘리브레이션): 앱 안 기록이 있으면 history.back(), 없으면 바텐더로
 *  - 탭 첫 화면(재료·기록·기기): 바텐더 탭으로 (v2.1 탭과 같음)
 *  - 바텐더: 앱을 내림(minimizeApp — 끄지 않고 뒤로 보냄 → 블루투스 연결·진행 중 작업·알림 유지)
 * 리스너를 달기 전(앱 시작 직후 잠깐)에는 플러그인 기본 동작(WebView 뒤로 가기, 없으면 아무것도 안 함)이라 앱이 닫히지 않음.
 * 플러그인(App)은 thenable Proxy 라 plugins.ts 의 상자에 담아서만 다룸.
 */
import { TAB_PATHS } from '@/appTabs';
import { canGoBack, go } from '@/lib/nav';
import { isBusy, useDevice } from '@/store/device';
import { toast } from '@/store/toast';

import { pluginLoader } from './plugins';

/** 제조 진행 화면 경로 (screens/brewing/brewingNav.ts 의 BREWING_PATH 와 같음) */
const BREWING_PATH = '/brewing';
const HOME_PATH = '/';

/** v2.1 brewing.tsx 와 같은 안내 (제조 화면의 뒤로가기 보호와 같은 말) */
export const BREWING_BACK_TEXT = '제조 중이에요. 멈추려면 비상 정지를 누르세요.';

export type BackAction = 'close-dialog' | 'history-back' | 'go-home' | 'minimize' | 'blocked';

export interface BackContext {
  /** 지금 화면 경로 ('/recipe' 등, 쿼리 제외) */
  path: string;
  /** 화면 위에 창(aria-modal)이 열려 있음 */
  dialogOpen: boolean;
  /** 앱 안에서 뒤로 갈 기록이 있음 (react-router history.state.idx > 0) */
  hasHistory: boolean;
  /** 기기가 작업 중 (제조·세척·구동) */
  busy: boolean;
}

/** 뒤로 버튼을 눌렀을 때 할 일 (화면 상태만 보고 정함 — 테스트용으로 따로) */
export function decideBack(ctx: BackContext): BackAction {
  if (ctx.dialogOpen) return 'close-dialog';
  if (ctx.path === BREWING_PATH) {
    // 기록이 있으면 history.back() — 제조 중이면 popstate 보호가 막음. 기록이 없으면 popstate 가 없으니 여기서 막음
    if (ctx.hasHistory) return 'history-back';
    return ctx.busy ? 'blocked' : 'go-home';
  }
  if (ctx.path === HOME_PATH) return 'minimize';
  if (TAB_PATHS.has(ctx.path)) return 'go-home';
  return ctx.hasHistory ? 'history-back' : 'go-home';
}

/** 실제 동작 (테스트는 대역) */
export interface BackDeps {
  context(): BackContext;
  closeDialog(): void;
  historyBack(): void;
  goHome(): void;
  minimize(): void;
  blocked(): void;
}

/** HashRouter 경로: '#/recipe?x=1' → '/recipe' */
function hashPath(): string {
  if (typeof window === 'undefined') return HOME_PATH;
  return window.location.hash.replace(/^#/, '').split('?')[0] || HOME_PATH;
}

function dialogOpen(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"]');
}

/** 열린 창 닫기 = Esc (ui/Modal 이 document 의 keydown 캡처로 onClose 를 부름). 닫을 수 없는 창은 그대로 */
function closeDialog(): void {
  if (typeof document === 'undefined' || typeof KeyboardEvent === 'undefined') return;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
}

function realDeps(minimize: () => void): BackDeps {
  return {
    context: () => ({ path: hashPath(), dialogOpen: dialogOpen(), hasHistory: canGoBack(), busy: isBusy(useDevice.getState().job) }),
    closeDialog,
    historyBack: () => window.history.back(),
    goHome: () => go(HOME_PATH, { replace: true }),
    minimize,
    blocked: () => toast(BREWING_BACK_TEXT, 'warning'),
  };
}

/** 뒤로 버튼 한 번 처리 → 한 일 */
export function handleBackButton(deps: BackDeps): BackAction {
  const action = decideBack(deps.context());
  switch (action) {
    case 'close-dialog':
      deps.closeDialog();
      break;
    case 'history-back':
      deps.historyBack();
      break;
    case 'go-home':
      deps.goHome();
      break;
    case 'minimize':
      deps.minimize();
      break;
    case 'blocked':
      deps.blocked();
      break;
  }
  return action;
}

/** @capacitor/app 모듈 (테스트는 setAppModuleForTest 로 대역) */
let loadAppModule: () => Promise<{ App: unknown }> = () => import('@capacitor/app');

interface AppLike {
  addListener(event: 'backButton', cb: (e: { canGoBack?: boolean }) => void): Promise<unknown>;
  minimizeApp(): Promise<void>;
}

const appPlugin = pluginLoader(
  () => loadAppModule(),
  (m) => m.App as AppLike,
);

let installing: Promise<void> | null = null;

/** APK 시작 때 1번 (capacitor/backends.ts installCapacitorBackends). deps 는 테스트용 */
export function installBackButton(deps?: Partial<BackDeps>): Promise<void> {
  if (!installing) {
    const p = (async () => {
      const { plugin: App } = await appPlugin();
      const minimize = () => {
        App.minimizeApp().catch(() => undefined);
      };
      const all: BackDeps = { ...realDeps(minimize), ...deps };
      // 리스너가 있으면 플러그인은 기본 동작(WebView 뒤로·앱 닫기)을 하지 않고 이 함수만 부름
      await App.addListener('backButton', () => {
        try {
          handleBackButton(all);
        } catch {
          /* 뒤로 버튼 처리 실패로 앱이 멈추지 않게 */
        }
      });
    })();
    installing = p;
    p.catch(() => {
      if (installing === p) installing = null;
    });
  }
  return installing;
}

/** 테스트: @capacitor/app 대역 끼우기 + 설치 기억 지우기 */
export function setAppModuleForTest(load: () => Promise<{ App: unknown }>): void {
  loadAppModule = load;
  appPlugin.reset();
  installing = null;
}
