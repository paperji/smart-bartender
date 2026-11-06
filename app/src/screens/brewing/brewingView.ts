/**
 * 제조 진행 화면의 표시 계산 (React 비의존 — 문구·색·진행률). v2.1 src/app/brewing.tsx 의 계산을 그대로 옮김
 *  - 머리(아이콘·색·제목), 전체 진행률(%)·남은 시간, 상태 안내(배너), 펌프별 이름, 닫기 버튼 문구, 피드백 안내 문구
 */
import { stopReasonText } from '@/lib/brew';
import { fmtDuration, fmtMl } from '@/lib/format';
import type { PumpSlot, Recipe } from '@/lib/types';
import { isBusy, type ConnState, type JobState } from '@/store/device';

/** 화면 색 (CSS: brew-tone--*) */
export type BrewTone = 'info' | 'accent' | 'success' | 'warning' | 'danger';

/** 머리 아이콘 (v2.1 Ionicons 이름 대응: hourglass · paper-plane · water · checkmark-circle · bluetooth · hand-left · help-circle · alert-circle) */
export type BrewIcon = 'hourglass' | 'send' | 'pour' | 'check' | 'celebrate' | 'bluetooth' | 'hand' | 'help' | 'alert';

export interface BrewHead {
  icon: BrewIcon;
  tone: BrewTone;
  title: string;
}

/** 작업 종류 이름 */
export function kindLabel(kind: JobState['kind']): string {
  return kind === 'make' ? '제조' : kind === 'run' ? '펌프 구동' : '세척';
}

/** 지금까지 나온 양 (기기가 알려준 dispensed 합) */
export function dispensedTotal(job: Pick<JobState, 'dispensed'>): number {
  return (job.dispensed ?? []).reduce((a, b) => a + b.ml, 0);
}

/** 연결이 끊긴 동안 끝나거나 정리돼 결과를 정확히 모름 */
export function isLostResult(job: JobState): boolean {
  return !isBusy(job) && (job.reason === 'disconnected' || job.reason === 'unknown' || job.reason === 'reboot');
}

/** 머리: 아이콘·색·제목 (v2.1 head 와 같은 분기) */
export function brewHead(job: JobState): BrewHead {
  const kind = kindLabel(job.kind);
  switch (job.status) {
    case 'pending':
      return job.uncertain
        ? { icon: 'hourglass', tone: 'info', title: '기기 응답을 확인하는 중…' }
        : { icon: 'send', tone: 'info', title: '기기로 레시피를 보내는 중…' };
    case 'running':
      return { icon: 'pour', tone: 'accent', title: `${kind} 중이에요` };
    case 'done':
      if (job.uncertain) return { icon: 'check', tone: 'success', title: '연결이 끊긴 사이에 끝났어요' };
      return job.kind === 'make'
        ? { icon: 'celebrate', tone: 'success', title: '완성! 맛있게 즐기세요' }
        : { icon: 'check', tone: 'success', title: `${kind} 완료` };
    case 'stopped':
      return job.reason === 'disconnected'
        ? { icon: 'bluetooth', tone: 'warning', title: '연결이 끊겼어요' }
        : { icon: 'hand', tone: 'warning', title: `${kind}${job.kind === 'make' ? '를' : '을'} 중단했어요` };
    default:
      return job.uncertain
        ? { icon: 'help', tone: 'warning', title: `${kind} 여부를 확인하지 못했어요` }
        : { icon: 'alert', tone: 'danger', title: '문제가 생겼어요' };
  }
}

export interface BrewProgress {
  /** 작업 중(pending·running) */
  running: boolean;
  /** 0~100 정수 */
  pct: number;
  /** 남은 시간(ms) — ack 시각 기준 예상 */
  remaining: number;
  /** 값을 아직 모름 (명령을 보냈지만 응답 전) — 진행 원이 돌아감 */
  indeterminate: boolean;
}

/**
 * 전체 진행률 (v2.1 과 같음): 기기가 알려준 pct 와 ack 뒤 지난 시간 비율(최대 99%) 중 큰 값, 끝나면 100
 */
export function brewProgress(job: JobState, now: number): BrewProgress {
  const running = isBusy(job);
  const elapsed = job.ackAt ? now - job.ackAt : 0;
  const timePct = job.totalMs > 0 ? Math.min(99, (elapsed / job.totalMs) * 100) : 0;
  const pct =
    job.status === 'done' ? 100 : Math.max(0, Math.min(100, Math.round(Math.max(job.pct, running && job.ackAt ? timePct : 0))));
  const remaining = job.totalMs > 0 ? Math.max(0, job.totalMs - elapsed) : 0;
  return { running, pct, remaining, indeterminate: running && !job.ackAt && pct === 0 };
}

/** 진행률 옆 글자: 남은 시간 · 진행 중 · 응답 대기 중 · 총 ml (v2.1 과 같음, 남은 시간이 0 이면 "곧 끝나요") */
export function progressCaption(job: JobState, p: BrewProgress): string {
  if (p.running) {
    if (job.ackAt) return p.remaining > 0 ? `남은 시간 약 ${fmtDuration(p.remaining)}` : '곧 끝나요';
    // ack 를 못 받았지만 기기가 작업 중이라고 알려 옴 (status running·progress)
    return job.status === 'running' ? '진행 중' : '응답 대기 중';
  }
  return job.status === 'done' ? `총 ${fmtMl(dispensedTotal(job))}` : '';
}

/** 화면 안내 상자 하나 (UI 키트 Banner 의 tone) */
export interface BrewNotice {
  key: string;
  tone: 'info' | 'warning' | 'error';
  title?: string;
  message: string;
}

export interface NoticeContext {
  /** 작업 중인데 연결이 끊김 */
  linkLost: boolean;
  /** 자동으로 다시 연결하는 중 */
  reconnecting: boolean;
  reconnectAttempt: number;
}

/** 상태 안내 (v2.1 배너와 같은 조건·문구) */
export function brewNotices(job: JobState, ctx: NoticeContext): BrewNotice[] {
  const out: BrewNotice[] = [];
  const total = fmtMl(dispensedTotal(job));
  const status = job.status;
  if (ctx.linkLost && ctx.reconnecting) {
    out.push({
      key: 'reconnecting',
      tone: 'warning',
      title: '블루투스 연결이 끊겼어요',
      message: `기기는 정해진 양만큼 계속 제조해요. 다시 연결하는 중이에요${ctx.reconnectAttempt > 0 ? ` (${ctx.reconnectAttempt}번째 시도)` : ''}. 급하면 기기의 정지 버튼을 누르세요.`,
    });
  } else if (ctx.linkLost) {
    out.push({
      key: 'lost',
      tone: 'error',
      title: '연결이 끊겼어요',
      message:
        '자동으로 다시 연결하지 않고 있어요. 기기와 잔을 직접 확인하고, 기기 탭에서 다시 연결해 주세요. 급하면 기기의 정지 버튼을 누르세요.',
    });
  }
  if (status === 'pending' && job.uncertain) {
    out.push({
      key: 'pending-uncertain',
      tone: 'info',
      title: '기기 응답 확인 중',
      message: '명령은 보냈지만 기기의 응답을 아직 받지 못했어요. 기기가 붓고 있을 수 있으니 잔을 그대로 두세요. 확인되는 대로 진행 상황을 보여 드려요.',
    });
  }
  if (status === 'done' && job.uncertain) {
    out.push({
      key: 'done-uncertain',
      tone: 'info',
      message: '연결이 끊긴 동안 제조가 끝난 것으로 보여요. 중간에 멈췄을 수도 있으니 잔과 재료 잔량을 확인해 주세요.',
    });
  }
  if (status === 'error') {
    out.push({
      key: 'error',
      tone: job.uncertain ? 'warning' : 'error',
      title: job.uncertain ? '제조 여부를 확인하지 못했어요' : '제조를 시작하지 못했어요',
      message: job.error ?? '알 수 없는 오류',
    });
  }
  if (status === 'stopped' && job.reason === 'error') {
    out.push({
      key: 'safety',
      tone: 'error',
      title: '기기 안전장치가 작동했어요',
      message: `펌프가 너무 오래 켜져 있어서 기기가 모든 펌프를 멈췄어요. 지금까지 약 ${total} 나왔어요. 튜브가 막히거나 꺾이지 않았는지, 용기에 액체가 있는지 확인해 주세요.`,
    });
  } else if (status === 'stopped' && isLostResult(job)) {
    out.push({
      key: 'stopped-lost',
      tone: 'warning',
      title: job.reason === 'disconnected' ? '연결이 끊겨 결과를 확인하지 못했어요' : '연결이 끊긴 동안 기기가 멈췄어요',
      message: `${stopReasonText(job.reason)} 확인된 양은 약 ${total}이에요. 기기와 잔을 직접 확인하세요.`,
    });
  } else if (status === 'stopped') {
    out.push({
      key: 'stopped',
      tone: 'warning',
      message: `${job.reason === 'button' ? '기기의 버튼으로' : '앱에서'} 정지했어요. 지금까지 약 ${total} 나왔어요.`,
    });
  }
  return out;
}

/** 펌프 이름: 이 작업의 레시피 → 지금 장착 재료 → "펌프 N" */
export function pumpName(p: number, recipe: Recipe | null, slots: PumpSlot[]): string {
  return recipe?.ingredients.find((i) => i.pump === p)?.name || slots.find((s) => s.pump === p)?.name || `펌프 ${p}`;
}

/** 끝난 제조 — 피드백·"한 잔 더" 카드를 보여 줌 */
export function showsResultCards(job: JobState): boolean {
  return job.kind === 'make' && (job.status === 'done' || job.status === 'stopped');
}

/** 결과를 모르는데 연결도 안 돼 있어 "기기 탭에서 다시 연결" 버튼을 보여 줌 (작업이 끝난 뒤) */
export function needsReconnectButton(job: JobState, conn: ConnState, reconnecting: boolean): boolean {
  return (isLostResult(job) || (job.status === 'error' && !!job.uncertain)) && conn !== 'connected' && !reconnecting;
}

/** 아래 닫기 버튼 글자 */
export function closeLabel(job: JobState): string {
  return job.status === 'done' && job.kind === 'make' ? '기록 저장하고 닫기' : '닫기';
}

/** 피드백 카드 아래 안내 */
export function feedbackCaption(job: JobState): string {
  return job.uncertain
    ? '피드백은 다음 AI 추천에 반영돼요. 재료 잔량은 확인된 양으로 차감했지만 정확하지 않을 수 있어요.'
    : '피드백은 다음 AI 추천에 반영돼요. 재료 잔량은 자동으로 차감했어요.';
}
