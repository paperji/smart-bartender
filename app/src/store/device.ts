/**
 * 기기 연결/작업 실시간 상태 (저장하지 않음)
 */
import { create } from 'zustand';

import type { InfoEvent, JobKind, MakeStep } from '@/lib/protocol';
import type { Availability, FoundDevice, TransportKind } from '@/lib/transport/types';

export type ConnState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface PumpProgress {
  p: number;
  target: number;
  done: number;
  finished: boolean;
}

export interface JobState {
  id: string;
  /**
   * 앱이 작업마다 새로 붙이는 고유 키. 기기 id 는 다시 쓰일 수 있어(run·clean 은 늘 'run'/'clean',
   * BUTTON_REPEAT_LAST 다시 만들기는 마지막 make id 그대로) 작업 구분은 이 키로 함.
   * 정리했던 작업을 되살리면(revived) 그대로 유지 → 같은 작업이 두 번 끝나도 brew.ts 가 같은 작업으로 보고 차이만 차감
   */
  localKey?: string;
  kind: JobKind;
  status: 'pending' | 'running' | 'done' | 'stopped' | 'error';
  totalMs: number;
  /** ack 받은 시각 (남은 시간 계산용) */
  ackAt: number | null;
  /**
   * ack 를 못 받은 작업을 기기가 하고 있다고 처음 확인한 시각(status running·progress 를 받은 시각).
   * 작업 시작 시각의 상한이라 재부팅 판정(SPEC §2.4 ③)에만 씀 — 남은 시간 계산에는 쓰지 않음
   */
  runningSeenAt?: number;
  pct: number;
  pumps: PumpProgress[];
  dispensed?: MakeStep[];
  /**
   * 중단 사유: user · button · error(기기 안전장치) — 기기가 보낸 값
   * 앱이 정한 값: disconnected(연결이 끊겨 재연결을 포기·사용자가 화면을 닫음, 결과 모름)
   *              unknown(끊긴 동안 기기가 멈춤 — 정지 버튼 등) · reboot(끊긴 동안 기기가 다시 켜짐)
   */
  reason?: string;
  error?: string;
  finishedAt?: number;
  /** 연결이 끊긴 동안 끝났거나 ack 를 못 받아서 결과를 정확히 모름 */
  uncertain?: boolean;
  /** run 작업의 용도 — prime(프라이밍: 실제 재료가 나오므로 잔량 차감) */
  purpose?: 'prime';
  /** 앱이 진행 중인 작업에 정지(stop) 명령을 보낸 시각 — stopped 를 놓쳤으면 곧바로 status 로 확인 (client.ts jobOverdue) */
  stopSentAt?: number;
  /** 데모 기기 전용: 가상 펌프의 실제 추출량 */
  simActualMl?: number;
}

export interface DeviceState {
  transportKind: TransportKind;
  availability: Availability | null;
  conn: ConnState;
  deviceId: string | null;
  deviceName: string | null;
  found: FoundDevice[];
  info: InfoEvent | null;
  cal: number[] | null;
  /** 펌프별 캘리브레이션 저장 여부(1/0). null = 알 수 없음(v2.0 펌웨어) */
  calSet: number[] | null;
  /** 기기가 알려준 한 펌프 최대 구동시간(ms). null = 알 수 없음 */
  maxPumpMs: number | null;
  job: JobState | null;
  lastError: string | null;
  lastSeenAt: number | null;
  uptimeMs: number | null;
  reconnectAttempt: number;
}

export const initialDeviceState: DeviceState = {
  transportKind: 'demo',
  availability: null,
  conn: 'idle',
  deviceId: null,
  deviceName: null,
  found: [],
  info: null,
  cal: null,
  calSet: null,
  maxPumpMs: null,
  job: null,
  lastError: null,
  lastSeenAt: null,
  uptimeMs: null,
  reconnectAttempt: 0,
};

export const useDevice = create<DeviceState>()(() => ({ ...initialDeviceState }));

export const setDevice = (patch: Partial<DeviceState>) => useDevice.setState(patch);

export function patchJob(patch: Partial<JobState> | ((j: JobState) => Partial<JobState>)) {
  const job = useDevice.getState().job;
  if (!job) return;
  const p = typeof patch === 'function' ? patch(job) : patch;
  useDevice.setState({ job: { ...job, ...p } });
}

export const isBusy = (job: JobState | null) => !!job && (job.status === 'pending' || job.status === 'running');

/** 실제 기기 이벤트로 결과가 확정된 작업 (연결 문제로 "결과 모름"·"시작 못 함"으로 정리한 것이 아님) */
export const isConfirmed = (job: JobState | null) =>
  !!job && (job.status === 'done' || job.status === 'stopped') && !job.uncertain && job.reason !== 'disconnected';
