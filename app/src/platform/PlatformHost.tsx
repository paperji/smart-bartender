/**
 * 플랫폼별 전역 처리 — App.tsx 에 1개 (WEBAPP_DESIGN §7)
 *  - 이 파일을 읽는 순간(첫 화면 그리기 전) bootPlatform(): APK 네이티브 구현 등록·EXE 알림·서비스 워커 정리·"앱 설치" 이벤트
 *  - EXE(Electron): 블루투스 기기 선택 창(BlePickerHost)
 * 웹·APK 에서는 아무것도 그리지 않음.
 */
import { bootPlatform } from './boot';
import { isElectron } from './detect';
import { BlePickerHost } from './electron/BlePickerHost';

bootPlatform();

export function PlatformHost() {
  return isElectron() ? <BlePickerHost /> : null;
}
