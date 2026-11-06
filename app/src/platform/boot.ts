/**
 * 플랫폼 시작 처리 — 앱이 그려지기 전에 1번 (platform/PlatformHost.tsx 를 읽을 때 실행)
 *  - APK(Capacitor): 키 저장·알림·진동을 네이티브 플러그인으로 교체 + 안드로이드 뒤로 버튼 처리 (capacitor/backends.ts·backButton.ts)
 *  - EXE(Electron): 제조 알림을 메인 프로세스 Windows 알림 + 작업 표시줄 깜빡임으로
 *  - APK·EXE: 서비스 워커를 쓰지 않음 — 혹시 남아 있는 등록·캐시는 지워서 예전 화면이 보이지 않게
 *    (등록 자체는 main.tsx 가 canRegisterServiceWorker() 로 웹에서만 함)
 *  - 웹: "앱 설치"(beforeinstallprompt) 이벤트 붙잡기 (install.ts)
 */
import { installCapacitorBackends } from './capacitor/backends';
import { isCapacitor, isElectron, isWeb } from './detect';
import { initPwaInstall } from './install';
import { registerNotifyBackend, type NotifyBackend } from './notify';

let booted = false;

const electronNotifyBackend: NotifyBackend = {
  async permission() {
    return 'granted';
  },
  async requestPermission() {
    return true;
  },
  async show(_kind, title, body) {
    const n = window.sbElectron?.notify;
    if (typeof n !== 'function') return false;
    try {
      return !!(await n(title, body));
    } catch {
      return false;
    }
  },
};

/** 웹이 아닌 곳(APK·EXE)에 남은 서비스 워커·캐시 정리 */
async function removeServiceWorkers(): Promise<void> {
  try {
    const sw: ServiceWorkerContainer | undefined = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (sw && typeof sw.getRegistrations === 'function') {
      const regs = await sw.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => /workbox|precache/i.test(k)).map((k) => caches.delete(k)));
    }
  } catch {
    /* 지원 안 함 */
  }
}

export function bootPlatform(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  if (isCapacitor()) installCapacitorBackends();
  else if (isElectron() && typeof window.sbElectron?.notify === 'function') registerNotifyBackend(electronNotifyBackend);
  if (!isWeb()) void removeServiceWorkers();
  initPwaInstall();
}
