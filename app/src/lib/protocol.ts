/**
 * BLE 통신 프로토콜 (docs/SPEC.md §2 v2.1 과 정확히 일치)
 * - Nordic UART Service(NUS), 메시지 = UTF-8 JSON 한 줄 + '\n'
 * - 순수 TypeScript (React Native 비의존) → 앱, 데모 기기, 테스트에서 공용
 */
import { utf8Decode, utf8Encode } from './utf8';

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
/** RX: 앱 → 기기 (Write / Write Without Response) */
export const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
/** TX: 기기 → 앱 (Notify) */
export const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export const DEVICE_NAME_PREFIX = 'SmartBartender';
/** 앱 → 기기 쓰기 최대 청크 크기 (바이트) */
export const WRITE_CHUNK_BYTES = 180;
/** 안드로이드 연결 직후 요청할 MTU */
export const REQUEST_MTU = 247;
/** 기기 수신 버퍼 최대 크기 (바이트) */
export const DEVICE_RX_MAX = 1024;

/** 펌웨어 검증 한계 (SPEC §2.3, v2.1) */
export const LIMITS = {
  maxSteps: 8,
  maxStepMl: 300,
  maxTotalMl: 500,
  /** make: 한 펌프 구동시간 최대 (v2.1 에서 60초 → 120초, 체크밸브 유량 3~6ml/s 고려) */
  maxPumpMs: 120000,
  /** v2.0 펌웨어(info 에 maxPumpMs 가 없음)의 한 펌프 최대 구동시간 */
  legacyMaxPumpMs: 60000,
  /** run: 최대 60초 */
  maxRunMs: 60000,
  /** clean: 펌프당 최대 30초 */
  maxCleanMs: 30000,
  minMlps: 0.5,
  maxMlps: 100,
  /** 순차(seq) 모드: 펌프 사이 휴지 */
  seqRestMs: 300,
  /** 병렬(par) 모드: 펌프를 0.1초 간격으로 차례로 켬 (PAR_STAGGER_MS) */
  parStaggerMs: 100,
  /** 안전 감시: (최대 구동시간 + 1초) 넘게 켜져 있으면 전체 정지 */
  safetyMarginMs: 1000,
  /** make id 최대 길이(바이트) */
  maxIdBytes: 40,
  defaultMlps: 20,
} as const;

// ───────────────────────── 명령 (앱 → 기기) ─────────────────────────

export interface MakeStep {
  p: number;
  ml: number;
}

export type Command =
  | { cmd: 'hello' }
  | { cmd: 'status' }
  | { cmd: 'ping' }
  | { cmd: 'make'; id: string; mode: 'seq' | 'par'; steps: MakeStep[] }
  | { cmd: 'stop' }
  | { cmd: 'run'; p: number; ms: number }
  | { cmd: 'clean'; ms: number }
  | { cmd: 'setcal'; p: number; mlps: number }
  | { cmd: 'getcal' };

// ───────────────────────── 이벤트 (기기 → 앱) ─────────────────────────

export type JobKind = 'make' | 'run' | 'clean';
export type ErrorCode =
  | 'BAD_JSON'
  | 'UNKNOWN_CMD'
  | 'BAD_PUMP'
  | 'BAD_AMOUNT'
  | 'LIMIT'
  | 'BUSY'
  | 'TOO_LONG';

export interface InfoEvent {
  ev: 'info';
  fw: string;
  name: string;
  pumps: number;
  cal: number[];
  /** v2.1: 펌프별 캘리브레이션 저장 여부 (1=NVS 저장값, 0=기본값). v2.0 펌웨어에는 없음 */
  calSet?: number[];
  maxMl: number;
  maxStepMl: number;
  /** v2.1: 한 펌프 최대 구동시간(ms). v2.0 펌웨어에는 없음 */
  maxPumpMs?: number;
  state: 'idle' | 'running';
}
/**
 * status.last — 부팅 후 마지막으로 끝난 작업 (SPEC §2.4, v2.1 교차검증 반영)
 * result: done | stopped (stopped 면 reason 포함). dispensed 는 그 작업의 done/stopped 이벤트와 같은 값
 * 예) {"id":"r1","kind":"make","result":"stopped","reason":"button","dispensed":[{"p":1,"ml":12.3}]}
 */
export interface StatusLast {
  id: string;
  kind: JobKind;
  result: 'done' | 'stopped';
  reason?: StopReason | string;
  dispensed: MakeStep[];
}
export interface StatusEvent {
  ev: 'status';
  state: 'idle' | 'running';
  job: { id: string; kind: JobKind; pct: number } | null;
  /** 부팅 후 마지막으로 끝난 작업 (없으면 null). 이 필드가 아예 없으면 예전 펌웨어(결과를 알려 주지 않음) */
  last?: StatusLast | null;
}
export interface AckEvent {
  ev: 'ack';
  id: string;
  kind: JobKind;
  totalMs: number;
}
export interface ProgressEvent {
  ev: 'progress';
  id: string;
  p: number;
  ml: number;
  doneMl: number;
  pct: number;
}
export interface StepEvent {
  ev: 'step';
  id: string;
  p: number;
  ml: number;
}
export interface DoneEvent {
  ev: 'done';
  id: string;
  kind: JobKind;
  ms: number;
  dispensed: MakeStep[];
}
/** 중단 사유: user(앱의 stop) · button(기기 버튼) · error(안전 감시 등) */
export type StopReason = 'user' | 'button' | 'error';
export interface StoppedEvent {
  ev: 'stopped';
  id: string | null;
  reason: StopReason | string;
  dispensed: MakeStep[];
}
export interface CalEvent {
  ev: 'cal';
  cal: number[];
  /** v2.1 */
  calSet?: number[];
}
export interface PongEvent {
  ev: 'pong';
  up: number;
}
export interface ErrorEvent {
  ev: 'error';
  code: ErrorCode | string;
  msg: string;
}

export type DeviceEvent =
  | InfoEvent
  | StatusEvent
  | AckEvent
  | ProgressEvent
  | StepEvent
  | DoneEvent
  | StoppedEvent
  | CalEvent
  | PongEvent
  | ErrorEvent;

const KNOWN_EVENTS = new Set([
  'info',
  'status',
  'ack',
  'progress',
  'step',
  'done',
  'stopped',
  'cal',
  'pong',
  'error',
]);

/** 한 줄(JSON)을 이벤트로 파싱. 형식이 틀리면 null */
export function parseEvent(line: string): DeviceEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== '{') return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object' && typeof obj.ev === 'string' && KNOWN_EVENTS.has(obj.ev)) {
      return obj as DeviceEvent;
    }
    return null;
  } catch {
    return null;
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const JOB_KINDS: JobKind[] = ['make', 'run', 'clean'];

/**
 * status.last 검증 (SPEC §2.4). 형식이 틀리면 null (= 마지막 작업 결과 모름).
 * dispensed 의 잘못된 줄(펌프 번호가 정수가 아니거나 ml 이 숫자가 아님/음수)은 버림
 */
export function parseStatusLast(v: unknown): StatusLast | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (!JOB_KINDS.includes(o.kind as JobKind)) return null;
  if (o.result !== 'done' && o.result !== 'stopped') return null;
  const dispensed: MakeStep[] = [];
  for (const d of Array.isArray(o.dispensed) ? o.dispensed : []) {
    if (!d || typeof d !== 'object') continue;
    const p = (d as any).p;
    const ml = (d as any).ml;
    if (!Number.isInteger(p) || p < 1 || !isNum(ml) || ml < 0) continue;
    dispensed.push({ p, ml });
  }
  const last: StatusLast = { id: o.id, kind: o.kind as JobKind, result: o.result, dispensed };
  if (o.result === 'stopped') last.reason = typeof o.reason === 'string' && o.reason ? o.reason : 'unknown';
  return last;
}

/** info/cal 의 calSet → 0/1 배열. 없거나 형식이 틀리면 null (v2.0 펌웨어 = "알 수 없음") */
export function parseCalSet(v: unknown, pumps?: number): number[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: number[] = [];
  for (const x of v) {
    if (typeof x === 'boolean') out.push(x ? 1 : 0);
    else if (isNum(x)) out.push(x ? 1 : 0);
    else return null;
  }
  return typeof pumps === 'number' && pumps > 0 ? out.slice(0, pumps) : out;
}

/** info 의 maxPumpMs. 없거나 이상한 값이면 null (= "알 수 없음") */
export function parseMaxPumpMs(v: unknown): number | null {
  return isNum(v) && v > 0 ? Math.round(v) : null;
}

/** 캘리브레이션 전(calSet=0)인 펌프 번호 목록. calSet 을 모르면 빈 배열 */
export function uncalibratedPumps(calSet: number[] | null | undefined, pumps?: number): number[] {
  if (!calSet) return [];
  const n = typeof pumps === 'number' && pumps > 0 ? Math.min(pumps, calSet.length) : calSet.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (!calSet[i]) out.push(i + 1);
  return out;
}

/** 기기 한도. info 가 없으면 SPEC v2.1 값, info 가 있는데 maxPumpMs 가 없으면(v2.0 펌웨어) 60초 */
export interface DeviceLimits {
  maxPumpMs: number;
  maxTotalMl: number;
  maxStepMl: number;
}
export function deviceLimits(info: Partial<InfoEvent> | null | undefined): DeviceLimits {
  if (!info) return { maxPumpMs: LIMITS.maxPumpMs, maxTotalMl: LIMITS.maxTotalMl, maxStepMl: LIMITS.maxStepMl };
  const pos = (v: unknown, d: number) => (isNum(v) && v > 0 ? v : d);
  return {
    maxPumpMs: parseMaxPumpMs(info.maxPumpMs) ?? LIMITS.legacyMaxPumpMs,
    maxTotalMl: pos(info.maxMl, LIMITS.maxTotalMl),
    maxStepMl: pos(info.maxStepMl, LIMITS.maxStepMl),
  };
}

export function encodeCommand(cmd: Command): string {
  return JSON.stringify(cmd);
}

/** 오류 코드 → 한국어 안내 (기기가 보낸 설명이 있으면 함께 표시) */
export function errorCodeMessage(code: string, fallback?: string): string {
  switch (code) {
    case 'BAD_JSON':
      return '기기가 명령을 이해하지 못했어요(JSON 형식 오류).';
    case 'UNKNOWN_CMD':
      return '기기가 지원하지 않는 명령이에요. 펌웨어 버전을 확인하세요.';
    case 'BAD_PUMP':
      return '존재하지 않는 펌프 번호예요.';
    case 'BAD_AMOUNT':
      return fallback ? `양(ml) 또는 시간이 올바르지 않아요. (${fallback})` : '양(ml) 또는 시간이 허용 범위를 벗어났어요.';
    case 'LIMIT':
      return fallback
        ? `기기 제한을 넘었어요. (${fallback})`
        : '기기 제한(총 500ml, 재료당 300ml, 펌프당 120초)을 넘었어요.';
    case 'BUSY':
      return '기기가 이미 작동 중이에요. 끝난 뒤 다시 시도하세요.';
    case 'TOO_LONG':
      return '명령이 너무 길어요(1024바이트 초과).';
    default:
      return fallback || `기기 오류 (${code})`;
  }
}

// ───────────────────────── 프레이밍 ─────────────────────────

/**
 * BLE 패킷 조각을 모아 '\n' 단위로 완성된 줄을 돌려줍니다.
 * 바이트 단위로 모은 다음 줄 단위로 UTF-8 디코딩 → 한글이 패킷 경계에서 잘려도 안전.
 */
export class LineAssembler {
  private buf: number[] = [];
  constructor(private readonly maxBytes = 8192) {}

  /** 바이트 조각 추가. 완성된 줄 목록 반환 (빈 줄·'\r' 제거) */
  push(chunk: ArrayLike<number>): string[] {
    const lines: string[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i] & 0xff;
      if (b === 0x0a) {
        const text = utf8Decode(this.buf).replace(/\r$/, '');
        this.buf = [];
        if (text.trim().length > 0) lines.push(text);
      } else {
        this.buf.push(b);
        if (this.buf.length > this.maxBytes) {
          // 비정상적으로 긴 줄 → 버림
          this.buf = [];
        }
      }
    }
    return lines;
  }

  /** 문자열 조각 추가 (웹/데모용) */
  pushText(text: string): string[] {
    return this.push(utf8Encode(text));
  }

  reset() {
    this.buf = [];
  }

  get pendingBytes() {
    return this.buf.length;
  }
}

/** 한 줄을 UTF-8 바이트로 만들고(끝에 '\n' 보장) size 바이트 단위로 분할 */
export function frameLine(line: string, size = WRITE_CHUNK_BYTES): Uint8Array[] {
  const text = line.endsWith('\n') ? line : line + '\n';
  return chunkBytes(utf8Encode(text), size);
}

export function chunkBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const n = Math.max(1, Math.floor(size));
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += n) out.push(bytes.slice(i, i + n));
  return out;
}

// ───────────────────────── 검증 (펌웨어와 동일 규칙) ─────────────────────────

export interface MakeValidation {
  ok: boolean;
  code?: ErrorCode;
  msg?: string;
  /** 같은 펌프를 합산한 단계 (처음 나온 순서 유지, 소수 1자리 반올림 — 화면 표시용) */
  merged: MakeStep[];
  /**
   * merged 와 같은 순서의 반올림 전 합계(0.0001ml 단위, 펌웨어 targetMl 과 같은 값).
   * 데모 기기가 펌웨어처럼 이 값으로 진행률·중단 시 추정량(구동시간 비율 × 목표량)을 계산하고 내보낼 때만 반올림
   */
  exact: MakeStep[];
  /** 펌프별 구동 시간(ms) — merged 와 같은 순서 */
  durations: number[];
  totalMs: number;
}

export interface MakeLimitOptions {
  maxPumpMs?: number;
  maxTotalMl?: number;
  maxStepMl?: number;
}

/**
 * make 명령 검증 — SPEC §2.3 v2.1 (펌웨어·앱·데모 기기 동일, 위에서부터 차례로 검사)
 *  1. mode 가 "seq"/"par"/생략 외의 값 → BAD_JSON. steps 누락·빈 배열 → BAD_AMOUNT. steps 9개 이상 → LIMIT
 *  2. 각 step: p 가 정수 1..pumpCount 가 아니면 BAD_PUMP. ml 이 숫자가 아니거나 ≤ 0 → BAD_AMOUNT, ml > 300 → LIMIT
 *  3. 같은 펌프 합산 후 펌프별 ≤ 300ml, 총합 ≤ 500ml, 한 펌프 구동시간 ≤ 120초 → 위반 시 LIMIT
 * 펌웨어와 같게: ml 은 비교 전 0.0001ml 단위로 정리(quantizeMl), 단계별 300 은 1e-9·합산 300/총 500 은 1e-6 여유,
 * 구동시간(ms) = round(ml / mlps × 1000) 정수로 반올림한 뒤 120초와 비교(정확히 120000ms 는 통과).
 * 예상 소요 = 순차 Σ구동 + 300ms×(n-1) / 병렬 max(i×100ms + 구동_i)
 */
export function validateMake(
  steps: unknown,
  pumpCount: number,
  cal: number[],
  mode: unknown = 'seq',
  limits: MakeLimitOptions = {},
): MakeValidation {
  const maxPumpMs = limits.maxPumpMs ?? LIMITS.maxPumpMs;
  const maxTotal = limits.maxTotalMl ?? LIMITS.maxTotalMl;
  const maxStep = limits.maxStepMl ?? LIMITS.maxStepMl;
  const fail = (code: ErrorCode, msg: string): MakeValidation => ({
    ok: false,
    code,
    msg,
    merged: [],
    exact: [],
    durations: [],
    totalMs: 0,
  });

  // ── 1. mode / steps 개수 ──
  if (mode != null && mode !== 'seq' && mode !== 'par') {
    return fail('BAD_JSON', 'mode 는 "seq" 또는 "par" 만 가능합니다');
  }
  if (!Array.isArray(steps) || steps.length === 0) return fail('BAD_AMOUNT', 'steps(재료 목록)가 비어 있습니다');
  if (steps.length > LIMITS.maxSteps) return fail('LIMIT', `재료(steps)는 최대 ${LIMITS.maxSteps}개까지 가능합니다`);

  // ── 2. 각 step ──
  const order: number[] = [];
  const sum = new Map<number, number>();
  let total = 0;
  for (const s of steps) {
    const p = (s as MakeStep | null)?.p;
    const ml = (s as MakeStep | null)?.ml;
    if (!isNum(p) || !Number.isInteger(p) || p < 1 || p > pumpCount) {
      return fail('BAD_PUMP', `펌프 번호(p)는 1 ~ ${pumpCount} 사이 정수여야 합니다 (받은 값: ${String(p)})`);
    }
    if (!isNum(ml) || !(ml > 0)) return fail('BAD_AMOUNT', '양(ml)은 0보다 큰 숫자여야 합니다');
    const q = quantizeMl(ml);
    if (q > maxStep + 1e-9) return fail('LIMIT', `재료 1개는 최대 ${maxStep}ml 까지 가능합니다`);
    if (!sum.has(p)) order.push(p);
    sum.set(p, (sum.get(p) ?? 0) + q);
    total += q;
  }

  // ── 3. 합산 후 펌프별 300ml · 총 500ml · 펌프별 120초 ──
  // 안내 문구의 양은 0.1ml 단위 올림(펌웨어와 같음) → 300.04ml 가 '300ml 가 최대 300ml 를 넘습니다'로 보이지 않게
  const shownUp = (x: number) => Math.ceil(x * 10 - 1e-6) / 10;
  for (const p of order) {
    const v = sum.get(p) ?? 0;
    if (v > maxStep + 1e-6) {
      return fail('LIMIT', `펌프 ${p} 합계 ${shownUp(v)}ml 가 재료당 최대 ${maxStep}ml 를 넘습니다`);
    }
  }
  if (total > maxTotal + 1e-6) return fail('LIMIT', `총량 ${shownUp(total)}ml 가 최대 ${maxTotal}ml 를 넘습니다`);
  const durations: number[] = [];
  for (const p of order) {
    const ml = sum.get(p) ?? 0;
    const mlps = cal[p - 1] > 0 ? cal[p - 1] : LIMITS.defaultMlps;
    // 실제로 켜질 시간 = 정수 ms (펌웨어 pumpMs 와 같음) → 예: 유량 1.67 에서 200.4ml = 120000ms 는 통과
    const ms = Math.max(1, Math.round((ml / mlps) * 1000));
    if (ms > maxPumpMs) {
      return fail(
        'LIMIT',
        `펌프 ${p} 구동시간 ${Math.ceil(ms / 100) / 10}초가 최대 ${Math.round(maxPumpMs / 1000)}초를 넘습니다 (양을 줄이거나 유량 보정값 확인)`,
      );
    }
    durations.push(ms);
  }
  return {
    ok: true,
    merged: order.map((p) => ({ p, ml: round1(sum.get(p) ?? 0) })),
    exact: order.map((p) => ({ p, ml: sum.get(p) ?? 0 })),
    durations,
    totalMs: jobTotalMs(durations, mode === 'par' ? 'par' : 'seq'),
  };
}

/** 예상 소요 시간 — 순차: Σd + 300ms×(n-1), 병렬: max(i×100ms + d_i) (펌웨어 startJob 과 동일) */
export function jobTotalMs(durations: number[], mode: 'seq' | 'par'): number {
  if (durations.length === 0) return 0;
  if (mode === 'par') return Math.max(...durations.map((d, i) => i * LIMITS.parStaggerMs + d));
  return durations.reduce((a, b) => a + b, 0) + LIMITS.seqRestMs * (durations.length - 1);
}

export interface SimpleValidation {
  ok: boolean;
  code?: ErrorCode;
  msg?: string;
}

/** run 명령 검증 (SPEC §2.3): p 오류 → BAD_PUMP, ms 가 숫자가 아니거나 ≤ 0 → BAD_AMOUNT, > 60000 → LIMIT */
export function validateRun(p: unknown, ms: unknown, pumpCount: number): SimpleValidation {
  if (!isNum(p) || !Number.isInteger(p) || p < 1 || p > pumpCount) {
    return { ok: false, code: 'BAD_PUMP', msg: `펌프 번호(p)는 1 ~ ${pumpCount} 사이 정수여야 합니다` };
  }
  if (!isNum(ms) || !(ms > 0)) return { ok: false, code: 'BAD_AMOUNT', msg: '구동시간(ms)은 0보다 큰 숫자여야 합니다' };
  if (ms > LIMITS.maxRunMs) return { ok: false, code: 'LIMIT', msg: `구동시간은 최대 ${LIMITS.maxRunMs}ms(60초) 입니다` };
  return { ok: true };
}

/** clean 명령 검증 (SPEC §2.3): ms ≤ 0 → BAD_AMOUNT, > 30000 → LIMIT */
export function validateClean(ms: unknown): SimpleValidation {
  if (!isNum(ms) || !(ms > 0)) return { ok: false, code: 'BAD_AMOUNT', msg: '세척 시간(ms)은 0보다 큰 숫자여야 합니다' };
  if (ms > LIMITS.maxCleanMs) {
    return { ok: false, code: 'LIMIT', msg: `세척 시간은 펌프당 최대 ${LIMITS.maxCleanMs}ms(30초) 입니다` };
  }
  return { ok: true };
}

/**
 * make id: 최대 40바이트(UTF-8)로 자르고, 없으면 "make" (SPEC §2.3).
 * 펌웨어 copyUtf8 과 같게: 문자열은 NUL(U+0000) 앞까지만 보고(C 문자열), 제어문자 U+0001~U+001F 는 '?' 로 바꿈(1바이트→1바이트)
 */
export function normalizeJobId(id: unknown): string {
  if (typeof id !== 'string') return 'make';
  const s = id.split('\u0000')[0];
  if (!s) return 'make';
  const bytes = utf8Encode(s);
  let out = s;
  if (bytes.length > LIMITS.maxIdBytes) {
    // 한글이 중간에서 잘리지 않도록 UTF-8 글자 경계에서 자름
    let end = LIMITS.maxIdBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    out = utf8Decode(bytes.slice(0, end));
  }
  return out.replace(/[\u0001-\u001f]/g, '?');
}

/** 예상 소요 시간(ms) 계산 — 화면 표시용 (같은 펌프 합산, 펌웨어와 같은 공식) */
export function estimateMakeMs(
  steps: MakeStep[],
  cal: number[] | null | undefined,
  mode: 'seq' | 'par' = 'seq',
): number {
  const sum = new Map<number, number>();
  for (const s of steps) if (s.ml > 0) sum.set(s.p, (sum.get(s.p) ?? 0) + s.ml);
  const ds = Array.from(sum.entries()).map(([p, ml]) => {
    const mlps = cal && cal[p - 1] > 0 ? cal[p - 1] : LIMITS.defaultMlps;
    return (ml / mlps) * 1000;
  });
  return jobTotalMs(ds, mode);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 양(ml)을 0.0001ml 단위로 반올림 — 펌웨어 quantizeMl 과 같음 (150.1+149.9 가 300 초과로 판정되지 않게, SPEC §2.3) */
export function quantizeMl(ml: number): number {
  return Math.floor(ml * 10000 + 0.5) / 10000;
}

/**
 * 펌프별 (이번 결과 - 이미 잔량에서 뺀 양), 음수는 0 — 같은 작업이 두 번 끝날 때(연결이 끊겨 "결과 모름"으로 정리 →
 * 재연결 뒤 실제 결과) 잔량을 두 번 빼지 않게
 */
export function dispensedDelta(now: MakeStep[], before: MakeStep[] | undefined): MakeStep[] {
  if (!before || !before.length) return now.filter((d) => d.ml > 0);
  const sum = (list: MakeStep[], p: number) => list.filter((d) => d.p === p).reduce((a, b) => a + (b.ml || 0), 0);
  const pumps = Array.from(new Set(now.map((d) => d.p)));
  return pumps
    .map((p) => ({ p, ml: Math.round(Math.max(0, sum(now, p) - sum(before, p)) * 10) / 10 }))
    .filter((d) => d.ml > 0);
}

export function newJobId(): string {
  return 'r' + Date.now().toString();
}
