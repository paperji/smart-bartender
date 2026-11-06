/**
 * 제조 기록 · 즐겨찾기 · 거절 기록
 * - 피드백(👍/👎)과 "다른 추천"(거절)은 다음 AI 추천의 history 로 전달됩니다 (SPEC §3.1, §5.3).
 * - 저장값은 불러올 때 모양을 확인함(sanitizeHistory) — 레시피·재료가 없는 항목은 버리고 빠진 칸은 기본값으로
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Flavor, Recipe, RecipeSource, Strength, Suggestion } from '@/lib/types';

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

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown) => (typeof v === 'string' ? v : '');
const STRENGTHS: readonly Strength[] = ['none', 'light', 'medium', 'strong'];
const SUGGESTION_TYPES: readonly Suggestion['type'][] = ['add_ingredient', 'substitute', 'low_stock', 'info'];

/** 저장돼 있던 레시피 → 온전한 Recipe (이름·재료 목록이 없으면 null). 빠진 칸은 기본값으로 */
export function sanitizeRecipe(raw: unknown): Recipe | null {
  if (!isObj(raw) || typeof raw.name !== 'string' || !Array.isArray(raw.ingredients)) return null;
  const ingredients = raw.ingredients
    .filter((i): i is Record<string, unknown> => isObj(i) && finite(i.pump) && typeof i.name === 'string' && finite(i.ml))
    .map((i) => ({ pump: i.pump as number, name: i.name as string, ml: i.ml as number }));
  if (!ingredients.length) return null;
  const f = isObj(raw.flavor) ? raw.flavor : {};
  const flavor: Flavor = {
    sweet: finite(f.sweet) ? f.sweet : 0,
    sour: finite(f.sour) ? f.sour : 0,
    bitter: finite(f.bitter) ? f.bitter : 0,
    fizzy: finite(f.fizzy) ? f.fizzy : 0,
    strength: finite(f.strength) ? f.strength : 0,
  };
  const suggestions: Suggestion[] = Array.isArray(raw.suggestions)
    ? raw.suggestions
        .filter((x): x is Record<string, unknown> => isObj(x) && SUGGESTION_TYPES.includes(x.type as Suggestion['type']) && typeof x.message === 'string')
        .map((x) => ({
          type: x.type as Suggestion['type'],
          message: x.message as string,
          ...(typeof x.ingredient === 'string' ? { ingredient: x.ingredient } : {}),
          ...(finite(x.pump) ? { pump: x.pump } : {}),
        }))
    : [];
  return {
    name: raw.name,
    ...(typeof raw.nameEn === 'string' && raw.nameEn ? { nameEn: raw.nameEn } : {}),
    description: text(raw.description),
    reason: text(raw.reason),
    ingredients,
    totalMl: finite(raw.totalMl) ? raw.totalMl : ingredients.reduce((a, b) => a + b.ml, 0),
    estimatedAbv: finite(raw.estimatedAbv) ? raw.estimatedAbv : 0,
    flavor,
    garnish: text(raw.garnish),
    tips: text(raw.tips),
    suggestions,
  };
}

const steps = (v: unknown) =>
  Array.isArray(v) ? v.filter((d): d is { p: number; ml: number } => isObj(d) && finite(d.p) && finite(d.ml)).map((d) => ({ p: d.p, ml: d.ml })) : [];

function sanitizeEntry(raw: unknown, idx: number): HistoryEntry | null {
  if (!isObj(raw)) return null;
  const recipe = sanitizeRecipe(raw.recipe);
  if (!recipe) return null;
  const entry: HistoryEntry = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `h-restored-${idx}`,
    createdAt: finite(raw.createdAt) ? raw.createdAt : 0,
    recipe,
    source: raw.source === 'direct' || raw.source === 'offline' ? raw.source : 'offline',
    status: raw.status === 'stopped' ? 'stopped' : 'done',
    dispensed: steps(raw.dispensed),
    feedback: raw.feedback === 'like' || raw.feedback === 'dislike' ? raw.feedback : null,
    moods: Array.isArray(raw.moods) ? raw.moods.filter((m): m is string => typeof m === 'string') : [],
    strength: STRENGTHS.includes(raw.strength as Strength) ? (raw.strength as Strength) : 'none',
  };
  if (raw.uncertain === true) entry.uncertain = true;
  if (finite(raw.feedbackAt)) entry.feedbackAt = raw.feedbackAt;
  return entry;
}

function sanitizeFavorite(raw: unknown, idx: number): FavoriteEntry | null {
  if (!isObj(raw)) return null;
  const recipe = sanitizeRecipe(raw.recipe);
  if (!recipe) return null;
  return { id: typeof raw.id === 'string' && raw.id ? raw.id : `f-restored-${idx}`, savedAt: finite(raw.savedAt) ? raw.savedAt : 0, recipe };
}

function sanitizeRejection(raw: unknown, idx: number): RejectionEntry | null {
  if (!isObj(raw) || typeof raw.name !== 'string' || !Array.isArray(raw.ingredients)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `x-restored-${idx}`,
    at: finite(raw.at) ? raw.at : 0,
    name: raw.name,
    ingredients: raw.ingredients
      .filter((i): i is Record<string, unknown> => isObj(i) && typeof i.name === 'string' && finite(i.ml))
      .map((i) => ({ name: i.name as string, ml: i.ml as number })),
  };
}

function list<T>(raw: unknown, fix: (x: unknown, idx: number) => T | null, max: number): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  raw.forEach((x, idx) => {
    const v = fix(x, idx);
    if (v) out.push(v);
  });
  return out.slice(0, max);
}

/** 저장돼 있던 기록 → 온전한 기록·즐겨찾기·거절 목록 (모양이 틀린 항목은 버림 — 화면·AI 요청이 깨지지 않게) */
export function sanitizeHistory(raw: unknown): Pick<HistoryState, 'entries' | 'favorites' | 'rejections'> {
  const p = isObj(raw) ? raw : {};
  return {
    entries: list(p.entries, sanitizeEntry, 150),
    favorites: list(p.favorites, sanitizeFavorite, 100),
    rejections: list(p.rejections, sanitizeRejection, 30),
  };
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
      // 저장값 모양 확인 (레시피가 없는 항목 하나 때문에 기록 화면·AI 요청이 깨지지 않게)
      merge: (persisted, current) => ({ ...current, ...sanitizeHistory(persisted) }),
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
