/**
 * 사용법 안내 진행 상태 (저장하지 않음 — "봤음"은 settings.tutorialSeen 에만 저장)
 *  phase: idle(닫힘) · welcome(처음 접속 환영 창) · tour(화면을 차례로 비추며 설명) · done(마지막 "준비 끝" 창)
 *  환영 창에서 무엇을 고르든(사용법 보기·건너뛰기·닫기) 그 순간 tutorialSeen = true → 다음 접속부터 자동으로 열리지 않음
 *  (중간에 앱을 꺼도 다시 강제로 열리지 않게. 이미 봤어도 설정 화면 맨 위 '사용법 다시 보기'로 처음부터 다시 볼 수 있음)
 * 기기가 작업 중(제조·세척·구동)이면 시작하지 않고 화면도 옮기지 않음 — 제조 화면의 비상 정지를 가리거나 제조 화면을 떠나지 않게.
 * 안내 중에 작업이 시작되면 화면(TutorialHost)이 suspend() 로 바로 닫음
 */
import { create } from 'zustand';

import { go, locationPath } from '@/lib/nav';
import { TOUR_END_ROUTE, TOUR_STEPS } from '@/lib/tutorial';

import { isBusy, useDevice } from './device';
import { useSettings } from './settings';
import { toast } from './toast';

export type TutorialPhase = 'idle' | 'welcome' | 'tour' | 'done';

export interface TutorialState {
  phase: TutorialPhase;
  /** 지금 단계 (TOUR_STEPS 번호, tour 일 때만 의미 있음) */
  step: number;
  /** 처음 접속 환영 창 열기 */
  openWelcome: () => void;
  /** 안내 시작 (환영 창의 [사용법 보기] · 설정의 [사용법 다시 보기]) — 첫 단계 화면으로 이동 */
  start: () => void;
  next: () => void;
  prev: () => void;
  /** 그만 보기 (건너뛰기·닫기·Esc·안드로이드 뒤로) — 지금 화면에 그대로 머묾 */
  close: () => void;
  /** 마지막 창까지 봄 → 닫고 바텐더로 */
  finish: () => void;
  /** 기기가 작업을 시작해 비킴 — 환영 창이었으면 봤음으로 치지 않음(작업이 끝나면 다시 뜸), 안내 중이었으면 닫음 */
  suspend: () => void;
}

const markSeen = () => {
  if (!useSettings.getState().tutorialSeen) useSettings.getState().set({ tutorialSeen: true });
};

/** 기기가 작업 중 (제조·세척·구동) */
const deviceBusy = () => isBusy(useDevice.getState().job);

/** 단계 화면으로 이동 — 바꿔 열기(replace)라 안내가 끝난 뒤 뒤로 버튼이 안내에서 지나간 화면을 거치지 않음. 작업 중이면 옮기지 않음 */
const goStep = (i: number) => {
  const route = TOUR_STEPS[i]?.route;
  if (route && !deviceBusy() && locationPath() !== route) go(route, { replace: true });
};

export const useTutorial = create<TutorialState>()((set, get) => ({
  phase: 'idle',
  step: 0,
  openWelcome: () => {
    if (get().phase === 'idle') set({ phase: 'welcome', step: 0 });
  },
  start: () => {
    if (deviceBusy()) {
      toast('기기가 작동 중이에요. 끝난 뒤에 사용법을 볼 수 있어요.', 'warning');
      return;
    }
    markSeen();
    set({ phase: 'tour', step: 0 });
    goStep(0);
  },
  next: () => {
    const { phase, step } = get();
    if (phase !== 'tour') return;
    if (step >= TOUR_STEPS.length - 1) {
      set({ phase: 'done' });
      return;
    }
    set({ step: step + 1 });
    goStep(step + 1);
  },
  prev: () => {
    const { phase, step } = get();
    if (phase === 'done') {
      const last = TOUR_STEPS.length - 1;
      set({ phase: 'tour', step: last });
      goStep(last);
      return;
    }
    if (phase !== 'tour' || step <= 0) return;
    set({ step: step - 1 });
    goStep(step - 1);
  },
  close: () => {
    markSeen();
    set({ phase: 'idle', step: 0 });
  },
  finish: () => {
    markSeen();
    set({ phase: 'idle', step: 0 });
    if (!deviceBusy() && locationPath() !== TOUR_END_ROUTE) go(TOUR_END_ROUTE, { replace: true });
  },
  suspend: () => {
    if (get().phase === 'idle') return;
    if (get().phase !== 'welcome') markSeen();
    set({ phase: 'idle', step: 0 });
  },
}));

/** 화면 밖에서 안내 시작 (설정·바텐더의 다시 보기 버튼) */
export const startTutorial = (): void => useTutorial.getState().start();
