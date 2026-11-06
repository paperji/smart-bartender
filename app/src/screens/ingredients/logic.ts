/**
 * 재료 화면 공용 로직 (React 비의존 — v2.1 ingredient-edit.tsx · (tabs)/ingredients.tsx 의 계산 부분을 그대로 옮김)
 *  - 편집 화면 첫 값(쿼리 suggest·category·abv·from=explore 반영)
 *  - 빠른 선택(프리셋) 검색
 *  - 종류를 바꿀 때 도수 자동 조정, 술인데 도수 0% 확인 문구
 *  - 재료 목록 "○○ 장착하기"(recipe 화면 제안) 의 추천 펌프 (빈 펌프 → 기록상 가장 적게 쓰인 펌프)
 */
import { nameKey, pumpUsage, recommendPump, type PumpPick, type UsageEntry } from '@/lib/ai/explore';
import { josa } from '@/lib/ai/normalize';
import { CATEGORY_INFO, findExactPreset, findPreset, INGREDIENT_COLORS, PRESETS, type IngredientPreset } from '@/lib/presets';
import { CATEGORIES, type Category, type ExploreItem, type PumpSlot, type RecipeIngredient } from '@/lib/types';

/** 술 종류 */
export const ALCOHOL_CATS: Category[] = ['spirit', 'liqueur', 'wine'];
/** 술 종류를 골랐는데 도수가 0이면 넣는 기본 도수 */
export const DEFAULT_ABV: Partial<Record<Category, number>> = { spirit: 40, liqueur: 20, wine: 12 };

/** 빠른 선택을 접었을 때 보이는 개수 */
export const PRESETS_FOLDED = 12;

/** 도수 입력 칸 (v2.1 Stepper 와 같음) */
export const ABV_STEPPER = { min: 0, max: 60, step: 0.5, presets: [0, 4.5, 12, 16.5, 20, 40] };
/** 용기 용량 칸 */
export const CAPACITY_STEPPER = { min: 100, max: 3000, step: 50, presets: [500, 750, 1000, 1500, 2000] };
/** 남은 양 칸 */
export const REMAINING_STEP = 10;

/** 재료 색 팔레트 이름 (화면 읽기용 — presets.ts 주석과 같은 이름) */
export const COLOR_NAMES: Record<string, string> = {
  '#5CE1C6': '민트',
  '#FF6FAE': '핑크',
  '#FFC542': '레몬',
  '#FF9F43': '오렌지',
  '#FF5A5F': '석류',
  '#8B7CF6': '바이올렛',
  '#4DA3FF': '블루',
  '#7BD88F': '라임',
  '#B0794F': '콜라',
  '#D4A373': '위스키',
  '#EFE6D2': '우유',
  '#C9D6E8': '투명',
};

/** 편집 화면 입력값 */
export interface IngredientForm {
  name: string;
  category: Category;
  abv: number;
  color: string;
  capacityMl: number;
  remainingMl: number;
  notes: string;
}

/** 재료 편집 주소의 쿼리 (#/ingredients/:pump?suggest=…&category=…&abv=…&from=explore&done=a|b) */
export interface EditParams {
  suggest?: string | null;
  category?: string | null;
  abv?: string | null;
  from?: string | null;
  done?: string | null;
}

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as string[]).includes(v);
}

/**
 * 편집 화면 첫 값 (v2.1 initial useMemo 와 같음)
 *  - suggest 가 있으면: 이름(탐색에서 왔으면 AI 가 쓴 이름 그대로 20자, 아니면 프리셋 이름) · 종류(쿼리 → 프리셋 → 기타) ·
 *    도수(쿼리 0~96 → 프리셋 → 0) · 색(프리셋 → 지금 펌프 색) · 용량은 지금 펌프 용량, 잔량은 가득
 *  - 없으면 지금 펌프 값 (빈 펌프는 잔량 = 용량)
 */
export function initialForm(slot: PumpSlot | null | undefined, params: EditParams): IngredientForm {
  const suggest = typeof params.suggest === 'string' ? params.suggest.trim() : '';
  const base = slot ?? null;
  const fromExplore = params.from === 'explore';
  let form: IngredientForm;
  if (suggest) {
    const p = findPreset(suggest);
    const cat = isCategory(params.category) ? params.category : null;
    const abvParam = typeof params.abv === 'string' && params.abv.trim() !== '' ? Number(params.abv) : NaN;
    form = {
      // 탐색 카드에서 온 경우 AI 가 쓴 이름을 그대로 (재추천 때 이름으로 매칭)
      name: fromExplore ? suggest.slice(0, 20) : (p?.name ?? suggest),
      category: cat ?? p?.category ?? 'other',
      abv: Number.isFinite(abvParam) && abvParam >= 0 ? Math.min(96, abvParam) : (p?.abv ?? 0),
      color: p?.color ?? base?.color ?? INGREDIENT_COLORS[0],
      capacityMl: base?.capacityMl ?? 1000,
      remainingMl: base?.capacityMl ?? 1000,
      notes: '',
    };
  } else {
    form = {
      name: base?.name ?? '',
      category: base?.category ?? 'other',
      abv: base?.abv ?? 0,
      color: base?.color ?? INGREDIENT_COLORS[0],
      capacityMl: base?.capacityMl ?? 1000,
      remainingMl: base?.name ? base.remainingMl : (base?.capacityMl ?? 1000),
      notes: base?.notes ?? '',
    };
  }
  return { ...form, remainingMl: Math.min(form.remainingMl, form.capacityMl) };
}

/**
 * 빠른 선택 목록 (v2.1 과 같음) — 사용자가 이름을 새로 입력하고 있을 때만 검색(기존 재료를 열었을 땐 전체),
 * 검색이 아니고 접혀 있으면 앞 12개
 */
export function filterPresets(name: string, initialName: string, showAll: boolean): { list: IngredientPreset[]; searching: boolean } {
  const q = name.trim() === initialName.trim() ? '' : name.replace(/\s+/g, '').toLowerCase();
  const list = q
    ? PRESETS.filter((p) => p.name.toLowerCase().includes(q) || p.aliases?.some((a) => a.toLowerCase().includes(q)))
    : PRESETS;
  return { list: showAll || q ? list : list.slice(0, PRESETS_FOLDED), searching: !!q };
}

/** 종류 칩을 눌렀을 때 도수 (술 종류인데 0 → 기본 도수, 술이 아닌 종류로 바꿨는데 도수 > 0 → 0) */
export function abvForCategoryChange(prev: Category, next: Category, abv: number): number {
  if (ALCOHOL_CATS.includes(next)) return abv <= 0 ? (DEFAULT_ABV[next] ?? 0) : abv;
  if (abv > 0 && prev !== next) return 0;
  return abv;
}

/** 저장할 도수 (0~96, 소수 1자리) */
export function clampAbv(abv: number): number {
  return Math.max(0, Math.min(96, Math.round((Number.isFinite(abv) ? abv : 0) * 10) / 10));
}

/** 술 종류이거나 술 이름(프리셋 정확 일치)인지 — 도수 0% 경고용 */
export function looksAlcoholic(name: string, category: Category): boolean {
  return ALCOHOL_CATS.includes(category) || !!findExactPreset(name)?.abv;
}

/**
 * 술 종류(증류주·리큐르·와인)나 술 이름(프리셋 정확 일치)인데 도수 0% → 저장 전에 확인할 문구 (아니면 null)
 * fix: [도수 고치기]를 누르면 미리 채울 도수 (프리셋 도수 → 종류 기본 도수)
 */
export function alcoholZeroCheck(name: string, category: Category, abvToSave: number): { title: string; message: string; fix: number | undefined } | null {
  if (abvToSave > 0) return null;
  const n = name.trim();
  const preset = findExactPreset(n);
  const presetAlcohol = preset && preset.abv > 0 ? preset : null;
  if (!ALCOHOL_CATS.includes(category) && !presetAlcohol) return null;
  const why = presetAlcohol
    ? `${josa(n, '은', '는')} 보통 도수 ${presetAlcohol.abv}% 술이에요.`
    : `종류가 '${CATEGORY_INFO[category].label}'(술)인데 도수가 0%예요.`;
  return {
    title: '술인데 도수가 0%예요',
    message: `${why} 도수 0%로 저장하면 무알콜 레시피에 들어가고 성인 확인도 건너뛰어요. 정말 알코올이 없는 음료인가요?`,
    fix: presetAlcohol?.abv ?? DEFAULT_ABV[category],
  };
}

/** 이름·종류가 바뀌었는지 (기존 재료가 있을 때만) → 캘리브레이션 권장 */
export function isMaterialChanged(slot: Pick<PumpSlot, 'name' | 'category'>, name: string, category: Category): boolean {
  return !!slot.name && (slot.name.trim() !== name.trim() || slot.category !== category);
}

/** 탐색 흐름에서 이미 장착한(또는 이 화면에서 넣는) 재료 이름 키 — done 쿼리 + suggest + 저장한 이름 */
export function doneKeysOf(done: string | null | undefined, suggest: string | null | undefined, savedName: string): Set<string> {
  return new Set(
    [...(typeof done === 'string' && done ? done.split('|') : []), typeof suggest === 'string' ? suggest : '', savedName]
      .map((x) => nameKey(x))
      .filter(Boolean),
  );
}

/**
 * 재료 목록 "○○ 장착하기" 배너의 추천 펌프 — 탐색 카드와 같은 규칙(recommendPump):
 * 빈 펌프(번호 순) → 없으면 기록상 가장 적게 쓰인 펌프. 지금 보고 있는 레시피에 쓰는 펌프는 피함
 */
export function suggestPumpPick(
  slots: PumpSlot[],
  entries: UsageEntry[],
  suggest: string,
  recipeIngredients?: readonly Pick<RecipeIngredient, 'pump' | 'name' | 'ml'>[] | null,
): PumpPick | null {
  const name = suggest.trim();
  if (!name || !slots.length) return null;
  const preset = findPreset(name);
  const item: ExploreItem = {
    addIngredient: name,
    category: preset?.category ?? 'other',
    abv: preset?.abv ?? 0,
    recipeName: '',
    description: '',
    ingredients: (recipeIngredients ?? []).map((i) => ({ name: i.name, ml: i.ml, installed: true, pump: i.pump })),
    message: '',
  };
  return recommendPump(slots, pumpUsage(slots, entries), item);
}

/** 제안한 재료가 이미 어느 펌프에 들어 있는지 */
export function isInstalled(slots: PumpSlot[], name: string): boolean {
  const k = nameKey(name);
  return !!k && slots.some((s) => s.name && nameKey(s.name) === k);
}

/** 펌프 요약 (장착 N/4 · 잔량 부족 · 주류) */
export function pumpSummary(slots: PumpSlot[], isLow: (s: PumpSlot) => boolean) {
  const installed = slots.filter((s) => s.name.trim().length > 0);
  return {
    installed: installed.length,
    total: slots.length,
    low: slots.filter(isLow).length,
    alcohol: installed.filter((s) => s.abv > 0).length,
  };
}
