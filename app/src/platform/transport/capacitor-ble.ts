/**
 * 안드로이드 APK(Capacitor) 네이티브 BLE Transport — @capacitor-community/bluetooth-le 의 BleClient (WEBAPP_DESIGN §7)
 * v2.1 의 native-ble.native.ts(react-native-ble-manager)와 같은 동작을 Capacitor 로 옮김:
 *  - 권한: BleClient.initialize({ androidNeverForLocation: true }) — 안드로이드 12+ 는 "근처 기기"(BLUETOOTH_SCAN·CONNECT)만,
 *    11 이하는 위치 권한(OS 가 BLE 검색에 요구). 위치 서비스(GPS)가 꺼져 있으면 11 이하에서는 검색 결과가 비므로 안내
 *  - 검색: requestLEScan(빠른 검색 모드) — SPEC §2 대로 "이름 접두어(SmartBartender) 또는 NUS 서비스 UUID" 로 거름(likely).
 *    includeAll 이면 다른 기기도 함께 보여 줌. 같은 기기는 이름이 바뀌었을 때·1초마다만 다시 알림
 *  - 연결: connect(onDisconnect) → (플러그인이 안드로이드에서 MTU 512 를 자동 요청) getMtu 로 쓰기 조각 = min(180, MTU-3)
 *    → NUS 서비스 확인 → TX 알림 구독(먼저) → 연결 속도 높이기 요청 → 'connected'
 *  - 수신: TX 알림 바이트를 LineAssembler 로 '\n' 단위 줄로 (web-ble.ts 와 같음)
 *  - 쓰기: frameLine(줄 + '\n') 을 위 크기로 나눠 응답 있는 쓰기, 순서 보장(체인)
 *  - 끊김: 예상 못 한 끊김은 unexpected: true (device/client.ts 가 자동 재연결). 블루투스를 끄면 어댑터 알림과 끊김 알림이
 *    둘 다 오므로 끊김은 1번만 보고
 *  - 자동 재연결(connect interactive:false)에서는 "블루투스 켜기" 시스템 창을 띄우지 않고 code 'BT_OFF' 오류를 바로 던짐.
 *    어댑터가 다시 켜지면 onAdapter(true)
 * 플러그인은 처음 쓸 때 동적 import 로 불러와요 → 웹·EXE 빌드와 테스트(Node)에서는 아예 읽지 않음.
 */
import type { BleClientInterface, ScanResult } from '@capacitor-community/bluetooth-le';

import { DEVICE_NAME_PREFIX, frameLine, LineAssembler, NUS_RX, NUS_SERVICE, NUS_TX, WRITE_CHUNK_BYTES } from '@/lib/protocol';
import {
  Emitter,
  type Availability,
  type ConnectOptions,
  type FoundDevice,
  type LinkState,
  type ScanOptions,
  type StateInfo,
  type Transport,
} from '@/lib/transport/types';

import { isCapacitor } from '../detect';

export const CAPACITOR_BLE_UNAVAILABLE = '안드로이드 앱(APK 빌드)에서만 쓸 수 있는 블루투스 방식이에요.';

type BleModule = typeof import('@capacitor-community/bluetooth-le');

let modPromise: Promise<BleModule> | null = null;
function loadBle(): Promise<BleModule> {
  if (!modPromise) {
    modPromise = import('@capacitor-community/bluetooth-le').catch((e) => {
      modPromise = null;
      throw e;
    });
  }
  return modPromise;
}

const uuidEq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** 블루투스가 꺼져 있음 — 자동 재연결은 이 code 를 보고 재시도를 멈춤 */
function btOffError(): Error {
  return Object.assign(new Error('블루투스가 꺼져 있어요. 블루투스를 켜면 다시 연결할게요.'), { code: 'BT_OFF' });
}

function errText(e: unknown): string {
  if (!e) return '알 수 없는 오류';
  if (typeof e === 'string') return e;
  const anyE = e as any;
  return String(anyE.message ?? anyE.errorMessage ?? anyE.error ?? JSON.stringify(anyE));
}

export const CONNECT_TIMEOUT_TEXT = '연결 시간이 초과됐어요 (기기 전원과 거리를 확인하세요)';
export const CONNECT_FAILED_TEXT = '기기에 연결하지 못했어요 (기기 전원과 거리를 확인한 뒤 다시 시도하세요)';

/**
 * 연결 실패 문구를 쉬운 한국어로 (DEV-2). 플러그인(@capacitor-community/bluetooth-le)의 영어 오류가 그대로 보이지 않게:
 *  - 'Connection timeout.' (플러그인 연결 시간 제한 — 앱 제한보다 먼저 끝남) → 연결 시간 초과 안내
 *  - 'Connection failed with status 133' 등 GATT 연결 실패, 'Disconnected'·'Device not connected' → 연결하지 못함 안내
 *  - 이미 한국어인 앱 문구(서비스 없음·알림 구독 실패 등)와 그 밖의 오류는 그대로
 * 테스트용 export
 */
export function connectErrorText(raw: string): string {
  if (/[가-힣]/.test(raw)) return raw;
  if (/time(d)?\s*out/i.test(raw)) return CONNECT_TIMEOUT_TEXT;
  if (/connection failed|failed to connect|gatt|status\s*\d+|disconnected|not connected/i.test(raw)) return CONNECT_FAILED_TEXT;
  return raw;
}

/**
 * 연결 요청이 첫 단계에서 바로 실패했을 때 다시 시도하는 횟수 (처음 1번 포함).
 * 실제 기기 시험(2026-11-07, 갤럭시 S20 Ultra ↔ ESP32): 연결 요청을 보내도 기기가 첫 연결 패킷을 놓쳐
 * 0.3초 만에 "Connection failed to be established"(HCI 0x3E) → 플러그인 'Connection failed with status 133' 이 종종 남.
 * 바로 다시 연결하면 대부분 됨. 첫 시도 연결 비율: 펌웨어 2.1.1(이중 모드) 14번 중 7번, 2.1.2(BLE 전용) 26번 중 22번 —
 * 같은 펌웨어도 시험할 때마다 달라 휴대폰 쪽 무선 상황(Wi-Fi·워치 연결 등) 영향이 큼. 4번이면 첫 시도 50% 여도 약 94%
 */
export const CONNECT_ATTEMPTS = 4;
/** 다시 시도하기 전 쉬는 시간 (앞 연결 정리) */
export const CONNECT_RETRY_DELAY_MS = 400;

/**
 * 다시 시도할 만한 연결 실패인지: GATT 133 등 연결 단계 실패만. 시간 초과(15초 — 전원·거리 문제라 다시 해도 같음)·
 * 권한·블루투스 꺼짐·서비스 없음 같은 앱 문구(한국어)는 다시 시도하지 않음. 테스트용 export
 */
export function isRetryableConnectError(raw: string): boolean {
  if (/[가-힣]/.test(raw)) return false;
  if (/time(d)?\s*out/i.test(raw)) return false;
  return /status\s*133|connection failed|failed to connect|gatt[_ ]?error|not connected|disconnected/i.test(raw);
}

/** 안드로이드 버전(API 레벨이 아니라 사용자 버전 숫자, 예 14) — 알 수 없으면 null */
export function androidMajorVersion(ua: string | undefined = typeof navigator !== 'undefined' ? navigator.userAgent : undefined): number | null {
  const m = /Android (\d+)/i.exec(ua ?? '');
  return m ? parseInt(m[1], 10) : null;
}

/** 안드로이드 11 이하(API 30 이하) — BLE 검색에 위치 권한·위치 서비스가 필요한 버전 */
function needsLocationForBle(): boolean {
  const v = androidMajorVersion();
  return v !== null && v <= 11;
}

function permissionMessage(): string {
  return needsLocationForBle()
    ? '안드로이드 11 이하에서는 블루투스 검색에 위치 권한이 필요해요. 권한을 허용해 주세요.'
    : '"근처 기기" 권한이 필요해요. 휴대폰 설정 > 애플리케이션 > AI 스마트 바텐더 > 권한에서 허용해 주세요.';
}

/** 검색 결과 → FoundDevice (이름 접두어 또는 NUS 광고면 likely) — 테스트용 export */
export function toFoundDevice(r: Pick<ScanResult, 'device' | 'localName' | 'rssi' | 'uuids'>): FoundDevice {
  const name = r.localName || r.device?.name || '';
  const likely = name.startsWith(DEVICE_NAME_PREFIX) || (r.uuids ?? []).some((u) => uuidEq(u, NUS_SERVICE));
  return { id: r.device.deviceId, name: name || '(이름 없음)', rssi: r.rssi, likely };
}

export class CapacitorBleTransport implements Transport {
  readonly kind = 'native' as const;
  private lines = new Emitter<[string]>();
  private states = new Emitter<[LinkState, StateInfo | undefined]>();
  private adapter = new Emitter<[boolean]>();
  private assembler = new LineAssembler();
  private initialized = false;
  private enabledWatch = false;
  private deviceId: string | null = null;
  private deviceName = '';
  private connected = false;
  /** connect() 진행 중 — 이때 오는 끊김 콜백은 connect 의 실패로 처리 (중복 보고·자동 재연결 방지) */
  private connecting = false;
  private manualDisconnect = false;
  /** 블루투스 꺼짐으로 이미 끊김을 보고함 → 뒤따르는 끊김 콜백은 보고하지 않음 (connect 때 초기화) */
  private linkLostReported = false;
  private chunkSize = 20;
  private writeChain: Promise<void> = Promise.resolve();
  private scanResolve: (() => void) | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private names = new Map<string, string>();

  async availability(): Promise<Availability> {
    if (!isCapacitor()) return { ok: false, reason: CAPACITOR_BLE_UNAVAILABLE };
    try {
      await loadBle();
    } catch (e) {
      return { ok: false, reason: `블루투스 모듈을 불러오지 못했어요 (${errText(e)}). 데모 모드를 사용해 주세요.` };
    }
    // 권한 요청·블루투스 켜기는 검색/연결할 때 (앱을 열자마자 권한 창을 띄우지 않게 — v2.1 과 같음)
    return { ok: true };
  }

  private async ble(): Promise<BleClientInterface> {
    if (!isCapacitor()) throw new Error(CAPACITOR_BLE_UNAVAILABLE);
    return (await loadBle()).BleClient;
  }

  /** 권한 요청 + 블루투스 준비. interactive=false(자동 재연결)면 블루투스 켜기 창을 띄우지 않고 BT_OFF 오류 */
  private async ensureReady(interactive = true, forScan = false): Promise<BleClientInterface> {
    const ble = await this.ble();
    if (!this.initialized) {
      try {
        await ble.initialize({ androidNeverForLocation: true });
      } catch (e) {
        const msg = errText(e);
        if (/permission/i.test(msg)) throw new Error(permissionMessage());
        if (/not (available|supported)|unsupported/i.test(msg)) throw new Error('이 휴대폰은 블루투스 저전력(BLE)을 지원하지 않아요.');
        throw new Error('블루투스를 준비하지 못했어요: ' + msg);
      }
      this.initialized = true;
    }
    if (!this.enabledWatch) {
      try {
        await ble.startEnabledNotifications((on) => this.onEnabledChange(on));
        this.enabledWatch = true;
      } catch {
        /* 어댑터 알림을 못 받아도 연결은 가능 */
      }
    }
    let on = false;
    try {
      on = await ble.isEnabled();
    } catch {
      on = false;
    }
    if (!on) {
      if (!interactive) throw btOffError();
      try {
        await ble.requestEnable();
        on = await ble.isEnabled();
      } catch {
        on = false;
      }
      if (!on) throw new Error('블루투스가 꺼져 있어요. 블루투스를 켠 뒤 다시 시도하세요.');
    }
    if (forScan && needsLocationForBle()) {
      try {
        if (!(await ble.isLocationEnabled())) {
          throw new Error('안드로이드 11 이하에서는 블루투스 검색에 위치(GPS)를 켜야 해요. 빠른 설정에서 위치를 켠 뒤 다시 검색해 주세요.');
        }
      } catch (e: any) {
        if (e instanceof Error && e.message.startsWith('안드로이드')) throw e;
      }
    }
    return ble;
  }

  private onEnabledChange(on: boolean) {
    if (!on && this.connected) {
      this.connected = false;
      this.linkLostReported = true;
      this.assembler.reset();
      this.states.emit('disconnected', {
        deviceId: this.deviceId ?? undefined,
        deviceName: this.deviceName,
        error: '블루투스가 꺼졌어요',
        unexpected: true,
      });
    }
    this.adapter.emit(on);
  }

  private finishScan() {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    const r = this.scanResolve;
    this.scanResolve = null;
    if (r) {
      this.states.emit(this.connected ? 'connected' : 'idle', undefined);
      r();
    }
  }

  async scan(onFound: (d: FoundDevice) => void, opts?: ScanOptions): Promise<void> {
    const ble = await this.ensureReady(true, true);
    if (this.scanResolve) await this.stopScan();
    const timeoutMs = opts?.timeoutMs ?? 8000;
    const includeAll = !!opts?.includeAll;
    const { ScanMode } = await loadBle();
    const last = new Map<string, { at: number; name: string; likely: boolean }>();
    const done = new Promise<void>((resolve) => {
      this.scanResolve = resolve;
    });
    this.states.emit('scanning', undefined);
    try {
      // 같은 기기의 광고를 계속 받아(allowDuplicates) 이름이 늦게 오는 경우(스캔 응답)도 놓치지 않게 — 알림은 아래에서 줄임
      await ble.requestLEScan({ allowDuplicates: true, scanMode: ScanMode.SCAN_MODE_LOW_LATENCY }, (r) => {
        if (!this.scanResolve) return;
        const d = toFoundDevice(r);
        if (!d.likely && !includeAll) return;
        const now = Date.now();
        const prev = last.get(d.id);
        if (prev && prev.name === d.name && prev.likely === d.likely && now - prev.at < 1000) return;
        last.set(d.id, { at: now, name: d.name, likely: d.likely });
        if (d.name !== '(이름 없음)') this.names.set(d.id, d.name);
        onFound(d);
      });
    } catch (e) {
      this.finishScan();
      throw new Error('블루투스 검색을 시작하지 못했어요: ' + errText(e));
    }
    this.scanTimer = setTimeout(() => {
      this.stopScan().catch(() => undefined);
    }, timeoutMs);
    await done;
  }

  async stopScan(): Promise<void> {
    if (!this.scanResolve) return;
    try {
      await (await this.ble()).stopLEScan();
    } catch {
      /* ignore */
    }
    this.finishScan();
  }

  private onDisconnected = (id: string) => {
    if (id !== this.deviceId) return;
    if (this.connecting) return; // connect() 가 실패로 처리
    const wasConnected = this.connected;
    this.connected = false;
    this.assembler.reset();
    if (this.linkLostReported) return;
    if (wasConnected || !this.manualDisconnect) {
      this.states.emit('disconnected', {
        deviceId: id,
        deviceName: this.deviceName,
        unexpected: !this.manualDisconnect,
      });
    }
  };

  private onValue = (id: string, dv: DataView) => {
    if (id !== this.deviceId || !dv) return;
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    for (const line of this.assembler.push(bytes)) this.lines.emit(line);
  };

  async connect(id: string, opts?: ConnectOptions): Promise<void> {
    const ble = await this.ensureReady(opts?.interactive !== false);
    await this.stopScan();
    if (this.deviceId && this.deviceId !== id && this.connected) {
      await this.disconnect();
    }
    this.deviceId = id;
    this.deviceName = this.names.get(id) ?? this.deviceName ?? '';
    this.manualDisconnect = false;
    this.linkLostReported = false;
    this.connecting = true;
    this.assembler.reset();
    this.states.emit('connecting', { deviceId: id, deviceName: this.deviceName });
    try {
      // 이전 연결이 남아 있으면 정리 (같은 기기에 다시 연결할 때 GATT 가 꼬이지 않게)
      await ble.disconnect(id).catch(() => undefined);
      // 플러그인 자체 제한(15초)이 먼저 끝나며 영어 오류('Connection timeout.')를 냄 → 아래 catch 에서 한국어로 바꿈
      // 연결 단계에서 바로 실패(GATT 133)하면 정리하고 다시 시도 (CONNECT_ATTEMPTS)
      for (let attempt = 1; ; attempt++) {
        try {
          await withTimeout(ble.connect(id, this.onDisconnected, { timeout: 15000 }), 16000, CONNECT_TIMEOUT_TEXT);
          break;
        } catch (e) {
          if (attempt >= CONNECT_ATTEMPTS || !isRetryableConnectError(errText(e)) || this.manualDisconnect) throw e;
          await ble.disconnect(id).catch(() => undefined);
          await new Promise((r) => setTimeout(r, CONNECT_RETRY_DELAY_MS));
          if (this.manualDisconnect || this.deviceId !== id) throw e; // 그사이 사용자가 연결 취소·다른 기기 선택
        }
      }
      let mtu = 23;
      try {
        const m = await withTimeout(ble.getMtu(id), 3000, 'MTU timeout');
        if (typeof m === 'number' && m > 0) mtu = m;
      } catch {
        mtu = 23;
      }
      const services = await withTimeout(ble.getServices(id), 10000, '기기 서비스 정보를 읽지 못했어요');
      if (Array.isArray(services) && services.length > 0 && !services.some((s) => uuidEq(s?.uuid, NUS_SERVICE))) {
        throw new Error('이 기기에는 SmartBartender 통신 서비스(NUS)가 없어요. 올바른 기기를 선택하세요.');
      }
      // SPEC §2: 연결 직후 TX 알림 구독을 먼저 (그다음 client.ts 가 hello)
      await withTimeout(
        ble.startNotifications(id, NUS_SERVICE, NUS_TX, (v) => this.onValue(id, v)),
        8000,
        '알림 구독에 실패했어요',
      );
      try {
        const { ConnectionPriority } = await loadBle();
        ble.requestConnectionPriority(id, ConnectionPriority.CONNECTION_PRIORITY_HIGH).catch(() => undefined);
      } catch {
        /* ignore */
      }
      this.chunkSize = Math.max(20, Math.min(WRITE_CHUNK_BYTES, mtu - 3));
      this.connected = true;
      this.connecting = false;
      // 이름을 모르면(검색 없이 자동 재연결) 비워 둠 → client.ts 가 기억한 이름을 그대로 씀 (DEV-1: 'SmartBartender' 로 덮어쓰지 않게)
      this.states.emit('connected', { deviceId: id, deviceName: this.deviceName || undefined });
    } catch (e) {
      this.connected = false;
      this.connecting = false;
      this.manualDisconnect = true;
      ble.disconnect(id).catch(() => undefined);
      const msg = connectErrorText(errText(e));
      this.states.emit('disconnected', { deviceId: id, error: msg, unexpected: false });
      throw new Error(msg);
    }
  }

  async disconnect(): Promise<void> {
    const id = this.deviceId;
    if (!id) return;
    this.manualDisconnect = true;
    const was = this.connected;
    this.connected = false;
    try {
      const ble = await this.ble();
      await ble.stopNotifications(id, NUS_SERVICE, NUS_TX).catch(() => undefined);
      await ble.disconnect(id);
    } catch {
      /* ignore */
    }
    this.assembler.reset();
    if (was) this.states.emit('disconnected', { deviceId: id, deviceName: this.deviceName, unexpected: false });
  }

  write(line: string): Promise<void> {
    const run = async () => {
      if (!this.connected || !this.deviceId) throw new Error('기기가 연결되어 있지 않아요');
      const id = this.deviceId;
      const ble = await this.ble();
      for (const chunk of frameLine(line, this.chunkSize)) {
        await ble.write(id, NUS_SERVICE, NUS_RX, new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength));
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

  onAdapter(cb: (on: boolean) => void) {
    return this.adapter.on(cb);
  }

  destroy() {
    this.stopScan().catch(() => undefined);
    this.disconnect().catch(() => undefined);
    if (this.enabledWatch) {
      this.enabledWatch = false;
      this.ble()
        .then((b) => b.stopEnabledNotifications())
        .catch(() => undefined);
    }
    this.lines.clear();
    this.states.clear();
    this.adapter.clear();
  }
}

export function createCapacitorBleTransport(): Transport {
  return new CapacitorBleTransport();
}
