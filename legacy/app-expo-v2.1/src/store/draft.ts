/**
 * 홈 화면 입력값(초안) + 현재 레시피/탐색 세션
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { ExploreItem, Recipe, RecipeResult, UserInput } from '@/lib/types';

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
  setCurrent: (c: CurrentRecipe | null) => void;
  setExplore: (e: ExploreSession | null) => void;
  patchRecipe: (patch: Partial<CurrentRecipe['recipe']>) => void;
  setBrewHistoryId: (id: string | null) => void;
  setRejectStreak: (n: number) => void;
  setInstallTarget: (t: ExploreItem | null) => void;
}

export const useSession = create<SessionState>()((set, get) => ({
  current: null,
  explore: null,
  rejectStreak: 0,
  brewHistoryId: null,
  installTarget: null,
  setCurrent: (c) => set({ current: c }),
  setExplore: (e) => set({ explore: e }),
  patchRecipe: (patch) => {
    const cur = get().current;
    if (!cur) return;
    set({ current: { ...cur, recipe: { ...cur.recipe, ...patch } } });
  },
  setBrewHistoryId: (id) => set({ brewHistoryId: id }),
  setRejectStreak: (n) => set({ rejectStreak: Math.max(0, n) }),
  setInstallTarget: (t) => set({ installTarget: t }),
}));
