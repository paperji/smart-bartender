/**
 * 가상 칵테일 메이커 (데모 모드용 펌웨어 시뮬레이터) — SPEC §2 v2.1 펌웨어처럼 동작
 * - 검증 순서·오류 코드: validateMake / validateRun / validateClean (펌웨어와 동일 규칙)
 * - 구동시간(ms) = ml / mlps × 1000, 순차 모드 펌프 사이 300ms 휴지, 병렬 모드 0.1초 간격 기동
 * - 약 250ms 간격 progress(pct = Σ나온 양/Σ목표량, 완료 전 최대 99), 펌프 완료 시 step, 전체 완료 시 done
 * - info: fw "2.1.0-demo", calSet(캘리브레이션 저장 여부), maxPumpMs 120000
 * - status: state·job + last(부팅 후 마지막으로 끝난 작업 — id·kind·result(done|stopped)·reason·dispensed, 펌웨어와 같은 형식, SPEC §2.4)
 *   → 앱이 연결이 끊긴 동안 끝난 작업의 실제 결과를 재연결 뒤 확인. 재부팅(simulateReboot)하면 last 는 null
 * - '{' 로 시작한 객체의 괄호가 모두 닫히면 '\n' 없이도 한 메시지로 처리 (nRF Connect 편의 기능)
 * 순수 TypeScript (setTimeout 만 사용) → Node 테스트에서도 실행 가능.
 */
import {
  DEVICE_RX_MAX,
  LIMITS,
  normalizeJobId,
  round1,
  validateClean,
  validateMake,
  validateRun,
  type ErrorCode,
  type JobKind,
  type MakeStep,
  type StatusLast,
} from '../protocol';
import { utf8Decode, utf8Encode } from '../utf8';

export const DEMO_FW_VERSION = '2.1.0-demo';

/** 가상 펌프의 "실제" 유량(ml/s) — SPEC §1 의 체크밸브 포함 예상 유량(3~6ml/s)에 맞춤 */
export const DEMO_TRUE_MLPS = [4.6, 3.9, 5.2, 4.3, 4.8, 4.1, 5.0, 3.7];

export interface VirtualDeviceOptions {
  pumps?: number;
  /** 저장된 유량표(ml/s) */
  cal?: number[];
  /** 펌프별 캘리브레이션 저장 여부(1/0) */
  calSet?: number[];
  /** 가상 펌프의 "실제" 유량(ml/s) — 캘리브레이션 체험용 */
  trueMlps?: number[];
  name?: string;
  fw?: string;
  /** 1 = 실제 시간, 0.1 = 10배 빠르게 (테스트용) */
  timeScale?: number;
  /** 응답 지연(ms, 실제 시간) */
  latencyMs?: number;
  progressIntervalMs?: number;
  /** 유량표가 바뀌어 "NVS 에 저장"될 때 호출 (앱이 AsyncStorage 에 보관 → 새로고침 후에도 유지) */
  onCalChange?: (cal: number[], calSet: number[]) => void;
  /** false 면 status 에 last 를 넣지 않음 — 예전(v2.0) 펌웨어 흉내 (테스트용, 기본 true) */
  reportLast?: boolean;
}

interface SimSlot {
  p: number;
  ml: number;
  ms: number;
  /** job 시작 기준 오프셋(ms) */
  start: number;
  reported: boolean;
}

interface SimJob {
  id: string;
  kind: JobKind;
  parallel: boolean;
  slots: SimSlot[];
  totalMs: number;
  /** Date.now() 실제 시각 */
  t0: number;
  /** 병렬 모드 progress 순번(라운드로빈) */
  rr: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export class VirtualBartender {
  readonly pumps: number;
  readonly name: string;
  readonly fw: string;
  cal: number[];
  calSet: number[];
  trueMlps: number[];
  private readonly timeScale: number;
  private readonly latencyMs: number;
  private readonly progressIntervalMs: number;
  private readonly onCalChange?: (cal: number[], calSet: number[]) => void;
  /** 기동 시각 (pong.up 계산용) — simulateReboot 로 다시 정함 */
  private bootAt = Date.now();
  /** 부팅 후 마지막으로 끝난 작업 (status.last) */
  private last: StatusLast | null = null;
  /** status 에 last 를 넣을지 (false = 예전 펌웨어 흉내) */
  reportLast: boolean;
  private rx: number[] = [];
  private overflow = false;
  /** '{' 편의 모드: 괄호 깊이 추적 */
  private depth = 0;
  private inString = false;
  private escape = false;
  /** 0 = 아직 모름, 1 = '{' 로 시작한 객체, 2 = 그 밖의 메시지('\n' 까지 기다림) */
  private shape: 0 | 1 | 2 = 0;
  private job: SimJob | null = null;
  private calDirty = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(
    private readonly emitLine: (line: string) => void,
    opts: VirtualDeviceOptions = {},
  ) {
    this.pumps = Math.max(1, Math.min(8, opts.pumps ?? 4));
    this.name = opts.name ?? 'SmartBartender-DEMO';
    this.fw = opts.fw ?? DEMO_FW_VERSION;
    this.cal = fit(opts.cal, this.pumps, LIMITS.defaultMlps).map((v) =>
      v >= LIMITS.minMlps && v <= LIMITS.maxMlps ? v : LIMITS.defaultMlps,
    );
    this.calSet = fit(opts.calSet, this.pumps, 0).map((v) => (v ? 1 : 0));
    this.trueMlps = fit(opts.trueMlps ?? DEMO_TRUE_MLPS, this.pumps, 4.5);
    this.timeScale = opts.timeScale ?? 1;
    this.latencyMs = opts.latencyMs ?? 25;
    this.progressIntervalMs = opts.progressIntervalMs ?? 250;
    this.onCalChange = opts.onCalChange;
    this.reportLast = opts.reportLast !== false;
  }

  get state(): 'idle' | 'running' {
    return this.job ? 'running' : 'idle';
  }

  /** 테스트/시연용: 마지막으로 끝난 작업 (status.last 와 같은 값) */
  get lastJob(): StatusLast | null {
    return this.last ? { ...this.last, dispensed: this.last.dispensed.map((d) => ({ ...d })) } : null;
  }

  /** 앱이 RX 특성에 쓴 문자열 (편의용) */
  receive(text: string) {
    this.receiveBytes(utf8Encode(text));
  }

  /** 앱이 RX 특성에 쓴 바이트 조각 — '\n'(또는 닫힌 '{…}')까지 누적 (최대 1024바이트) */
  receiveBytes(chunk: ArrayLike<number>) {
    if (this.destroyed) return;
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i] & 0xff;
      if (b === 0x0a) {
        if (this.overflow) {
          this.overflow = false;
          this.resetRx();
          continue;
        }
        this.flushLine();
        continue;
      }
      if (this.overflow) continue;
      this.rx.push(b);
      if (this.rx.length > DEVICE_RX_MAX) {
        // 버퍼 초과 → 폐기 후 TOO_LONG 1회 (다음 '\n' 까지 무시)
        this.resetRx();
        this.overflow = true;
        this.error('TOO_LONG', '명령이 너무 깁니다');
        continue;
      }
      this.trackObject(b);
    }
  }

  /**
   * 기기의 물리 버튼(GPIO4) 짧게 누름 시뮬레이션 — 펌웨어 SmartBartender.ino updateButton 과 같음:
   * 제조 중이면 비상정지(stopped, reason "button"), 대기 중이면 상태(status) 출력
   */
  pressButton() {
    if (this.job) this.catchUp(this.job, this.elapsed()); // 방금 끝난 작업은 먼저 done 처리 (펌웨어 loop 와 같음)
    if (this.job) this.stopJob('button');
    else this.send(this.statusEvent());
  }

  /**
   * 데모 전용: 안전 감시(펌프가 최대 구동시간 + 1초 넘게 켜짐)가 작동한 상황을 흉내냄
   * → stopped(reason "error") + error/LIMIT (SPEC §2.3 안전 감시)
   */
  triggerSafetyStop() {
    if (this.job) this.catchUp(this.job, this.elapsed());
    if (!this.job) return;
    this.stopJob('error');
    this.error('LIMIT', `안전 제한(${Math.round(LIMITS.maxPumpMs / 1000)}초) 초과로 모든 펌프를 정지했습니다`);
  }

  /**
   * 데모·테스트 전용: 전원이 끊겼다 다시 켜짐 — 진행 중 작업은 이벤트 없이 멈추고(펌프 OFF),
   * 가동시간(pong.up)은 0 부터 다시, status.last 는 null (부팅 후 끝난 작업이 없음). 유량표(NVS)는 유지
   */
  simulateReboot() {
    this.clearTicker();
    this.job = null;
    this.last = null;
    this.calDirty = false;
    this.overflow = false;
    this.resetRx();
    this.bootAt = Date.now();
  }

  /** 데모 전용: 유량표를 기본값(20ml/s, 캘리브레이션 전)으로 되돌림 */
  resetCalibration() {
    this.cal = new Array(this.pumps).fill(LIMITS.defaultMlps);
    this.calSet = new Array(this.pumps).fill(0);
    this.onCalChange?.(this.cal.slice(), this.calSet.slice());
    this.send(this.calEvent());
  }

  destroy() {
    this.destroyed = true;
    this.clearTicker();
    this.job = null;
  }

  // ───────────────────────── 수신 버퍼 ─────────────────────────

  private resetRx() {
    this.rx = [];
    this.depth = 0;
    this.inString = false;
    this.escape = false;
    this.shape = 0;
  }

  private flushLine() {
    const line = utf8Decode(this.rx).replace(/\r$/, '');
    this.resetRx();
    if (line.trim()) this.handle(line);
  }

  /** '{' 로 시작한 객체의 괄호가 모두 닫히면 바로 처리 (문자열 안의 괄호는 무시) */
  private trackObject(b: number) {
    if (this.shape === 2) return;
    if (this.shape === 0) {
      if (b === 0x20 || b === 0x09 || b === 0x0d) return;
      if (b === 0x7b /* { */) {
        this.shape = 1;
        this.depth = 1;
      } else {
        this.shape = 2;
      }
      return;
    }
    if (this.inString) {
      if (this.escape) this.escape = false;
      else if (b === 0x5c /* \ */) this.escape = true;
      else if (b === 0x22 /* " */) this.inString = false;
      return;
    }
    if (b === 0x22) this.inString = true;
    else if (b === 0x7b) this.depth++;
    else if (b === 0x7d /* } */) {
      this.depth--;
      if (this.depth === 0) this.flushLine();
    }
  }

  // ───────────────────────── 송신 ─────────────────────────

  private send(obj: unknown) {
    if (this.destroyed) return;
    const line = JSON.stringify(obj);
    if (this.latencyMs <= 0) this.emitLine(line);
    else setTimeout(() => !this.destroyed && this.emitLine(line), this.latencyMs);
  }

  private error(code: ErrorCode, msg: string) {
    this.send({ ev: 'error', code, msg });
  }

  private uptime() {
    return Date.now() - this.bootAt;
  }

  private calEvent() {
    return { ev: 'cal', cal: this.cal.map(round2), calSet: this.calSet.slice() };
  }

  // ───────────────────────── 명령 처리 ─────────────────────────

  private handle(line: string) {
    // 펌웨어는 loop() 마다(약 1ms) 펌프 시각을 확인한 뒤 명령을 처리 → 틱(250ms)을 기다리지 않고 지금까지 끝난 펌프·작업부터 반영
    if (this.job) this.catchUp(this.job, this.elapsed());
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      this.error('BAD_JSON', 'JSON 형식이 올바르지 않습니다');
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      this.error('BAD_JSON', 'JSON 객체({...}) 형식이어야 합니다');
      return;
    }
    switch (msg.cmd) {
      case 'hello':
        this.send({
          ev: 'info',
          fw: this.fw,
          name: this.name,
          pumps: this.pumps,
          cal: this.cal.map(round2),
          calSet: this.calSet.slice(),
          maxMl: LIMITS.maxTotalMl,
          maxStepMl: LIMITS.maxStepMl,
          maxPumpMs: LIMITS.maxPumpMs,
          state: this.state,
        });
        return;
      case 'status':
        this.send(this.statusEvent());
        return;
      case 'ping':
        this.send({ ev: 'pong', up: this.uptime() });
        return;
      case 'getcal':
        this.send(this.calEvent());
        return;
      case 'setcal':
        this.cmdSetCal(msg);
        return;
      case 'stop':
        if (this.job) this.stopJob('user');
        else this.send(this.statusEvent());
        return;
      case 'make':
        this.cmdMake(msg);
        return;
      case 'run':
        this.cmdRun(msg);
        return;
      case 'clean':
        this.cmdClean(msg);
        return;
      default:
        this.error('UNKNOWN_CMD', `알 수 없는 명령: ${String(msg.cmd)}`);
    }
  }

  /** status 이벤트 — 펌웨어와 같은 형식: {"ev":"status","state":…,"job":…,"last":{…}|null} (reportLast=false 면 last 없음) */
  private statusEvent() {
    const ev: Record<string, unknown> = !this.job
      ? { ev: 'status', state: 'idle', job: null }
      : {
          ev: 'status',
          state: 'running',
          job: { id: this.job.id, kind: this.job.kind, pct: this.pct(this.elapsed()) },
        };
    if (this.reportLast) ev.last = this.lastJob;
    return ev;
  }

  private cmdSetCal(msg: any) {
    const p = msg.p;
    const mlps = msg.mlps;
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > this.pumps) {
      this.error('BAD_PUMP', `펌프 번호(p)는 1 ~ ${this.pumps} 사이 정수여야 합니다`);
      return;
    }
    if (typeof mlps !== 'number' || !Number.isFinite(mlps) || mlps < LIMITS.minMlps - 1e-9 || mlps > LIMITS.maxMlps + 1e-9) {
      this.error('BAD_AMOUNT', '유량(mlps)은 0.5 ~ 100 사이 숫자여야 합니다');
      return;
    }
    this.cal[p - 1] = mlps;
    this.calSet[p - 1] = 1;
    // 제조 중이면 "플래시 저장"은 작업이 끝난 뒤 (펌웨어와 동일)
    if (this.job) this.calDirty = true;
    else this.onCalChange?.(this.cal.slice(), this.calSet.slice());
    this.send(this.calEvent());
  }

  private cmdMake(msg: any) {
    if (this.job) {
      this.error('BUSY', '이미 제조 중입니다');
      return;
    }
    const v = validateMake(msg.steps, this.pumps, this.cal, msg.mode);
    if (!v.ok) {
      this.error(v.code!, v.msg!);
      return;
    }
    const parallel = msg.mode === 'par';
    let offset = 0;
    // 목표량은 반올림 전 값(펌웨어 targetMl 과 같음) — 진행률·중단 추정량을 펌웨어와 같게 계산하고, 이벤트로 내보낼 때만 소수 1자리
    const slots: SimSlot[] = v.exact.map((m, i) => {
      const ms = v.durations[i];
      const s: SimSlot = { p: m.p, ml: m.ml, ms, start: parallel ? i * LIMITS.parStaggerMs : offset, reported: false };
      offset += ms + LIMITS.seqRestMs;
      return s;
    });
    this.startJob({ id: normalizeJobId(msg.id), kind: 'make', parallel, slots, totalMs: v.totalMs, t0: Date.now(), rr: 0 });
  }

  private cmdRun(msg: any) {
    if (this.job) {
      this.error('BUSY', '이미 제조 중입니다');
      return;
    }
    const v = validateRun(msg.p, msg.ms, this.pumps);
    if (!v.ok) {
      this.error(v.code!, v.msg!);
      return;
    }
    const p = msg.p as number;
    const msInt = Math.max(1, Math.round(msg.ms as number));
    // 예상량 = ms × 유량 ÷ 1000 (펌웨어 addSlotByTime 과 같은 계산 순서 — 부동소수 오차까지 같게)
    const ml = (msInt * this.cal[p - 1]) / 1000;
    this.startJob({
      id: 'run',
      kind: 'run',
      parallel: false,
      slots: [{ p, ml, ms: msInt, start: 0, reported: false }],
      totalMs: msInt,
      t0: Date.now(),
      rr: 0,
    });
  }

  private cmdClean(msg: any) {
    if (this.job) {
      this.error('BUSY', '이미 제조 중입니다');
      return;
    }
    const v = validateClean(msg.ms);
    if (!v.ok) {
      this.error(v.code!, v.msg!);
      return;
    }
    const msInt = Math.max(1, Math.round(msg.ms as number));
    const slots: SimSlot[] = [];
    for (let p = 1; p <= this.pumps; p++) {
      slots.push({
        p,
        ml: (msInt * this.cal[p - 1]) / 1000,
        ms: msInt,
        start: (p - 1) * (msInt + LIMITS.seqRestMs),
        reported: false,
      });
    }
    const totalMs = this.pumps * msInt + LIMITS.seqRestMs * (this.pumps - 1);
    this.startJob({ id: 'clean', kind: 'clean', parallel: false, slots, totalMs, t0: Date.now(), rr: 0 });
  }

  // ───────────────────────── 작업 진행 ─────────────────────────

  private startJob(job: SimJob) {
    this.job = job;
    this.send({ ev: 'ack', id: job.id, kind: job.kind, totalMs: job.totalMs });
    this.clearTicker();
    this.ticker = setInterval(() => this.tick(), Math.max(10, this.progressIntervalMs * this.timeScale));
  }

  private elapsed(): number {
    if (!this.job) return 0;
    return (Date.now() - this.job.t0) / this.timeScale;
  }

  /** 슬롯이 지금까지 내보낸 양: 구동시간 비율 × 목표량 */
  private slotMl(s: SimSlot, e: number): number {
    if (e <= s.start) return 0;
    if (e >= s.start + s.ms) return s.ml;
    return ((e - s.start) / s.ms) * s.ml;
  }

  /** 전체 진행률(%) = Σ나온 양 ÷ Σ목표량 × 100 (완료 전 최대 99) */
  private pct(e: number): number {
    const job = this.job;
    if (!job) return 0;
    const sum = job.slots.reduce((a, s) => a + s.ml, 0);
    if (sum <= 0) return 0;
    const done = job.slots.reduce((a, s) => a + this.slotMl(s, e), 0);
    return Math.max(0, Math.min(99, Math.floor((done / sum) * 100)));
  }

  private tick() {
    const job = this.job;
    if (!job) {
      this.clearTicker();
      return;
    }
    const e = this.elapsed();
    if (this.catchUp(job, e)) return;
    // 진행 상황 (순차: 현재/다음 펌프, 병렬: 켜진 펌프를 돌아가며 1개씩)
    let s: SimSlot | undefined;
    if (!job.parallel) {
      s = job.slots.find((x) => e < x.start + x.ms);
    } else {
      for (let k = 0; k < job.slots.length; k++) {
        const idx = (job.rr + k) % job.slots.length;
        const x = job.slots[idx];
        if (e > x.start && e < x.start + x.ms) {
          s = x;
          job.rr = idx + 1;
          break;
        }
      }
    }
    if (s) {
      this.send({ ev: 'progress', id: job.id, p: s.p, ml: round1(s.ml), doneMl: round1(this.slotMl(s, e)), pct: this.pct(e) });
    }
  }

  /**
   * 지금(e)까지 끝난 펌프는 step, 모든 펌프가 끝났으면 done — 작업이 끝났으면 true.
   * 틱(약 250ms)마다, 그리고 명령·버튼을 처리하기 직전에 부름: 펌웨어는 loop() 마다 확인하므로 작업이 끝난 직후 온
   * status·stop·make 도 '끝난 상태'(idle + last)로 처리됨 (틱만 기다리면 최대 250ms 동안 running·BUSY 로 보였음).
   * step 은 펌프가 끝난 시각 순(같으면 펌프 순서) — 병렬 모드에서도 펌웨어와 같은 순서
   */
  private catchUp(job: SimJob, e: number): boolean {
    const due = job.slots.filter((s) => !s.reported && e >= s.start + s.ms).sort((a, b) => a.start + a.ms - (b.start + b.ms));
    for (const s of due) {
      s.reported = true;
      this.send({ ev: 'step', id: job.id, p: s.p, ml: round1(s.ml) });
    }
    if (e >= job.totalMs && job.slots.every((s) => s.reported)) {
      this.finishJob(job);
      return true;
    }
    return false;
  }

  private finishJob(job: SimJob) {
    this.clearTicker();
    this.job = null;
    const done: any = {
      ev: 'done',
      id: job.id,
      kind: job.kind,
      ms: Math.round(job.totalMs), // 펌프가 실제로 멈춘 시각 = 예상 소요시간 (펌웨어 done.ms 와 같음 — 늦게 확인해도 그 시각)
      dispensed: job.slots.map((s) => ({ p: s.p, ml: round1(s.ml) })),
    };
    if (job.kind === 'run') {
      // 데모 전용 부가 정보: 가상 펌프의 "실제" 추출량 (캘리브레이션 체험용)
      const s = job.slots[0];
      done.sim = { actualMl: round1((s.ms / 1000) * this.trueMlps[s.p - 1]) };
    }
    // status.last: dispensed 는 done 이벤트와 같은 값 (데모 전용 sim 은 넣지 않음)
    this.last = { id: job.id, kind: job.kind, result: 'done', dispensed: done.dispensed.map((d: MakeStep) => ({ ...d })) };
    this.send(done);
    this.afterJob();
  }

  private stopJob(reason: 'user' | 'button' | 'error') {
    const job = this.job;
    if (!job) return;
    const e = this.elapsed();
    this.clearTicker();
    this.job = null;
    const dispensed: MakeStep[] = job.slots
      .map((s) => ({ p: s.p, ml: round1(this.slotMl(s, e)) }))
      .filter((d) => d.ml > 0);
    this.last = { id: job.id, kind: job.kind, result: 'stopped', reason, dispensed: dispensed.map((d) => ({ ...d })) };
    this.send({ ev: 'stopped', id: job.id, reason, dispensed });
    this.afterJob();
  }

  private afterJob() {
    if (this.calDirty) {
      this.calDirty = false;
      this.onCalChange?.(this.cal.slice(), this.calSet.slice());
    }
  }

  private clearTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }
}

function fit(src: number[] | undefined, n: number, fill: number): number[] {
  const out = (Array.isArray(src) ? src : []).slice(0, n).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : fill));
  while (out.length < n) out.push(fill);
  return out;
}
