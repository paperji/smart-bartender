/**
 * 제조 기록 · 즐겨찾기 · 거절 기록
 * - 피드백(👍/👎)과 "다른 추천"(거절)은 다음 AI 추천의 history 로 전달됩니다 (SPEC §3.1, §5.3).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Recipe, RecipeSource, Strength } from '@/lib/types';

import { appStorage, STORAGE_KEYS } from './storage';

export type Feedback = 'like' | 'dislike' | null;

export interface HistoryEntry {
  id: string;
  createdAt: number;
  recipe: Recipe;
  source: RecipeSource;
  status: 'done' | 'stopped';
  /** 연결이 끊긴 동안 끝나 결과(양·완료 여부)를 정확히 모름 */
  uncertain?: boolean;
  dispensed: { p: number; ml: number }[];
  feedback: Feedback;
  /** 피드백을 준 시각 (history 순서용) */
  feedbackAt?: number;
  moods: string[];
  strength: Strength;
}

export interface FavoriteEntry {
  id: string;
  savedAt: number;
  recipe: Recipe;
}

/** 레시피 화면에서 "다른 추천"을 누른(거절한) 레시피 */
export interface RejectionEntry {
  id: string;
  at: number;
  name: string;
  ingredients: { name: string; ml: number }[];
}

interface HistoryState {
  entries: HistoryEntry[];
  favorites: FavoriteEntry[];
  rejections: RejectionEntry[];
  add: (e: Omit<HistoryEntry, 'id' | 'createdAt' | 'feedback'> & { id?: string }) => string;
  setFeedback: (id: string, fb: Feedback) => void;
  remove: (id: string) => void;
  toggleFavorite: (recipe: Recipe) => boolean;
  removeFavorite: (id: string) => void;
  addRejection: (recipe: Recipe) => void;
  clear: () => void;
}

export const recipeKey = (r: Recipe) =>
  r.name + '|' + r.ingredients.map((i) => `${i.pump}:${i.name}:${Math.round(i.ml)}`).join(',');

export const useHistory = create<HistoryState>()(
  persist(
    (set, get) => ({
      entries: [],
      favorites: [],
      rejections: [],
      add: (e) => {
        const id = e.id ?? 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        // 같은 작업이 다시 끝나면(연결이 끊겨 정리 → 재연결 뒤 실제 결과) 같은 항목을 갱신 — 만든 시각·피드백은 유지
        const old = get().entries.find((x) => x.id === id);
        const entry: HistoryEntry = {
          ...e,
          id,
          createdAt: old?.createdAt ?? Date.now(),
          feedback: old?.feedback ?? null,
          ...(old?.feedbackAt ? { feedbackAt: old.feedbackAt } : {}),
        };
        set({ entries: [entry, ...get().entries.filter((x) => x.id !== id)].slice(0, 150) });
        return id;
      },
      setFeedback: (id, fb) =>
        set({ entries: get().entries.map((x) => (x.id === id ? { ...x, feedback: fb, feedbackAt: Date.now() } : x)) }),
      remove: (id) => set({ entries: get().entries.filter((x) => x.id !== id) }),
      toggleFavorite: (recipe) => {
        const key = recipeKey(recipe);
        const exists = get().favorites.find((f) => recipeKey(f.recipe) === key);
        if (exists) {
          set({ favorites: get().favorites.filter((f) => f.id !== exists.id) });
          return false;
        }
        const fav: FavoriteEntry = { id: 'f' + Date.now().toString(36), savedAt: Date.now(), recipe };
        set({ favorites: [fav, ...get().favorites].slice(0, 100) });
        return true;
      },
      removeFavorite: (id) => set({ favorites: get().favorites.filter((f) => f.id !== id) }),
      addRejection: (recipe) => {
        const r: RejectionEntry = {
          id: 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          at: Date.now(),
          name: recipe.name,
          ingredients: recipe.ingredients.map((i) => ({ name: i.name, ml: i.ml })),
        };
        set({ rejections: [r, ...get().rejections].slice(0, 30) });
      },
      clear: () => set({ entries: [], favorites: [], rejections: [] }),
    }),
    {
      name: STORAGE_KEYS.history,
      storage: appStorage,
      version: 1,
      partialize: (s) => ({ entries: s.entries, favorites: s.favorites, rejections: s.rejections }),
    },
  ),
);

/** AI 요청용 history (SPEC §3.1, 최신 기록부터 최대 10개) — 순수 함수는 lib/history-hints.ts */
export { historyHints } from '@/lib/history-hints';

export function isFavorite(favorites: FavoriteEntry[], recipe: Recipe | null | undefined) {
  if (!recipe) return false;
  const key = recipeKey(recipe);
  return favorites.some((f) => recipeKey(f.recipe) === key);
}
