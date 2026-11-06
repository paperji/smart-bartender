/**
 * "앱 설치" (PWA) — 브라우저의 beforeinstallprompt 를 붙잡아 두었다가 버튼으로 설치 창을 띄움
 *  - Chrome·Edge(PC·안드로이드)만 지원. 사파리(아이폰)는 공유 버튼 → "홈 화면에 추가" 를 안내(installHint)
 *  - APK(Capacitor)·EXE(Electron)는 이미 앱이라 canInstall 은 늘 false
 *  - 이벤트를 놓치지 않게 이 파일은 앱 시작 때 읽혀요(platform/boot.ts → initPwaInstall)
 *
 * 화면에서 쓰는 법 (설정·홈 등):
 *   const { canInstall, installed, install } = usePwaInstall();
 *   {canInstall && <Button label="앱 설치" icon={Download} onClick={() => void install()} />}
 *   install() → 'accepted' | 'dismissed' | 'unavailable'
 */
import { useSyncExternalStore } from 'react';

import { isStandalonePwa, isWeb } from './detect';

/** Chrome 의 BeforeInstallPromptEvent (표준 lib 에 없음) */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

export interface PwaInstallState {
  /** 지금 "앱 설치" 버튼을 보여 줄 수 있는지 (브라우저가 설치 가능하다고 알려 준 경우만) */
  canInstall: boolean;
  /** 설치한 앱(독립 창)으로 실행 중이거나 방금 설치함 */
  installed: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;
let justInstalled = false;
let inited = false;
let state: PwaInstallState = { canInstall: false, installed: false };
const listeners = new Set<() => void>();

function recompute() {
  const next: PwaInstallState = {
    canInstall: !!deferred && isWeb() && !justInstalled,
    installed: justInstalled || isStandalonePwa(),
  };
  if (next.canInstall !== state.canInstall || next.installed !== state.installed) {
    state = next;
    for (const l of Array.from(listeners)) l();
  }
}

/** 앱 시작 때 1번 (여러 번 불러도 안전) — 브라우저가 아니면(Node 테스트) 아무것도 안 함 */
export function initPwaInstall(): void {
  if (inited || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  inited = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    // 브라우저 기본 안내(작은 배너) 대신 앱 안 버튼으로 — 주소창의 설치 아이콘·메뉴의 "앱 설치"는 그대로 남음
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    recompute();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    justInstalled = true;
    recompute();
  });
  recompute();
}

export function getPwaInstallState(): PwaInstallState {
  return state;
}

export function subscribePwaInstall(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 설치 창 띄우기 (버튼을 누른 직후에만 동작 — 브라우저 정책). 한 번 쓴 이벤트는 다시 못 씀 */
export async function promptPwaInstall(): Promise<InstallOutcome> {
  const ev = deferred;
  if (!ev) return 'unavailable';
  deferred = null;
  recompute();
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    if (choice.outcome === 'accepted') justInstalled = true;
    recompute();
    return choice.outcome;
  } catch {
    return 'unavailable';
  }
}

/** React: { canInstall, installed, install } */
export function usePwaInstall(): PwaInstallState & { install: () => Promise<InstallOutcome> } {
  const s = useSyncExternalStore(subscribePwaInstall, getPwaInstallState, getPwaInstallState);
  return { ...s, install: promptPwaInstall };
}

/**
 * 설치 버튼을 못 보여 줄 때의 안내 문구 (설정 화면 "앱 설치" 줄의 보조 설명용). 안내할 것이 없으면 null
 *  - APK·EXE: null (이미 앱)
 */
export function installHint(): string | null {
  if (!isWeb()) return null;
  if (state.installed) return '이미 앱으로 설치돼 있어요.';
  if (state.canInstall) return '버튼을 누르면 바탕화면·홈 화면에 앱 아이콘이 생겨요. 인터넷이 없어도 열려요.';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPhone|iPad|iPod/i.test(ua)) return '사파리의 공유 버튼 → "홈 화면에 추가"를 눌러 주세요. (아이폰은 블루투스 연결은 안 돼요)';
  if (/Android/i.test(ua)) return 'Chrome 메뉴(⋮) → "앱 설치" 또는 "홈 화면에 추가"를 눌러 주세요.';
  return 'Chrome·Edge 주소창 오른쪽의 설치 아이콘이나 메뉴(⋮) → "앱 설치"를 눌러 주세요.';
}
