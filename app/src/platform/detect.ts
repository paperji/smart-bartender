/**
 * 실행 환경 판별 (WEBAPP_DESIGN §7)
 *  - capacitor : 안드로이드 APK (window.Capacitor.isNativePlatform())
 *  - electron  : Windows EXE (preload 가 넣는 window.sbElectron)
 *  - web       : 그 밖 (PC·안드로이드 브라우저, 설치한 PWA)
 * Node(테스트)에서는 window 가 없으므로 web 으로 봅니다.
 */

/** Electron 이 찾은 블루투스 기기 (메인 프로세스 select-bluetooth-device 의 목록) */
export interface ElectronBleDevice {
  deviceId: string;
  deviceName: string;
}

/** Electron preload(electron/preload.cjs)가 contextBridge 로 넣는 객체 (window.sbElectron) */
export interface SbElectronBridge {
  isElectron: true;
  /** 앱 버전 (package.json version) */
  version?: string;
  /** 'win32' 등 */
  platform?: string;
  /**
   * Web Bluetooth 기기 선택: requestDevice() 중 기기 목록이 바뀔 때마다(처음엔 빈 목록일 수 있음) 호출. 해제 함수 반환.
   * 앱 안 선택 창(platform/electron/BlePickerHost)이 사용
   */
  onBleDevices?: (cb: (list: ElectronBleDevice[]) => void) => () => void;
  /** 선택 요청이 끝남(골랐거나 취소·창 새로고침) — 선택 창 닫기용. 해제 함수 반환 */
  onBleRequestEnd?: (cb: () => void) => () => void;
  /** 이 기기로 연결 */
  chooseBleDevice?: (deviceId: string) => void;
  /** 선택 취소 → requestDevice 가 NotFoundError 로 끝남 */
  cancelBle?: () => void;
  /** Windows 알림(메인 프로세스) + 작업 표시줄 깜빡임. 알림을 띄웠으면 true */
  notify?: (title: string, body: string) => Promise<boolean>;
  [key: string]: unknown;
}

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    sbElectron?: SbElectronBridge;
  }
}

export type PlatformKind = 'capacitor' | 'electron' | 'web';

function win(): Window | null {
  return typeof window !== 'undefined' ? window : null;
}

export function isCapacitor(): boolean {
  const w = win();
  try {
    return !!w?.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

export function isElectron(): boolean {
  const w = win();
  return !!w && typeof w.sbElectron === 'object' && w.sbElectron !== null;
}

export function isWeb(): boolean {
  return !isCapacitor() && !isElectron();
}

export function platformKind(): PlatformKind {
  if (isCapacitor()) return 'capacitor';
  if (isElectron()) return 'electron';
  return 'web';
}

/** 사용자에게 보이는 이름 */
export const PLATFORM_LABEL: Record<PlatformKind, string> = {
  capacitor: '안드로이드 앱(APK)',
  electron: 'Windows 앱(EXE)',
  web: '웹 브라우저',
};

/** 설치한 PWA(독립 창)로 실행 중인지 */
export function isStandalonePwa(): boolean {
  const w = win();
  if (!w) return false;
  try {
    return w.matchMedia?.('(display-mode: standalone)').matches === true || (w.navigator as any)?.standalone === true;
  } catch {
    return false;
  }
}

/** 서비스 워커(오프라인 실행)를 등록해도 되는 환경 — 웹(https·localhost)만. file://·APK·EXE 는 등록하지 않음 */
export function canRegisterServiceWorker(): boolean {
  const w = win();
  if (!w || !isWeb()) return false;
  return /^https?:$/.test(w.location?.protocol ?? '') && 'serviceWorker' in w.navigator;
}
