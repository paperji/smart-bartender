/**
 * Windows 앱(EXE) 업데이트 구현 — 실제 내려받기·확인·실행은 메인 프로세스(electron/main.cjs · updater.cjs)
 * 화면은 preload 의 window.sbElectron.updateDownload / onUpdateProgress / updateInstall 만 부름
 */
import type { UpdaterBackend } from '@/lib/update';

/** ipcRenderer.invoke 오류의 영어 앞부분("Error invoking remote method 'x': Error: ")을 떼고 한국어 안내만 */
export function ipcErrorText(e: unknown): string {
  const raw = String((e as any)?.message ?? e ?? '');
  return raw.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '').trim();
}

export function createElectronUpdater(bridge = typeof window !== 'undefined' ? window.sbElectron : undefined): UpdaterBackend | null {
  if (!bridge?.updateDownload || !bridge.updateInstall) return null;
  return {
    target: 'exe',
    async download(asset, onProgress) {
      const off = bridge.onUpdateProgress?.((p) => onProgress(Number(p?.loaded) || 0, Number(p?.total) || 0));
      try {
        return await bridge.updateDownload!(asset.url, asset.sha256, asset.name);
      } catch (e) {
        throw new Error(ipcErrorText(e) || '새 버전을 내려받지 못했어요.');
      } finally {
        off?.();
      }
    },
    async install(path) {
      try {
        await bridge.updateInstall!(path);
      } catch (e) {
        throw new Error(ipcErrorText(e) || '새 버전을 실행하지 못했어요.');
      }
    },
  };
}
