/**
 * 기록·즐겨찾기 → "다시 만들기" (v2.1 (tabs)/history.tsx 의 remake 그대로)
 *  - 저장된 레시피를 지금 장착 상태에 맞게 다시 매칭(remapSavedRecipe — 이름 기준 → 펌프 번호 갱신)
 *  - 지금 성향(알레르기·싫어하는 재료)도 레시피 화면의 ml 조정과 같은 기준으로 처음부터 반영
 *    → 빠진 재료는 warnings("성향에 적힌 대로 '우유'는 뺐어요." 등)로 레시피 화면 안내 배너에 보임
 *  - 만들 수 없으면 "다시 만들 수 없어요" 안내창 + 이유(성향으로 뺀 재료·무알콜·미장착 등)
 */
import { strengthForAbv } from '@/lib/ai/normalize';
import type { AiProviderId } from '@/lib/ai/providers';
import { remapSavedRecipe } from '@/lib/brew';
import { go } from '@/lib/nav';
import type { PumpSlot, Recipe, RecipeSource, Strength, UserInput } from '@/lib/types';
import { DEFAULT_INPUT, useDraft, useSession, type CurrentRecipe } from '@/store/draft';
import { recipeKey, type FavoriteEntry, type HistoryEntry } from '@/store/history';
import { useSlots } from '@/store/slots';
import { alertMessage } from '@/ui/dialog/service';

export const REMAKE_FAIL_TITLE = '다시 만들 수 없어요';
const REMAKE_FAIL_DEFAULT = '지금 장착된 재료로는 이 레시피를 만들 수 없어요.';

/** 다시 만들 때 이어받을 출처 — 만든 AI(공유할 때 AI 이름) · 모두의 레시피 id(사용 횟수·다시 공유 막기) (v3.1) */
export interface SavedOrigin {
  provider?: AiProviderId;
  sharedId?: string;
}

/** 저장된 레시피 → 레시피 화면에 띄울 세션 (만들 수 없으면 remapSavedRecipe 가 던진 오류를 그대로 던짐) */
export function buildSavedSession(
  recipe: Recipe,
  source: RecipeSource,
  strength: Strength | undefined,
  slots: PumpSlot[],
  base: UserInput = useDraft.getState().input ?? DEFAULT_INPUT,
  origin: SavedOrigin = {},
): CurrentRecipe {
  const st = strength ?? strengthForAbv(recipe.estimatedAbv);
  const { recipe: r, warnings } = remapSavedRecipe(recipe, slots, st, undefined, base.preference);
  return {
    recipe: r,
    explore: [],
    mode: 'normal',
    source,
    warnings,
    createdAt: Date.now(),
    input: { ...base, strength: st, cupMl: Math.round(r.totalMl) },
    variation: 0,
    fromSaved: true,
    ...(source === 'direct' && origin.provider ? { provider: origin.provider } : {}),
    ...(origin.sharedId ? { sharedId: origin.sharedId } : {}),
  };
}

/** 다시 만들 수 없을 때 안내 본문 — 오류 문구 + 이유 줄(adjustments) */
export function remakeErrorText(e: unknown): string {
  const err = (e ?? {}) as { message?: unknown; adjustments?: unknown };
  const why = Array.isArray(err.adjustments) ? err.adjustments.filter((w): w is string => typeof w === 'string') : [];
  const msg = typeof err.message === 'string' && err.message ? err.message : REMAKE_FAIL_DEFAULT;
  return [msg, ...why].join('\n');
}

/**
 * 즐겨찾기의 출처·도수 단계 — v3.1 부터 즐겨찾기에 남긴 출처(공유 id·AI·출처)를 먼저 쓰고,
 * 없으면 같은 레시피의 제조 기록 값, 그것도 없으면 v2.1 처럼 AI 추천(v3: 'direct')·완성 도수 기준 단계
 */
export function favoriteOrigin(
  fav: Recipe | Pick<FavoriteEntry, 'recipe' | 'sharedId' | 'provider' | 'source'>,
  entries: readonly HistoryEntry[],
): { source: RecipeSource; strength?: Strength } & SavedOrigin {
  const f: Pick<FavoriteEntry, 'recipe' | 'sharedId' | 'provider' | 'source'> = 'recipe' in fav ? fav : { recipe: fav };
  const key = recipeKey(f.recipe);
  const hit = entries.find((e) => recipeKey(e.recipe) === key);
  const provider = f.provider ?? hit?.provider;
  const sharedId = f.sharedId ?? hit?.sharedId;
  return {
    source: f.source ?? hit?.source ?? 'direct',
    ...(hit ? { strength: hit.strength } : {}),
    ...(provider ? { provider } : {}),
    ...(sharedId ? { sharedId } : {}),
  };
}

/** 다시 만들기 — 성공하면 레시피 화면으로 이동하고 true (origin: 만든 AI·공유 id 이어받기) */
export function remakeSaved(recipe: Recipe, source: RecipeSource, strength?: Strength, origin: SavedOrigin = {}): boolean {
  try {
    const session = buildSavedSession(recipe, source, strength, useSlots.getState().slots, undefined, origin);
    useSession.getState().setCurrent(session);
    useSession.getState().setRejectStreak(0);
    go('/recipe');
    return true;
  } catch (e) {
    alertMessage(REMAKE_FAIL_TITLE, remakeErrorText(e));
    return false;
  }
}
