/**
 * 웹 번들용 대체 파일 — 네이티브 BLE 모듈(react-native-ble-manager)이
 * 웹 번들에 포함되지 않도록 플랫폼 확장자로 분리했습니다.
 * (안드로이드/iOS 에서는 native-ble.native.ts 가 사용됩니다)
 */
import {
  Emitter,
  type Availability,
  type FoundDevice,
  type LinkState,
  type StateInfo,
  type Transport,
} from './types';

class UnsupportedTransport implements Transport {
  readonly kind = 'native' as const;
  private states = new Emitter<[LinkState, StateInfo | undefined]>();
  private lines = new Emitter<[string]>();
  async availability(): Promise<Availability> {
    return { ok: false, reason: '이 환경에서는 네이티브 블루투스를 사용할 수 없어요.' };
  }
  async scan(_onFound: (d: FoundDevice) => void): Promise<void> {
    throw new Error('지원되지 않는 환경입니다');
  }
  async stopScan() {}
  async connect(): Promise<void> {
    throw new Error('지원되지 않는 환경입니다');
  }
  async disconnect() {}
  async write(): Promise<void> {
    throw new Error('지원되지 않는 환경입니다');
  }
  onLine(cb: (line: string) => void) {
    return this.lines.on(cb);
  }
  onState(cb: (state: LinkState, info?: StateInfo) => void) {
    return this.states.on(cb);
  }
  destroy() {}
}

export function createNativeTransport(): Transport {
  return new UnsupportedTransport();
}
