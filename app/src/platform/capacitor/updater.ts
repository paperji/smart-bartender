/**
 * APK 앱 업데이트 구현 — 네이티브 플러그인 AppUpdater (android/.../AppUpdaterPlugin.java, MainActivity 에서 등록)
 *  - 내려받기(SHA-256 확인)·설정의 "이 출처 허용" 확인·설정 열기·안드로이드 설치 창 (src/lib/update.ts 가 순서를 정함)
 * 플러그인 Proxy 는 Promise 결과로 돌려주면 안 됨(thenable) → pluginLoader 상자에 담아 꺼내 씀 (plugins.ts 주의 참고)
 */
import type { PluginListenerHandle } from '@capacitor/core';

import type { UpdateAsset, UpdaterBackend } from '@/lib/update';

import { pluginLoader, withTimeout } from './plugins';

export interface AppUpdaterPlugin {
  download(o: { url: string; sha256: string; fileName: string }): Promise<{ path: string }>;
  canInstall(): Promise<{ value: boolean }>;
  openInstallSettings(): Promise<void>;
  install(o: { path: string }): Promise<void>;
  addListener(event: 'progress', cb: (e: { loaded: number; total: number }) => void): Promise<PluginListenerHandle>;
}

let load = pluginLoader(
  () => import('@capacitor/core'),
  (m) => m.registerPlugin<AppUpdaterPlugin>('AppUpdater'),
);

/** 테스트: 플러그인 대역 끼우기 */
export function setAppUpdaterForTest(p: AppUpdaterPlugin | null): void {
  load = p
    ? pluginLoader(
        async () => ({ p }),
        (m) => m.p,
      )
    : pluginLoader(
        () => import('@capacitor/core'),
        (m) => m.registerPlugin<AppUpdaterPlugin>('AppUpdater'),
      );
}

/** 내려받기 시간 제한 — 진행이 이만큼 없으면 실패(느려도 받는 중이면 계속), 전체 상한 */
export const DOWNLOAD_IDLE_MS = 90 * 1000;
export const DOWNLOAD_TOTAL_MS = 30 * 60 * 1000;
let idleMs = DOWNLOAD_IDLE_MS;
let totalMs = DOWNLOAD_TOTAL_MS;
/** 테스트: 시간 제한 줄이기 (인자 없으면 원래대로) */
export function setDownloadTimeoutsForTest(idle = DOWNLOAD_IDLE_MS, total = DOWNLOAD_TOTAL_MS): void {
  idleMs = idle;
  totalMs = total;
}
const TIMEOUT_TEXT = '새 버전을 내려받지 못했어요(시간 초과). 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';

export const capacitorUpdater: UpdaterBackend = {
  target: 'apk',
  async download(asset: UpdateAsset, onProgress) {
    const { plugin: P } = await load();
    let handle: PluginListenerHandle | null = null;
    let idle: ReturnType<typeof setTimeout> | null = null;
    let total: ReturnType<typeof setTimeout> | null = null;
    let fail: ((e: Error) => void) | null = null;
    const arm = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => fail?.(new Error(TIMEOUT_TEXT)), idleMs);
    };
    try {
      handle = await P.addListener('progress', (e) => {
        arm();
        onProgress(Number(e?.loaded) || 0, Number(e?.total) || 0);
      });
    } catch {
      handle = null; // 진행률 없이도 내려받기는 가능 (그때는 전체 상한만)
    }
    try {
      // 네이티브가 응답하지 않아도 화면이 멈추지 않게. 시간 초과 뒤 "다시 시도"하면 네이티브는 받던 것에 이어 붙음(같은 파일)
      const r = await new Promise<{ path: string }>((resolve, reject) => {
        fail = reject;
        if (handle) arm();
        total = setTimeout(() => reject(new Error(TIMEOUT_TEXT)), totalMs);
        P.download({ url: asset.url, sha256: asset.sha256, fileName: asset.name }).then(resolve, reject);
      });
      if (!r || typeof r.path !== 'string' || !r.path) throw new Error('새 버전을 내려받지 못했어요.');
      return r.path;
    } finally {
      fail = null;
      if (idle) clearTimeout(idle);
      if (total) clearTimeout(total);
      handle?.remove().catch(() => undefined);
    }
  },
  async canInstall() {
    const { plugin: P } = await load();
    try {
      const r = await withTimeout(P.canInstall(), 5000, 'canInstall timeout');
      return !!r?.value;
    } catch {
      return true; // 확인할 수 없으면 설치 창에서 안드로이드가 직접 물어봄
    }
  },
  async openInstallSettings() {
    const { plugin: P } = await load();
    await P.openInstallSettings();
  },
  async install(path: string) {
    const { plugin: P } = await load();
    await withTimeout(P.install({ path }), 10000, '설치 창을 열지 못했어요.');
  },
};
