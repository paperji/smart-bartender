/**
 * 데모 모드 Transport — 가상 기기(VirtualBartender)와 통신
 * 하드웨어 없이도 스캔 → (여러 기기 중) 선택 → 연결 → 제조 전체 흐름을 체험할 수 있습니다.
 * - 가상 기기 2대를 광고(이름·신호세기) → "기기 변경" 기능도 체험 가능
 * - 연결을 끊어도 가상 기기의 작업은 계속 진행 (SPEC §2.4)
 * - 유량표(cal/calSet)는 onCalChange 로 앱에 알려 AsyncStorage 에 저장 → 새로고침 후에도 유지
 */
import { frameLine, LineAssembler } from '../protocol';
import {
  Emitter,
  sleep,
  type Availability,
  type FoundDevice,
  type LinkState,
  type ScanOptions,
  type StateInfo,
  type Transport,
} from './types';
import { VirtualBartender, type VirtualDeviceOptions } from './virtual-device';

export const DEMO_DEVICE_ID = 'demo-device';

export interface DemoDeviceSpec {
  id: string;
  name: string;
  rssi: number;
}

/** 데모 모드에서 "주변에 있는" 가상 기기들 */
export const DEMO_DEVICES: DemoDeviceSpec[] = [
  { id: DEMO_DEVICE_ID, name: 'SmartBartender-DEMO', rssi: -48 },
  { id: 'demo-device-2', name: 'SmartBartender-DEMO2', rssi: -71 },
];

export const isDemoDeviceId = (id: string | null | undefined) => !!id && id.startsWith(DEMO_DEVICE_ID);

/** 가상 기기 1대의 저장된 유량표 */
export interface DemoCalRecord {
  cal: number[];
  calSet: number[];
}

export interface DemoTransportOptions extends Omit<VirtualDeviceOptions, 'onCalChange' | 'name' | 'cal' | 'calSet'> {
  connectDelayMs?: number;
  scanDelayMs?: number;
  /** 광고할 가상 기기 목록 (기본 DEMO_DEVICES) */
  devices?: DemoDeviceSpec[];
  /** 기기 ID → 저장된 유량표 */
  savedCal?: Record<string, DemoCalRecord>;
  /** 가상 기기가 유량표를 "플래시에 저장"할 때 */
  onCalChange?: (deviceId: string, rec: DemoCalRecord) => void;
}

export class DemoTransport implements Transport {
  readonly kind = 'demo' as const;
  private lines = new Emitter<[string]>();
  private states = new Emitter<[LinkState, StateInfo | undefined]>();
  private devices = new Map<string, VirtualBartender>();
  private assembler = new LineAssembler();
  private scanning = false;
  private connected = false;
  private currentId: string | null = null;
  private readonly specs: DemoDeviceSpec[];

  constructor(private readonly opts: DemoTransportOptions = {}) {
    this.specs = opts.devices && opts.devices.length ? opts.devices : DEMO_DEVICES;
  }

  /** 테스트/시연용: 지금 연결된 가상 기기 직접 접근 (물리 버튼 누르기 등) */
  get virtual(): VirtualBartender | null {
    return this.currentId ? (this.devices.get(this.currentId) ?? null) : null;
  }

  /** 테스트용: ID 로 가상 기기 접근 */
  device(id: string): VirtualBartender | null {
    return this.devices.get(id) ?? null;
  }

  async availability(): Promise<Availability> {
    return { ok: true };
  }

  async scan(onFound: (d: FoundDevice) => void, opts?: ScanOptions): Promise<void> {
    this.scanning = true;
    this.states.emit('scanning', undefined);
    const step = this.opts.scanDelayMs ?? 700;
    for (const spec of this.specs) {
      await sleep(step);
      if (!this.scanning) return;
      // 신호세기는 실제처럼 조금씩 흔들림
      const jitter = Math.round((Math.random() - 0.5) * 6);
      onFound({ id: spec.id, name: spec.name, rssi: spec.rssi + jitter, likely: true });
    }
    await sleep(Math.min(opts?.timeoutMs ?? 1500, 1500));
    if (this.scanning) {
      this.scanning = false;
      this.states.emit(this.connected ? 'connected' : 'idle', undefined);
    }
  }

  async stopScan(): Promise<void> {
    if (!this.scanning) return;
    this.scanning = false;
    this.states.emit(this.connected ? 'connected' : 'idle', undefined);
  }

  async connect(id: string): Promise<void> {
    const spec = this.specs.find((s) => s.id === id);
    this.scanning = false;
    if (!spec) {
      this.states.emit('disconnected', { deviceId: id, error: '가상 기기를 찾을 수 없어요', unexpected: false });
      throw new Error('가상 기기를 찾을 수 없어요. 다시 검색해 주세요.');
    }
    if (this.connected && this.currentId && this.currentId !== id) {
      // 다른 기기로 변경: 기존 연결 해제 (기존 가상 기기의 작업은 계속 진행)
      await this.disconnect();
    }
    this.states.emit('connecting', { deviceId: id, deviceName: spec.name });
    await sleep(this.opts.connectDelayMs ?? 600);
    let dev = this.devices.get(id);
    if (!dev) {
      const saved = this.opts.savedCal?.[id];
      dev = new VirtualBartender((line) => this.deliver(id, line), {
        ...this.opts,
        name: spec.name,
        cal: saved?.cal,
        calSet: saved?.calSet,
        onCalChange: (cal, calSet) => this.opts.onCalChange?.(id, { cal, calSet }),
      });
      this.devices.set(id, dev);
    }
    this.assembler.reset();
    this.currentId = id;
    this.connected = true;
    this.states.emit('connected', { deviceId: id, deviceName: dev.name });
  }

  /** 기기 → 앱: 실제 BLE 처럼 20바이트 조각으로 쪼개서 전달 (재조립 로직 검증 겸용) */
  private deliver(id: string, line: string) {
    if (!this.connected || this.currentId !== id) return;
    for (const chunk of frameLine(line, 20)) {
      for (const full of this.assembler.push(chunk)) this.lines.emit(full);
    }
  }

  async disconnect(): Promise<void> {
    // 실제 기기처럼 연결이 끊겨도 가상 기기의 작업은 계속 진행됨(SPEC §2.4)
    const id = this.currentId;
    const was = this.connected;
    this.connected = false;
    this.assembler.reset();
    if (was && id) this.states.emit('disconnected', { deviceId: id, unexpected: false });
  }

  async write(line: string): Promise<void> {
    const dev = this.virtual;
    if (!this.connected || !dev) throw new Error('기기가 연결되어 있지 않아요');
    // 앱 → 기기도 180바이트 청크로 분할해 순서대로 전달
    for (const chunk of frameLine(line)) {
      dev.receiveBytes(chunk);
      await sleep(2);
    }
  }

  onLine(cb: (line: string) => void) {
    return this.lines.on(cb);
  }

  onState(cb: (state: LinkState, info?: StateInfo) => void) {
    return this.states.on(cb);
  }

  destroy() {
    this.connected = false;
    this.scanning = false;
    for (const d of this.devices.values()) d.destroy();
    this.devices.clear();
    this.currentId = null;
    this.lines.clear();
    this.states.clear();
  }
}
