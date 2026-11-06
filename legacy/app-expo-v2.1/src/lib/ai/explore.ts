/**
 * 탐색(explore) 모드 — SPEC §5.4
 *  - parseExplore: 서버/Gemini/오프라인이 준 explore 배열을 검증·정리
 *    (installed·pump 는 앱이 장착 재료와 이름 일치(SPEC §3.1 normName: 소문자, 공백·기호 무시)로 다시 계산)
 *    ml: 직접 Gemini·오프라인은 합계를 잔 용량에 맞추고, 서버 결과(이미 보정됨)는 넘칠 때만 줄임.
 *    그다음 도수 상한(light 5 / medium 12 / strong 20%)과 줄당 300ml 를 지킴
 *    무알콜이면 술 장착 항목·술 줄을 빼고, 성인 확인 전(adultVerified=false)이면 술을 새로 장착하라는 항목을 버림
 *    (판정: addIngredient 의 abv>0 또는 category spirit·liqueur·wine 또는 미장착 재료 이름이 술 이름 — 백엔드 normalizeExplore 와 같음)
 *  - addsSoftIngredient / filterNoMixerExplore: NO_MIXER(explore → recipe:null) 일 때 무알콜 재료를 새로 더하는 카드만 남김 (SPEC §3.3 규칙 8)
 *  - recommendPump: "펌프 N에 장착하기" 에 쓸 펌프 고르기 (빈 펌프 우선, 없으면 기록상 가장 적게 쓰인 펌프)
 * 순수 함수 (React Native 비의존).
 */
import { findExactPreset, findPreset } from '../presets';
import { CATEGORIES, type Category, type ExploreIngredient, type ExploreItem, type IngredientInfo, type PumpSlot, type RecommendMode, type Strength } from '../types';
import { ALCOHOL_CATEGORIES, looksAlcoholic } from './alcohol';
import { cleanText, clampCup, josa, normName, round1, scaleToTotal, STEP_MAX_ML, STRENGTH_ABV, toNum } from './normalize';

/** explore 모드 최대 항목 수 (normal 모드는 최대 1개) */
export const EXPLORE_MAX = 3;
/** 한 항목에서 새로 장착해야 하는 재료 최대 개수 */
export const EXPLORE_MAX_MISSING = 2;

/**
 * 재료 이름 키 — SPEC §3.1 normName (소문자화 후 공백과 기호 _ - · . , ( ) [ ] ' " 제거).
 * explore 의 installed/pump 판정, 오프라인 후보 제외, 거절 조합 비교 모두 이 함수 사용 (규칙 1 매칭과 같은 기준)
 */
export const nameKey = (s: unknown) => normName(s);

export interface ExploreContext {
  /** 지금 장착된 재료 (이름이 있는 펌프) */
  ingredients: IngredientInfo[];
  strength: Strength;
  cupMl: number;
  mode: RecommendMode;
  /**
   * false 면 합계를 잔 용량에 맞춰 늘리지 않음(넘칠 때만 줄임) — 서버가 이미 보정한 explore.
   * 기본 true (직접 Gemini·오프라인 원본은 잔 용량에 맞춤)
   */
  scaleToCup?: boolean;
  /**
   * 만 19세 이상 확인 여부 (SPEC §3.1 user.adultVerified). true 가 아니면(생략 포함) 술을 새로 장착하라는 항목을 버림 (SPEC §5.4)
   */
  adultVerified?: boolean;
  /**
   * 성향(알레르기·싫어하는 재료, SPEC §3.3 규칙 1)으로 뺀 장착 재료의 펌프 — 그 펌프의 장착 줄은 지움 (백엔드 opts.excludePumps 와 같음)
   */
  excludePumps?: ReadonlySet<number>;
  /**
   * 성향으로 뺄 재료 이름인지 (preference.ts excludedByPreference). addIngredient 가 해당하면 항목을 버리고,
   * 그 밖의 미장착 줄은 줄만 지움 (백엔드 opts.excludeName 과 같음 — SPEC §5.4)
   */
  excludeName?: (name: string) => boolean;
}

/** AI 가 category 를 빠뜨렸을 때 도수로 추정 (백엔드 guessCategory 와 같음) */
function guessCategory(abv: number): Category {
  return abv >= 20 ? 'spirit' : abv > 0 ? 'wine' : 'other';
}

/**
 * 미장착 재료 이름이 술인지 — 백엔드와 같은 술 이름 목록(alcohol.ts) + 앱 프리셋에 정확히 같은 이름으로 있는 술.
 * 프리셋의 술 이름·별칭(피치트리·말리부 등)은 모두 술 이름 목록에도 들어 있어 결과는 looksAlcoholic 과 같음
 * (SPEC §5.4 '백엔드와 같은 목록' — tests/parity.test.ts 로 확인). 부분 일치는 쓰지 않음 — '진저 시럽' ≠ '진'
 */
export function uninstalledIsAlcohol(name: string): boolean {
  return looksAlcoholic(name) || (findExactPreset(name)?.abv ?? 0) > 0;
}

/**
 * 탐색 줄 도수 상한 (백엔드 capLinesAbv 와 같은 방식 + 줄당 300ml 보장).
 * 넘으면 술 줄을 줄이고 무알콜 줄을 늘려 총량 유지 → 무알콜 줄이 300ml 를 넘으면 300 으로 자르고 술을 더 줄임(총량 감소 허용).
 * 무알콜 줄이 없어 낮출 수 없으면 false (항목 제거).
 */
export function capExploreAbv<T extends { ml: number }>(lines: T[], abvOf: (l: T) => number, strength: Strength): boolean {
  for (const l of lines) l.ml = Math.min(STEP_MAX_ML, l.ml);
  const range = STRENGTH_ABV[strength];
  if (!range || strength === 'none') return true;
  const total = lines.reduce((s, l) => s + l.ml, 0);
  if (!(total > 0)) return true;
  const alcOf = (ls: T[]) => ls.reduce((s, l) => s + (l.ml * abvOf(l)) / 100, 0);
  if (alcOf(lines) / total <= range.max / 100 + 0.0005) return true;
  const mix = lines.filter((l) => !(abvOf(l) > 0));
  const alc = lines.filter((l) => abvOf(l) > 0);
  if (!mix.length) return false;
  const target = Math.max(0, range.max - 0.2) / 100;
  const k = Math.min(1, (target * total) / alcOf(lines));
  let freed = 0;
  for (const l of alc) {
    freed += l.ml * (1 - k);
    l.ml *= k;
  }
  const mixSum = mix.reduce((s, l) => s + l.ml, 0);
  for (const l of mix) l.ml = Math.min(STEP_MAX_ML, l.ml + (mixSum > 0 ? freed * (l.ml / mixSum) : freed / mix.length));
  const A = alcOf(alc);
  const Sa = alc.reduce((s, l) => s + l.ml, 0);
  const M = mix.reduce((s, l) => s + l.ml, 0);
  if (A > target * (Sa + M) && A - target * Sa > 0) {
    const f = (target * M) / (A - target * Sa);
    for (const l of alc) l.ml *= f;
  }
  return true;
}

export function defaultExploreMessage(name: string): string {
  return `${josa(name, '을', '를')} 비어 있거나 잘 안 쓰는 펌프에 장착하면 만들 수 있어요.`;
}

/** explore 배열 검증·정리. 형식이 틀린 항목은 버림. normal 모드는 최대 1개, explore 모드는 최대 3개 */
export function parseExplore(raw: unknown, ctx: ExploreContext): ExploreItem[] {
  if (!Array.isArray(raw)) return [];
  const max = ctx.mode === 'explore' ? EXPLORE_MAX : 1;
  const cupMl = clampCup(ctx.cupMl);
  const installed = new Map<string, IngredientInfo>();
  for (const i of ctx.ingredients) {
    if (i && typeof i.name === 'string' && i.name.trim() && !installed.has(nameKey(i.name))) installed.set(nameKey(i.name), i);
  }
  const adult = ctx.adultVerified === true;
  const out: ExploreItem[] = [];
  const seen = new Set<string>();

  for (const item of raw.slice(0, 8)) {
    if (out.length >= max) break;
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const addIngredient = cleanText(it.addIngredient ?? it.ingredient, 40);
    const addKey = nameKey(addIngredient);
    if (!addIngredient || installed.has(addKey) || seen.has(addKey)) continue;

    const preset = findExactPreset(addIngredient);
    const abvNum = toNum(it.abv);
    const abv =
      Number.isFinite(abvNum) && abvNum >= 0 && abvNum <= 100
        ? round1(abvNum)
        : (preset?.abv ?? (looksAlcoholic(addIngredient) ? 40 : 0));
    const catRaw = typeof it.category === 'string' ? it.category.trim().toLowerCase() : '';
    // category 를 빠뜨렸으면: 정확히 같은 프리셋 → 도수로 추정(백엔드와 같음). 무알콜이면 비슷한 이름의 무알콜 프리셋 종류를 참고
    // (부분 일치는 술 종류로는 쓰지 않음 — '진저 시럽'이 '진'으로 잡히지 않게)
    const loose = !preset && !(abv > 0) ? findPreset(addIngredient) : undefined;
    const looseCat = loose && loose.abv === 0 && !ALCOHOL_CATEGORIES.includes(loose.category) ? loose.category : undefined;
    const category: Category = (CATEGORIES as string[]).includes(catRaw)
      ? (catRaw as Category)
      : (preset?.category ?? looseCat ?? guessCategory(abv));
    /** 새로 장착할 재료가 술인지 (도수·종류·이름 — 백엔드 alcoholicAdd 와 같음) */
    const alcoholicAdd = abv > 0 || looksAlcoholic(addIngredient) || ALCOHOL_CATEGORIES.includes(category);
    if (ctx.strength === 'none' && alcoholicAdd) continue; // 무알콜 요청에는 술 장착을 권하지 않음
    if (!adult && alcoholicAdd) continue; // 성인 확인 전에는 술을 새로 장착하라고 하지 않음 (SPEC §5.4)
    if (ctx.excludeName?.(addIngredient)) continue; // 성향(알레르기·싫어하는 재료)으로 뺀 재료는 장착하라고 하지 않음 (백엔드와 같음)

    // 재료: 이름 일치로 installed/pump 다시 계산, 같은 재료는 합산
    const merged = new Map<string, { name: string; ml: number }>();
    const order: string[] = [];
    const list = Array.isArray(it.ingredients) ? it.ingredients.slice(0, 8) : [];
    // 성인 확인 전: 미장착 술(이름으로 판정)을 함께 장착하라는 항목도 버림 — 양이 0 인 줄도 봄 (백엔드와 같음).
    // 무알콜이면 그런 줄은 아래에서 먼저 빠지므로(백엔드도 먼저 뺀 뒤 판정) 여기서는 보지 않음
    if (!adult && ctx.strength !== 'none') {
      const alcLine = list.some((x: unknown) => {
        const n = x && typeof x === 'object' ? cleanText((x as Record<string, unknown>).name, 40) : '';
        const k = nameKey(n);
        return !!k && k !== addKey && !installed.has(k) && uninstalledIsAlcohol(n);
      });
      if (alcLine) continue;
    }
    for (const x of list) {
      if (!x || typeof x !== 'object') continue;
      const name = cleanText((x as any).name, 40);
      const ml = toNum((x as any).ml);
      if (!name || !Number.isFinite(ml) || ml <= 0) continue;
      const k = nameKey(name);
      if (!merged.has(k)) {
        order.push(k);
        merged.set(k, { name, ml: 0 });
      }
      merged.get(k)!.ml += ml;
    }
    let ings: ExploreIngredient[] = [];
    /** 줄별 도수 (장착 재료 = 등록 도수, 새 재료 = 항목 abv, 그 밖 미장착 = 프리셋 도수(정확 일치), 술 이름이면 40) */
    const lineAbv = new Map<ExploreIngredient, number>();
    for (const k of order) {
      const m = merged.get(k)!;
      const inst = installed.get(k);
      if (inst) {
        if (ctx.strength === 'none' && inst.abv > 0) continue; // 무알콜이면 장착된 술은 뺌
        if (ctx.excludePumps?.has(inst.pump)) continue; // 성향으로 뺀 장착 재료 줄은 지움 (백엔드와 같음)
        const line: ExploreIngredient = { name: inst.name, ml: m.ml, installed: true, pump: inst.pump };
        lineAbv.set(line, inst.abv > 0 ? inst.abv : 0);
        ings.push(line);
      } else {
        const isAdd = k === addKey;
        const alc = !isAdd && uninstalledIsAlcohol(m.name);
        if (ctx.strength === 'none' && alc) continue; // 무알콜이면 미장착 술 줄은 뺌 (백엔드와 같음)
        if (!isAdd && ctx.excludeName?.(m.name)) continue; // 성향으로 뺀 미장착 재료 줄은 지움 (백엔드와 같음)
        const p = isAdd ? null : findExactPreset(m.name);
        const line: ExploreIngredient = { name: isAdd ? addIngredient : m.name, ml: m.ml, installed: false };
        lineAbv.set(line, isAdd ? abv : (p?.abv ?? (alc ? 40 : 0)));
        ings.push(line);
      }
    }
    if (!ings.length) continue;
    if (!ings.some((i) => !i.installed && nameKey(i.name) === addKey)) continue; // 새 재료가 레시피에 없으면 무의미
    const missing = ings.filter((i) => !i.installed).length;
    if (missing < 1 || missing > EXPLORE_MAX_MISSING) continue;

    // ml 합 = 잔 용량 근처 (비례 보정). 서버가 이미 보정한 결과는 넘칠 때만 줄임 (다시 늘리면 술 비율이 바뀜)
    const sum = ings.reduce((a, b) => a + b.ml, 0);
    if (ctx.scaleToCup !== false || sum > cupMl + 0.05) {
      const scaled = scaleToTotal(ings, cupMl);
      scaled.forEach((x, idx) => {
        ings[idx].ml = x.ml;
      });
    }
    // 도수 상한 + 줄당 300ml (300 으로 자른 뒤에도 상한 유지)
    if (!capExploreAbv(ings, (l) => lineAbv.get(l) ?? 0, ctx.strength)) continue;
    ings = ings.map((i) => ({ ...i, ml: Math.min(STEP_MAX_ML, round1(i.ml)) })).filter((i) => i.ml > 0);
    if (!ings.length) continue;
    if (!ings.some((i) => !i.installed && nameKey(i.name) === addKey)) continue;

    seen.add(addKey);
    out.push({
      addIngredient,
      category,
      abv,
      recipeName: cleanText(it.recipeName ?? it.name, 40) || `${addIngredient} 레시피`,
      description: cleanText(it.description, 120),
      ingredients: ings,
      message: cleanText(it.message, 200) || defaultExploreMessage(addIngredient),
    });
  }
  return out;
}

/** addsSoftIngredient 가 보는 카드 모양 (ExploreItem 또는 서버 응답 원본) */
export interface SoftCheckCard {
  addIngredient: string;
  abv?: unknown;
  category?: unknown;
  ingredients: readonly { name: string; installed?: boolean }[];
}

/**
 * 이 탐색 카드가 무알콜 재료를 새로 더하는지 — SPEC §3.3 규칙 8 NO_MIXER explore 판정
 * (백엔드 backend/lib/explore.js addsSoftIngredient 와 같은 이름·같은 정의 — 기준 구현과 parity 를 위해 앱 혼자 바꾸지 않음).
 * installed:false 재료 중 하나라도
 *  (a) 술 이름 목록(alcohol.ts looksAlcoholic)에 해당하지 않고
 *  (b) 그 재료가 addIngredient(normName 일치)라면 카드 abv 가 0(숫자가 아니면 0)이고 category 가 spirit·liqueur·wine 이 아님
 * 이면 true. (장착된 재료 줄은 보지 않음 — 도수 상한을 맞출 무알콜 재료를 '새로' 더하는 카드만 남기려고)
 * 참고: SPEC 문구는 (b)만 적고 (a) 이름 조건은 없음 → '무알콜 맥주'·'논알콜 와인'·'오렌지 리큐르'(abv 0) 같은 카드는
 * SPEC 문구로는 남지만 이 구현(=백엔드)에서는 버려짐. (a)는 AI 가 도수·종류를 잘못 적은 술 카드를 막는 장치 — SPEC 에 명시 필요
 */
export function addsSoftIngredient(card: SoftCheckCard | null | undefined): boolean {
  if (!card || !Array.isArray(card.ingredients)) return false;
  const addKey = nameKey(card.addIngredient);
  const abv = typeof card.abv === 'number' && Number.isFinite(card.abv) ? card.abv : 0;
  const softAdd = abv === 0 && !ALCOHOL_CATEGORIES.includes(card.category as Category);
  return card.ingredients.some((l) => !!l && !l.installed && !looksAlcoholic(l.name) && (nameKey(l.name) !== addKey || softAdd));
}

/**
 * NO_MIXER(도수 상한을 맞출 무알콜 재료가 없음 → explore 에서 recipe:null) 일 때의 탐색 카드 거르기 (SPEC §3.3 규칙 8,
 * 백엔드 filterNoMixerExplore 와 같음): 무알콜 재료를 새로 하나도 더하지 않는 카드(addsSoftIngredient=false)는 버림.
 * 반환 { items: 남은 카드, removed: 버린 개수 } → 0개가 되면 호출측(recommend.ts)이 AI 재호출 없이 오프라인 탐색 결과(같은 필터)로 채움.
 */
export function filterNoMixerExplore<T extends SoftCheckCard>(items: readonly T[] | null | undefined): { items: T[]; removed: number } {
  const list = Array.isArray(items) ? items : [];
  const kept = list.filter((x) => addsSoftIngredient(x));
  return { items: kept, removed: list.length - kept.length };
}

/** 이 항목에서 아직 장착되지 않은 재료 이름들 (새 재료가 맨 앞) */
export function missingIngredients(item: ExploreItem): string[] {
  const names = item.ingredients.filter((i) => !i.installed).map((i) => i.name);
  const k = nameKey(item.addIngredient);
  return [item.addIngredient, ...names.filter((n) => nameKey(n) !== k)];
}

/**
 * 이 항목의 미장착 재료 중 아직 어느 펌프에도 없는 것 (새 재료가 맨 앞).
 * 빈 기기 탐색처럼 새 재료가 2개인 카드는 1개만 장착하면 레시피가 성립하지 않으므로, 남은 재료를 이어서 장착하게 함 (SPEC §5.4)
 */
export function remainingToInstall(item: ExploreItem, slots: PumpSlot[]): string[] {
  const have = new Set(slots.filter((s) => s.name && s.name.trim()).map((s) => nameKey(s.name)));
  return missingIngredients(item).filter((n) => !have.has(nameKey(n)));
}

/** 기록 항목 중 펌프 사용 횟수 계산에 필요한 부분만 */
export interface UsageEntry {
  recipe: { ingredients: { pump: number; name: string }[] };
}

/** 펌프별 사용 횟수 — 지금 그 펌프에 들어 있는 재료로 만든 기록만 셈 (최근 50잔) */
export function pumpUsage(slots: PumpSlot[], entries: UsageEntry[]): Map<number, number> {
  const usage = new Map<number, number>();
  for (const s of slots) usage.set(s.pump, 0);
  for (const e of entries.slice(0, 50)) {
    const used = new Set<number>();
    for (const i of e.recipe?.ingredients ?? []) {
      const slot = slots.find((s) => s.pump === i.pump);
      if (slot && slot.name && nameKey(slot.name) === nameKey(i.name)) used.add(i.pump);
    }
    for (const p of used) usage.set(p, (usage.get(p) ?? 0) + 1);
  }
  return usage;
}

export interface PumpPick {
  pump: number;
  /** empty: 빈 펌프 / least_used: 기록상 가장 적게 쓰인 펌프 */
  reason: 'empty' | 'least_used';
  /** 바꾸게 될 기존 재료 */
  current?: string;
  uses?: number;
}

/**
 * "펌프 N에 장착하기" 펌프 추천 (SPEC §5.4)
 *  1) 빈 펌프 (번호 순)
 *  2) 없으면 기록상 가장 적게 쓰인 펌프 — 단, 이 레시피에 쓰이는 장착 재료의 펌프는 피함
 *     (동률이면 잔량이 적은 펌프 → 번호 순)
 */
export function recommendPump(
  slots: PumpSlot[],
  usage: Map<number, number>,
  item: ExploreItem,
  exclude: Set<number> = new Set(),
): PumpPick | null {
  const sorted = [...slots].sort((a, b) => a.pump - b.pump).filter((s) => !exclude.has(s.pump));
  const empty = sorted.find((s) => !s.name.trim());
  if (empty) return { pump: empty.pump, reason: 'empty' };
  const needed = new Set(item.ingredients.filter((i) => i.installed).map((i) => nameKey(i.name)));
  let cands = sorted.filter((s) => !needed.has(nameKey(s.name)));
  if (!cands.length) cands = sorted;
  if (!cands.length) return null;
  cands.sort(
    (a, b) =>
      (usage.get(a.pump) ?? 0) - (usage.get(b.pump) ?? 0) || a.remainingMl - b.remainingMl || a.pump - b.pump,
  );
  const s = cands[0];
  return { pump: s.pump, reason: 'least_used', current: s.name, uses: usage.get(s.pump) ?? 0 };
}

/** 탐색 항목 → 장착 후 바로 만들 수 있는 레시피 원본(raw). 오프라인 재추천에서 "해당 레시피"를 그대로 쓰기 위함 */
export function exploreToRawRecipe(item: ExploreItem): Record<string, unknown> {
  return {
    name: item.recipeName,
    description: item.description,
    reason: `새로 장착한 ${josa(item.addIngredient, '을', '를')} 살린 레시피예요. ${item.description}`.trim(),
    ingredients: item.ingredients.map((i) => ({ name: i.name, ml: i.ml })),
    garnish: '얼음 (선택)',
    tips: '새 재료를 넣었다면 기기 탭에서 프라이밍(튜브 채우기) 후 제조하세요.',
    suggestions: [],
  };
}
