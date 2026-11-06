/**
 * Chrome Web Bluetooth Transport (웹 버전 전용)
 * - 안드로이드 Chrome / PC Chrome·Edge 에서 HTTPS(또는 localhost) 로 열면 실제 기기 제어 가능
 * - 시연·전시에서 APK 설치가 어려울 때의 백업 경로
 * - 브라우저 정책상 기기 선택 창은 "버튼을 누른 직후"에만 열 수 있습니다.
 */
import { DEVICE_NAME_PREFIX, frameLine, LineAssembler, NUS_RX, NUS_SERVICE, NUS_TX, WRITE_CHUNK_BYTES } from '../protocol';
import {
  Emitter,
  type Availability,
  type FoundDevice,
  type LinkState,
  type ScanOptions,
  type StateInfo,
  type Transport,
} from './types';

/* Web Bluetooth 타입은 TS 기본 lib 에 없어서 any 로 다룹니다 */
type BtDevice = any;
type BtCharacteristic = any;

function getBluetooth(): any | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as any).bluetooth ?? null;
}

export class WebBleTransport implements Transport {
  readonly kind = 'web' as const;
  private lines = new Emitter<[string]>();
  private states = new Emitter<[LinkState, StateInfo | undefined]>();
  private assembler = new LineAssembler();
  private devices = new Map<string, BtDevice>();
  private device: BtDevice | null = null;
  private rx: BtCharacteristic | null = null;
  private tx: BtCharacteristic | null = null;
  private connected = false;
  private manual = false;
  private writeChain: Promise<void> = Promise.resolve();

  async availability(): Promise<Availability> {
    const bt = getBluetooth();
    if (!bt) {
      return {
        ok: false,
        reason:
          '이 브라우저는 Web Bluetooth 를 지원하지 않아요. 안드로이드/PC 의 Chrome 또는 Edge 에서 열어 주세요. (아이폰 Safari 는 미지원)',
      };
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return { ok: false, reason: '웹 블루투스는 HTTPS 주소(또는 localhost)에서만 동작해요.' };
    }
    try {
      if (typeof bt.getAvailability === 'function') {
        const has = await bt.getAvailability();
        if (!has) return { ok: false, reason: '블루투스 어댑터를 찾을 수 없거나 꺼져 있어요.' };
      }
    } catch {
      /* 일부 브라우저는 getAvailability 미구현 */
    }
    return { ok: true };
  }

  /** 웹에서는 브라우저의 기기 선택 창이 "검색" 역할을 합니다 */
  async scan(onFound: (d: FoundDevice) => void, opts?: ScanOptions): Promise<void> {
    const bt = getBluetooth();
    if (!bt) throw new Error('Web Bluetooth 미지원 브라우저입니다');
    this.states.emit('scanning', undefined);
    try {
      const device: BtDevice = await bt.requestDevice(
        opts?.includeAll
          ? { acceptAllDevices: true, optionalServices: [NUS_SERVICE] }
          : {
              filters: [{ namePrefix: DEVICE_NAME_PREFIX }, { services: [NUS_SERVICE] }],
              optionalServices: [NUS_SERVICE],
            },
      );
      this.devices.set(device.id, device);
      onFound({ id: device.id, name: device.name || 'SmartBartender', likely: true });
    } catch (e: any) {
      // 사용자가 선택 창을 닫으면 NotFoundError → 조용히 종료
      if (e?.name !== 'NotFoundError') {
        this.states.emit(this.connected ? 'connected' : 'idle', undefined);
        throw new Error('기기 선택 창을 열지 못했어요: ' + (e?.message ?? String(e)));
      }
    }
    this.states.emit(this.connected ? 'connected' : 'idle', undefined);
  }

  async stopScan(): Promise<void> {}

  private onValue = (event: any) => {
    const dv: DataView = event?.target?.value;
    if (!dv) return;
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    for (const line of this.assembler.push(bytes)) this.lines.emit(line);
  };

  private onGattDisconnected = () => {
    const was = this.connected;
    this.connected = false;
    this.rx = null;
    this.tx = null;
    this.assembler.reset();
    if (was || !this.manual) {
      this.states.emit('disconnected', {
        deviceId: this.device?.id,
        deviceName: this.device?.name,
        unexpected: !this.manual,
      });
    }
  };

  async connect(id: string): Promise<void> {
    let device = this.devices.get(id);
    const bt = getBluetooth();
    if (!device && bt && typeof bt.getDevices === 'function') {
      try {
        const list: BtDevice[] = await bt.getDevices();
        device = list.find((d) => d.id === id);
        if (device) this.devices.set(id, device);
      } catch {
        /* ignore */
      }
    }
    if (!device) throw new Error('웹에서는 먼저 "기기 선택"으로 기기를 골라 주세요.');
    if (this.device && this.device !== device) await this.disconnect();
    this.device = device;
    this.manual = false;
    this.assembler.reset();
    this.states.emit('connecting', { deviceId: id, deviceName: device.name });
    try {
      device.removeEventListener?.('gattserverdisconnected', this.onGattDisconnected);
      device.addEventListener('gattserverdisconnected', this.onGattDisconnected);
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(NUS_SERVICE);
      this.rx = await service.getCharacteristic(NUS_RX);
      this.tx = await service.getCharacteristic(NUS_TX);
      this.tx.removeEventListener?.('characteristicvaluechanged', this.onValue);
      this.tx.addEventListener('characteristicvaluechanged', this.onValue);
      await this.tx.startNotifications();
      this.connected = true;
      this.states.emit('connected', { deviceId: id, deviceName: device.name || 'SmartBartender' });
    } catch (e: any) {
      this.connected = false;
      this.manual = true;
      try {
        device.gatt?.disconnect();
      } catch {
        /* ignore */
      }
      const msg = e?.message ?? String(e);
      this.states.emit('disconnected', { deviceId: id, error: msg, unexpected: false });
      throw new Error('연결 실패: ' + msg);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.device) return;
    this.manual = true;
    const was = this.connected;
    this.connected = false;
    try {
      this.device.gatt?.disconnect();
    } catch {
      /* ignore */
    }
    this.assembler.reset();
    if (was) this.states.emit('disconnected', { deviceId: this.device.id, unexpected: false });
  }

  write(line: string): Promise<void> {
    const run = async () => {
      if (!this.connected || !this.rx) throw new Error('기기가 연결되어 있지 않아요');
      for (const chunk of frameLine(line, WRITE_CHUNK_BYTES)) {
        if (typeof this.rx.writeValueWithResponse === 'function') await this.rx.writeValueWithResponse(chunk);
        else await this.rx.writeValue(chunk);
      }
    };
    const p = this.writeChain.then(run, run);
    this.writeChain = p.catch(() => undefined);
    return p;
  }

  onLine(cb: (line: string) => void) {
    return this.lines.on(cb);
  }

  onState(cb: (state: LinkState, info?: StateInfo) => void) {
    return this.states.on(cb);
  }

  destroy() {
    this.disconnect().catch(() => undefined);
    this.lines.clear();
    this.states.clear();
  }
}
