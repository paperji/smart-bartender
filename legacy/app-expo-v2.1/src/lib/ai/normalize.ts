/**
 * 레시피 검증·보정 — docs/SPEC.md §3.3 규칙 1~9 (백엔드와 앱 양쪽에서 동일 적용)
 * 백엔드 backend/lib/recipe.js 의 normalizeRecipe / capStrength / finalizeRecipe 알고리즘을 그대로 옮겼습니다.
 *
 * 1. 장착되지 않은 펌프/재료 제거 (이름 정확 일치 우선 → 펌프 번호). 같은 펌프 중복은 합산(합산 전 음수는 0).
 *    성향(preference)에서 알레르기·싫어하는 재료로 판정된 장착 재료(ctx.excludePumps — preference.ts
 *    preferenceExcludedPumps 로 계산)도 제거.
 * 2. strength=none → abv>0 재료 제거.
 * 3. ml < 0 → 0, 소수점 1자리 반올림. 0ml 재료 제거.
 * 4. 총량을 cupMl(기본 200, 허용 30~500)에 맞게 비례 보정. 반올림 나머지는 가장 많은 재료에 더함.
 * 5. 재료별 remainingMl 초과 → 잔량까지만(소수 1자리 내림) 사용 + low_stock 제안. totalMl 은 cupMl 보다 작아질 수 있음.
 * 6. 재료당 최대 300ml(펌웨어 maxStepMl). 초과분은 300으로 자름.
 * 7. 재료가 하나도 남지 않으면 오류.
 * 8. 도수 상한(capStrength): light ≤5%, medium ≤12%, strong ≤20%. 초과 시 술을 줄이고 무알콜 재료를 늘려 총량 유지
 *    (레시피에 무알콜 재료가 없으면 장착된 무알콜 재료 1개 추가, 규칙 1로 제외된 재료는 고르지 않음). 늘린 무알콜 재료도 잔량·300ml 를 넘지 않게.
 *    섞을 무알콜 재료가 하나도 없으면 상한을 지킬 수 없으므로 오류(NO_MIXER). 반올림 나머지는 합계가 보정 전 총량을
 *    넘지 않게 정리(도수가 오르지 않는 쪽으로) — 백엔드 recipe.js capStrength 와 같음
 * 9. estimatedAbv = Σ(ml×abv)/총ml (소수 1자리). flavor.strength = 0→0, ≤5→1, ≤10→2, ≤15→3, ≤20→4, 그 이상→5.
 * + 제안(suggestions) 정리: strength=none 이거나 성인 확인 전(adultVerified !== true)이면 술을 장착·대체하라는
 *   add_ingredient/substitute 제안은 지움 (SPEC §3.2, 백엔드 sanitizeSuggestions 와 같은 판정)
 *
 * 순수 함수 — React Native 비의존, Node 테스트로 검증합니다.
 */
import type { Flavor, IngredientInfo, Recipe, RecipeIngredient, Strength, Suggestion, SuggestionType } from '../types';
import { looksAlcoholic } from './alcohol';
import { abvToStrengthLevel, clampInt, estimateFlavor, TASTE_KEYS } from './flavor';

export const CUP_DEFAULT = 200;
export const CUP_MIN = 30;
export const CUP_MAX = 500;
export const STEP_MAX_ML = 300;
export const MAX_SUGGESTIONS = 5;

export const STRENGTHS: Strength[] = ['none', 'light', 'medium', 'strong'];
/** 앱 화면의 도수 이름 (바텐더 탭 버튼과 같음) */
export const STRENGTH_KO: Record<Strength, string> = { none: '무알콜', light: '약하게', medium: '보통', strong: '강하게' };
/** 도수 목표 범위(%) — max 는 capStrength 의 상한, target 은 규칙기반 추천의 목표값 (백엔드와 동일) */
export const STRENGTH_ABV: Record<Strength, { min: number; max: number; target: number }> = {
  none: { min: 0, max: 0, target: 0 },
  light: { min: 1, max: 5, target: 4 },
  medium: { min: 5, max: 12, target: 9 },
  strong: { min: 12, max: 20, target: 16 },
};

const SUGGESTION_TYPES: SuggestionType[] = ['add_ingredient', 'substitute', 'low_stock', 'info'];

export class RecipeError extends Error {
  readonly code: string;
  readonly adjustments: string[];
  constructor(message: string, code = 'EMPTY_RECIPE', adjustments: string[] = []) {
    super(message);
    this.name = 'RecipeError';
    this.code = code;
    this.adjustments = adjustments;
  }
}

export interface NormalizeContext {
  /** 장착된 재료 (이름이 있는 펌프만 사용) */
  ingredients: IngredientInfo[];
  strength: Strength;
  cupMl?: number;
  /** 재료당 최대 ml (펌웨어 maxStepMl, 기본 300) */
  maxStepMl?: number;
  /** false 면 규칙 4(잔 용량 맞춤)를 건너뜀 — 사용자가 ml 를 직접 조정한 경우 */
  scaleToCup?: boolean;
  /**
   * 성향(알레르기·싫어하는 재료)으로 뺄 펌프 번호 — preference.ts preferenceExcludedPumps() 로 계산.
   * 규칙 1 에서 그 펌프를 빼고, 규칙 8 에서 섞을 무알콜 재료로도 고르지 않음 (백엔드 opts.excludePumps 와 같음)
   */
  excludePumps?: ReadonlySet<number> | readonly number[];
  /**
   * 만 19세 이상 확인 여부 (SPEC §3.1 user.adultVerified — 설정의 성인 확인 값).
   * true 가 아니면(생략 포함) 무알콜과 같은 판정으로 술 add_ingredient/substitute 제안을 지움 (SPEC §3.2)
   */
  adultVerified?: boolean;
}

export interface NormalizeResult {
  recipe: Recipe;
  /** 보정 내용 (한국어 설명, 백엔드 adjustments 와 같음) */
  warnings: string[];
  /** 규칙 8(도수 상한)로 술을 줄였는지 */
  capped?: boolean;
}

// ───────────────────────── 공통 유틸 (백엔드와 동일) ─────────────────────────

/** 소수 1자리 반올림 */
export function round1(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 10) / 10;
}

/** 숫자 또는 숫자 문자열 → number, 그 외 NaN */
export function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/** 문자열 정리: 제어문자 제거, 공백 정리, 최대 길이 */
export function cleanText(v: unknown, max = 200): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

/** 재료 이름 비교용 정규화(대소문자·공백·기호 무시) */
export function normName(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s_\-·.,()[\]'"]/g, '');
}

/** 한국어 조사 고르기: particle('사이다','이','가') → '가' (한글이 아니면 '이(가)') */
export function particle(word: string, withBatchim: string, withoutBatchim: string): string {
  const w = String(word || '');
  const ch = w.charCodeAt(w.length - 1);
  if (ch >= 0xac00 && ch <= 0xd7a3) {
    const jong = (ch - 0xac00) % 28;
    if (withBatchim === '으로') return jong === 0 || jong === 8 ? '로' : '으로'; // ㄹ 받침은 '로'
    return jong ? withBatchim : withoutBatchim;
  }
  return `${withBatchim}(${withoutBatchim})`;
}

/** 단어 + 조사: josa('사이다','이','가') → '사이다가' */
export function josa(word: string, withBatchim: string, withoutBatchim: string): string {
  return String(word || '') + particle(word, withBatchim, withoutBatchim);
}

/** 잔 용량 30~500 (숫자가 아니면 200) */
export function clampCup(v: unknown): number {
  const c = toNum(v);
  if (!Number.isFinite(c)) return CUP_DEFAULT;
  return round1(Math.min(CUP_MAX, Math.max(CUP_MIN, c)));
}

/** 완성 도수에 맞는 도수 단계 (기록에서 다시 만들 때 사용) */
export function strengthForAbv(abv: number): Strength {
  if (!(abv > 0)) return 'none';
  if (abv <= STRENGTH_ABV.light.max) return 'light';
  if (abv <= STRENGTH_ABV.medium.max) return 'medium';
  return 'strong';
}

/** excludePumps 옵션 → Set (Set·배열·없음 모두 허용) */
function toPumpSet(v: ReadonlySet<number> | readonly number[] | null | undefined): ReadonlySet<number> {
  if (v instanceof Set) return v;
  return new Set(Array.isArray(v) ? v : []);
}

const remOf = (i: IngredientInfo | undefined): number | null =>
  i && typeof i.remainingMl === 'number' && Number.isFinite(i.remainingMl) ? i.remainingMl : null;

// ───────────────────────── 규칙 구현 ─────────────────────────

/** AI 가 준 재료 항목 → 장착 재료 매칭. 이름이 정확히 일치하면 이름 우선, 아니면 펌프 번호. */
export function matchIngredient(
  item: { pump?: unknown; name?: unknown },
  ingredients: IngredientInfo[],
  byPump: Map<number, IngredientInfo>,
): IngredientInfo | null {
  const pump = toNum(item.pump);
  const key = normName(item.name);
  if (key) {
    const sameName = ingredients.filter((i) => normName(i.name) === key);
    if (sameName.length === 1) return sameName[0];
    if (sameName.length > 1) return sameName.find((i) => i.pump === pump) ?? sameName[0];
  }
  if (Number.isInteger(pump) && byPump.has(pump)) return byPump.get(pump)!;
  return null;
}

/** 합계를 total 에 맞게 비례 보정 + 반올림 오차는 가장 많은 재료에서 흡수 */
export function scaleToTotal<T extends { ml: number }>(items: T[], total: number): T[] {
  const sum = items.reduce((s, i) => s + i.ml, 0);
  if (!(sum > 0)) return items.map((i) => ({ ...i }));
  const f = total / sum;
  const out = items.map((i) => ({ ...i, ml: round1(i.ml * f) }));
  const residual = round1(total - out.reduce((s, i) => s + i.ml, 0));
  if (residual !== 0) {
    let big = out[0];
    for (const i of out) if (i.ml > big.ml) big = i;
    if (big.ml + residual > 0) big.ml = round1(big.ml + residual);
  }
  return out;
}

export function computeAbv(items: { pump: number; ml: number }[], byPump: Map<number, IngredientInfo>): number {
  let total = 0;
  let alc = 0;
  for (const it of items) {
    const ing = byPump.get(it.pump);
    total += it.ml;
    alc += it.ml * (ing ? ing.abv : 0);
  }
  return total > 0 ? round1(alc / total) : 0;
}

function sumMl(items: { ml: number }[]): number {
  return round1(items.reduce((s, i) => s + i.ml, 0));
}

/**
 * 술을 장착·대체하라는 제안인지 (SPEC §3.2 — 무알콜·성인 확인 전에 지우는 제안의 판정, 백엔드와 같음):
 * add_ingredient/substitute 이면서 재료 이름이 술(alcohol.ts 술 이름 목록)이거나 장착된 술 재료이거나,
 * 대상 펌프가 장착된 술이거나, 문구에 술 이름이 들어 있으면 true
 */
export function isAlcoholSuggestion(
  s: { type: SuggestionType; ingredient?: string; pump?: number; message: string },
  installedAlcNames: ReadonlySet<string>,
  byPump: Map<number, IngredientInfo>,
): boolean {
  if (s.type !== 'add_ingredient' && s.type !== 'substitute') return false;
  const ingName = s.ingredient ?? '';
  const alcIng = !!ingName && (looksAlcoholic(ingName) || installedAlcNames.has(normName(ingName)));
  const alcPump = s.pump != null && (byPump.get(s.pump)?.abv ?? 0) > 0;
  return alcIng || alcPump || looksAlcoholic(s.message);
}

/**
 * AI·규칙 제안(suggestions) 정리 (백엔드 recipe.js sanitizeSuggestions 와 같음).
 * strength='none'(무알콜)이거나 성인 확인 전(adultVerified !== true, 생략 포함)이면
 * 술을 장착·대체하라는 add_ingredient/substitute 제안은 제거 (판정: isAlcoholSuggestion — SPEC §3.2)
 * 서버 응답 재검증·직접 Gemini·오프라인 결과 모두 normalizeRecipe → 이 함수를 거침.
 */
export function sanitizeSuggestions(
  list: unknown,
  ingredients: IngredientInfo[],
  byPump: Map<number, IngredientInfo>,
  strength: Strength = 'none',
  adultVerified = false,
): Suggestion[] {
  const out: Suggestion[] = [];
  if (!Array.isArray(list)) return out;
  const installedNames = new Set(ingredients.map((i) => normName(i.name)));
  const installedAlcNames = new Set(ingredients.filter((i) => i.abv > 0).map((i) => normName(i.name)));
  /** 술 장착·대체 제안을 지울지: 무알콜 또는 성인 확인 전 (SPEC §3.2) */
  const noAlcoholPush = strength === 'none' || adultVerified !== true;
  for (const s of list.slice(0, 8)) {
    if (!s || typeof s !== 'object') continue;
    const message = cleanText((s as any).message, 200);
    if (!message) continue;
    const type: SuggestionType = SUGGESTION_TYPES.includes((s as any).type) ? (s as any).type : 'info';
    const o: Suggestion = { type, message };
    const ingName = cleanText((s as any).ingredient, 40);
    if (ingName) o.ingredient = ingName;
    const pump = toNum((s as any).pump);
    if (Number.isInteger(pump) && byPump.has(pump)) o.pump = pump;
    // 무알콜 요청·성인 확인 전에는 술 권유 X
    if (noAlcoholPush && isAlcoholSuggestion(o, installedAlcNames, byPump)) continue;
    if (type === 'add_ingredient') {
      if (ingName && installedNames.has(normName(ingName))) continue; // 이미 장착된 재료는 '추가 장착' 제안 X
      delete o.pump;
    }
    if (type === 'low_stock' && o.pump == null && ingName) {
      const m = ingredients.find((i) => normName(i.name) === normName(ingName));
      if (m) o.pump = m.pump;
    }
    if (type === 'low_stock' && o.pump == null) o.type = 'info';
    out.push(o);
  }
  return out;
}

function mergeSuggestions(ruleBased: Suggestion[], fromAi: Suggestion[]): Suggestion[] {
  const covered = new Set(ruleBased.filter((s) => s.type === 'low_stock').map((s) => s.pump));
  const merged = [...ruleBased];
  for (const s of fromAi) {
    if (s.type === 'low_stock' && covered.has(s.pump)) continue;
    if (merged.some((m) => m.message === s.message)) continue;
    merged.push(s);
  }
  return merged.slice(0, MAX_SUGGESTIONS);
}

function sanitizeFlavor(raw: unknown, items: RecipeIngredient[], byPump: Map<number, IngredientInfo>, abv: number): Flavor {
  const est = estimateFlavor(items, byPump);
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const out = { sweet: 0, sour: 0, bitter: 0, fizzy: 0, strength: 0 } as Flavor;
  for (const k of TASTE_KEYS) {
    const v = src ? toNum(src[k]) : NaN;
    out[k] = Number.isFinite(v) ? clampInt(v, 0, 5) : est[k];
  }
  out.strength = abvToStrengthLevel(abv); // 도수 체감은 항상 실제 도수로 다시 계산
  return out;
}

function unwrap(raw: unknown): Record<string, any> {
  const r: any =
    raw && typeof raw === 'object' && (raw as any).recipe && typeof (raw as any).recipe === 'object' ? (raw as any).recipe : raw;
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new RecipeError('레시피 형식이 올바르지 않아요.', 'BAD_RECIPE');
  return r;
}

/** SPEC §3.3 규칙 1~7 (6 = 재료당 300ml 포함). 규칙 8 은 capStrength, 전체는 normalizeRecipe */
export function normalizeCore(raw: unknown, ctx: NormalizeContext): NormalizeResult {
  const r = unwrap(raw);
  const ingredients = ctx.ingredients.filter((i) => i && typeof i.name === 'string' && i.name.trim());
  const cupMl = clampCup(ctx.cupMl ?? CUP_DEFAULT);
  const strength: Strength = STRENGTHS.includes(ctx.strength) ? ctx.strength : 'none';
  const maxStep = ctx.maxStepMl ?? STEP_MAX_ML;
  const byPump = new Map(ingredients.map((i) => [i.pump, i] as const));
  const excludePumps = toPumpSet(ctx.excludePumps);
  const adjustments: string[] = [];

  // 1 + 3(음수 → 0): 매칭 & 합산 (처음 등장한 순서 = 붓는 순서 유지)
  const merged = new Map<number, number>();
  const prefNoted = new Set<number>();
  const list: any[] = Array.isArray(r.ingredients) ? r.ingredients.slice(0, 20) : [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const ing = matchIngredient(it, ingredients, byPump);
    if (!ing) {
      const label = cleanText(it.name, 30) || `펌프 ${cleanText(String(it.pump ?? '?'), 5)}번`;
      adjustments.push(`장착되지 않은 재료 '${label}'${particle(label, '은', '는')} 제외했어요.`);
      continue;
    }
    if (excludePumps.has(ing.pump)) {
      // 성향(알레르기·싫어하는 재료)에 적힌 재료 — AI 가 넣었더라도 뺌 (백엔드와 같은 문구)
      if (!prefNoted.has(ing.pump)) adjustments.push(`성향에 적힌 대로 '${ing.name}'${particle(ing.name, '은', '는')} 뺐어요.`);
      prefNoted.add(ing.pump);
      continue;
    }
    let ml = toNum(it.ml);
    if (!Number.isFinite(ml) || ml < 0) ml = 0;
    if (merged.has(ing.pump)) adjustments.push(`'${ing.name}'${particle(ing.name, '이', '가')} 여러 번 나와 양을 합쳤어요.`);
    merged.set(ing.pump, (merged.get(ing.pump) ?? 0) + ml);
  }

  // 2 + 3
  let items: RecipeIngredient[] = [];
  for (const [pump, ml] of merged) {
    const ing = byPump.get(pump)!;
    if (strength === 'none' && ing.abv > 0) {
      adjustments.push(`무알콜 선택이라 '${ing.name}'(도수 ${ing.abv}%)${particle(ing.name, '은', '는')} 뺐어요.`);
      continue;
    }
    const v = round1(ml);
    if (v <= 0) continue;
    items.push({ pump, name: ing.name, ml: v });
  }
  if (!items.length) {
    throw new RecipeError('지금 장착된 재료로는 레시피를 만들 수 없어요. 재료를 확인해 주세요.', 'EMPTY_RECIPE', adjustments);
  }

  // 4
  if (ctx.scaleToCup !== false) {
    const before = sumMl(items);
    items = scaleToTotal(items, cupMl);
    if (Math.abs(before - cupMl) >= 0.5) adjustments.push(`총량을 ${before}ml → ${cupMl}ml 로 맞췄어요.`);
  }

  // 5
  const ruleSuggestions: Suggestion[] = [];
  for (const it of items) {
    const ing = byPump.get(it.pump)!;
    const rem = remOf(ing);
    if (rem != null && it.ml > rem) {
      const want = it.ml;
      it.ml = Math.floor(rem * 10 + 1e-9) / 10;
      ruleSuggestions.push({
        type: 'low_stock',
        pump: ing.pump,
        ingredient: ing.name,
        message:
          it.ml > 0
            ? `${josa(ing.name, '이', '가')} ${rem}ml 밖에 없어 ${it.ml}ml만 사용해요(필요 ${want}ml). 펌프 ${ing.pump}번 용기를 보충해 주세요.`
            : `${josa(ing.name, '이', '가')} 다 떨어졌어요. 펌프 ${ing.pump}번 용기를 보충해 주세요.`,
      });
      adjustments.push(`'${ing.name}' 잔량이 부족해 ${want}ml → ${it.ml}ml 로 줄였어요.`);
    }
  }
  items = items.filter((i) => i.ml > 0);

  // 6
  for (const it of items) {
    if (it.ml > maxStep) {
      adjustments.push(`'${it.name}'${particle(it.name, '이', '가')} 기기 한도(재료당 ${maxStep}ml)를 넘어 ${it.ml}ml → ${maxStep}ml 로 줄였어요.`);
      it.ml = maxStep;
    }
  }

  // 7
  if (!items.length) {
    throw new RecipeError('재료가 모두 부족해요. 재료 탭에서 잔량을 채워 주세요.', 'EMPTY_RECIPE', adjustments);
  }

  // 9 (1차) — 규칙 8 이후 다시 계산
  const totalMl = sumMl(items);
  const estimatedAbv = computeAbv(items, byPump);

  const recipe: Recipe = {
    name: cleanText(r.name, 40) || '오늘의 한 잔',
    nameEn: cleanText(r.nameEn, 60),
    description: cleanText(r.description, 120),
    reason: cleanText(r.reason, 400),
    ingredients: items,
    totalMl,
    estimatedAbv,
    flavor: sanitizeFlavor(r.flavor, items, byPump, estimatedAbv),
    garnish: cleanText(r.garnish, 80),
    tips: cleanText(r.tips, 200),
    suggestions: mergeSuggestions(
      ruleSuggestions,
      sanitizeSuggestions(r.suggestions, ingredients, byPump, strength, ctx.adultVerified === true),
    ),
  };
  return { recipe, warnings: adjustments };
}

/** 도수를 낮출 때 새로 섞을 무알콜 재료 고르기 (탄산 > 주스 > 물 > 기타 > 유제품 > 시럽) */
function pickMixer(ingredients: IngredientInfo[], exclude: ReadonlySet<number>): IngredientInfo | null {
  const order: Partial<Record<string, number>> = { soda: 0, juice: 1, water: 2, other: 3, dairy: 4, syrup: 5 };
  const cands = ingredients.filter((i) => {
    const rem = remOf(i);
    return i.abv === 0 && !exclude.has(i.pump) && (rem == null || rem >= 10) && i.category in order;
  });
  cands.sort((a, b) => order[a.category]! - order[b.category]! || (remOf(b) ?? 1e9) - (remOf(a) ?? 1e9));
  return cands[0] ?? null;
}

/** 규칙 8: 섞을 무알콜 재료가 없어 도수 상한을 맞출 수 없을 때의 안내 (백엔드 noMixerMessage 와 같은 내용) */
export function noMixerMessage(strength: Strength): string {
  const range = STRENGTH_ABV[strength];
  return `섞을 무알콜 재료가 없어 '${STRENGTH_KO[strength] ?? strength}'(최대 ${range ? range.max : 0}%)로 만들 수 없어요. 탄산수·주스 같은 무알콜 재료를 장착하거나 도수를 바꿔 주세요.`;
}

/**
 * 규칙 8 — 선택한 도수 단계의 상한을 넘으면 술을 줄이고 무알콜 재료를 늘림 (백엔드 recipe.js capStrength 와 같은 알고리즘).
 * light ≤5%, medium ≤12%, strong ≤20%. 총량은 유지, 무알콜 재료는 잔량·재료당 300ml 를 넘지 않게
 * (넘으면 총량이 줄어드는 대신 술을 더 줄여 상한 유지).
 * 레시피에 무알콜 재료가 없으면 장착된 무알콜 재료(탄산>주스>물…, 잔량 10ml 이상, excludePumps 제외)를 하나 추가.
 * 섞을 무알콜 재료가 하나도 없으면 상한을 지킬 수 없으므로 RecipeError('NO_MIXER')
 * (규칙 4 가 술만 든 레시피를 잔 용량까지 늘려 놓았으므로 '그대로 두기'는 독한 술 수백 ml 가 됨).
 * 반올림 뒤 나머지는 정리해 합계가 보정 전 총량을 넘지 않게 함(500 → 500.1 이면 펌웨어가 LIMIT 으로 거절).
 */
export function capStrength(
  recipe: Recipe,
  ingredientsIn: IngredientInfo[],
  strength: Strength,
  maxStepMl = STEP_MAX_ML,
  excludePumps?: ReadonlySet<number> | readonly number[],
): { recipe: Recipe; adjustments: string[]; capped: boolean } {
  const range = STRENGTH_ABV[strength];
  const adjustments: string[] = [];
  if (!range || strength === 'none' || recipe.estimatedAbv <= range.max + 0.05) return { recipe, adjustments, capped: false };
  const ingredients = ingredientsIn.filter((i) => i && typeof i.name === 'string' && i.name.trim());
  const byPump = new Map(ingredients.map((i) => [i.pump, i] as const));
  const items = recipe.ingredients.map((i) => ({ ...i }));
  const abvOf = (it: { pump: number }) => byPump.get(it.pump)?.abv ?? 0;
  /** 무알콜 재료를 늘릴 수 있는 한도: 잔량·재료당 최대 ml */
  const limitOf = (it: { pump: number }) => {
    const rem = remOf(byPump.get(it.pump));
    return rem != null ? Math.min(rem, maxStepMl) : maxStepMl;
  };
  const total = sumMl(items);
  const target = Math.max(0, range.max - 0.2) / 100; // 반올림 여유

  let mix = items.filter((i) => abvOf(i) === 0);
  if (!mix.length) {
    // 섞을 재료 후보: 레시피에 없는 장착 재료 중 성향으로 제외되지 않은 것 (규칙 1)
    const m = pickMixer(ingredients, new Set([...items.map((i) => i.pump), ...toPumpSet(excludePumps)]));
    if (m) {
      const added = { pump: m.pump, name: m.name, ml: 0 };
      items.push(added); // 무알콜 재료는 마지막에(탄산 손실 방지)
      mix = [added];
    }
  }
  const before = recipe.estimatedAbv;
  if (!mix.length) {
    throw new RecipeError(noMixerMessage(strength), 'NO_MIXER', adjustments);
  }
  const alcItems = items.filter((i) => abvOf(i) > 0);
  const alcoholMl = alcItems.reduce((s, i) => s + (i.ml * abvOf(i)) / 100, 0);
  const k = Math.min(1, (target * total) / alcoholMl);
  const freed = alcItems.reduce((s, i) => s + i.ml * (1 - k), 0);
  for (const i of alcItems) i.ml *= k;
  const mixSum = mix.reduce((s, i) => s + i.ml, 0);
  for (const i of mix) i.ml += mixSum > 0 ? freed * (i.ml / mixSum) : freed / mix.length;
  // 무알콜 재료 잔량·재료당 300ml 제한 → 넘으면 총량이 줄어드는 대신 술을 더 줄여 상한 유지
  for (const i of mix) {
    const limit = limitOf(i);
    if (i.ml > limit) i.ml = Math.floor(limit * 10 + 1e-9) / 10;
  }
  const A = alcItems.reduce((s, i) => s + (i.ml * abvOf(i)) / 100, 0);
  const Sa = alcItems.reduce((s, i) => s + i.ml, 0);
  const M = mix.reduce((s, i) => s + i.ml, 0);
  if (A > target * (Sa + M) && A - target * Sa > 0) {
    const f = (target * M) / (A - target * Sa);
    for (const i of alcItems) i.ml *= f;
  }
  const out = items.map((i) => ({ ...i, ml: round1(i.ml) })).filter((i) => i.ml > 0);
  if (!out.length) {
    throw new RecipeError('도수를 맞추고 나니 사용할 수 있는 재료가 없어요.', 'EMPTY_RECIPE', adjustments);
  }
  // 반올림 나머지 정리 (규칙 4 와 같은 취지): 합계 = 보정 뒤 양(≤ 보정 전 총량).
  // 도수가 오르지 않는 쪽으로만 맞춤 — 남으면 가장 많은 술에서 빼고, 모자라면 가장 많은 무알콜 재료에 더함(잔량·300ml 이내)
  const want = Math.min(total, round1(items.reduce((s, i) => s + i.ml, 0)));
  const residual = round1(want - sumMl(out));
  if (residual !== 0) {
    const biggest = (list: RecipeIngredient[]) => list.reduce<RecipeIngredient | null>((a, b) => (a && a.ml >= b.ml ? a : b), null);
    const bigAlc = biggest(out.filter((i) => abvOf(i) > 0));
    const bigMix = biggest(out.filter((i) => abvOf(i) === 0));
    if (residual < 0 && bigAlc && bigAlc.ml + residual >= 0.1) bigAlc.ml = round1(bigAlc.ml + residual);
    else if (bigMix && bigMix.ml + residual >= 0.1 && bigMix.ml + residual <= limitOf(bigMix) + 1e-9) bigMix.ml = round1(bigMix.ml + residual);
  }
  // (안전장치) 그래도 보정 전 총량을 넘으면 가장 많은 재료에서 뺌
  const over = round1(sumMl(out) - total);
  if (over > 0) {
    const big = out.reduce((a, b) => (b.ml > a.ml ? b : a));
    big.ml = round1(big.ml - over);
  }
  const totalMl = sumMl(out);
  const estimatedAbv = computeAbv(out, byPump);
  const mixNames = mix.map((i) => `'${i.name}'`).join(', ');
  adjustments.push(
    `'${STRENGTH_KO[strength]}'(최대 ${range.max}%)에 맞추려고 술을 줄이고 ${mixNames} 양을 늘렸어요. (${before}% → ${estimatedAbv}%)`,
  );
  const est = estimateFlavor(out, byPump);
  const flavor: Flavor = { ...est, ...pickTaste(recipe.flavor), strength: abvToStrengthLevel(estimatedAbv) };
  return { recipe: { ...recipe, ingredients: out, totalMl, estimatedAbv, flavor }, adjustments, capped: true };
}

function pickTaste(f: Flavor | undefined): Partial<Flavor> {
  const o: Partial<Flavor> = {};
  if (f) for (const k of TASTE_KEYS) if (Number.isFinite(f[k])) o[k] = f[k];
  return o;
}

/** 최종 파이프라인 (백엔드 finalizeRecipe 와 동일): 규칙 1~7 → 규칙 8 → 규칙 9 */
export function normalizeRecipe(raw: unknown, ctx: NormalizeContext): NormalizeResult {
  const n = normalizeCore(raw, ctx);
  const strength: Strength = STRENGTHS.includes(ctx.strength) ? ctx.strength : 'none';
  const c = capStrength(n.recipe, ctx.ingredients, strength, ctx.maxStepMl ?? STEP_MAX_ML, ctx.excludePumps);
  return { recipe: c.recipe, warnings: [...n.warnings, ...c.adjustments], capped: c.capped };
}

/** 백엔드와 같은 이름의 별칭 */
export const finalizeRecipe = normalizeRecipe;

/** 사용자가 ml 를 조정한 레시피를 다시 검증 (잔 용량 맞춤 없이 규칙 1·2·3·5·6·7·8·9) */
export function revalidateRecipe(recipe: Recipe, ctx: Omit<NormalizeContext, 'scaleToCup'>): NormalizeResult {
  return normalizeRecipe(recipe, { ...ctx, scaleToCup: false });
}
