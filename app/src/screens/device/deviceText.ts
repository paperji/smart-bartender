/**
 * 기기 화면 문구·판정 도우미 (React 비의존 — v2.1 device.tsx 의 KIND_LABEL·signalLabel 등)
 */
import type { TransportKind } from '@/lib/transport/types';
import type { PlatformKind } from '@/platform/detect';
import { WEB_BLE_NOTES } from '@/platform/transport/factory';
import { isBusy, type JobState } from '@/store/device';
import type { Tone } from '@/ui';

/** 통신 방식 이름 (v2.1 KIND_LABEL — v3 는 Edge 도 지원해서 웹 이름만 넓힘) */
export const KIND_LABEL: Record<TransportKind, string> = {
  native: '블루투스(BLE)',
  web: '웹 블루투스(Chrome·Edge)',
  demo: '데모 · 가상 기기',
};

/** Windows 앱(EXE)의 통신 방식 이름 — 웹 블루투스 엔진을 쓰지만 브라우저가 아니라 앱 안 선택 창 */
export const EXE_KIND_LABEL = '블루투스(BLE · 앱 안 기기 선택 창)';

/** 통신 방식 이름 (EXE 는 웹 블루투스라도 브라우저 이름을 쓰지 않음 — DEV-3) */
export function kindLabel(kind: TransportKind, electron: boolean): string {
  return kind === 'web' && electron ? EXE_KIND_LABEL : KIND_LABEL[kind];
}

/** 안드로이드 앱(APK) 연결 안내 */
export const APK_BLE_NOTES = [
  '안드로이드 앱(APK)은 휴대폰 블루투스로 기기에 직접 연결해요. (네이티브 블루투스)',
  '처음 연결할 때 블루투스(근처 기기) 권한을 허용해 주세요.',
  '자동 재연결을 켜 두면 앱을 켤 때나 연결이 끊겼을 때 마지막 기기에 다시 연결해요.',
];

/** Windows 앱(EXE) 연결 안내 — 브라우저가 아니라 앱 안 기기 선택 창(platform/electron/BlePickerHost) */
export const EXE_BLE_NOTES = [
  'Windows 앱은 PC 블루투스로 기기에 연결해요. (블루투스 저전력(BLE)을 지원하는 어댑터가 필요해요)',
  '연결할 때마다 앱 안의 기기 선택 창에서 SmartBartender 를 골라 주세요.',
  '제조 중에는 화면을 켜 둔 채로 두세요. (앱이 화면 꺼짐을 막아 줘요)',
];

export interface ConnectionGuide {
  /** "실제 기기 연결" 줄에 보일 통신 방식 이름 */
  label: string;
  /** 연결 안내 문장들 */
  notes: string[];
}

/**
 * 기기 화면 "연결 방식" 안내 — 실행 환경(APK·EXE·웹)마다 (DEV-3: EXE 에 브라우저 전용 안내가 보이지 않게)
 * webCanAutoConnect: 예전에 허락한 기기로 바로 다시 연결할 수 있는지(getDevices) — 없으면 다시 열 때마다 골라야 한다고 안내
 */
export function connectionGuide(platform: PlatformKind, webCanAutoConnect: boolean): ConnectionGuide {
  if (platform === 'capacitor') return { label: KIND_LABEL.native, notes: APK_BLE_NOTES };
  if (platform === 'electron') {
    return { label: EXE_KIND_LABEL, notes: webCanAutoConnect ? EXE_BLE_NOTES : [...EXE_BLE_NOTES, '앱을 다시 켜면 기기를 다시 골라야 해요.'] };
  }
  return {
    label: KIND_LABEL.web,
    notes: webCanAutoConnect ? WEB_BLE_NOTES : [...WEB_BLE_NOTES, '이 브라우저에서는 앱을 다시 열면 기기를 다시 골라야 해요.'],
  };
}

/** 신호 세기(RSSI, dBm) → 쉬운 말 (v2.1 그대로) */
export function signalLabel(rssi?: number): { text: string; bars: 1 | 2 | 3 } | null {
  if (typeof rssi !== 'number') return null;
  if (rssi >= -60) return { text: '강함', bars: 3 };
  if (rssi >= -75) return { text: '보통', bars: 2 };
  return { text: '약함', bars: 1 };
}

/** 유지보수 작업(세척·펌프 구동·프라이밍) 중단 사유 — brew.ts stopReasonText 와 같은 말, "제조" 대신 "작업" */
export function maintenanceStopText(reason: string | undefined): string {
  switch (reason) {
    case 'button':
      return '기기의 정지 버튼으로 멈췄어요.';
    case 'user':
      return '앱에서 멈췄어요.';
    case 'error':
      return '기기 안전장치가 작동해 멈췄어요.';
    case 'disconnected':
      return '연결이 끊겨 결과를 확인하지 못했어요. 기기를 직접 확인해 주세요.';
    case 'unknown':
      return '연결이 끊긴 동안 기기가 멈췄어요(정지 버튼 또는 재부팅).';
    case 'reboot':
      return '연결이 끊긴 동안 기기가 다시 켜져(전원 차단·재부팅) 작업이 멈췄어요.';
    default:
      return '작업이 멈췄어요.';
  }
}

/** 작업 이름: 세척 · 펌프 N 구동 · 펌프 N 튜브 채우기(프라이밍) · 제조 */
export function jobKindLabel(job: JobState): string {
  if (job.kind === 'clean') return '세척';
  if (job.kind === 'make') return '제조';
  const p = job.pumps[0]?.p;
  const name = job.purpose === 'prime' ? '튜브 채우기' : '구동';
  return p ? `펌프 ${p} ${name}` : `펌프 ${name}`;
}

export interface JobView {
  /** 예: "세척 중…", "펌프 2 튜브 채우기 완료" */
  title: string;
  tone: Tone;
  /** 결과를 정확히 모를 때 배지 문구 */
  badge: string | null;
  /** 아래 설명 (사유·나온 양) */
  message: string | null;
}

/** 나온 양 합계 (ml) */
export function dispensedTotal(job: JobState): number {
  return Math.round((job.dispensed ?? []).reduce((a, b) => a + (b.ml || 0), 0) * 10) / 10;
}

/**
 * 작업 카드 표시 (v2.1 유지보수 작업 카드 + 결과 모름 안내)
 * - 진행 중: "… 중…" / ack 를 못 받았으면 "확인 중"
 * - 끝남: 완료 · 중단됨(사유) · 결과 확인 필요(uncertain — 연결이 끊긴 사이 끝남, status.last 로 못 바로잡음)
 * - 프라이밍은 손을 떼서(앱 정지) 끝내는 게 정상이라 user 정지는 "완료"
 */
export function jobView(job: JobState): JobView {
  const name = jobKindLabel(job);
  const prime = job.kind === 'run' && job.purpose === 'prime';
  // 나온 양은 프라이밍만 (잔량에서 빼는 양). 세척은 물, 캘리브레이션 측정 구동은 계획량(기존 유량 기준)이라 실제와 달라 보여 주지 않음
  const total = prime ? dispensedTotal(job) : 0;
  const outText = total > 0 ? `약 ${total}ml 나왔어요.${prime ? ' 재료 잔량에서 뺐어요.' : ''}` : null;
  if (isBusy(job)) {
    if (job.status === 'pending' && job.uncertain) {
      return { title: `${name} 확인 중…`, tone: 'warning', badge: '결과 확인 필요', message: '명령은 보냈지만 기기의 응답을 아직 받지 못했어요. 기기 상태를 확인하고 있어요.' };
    }
    return { title: `${name} 중…`, tone: 'accent', badge: null, message: null };
  }
  if (job.status === 'error') {
    return {
      title: `${name} 확인 필요`,
      tone: 'warning',
      badge: job.uncertain ? '결과 확인 필요' : null,
      message: job.error ?? '기기가 작업을 시작하지 못했어요.',
    };
  }
  if (job.status === 'done') {
    if (job.uncertain) {
      return {
        title: `${name} 끝남`,
        tone: 'warning',
        badge: '결과 확인 필요',
        message: '연결이 끊긴 사이에 끝난 것으로 보여요. 중간에 멈췄을 수도 있으니 기기를 확인해 주세요.',
      };
    }
    return { title: `${name} 완료`, tone: 'success', badge: null, message: outText };
  }
  // stopped
  if (prime && job.reason === 'user' && !job.uncertain) {
    return { title: `${name} 완료`, tone: 'success', badge: null, message: outText };
  }
  const uncertain = !!job.uncertain || job.reason === 'disconnected' || job.reason === 'unknown' || job.reason === 'reboot';
  const why = maintenanceStopText(job.reason);
  const amount = total > 0 ? (uncertain ? ` 확인된 양은 약 ${total}ml 이에요.` : ` 지금까지 약 ${total}ml 나왔어요.`) : '';
  return {
    title: `${name} 중단됨`,
    tone: uncertain || job.reason === 'error' ? 'warning' : 'neutral',
    badge: uncertain ? '결과 확인 필요' : null,
    message: `${why}${amount}${prime && total > 0 ? ' 재료 잔량에서 뺐어요.' : ''}`,
  };
}

/** 펌프별 캘리브레이션 측정 상태 (v2.1 기기 정보 칸) */
export function calSetLabel(set: number | null | undefined): { text: string; tone: 'success' | 'warning' | 'neutral' } {
  if (set === 1) return { text: '측정함', tone: 'success' };
  if (set === 0) return { text: '측정 전', tone: 'warning' };
  return { text: '알 수 없음', tone: 'neutral' };
}

/**
 * 구동 작업의 남은 시간·진행률 (캘리브레이션 10초 구동 화면) — 0~totalMs, 0~1 로 자름 (UI-8)
 * ack 전이면 null. now 가 ack 보다 이르면(화면의 시계가 잠깐 늦음) 처음 상태로 봄
 */
export function runCountdown(job: Pick<JobState, 'ackAt' | 'totalMs'> | null | undefined, now: number): { remainingMs: number; progress: number } | null {
  if (!job?.ackAt) return null;
  const total = Math.max(0, job.totalMs || 0);
  const elapsed = Math.max(0, now - job.ackAt);
  return {
    remainingMs: Math.min(total, Math.max(0, total - elapsed)),
    progress: total > 0 ? Math.min(1, elapsed / total) : 0,
  };
}
