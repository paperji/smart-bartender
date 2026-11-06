/**
 * 홈 화면 입력값(초안) + 현재 레시피/탐색 세션
 * 저장된 입력값은 불러올 때 모양을 확인함(sanitizeInput) — 빠진 칸·잘못된 값은 기본값으로 (깨진 저장값 때문에 화면이 하얗게 멈추지 않게)
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { ExploreItem, Recipe, RecipeResult, Strength, Taste, UserInput } from '@/lib/types';

import { appStorage, STORAGE_KEYS } from './storage';

export const DEFAULT_INPUT: UserInput = {
  moods: [],
  taste: { sweet: 3, sour: 2, bitter: 0, fizzy: 3 },
  strength: 'none',
  weather: null,
  situation: '',
  preference: '',
  cupMl: 200,
};

const STRENGTHS: readonly Strength[] = ['none', 'light', 'medium', 'strong'];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

/**
 * 저장돼 있던(또는 알 수 없는) 입력값 → 온전한 UserInput. 빠진 칸·모양이 틀린 칸은 기본값으로 채움
 * (예전 버전·부분 저장·수동 정리로 input 이 망가져 있어도 홈 화면이 그려지게)
 */
export function sanitizeInput(raw: unknown): UserInput {
  const i = isObj(raw) ? raw : {};
  const t = isObj(i.taste) ? i.taste : {};
  const d = DEFAULT_INPUT.taste;
  // 맛 0~5 단계 (홈 화면 ScaleSelector)
  const taste: Taste = {
    sweet: Math.round(num(t.sweet, d.sweet, 0, 5)),
    sour: Math.round(num(t.sour, d.sour, 0, 5)),
    bitter: Math.round(num(t.bitter, d.bitter, 0, 5)),
    fizzy: Math.round(num(t.fizzy, d.fizzy, 0, 5)),
  };
  return {
    moods: Array.isArray(i.moods) ? i.moods.filter((m): m is string => typeof m === 'string') : [],
    taste,
    strength: STRENGTHS.includes(i.strength as Strength) ? (i.strength as Strength) : DEFAULT_INPUT.strength,
    // 날씨는 저장하지 않음 (그날그날 다름)
    weather: null,
    situation: str(i.situation),
    preference: str(i.preference),
    // 잔 용량 100~400ml (홈 화면 CUP 과 같은 범위)
    cupMl: Math.round(num(i.cupMl, DEFAULT_INPUT.cupMl, 100, 400)),
  };
}

interface DraftState {
  input: UserInput;
  setInput: (patch: Partial<UserInput>) => void;
  resetInput: () => void;
}

export const useDraft = create<DraftState>()(
  persist(
    (set, get) => ({
      input: DEFAULT_INPUT,
      setInput: (patch) => set({ input: { ...get().input, ...patch } }),
      resetInput: () => set({ input: DEFAULT_INPUT }),
    }),
    {
      name: STORAGE_KEYS.draft,
      storage: appStorage,
      version: 1,
      // 날씨는 그날그날 달라지므로 저장하지 않음
      partialize: (s) => ({ input: { ...s.input, weather: null } }),
      // 저장값 모양 확인 (기본 얕은 합치기는 input 을 통째로 바꿔서, 칸이 빠진 input 이면 홈 화면이 깨짐)
      merge: (persisted, current) => ({ ...current, input: sanitizeInput(isObj(persisted) ? persisted.input : undefined) }),
    },
  ),
);

/** 현재 보고 있는 레시피 (저장하지 않음) */
export interface CurrentRecipe extends Omit<RecipeResult, 'recipe'> {
  recipe: Recipe;
  createdAt: number;
  input: UserInput;
  /** 다시 추천 횟수 */
  variation: number;
  /** 기록/즐겨찾기에서 불러온 경우 */
  fromSaved?: boolean;
}

/** 탐색(explore) 결과 화면 상태 */
export interface ExploreSession {
  items: ExploreItem[];
  /** 함께 온 "지금 재료로 만들 수 있는 레시피" (없으면 null) */
  recipe: Recipe | null;
  source: RecipeResult['source'];
  model?: string;
  warnings: string[];
  fallbackReason?: string;
  /** 오프라인으로 바뀐 원인 코드 (RecipeResult.fallbackCode — 'NO_KEY' 등) */
  fallbackCode?: string;
  input: UserInput;
  createdAt: number;
  /** "다시 탐색" 횟수 */
  round: number;
}

interface SessionState {
  current: CurrentRecipe | null;
  explore: ExploreSession | null;
  /** 연속 거절("다른 추천") 횟수 — 2회 이상이면 탐색 모드 배너 (SPEC §5.3) */
  rejectStreak: number;
  /** 현재 제조 작업의 기록 ID */
  brewHistoryId: string | null;
  /** 탐색 카드에서 "펌프 N에 장착하기"를 누른 항목 (재료 저장 후 해당 레시피 재요청) */
  installTarget: ExploreItem | null;
  /**
   * 그 카드가 나온 추천 요청의 입력값 (레시피 화면 카드 → 그 레시피의 입력, 탐색 화면 카드 → 그 탐색의 입력).
   * 재료를 저장한 뒤 이 입력으로 다시 추천 — 예전 탐색 입력(다른 잔 용량·도수)으로 다시 추천하지 않게
   */
  installInput: UserInput | null;
  setCurrent: (c: CurrentRecipe | null) => void;
  setExplore: (e: ExploreSession | null) => void;
  patchRecipe: (patch: Partial<CurrentRecipe['recipe']>) => void;
  setBrewHistoryId: (id: string | null) => void;
  setRejectStreak: (n: number) => void;
  /** 장착할 탐색 항목 + 그 카드가 나온 요청의 입력값 (null 이면 둘 다 지움) */
  setInstallTarget: (t: ExploreItem | null, input?: UserInput | null) => void;
}

export const useSession = create<SessionState>()((set, get) => ({
  current: null,
  explore: null,
  rejectStreak: 0,
  brewHistoryId: null,
  installTarget: null,
  installInput: null,
  setCurrent: (c) => set({ current: c }),
  setExplore: (e) => set({ explore: e }),
  patchRecipe: (patch) => {
    const cur = get().current;
    if (!cur) return;
    set({ current: { ...cur, recipe: { ...cur.recipe, ...patch } } });
  },
  setBrewHistoryId: (id) => set({ brewHistoryId: id }),
  setRejectStreak: (n) => set({ rejectStreak: Math.max(0, n) }),
  setInstallTarget: (t, input) => set({ installTarget: t, installInput: t ? (input ?? null) : null }),
}));
