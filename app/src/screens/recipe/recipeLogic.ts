/**
 * 추천 레시피 화면의 순수 로직 (v2.1 src/app/recipe.tsx 의 adjust·fitToCup·배지·안내 문구를 화면 밖으로 뺀 것)
 *  - 재료 ml ± 조정: 한도 확인 → 다시 검증(revalidateRecipe) → 빠진 재료 안내(removalNotes) + 도수 상한 안내
 *  - 잔 용량 맞춤: normalizeRecipe(…, cupMl) → 빠진 재료 안내
 *  - 다시 검증할 때 성향(알레르기·싫어하는 재료)은 요청과 같게 cleanText(…, 300) 으로 정리한 문장으로 판정하고,
 *    성인 확인 전이면(adultVerified=false) 술 장착·대체 제안을 지움 (SPEC §3.2, §3.3 규칙 1·8 — v2.1 과 같음)
 *  - 오프라인 추천으로 바뀐 이유 안내 (키 없음·키 오류·사용량 한도·크레딧·모델 → 설정 링크)
 * 스토어·화면 이동·토스트를 직접 부르지 않음 — 화면(RecipeScreen)이 결과를 받아 반영
 */
import { cleanText, normalizeRecipe, revalidateRecipe, STRENGTH_ABV, STRENGTH_KO, type NormalizeContext } from '@/lib/ai/normalize';
import { preferenceExcludedPumps } from '@/lib/ai/preference';
import { providerOf } from '@/lib/ai/providers';
import { slotsToIngredients, type AiErrorCode } from '@/lib/ai/recommend';
import { removalNotes } from '@/lib/brew';
import type { DeviceLimits } from '@/lib/protocol';
import type { PumpSlot, Recipe, RecipeResult, Strength, UserInput } from '@/lib/types';

/** ± 버튼 한 번에 바꾸는 양 (v2.1 과 같음) */
export const ADJUST_STEP_ML = 5;

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export interface ToastMsg {
  message: string;
  kind: ToastKind;
}

/** 다시 검증에 쓰는 문맥 (v2.1 recipe.tsx 의 ctx 와 같음) */
export type RecheckContext = Omit<NormalizeContext, 'scaleToCup' | 'cupMl'>;

export function recheckContext(
  slots: PumpSlot[],
  input: Pick<UserInput, 'strength' | 'preference'>,
  limits: Pick<DeviceLimits, 'maxStepMl'>,
  adultVerified: boolean,
): RecheckContext {
  const ingredients = slotsToIngredients(slots);
  return {
    ingredients,
    strength: input.strength,
    maxStepMl: limits.maxStepMl,
    // 성향 문장은 요청(buildRequest)과 같게 정리한 것으로 판정 (줄바꿈·연속 공백 → 공백 1개, 300자)
    excludePumps: preferenceExcludedPumps(ingredients, cleanText(input.preference, 300)),
    adultVerified,
  };
}

export const totalMlOf = (r: Pick<Recipe, 'ingredients'>) => r.ingredients.reduce((a, b) => a + b.ml, 0);

/** 레시피 + 안내 목록에 새 안내를 더한 결과 (빠진 재료가 없으면 warnings 는 그대로) */
export interface CheckedRecipe {
  recipe: Recipe;
  warnings: string[];
  /** 이번에 새로 더한 안내 (토스트로도 보여 줌) */
  notes: string[];
}

function withNotes(before: Recipe, res: ReturnType<typeof revalidateRecipe>, warnings: string[]): CheckedRecipe {
  const notes = removalNotes(before, res).filter((n) => !warnings.includes(n));
  return { recipe: res.recipe, warnings: notes.length ? [...warnings, ...notes] : warnings, notes };
}

export type AdjustResult =
  /** 바꾸지 않음 (한도·최소 재료) — toasts 만 보여 줌 */
  | { ok: false; toasts: ToastMsg[] }
  | ({ ok: true; toasts: ToastMsg[] } & CheckedRecipe);

/**
 * 재료 하나의 ml 를 delta 만큼 바꾸고 다시 검증 (v2.1 adjust 와 같은 순서·문구)
 *  ① 재료 하나 최대(maxStepMl) 넘으면 최대로 맞추고 안내 ② 한 잔 최대(maxTotalMl) 넘으면 중단
 *  ③ 재료가 1개뿐인데 0 이하가 되면 중단 ④ 다시 검증 → 빠진 재료 안내·도수 상한 안내
 */
export function adjustIngredient(
  recipe: Recipe,
  warnings: string[],
  pump: number,
  delta: number,
  ctx: RecheckContext,
  limits: Pick<DeviceLimits, 'maxStepMl' | 'maxTotalMl'>,
  strength: Strength,
): AdjustResult {
  const toasts: ToastMsg[] = [];
  const total = totalMlOf(recipe);
  const item = recipe.ingredients.find((i) => i.pump === pump);
  if (!item) return { ok: false, toasts };
  let ml = Math.round((item.ml + delta) * 10) / 10;
  if (ml > limits.maxStepMl) {
    ml = limits.maxStepMl;
    toasts.push({ message: `재료 하나는 최대 ${limits.maxStepMl}ml 까지예요.`, kind: 'warning' });
  }
  if (total + (ml - item.ml) > limits.maxTotalMl) {
    toasts.push({ message: `한 잔은 최대 ${limits.maxTotalMl}ml 까지 만들 수 있어요.`, kind: 'warning' });
    return { ok: false, toasts };
  }
  if (ml <= 0 && recipe.ingredients.length === 1) {
    toasts.push({ message: '재료가 최소 1개는 있어야 해요.', kind: 'warning' });
    return { ok: false, toasts };
  }
  const draft: Recipe = {
    ...recipe,
    ingredients: recipe.ingredients.map((i) => (i.pump === pump ? { ...i, ml: Math.max(0, ml) } : i)),
  };
  try {
    const res = revalidateRecipe(draft, ctx);
    const checked = withNotes(draft, res, warnings);
    const capNote = res.capped ? `'${STRENGTH_KO[strength]}'(최대 ${STRENGTH_ABV[strength].max}%)를 넘지 않게 술 양을 맞췄어요.` : '';
    if (checked.notes.length) toasts.push({ message: [...checked.notes, capNote].filter(Boolean).join(' '), kind: 'warning' });
    else if (capNote) toasts.push({ message: capNote, kind: 'info' });
    return { ok: true, toasts, ...checked };
  } catch (e: any) {
    toasts.push({ message: e?.message ?? '조정할 수 없어요', kind: 'error' });
    return { ok: false, toasts };
  }
}

/** 잔 용량에 맞추기 (v2.1 fitToCup 과 같은 문구) */
export function fitRecipeToCup(recipe: Recipe, warnings: string[], cupMl: number, ctx: RecheckContext): AdjustResult {
  try {
    const res = normalizeRecipe(recipe, { ...ctx, cupMl });
    const checked = withNotes(recipe, res, warnings);
    // 재료가 빠졌으면 성공 토스트가 그 사실을 가리지 않게 안내를 함께 (경고)
    const toast: ToastMsg = checked.notes.length
      ? { message: `잔 용량 ${cupMl}ml 에 맞췄어요. ${checked.notes.join(' ')}`, kind: 'warning' }
      : { message: `잔 용량 ${cupMl}ml 에 맞췄어요.`, kind: 'success' };
    return { ok: true, toasts: [toast], ...checked };
  } catch (e: any) {
    return { ok: false, toasts: [{ message: e?.message ?? '맞출 수 없어요', kind: 'error' }] };
  }
}

/** 총량이 잔 용량과 1ml 이상 다르면 [잔 맞추기] 버튼 (v2.1 과 같음) */
export const isTotalOff = (recipe: Pick<Recipe, 'ingredients'>, cupMl: number) => Math.abs(totalMlOf(recipe) - cupMl) >= 1;

/** 재료 비율 % (v2.1 과 같은 반올림) */
export const sharePctOf = (ml: number, total: number) => Math.round((ml / (total || 1)) * 100);

// ───────────────────────── 오프라인 추천으로 바뀐 이유 안내 ─────────────────────────

export interface FallbackNotice {
  tone: 'info' | 'warning';
  /** 'key' = 키 없음·키 오류 아이콘, 'offline' = 연결 문제 아이콘 */
  kind: 'key' | 'offline';
  title: string;
  message: string;
  /** 원래 오류 문구 (120자까지, v2.1 과 같음) */
  detail?: string;
  /** 있으면 [설정] 버튼 글자 */
  settingsLabel?: string;
}

/** 설정에서 고칠 수 있는 AI 오류 → 쉬운 안내 (label: AI 이름, site: 키를 만든 사이트) */
function settingsFixable(code: AiErrorCode, label: string, site: string): { message: string; settingsLabel: string } | undefined {
  switch (code) {
    case 'AUTH':
      return { message: `${label} API 키가 올바르지 않거나 권한이 없어요.`, settingsLabel: '설정에서 키 확인' };
    case 'RATE_LIMIT':
      return { message: `${label} 사용량 한도에 걸렸어요. 무료 등급은 잠시 뒤 다시 추천받으면 돼요.`, settingsLabel: '설정에서 키 확인' };
    case 'BILLING':
      return { message: `${label} 사용 크레딧이 없어요. ${site}에서 충전·결제 상태를 확인해 주세요.`, settingsLabel: '설정에서 키 확인' };
    case 'MODEL':
      return { message: `설정한 ${label} 모델을 찾을 수 없어요.`, settingsLabel: '설정에서 모델 확인' };
    default:
      return undefined;
  }
}

/**
 * 오프라인 추천으로 바뀐 이유 → 화면 안내 (AI 결과·AI 방식이 오프라인이면 null)
 *  - NO_KEY(키 없음): 파란 안내 + [설정에서 키 등록]
 *  - AUTH·RATE_LIMIT·BILLING·MODEL: 노란 안내 + 쉬운 이유 + [설정에서 키 확인]/[설정에서 모델 확인]
 *  - 그 밖(시간 초과·네트워크·서버 오류·응답 보정 실패): v2.1 문구 그대로
 */
export function fallbackNotice(
  r: Pick<RecipeResult, 'source' | 'fallbackReason' | 'fallbackCode' | 'timedOut' | 'provider'>,
): FallbackNotice | null {
  if (r.source !== 'offline' || !r.fallbackReason) return null;
  const detail = r.fallbackReason.slice(0, 120);
  if (r.fallbackCode === 'NO_KEY') {
    return {
      tone: 'info',
      kind: 'key',
      title: 'AI 키가 없어 오프라인 추천을 보여드려요',
      message: '앱에 내장된 규칙으로 레시피를 만들었어요. 설정에서 내 AI API 키(Gemini·ChatGPT·Claude 등)를 등록하면 AI 가 레시피를 만들어요.',
      settingsLabel: '설정에서 키 등록',
    };
  }
  const p = providerOf(r.provider);
  const fix = r.fallbackCode ? settingsFixable(r.fallbackCode as AiErrorCode, p.label, p.keySiteLabel) : undefined;
  if (fix) {
    // "ChatGPT 오류(AUTH): <쉬운 안내> — <회사 원문>" 에서 쉬운 안내는 본문과 겹치므로 원문만 덧붙임
    const raw = r.fallbackReason.includes(' — ') ? r.fallbackReason.slice(r.fallbackReason.indexOf(' — ') + 3).trim() : '';
    return {
      tone: 'warning',
      kind: 'key',
      title: 'AI 대신 오프라인 추천을 사용했어요',
      message: `${fix.message} 그래서 앱에 내장된 규칙으로 레시피를 만들었어요.`,
      ...(raw ? { detail: raw.slice(0, 120) } : {}),
      settingsLabel: fix.settingsLabel,
    };
  }
  if (r.timedOut || r.fallbackCode === 'TIMEOUT') {
    return {
      tone: 'warning',
      kind: 'offline',
      title: 'AI 대신 오프라인 추천을 사용했어요',
      message: 'AI 응답이 너무 늦어 앱에 내장된 규칙으로 레시피를 만들었어요.',
      detail,
    };
  }
  return {
    tone: 'warning',
    kind: 'offline',
    title: 'AI 대신 오프라인 추천을 사용했어요',
    message: '인터넷 또는 AI 서버 문제로 앱에 내장된 규칙으로 레시피를 만들었어요.',
    detail,
  };
}

/** "다른 추천"을 누른 뒤 토스트 (v2.1 과 같은 문구) */
export function regenerateToast(streak: number): string {
  return streak >= 2 ? '마음에 드는 게 없나요? 아래에서 새 재료를 추천해 드릴게요.' : '방금 레시피는 다음 추천에서 피할게요.';
}

/** "다른 추천"의 오프라인 다양성 값 (v2.1 과 같음) */
export function regenerateVariation(variation: number, rand: number = Math.random()): number {
  return variation * 7919 + Math.floor(rand * 1000);
}
