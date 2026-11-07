/**
 * DeviceClient — 기기 통신의 단일 진입점
 * - Transport(native/web/demo) 선택·교체 (v3.0: 플랫폼별 구현은 platform/transport/factory.ts —
 *   native = Capacitor(APK) BLE, web = Web Bluetooth(웹·PWA·Electron), demo = 가상 기기)
 * - 앱 앞/뒤 상태는 React Native AppState 대신 platform/appState.ts (document.visibilitychange)
 * - 이벤트 파싱 → 상태 스토어(useDevice) 갱신 (연결상태, 기기정보, 유량표, 작업 진행률)
 * - 명령 함수: hello/status/ping/make/stop/run/clean/setCal/getCal
 * - ping 으로 연결 유지 확인, 예상치 못한 끊김 시 자동 재연결
 *   (백그라운드·화면 꺼짐으로 타이머가 멈췄다 돌아온 경우는 끊김으로 보지 않음 — 응답 없는 ping 이 3번 쌓여야 판단)
 * - 통신 방식별 마지막 기기 기억 → 앱 시작 시 자동 재연결, "다른 기기로 변경" (SPEC §5.5)
 * - info.calSet / info.maxPumpMs / cal.calSet 파싱 (없으면 null = 알 수 없음, v2.0 펌웨어 하위호환)
 * - 연결이 끊긴 작업 정리 (SPEC §2.4: 끊겨도 기기는 끝까지 수행, 재연결 후 status 로 확인)
 *   · 재연결을 포기하거나 하지 않으면 → 진행 중 작업을 "결과 모름"(stopped/disconnected)으로 정리 (제조 화면에 갇히지 않게)
 *   · 명령을 보냈는데 ack 를 못 받으면(끊김·시간 초과) → "시작 못 함"으로 단정하지 않고 확인 중(pending+uncertain)
 *   · 재연결 후 판정 (SPEC §2.4 마지막 항목, 위에서부터):
 *     ① state=running 이고 job.id 가 같음 → 진행 화면 복귀 (정리했던 작업이면 다시 running 으로 되살림)
 *     ② idle 이고 status.last.id 가 같음 → last 의 결과(완료/중단·사유·나온 양)를 그대로 기록·잔량 차감
 *        (이미 "결과 모름"으로 정리했던 작업이면 같은 id 로 다시 끝냄 → brew.ts 가 잔량은 차이만 빼고 기록은 갱신)
 *     ③ last 가 없거나 id 가 다르고, pong.up(가동시간)이 작업 시작 후 경과시간보다 짧음 → "재부팅으로 중단(양 모름)"
 *        (ack 를 못 받은 작업은 status running·progress 를 받은 시각(runningSeenAt)을 작업 시작 시각의 상한으로 씀)
 *     ④ 그 밖 → "결과 확인 필요": 예상 시간보다 일찍 idle 이면 stopped/unknown, 아니면 계획량 done(uncertain)
 *     (예전 펌웨어는 status 에 last 가 없어 ③·④ 로만 판단)
 *   · 결과를 모르는 작업의 화면을 사용자가 닫아도(clearJob) 작업 정보는 pendingCheck 로 남겨 재연결 뒤 ②~④ 판정을 그대로 함
 *     (화면은 다시 열지 않고 기록·잔량만 바로잡음. 기기가 아직 그 작업 중이면 되살려 진행 화면을 다시 엶). 새 작업을 시작하면 버림
 * - 작업 구분은 앱이 붙이는 localKey 로 함 (run·clean 의 id 는 늘 같고, BUTTON_REPEAT_LAST 다시 만들기는 make id 를 다시 씀):
 *   결과가 확정된 작업과 같은 id 의 작업이 새로 시작되면(ack·status running) 되살리지 않고 새 작업(새 localKey)으로 봄
 */

import {
  encodeCommand,
  errorCodeMessage,
  LIMITS,
  newJobId,
  parseCalSet,
  parseEvent,
  parseMaxPumpMs,
  parseStatusLast,
  validateClean,
  validateRun,
  type AckEvent,
  type CalEvent,
  type Command,
  type DeviceEvent,
  type InfoEvent,
  type JobKind,
  type MakeStep,
  type PongEvent,
  type StatusLast,
} from '@/lib/protocol';
import { DEMO_DEVICES, DemoTransport, isDemoDeviceId } from '@/lib/transport/demo';
import type { FoundDevice, LinkState, StateInfo, Transport, TransportKind } from '@/lib/transport/types';
import { onAppStateChange, type AppStateStatus } from '@/platform/appState';
import { createDeviceTransport, platformTransportKind } from '@/platform/transport/factory';
import { clearDemoCal, loadDemoCal, saveDemoCal } from '@/store/demoCal';
import { initialDeviceState, isBusy, isConfirmed, patchJob, setDevice, useDevice, type JobState } from '@/store/device';
import { useSettings } from '@/store/settings';
import { useSlots } from '@/store/slots';

export class DeviceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceError';
  }
}

interface Waiter {
  match: (e: DeviceEvent) => boolean;
  failOnError: boolean;
  resolve: (e: DeviceEvent) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type JobEndListener = (job: JobState) => void;

const PING_INTERVAL_MS = 5000;
const DEAD_AFTER_MS = 16000;
/** 응답(수신 줄) 없이 연속으로 보낸 ping 이 이만큼 쌓여야 끊김으로 판단 */
const DEAD_AFTER_PINGS = 3;
const RECONNECT_DELAYS = [1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000, 30000, 30000];
/** 재연결 후 idle 판정: 예상 소요시간보다 이만큼 이상 일찍 idle 이면 정상 완료가 아님 */
const EARLY_IDLE_MARGIN_MS = 1000;
/** 끝날 시각(ack + totalMs)이 이만큼 지나도 done/stopped 가 없으면, 또는 기기 줄이 이만큼 안 오면 status 로 직접 확인 */
export const OVERDUE_GRACE_MS = 3000;
/** 정지(stop) 명령을 보내고 이만큼 지나도 stopped 가 없으면 status 로 확인 */
export const STOP_CONFIRM_MS = 1500;

/**
 * 연결이 살아 있는데 결과(done/stopped)를 놓쳤을 수 있는 작업인지 — status 로 직접 확인할 대상 (ping 주기 5초마다, 정지 직후 1번).
 * 블루투스가 몹시 혼잡하면 기기가 알림 줄을 끝내 못 보내고 버릴 수 있음(펌웨어 TxRing.h, 4초 재시도 뒤 1줄 포기).
 * 연결은 끊기지 않으므로 재연결 뒤 확인(onConnected 의 status)이 일어나지 않아 제조 화면이 99% 에 머묾 → 여기서 막음.
 *  - running + 정지 명령을 보낸 지 STOP_CONFIRM_MS 가 지남 (stopped 를 놓침 — 끝날 시각까지 기다리지 않음)
 *  - running + 기기 줄(ack·progress·step·status running)이 OVERDUE_GRACE_MS 넘게 없음 (lastLineAt): 작업 중이면 250ms 마다 progress 가 옴.
 *    물리 버튼으로 멈춘 뒤 stopped 를 놓친 경우도 여기서 잡힘
 *  - running + ack: 끝날 시각 + OVERDUE_GRACE_MS 가 지남
 *  - running, ack 없음(재연결 뒤 status running·progress 로 되살린 작업): 끝날 시각을 모르므로 확인한 뒤 OVERDUE_GRACE_MS 부터 계속
 *  - pending + uncertain(명령은 보냈지만 ack 를 못 받음): 계속 (startJob 이 보낸 첫 status 의 응답도 놓쳤을 수 있음)
 * 기기가 아직 작업 중이면 status running 이 와서 진행률만 맞춰짐(해 없음). idle 이면 status.last 로 실제 결과가 확정됨.
 */
export function jobOverdue(job: JobState | null, now: number, lastLineAt: number | null = null): boolean {
  if (!job) return false;
  if (job.status === 'pending') return !!job.uncertain;
  if (job.status !== 'running') return false;
  if (job.stopSentAt != null && now > job.stopSentAt + STOP_CONFIRM_MS) return true;
  if (lastLineAt != null && now > lastLineAt + OVERDUE_GRACE_MS) return true;
  if (job.ackAt != null) return now > job.ackAt + Math.max(0, job.totalMs) + OVERDUE_GRACE_MS;
  return job.runningSeenAt != null && now > job.runningSeenAt + OVERDUE_GRACE_MS;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 받은 진행량(하한값)으로 dispensed 만들기 (0ml 펌프 생략 — 기기 stopped 이벤트와 같은 모양) */
function progressDispensed(job: JobState): MakeStep[] {
  return job.pumps
    .filter((p) => p.done > 0)
    .map((p) => ({ p: p.p, ml: round1(p.target > 0 ? Math.min(p.done, p.target) : p.done) }));
}

let localSeq = 0;
/** 작업마다 새로 붙이는 앱 쪽 고유 키 (JobState.localKey) */
function newLocalKey(): string {
  localSeq += 1;
  return 'j' + Date.now().toString(36) + '-' + localSeq.toString(36);
}

/**
 * 정리했던 작업(시작 못 함·결과 모름)을 다시 running 으로 — 종료 관련 필드(dispensed·reason·error…)는 버림.
 * localKey 는 그대로 (같은 작업) — brew.ts 가 같은 작업이 다시 끝난 것으로 보고 잔량은 차이만 뺌
 */
function revived(job: JobState, patch: Partial<JobState> = {}): JobState {
  return {
    id: job.id,
    ...(job.localKey ? { localKey: job.localKey } : {}),
    kind: job.kind,
    status: 'running',
    totalMs: job.totalMs,
    ackAt: job.ackAt,
    ...(job.runningSeenAt != null ? { runningSeenAt: job.runningSeenAt } : {}),
    pct: job.pct,
    pumps: job.pumps.map((p) => ({ ...p })),
    ...(job.purpose ? { purpose: job.purpose } : {}),
    ...patch,
  };
}

/**
 * 앱이 시작하지 않은(또는 이미 결과가 확정된 같은 id 의) 작업을 기기가 하고 있음 → 새 작업(새 localKey)
 * - prev: 결과가 확정된 같은 id 의 make (펌웨어 BUTTON_REPEAT_LAST 다시 만들기 — 같은 재료·양) → 펌프 목록만 0부터 다시
 * - ack 를 받지 않았으면(status running) 지금 시각을 작업 시작 시각의 상한(runningSeenAt)으로 둠
 */
function newDeviceJob(
  id: string,
  kind: JobKind,
  opts: { pct?: number; totalMs?: number; ackAt?: number | null; prev?: JobState | null } = {},
): JobState {
  const prev = opts.prev && opts.prev.kind === 'make' && kind === 'make' ? opts.prev : null;
  const ackAt = opts.ackAt ?? null;
  return {
    id,
    localKey: newLocalKey(),
    kind,
    status: 'running',
    totalMs: opts.totalMs ?? 0,
    ackAt,
    ...(ackAt == null ? { runningSeenAt: Date.now() } : {}),
    pct: opts.pct ?? 0,
    pumps: prev ? prev.pumps.map((p) => ({ p: p.p, target: p.target, done: 0, finished: false })) : [],
  };
}

/** 결과를 모른 채 정리한 작업 (화면을 닫아도 재연결 뒤 기기에 결과를 물어볼 대상) */
function isUnresolved(job: JobState | null): job is JobState {
  return !!job && !isBusy(job) && (!!job.uncertain || (job.status === 'stopped' && job.reason === 'disconnected'));
}

/** 연결 문제로 앱이 정리했지만 기기는 실제로 작업 중일 수 있는 상태 (시작 못 함으로 본 것 · 연결이 끊겨 결과 모름) */
function isRevivable(job: JobState | null): job is JobState {
  return !!job && (job.status === 'error' || (job.status === 'stopped' && job.reason === 'disconnected'));
}

/** 재연결 뒤 기기에 결과를 물어볼 작업: 진행 중·확인 중이거나, 연결 문제로 결과를 모른 채 정리한 작업 */
function needsCheck(job: JobState | null): job is JobState {
  if (!job) return false;
  return isBusy(job) || job.status === 'error' || (job.status === 'stopped' && job.reason === 'disconnected') || !!job.uncertain;
}

/**
 * status.last 가 이 작업의 결과인지 (SPEC §2.4 ②)
 *  - id·kind 가 같아야 함. make 는 id 가 매번 다르므로(r+시각) 이것으로 충분
 *    (BUTTON_REPEAT_LAST 다시 만들기는 같은 id 를 다시 쓰지만, 확정된 작업은 아래 조건으로 고치지 않음)
 *  - run/clean 은 id 가 늘 'run'/'clean' 이라 예전 작업과 구분되지 않음 → 기기가 이 작업을 받은 것이 확인된 경우만
 *    (ack 를 받았거나, ack 는 놓쳤지만 status running·progress 로 기기가 이 작업을 하는 것을 본 경우 — runningSeenAt)
 *  - 고칠 대상: 진행 중·확인 중(pending)이거나, 결과를 모른 채 정리한(uncertain) 작업. 실제 이벤트로 확정된 결과는 건드리지 않음
 */
function lastMatchesJob(job: JobState, last: StatusLast): boolean {
  if (last.id !== job.id || last.kind !== job.kind) return false;
  // run/clean: ack 를 받았거나, ack 는 놓쳤어도 기기가 이 작업을 하는 것을 확인했을 때(runningSeenAt)만
  // (기기는 한 번에 한 작업 — 확인한 뒤 idle 이면 last 는 바로 이 작업의 결과)
  if (job.kind !== 'make' && job.ackAt == null && job.runningSeenAt == null) return false;
  return isBusy(job) || !!job.uncertain;
}

class DeviceClient {
  private transport: Transport | null = null;
  private unsubs: (() => void)[] = [];
  private waiters = new Set<Waiter>();
  private jobEnd = new Set<JobEndListener>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** 사용자가 연결 상태를 원함 (수동 해제 시 false) */
  private wantConnected = false;
  private targetId: string | null = null;
  private initialized = false;
  /** 직전 ping 타이머 실행 시각 — 간격이 크게 벌어졌으면 타이머가 멈춰 있었음(백그라운드·화면 꺼짐) */
  private lastTickAt: number | null = null;
  /** 진행 중 작업에 대해 기기 줄(ack·progress·step·status running)을 마지막으로 받은 시각 — jobOverdue 의 "조용함" 판단 */
  private lastJobLineAt: number | null = null;
  /** 응답(수신 줄) 없이 보낸 ping 수 */
  private unansweredPings = 0;
  /** 마지막 pong 으로 계산한 기기 부팅 시각(앱 시계 ms) — 재연결 뒤 재부팅 판단용 */
  private bootAt: number | null = null;
  /** 블루투스가 꺼져 자동 재연결을 멈춘 상태 (켜지면 다시 시작) */
  private waitingAdapter = false;
  /** 응답 없는 연결을 앱이 직접 끊는 중 (그때 오는 disconnected 는 재연결 판단에 쓰지 않음) */
  private droppingDeadLink = false;
  private appStateSub: (() => void) | null = null;
  /**
   * 결과를 모른 채 정리한 작업인데 사용자가 화면을 닫음(clearJob) — 화면에서는 지웠지만 재연결 뒤 기기에 결과를 물어
   * 기록·잔량을 바로잡음 (SPEC §2.4 ②~④, 화면은 다시 열지 않음). 기기가 아직 그 작업 중이면 되살림. 새 작업을 시작하면 버림
   */
  private pendingCheck: JobState | null = null;

  // ───────────────────────── 초기화 / Transport 선택 ─────────────────────────

  kindFor(demo: boolean): TransportKind {
    if (demo) return 'demo';
    return platformTransportKind();
  }

  /** 앱 시작 시 1회 + 데모 모드 전환 시 호출 */
  async init(demo: boolean, opts: { autoConnect?: boolean } = {}) {
    const kind = this.kindFor(demo);
    if (this.initialized && this.transport?.kind === kind) return;
    await this.teardown();
    this.initialized = true;
    if (!this.appStateSub) {
      this.appStateSub = onAppStateChange((s) => this.onAppState(s));
    }
    let t: Transport;
    if (kind === 'demo') {
      // 데모 기기의 유량표는 localStorage(store/demoCal) 에 저장 → 새로고침 후에도 유지
      const savedCal = await loadDemoCal();
      t = new DemoTransport({ savedCal, onCalChange: (id, rec) => void saveDemoCal(id, rec) });
    } else {
      t = createDeviceTransport(kind);
    }
    this.transport = t;
    setDevice({ ...initialDeviceState, transportKind: kind });
    this.unsubs.push(
      t.onLine((line) => this.handleLine(line)),
      t.onState((s, info) => this.handleState(s, info)),
    );
    if (t.onAdapter) this.unsubs.push(t.onAdapter((on) => this.onAdapter(on)));
    const availability = await t.availability();
    setDevice({ availability });
    if (!availability.ok || opts.autoConnect === false) return;
    this.autoConnect(kind);
  }

  /** 앱 시작 시 마지막으로 연결했던 기기에 자동 연결 (SPEC §5.5) */
  private autoConnect(kind: TransportKind) {
    const st = useSettings.getState();
    const last = st.lastDevices?.[kind];
    if (kind === 'demo') {
      // 데모 모드는 바로 가상 기기에 연결해 전체 흐름을 체험할 수 있게
      const spec = DEMO_DEVICES.find((d) => d.id === last?.id) ?? DEMO_DEVICES[0];
      this.connect(spec.id, spec.name).catch(() => undefined);
      return;
    }
    if (!st.autoReconnect || !last || isDemoDeviceId(last.id)) return;
    if (kind === 'web') {
      // 웹은 브라우저가 예전에 허락한 기기 목록(getDevices)을 지원할 때만 조용히 시도
      const bt = typeof navigator !== 'undefined' ? (navigator as any).bluetooth : null;
      if (!bt || typeof bt.getDevices !== 'function') return;
    }
    const label = last.name ?? 'SmartBartender';
    this.connect(last.id, last.name ?? undefined).catch(() => {
      if (useDevice.getState().conn === 'connected') return;
      this.wantConnected = false;
      setDevice({
        conn: 'idle',
        lastError:
          kind === 'native'
            ? '마지막 기기(' + label + ')에 자동으로 연결하지 못했어요. 기기 전원을 켜고 "주변 기기 검색"으로 다시 연결해 주세요.'
            : null,
      });
    });
  }

  private async teardown() {
    this.stopPing();
    this.clearReconnect();
    this.wantConnected = false;
    this.waitingAdapter = false;
    this.pendingCheck = null;
    for (const w of Array.from(this.waiters)) {
      clearTimeout(w.timer);
      w.reject(new Error('연결이 초기화됐어요'));
    }
    this.waiters.clear();
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.transport) {
      try {
        await this.transport.disconnect();
      } catch {
        /* ignore */
      }
      this.transport.destroy();
    }
    this.transport = null;
  }

  get kind(): TransportKind | null {
    return this.transport?.kind ?? null;
  }

  onJobEnd(cb: JobEndListener) {
    this.jobEnd.add(cb);
    return () => {
      this.jobEnd.delete(cb);
    };
  }

  // ───────────────────────── 검색 / 연결 ─────────────────────────

  async scan(includeAll = false) {
    const t = this.requireTransport();
    setDevice({ found: [], lastError: null });
    const found = new Map<string, FoundDevice>();
    try {
      await t.scan(
        (d) => {
          found.set(d.id, d);
          const list = Array.from(found.values()).sort(
            (a, b) => Number(b.likely) - Number(a.likely) || (b.rssi ?? -999) - (a.rssi ?? -999),
          );
          setDevice({ found: list });
        },
        { timeoutMs: 8000, includeAll },
      );
    } catch (e: any) {
      setDevice({ lastError: e?.message ?? String(e), conn: this.isConnected ? 'connected' : 'idle' });
      throw e;
    }
    // 웹: 선택 창에서 고른 기기로 바로 연결
    if (t.kind === 'web') {
      const first = Array.from(found.values())[0];
      if (first) await this.connect(first.id, first.name);
    }
  }

  async stopScan() {
    await this.transport?.stopScan();
  }

  get isConnected() {
    return useDevice.getState().conn === 'connected';
  }

  async connect(id: string, name?: string) {
    const t = this.requireTransport();
    this.clearReconnect();
    this.wantConnected = true;
    this.waitingAdapter = false;
    // 다른 기기에 연결하면 화면을 닫아 둔 작업의 결과 확인은 버림 (다른 기기의 status.last 로 판정하지 않게)
    const prevId = useDevice.getState().deviceId;
    if (this.pendingCheck && prevId && prevId !== id) this.pendingCheck = null;
    this.targetId = id;
    setDevice({ lastError: null, reconnectAttempt: 0, deviceId: id, deviceName: name ?? useDevice.getState().deviceName });
    try {
      await t.connect(id);
    } catch (e: any) {
      setDevice({ conn: 'disconnected', lastError: e?.message ?? String(e) });
      throw e;
    }
  }

  async disconnect() {
    this.wantConnected = false;
    this.waitingAdapter = false;
    this.clearReconnect();
    this.stopPing();
    await this.transport?.disconnect();
    setDevice({ conn: 'idle', reconnectAttempt: 0 });
    this.abandonBusyJob();
  }

  /** "다른 기기로 변경": 연결 해제 → 목록 비우기 → 다시 검색 (SPEC §5.5) */
  async switchDevice(includeAll = false) {
    if (isBusy(useDevice.getState().job)) {
      throw new DeviceError('BUSY', '기기가 작동 중이에요. 끝난 뒤 바꿔 주세요.');
    }
    await this.disconnect();
    this.pendingCheck = null; // 다른 기기의 status.last 로 이 작업을 판정하지 않게
    setDevice({ found: [], info: null, cal: null, calSet: null, maxPumpMs: null, deviceId: null, deviceName: null, lastError: null });
    await this.scan(includeAll);
  }

  /** 기억한 기기 지우기 (다음 앱 시작 때 자동 연결 안 함) */
  forgetDevice() {
    const kind = this.transport?.kind;
    if (kind) useSettings.getState().forgetDevice(kind);
  }

  private handleState(s: LinkState, info?: StateInfo) {
    if (s === 'scanning') {
      if (!this.isConnected) setDevice({ conn: 'scanning' });
      return;
    }
    if (s === 'idle') {
      if (useDevice.getState().conn === 'scanning') setDevice({ conn: 'idle' });
      return;
    }
    if (s === 'connecting') {
      const cur = useDevice.getState();
      setDevice({ conn: cur.reconnectAttempt > 0 ? 'reconnecting' : 'connecting' });
      return;
    }
    if (s === 'connected') {
      if (!this.wantConnected) {
        // 재연결 시도 중에 사용자가 "연결 해제"를 누름 → 연결되자마자 끊음
        this.transport?.disconnect().catch(() => undefined);
        return;
      }
      setDevice({
        conn: 'connected',
        deviceId: info?.deviceId ?? this.targetId,
        deviceName: info?.deviceName ?? useDevice.getState().deviceName,
        reconnectAttempt: 0,
        lastError: null,
        lastSeenAt: Date.now(),
      });
      const rememberId = info?.deviceId ?? this.targetId;
      if (rememberId && this.transport) {
        useSettings.getState().rememberDevice(this.transport.kind, rememberId, info?.deviceName ?? useDevice.getState().deviceName ?? null);
      }
      this.onConnected().catch((e) => setDevice({ lastError: e?.message ?? String(e) }));
      return;
    }
    if (s === 'disconnected') {
      this.stopPing();
      const prevConn = useDevice.getState().conn;
      const unexpected = !!info?.unexpected;
      this.rejectWaiters('기기 연결이 끊어졌어요');
      if (prevConn === 'reconnecting') {
        // 자동 재연결 중: 다음 시도를 기다리는 동안 같은 끊김이 한 번 더 보고됐거나(블루투스 끄기),
        // 이번 시도가 실패함 → 재연결 타이머의 catch 가 다음 시도를 예약하므로 상태는 그대로 둠 (시도 횟수 중복 증가 방지)
        if (info?.error && !unexpected) setDevice({ lastError: info.error });
        return;
      }
      setDevice({ conn: 'disconnected', lastError: info?.error ?? (unexpected ? '기기 연결이 끊어졌어요' : null) });
      if (this.droppingDeadLink) return; // 응답 없는 연결을 앱이 끊는 중 → dropDeadLink 가 재연결/정리
      if (unexpected && prevConn === 'connected' && this.wantConnected && useSettings.getState().autoReconnect) {
        this.scheduleReconnect();
      } else if (!this.wantConnected) {
        setDevice({ conn: 'idle' });
        this.abandonBusyJob();
      } else {
        // 연결을 원하지만 자동 재연결을 하지 않음(설정 꺼짐·연결 시도 실패)
        // → 진행 중 작업을 "결과 모름"으로 정리 (제조 화면에서 빠져나올 수 있게)
        this.abandonBusyJob();
      }
    }
  }

  private rejectWaiters(message: string) {
    for (const w of Array.from(this.waiters)) {
      clearTimeout(w.timer);
      this.waiters.delete(w);
      w.reject(new Error(message));
    }
  }

  /** 앱이 다시 앞으로 나옴 → 멈춰 있던 ping 시계를 다시 시작하고 바로 ping (끊김 오판 방지) */
  private onAppState(s: AppStateStatus) {
    if (s !== 'active' || !this.isConnected) return;
    const now = Date.now();
    this.lastTickAt = now;
    this.unansweredPings = 0;
    setDevice({ lastSeenAt: now });
    this.sendPing();
  }

  /** 블루투스 어댑터가 다시 켜짐 → 꺼져서 멈췄던 자동 재연결을 다시 시작 */
  private onAdapter(on: boolean) {
    if (!on || !this.waitingAdapter) return;
    this.waitingAdapter = false;
    if (!this.wantConnected || !this.targetId || !this.transport) return;
    const c = useDevice.getState().conn;
    if (c === 'connected' || c === 'connecting' || c === 'reconnecting') return;
    setDevice({ reconnectAttempt: 0, lastError: null });
    this.scheduleReconnect();
  }

  /**
   * 연결 직후: hello → info, (확인할 작업이 있으면 ping 으로 기기 가동시간) → status 로 진행 중 작업 확인, ping 시작.
   * 가동시간(pong.up)으로 끊긴 동안 기기가 재부팅됐는지 판단 (resolveIdleJob 에서 사용)
   */
  private async onConnected() {
    this.bootAt = null;
    try {
      const info = await this.hello();
      if (info.pumps > 0) useSlots.getState().ensurePumpCount(info.pumps);
    } catch {
      setDevice({ lastError: '기기 정보(info)를 받지 못했어요. 펌웨어 버전을 확인하세요.' });
    }
    this.startPing();
    // 확인할 작업이 있으면 가동시간(pong.up)을 먼저 받아 둠 → status 판정에서 재부팅 여부 확인 (SPEC §2.4 ③)
    if (needsCheck(useDevice.getState().job) || this.pendingCheck) await this.ping().catch(() => undefined);
    await this.send({ cmd: 'status' }).catch(() => undefined);
  }

  private scheduleReconnect() {
    this.clearReconnect();
    const attempt = useDevice.getState().reconnectAttempt;
    if (attempt >= RECONNECT_DELAYS.length || !this.targetId) {
      setDevice({ conn: 'disconnected', reconnectAttempt: 0, lastError: '자동 재연결에 실패했어요. 기기 탭에서 다시 연결해 주세요.' });
      this.abandonBusyJob();
      return;
    }
    setDevice({ conn: 'reconnecting', reconnectAttempt: attempt + 1 });
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.wantConnected || !this.targetId || !this.transport) return;
      try {
        // 자동 재연결은 사용자 화면(블루투스 켜기 시스템 창 등)을 띄우지 않음
        await this.transport.connect(this.targetId, { interactive: false });
      } catch (e: any) {
        if (!this.wantConnected) return;
        if (e?.code === 'BT_OFF') {
          // 블루투스가 꺼져 있음 → 재시도를 멈추고, 켜지면(onAdapter) 다시 시작
          this.waitingAdapter = true;
          setDevice({ conn: 'disconnected', reconnectAttempt: 0, lastError: '블루투스가 꺼져 있어요. 켜면 다시 연결할게요.' });
          this.abandonBusyJob();
          return;
        }
        this.scheduleReconnect();
      }
    }, RECONNECT_DELAYS[attempt]);
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startPing() {
    this.stopPing();
    this.lastTickAt = Date.now();
    this.unansweredPings = 0;
    this.pingTimer = setInterval(() => this.pingTick(), PING_INTERVAL_MS);
  }

  private pingTick() {
    const now = Date.now();
    const gap = now - (this.lastTickAt ?? now);
    this.lastTickAt = now;
    const st = useDevice.getState();
    if (st.conn !== 'connected') return;
    if (gap > PING_INTERVAL_MS * 2) {
      // 타이머가 멈춰 있었음(안드로이드는 백그라운드·화면 꺼짐 동안 JS 타이머를 멈춤)
      // → 그동안 ping 을 못 보냈으니 응답이 없던 게 아님. 시계를 다시 시작하고 ping 만 보냄
      this.unansweredPings = 0;
      setDevice({ lastSeenAt: now });
      this.pollOverdueJob(st.job, now);
      this.sendPing();
      return;
    }
    if (st.lastSeenAt && now - st.lastSeenAt > DEAD_AFTER_MS && this.unansweredPings >= DEAD_AFTER_PINGS) {
      this.dropDeadLink();
      return;
    }
    this.pollOverdueJob(st.job, now);
    this.sendPing();
  }

  /** 결과를 놓쳤을 수 있는 작업이면 status 로 기기에 직접 물어봄 (jobOverdue) */
  private pollOverdueJob(job: JobState | null, now: number) {
    if (jobOverdue(job, now, this.lastJobLineAt)) this.send({ cmd: 'status' }).catch(() => undefined);
  }

  private sendPing() {
    this.unansweredPings++;
    this.send({ cmd: 'ping' }).catch(() => undefined);
  }

  /** 보낸 ping 에 응답이 계속 없음 → 연결이 죽은 것으로 보고 끊은 뒤 재연결 (자동 재연결이 꺼져 있으면 작업 정리) */
  private dropDeadLink() {
    setDevice({ lastError: '기기 응답이 없어요. 다시 연결하는 중…' });
    this.stopPing();
    const t = this.transport;
    if (!t) return;
    this.droppingDeadLink = true;
    t.disconnect()
      .catch(() => undefined)
      .finally(() => {
        this.droppingDeadLink = false;
        if (!this.wantConnected) return;
        if (useSettings.getState().autoReconnect) {
          setDevice({ conn: 'disconnected' });
          this.scheduleReconnect();
        } else {
          setDevice({ conn: 'disconnected', lastError: '기기 응답이 없어 연결을 끊었어요. 기기 탭에서 다시 연결해 주세요.' });
          this.abandonBusyJob();
        }
      });
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  // ───────────────────────── 송신 ─────────────────────────

  private requireTransport(): Transport {
    if (!this.transport) throw new Error('통신이 아직 준비되지 않았어요');
    return this.transport;
  }

  async send(cmd: Command) {
    const t = this.requireTransport();
    if (useDevice.getState().conn !== 'connected') throw new DeviceError('NOT_CONNECTED', '기기가 연결되어 있지 않아요');
    await t.write(encodeCommand(cmd));
  }

  private waitFor<T extends DeviceEvent>(
    match: (e: DeviceEvent) => boolean,
    { timeoutMs = 5000, failOnError = true } = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const w: Waiter = {
        match,
        failOnError,
        resolve: (e) => resolve(e as T),
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(w);
          reject(new DeviceError('TIMEOUT', '기기 응답이 없어요 (시간 초과)'));
        }, timeoutMs),
      };
      this.waiters.add(w);
    });
  }

  private async request<T extends DeviceEvent>(cmd: Command, match: (e: DeviceEvent) => boolean, timeoutMs = 5000) {
    const p = this.waitFor<T>(match, { timeoutMs });
    p.catch(() => undefined); // 전송 중 끊겨 먼저 거부돼도 "처리 안 된 거부"가 되지 않게 (아래 return 에서 그대로 전달)
    await this.send(cmd);
    return p;
  }

  hello() {
    return this.request<InfoEvent>({ cmd: 'hello' }, (e) => e.ev === 'info', 6000);
  }

  ping() {
    return this.request<PongEvent>({ cmd: 'ping' }, (e) => e.ev === 'pong', 4000);
  }

  async getCal(): Promise<number[]> {
    const e = await this.request<CalEvent>({ cmd: 'getcal' }, (x) => x.ev === 'cal');
    return e.cal;
  }

  async setCal(p: number, mlps: number): Promise<number[]> {
    const v = Math.round(mlps * 100) / 100;
    if (!(v >= LIMITS.minMlps && v <= LIMITS.maxMlps)) {
      throw new DeviceError('BAD_AMOUNT', `유량은 ${LIMITS.minMlps}~${LIMITS.maxMlps} ml/s 범위여야 해요`);
    }
    try {
      const e = await this.request<CalEvent>({ cmd: 'setcal', p, mlps: v }, (x) => x.ev === 'cal', 4000);
      return e.cal;
    } catch (err) {
      // 펌웨어가 setcal 에 별도 응답을 안 하는 경우 대비 → getcal 로 확인
      if (err instanceof DeviceError && err.code === 'TIMEOUT') return this.getCal();
      throw err;
    }
  }

  private startLocalJob(id: string, kind: JobKind, steps: MakeStep[], extra: Partial<JobState> = {}): JobState {
    const job: JobState = {
      id,
      localKey: newLocalKey(),
      kind,
      status: 'pending',
      totalMs: 0,
      ackAt: null,
      pct: 0,
      pumps: steps.map((s) => ({ p: s.p, target: s.ml, done: 0, finished: false })),
      ...extra,
    };
    // 새 작업을 시작하면 화면을 닫아 둔 예전 작업의 결과 확인은 버림 (기기는 한 번에 한 작업 — 그 결과는 이미 지나감)
    this.pendingCheck = null;
    this.lastJobLineAt = null;
    setDevice({ job });
    return job;
  }

  /**
   * 작업 시작: 로컬 job(pending) → 명령 전송 → ack 대기(6초)
   *  - 전송 자체가 실패 → 기기에 닿지 않음 → error
   *  - 기기가 error 이벤트로 거부(BUSY·LIMIT 등) → error
   *  - 보냈지만 ack 를 못 받음(연결 끊김·시간 초과) → 기기가 실제로 작동 중일 수 있으므로 error 로 단정하지 않고
   *    pending + uncertain 으로 두고 DeviceError('UNCERTAIN') — 나중에 ack/progress/status 로 확정
   */
  private async startJob(
    cmd: Command,
    id: string,
    kind: JobKind,
    steps: MakeStep[],
    extra: Partial<JobState> = {},
    onStart?: (job: JobState) => void,
  ): Promise<AckEvent> {
    if (isBusy(useDevice.getState().job)) throw new DeviceError('BUSY', '이미 작동 중이에요. 끝난 뒤 다시 시도하세요.');
    const local = this.startLocalJob(id, kind, steps, extra);
    try {
      onStart?.(local);
    } catch (err) {
      console.warn('[device] onStart error', err);
    }
    const ackP = this.waitFor<AckEvent>((e) => e.ev === 'ack' && e.kind === kind, { timeoutMs: 6000 });
    ackP.catch(() => undefined); // 전송 중 끊겨 먼저 거부돼도 "처리 안 된 거부"가 되지 않게 (아래 await 에서 그대로 받음)
    try {
      await this.send(cmd);
    } catch (e: any) {
      patchJob({ status: 'error', error: e?.message ?? String(e), finishedAt: Date.now() });
      throw e;
    }
    try {
      return await ackP;
    } catch (e: any) {
      const cur = useDevice.getState().job;
      const mine = !!cur && cur.id === id && cur.status === 'pending';
      if (e instanceof DeviceError && e.code !== 'TIMEOUT') {
        // 기기가 거부함 (apply('error') 가 이미 error 로 바꿨지만 혹시 몰라 한 번 더)
        if (mine) patchJob({ status: 'error', error: e.message, finishedAt: Date.now() });
        throw e;
      }
      if (mine) {
        patchJob({ uncertain: true, error: '기기 응답 확인 중' });
        // 연결이 살아 있으면 바로 상태를 물어 확정 (끊겼으면 재연결 직후 onConnected 의 status 로 확인)
        if (this.isConnected) this.send({ cmd: 'status' }).catch(() => undefined);
      }
      throw new DeviceError('UNCERTAIN', '명령은 보냈지만 기기의 응답을 아직 받지 못했어요. 진행 화면에서 확인할게요.');
    }
  }

  /**
   * 제조 시작. onStart: 로컬 작업(id·localKey)을 만든 직후 1번 호출 — 명령 전송·ack 전이라 늦게 끝나도
   * 이 작업이 어떤 레시피였는지 기억해 둘 수 있음 (brew.ts 가 작업별 레시피 스냅샷 저장에 사용)
   */
  make(steps: MakeStep[], mode: 'seq' | 'par' = 'seq', opts: { onStart?: (job: JobState) => void } = {}) {
    const id = newJobId();
    return this.startJob({ cmd: 'make', id, mode, steps }, id, 'make', steps, {}, opts.onStart);
  }

  /** 펌프 구동. purpose 'prime' = 프라이밍(실제 재료가 나오므로 끝나면 잔량 차감) */
  run(p: number, ms: number, opts: { purpose?: 'prime' } = {}) {
    const st = useDevice.getState();
    const v = validateRun(p, ms, st.info?.pumps ?? useSlots.getState().slots.length);
    if (!v.ok) return Promise.reject(new DeviceError(v.code!, errorCodeMessage(v.code!, v.msg)));
    const cal = st.cal;
    const mlps = cal?.[p - 1] ?? LIMITS.defaultMlps;
    const msInt = Math.max(1, Math.min(LIMITS.maxRunMs, Math.round(ms)));
    return this.startJob(
      { cmd: 'run', p, ms: msInt },
      'run',
      'run',
      [{ p, ml: Math.round((msInt / 1000) * mlps * 10) / 10 }],
      opts.purpose ? { purpose: opts.purpose } : {},
    );
  }

  clean(ms: number) {
    const v = validateClean(ms);
    if (!v.ok) return Promise.reject(new DeviceError(v.code!, errorCodeMessage(v.code!, v.msg)));
    const n = useDevice.getState().info?.pumps ?? useSlots.getState().slots.length;
    const cal = useDevice.getState().cal;
    const msInt = Math.max(1, Math.min(LIMITS.maxCleanMs, Math.round(ms)));
    const steps = Array.from({ length: n }, (_, i) => ({
      p: i + 1,
      ml: Math.round((msInt / 1000) * (cal?.[i] ?? LIMITS.defaultMlps) * 10) / 10,
    }));
    return this.startJob({ cmd: 'clean', ms: msInt }, 'clean', 'clean', steps);
  }

  /**
   * 비상 정지 — 연결 상태와 상관없이 최대한 빨리 전송.
   * 진행 중 작업이 있으면 보낸 시각을 남기고, STOP_CONFIRM_MS 뒤에도 stopped 가 없으면 status 로 확인
   * (혼잡으로 stopped 줄을 놓쳐도 끝날 시각까지 "제조 중"으로 남지 않게)
   */
  async stop() {
    const j = useDevice.getState().job;
    if (j && j.status === 'running') {
      patchJob({ stopSentAt: Date.now() });
      const key = j.localKey;
      setTimeout(() => {
        const cur = useDevice.getState().job;
        if (cur && cur.localKey === key && this.isConnected) this.pollOverdueJob(cur, Date.now());
      }, STOP_CONFIRM_MS + 100);
    }
    await this.transport?.write(encodeCommand({ cmd: 'stop' }));
  }

  /**
   * 끝난 작업 표시 지우기 (제조 화면·유지보수 카드의 "닫기", "기기 탭에서 다시 연결", "한 잔 더" 등).
   * 결과를 모른 채 정리한 작업이면 화면에서만 지우고 pendingCheck 로 남겨 재연결 뒤 결과를 확인함 (SPEC §2.4 ②)
   */
  clearJob() {
    const job = useDevice.getState().job;
    if (!job || isBusy(job)) return;
    if (isUnresolved(job)) this.pendingCheck = job;
    setDevice({ job: null });
  }

  /**
   * 제조 화면에서 사용자가 "닫기"를 누름 (연결이 끊긴 상태에서만): 진행 중 작업을 "결과 모름"으로 정리.
   * 자동 재연결은 계속하고, 다시 연결됐을 때 기기가 아직 작업 중이면 작업을 되살림 (화면을 닫아도 — clearJob 의 pendingCheck).
   */
  abandonJob() {
    if (this.isConnected) return;
    this.abandonBusyJob();
  }

  /**
   * 연결이 끊긴 채 더 이상 기다리지 않을 때(재연결 포기·자동 재연결 꺼짐·블루투스 꺼짐·연결 해제·사용자가 닫음):
   * 진행 중 작업을 확정해 제조 화면에 갇히지 않게 함
   *  - running → stopped(reason 'disconnected', uncertain). dispensed = 받은 진행량(하한값) → 잔량 차감·기록·알림
   *  - pending(ack 못 받음) → error(uncertain): 시작했는지 모름 → 차감·기록 없음
   */
  private abandonBusyJob() {
    const job = useDevice.getState().job;
    if (!job || !isBusy(job)) return;
    const now = Date.now();
    if (job.status === 'pending') {
      setDevice({
        job: {
          ...job,
          status: 'error',
          reason: 'disconnected',
          uncertain: true,
          finishedAt: now,
          error: '기기와 연결이 끊겨 작업을 시작했는지 확인하지 못했어요. 기기와 잔을 직접 확인해 주세요.',
        },
      });
      return;
    }
    const stopped: JobState = {
      ...job,
      status: 'stopped',
      reason: 'disconnected',
      uncertain: true,
      finishedAt: now,
      dispensed: progressDispensed(job),
    };
    setDevice({ job: stopped });
    this.finish(stopped);
  }

  /**
   * 재연결 후 기기가 idle 이고 status.last 가 이 작업의 결과임 (SPEC §2.4 ②) → 그 결과를 그대로 확정 (uncertain 아님)
   *  - done → done, dispensed = last.dispensed (목표량)
   *  - stopped → stopped(reason = last.reason: user·button·error), dispensed = last.dispensed (구동시간 비율로 추정한 양)
   * 이미 "결과 모름"으로 정리했던 작업이면 같은 id 로 다시 끝냄 → brew.ts 가 잔량은 처음 차감한 양과의 차이만 빼고 기록은 갱신
   * show=false: 사용자가 화면을 닫은 작업(pendingCheck) — 화면(useDevice.job)에는 다시 올리지 않고 기록·잔량만 바로잡음
   */
  private resolveFromLast(job: JobState, last: StatusLast, show = true) {
    const now = Date.now();
    const dispensed = last.dispensed.map((d) => ({ ...d }));
    // 앱이 모르던 작업(펌프 목록 없음)은 기기가 알려준 양으로 목록을 만듦
    const pumps = job.pumps.length ? job.pumps : dispensed.map((d) => ({ p: d.p, target: d.ml, done: 0, finished: false }));
    const base = { ...job, error: undefined, uncertain: undefined, finishedAt: now, dispensed };
    const end: JobState =
      last.result === 'done'
        ? {
            ...base,
            status: 'done',
            reason: undefined,
            pct: 100,
            pumps: pumps.map((p) => {
              const d = dispensed.find((x) => x.p === p.p);
              return { ...p, done: d ? d.ml : p.target, finished: true };
            }),
          }
        : {
            ...base,
            status: 'stopped',
            reason: last.reason ?? 'unknown',
            pumps: pumps.map((p) => {
              // 기기의 stopped dispensed 는 0ml 펌프를 생략 → 목록에 없으면 0
              const d = dispensed.find((x) => x.p === p.p);
              const ml = d ? d.ml : 0;
              return { ...p, done: ml, finished: p.target > 0 && ml >= p.target - 0.05 };
            }),
          };
    if (show) setDevice({ job: end });
    this.finish(end);
  }

  /**
   * 기기가 idle 이라고 알려 옴 → 끝나지 않은(또는 결과를 모르는) 작업 판정 (SPEC §2.4 ②→③·④)
   * show=false: 화면을 닫아 둔 작업(pendingCheck) — 화면은 다시 열지 않음
   */
  private settleIdle(job: JobState, last: StatusLast | null, show = true) {
    if (last && lastMatchesJob(job, last)) {
      // ② 끊긴 사이에 끝난 작업의 실제 결과를 기기가 알려 줌 → 그대로 확정 (경과 시간 추정보다 우선)
      this.resolveFromLast(job, last, show);
    } else if (
      job.status === 'running' ||
      (job.status === 'pending' && job.uncertain) ||
      (job.status === 'stopped' && job.reason === 'disconnected')
    ) {
      // ③·④ 결과를 알 수 없음 → 재부팅 여부·경과 시간으로 판단
      this.resolveIdleJob(job, show);
    }
  }

  /**
   * 재연결 후 기기가 idle 인데 앱에는 끝나지 않은(또는 결과를 모르는) 작업이 있고, status.last 로는 결과를 알 수 없음
   * (last 가 없음·다른 작업·예전 펌웨어 — SPEC §2.4 ③·④)
   *  - pending(ack 못 받음) → error: 시작하지 않았거나 끊긴 동안 끝남
   *  - ③ 가동시간(pong.up)이 작업 시작 후 경과시간보다 짧음 = 부팅 시각이 작업 시작(ack) 뒤 → "재부팅으로 중단(양 모름)":
   *    stopped(reason reboot, uncertain), dispensed = 받은 진행량(하한값)
   *    ack 를 못 받은 작업은 status running·progress 를 받은 시각(runningSeenAt)을 씀 — 작업은 그 전에 시작했으므로
   *    부팅 시각이 그보다 뒤면 확실히 작업 시작 뒤의 재부팅 (거짓 판정 없음)
   *  - ④ "결과 확인 필요": 예상 시간보다 일찍 idle 이면 정상 완료일 수 없음 → stopped(unknown, uncertain, 받은 진행량),
   *    아니면 계획량만큼 나온 것으로 간주(done, uncertain) — 시간이 다 지난 뒤 정지 버튼으로 멈춘 경우와는 구분할 수 없음
   */
  private resolveIdleJob(job: JobState, show = true) {
    const now = Date.now();
    if (job.status === 'pending') {
      if (!show) return;
      setDevice({
        job: {
          ...job,
          status: 'error',
          uncertain: true,
          finishedAt: now,
          error: '기기가 작업을 시작하지 않았거나, 연결이 끊긴 동안 끝났어요. 잔을 직접 확인해 주세요.',
        },
      });
      return;
    }
    const ackAt = job.ackAt;
    /** 작업 시작 시각(또는 그 상한) */
    const startedBy = ackAt ?? job.runningSeenAt ?? null;
    const boot = this.bootAt;
    // up < (now − 시작 시각) ⇔ 부팅 시각(now − up) > 시작 시각
    const rebooted = startedBy != null && boot != null && boot > startedBy;
    const early = ackAt != null && job.totalMs > 0 && now - ackAt < job.totalMs - EARLY_IDLE_MARGIN_MS;
    if (rebooted || early) {
      const stopped: JobState = {
        ...job,
        status: 'stopped',
        reason: rebooted ? 'reboot' : 'unknown',
        uncertain: true,
        finishedAt: now,
        dispensed: progressDispensed(job),
      };
      if (show) setDevice({ job: stopped });
      this.finish(stopped);
      return;
    }
    const done: JobState = {
      ...job,
      status: 'done',
      reason: undefined,
      pct: 100,
      uncertain: true,
      finishedAt: now,
      dispensed: job.pumps.map((p) => ({ p: p.p, ml: p.target })),
      pumps: job.pumps.map((p) => ({ ...p, done: p.target, finished: true })),
    };
    if (show) setDevice({ job: done });
    this.finish(done);
  }

  // ───────────────────────── 수신 ─────────────────────────

  private handleLine(line: string) {
    const e = parseEvent(line);
    this.unansweredPings = 0;
    setDevice({ lastSeenAt: Date.now() });
    if (!e) return;
    this.apply(e);
    for (const w of Array.from(this.waiters)) {
      if (w.match(e)) {
        clearTimeout(w.timer);
        this.waiters.delete(w);
        w.resolve(e);
      } else if (e.ev === 'error' && w.failOnError) {
        clearTimeout(w.timer);
        this.waiters.delete(w);
        w.reject(new DeviceError(e.code, errorCodeMessage(e.code, e.msg)));
      }
    }
  }

  private finish(job: JobState) {
    for (const l of Array.from(this.jobEnd)) {
      try {
        l(job);
      } catch (err) {
        console.warn('[device] jobEnd listener error', err);
      }
    }
  }

  /** 화면을 닫아 둔 "결과 모름" 작업(pendingCheck)이 이 id 의 작업이면 꺼냄 (꺼내면 pendingCheck 는 비움) */
  private takePending(id: string): JobState | null {
    const pc = this.pendingCheck;
    if (!pc || pc.id !== id) return null;
    this.pendingCheck = null;
    return pc;
  }

  /**
   * 기기가 알려 준 실제 이름(info.name, 예: SmartBartender-A1B2)으로 기억한 기기 이름을 맞춤 (DEV-1).
   * 검색 없이 자동 재연결하면 통신 방식이 이름을 몰라 기본 이름으로 기억될 수 있음 → 여러 대를 구분하는 끝자리를 잃지 않게 (SPEC §5.5)
   */
  private rememberRealName(name: unknown) {
    if (typeof name !== 'string' || !name.trim() || !this.transport || !this.isConnected) return;
    const kind = this.transport.kind;
    const id = useDevice.getState().deviceId ?? this.targetId;
    const saved = useSettings.getState().lastDevices?.[kind];
    if (!id || !saved || saved.id !== id || saved.name === name) return;
    useSettings.getState().rememberDevice(kind, id, name);
  }

  private apply(e: DeviceEvent) {
    const st = useDevice.getState();
    switch (e.ev) {
      case 'info':
        setDevice({
          info: e,
          cal: Array.isArray(e.cal) ? e.cal : st.cal,
          calSet: parseCalSet(e.calSet, e.pumps),
          maxPumpMs: parseMaxPumpMs(e.maxPumpMs),
          deviceName: e.name || st.deviceName,
        });
        this.rememberRealName(e.name);
        break;
      case 'cal': {
        // v2.0 펌웨어는 cal 에 calSet 이 없음 → 기존 값 유지
        const calSet = parseCalSet(e.calSet, st.info?.pumps);
        setDevice({ cal: Array.isArray(e.cal) ? e.cal : st.cal, ...(calSet ? { calSet } : {}) });
        break;
      }
      case 'pong':
        if (typeof e.up === 'number' && Number.isFinite(e.up)) this.bootAt = Date.now() - e.up;
        setDevice({ uptimeMs: e.up });
        break;
      case 'status': {
        const job = st.job;
        if (e.state === 'running' && e.job) {
          this.lastJobLineAt = Date.now();
          if (!job || job.id !== e.job.id || !isBusy(job)) {
            // 앱이 진행 중으로 알던 작업과 다른 작업을 기기가 하고 있음(그 사이 끝나고 버튼 다시 만들기 등) →
            // 알던 작업의 결과는 status.last 에 있으면 먼저 그것으로 확정 (그냥 덮어쓰면 기록·잔량 차감이 빠짐)
            if (job && isBusy(job) && job.id !== e.job.id) {
              const last = parseStatusLast(e.last);
              if (last && lastMatchesJob(job, last)) this.resolveFromLast(job, last, false);
            }
            // 재연결했더니 기기가 작업 중 → 진행 상황 표시
            // (앱이 "시작 못 함/결과 모름"으로 정리했던 같은 작업이면 — 화면을 닫아 둔 작업(pendingCheck) 포함 —
            //  펌프 목록·시간을 유지한 채 되살림. 결과가 확정된 작업과 id 만 같으면(다시 만들기) 새 작업)
            const prev = job ? (job.id === e.job.id ? job : null) : this.takePending(e.job.id);
            this.pendingCheck = null;
            const now = Date.now();
            setDevice({
              job:
                prev && !isConfirmed(prev)
                  ? revived(prev, {
                      kind: e.job.kind,
                      pct: Math.max(prev.pct, e.job.pct),
                      ...(prev.ackAt == null ? { runningSeenAt: prev.runningSeenAt ?? now } : {}),
                    })
                  : newDeviceJob(e.job.id, e.job.kind, { pct: e.job.pct, prev }),
            });
          } else {
            // 진행 중·확인 중(ack 못 받음)인 같은 작업 — ack 가 없었으면 지금이 작업 시작 시각의 상한 (SPEC §2.4 ③ 판정용)
            patchJob((j) => ({
              pct: e.job!.pct,
              status: 'running',
              uncertain: undefined,
              error: undefined,
              ...(j.ackAt == null && j.runningSeenAt == null ? { runningSeenAt: Date.now() } : {}),
            }));
          }
        } else if (e.state === 'idle') {
          const last = parseStatusLast(e.last);
          const pc = this.pendingCheck;
          this.pendingCheck = null;
          if (job) this.settleIdle(job, last);
          // 화면을 닫아 둔 "결과 모름" 작업 → 기록·잔량만 바로잡음 (화면은 다시 열지 않음)
          else if (pc) this.settleIdle(pc, last, false);
        }
        break;
      }
      case 'ack': {
        this.lastJobLineAt = Date.now();
        const j = st.job;
        if (j && (j.id === e.id || j.kind === e.kind) && j.status === 'pending') {
          patchJob({ status: 'running', totalMs: e.totalMs, ackAt: Date.now(), id: e.id, uncertain: undefined, error: undefined });
        } else if (!j || !isBusy(j)) {
          // 늦게 온 ack: "시작 못 함/결과 모름"으로 정리했던 같은 작업이면(화면을 닫아 둔 작업 포함) 펌프 목록을 유지한 채 되살림.
          // 결과가 확정된 작업과 id 만 같으면 새 작업 (펌웨어 BUTTON_REPEAT_LAST 다시 만들기는 같은 id 를 다시 씀)
          const prev = j ? (j.id === e.id ? j : null) : this.takePending(e.id);
          this.pendingCheck = null;
          setDevice({
            job:
              prev && !isConfirmed(prev)
                ? revived(prev, { kind: e.kind, totalMs: e.totalMs, ackAt: Date.now() })
                : newDeviceJob(e.id, e.kind, { totalMs: e.totalMs, ackAt: Date.now(), prev }),
          });
        }
        break;
      }
      case 'progress': {
        this.lastJobLineAt = Date.now();
        if (isRevivable(st.job) && st.job.id === e.id) setDevice({ job: revived(st.job) });
        else if (!st.job) {
          // 화면을 닫아 둔 "결과 모름" 작업이 아직 진행 중 → 되살림 (진행 화면이 다시 열림)
          const pc = this.takePending(e.id);
          if (pc && !isConfirmed(pc)) setDevice({ job: revived(pc) });
        }
        patchJob((j) => {
          const pumps = j.pumps.some((p) => p.p === e.p)
            ? j.pumps.map((p) => (p.p === e.p ? { ...p, done: e.doneMl, target: e.ml || p.target } : p))
            : [...j.pumps, { p: e.p, target: e.ml, done: e.doneMl, finished: false }];
          return {
            pct: Math.max(j.pct, e.pct),
            pumps,
            status: j.status === 'pending' ? 'running' : j.status,
            ...(j.status === 'pending' ? { uncertain: undefined, error: undefined } : {}),
            // ack 없이 진행 중임을 확인 → 작업 시작 시각의 상한 (SPEC §2.4 ③ 판정용)
            ...(j.ackAt == null && j.runningSeenAt == null ? { runningSeenAt: Date.now() } : {}),
          };
        });
        break;
      }
      case 'step':
        this.lastJobLineAt = Date.now();
        patchJob((j) => ({
          pumps: j.pumps.some((p) => p.p === e.p)
            ? j.pumps.map((p) => (p.p === e.p ? { ...p, done: e.ml, target: e.ml, finished: true } : p))
            : [...j.pumps, { p: e.p, target: e.ml, done: e.ml, finished: true }],
        }));
        break;
      case 'done': {
        const cur = useDevice.getState().job;
        // 화면을 닫아 둔 "결과 모름" 작업의 실제 결과 → 기록·잔량만 바로잡음 (화면은 다시 열지 않음)
        const job = cur ?? this.takePending(e.id);
        if (!job) break;
        const dispensed = e.dispensed ?? [];
        const sim = (e as any).sim?.actualMl;
        const done: JobState = {
          ...job,
          status: 'done',
          reason: undefined,
          error: undefined,
          uncertain: undefined,
          pct: 100,
          finishedAt: Date.now(),
          dispensed,
          simActualMl: typeof sim === 'number' ? sim : undefined,
          pumps: job.pumps.map((p) => {
            const d = dispensed.find((x) => x.p === p.p);
            return { ...p, done: d ? d.ml : p.target, finished: true };
          }),
        };
        if (cur) setDevice({ job: done });
        this.finish(done);
        break;
      }
      case 'stopped': {
        const cur = useDevice.getState().job;
        // 진행 중 작업, 또는 앱이 "결과 모름"으로 정리했던 같은 id 의 작업(실제 결과로 바로잡음 — 화면을 닫아 둔 작업 포함)
        const job = cur ?? (e.id ? this.takePending(e.id) : null);
        if (!job || !(isBusy(job) || (isRevivable(job) && e.id === job.id))) break;
        const dispensed = e.dispensed ?? [];
        const stopped: JobState = {
          ...job,
          status: 'stopped',
          reason: e.reason,
          error: undefined,
          uncertain: undefined,
          finishedAt: Date.now(),
          dispensed,
          pumps: job.pumps.map((p) => {
            const d = dispensed.find((x) => x.p === p.p);
            return { ...p, done: d ? d.ml : p.finished ? p.done : Math.min(p.done, p.target) };
          }),
        };
        if (cur) setDevice({ job: stopped });
        this.finish(stopped);
        break;
      }
      case 'error':
        setDevice({ lastError: errorCodeMessage(e.code, e.msg) });
        if (st.job && st.job.status === 'pending') {
          patchJob({ status: 'error', error: errorCodeMessage(e.code, e.msg), finishedAt: Date.now() });
        }
        break;
    }
  }

  /** 데모 전용: 가상 기기의 물리 버튼 누르기 */
  pressDemoButton() {
    const t = this.transport;
    if (t instanceof DemoTransport) t.virtual?.pressButton();
  }

  /** 데모 전용: 안전장치(펌프 과구동) 작동 흉내 → stopped(reason "error") */
  triggerDemoSafetyStop() {
    const t = this.transport;
    if (t instanceof DemoTransport) t.virtual?.triggerSafetyStop();
  }

  /** 데모 전용: 가상 기기 유량표를 "캘리브레이션 전" 상태로 되돌림 */
  async resetDemoCalibration() {
    const t = this.transport;
    if (!(t instanceof DemoTransport)) return;
    await clearDemoCal();
    t.virtual?.resetCalibration();
  }
}

export const deviceClient = new DeviceClient();
