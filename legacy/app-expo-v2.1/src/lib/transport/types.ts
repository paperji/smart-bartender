/**
 * 기기 통신 계층 공통 인터페이스
 * native(안드로이드 BLE) / web(Chrome Web Bluetooth) / demo(가상 기기) 3가지 구현이 같은 모양을 가집니다.
 */

export type TransportKind = 'native' | 'web' | 'demo';

export type LinkState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'disconnected';

export interface FoundDevice {
  id: string;
  name: string;
  rssi?: number;
  /** SmartBartender 로 보이는 기기인지 (이름 접두어 또는 NUS 서비스 광고) */
  likely: boolean;
}

export interface Availability {
  ok: boolean;
  /** 사용 불가 사유 (한국어) */
  reason?: string;
}

export interface StateInfo {
  deviceId?: string;
  deviceName?: string;
  error?: string;
  /** 예상치 못한 끊김인지 (자동 재연결 판단용) */
  unexpected?: boolean;
}

export interface ScanOptions {
  timeoutMs?: number;
  /** true 면 이름 없는/다른 기기도 결과에 포함 */
  includeAll?: boolean;
}

export interface ConnectOptions {
  /**
   * false 면 사용자 화면을 띄우지 않음 (자동 재연결용).
   * 예: 안드로이드에서 블루투스가 꺼져 있으면 "블루투스 켜기" 시스템 창 대신 code 'BT_OFF' 오류를 바로 던짐
   */
  interactive?: boolean;
}

export interface Transport {
  readonly kind: TransportKind;
  /** 이 환경에서 사용 가능한지 (권한 요청 전 단계 확인) */
  availability(): Promise<Availability>;
  /** 주변 기기 검색. 찾을 때마다 onFound 호출, 검색이 끝나면 resolve */
  scan(onFound: (d: FoundDevice) => void, opts?: ScanOptions): Promise<void>;
  stopScan(): Promise<void>;
  connect(id: string, opts?: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  /** JSON 한 줄 전송 ('\n' 은 자동으로 붙음, 180바이트 단위로 분할) */
  write(line: string): Promise<void>;
  /** 완성된 한 줄(JSON 문자열) 수신 콜백. 해제 함수 반환 */
  onLine(cb: (line: string) => void): () => void;
  onState(cb: (state: LinkState, info?: StateInfo) => void): () => void;
  /** (선택) 블루투스 어댑터 켜짐/꺼짐 알림 — 꺼져서 멈춘 자동 재연결을 켜지면 다시 시작하는 데 사용 */
  onAdapter?(cb: (on: boolean) => void): () => void;
  /** 리소스 정리 */
  destroy(): void;
}

/** 간단한 이벤트 허브 */
export class Emitter<T extends unknown[]> {
  private handlers = new Set<(...args: T) => void>();
  on(cb: (...args: T) => void): () => void {
    this.handlers.add(cb);
    return () => {
      this.handlers.delete(cb);
    };
  }
  emit(...args: T) {
    for (const h of Array.from(this.handlers)) {
      try {
        h(...args);
      } catch (e) {
        console.warn('[transport] handler error', e);
      }
    }
  }
  clear() {
    this.handlers.clear();
  }
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
