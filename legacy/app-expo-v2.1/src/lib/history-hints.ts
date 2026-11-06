/**
 * AI 요청용 history 만들기 (SPEC §3.1) — 순수 함수 (React Native 비의존, Node 테스트용으로 store 와 분리)
 * 피드백이 있는 제조 기록 + 거절 기록을 합쳐 **최신 기록부터**(최신 → 오래된 순) 최대 10개. 서버는 앞에서 10개를 사용.
 *  - 👍 → liked:true, rejected:false / 👎 → liked:false, rejected:false / 다른 추천 → liked:false, rejected:true
 */
import { HISTORY_LIMIT } from './ai/recommend';
import type { HistoryHint } from './types';

export interface HintEntry {
  createdAt: number;
  feedback: 'like' | 'dislike' | null;
  /** 피드백을 준 시각 (없으면 만든 시각) */
  feedbackAt?: number;
  recipe: { name: string; ingredients: { name: string; ml: number }[] };
}

export interface HintRejection {
  at: number;
  name: string;
  ingredients: { name: string; ml: number }[];
}

export function historyHints(entries: HintEntry[], rejections: HintRejection[] = []): HistoryHint[] {
  const items: { at: number; hint: HistoryHint }[] = [];
  for (const e of entries) {
    if (!e.feedback) continue;
    items.push({
      at: e.feedbackAt ?? e.createdAt,
      hint: {
        name: e.recipe.name,
        liked: e.feedback === 'like',
        rejected: false,
        ingredients: e.recipe.ingredients.map((i) => ({ name: i.name, ml: i.ml })),
      },
    });
  }
  for (const r of rejections) {
    items.push({ at: r.at, hint: { name: r.name, liked: false, rejected: true, ingredients: r.ingredients } });
  }
  items.sort((a, b) => b.at - a.at); // 최신 → 오래된 순
  return items.slice(0, HISTORY_LIMIT).map((x) => x.hint);
}
