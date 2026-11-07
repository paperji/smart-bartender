/**
 * 추천 흐름 공용 함수 — 바텐더 · 레시피(다른 추천) · 제조 완료(한 잔 더) · 탐색 카드(장착 후 재추천)
 * SPEC §5.2 "한 잔 더?" 루프, §5.3 거절 처리, §5.4 탐색 모드
 * v3.0: expo-router → lib/nav.ts, Alert → ui/dialog/service, 키는 platform/secrets (BYOK — 키가 없으면 오프라인 추천)
 */
import type { PumpPick } from '@/lib/ai/explore';
import { providerLabel } from '@/lib/ai/providers';
import { AI_ERROR_TEXT, generateRecipe, type AiErrorCode } from '@/lib/ai/recommend';
import type { Category, ExploreItem, RecipeResult, RecommendMode, UserInput } from '@/lib/types';
import { getAiKey } from '@/platform/secrets';
import { withAiBusy } from '@/store/aiBusy';
import { useDraft, useSession } from '@/store/draft';
import { historyHints, useHistory } from '@/store/history';
import { activeModel, useSettings } from '@/store/settings';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';
import { alertMessage } from '@/ui/dialog/service';

import { go, withQuery } from './nav';

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

/** 현재 설정·재료·기록으로 AI 추천 요청 (설정이 ai 여도 고른 회사의 키가 없으면 오프라인 추천 + fallbackCode 'NO_KEY') */
export async function requestRecommendation(args: RecommendArgs): Promise<RecipeResult> {
  const st = useSettings.getState();
  const key = st.aiMode === 'ai' ? await getAiKey(st.aiProvider) : null;
  const h = useHistory.getState();
  return generateRecipe({
    input: args.input,
    slots: useSlots.getState().slots,
    history: historyHints(h.entries, h.rejections),
    aiMode: st.aiMode,
    aiProvider: st.aiProvider,
    aiKey: key,
    aiModel: activeModel(st),
    mode: args.mode ?? 'normal',
    adultVerified: !!st.adultVerifiedAt,
    variation: args.variation ?? Math.floor(Math.random() * 100000),
    exploreRound: args.exploreRound ?? 0,
    target: args.target ?? null,
  });
}

export type NavHow = 'push' | 'replace' | 'none';

function goTo(path: '/recipe' | '/explore', how: NavHow) {
  if (how === 'push') go(path);
  else if (how === 'replace') go(path, { replace: true });
}

/** 키가 없어 오프라인 추천을 쓴다는 토스트는 앱을 켤 때마다 1번만 (첫 실행 안내 카드·설정에서 이미 안내) */
let noKeyToastShown = false;

/** 오프라인 추천으로 바뀐 이유 → 토스트 문구 (null 이면 토스트 없음) */
export function fallbackToast(result: Pick<RecipeResult, 'source' | 'fallbackReason' | 'fallbackCode' | 'timedOut' | 'provider'>): {
  message: string;
  kind: 'info' | 'warning';
} | null {
  if (result.source !== 'offline' || !result.fallbackReason) return null;
  if (result.fallbackCode === 'NO_KEY') {
    return { message: 'AI 키가 없어 오프라인 추천을 보여드려요. 설정에서 내 AI 키를 등록할 수 있어요.', kind: 'info' };
  }
  if (result.timedOut) return { message: 'AI 응답이 너무 늦어 오프라인 추천을 보여드려요.', kind: 'warning' };
  const why = result.fallbackCode && result.fallbackCode in AI_ERROR_TEXT ? AI_ERROR_TEXT[result.fallbackCode as AiErrorCode] : null;
  const label = result.provider ? providerLabel(result.provider) : 'AI';
  return {
    message: why ? `${label}에서 답을 받지 못해 오프라인 추천을 보여드려요. (${why})` : `${label}에 연결하지 못해 오프라인 추천을 보여드려요.`,
    kind: 'warning',
  };
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
      fallbackCode: result.fallbackCode,
      ...(result.provider ? { provider: result.provider } : {}),
      input,
      createdAt: now,
      round: opts.round ?? 0,
    });
    goTo('/explore', opts.nav ?? 'push');
  } else {
    goTo('/recipe', opts.nav ?? 'push');
  }
  const t = fallbackToast(result);
  if (t) {
    if (result.fallbackCode === 'NO_KEY') {
      if (!noKeyToastShown) {
        noKeyToastShown = true;
        toast(t.message, t.kind);
      }
    } else {
      toast(t.message, t.kind);
    }
  }
}

/** 로딩 화면을 띄우고 추천 → 결과 화면. 실패하면 안내창. 결과(실패하면 null) 반환 */
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

/** 탐색 카드로 재료를 장착한 뒤 다시 추천할 입력값 — 카드가 나온 요청의 입력 (모르면 지금 레시피 → 홈 입력값) */
export function installRequestInput(): UserInput {
  const ss = useSession.getState();
  return ss.installInput ?? ss.current?.input ?? useDraft.getState().input;
}

/**
 * 탐색 카드의 새 재료를 모두 장착한 뒤 — 그 카드의 레시피를 normal 모드로 다시 추천 (SPEC §5.4).
 * 입력값은 installRequestInput() (카드가 나온 요청의 입력). 장착 정보는 지우고, 화면 이동은 하지 않음(부른 쪽이 dismissTo)
 */
export async function recommendAfterInstall(): Promise<RecipeResult | null> {
  const ss = useSession.getState();
  const target = ss.installTarget;
  const input = installRequestInput();
  ss.setInstallTarget(null);
  const res = await recommendAndShow({ input, mode: 'normal', target }, { nav: 'none' });
  if (res) useSession.getState().setRejectStreak(0);
  return res;
}

/** 재료 편집 화면 주소 (#/ingredients/:pump?suggest=…&category=…&abv=…&from=explore&done=a|b) */
export function ingredientEditPath(
  pump: number,
  params: { suggest?: string; category?: Category; abv?: number; from?: 'explore'; done?: string[] } = {},
): string {
  return withQuery(`/ingredients/${pump}`, {
    suggest: params.suggest,
    category: params.category,
    abv: params.abv === undefined ? undefined : String(params.abv),
    from: params.from,
    done: params.done?.length ? params.done.join('|') : undefined,
  });
}

/**
 * 탐색 카드 "펌프 N에 장착하기" → 재료 편집 화면(이름·카테고리·도수 미리 채움)
 * ingredient: 장착할 재료 (기본: 카드의 새 재료). 빈 기기 탐색처럼 새 재료가 2개인 카드는 두 번째 재료를 이어서 장착할 때 사용
 * replace: 재료 편집 화면에서 다음 재료 편집 화면으로 바로 넘어갈 때
 * done: 앞 단계에서 이미 장착한 재료 이름 키 (사용자가 이름을 바꿔 저장해도 같은 재료를 다시 묻지 않게)
 * input: 이 카드가 나온 추천 요청의 입력값 (레시피 화면 → current.input, 탐색 화면 → explore.input).
 *        재료를 저장한 뒤 이 입력으로 다시 추천 — 예전 탐색의 입력(다른 잔 용량·도수·맛)이 섞이지 않게
 */
export function openInstall(
  item: ExploreItem,
  pick: PumpPick,
  opts: {
    replace?: boolean;
    ingredient?: { name: string; category: Category; abv: number };
    done?: string[];
    input?: UserInput | null;
  } = {},
) {
  useSession.getState().setInstallTarget(item, opts.input ?? null);
  const ing = opts.ingredient ?? { name: item.addIngredient, category: item.category, abv: item.abv };
  const href = ingredientEditPath(pick.pump, {
    suggest: ing.name,
    category: ing.category,
    abv: ing.abv,
    from: 'explore',
    done: opts.done,
  });
  go(href, opts.replace ? { replace: true } : undefined);
}
