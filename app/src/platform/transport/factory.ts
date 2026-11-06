/**
 * 통신 방식 선택 (WEBAPP_DESIGN §7) — device/client.ts 가 사용
 *  - 데모 모드      → demo (가상 기기, client.ts 가 저장된 유량표와 함께 직접 만듦)
 *  - Capacitor(APK) → 'native' : capacitor-ble.ts (BleClient)
 *  - Electron(EXE)  → 'web'    : web-ble.ts + 앱 안 기기 선택 창(electron/main.cjs select-bluetooth-device → IPC → platform/electron/BlePickerHost)
 *  - 웹·PWA         → 'web'    : web-ble.ts (Chrome·Edge Web Bluetooth)
 * 플랫폼 작업자는 registerTransportFactory 로 구현을 바꿔 끼울 수 있음 (client.ts 를 고치지 않아도 됨)
 */
import type { Transport, TransportKind } from '@/lib/transport/types';
import { WebBleTransport } from '@/lib/transport/web-ble';

import { isCapacitor, isElectron, type PlatformKind } from '../detect';
import { createCapacitorBleTransport } from './capacitor-ble';

export type DeviceTransportKind = Exclude<TransportKind, 'demo'>;

/** 이 환경에서 실제 기기에 쓸 통신 방식 */
export function platformTransportKind(): DeviceTransportKind {
  return isCapacitor() ? 'native' : 'web';
}

/** 실제 기기 통신 구현 이름 (화면 안내용) */
export function transportImplName(): 'capacitor-ble' | 'electron' | 'web-ble' {
  if (isCapacitor()) return 'capacitor-ble';
  if (isElectron()) return 'electron';
  return 'web-ble';
}

type Factory = () => Transport;

const overrides: Partial<Record<PlatformKind, Factory>> = {};

/** 플랫폼별 Transport 만들기 함수 교체 (예: Electron 에서 기기 선택 창을 붙인 WebBleTransport) */
export function registerTransportFactory(platform: PlatformKind, factory: Factory | null): void {
  if (factory) overrides[platform] = factory;
  else delete overrides[platform];
}

/** 실제 기기용 Transport 생성 (데모 제외) */
export function createDeviceTransport(kind: DeviceTransportKind = platformTransportKind()): Transport {
  if (kind === 'native') return (overrides.capacitor ?? createCapacitorBleTransport)();
  if (isElectron() && overrides.electron) return overrides.electron();
  if (overrides.web) return overrides.web();
  return new WebBleTransport();
}

/**
 * Web Bluetooth 제약 안내 (기기 화면) — WEBAPP_DESIGN §7
 * Chrome·Edge 필요, 아이폰 불가, 연결할 때마다 기기 선택 창, PC 는 블루투스 어댑터 필요, 제조 중 화면 켜 두기
 */
export const WEB_BLE_NOTES: string[] = [
  'Chrome 또는 Edge 브라우저에서만 블루투스 연결이 돼요. (아이폰·사파리는 지원하지 않아요)',
  '연결할 때마다 브라우저의 기기 선택 창에서 SmartBartender 를 골라 주세요.',
  'PC 는 블루투스 어댑터가 있어야 해요.',
  '제조 중에는 화면을 켜 둔 채로 두세요. (앱이 화면 꺼짐을 막아 줘요)',
];
