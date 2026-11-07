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

/**
 * Windows 앱(EXE, Electron) 기기 선택 창과 주고받는 화면 안 이벤트 (platform/electron/BlePickerHost.tsx)
 *  - BLE_SCAN_EVENT {phase:'start'|'end'}: 검색(requestDevice) 시작·끝 → 선택 창을 바로 열고("찾는 중", 취소 버튼) 끝나면 닫음
 *  - BLE_SCAN_CANCEL_EVENT: 선택 창의 "취소" → 기기를 하나도 못 찾아 Electron 이 아무 응답을 안 줘도 검색을 바로 끝냄
 */
export const BLE_SCAN_EVENT = 'sb-ble-scan';
export const BLE_SCAN_CANCEL_EVENT = 'sb-ble-scan-cancel';
export type BleScanPhase = 'start' | 'end';

/** Electron 이 기기를 하나도 못 찾았거나(광고 안 함) PC 블루투스가 꺼져 있을 때의 안내 */
export const ELECTRON_NOT_FOUND_MESSAGE =
  '기기를 찾지 못했어요. PC 의 블루투스가 켜져 있는지, 칵테일 메이커 전원이 켜져 있는지 확인해 주세요. 다른 휴대폰·PC 에 이미 연결돼 있으면 그쪽 연결을 먼저 끊어 주세요.';
/** 목록을 보여 준 뒤 사용자가 고르기 전에 Electron 이 검색을 끝냄(검색 중 PC 블루투스가 꺼짐 등) */
export const ELECTRON_SCAN_LOST_MESSAGE =
  '기기 검색이 중간에 끝났어요. PC 의 블루투스가 켜져 있는지 확인하고 다시 "기기 선택"을 눌러 주세요.';

/** gatt.connect() 이 연결 단계에서 바로 실패하면 다시 시도하는 횟수 (처음 1번 포함) — capacitor-ble.ts CONNECT_ATTEMPTS 와 같은 이유 */
export const WEB_CONNECT_ATTEMPTS = 4;
export const WEB_CONNECT_RETRY_DELAY_MS = 400;

/**
 * 안드로이드 Chrome 은 기기가 첫 연결 패킷을 놓치면(HCI 0x3E, 안드로이드 GATT 133) 'NetworkError: Connection attempt failed.' 로
 * 바로 실패함 → 잠시 뒤 다시 시도. 사용자가 그사이 연결을 끊었으면(cancelled) 그만둠. 테스트용 export
 */
export async function gattConnectWithRetry(device: any, cancelled: () => boolean = () => false): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await device.gatt.connect();
    } catch (e: any) {
      // Chrome·Electron 은 연결 실패를 DOMException 'NetworkError' 로 줌 (권한·보안 오류 등 다른 이름은 다시 해도 같음)
      const retryable = e?.name === 'NetworkError';
      if (attempt >= WEB_CONNECT_ATTEMPTS || !retryable || cancelled()) throw e;
      // 실패한 연결은 정리할 것이 없음 — disconnect() 를 부르면 'gattserverdisconnected' 가 와서 재연결 흐름과 겹칠 수 있어 부르지 않음
      await new Promise((r) => setTimeout(r, WEB_CONNECT_RETRY_DELAY_MS));
      if (cancelled()) throw e;
    }
  }
}

function electronBridge() {
  return typeof window !== 'undefined' ? window.sbElectron : undefined;
}

function emitScanPhase(phase: BleScanPhase) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent<{ phase: BleScanPhase }>(BLE_SCAN_EVENT, { detail: { phase } }));
  } catch {
    /* CustomEvent 미지원 환경 */
  }
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
  /** 진행 중인 검색을 끝내는 함수 (stopScan·선택 창의 취소) */
  private endScan: (() => void) | null = null;
  /** 진행 중인 검색이 완전히 끝나면(정리까지) 풀리는 약속 */
  private scanDone: Promise<void> | null = null;

  async availability(): Promise<Availability> {
    // 보안 주소(https·localhost)가 아니면 Chrome·Edge 도 navigator.bluetooth 자체를 숨김 → 브라우저 탓이 아니라 주소 탓임을 먼저 안내 (DEV-4)
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return { ok: false, reason: '웹 블루투스는 HTTPS 주소(또는 localhost)에서만 동작해요. https:// 로 시작하는 주소로 열어 주세요.' };
    }
    const bt = getBluetooth();
    if (!bt) {
      return {
        ok: false,
        reason:
          '이 브라우저는 Web Bluetooth 를 지원하지 않아요. 안드로이드/PC 의 Chrome 또는 Edge 에서 열어 주세요. (아이폰 Safari 는 미지원)',
      };
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

  /**
   * 웹에서는 브라우저의 기기 선택 창이 "검색" 역할을 합니다.
   * Windows 앱(EXE)은 Electron 에 선택 창이 없어 앱 안 선택 창(BlePickerHost)을 씀. 이때 Electron 은 기기를 하나라도
   * 찾아야 알려 주므로(못 찾으면 몇 분 동안 아무 응답 없음), 검색 시작과 함께 선택 창을 열고 "취소"·"검색 중지"로
   * 바로 끝낼 수 있게 함. 기기 목록을 한 번도 못 받은 채 끝나면(못 찾음·PC 블루투스 꺼짐) 안내 오류를 냄.
   */
  async scan(onFound: (d: FoundDevice) => void, opts?: ScanOptions): Promise<void> {
    const bt = getBluetooth();
    if (!bt) throw new Error('Web Bluetooth 미지원 브라우저입니다');
    // 앞 검색이 남아 있으면 끝내고 정리까지 기다림 (앞 검색의 '끝' 알림이 새 선택 창을 닫지 않게)
    if (this.endScan) {
      this.endScan();
      await this.scanDone?.catch(() => undefined);
    }
    let markDone!: () => void;
    this.scanDone = new Promise<void>((r) => {
      markDone = r;
    });
    const electron = electronBridge();
    let userCancelled = false;
    let sawList = false;
    let resolveEnd!: () => void;
    const ended = new Promise<'ended'>((r) => {
      resolveEnd = () => r('ended');
    });
    const end = () => {
      userCancelled = true;
      resolveEnd();
    };
    this.endScan = end;
    const offList = electron?.onBleDevices?.(() => {
      sawList = true;
    });
    // 선택 창의 "취소" (선택 창이 cancelBle 을 이미 불렀음)
    const onCancel = () => end();
    if (electron && typeof window !== 'undefined') window.addEventListener(BLE_SCAN_CANCEL_EVENT, onCancel);
    this.states.emit('scanning', undefined);
    try {
      electron?.bleRequestStart?.();
      if (electron) emitScanPhase('start');
      const req: Promise<BtDevice> = bt.requestDevice(
        opts?.includeAll
          ? { acceptAllDevices: true, optionalServices: [NUS_SERVICE] }
          : {
              filters: [{ namePrefix: DEVICE_NAME_PREFIX }, { services: [NUS_SERVICE] }],
              optionalServices: [NUS_SERVICE],
            },
      );
      req.catch(() => undefined); // 검색을 먼저 끝낸 뒤 늦게 거부돼도 "처리 안 된 거부"가 되지 않게
      const r = await Promise.race([req, ended]);
      if (r !== 'ended') {
        const device: BtDevice = r;
        this.devices.set(device.id, device);
        onFound({ id: device.id, name: device.name || 'SmartBartender', likely: true });
      }
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        this.states.emit(this.connected ? 'connected' : 'idle', undefined);
        throw new Error('기기 선택 창을 열지 못했어요: ' + (e?.message ?? String(e)));
      }
      // 웹: 사용자가 브라우저 선택 창을 닫으면 NotFoundError → 조용히 종료 (못 찾음·블루투스 꺼짐은 브라우저 창이 직접 안내).
      // EXE: 사용자가 닫는 길(취소·Esc·X·검색 중지)은 모두 end() 로 먼저 끝나므로 여기 온 NotFoundError 는 Electron 이 스스로
      // 끝낸 것(못 찾음·PC 블루투스 꺼짐·권한 없음) → 안내
      if (electron && !userCancelled) {
        this.states.emit(this.connected ? 'connected' : 'idle', undefined);
        throw new Error(sawList ? ELECTRON_SCAN_LOST_MESSAGE : ELECTRON_NOT_FOUND_MESSAGE);
      }
    } finally {
      offList?.();
      if (electron && typeof window !== 'undefined') window.removeEventListener(BLE_SCAN_CANCEL_EVENT, onCancel);
      if (this.endScan === end) this.endScan = null;
      if (electron) emitScanPhase('end');
      markDone();
    }
    this.states.emit(this.connected ? 'connected' : 'idle', undefined);
  }

  /** 검색 중지: 진행 중인 기기 선택을 끝냄 (EXE 는 앱 안 선택 창도 닫힘) */
  async stopScan(): Promise<void> {
    const end = this.endScan;
    if (!end) return;
    electronBridge()?.cancelBle?.();
    end();
  }

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
      const server = await gattConnectWithRetry(device, () => this.manual);
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
