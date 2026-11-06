/**
 * 오프라인 탐색(explore) 항목 생성 — SPEC §5.4 "fallback 후보 목록" (백엔드·앱 오프라인 공통)
 *
 * | 후보 | category | abv | 고르는 조건 |
 * | 탄산수 | soda | 0 | soda 미장착 + fizzy ≥ 2 |
 * | 토닉워터 | soda | 0 | soda 미장착 또는 bitter ≥ 2 |
 * | 레몬즙 | juice | 0 | 산미 재료(레몬·라임·자몽 등) 없음 + sour ≥ 2 |
 * | 설탕시럽 | syrup | 0 | syrup 미장착 + sweet ≥ 2 |
 * | 그레나딘 시럽 | syrup | 0 | syrup 미장착 (색감) |
 * | 크랜베리주스 | juice | 0 | juice 1개 이하 |
 * | 우유 | dairy | 0 | dairy 미장착 + 휴식/디저트 상황 (RELAX_RE: 휴식·디저트·릴랙스·편안·차분·힐링) |
 * | 진 · 보드카 · 화이트 럼 | spirit | 40 | strength ≠ none 이고 spirit 미장착 이고 user.adultVerified |
 * | 트리플섹 | liqueur | 30 | strength ≠ none 이고 liqueur 미장착 이고 user.adultVerified |
 * - 장착된 재료와 이름이 같거나(normName) 거절 기록에 반복(2번 이상) 등장했거나,
 *   성향에서 알레르기·싫어하는 재료로 판정된(preference.ts excludedByPreference — SPEC §3.3 규칙 1, 백엔드와 같은 함수) 후보는 제외
 * - 짝으로 쓰는 장착 재료도 성향으로 제외된 재료는 쓰지 않음
 * - 산미 재료 판정(SOUR_RE)·휴식 상황 판정(RELAX_RE)은 백엔드 fallback.js 와 같은 정규식
 * - 조건을 만족하는 후보가 없으면 탄산수 → 레몬즙 → 설탕시럽 순으로 채움 (normal·explore 모두 — SPEC §5.4, 백엔드와 같음)
 * - (안전장치, 백엔드 buildFallbackExplore 와 같음) 그래도 없으면 조건 무시 → 거절 기록 무시 순으로 1개 이상 확보
 * - 거절한 레시피와 같은 재료 조합은 만들지 않음
 * 순수 함수 (React Native 비의존). 결과는 서버 응답과 같은 모양(raw) → parseExplore 로 검증합니다.
 */
import { profileOf } from '../presets';
import type { Category, HistoryHint, IngredientInfo, RecipeRequest } from '../types';
import { nameKey } from './explore';
import { josa, STRENGTH_ABV } from './normalize';
import { comboKey, rejectedCombos } from './offline';
import { excludedByPreference, preferenceExcludedPumps } from './preference';

/** (예전 이름 호환) 성향 제외 판정은 preference.ts 하나로 통일 */
export { excludedByPreference };

export interface ExploreOptions {
  /**
   * 만 19세 확인 여부 (술 후보 — 진·보드카·화이트 럼, 트리플섹 — 는 확인된 경우만).
   * 생략하면 요청의 user.adultVerified 를 씀
   */
  adultVerified?: boolean;
  /** "다시 탐색" 할 때마다 바꾸면 다른 후보가 먼저 나옵니다 */
  variation?: number;
}

export interface ExploreCandidate {
  name: string;
  category: Category;
  abv: number;
}

interface ExploreCtx {
  pool: IngredientInfo[];
  taste: RecipeRequest['user']['taste'];
  strength: RecipeRequest['user']['strength'];
  restful: boolean;
  adult: boolean;
}

/** 산미 재료 이름 (백엔드 SOUR_NAME_RE 와 같음) */
export const SOUR_RE = /레몬|라임|자몽|유자|깔라만시|매실|lemon|lime|grapefruit/i;
/** 휴식·디저트 상황 (백엔드 RELAX_RE 와 같음) — 우유 후보 조건 */
export const RELAX_RE = /휴식|디저트|릴랙스|편안|차분|힐링/;
const SPIRIT_CHOICES = ['진', '보드카', '화이트 럼'];

const hasCat = (c: ExploreCtx, cat: Category) => c.pool.some((i) => i.category === cat);

/** SPEC §5.4 표 — 위에서부터 우선. ok() = "고르는 조건" */
const CANDIDATES: { names: string[]; category: Category; abv: number; ok: (c: ExploreCtx) => boolean }[] = [
  { names: ['탄산수'], category: 'soda', abv: 0, ok: (c) => !hasCat(c, 'soda') && c.taste.fizzy >= 2 },
  { names: ['토닉워터'], category: 'soda', abv: 0, ok: (c) => !hasCat(c, 'soda') || c.taste.bitter >= 2 },
  { names: ['레몬즙'], category: 'juice', abv: 0, ok: (c) => !c.pool.some((i) => SOUR_RE.test(i.name)) && c.taste.sour >= 2 },
  { names: ['설탕시럽'], category: 'syrup', abv: 0, ok: (c) => !hasCat(c, 'syrup') && c.taste.sweet >= 2 },
  { names: ['그레나딘 시럽'], category: 'syrup', abv: 0, ok: (c) => !hasCat(c, 'syrup') },
  { names: ['크랜베리주스'], category: 'juice', abv: 0, ok: (c) => c.pool.filter((i) => i.category === 'juice').length <= 1 },
  { names: ['우유'], category: 'dairy', abv: 0, ok: (c) => !hasCat(c, 'dairy') && c.restful },
  { names: SPIRIT_CHOICES, category: 'spirit', abv: 40, ok: (c) => c.strength !== 'none' && !hasCat(c, 'spirit') && c.adult },
  { names: ['트리플섹'], category: 'liqueur', abv: 30, ok: (c) => c.strength !== 'none' && !hasCat(c, 'liqueur') && c.adult },
];

/** 표의 모든 이름(위에서부터, '진 · 보드카 · 화이트 럼'은 각각) — 안전장치에서 조건 없이 고를 때 (백엔드 CANDIDATE_BY_NAME 순서) */
const ALL_CANDIDATES: ExploreCandidate[] = CANDIDATES.flatMap((c) => c.names.map((name) => ({ name, category: c.category, abv: c.abv })));

/** 조건을 만족하는 후보가 없을 때 채우는 순서 */
const FILLERS: ExploreCandidate[] = [
  { name: '탄산수', category: 'soda', abv: 0 },
  { name: '레몬즙', category: 'juice', abv: 0 },
  { name: '설탕시럽', category: 'syrup', abv: 0 },
];

/** 거절 기록에 2번 이상 나온 재료 이름 키 */
export function repeatedlyRejected(history: HistoryHint[] | undefined): Set<string> {
  const count = new Map<string, number>();
  for (const h of history ?? []) {
    if (!h?.rejected) continue;
    for (const k of new Set((h.ingredients ?? []).map((i) => nameKey(i.name)))) count.set(k, (count.get(k) ?? 0) + 1);
  }
  return new Set(Array.from(count.entries()).filter(([, n]) => n >= 2).map(([k]) => k));
}

/**
 * 탐색 후보 고르기 (SPEC §5.4) — 백엔드 buildFallbackExplore 의 후보 고르기와 같은 순서·같은 제외 규칙.
 * fill=true(기본, normal·explore 모두)면 조건을 만족하는 후보가 하나도 없을 때 탄산수 → 레몬즙 → 설탕시럽으로 채우고,
 * 그래도 없으면 조건 무시 → 거절 기록 무시 순으로 1개 이상 확보(안전장치). fill=false 면 조건을 만족하는 후보만.
 * 무알콜이거나 성인 확인 전이면 술 후보는 어느 단계에서도 고르지 않음.
 */
export function exploreCandidates(req: RecipeRequest, opts: ExploreOptions = {}, fill = true): ExploreCandidate[] {
  const u = req.user;
  const installed = req.ingredients.filter((i) => i.name && i.name.trim());
  const ctx: ExploreCtx = {
    pool: installed,
    taste: u.taste,
    strength: u.strength,
    restful: RELAX_RE.test(`${u.situation ?? ''} ${u.preference ?? ''}`),
    adult: opts.adultVerified ?? u.adultVerified === true,
  };
  const installedKeys = new Set(installed.map((i) => nameKey(i.name)));
  const rejected = repeatedlyRejected(req.history);
  const excluded = (name: string, ignoreRejected = false) =>
    installedKeys.has(nameKey(name)) || (!ignoreRejected && rejected.has(nameKey(name))) || excludedByPreference({ name }, u.preference);
  /** 무알콜·성인 확인 전에는 술 후보 없음 */
  const alcoholBlocked = (c: { abv: number }) => c.abv > 0 && (u.strength === 'none' || !ctx.adult);

  const picked: ExploreCandidate[] = [];
  for (const c of CANDIDATES) {
    if (!c.ok(ctx)) continue;
    if (alcoholBlocked(c)) continue; // 무알콜·성인 확인 전에는 술 후보 없음
    const name = c.names.find((n) => !excluded(n));
    if (name) picked.push({ name, category: c.category, abv: c.abv });
  }
  if (!picked.length && fill) {
    for (const f of FILLERS) if (!excluded(f.name)) picked.push(f);
  }
  // (안전장치 — 백엔드와 같음) 그래도 없으면 조건 무시 → 거절 기록 무시 순으로 1개 이상 확보
  if (!picked.length && fill) for (const c of ALL_CANDIDATES) if (!alcoholBlocked(c) && !excluded(c.name)) picked.push(c);
  if (!picked.length && fill) for (const c of ALL_CANDIDATES) if (!alcoholBlocked(c) && !excluded(c.name, true)) picked.push(c);
  // "다시 탐색": 후보 순서를 돌려 다른 재료가 먼저 나오게
  const v = Math.abs(Math.floor(opts.variation ?? 0));
  if (v > 0 && picked.length > 1) {
    const r = v % picked.length;
    return [...picked.slice(r), ...picked.slice(0, r)];
  }
  return picked;
}

/** 새 재료와 잘 어울리는 장착 재료 종류 (앞일수록 우선) */
const PARTNER_PREF: Record<string, Category[]> = {
  탄산수: ['juice', 'syrup', 'spirit', 'liqueur', 'wine', 'other'],
  토닉워터: ['spirit', 'juice', 'liqueur', 'syrup', 'other'],
  레몬즙: ['soda', 'juice', 'syrup', 'spirit', 'liqueur', 'water'],
  설탕시럽: ['soda', 'juice', 'water', 'spirit', 'dairy'],
  '그레나딘 시럽': ['soda', 'juice', 'dairy', 'spirit', 'water'],
  크랜베리주스: ['soda', 'spirit', 'liqueur', 'juice', 'water'],
  우유: ['syrup', 'liqueur', 'spirit', 'other'],
  진: ['soda', 'juice', 'syrup'],
  보드카: ['juice', 'soda', 'syrup'],
  '화이트 럼': ['soda', 'juice', 'syrup'],
  트리플섹: ['juice', 'soda', 'spirit'],
};

/**
 * 장착된 짝 재료가 없을 때(빈 기기 등) 함께 장착할 두 번째 새 재료 후보 —
 * 백엔드 fallback.js EXPLORE_PARTNERS 와 같은 목록·순서 (서버 fallback 과 같은 새 재료 짝이 나오게)
 */
const NEW_PAIR: Record<string, ExploreCandidate[]> = {
  탄산수: [
    { name: '레몬즙', category: 'juice', abv: 0 },
    { name: '크랜베리주스', category: 'juice', abv: 0 },
  ],
  토닉워터: [
    { name: '레몬즙', category: 'juice', abv: 0 },
    { name: '크랜베리주스', category: 'juice', abv: 0 },
  ],
  레몬즙: [
    { name: '탄산수', category: 'soda', abv: 0 },
    { name: '토닉워터', category: 'soda', abv: 0 },
    { name: '크랜베리주스', category: 'juice', abv: 0 },
  ],
  설탕시럽: [
    { name: '탄산수', category: 'soda', abv: 0 },
    { name: '크랜베리주스', category: 'juice', abv: 0 },
  ],
  '그레나딘 시럽': [
    { name: '탄산수', category: 'soda', abv: 0 },
    { name: '우유', category: 'dairy', abv: 0 },
  ],
  크랜베리주스: [
    { name: '탄산수', category: 'soda', abv: 0 },
    { name: '토닉워터', category: 'soda', abv: 0 },
  ],
  우유: [
    { name: '그레나딘 시럽', category: 'syrup', abv: 0 },
    { name: '설탕시럽', category: 'syrup', abv: 0 },
  ],
  진: [
    { name: '토닉워터', category: 'soda', abv: 0 },
    { name: '탄산수', category: 'soda', abv: 0 },
  ],
  보드카: [
    { name: '크랜베리주스', category: 'juice', abv: 0 },
    { name: '토닉워터', category: 'soda', abv: 0 },
  ],
  '화이트 럼': [
    { name: '탄산수', category: 'soda', abv: 0 },
    { name: '크랜베리주스', category: 'juice', abv: 0 },
  ],
  트리플섹: [
    { name: '크랜베리주스', category: 'juice', abv: 0 },
    { name: '탄산수', category: 'soda', abv: 0 },
  ],
};

interface Part {
  name: string;
  category: Category;
  abv: number;
  installed: boolean;
  pump?: number;
  share: number;
}

const ALC_CATS = new Set<Category>(['spirit', 'liqueur', 'wine']);

/** 짝 재료 줄 (장착 재료면 installed:true + pump) */
type PartnerLine = { name: string; category: Category; abv: number; installed: boolean; pump?: number };

/** 비율 정하기: 술은 목표 도수에 맞추고, 레몬즙·시럽은 상한(15%·10%) 안에서, 나머지는 믹서가 채움 */
function allocate(parts: Part[], strength: RecipeRequest['user']['strength'], cup: number): number[] {
  const target = STRENGTH_ABV[strength]?.target ?? 0;
  const cap = (p: Part) => profileOf(p.name, p.category).maxShare;
  const alc = parts.filter((p) => p.abv > 0);
  let used = 0;
  for (const p of alc) {
    p.share = Math.min(0.45, target > 0 ? target / p.abv / alc.length : 0.2);
    used += p.share;
  }
  const others = parts.filter((p) => !(p.abv > 0));
  for (const p of others.filter((x) => cap(x) < 1)) {
    p.share = Math.min(cap(p) * 0.8, Math.max(0, 1 - used) * 0.3);
    used += p.share;
  }
  const mixers = others.filter((p) => cap(p) >= 1);
  const left = Math.max(0, 1 - used);
  if (mixers.length) {
    const w = mixers.map((p) => (p.category === 'soda' ? 1.6 : 1)); // 탄산은 조금 더 많이 (청량감)
    const ws = w.reduce((a, b) => a + b, 0);
    mixers.forEach((p, i) => (p.share = (left * w[i]) / ws));
  } else if (left > 0 && parts.length) {
    const big = parts.reduce((m, p) => (p.share > m.share ? p : m), parts[0]);
    big.share += left;
  }
  const ml = parts.map((p) => Math.max(1, Math.round(p.share * cup)));
  const drift = cup - ml.reduce((a, b) => a + b, 0);
  let bi = 0;
  ml.forEach((v, i) => {
    if (v > ml[bi]) bi = i;
  });
  ml[bi] = Math.max(1, ml[bi] + drift);
  return ml;
}

function shortOf(name: string): string {
  return name.replace(/\s*(주스|즙|시럽|워터)$/u, '').trim() || name;
}

function exploreName(cand: ExploreCandidate, partner: string | null): string {
  const p = partner ? shortOf(partner) : '';
  switch (cand.name) {
    case '탄산수':
      return p ? `${p} 스파클러` : '스파클링 워터';
    case '토닉워터':
      return p ? `${p} 토닉` : '클래식 토닉';
    case '레몬즙':
      return p ? `레몬 ${p} 에이드` : '레모네이드';
    case '설탕시럽':
      return p ? `스위트 ${p}` : '스위트 쿨러';
    case '그레나딘 시럽':
      return p ? `선라이즈 ${p}` : '선라이즈 쿨러';
    case '크랜베리주스':
      return p ? `크랜베리 ${p} 쿨러` : '크랜베리 쿨러';
    case '우유':
      return p ? `${p} 밀크` : '스위트 밀크';
    case '트리플섹':
      return p ? `오렌지 ${p} 칵테일` : '오렌지 칵테일';
    default:
      return p ? `${shortOf(cand.name)} ${p} 하이볼` : `${shortOf(cand.name)} 하이볼`;
  }
}

/** 장착된 재료 중 짝 고르기 (선호 종류 순 → 잔량 많은 순), 거절 조합은 피함 */
function pickPartners(cand: ExploreCandidate, pool: IngredientInfo[], avoid: Set<string>): IngredientInfo[] | null {
  const pref = PARTNER_PREF[cand.name] ?? ['juice', 'soda', 'syrup'];
  const sorted = pool
    .filter((i) => pref.includes(i.category))
    .sort((a, b) => pref.indexOf(a.category) - pref.indexOf(b.category) || b.remainingMl - a.remainingMl);
  const options: IngredientInfo[][] = [];
  const main = sorted[0];
  if (main) {
    // 짝 1개 + (있으면) 종류가 다른 보완 재료 1개
    const second = sorted.find((i) => i.pump !== main.pump && i.category !== main.category && i.category !== cand.category);
    if (second) options.push([main, second]);
    options.push([main]);
    for (const alt of sorted.slice(1, 4)) options.push([alt]);
  }
  return options.find((o) => !avoid.has(comboKey([cand.name, ...o.map((i) => i.name)]))) ?? null;
}

const particleOnly = (word: string, a: string, b: string) => josa(word, a, b).slice(word.length);

/**
 * (relaxed) 종류를 가리지 않고 장착 재료 1개를 짝으로 — 서버 fallback 처럼 쓸 수 있는 장착 재료를 씀. 거절 조합은 피함.
 * 무알콜 재료 먼저(잔량 많은 순). 술 후보는 섞을 무알콜 재료가 있어야 도수 상한을 맞출 수 있으므로 무알콜 재료만
 */
function anyPartner(cand: ExploreCandidate, pool: IngredientInfo[], avoid: Set<string>): IngredientInfo[] | null {
  const sorted = pool
    .filter((i) => !(cand.abv > 0) || !(i.abv > 0))
    .sort((a, b) => (a.abv > 0 ? 1 : 0) - (b.abv > 0 ? 1 : 0) || b.remainingMl - a.remainingMl);
  return sorted.map((i) => [i]).find((o) => !avoid.has(comboKey([cand.name, ...o.map((i) => i.name)]))) ?? null;
}

/**
 * 오프라인 탐색 항목 생성 — normal 모드 0~1개, explore 모드 1~3개 (새 재료 이름·순서는 서버 fallback 과 같음).
 * 각 항목의 미장착 재료는 1개(장착된 짝 재료가 없거나, 술 후보에 섞을 무알콜 재료가 없을 때만 2개), ml 합 = 잔 용량.
 * 짝을 전혀 못 구하면 새 재료 한 가지 카드(서버와 같음).
 */
export function offlineExplore(req: RecipeRequest, opts: ExploreOptions = {}): Record<string, unknown>[] {
  const isExplore = req.mode === 'explore';
  const max = isExplore ? 3 : 1;
  // normal 모드도 후보가 없으면 채움 (SPEC §5.4 — 서버 fallback 과 같은 후보, 결과는 최대 1개)
  const cands = exploreCandidates(req, opts, true);
  const u = req.user;
  const cup = Math.min(500, Math.max(30, Math.round(u.cupMl || 200)));
  // 짝 재료로 쓸 장착 재료: 잔량 있음 + 무알콜이면 술 제외 + 성향(알레르기·싫어하는 재료)으로 제외된 재료 제외
  const prefExcluded = preferenceExcludedPumps(req.ingredients, u.preference);
  const pool = req.ingredients.filter(
    (i) =>
      i.name && i.name.trim() && i.remainingMl > 0 && (u.strength !== 'none' || !(i.abv > 0)) && !prefExcluded.has(i.pump),
  );
  const installedKeys = new Set(req.ingredients.filter((i) => i.name).map((i) => nameKey(i.name)));
  const avoid = rejectedCombos(req.history);
  const rejectedRepeat = repeatedlyRejected(req.history);
  const out: Record<string, unknown>[] = [];
  /** 이번 결과 안에서 같은 재료 조합이 두 번 나오지 않게 */
  const used = new Set<string>();

  /** 새 재료(cand)와 함께 쓸 짝 재료 — 없으면 null */
  const partnersFor = (cand: ExploreCandidate): PartnerLine[] | null => {
    const avoidNow = new Set([...avoid, ...used]);
    const asInstalled = (o: IngredientInfo[]) => o.map((i) => ({ name: i.name, category: i.category, abv: i.abv, installed: true, pump: i.pump }));
    const newPair = (ignoreRejected: boolean) =>
      (NEW_PAIR[cand.name] ?? []).find(
        (n) =>
          !installedKeys.has(nameKey(n.name)) &&
          (ignoreRejected || !rejectedRepeat.has(nameKey(n.name))) &&
          !excludedByPreference({ name: n.name }, u.preference) &&
          !(n.abv > 0 && u.strength === 'none') &&
          !avoid.has(comboKey([cand.name, n.name])) &&
          !used.has(comboKey([cand.name, n.name])),
      );
    // ① 어울리는 종류의 장착 재료 → ② 장착된 짝이 없으면 두 번째 새 재료(미장착 최대 2개)
    const opt = pickPartners(cand, pool, avoidNow);
    if (opt) return asInstalled(opt);
    const second = newPair(false);
    if (second) return [{ ...second, installed: false }];
    // ③ 그래도 없으면 서버 fallback 처럼: 종류를 가리지 않고 장착 재료(잔량 많은 순) → 거절 기록 반복 여부를 보지 않은 두 번째 새 재료.
    //    후보 순서(SPEC §5.4 '위에서부터 우선')를 지키고 explore 모드 1개 이상을 보장하려고 — 다음 후보로 건너뛰지 않음
    const any = anyPartner(cand, pool, avoidNow);
    if (any) return asInstalled(any);
    const relaxed = newPair(true);
    if (relaxed) return [{ ...relaxed, installed: false }];
    // ④ 짝 없이 새 재료만 (서버 fallback 도 짝을 못 구하면 새 재료 한 가지 카드 — 이때는 이번 결과 안의 중복만 피함, 서버와 같음).
    //    술은 섞을 재료가 없으면 검증(parseExplore)에서 빠짐
    return used.has(comboKey([cand.name])) ? null : [];
  };

  /**
   * 술 후보의 짝이 모두 술이면 섞을 무알콜 재료를 하나 더 (없으면 도수 상한을 못 맞춰 검증에서 카드가 빠짐 — 서버 fallback 도
   * 이때 무알콜 짝을 더함): 장착된 무알콜 재료(잔량 많은 순) → 두 번째 새 재료(거절 기록 반복 → 무시 순)
   */
  const withMixer = (cand: ExploreCandidate, partners: PartnerLine[]): PartnerLine[] => {
    if (!(cand.abv > 0) || partners.some((p) => !(p.abv > 0))) return partners;
    const names = [cand.name, ...partners.map((p) => p.name)];
    const ok = (n: string) => !avoid.has(comboKey([...names, n])) && !used.has(comboKey([...names, n]));
    const inst = [...pool]
      .filter((i) => !(i.abv > 0) && !partners.some((p) => p.pump === i.pump) && ok(i.name))
      .sort((a, b) => b.remainingMl - a.remainingMl)[0];
    if (inst) return [...partners, { name: inst.name, category: inst.category, abv: inst.abv, installed: true, pump: inst.pump }];
    if (partners.some((p) => !p.installed)) return partners; // 새 재료는 최대 2개
    const pair = (ignoreRejected: boolean) =>
      (NEW_PAIR[cand.name] ?? []).find(
        (n) =>
          !installedKeys.has(nameKey(n.name)) &&
          (ignoreRejected || !rejectedRepeat.has(nameKey(n.name))) &&
          !excludedByPreference({ name: n.name }, u.preference) &&
          ok(n.name),
      );
    const second = pair(false) ?? pair(true);
    return second ? [...partners, { ...second, installed: false }] : partners;
  };

  for (const cand of cands) {
    if (out.length >= max) break;
    const found = partnersFor(cand);
    if (!found) continue;
    const partners = withMixer(cand, found);

    const parts: Part[] = [
      { name: cand.name, category: cand.category, abv: cand.abv, installed: false, share: 0 },
      ...partners.map((p) => ({ ...p, share: 0 })),
    ];
    // 붓는 순서: 술 → 주스·시럽·유제품 → 탄산
    const rank = (c: Category) => (ALC_CATS.has(c) ? 0 : c === 'soda' ? 2 : 1);
    parts.sort((a, b) => rank(a.category) - rank(b.category));
    const mls = allocate(parts, u.strength, cup);
    const alcoholic = parts.some((p) => p.abv > 0);
    const names = parts.map((p) => p.name);
    const last = names[names.length - 1];
    const listText =
      names.length <= 1
        ? last
        : names.slice(0, -1).join(', ') + particleOnly(names[names.length - 2], '과', '와') + ' ' + last;
    const newOnes = parts.filter((p) => !p.installed).map((p) => p.name);
    used.add(comboKey(names));
    const partnerName = partners.find((p) => p.installed)?.name ?? partners[0]?.name ?? null;
    out.push({
      addIngredient: cand.name,
      category: cand.category,
      abv: cand.abv,
      recipeName: exploreName(cand, partnerName),
      description:
        names.length <= 1
          ? `${josa(last, '으로', '로')} 만든 ${alcoholic ? '한 잔' : '무알콜 음료'}`
          : `${listText}${particleOnly(last, '을', '를')} 섞은 ${alcoholic ? '칵테일' : '무알콜 음료'}`,
      ingredients: parts.map((p, i) => ({
        name: p.name,
        ml: mls[i],
        installed: p.installed,
        ...(p.pump ? { pump: p.pump } : {}),
      })),
      message:
        newOnes.length > 1
          ? `${josa(newOnes[0], '과', '와')} ${josa(newOnes[1], '을', '를')} 장착하면 만들 수 있어요.`
          : `${josa(cand.name, '을', '를')} 비어 있거나 잘 안 쓰는 펌프에 장착하면 만들 수 있어요.`,
    });
  }
  return out;
}
