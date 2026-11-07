/**
 * 공유 레시피 ↔ 앱 레시피 바꾸기 (v3.1, 순수 함수 — 테스트에서 그대로 사용)
 *  - buildSharePayload: 제조 기록 한 잔 → 올릴 내용. 재료의 종류·도수는 만들 때 남긴 값 → 지금 장착된 같은 이름의 재료 →
 *    (그래도 모르면) 레시피의 완성 도수가 맞게 남은 재료 도수를 계산. 추천 이유(reason)·기분·제안은 올리지 않음
 *  - sharedToRecipe: 공유 레시피 → 레시피 화면용 Recipe (펌프 번호는 비워 두고 다시 만들기(remapSavedRecipe)가 이름으로 찾음)
 *  - availability: 지금 장착된 재료로 어떤 재료가 있고 없는지
 *  - shareKeyOf: 같은 레시피를 두 번 올리지 않게 쓰는 키 (이름 + 재료 이름들, 서버 recipe_key 와 같은 뜻)
 *  - findContact: 링크·전화번호·이메일 (서버도 같은 규칙으로 거절 — 올리기 전에 미리 알려 줌)
 */
import { normName } from '@/lib/ai/normalize';
import type { Category, PumpSlot, Recipe, RecipeSource } from '@/lib/types';

import { SHARE_LIMITS, type SharedIngredient, type SharedRecipe, type SharePayload } from './api';

/** 만들 때 남겨 둔 재료 정보 (기록 HistoryEntry.meta) */
export interface IngredientMeta {
  name: string;
  category: Category;
  abv: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 글 정리: 줄바꿈·연속 공백 → 1칸, 앞뒤 공백 제거, 최대 길이 (서버 private.clean 과 같은 뜻) */
export function clip(text: unknown, max: number): string {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** 서버 private.has_contact 와 같은 규칙 */
const CONTACT_RE = /(https?:|www\.|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|01[016789][- .]?[0-9]{3,4}[- .]?[0-9]{4})/i;

/** 링크·이메일·휴대폰 번호가 든 글이면 그 부분, 없으면 null */
export function findContact(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = CONTACT_RE.exec(t ?? '');
    if (m) return m[0];
  }
  return null;
}

/** 같은 레시피 판단용 키 — 이름 + 재료 이름(정렬) */
export function shareKeyOf(r: Pick<Recipe, 'name' | 'ingredients'>): string {
  const names = r.ingredients.map((i) => clip(i.name, SHARE_LIMITS.name).toLowerCase()).sort();
  return `${clip(r.name, SHARE_LIMITS.name).toLowerCase()}|${names.join(',')}`;
}

/**
 * 레시피 재료 → 공유용 재료(종류·도수 포함)
 * 모르는 재료 도수는 레시피의 완성 도수(estimatedAbv)가 그대로 나오게 나눠 채움 (0~96%)
 */
export function sharedIngredientsOf(recipe: Recipe, slots: readonly PumpSlot[], meta?: readonly IngredientMeta[]): SharedIngredient[] {
  // 5가지를 넘으면 자르지 않고 그대로 — payloadProblem 이 공유를 막음 (말없이 빼면 도수가 바뀜)
  const rows = recipe.ingredients
    .filter((i) => i.ml > 0 && i.name.trim())
    .map((i) => {
      const k = normName(i.name);
      const m = meta?.find((x) => normName(x.name) === k) ?? slots.find((s) => s.name && normName(s.name) === k);
      return { name: clip(i.name, SHARE_LIMITS.name), ml: round1(i.ml), abv: m ? Math.max(0, m.abv) : null, category: (m?.category ?? 'other') as Category };
    });
  const unknown = rows.filter((r) => r.abv === null);
  if (unknown.length) {
    const total = rows.reduce((a, r) => a + r.ml, 0);
    const knownAlc = rows.reduce((a, r) => a + (r.abv ?? 0) * r.ml, 0);
    const unknownMl = unknown.reduce((a, r) => a + r.ml, 0);
    const need = Math.max(0, (recipe.estimatedAbv || 0) * total - knownAlc);
    const abv = unknownMl > 0 ? Math.min(96, round1(need / unknownMl)) : 0;
    for (const r of unknown) r.abv = abv;
  }
  return rows.map((r) => ({ name: r.name, ml: r.ml, abv: round1(r.abv ?? 0), category: r.category }));
}

export interface ShareSource {
  recipe: Recipe;
  source: RecipeSource;
  /** 만들 때 남겨 둔 재료 정보 (v3.1 기록부터 있음) */
  meta?: readonly IngredientMeta[];
  /** 만든 AI 이름 — 없으면: v3.1 이전 기록(meta 없음)은 그때 AI 가 Gemini 하나뿐이라 'Gemini', 그 밖은 'AI' */
  aiLabel?: string;
}

/** 공유 카드·창의 출처 배지 글 — 'AI · ChatGPT', AI 이름을 모르면 'AI 추천', 오프라인은 '앱 추천' */
export function aiBadgeText(source: RecipeSource, aiLabel: string): string {
  if (source !== 'direct') return '앱 추천';
  return !aiLabel || aiLabel === 'AI' ? 'AI 추천' : `AI · ${aiLabel}`;
}

/** 만든 AI 이름 (공유 배지) */
export function shareAiLabel(entry: Pick<ShareSource, 'source' | 'meta' | 'aiLabel'>): string {
  if (entry.source !== 'direct') return '';
  return clip(entry.aiLabel || (entry.meta?.length ? 'AI' : 'Gemini'), SHARE_LIMITS.aiLabel);
}

export interface PayloadOptions {
  nickname?: string;
  comment?: string;
  /** AI 가 쓴 설명·팁도 올릴지 (기본 true) — 그날의 기분·날씨가 문장에 섞여 있을 수 있어 뺄 수 있게 */
  withNotes?: boolean;
}

/** 제조 기록 한 잔 → 올릴 내용 */
export function buildSharePayload(entry: ShareSource, slots: readonly PumpSlot[], opts: PayloadOptions = {}): SharePayload {
  const r = entry.recipe;
  const notes = opts.withNotes !== false;
  return {
    name: clip(r.name, SHARE_LIMITS.name),
    nameEn: clip(r.nameEn ?? '', SHARE_LIMITS.nameEn),
    description: notes ? clip(r.description, SHARE_LIMITS.description) : '',
    comment: clip(opts.comment ?? '', SHARE_LIMITS.comment),
    nickname: clip(opts.nickname ?? '', SHARE_LIMITS.nickname),
    ingredients: sharedIngredientsOf(r, slots, entry.meta),
    flavor: { ...r.flavor },
    garnish: clip(r.garnish, SHARE_LIMITS.garnish),
    tips: notes ? clip(r.tips, SHARE_LIMITS.tips) : '',
    source: entry.source,
    aiLabel: shareAiLabel(entry),
  };
}

/** 서버와 같은 기준으로 올릴 수 있는지 — 안 되면 쉬운 안내(해요체), 되면 null */
export function payloadProblem(p: SharePayload): string | null {
  const hit = findContact(p.name, p.nameEn, p.description, p.comment, p.nickname, p.garnish, p.tips, ...p.ingredients.map((i) => i.name));
  if (hit) return `링크·전화번호·이메일은 넣을 수 없어요. ("${hit.slice(0, 30)}" 부분을 지워 주세요)`;
  if (!p.name) return '레시피 이름이 없어 공유할 수 없어요.';
  if (!p.ingredients.length) return '재료가 없어 공유할 수 없어요.';
  if (p.ingredients.length > 5) return '재료가 5가지를 넘는 레시피는 공유할 수 없어요.';
  const names = p.ingredients.map((i) => i.name.toLowerCase());
  if (new Set(names).size !== names.length) return '같은 이름의 재료가 두 번 들어 있어 공유할 수 없어요.';
  if (p.ingredients.some((i) => i.ml < 1)) return '1ml 보다 적게 들어간 재료가 있어 공유할 수 없어요.';
  if (p.ingredients.some((i) => i.ml > 300)) return '한 재료가 300ml 를 넘어 공유할 수 없어요.';
  const total = p.ingredients.reduce((a, i) => a + i.ml, 0);
  if (total < 30) return '총량이 30ml 보다 적어 공유할 수 없어요.';
  if (total > 500) return '총량이 500ml 를 넘어 공유할 수 없어요.';
  const abv = p.ingredients.reduce((a, i) => a + i.ml * i.abv, 0) / total;
  if (Math.round(abv * 10) / 10 > 20.5) return '도수가 20%를 넘는 레시피는 공유할 수 없어요.';
  return null;
}

/** 올린 사람 표시 */
export function authorOf(s: Pick<SharedRecipe, 'nickname'>): string {
  return s.nickname.trim() || '익명 바텐더';
}

/** 공유 레시피 → 레시피 화면용 Recipe (pump 0 = 아직 모름 → remapSavedRecipe 가 이름으로 찾음) */
export function sharedToRecipe(s: SharedRecipe): Recipe {
  const who = authorOf(s);
  return {
    name: s.name,
    ...(s.nameEn ? { nameEn: s.nameEn } : {}),
    description: s.description,
    reason: s.comment ? `${who}님의 한마디: ${s.comment}` : `${who}님이 공유한 레시피예요.`,
    ingredients: s.ingredients.map((i) => ({ pump: 0, name: i.name, ml: i.ml })),
    totalMl: s.totalMl,
    estimatedAbv: s.estimatedAbv,
    flavor: { ...s.flavor },
    garnish: s.garnish,
    tips: s.tips,
    suggestions: [],
  };
}

export interface IngredientStatus {
  ingredient: SharedIngredient;
  /** 같은 이름으로 장착된 펌프 (없으면 null) */
  slot: PumpSlot | null;
  /** 장착은 됐지만 잔량이 필요한 양보다 적음 */
  low: boolean;
}

/** 지금 장착된 재료로 이 레시피를 만들 수 있는지 */
export function availability(s: Pick<SharedRecipe, 'ingredients'>, slots: readonly PumpSlot[]): { items: IngredientStatus[]; missing: string[]; ready: boolean } {
  const items = s.ingredients.map((ingredient) => {
    const k = normName(ingredient.name);
    const slot = slots.find((x) => x.name && normName(x.name) === k) ?? null;
    return { ingredient, slot, low: !!slot && slot.remainingMl < ingredient.ml };
  });
  const missing = items.filter((i) => !i.slot).map((i) => i.ingredient.name);
  return { items, missing, ready: missing.length === 0 };
}
