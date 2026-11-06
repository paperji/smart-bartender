/**
 * 추천 흐름 공용 함수 — 바텐더 · 레시피(다른 추천) · 제조 완료(한 잔 더) · 탐색 카드(장착 후 재추천)
 * SPEC §5.2 "한 잔 더?" 루프, §5.3 거절 처리, §5.4 탐색 모드
 */
import { router } from 'expo-router';

import { withAiBusy } from '@/components/AiLoading';
import type { PumpPick } from '@/lib/ai/explore';
import { generateRecipe } from '@/lib/ai/recommend';
import { getGeminiKey } from '@/lib/secrets';
import type { Category, ExploreItem, RecipeResult, RecommendMode, UserInput } from '@/lib/types';
import { alertMessage } from '@/lib/ui';
import { useSession } from '@/store/draft';
import { historyHints, useHistory } from '@/store/history';
import { useSettings } from '@/store/settings';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';

export interface RecommendArgs {
  input: UserInput;
  mode?: RecommendMode;
  /** 오프라인 추천 다양성 (기본: 무작위) */
  variation?: number;
  /** "다시 탐색" 횟수 */
  exploreRound?: number;
  /** 탐색 카드로 새 재료를 장착한 뒤 "해당 레시피" 재요청 */
  target?: ExploreItem | null;
}

/** 현재 설정·재료·기록으로 AI 추천 요청 */
export async function requestRecommendation(args: RecommendArgs): Promise<RecipeResult> {
  const st = useSettings.getState();
  const key = st.aiMode === 'direct' ? await getGeminiKey() : null;
  const h = useHistory.getState();
  return generateRecipe({
    input: args.input,
    slots: useSlots.getState().slots,
    history: historyHints(h.entries, h.rejections),
    aiMode: st.aiMode,
    serverUrl: st.serverUrl,
    geminiKey: key,
    geminiModel: st.geminiModel,
    mode: args.mode ?? 'normal',
    adultVerified: !!st.adultVerifiedAt,
    variation: args.variation ?? Math.floor(Math.random() * 100000),
    exploreRound: args.exploreRound ?? 0,
    target: args.target ?? null,
  });
}

export type NavHow = 'push' | 'replace' | 'none';

function go(path: '/recipe' | '/explore', how: NavHow) {
  if (how === 'push') router.push(path);
  else if (how === 'replace') router.replace(path);
}

/** 결과를 세션에 넣고 화면 이동 (explore 모드 → 탐색 화면, normal → 레시피 화면) */
export function showResult(
  result: RecipeResult,
  input: UserInput,
  opts: { variation?: number; round?: number; nav?: NavHow } = {},
) {
  const s = useSession.getState();
  const now = Date.now();
  if (result.recipe) {
    s.setCurrent({ ...result, recipe: result.recipe, createdAt: now, input, variation: opts.variation ?? 0 });
  }
  if (result.mode === 'explore') {
    s.setExplore({
      items: result.explore,
      recipe: result.recipe,
      source: result.source,
      model: result.model,
      warnings: result.warnings,
      fallbackReason: result.fallbackReason,
      input,
      createdAt: now,
      round: opts.round ?? 0,
    });
    go('/explore', opts.nav ?? 'push');
  } else {
    go('/recipe', opts.nav ?? 'push');
  }
  if (result.source === 'offline' && result.fallbackReason) {
    toast(
      result.timedOut ? 'AI 응답이 너무 늦어 오프라인 추천을 보여드려요.' : 'AI 서버에 연결하지 못해 오프라인 추천을 보여드려요.',
      'warning',
    );
  }
}

/** 로딩 화면을 띄우고 추천 → 결과 화면. 실패하면 안내창. 성공 여부 반환 */
export async function recommendAndShow(
  args: RecommendArgs,
  opts: { variation?: number; round?: number; nav?: NavHow; before?: () => void } = {},
): Promise<RecipeResult | null> {
  try {
    const result = await withAiBusy(() => requestRecommendation(args), args.mode === 'explore' ? 'explore' : 'normal');
    opts.before?.();
    showResult(result, args.input, opts);
    return result;
  } catch (e: any) {
    alertMessage(args.mode === 'explore' ? '새 재료 추천을 만들지 못했어요' : '레시피를 만들지 못했어요', e?.message ?? String(e));
    return null;
  }
}

/**
 * 탐색 카드 "펌프 N에 장착하기" → 재료 편집 화면(이름·카테고리·도수 미리 채움)
 * ingredient: 장착할 재료 (기본: 카드의 새 재료). 빈 기기 탐색처럼 새 재료가 2개인 카드는 두 번째 재료를 이어서 장착할 때 사용
 * replace: 재료 편집 화면에서 다음 재료 편집 화면으로 바로 넘어갈 때
 * done: 앞 단계에서 이미 장착한 재료 이름 키 (사용자가 이름을 바꿔 저장해도 같은 재료를 다시 묻지 않게)
 */
export function openInstall(
  item: ExploreItem,
  pick: PumpPick,
  opts: { replace?: boolean; ingredient?: { name: string; category: Category; abv: number }; done?: string[] } = {},
) {
  useSession.getState().setInstallTarget(item);
  const ing = opts.ingredient ?? { name: item.addIngredient, category: item.category, abv: item.abv };
  const href = {
    pathname: '/ingredient-edit' as const,
    params: {
      pump: String(pick.pump),
      suggest: ing.name,
      category: ing.category,
      abv: String(ing.abv),
      from: 'explore',
      ...(opts.done?.length ? { done: opts.done.join('|') } : {}),
    },
  };
  if (opts.replace) router.replace(href);
  else router.push(href);
}
