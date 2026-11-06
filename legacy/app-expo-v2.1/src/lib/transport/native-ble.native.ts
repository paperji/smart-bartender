/**
 * 안드로이드/iOS 네이티브 BLE Transport (react-native-ble-manager, New Architecture TurboModule)
 *
 * - 연결 후 Android MTU 247 요청 → 쓰기 청크 = min(180, MTU-3)
 * - NUS TX(Notify) 구독, 수신 바이트를 '\n' 단위로 재조립 후 UTF-8 디코딩
 * - 네이티브 모듈이 없는 환경(Expo Go 등)에서는 require 단계에서 예외가 나므로
 *   동적 require + try/catch 로 감지하고 "데모 모드" 안내만 표시 (앱 크래시 방지)
 * - 자동 재연결(connect interactive:false)에서는 블루투스가 꺼져 있어도 "켜기" 시스템 창을 띄우지 않고
 *   code 'BT_OFF' 오류를 던짐. 어댑터가 다시 켜지면 onAdapter(true) 로 알림
 * - 블루투스를 끄면 상태 변경 + 주변기기 끊김 이벤트가 둘 다 오므로 끊김은 1번만 보고
 */
import Constants from 'expo-constants';
import { PermissionsAndroid, Platform } from 'react-native';

import {
  DEVICE_NAME_PREFIX,
  frameLine,
  LineAssembler,
  NUS_RX,
  NUS_SERVICE,
  NUS_TX,
  REQUEST_MTU,
  WRITE_CHUNK_BYTES,
} from '../protocol';
import {
  Emitter,
  type Availability,
  type ConnectOptions,
  type FoundDevice,
  type LinkState,
  type ScanOptions,
  type StateInfo,
  type Transport,
} from './types';

type BleManagerApi = typeof import('react-native-ble-manager').default;
interface Sub {
  remove(): void;
}

let loaded: { mgr: BleManagerApi | null; error?: string } | null = null;

function loadBle(): { mgr: BleManagerApi | null; error?: string } {
  if (loaded) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-ble-manager');
    const mgr = (mod?.default ?? mod) as BleManagerApi;
    if (!mgr || typeof mgr.start !== 'function') throw new Error('BleManager 모듈 형식이 올바르지 않음');
    loaded = { mgr };
  } catch (e: any) {
    loaded = { mgr: null, error: String(e?.message ?? e) };
  }
  return loaded;
}

function isExpoGo(): boolean {
  return Constants.executionEnvironment === 'storeClient';
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
  return String(anyE.message ?? anyE.error ?? JSON.stringify(anyE));
}

export class NativeBleTransport implements Transport {
  readonly kind = 'native' as const;
  private lines = new Emitter<[string]>();
  private states = new Emitter<[LinkState, StateInfo | undefined]>();
  private adapter = new Emitter<[boolean]>();
  private assembler = new LineAssembler();
  private subs: Sub[] = [];
  private started = false;
  private deviceId: string | null = null;
  private deviceName = '';
  private connected = false;
  private manualDisconnect = false;
  /** 블루투스 꺼짐으로 이미 끊김을 보고함 → 뒤따르는 주변기기 끊김 이벤트는 보고하지 않음 (connect 때 초기화) */
  private linkLostReported = false;
  private chunkSize = 20;
  private writeChain: Promise<void> = Promise.resolve();
  private scanResolve: (() => void) | null = null;
  private scanFound: ((d: FoundDevice) => void) | null = null;
  private scanIncludeAll = false;
  private names = new Map<string, string>();

  async availability(): Promise<Availability> {
    const { mgr, error } = loadBle();
    if (!mgr) {
      return {
        ok: false,
        reason: isExpoGo()
          ? 'Expo Go 앱에서는 블루투스 기능을 쓸 수 없어요. APK(개발 빌드)로 설치하거나 데모 모드를 켜 주세요.'
          : `블루투스 모듈을 불러오지 못했어요 (${error ?? '네이티브 모듈 없음'}). 데모 모드를 사용해 주세요.`,
      };
    }
    return { ok: true };
  }

  private get mgr(): BleManagerApi {
    const { mgr } = loadBle();
    if (!mgr) throw new Error('블루투스 모듈을 사용할 수 없어요 (Expo Go 에서는 지원되지 않음)');
    return mgr;
  }

  /** 권한 요청 (Android 12+: BLUETOOTH_SCAN/CONNECT, Android 11 이하: 위치) */
  private async ensurePermissions() {
    if (Platform.OS !== 'android') return;
    const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    if (api >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      const ok =
        res[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
        res[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
      if (!ok) {
        throw new Error('"근처 기기" 권한이 필요해요. 휴대폰 설정 > 애플리케이션 > AI 스마트 바텐더 > 권한에서 허용해 주세요.');
      }
    } else {
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      if (r !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error('안드로이드 11 이하에서는 블루투스 검색에 위치 권한이 필요해요. 권한을 허용해 주세요.');
      }
    }
  }

  /** interactive=false(자동 재연결)면 블루투스 켜기 창을 띄우지 않고 BT_OFF 오류를 바로 던짐 */
  private async ensureReady(interactive = true) {
    const mgr = this.mgr;
    await this.ensurePermissions();
    if (!this.started) {
      await mgr.start({ showAlert: false });
      this.attachListeners();
      this.started = true;
    }
    const state = await mgr.checkState();
    if (state === 'off' || state === 'turning_off') {
      if (!interactive) throw btOffError();
      if (Platform.OS === 'android') {
        try {
          await mgr.enableBluetooth();
        } catch {
          throw new Error('블루투스가 꺼져 있어요. 블루투스를 켠 뒤 다시 시도하세요.');
        }
      } else {
        throw new Error('블루투스가 꺼져 있어요. 설정에서 블루투스를 켜 주세요.');
      }
    } else if (state === 'unsupported') {
      throw new Error('이 휴대폰은 블루투스 저전력(BLE)을 지원하지 않아요.');
    } else if (state === 'unauthorized') {
      throw new Error('블루투스 권한이 없어요. 설정에서 허용해 주세요.');
    }
  }

  private attachListeners() {
    const mgr = this.mgr;
    this.subs.push(
      mgr.onDiscoverPeripheral((p) => {
        if (!this.scanFound) return;
        const name = p.name || p.advertising?.localName || '';
        const uuids = (p.advertising?.serviceUUIDs ?? []) as string[];
        const likely = name.startsWith(DEVICE_NAME_PREFIX) || uuids.some((u) => uuidEq(u, NUS_SERVICE));
        if (!likely && !this.scanIncludeAll) return;
        if (name) this.names.set(p.id, name);
        this.scanFound({ id: p.id, name: name || '(이름 없음)', rssi: p.rssi, likely });
      }),
      mgr.onStopScan(() => {
        this.finishScan();
      }),
      mgr.onDisconnectPeripheral((e) => {
        if (e.peripheral !== this.deviceId) return;
        const wasConnected = this.connected;
        this.connected = false;
        this.assembler.reset();
        if (this.linkLostReported) return; // 블루투스 꺼짐으로 이미 보고함 (중복 보고 → 재연결 2번 예약 방지)
        if (wasConnected || !this.manualDisconnect) {
          this.states.emit('disconnected', {
            deviceId: e.peripheral,
            deviceName: this.deviceName,
            unexpected: !this.manualDisconnect,
          });
        }
      }),
      mgr.onDidUpdateValueForCharacteristic((e) => {
        if (e.peripheral !== this.deviceId || !uuidEq(e.characteristic, NUS_TX)) return;
        for (const line of this.assembler.push(e.value ?? [])) this.lines.emit(line);
      }),
      mgr.onDidUpdateState((e) => {
        const off = e.state === 'off' || e.state === 'turning_off';
        if (off && this.connected) {
          this.connected = false;
          this.linkLostReported = true;
          this.states.emit('disconnected', {
            deviceId: this.deviceId ?? undefined,
            error: '블루투스가 꺼졌어요',
            unexpected: true,
          });
        }
        if (off) this.adapter.emit(false);
        else if (e.state === 'on') this.adapter.emit(true);
      }),
    );
  }

  private finishScan() {
    const r = this.scanResolve;
    this.scanResolve = null;
    this.scanFound = null;
    if (r) {
      this.states.emit(this.connected ? 'connected' : 'idle', undefined);
      r();
    }
  }

  async scan(onFound: (d: FoundDevice) => void, opts?: ScanOptions): Promise<void> {
    await this.ensureReady();
    if (this.scanResolve) await this.stopScan();
    const timeoutMs = opts?.timeoutMs ?? 8000;
    this.scanIncludeAll = !!opts?.includeAll;
    this.scanFound = onFound;
    this.states.emit('scanning', undefined);
    const done = new Promise<void>((resolve) => {
      this.scanResolve = resolve;
    });
    try {
      await this.mgr.scan({
        serviceUUIDs: [],
        seconds: Math.max(1, Math.round(timeoutMs / 1000)),
        allowDuplicates: false,
        scanMode: 2, // BleScanMode.LowLatency (Android)
      });
    } catch (e) {
      this.finishScan();
      throw new Error('블루투스 검색을 시작하지 못했어요: ' + errText(e));
    }
    // onStopScan 이 오지 않는 기기 대비 안전 타이머
    const guard = setTimeout(() => this.finishScan(), timeoutMs + 1500);
    await done;
    clearTimeout(guard);
  }

  async stopScan(): Promise<void> {
    if (!this.scanResolve) return;
    try {
      await this.mgr.stopScan();
    } catch {
      /* ignore */
    }
    this.finishScan();
  }

  async connect(id: string, opts?: ConnectOptions): Promise<void> {
    await this.ensureReady(opts?.interactive !== false);
    await this.stopScan();
    const mgr = this.mgr;
    if (this.deviceId && this.deviceId !== id && this.connected) {
      await this.disconnect();
    }
    this.deviceId = id;
    this.deviceName = this.names.get(id) ?? this.deviceName ?? '';
    this.manualDisconnect = false;
    this.linkLostReported = false;
    this.assembler.reset();
    this.states.emit('connecting', { deviceId: id, deviceName: this.deviceName });
    try {
      await withTimeout(mgr.connect(id), 15000, '연결 시간이 초과됐어요 (기기 전원과 거리를 확인하세요)');
      let mtu = 23;
      if (Platform.OS === 'android') {
        try {
          mtu = await withTimeout(mgr.requestMTU(id, REQUEST_MTU), 5000, 'MTU timeout');
        } catch {
          mtu = 23;
        }
      }
      const info = await withTimeout(
        mgr.retrieveServices(id, [NUS_SERVICE]),
        10000,
        '기기 서비스 정보를 읽지 못했어요',
      );
      if (info?.name) this.deviceName = info.name;
      const hasNus = (info?.services ?? []).some((s: any) => uuidEq(s?.uuid, NUS_SERVICE));
      if (Array.isArray(info?.services) && info.services.length > 0 && !hasNus) {
        throw new Error('이 기기에는 SmartBartender 통신 서비스(NUS)가 없어요. 올바른 기기를 선택하세요.');
      }
      await withTimeout(mgr.startNotification(id, NUS_SERVICE, NUS_TX), 8000, '알림 구독에 실패했어요');
      if (Platform.OS === 'ios') {
        try {
          const max = await mgr.getMaximumWriteValueLengthForWithResponse(id);
          mtu = (max || 20) + 3;
        } catch {
          mtu = 23;
        }
      }
      if (Platform.OS === 'android') {
        mgr.requestConnectionPriority(id, 1 /* high */).catch(() => undefined);
      }
      this.chunkSize = Math.max(20, Math.min(WRITE_CHUNK_BYTES, mtu - 3));
      this.connected = true;
      this.states.emit('connected', { deviceId: id, deviceName: this.deviceName || 'SmartBartender' });
    } catch (e) {
      this.connected = false;
      this.manualDisconnect = true;
      mgr.disconnect(id).catch(() => undefined);
      this.states.emit('disconnected', { deviceId: id, error: errText(e), unexpected: false });
      throw new Error(errText(e));
    }
  }

  async disconnect(): Promise<void> {
    const id = this.deviceId;
    if (!id) return;
    this.manualDisconnect = true;
    const was = this.connected;
    this.connected = false;
    try {
      await this.mgr.disconnect(id);
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
      for (const chunk of frameLine(line, this.chunkSize)) {
        await this.mgr.write(id, NUS_SERVICE, NUS_RX, Array.from(chunk), chunk.length);
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
    this.disconnect().catch(() => undefined);
    for (const s of this.subs) {
      try {
        s.remove();
      } catch {
        /* ignore */
      }
    }
    this.subs = [];
    this.started = false;
    this.lines.clear();
    this.states.clear();
    this.adapter.clear();
  }
}

export function createNativeTransport(): Transport {
  return new NativeBleTransport();
}
