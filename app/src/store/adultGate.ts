/**
 * 성인 인증 — 주류(abv>0)가 들어간 레시피를 처음 제조할 때 1회 확인 + 음주 경고 (v2.1 AdultGate 와 같은 흐름)
 * ensureAdult() 는 이미 확인했으면 바로 true, 아니면 ui/AdultGate 의 AdultGateHost(App 루트에 1개)가 창을 띄우고 답을 돌려줌
 */
import { create } from 'zustand';

import { useSettings } from './settings';

interface GateState {
  visible: boolean;
  resolve: ((ok: boolean) => void) | null;
}

export const useAdultGate = create<GateState>()(() => ({ visible: false, resolve: null }));

/** 성인 확인 창에 나오는 경고 문구 (v2.1 과 같음) */
export const ADULT_WARNINGS = [
  '미성년자에게 술을 제공하는 것은 법으로 금지되어 있어요.',
  '음주 후에는 절대 운전하지 마세요. (음주운전은 범죄입니다)',
  '임신 중이거나 약을 복용 중이라면 음주를 삼가 주세요.',
  '지나친 음주는 건강을 해칩니다.',
];

/** 성인 확인이 필요하면 창을 띄우고 결과를 돌려줍니다 */
export function ensureAdult(): Promise<boolean> {
  if (useSettings.getState().adultVerifiedAt) return Promise.resolve(true);
  const prev = useAdultGate.getState().resolve;
  return new Promise((resolve) => {
    prev?.(false);
    useAdultGate.setState({ visible: true, resolve });
  });
}

/** 창의 버튼에서 호출: ok 면 확인 시각 저장 */
export function answerAdultGate(ok: boolean): void {
  const { resolve } = useAdultGate.getState();
  if (ok) useSettings.getState().set({ adultVerifiedAt: Date.now() });
  useAdultGate.setState({ visible: false, resolve: null });
  resolve?.(ok);
}
