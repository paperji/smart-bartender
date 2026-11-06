/**
 * AI 추천 중 전체 화면 로딩 상태 (ui/AiLoading 의 AiLoadingHost 가 표시 — App 루트에 1개)
 * 홈 · 레시피 · 제조 완료 · 탐색 화면이 lib/flow.ts 를 통해 함께 사용
 */
import { create } from 'zustand';

export type AiBusyKind = 'normal' | 'explore';

export interface AiBusyState {
  busy: boolean;
  kind: AiBusyKind;
  title: string;
  lines: string[];
  /** 시작 시각 (오래 걸림 안내용) */
  startedAt: number | null;
}

export const NORMAL_LINES = [
  '기분과 취향을 분석하고 있어요',
  '장착된 재료를 살펴보는 중이에요',
  '황금 비율을 계산하고 있어요',
  '레시피 이름을 짓고 있어요',
];

export const EXPLORE_LINES = [
  '지금 재료와 어울리는 새 재료를 찾는 중이에요',
  '펌프 하나만 바꿔도 되는 조합을 고르고 있어요',
  '새 레시피를 설계하고 있어요',
];

/** 이 시간이 지나면 "오래 걸리는 중" 안내 */
export const SLOW_AFTER_MS = 10000;
export const SLOW_TEXT = '조금 오래 걸리고 있어요. AI 응답이 늦으면 앱에 내장된 추천으로 바꿔 드릴게요.';

export const useAiBusy = create<AiBusyState>()(() => ({
  busy: false,
  kind: 'normal',
  title: '',
  lines: NORMAL_LINES,
  startedAt: null,
}));

/** fn 이 끝날 때까지 로딩 화면 표시 */
export async function withAiBusy<T>(fn: () => Promise<T>, kind: AiBusyKind = 'normal'): Promise<T> {
  useAiBusy.setState({
    busy: true,
    kind,
    title: kind === 'explore' ? 'AI 바텐더가 새 재료를 찾고 있어요' : 'AI 바텐더가 레시피를 고민 중이에요',
    lines: kind === 'explore' ? EXPLORE_LINES : NORMAL_LINES,
    startedAt: Date.now(),
  });
  try {
    return await fn();
  } finally {
    useAiBusy.setState({ busy: false, startedAt: null });
  }
}
