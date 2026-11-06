/**
 * 오프라인(규칙기반) 레시피 추천기
 * 인터넷/서버/AI 가 안 될 때 자동으로 쓰입니다. 기분·날씨·맛·도수·재료 카테고리를 점수화해
 * "그럴듯한" 비율을 만들고, 결과는 normalizeRecipe 로 다시 검증됩니다.
 * - 거절(rejected) 기록과 같은 재료 조합은 피함 (SPEC §5.3)
 * - 성향에서 알레르기·싫어하는 재료로 판정된 장착 재료는 쓰지 않음 (SPEC §3.3 규칙 1 — preference.ts, 백엔드와 같은 판정)
 * - 도수를 골랐는데 쓸 수 있는 술이 없어(미장착·잔량 0·성향 제외) 무알콜로 만든 경우 항상 info 안내 (백엔드 fallback 과 같음):
 *   성인 확인(req.user.adultVerified) 뒤에는 '…보드카·럼 같은 술을 장착하면…'까지, 그 전에는 술 장착을 권하지 않는 앞 문장만 (SPEC §3.2)
 * - 탐색(explore) 항목은 offline-explore.ts (SPEC §5.4 fallback 후보 목록)
 * 순수 함수 (React Native 비의존).
 */
import { profileOf, type FlavorProfile } from '../presets';
import type { HistoryHint, IngredientInfo, RecipeRequest, Suggestion } from '../types';
import { nameKey } from './explore';
import { preferenceExcludedPumps } from './preference';

/** 술이 없어 무알콜로 만든 경우, 성인 확인 전 안내 (술 장착 권유 없이 — SPEC §3.2 예시 문장, 백엔드 fallback NO_ALCOHOL_INFO 와 같음) */
export const OFFLINE_NO_ALCOHOL_INFO = '장착된 주류가 없어 무알콜로 만들었어요.';
/** 같은 경우 성인 확인 뒤 안내 (백엔드 fallback NO_ALCOHOL_INFO_ADULT 와 같음) */
export const OFFLINE_NO_ALCOHOL_INFO_ADULT = `${OFFLINE_NO_ALCOHOL_INFO} 보드카·럼 같은 술을 장착하면 칵테일도 만들 수 있어요.`;

export interface OfflineOptions {
  /** "다시 추천" 할 때마다 바꾸면 다른 조합이 나옵니다 */
  variation?: number;
}

/** 재료 조합 키 (순서 무시, 이름은 SPEC §3.1 normName 기준) — 거절한 레시피와 같은 조합인지 비교 */
export function comboKey(names: string[]): string {
  return Array.from(new Set(names.map(nameKey).filter(Boolean)))
    .sort()
    .join('+');
}

/** 거절(rejected=true) 기록의 재료 조합들 */
export function rejectedCombos(history: HistoryHint[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const h of history ?? []) {
    if (h && h.rejected) out.add(comboKey((h.ingredients ?? []).map((i) => i.name)));
  }
  out.delete('');
  return out;
}

/**
 * 규칙기반 레시피. 거절한 레시피와 재료 조합이 같으면 다른 조합이 나올 때까지(최대 12번) 다시 고름.
 * (재료가 1~2개뿐이라 피할 수 없으면 마지막 결과를 돌려줌)
 */
export function offlineRecipe(req: RecipeRequest, opts: OfflineOptions = {}): Record<string, unknown> {
  const avoid = rejectedCombos(req.history);
  const base = opts.variation ?? 0;
  let last: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const raw = buildOfflineRecipe(req, base + attempt * 7919, attempt);
    last = raw;
    const names = ((raw.ingredients as { name: string }[]) ?? []).map((i) => i.name);
    if (!avoid.has(comboKey(names))) return raw;
  }
  return last!;
}

interface Scored {
  info: IngredientInfo;
  profile: FlavorProfile;
  maxShare: number;
  score: number;
}

/** 목표 도수(%) — 백엔드 STRENGTH_ABV.target 과 같음 (상한: 약 5 / 보통 12 / 강 20) */
const TARGET_ABV: Record<string, number> = { light: 4, medium: 9, strong: 16 };

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const has = (arr: string[], ...keys: string[]) => arr.some((m) => keys.some((k) => m.includes(k)));

function shortName(name: string): string {
  return name.replace(/(주스|즙|시럽|워터)$/u, '').trim() || name;
}

/** 받침 유무에 따라 조사 선택 (예: josa('레몬즙','을','를') → '을') */
function josa(word: string, withBatchim: string, without: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 === 0 ? without : withBatchim;
  return without;
}

function josaRo(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) {
    const b = (c - 0xac00) % 28;
    return b === 0 || b === 8 ? '로' : '으로';
  }
  return '로';
}

function buildOfflineRecipe(req: RecipeRequest, variation: number, attempt: number): Record<string, unknown> {
  const u = req.user;
  const T = u.taste;
  const moods = u.moods ?? [];
  const cond = u.weather?.condition ?? '';
  const temp = u.weather?.tempC;
  const hot = cond.includes('더움') || (typeof temp === 'number' && temp >= 26);
  const cold = cond.includes('추움') || cond.includes('눈') || (typeof temp === 'number' && temp <= 5);
  const rainy = cond.includes('비') || cond.includes('흐림');
  const situation = u.situation ?? '';
  const seed = hashStr(JSON.stringify(u)) ^ (variation * 2654435761);
  const rnd = mulberry32(seed);

  // 성향(알레르기·싫어하는 재료)으로 제외된 재료는 처음부터 고르지 않음 (보정 단계에서도 빠짐)
  const prefExcluded = preferenceExcludedPumps(req.ingredients, u.preference);
  const allowed = req.ingredients.filter((i) => i.name && !prefExcluded.has(i.pump));
  const usable = allowed.filter((i) => i.remainingMl > 0);
  const pool = usable.length ? usable : allowed;

  const liked = new Set<string>();
  const disliked = new Set<string>();
  for (const h of req.history ?? []) {
    const main = [...(h.ingredients ?? [])].sort((a, b) => b.ml - a.ml)[0]?.name;
    if (!main) continue;
    (h.liked ? liked : disliked).add(main);
  }
  // 다시 고를수록 무작위성을 키워 다른 조합이 나오게
  const noise = 1.4 + attempt * 0.8;

  const score = (info: IngredientInfo): Scored => {
    const { profile: p, maxShare } = profileOf(info.name, info.category);
    let s = 3;
    s += (T.sweet - 2.5) * (p.sweet - 2) * 0.35;
    s += (T.sour - 2.5) * (p.sour - 2) * 0.35;
    s += (T.bitter - 2.5) * (p.bitter - 1.5) * 0.35;
    s += (T.fizzy - 2.5) * (p.fizzy - 2.5) * 0.35;
    if (has(moods, '피곤', '우울')) s += p.sour * 0.25 + p.sweet * 0.2;
    if (has(moods, '스트레스')) s += p.fizzy * 0.3 + p.sour * 0.15;
    if (has(moods, '행복', '신남') || situation.includes('파티')) s += p.fizzy * 0.25 + p.sweet * 0.15;
    if (has(moods, '차분', '나른') || situation.includes('휴식')) s += -p.fizzy * 0.2 + (info.category === 'dairy' ? 1 : 0);
    if (has(moods, '설렘') || situation.includes('데이트')) s += p.sweet * 0.2 + (info.category === 'syrup' ? 0.6 : 0);
    if (situation.includes('운동')) s += info.category === 'water' ? 1.2 : p.sour * 0.2 - p.sweet * 0.15;
    if (hot) s += p.fizzy * 0.25 + p.sour * 0.15;
    if (cold) s += -p.fizzy * 0.2 + p.sweet * 0.15 + (info.category === 'dairy' ? 0.8 : 0);
    if (rainy) s += p.sweet * 0.15;
    if (liked.has(info.name)) s += 0.6;
    if (disliked.has(info.name)) s -= 0.8;
    if (info.category === 'water') s -= 1; // 물은 꼭 필요할 때만
    s += rnd() * noise; // 다양성
    return { info, profile: p, maxShare, score: s };
  };

  const cup = Math.min(500, Math.max(30, Math.round(u.cupMl || 200)));
  const allowAlcohol = u.strength !== 'none';
  const nonAlc = pool.filter((i) => !(i.abv > 0)).map(score).sort((a, b) => b.score - a.score);
  const alc = allowAlcohol ? pool.filter((i) => i.abv > 0).map(score).sort((a, b) => b.score - a.score) : [];

  // ── 주류 양 결정 ──
  const parts: { s: Scored; ml: number }[] = [];
  let alcoholMl = 0;
  if (allowAlcohol && alc.length) {
    const target = TARGET_ABV[u.strength] ?? 8;
    const picks = [alc[0]];
    // 강하게 + 리큐르가 따로 있으면 단맛 보강용으로 1개 더
    if (u.strength === 'strong' && alc.length > 1 && T.sweet >= 3) picks.push(alc[1]);
    const pureAlcoholMl = (target * cup) / 100; // 목표 순수 알코올 양(ml)
    for (const p of picks) {
      const share = picks.length > 1 && p !== picks[0] ? 0.35 : picks.length > 1 ? 0.65 : 1;
      const ml = Math.min(cup * 0.45, (pureAlcoholMl * share * 100) / Math.max(1, p.info.abv));
      parts.push({ s: p, ml });
      alcoholMl += ml;
    }
  }

  // ── 무알콜 믹서 선택 ──
  const mixerMl = Math.max(0, cup - alcoholMl);
  // 거절을 피하려고 여러 번 다시 고를 때도 재료 1가지짜리(그냥 음료 한 가지)는 마지막 수단으로만
  let k = nonAlc.length >= 3 && rnd() < 0.55 ? 3 : Math.min(attempt >= 9 ? 1 : 2, nonAlc.length);
  if (parts.length === 0 && k === 0 && nonAlc.length) k = 1;
  // 궁합: 콜라는 레몬·라임·주류와는 잘 어울리지만 다른 주스/탄산과 섞으면 어색함
  const isCola = (x: Scored) => x.info.name.includes('콜라');
  const isCitrusShot = (x: Scored) => /레몬|라임/.test(x.info.name);
  const clash = (a: Scored, b: Scored) =>
    (isCola(a) || isCola(b)) &&
    !(isCitrusShot(a) || isCitrusShot(b)) &&
    (a.info.category === 'juice' || a.info.category === 'soda') &&
    (b.info.category === 'juice' || b.info.category === 'soda');
  const mixers: Scored[] = [];
  for (const cand of nonAlc) {
    if (mixers.length >= k) break;
    if (mixers.some((m) => clash(m, cand))) continue;
    mixers.push(cand);
  }
  if (mixers.length) {
    // 점수 기반 비율 + 강한 재료(레몬즙/시럽) 상한
    const weights = mixers.map((m) => Math.max(0.6, m.score));
    let shares = weights.map((w) => w / weights.reduce((a, b) => a + b, 0));
    for (let iter = 0; iter < 4; iter++) {
      let excess = 0;
      let freeSum = 0;
      shares = shares.map((sh, idx) => {
        const cap = mixers[idx].maxShare * (cup / Math.max(1, mixerMl));
        if (sh > cap) {
          excess += sh - cap;
          return cap;
        }
        freeSum += sh;
        return sh;
      });
      if (excess <= 1e-6 || freeSum <= 0) break;
      shares = shares.map((sh, idx) => {
        const cap = mixers[idx].maxShare * (cup / Math.max(1, mixerMl));
        return sh < cap ? sh + (excess * sh) / freeSum : sh;
      });
    }
    mixers.forEach((m, idx) => parts.push({ s: m, ml: mixerMl * shares[idx] }));
  } else if (parts.length) {
    // 믹서가 하나도 없으면 주류만 (normalize 에서 잔 용량에 맞춰짐)
    parts[0].ml = cup;
  }

  // 보기 좋게 정수 ml 로 반올림하고, 오차는 가장 많은 재료에서 보정 (합계 = 잔 용량)
  if (parts.length) {
    parts.forEach((p) => (p.ml = Math.max(1, Math.round(p.ml))));
    const drift = cup - parts.reduce((a, b) => a + b.ml, 0);
    const big = parts.reduce((m, p) => (p.ml > m.ml ? p : m), parts[0]);
    big.ml = Math.max(1, big.ml + drift);
  }

  // 순서: 주류 → 주스/시럽 → 탄산(마지막에 넣어야 거품이 덜 남)
  const rank = (c: string) => (c === 'spirit' || c === 'liqueur' || c === 'wine' ? 0 : c === 'soda' ? 2 : 1);
  parts.sort((a, b) => rank(a.s.info.category) - rank(b.s.info.category));

  // ── 맛 프로필 (ml 가중 평균) ──
  const tot = parts.reduce((a, b) => a + b.ml, 0) || 1;
  const avg = (key: keyof FlavorProfile) => Math.round(parts.reduce((a, b) => a + b.s.profile[key] * b.ml, 0) / tot);
  const flavor = { sweet: avg('sweet'), sour: avg('sour'), bitter: avg('bitter'), fizzy: avg('fizzy'), strength: 0 };

  // ── 이름·설명·이유 ──
  const main = [...parts].sort((a, b) => b.ml - a.ml).find((p) => !(p.s.info.abv > 0)) ?? parts[0];
  const mainWord = main ? shortName(main.s.info.name) : '하우스';
  const adj = has(moods, '행복')
    ? '선샤인'
    : has(moods, '설렘')
      ? '핑크 문'
      : has(moods, '피곤')
        ? '리프레시'
        : has(moods, '스트레스')
          ? '쿨 다운'
          : has(moods, '우울')
            ? '블루 스카이'
            : has(moods, '차분')
              ? '문라이트'
              : has(moods, '신남')
                ? '파티 팝'
                : has(moods, '나른')
                  ? '선데이'
                  : cond.includes('비')
                    ? '레이니'
                    : cond.includes('눈')
                      ? '스노우'
                      : hot
                        ? '썸머'
                        : cold
                          ? '윈터'
                          : '하우스';
  const alcoholic = alcoholMl > 0;
  const noun = alcoholic
    ? flavor.fizzy >= 3
      ? '하이볼'
      : flavor.sour >= 3
        ? '사워'
        : '칵테일'
    : flavor.fizzy >= 3
      ? flavor.sour >= 2
        ? '에이드'
        : '스파클러'
      : flavor.sweet >= 3
        ? '펀치'
        : '쿨러';
  const name = `${adj} ${mainWord} ${noun}`.replace(/\s+/g, ' ').trim();

  const names = parts.map((p) => p.s.info.name);
  const last = names[names.length - 1] ?? '';
  const listText =
    names.length <= 1
      ? last
      : names.slice(0, -1).join(', ') + josa(names[names.length - 2], '과', '와') + ' ' + last;
  const kind = alcoholic ? '가벼운 칵테일' : '무알콜 음료';
  const description =
    names.length > 1 ? `${listText}${josa(last, '을', '를')} 섞은 ${kind}` : `${listText}${josaRo(last)} 만든 ${kind}`;

  const reasons: string[] = [];
  if (has(moods, '피곤')) reasons.push('피곤하다고 하셔서 상큼하고 달콤한 맛으로 기운을 북돋우도록 구성했어요.');
  else if (has(moods, '스트레스')) reasons.push('스트레스를 날릴 수 있게 청량감을 살렸어요.');
  else if (has(moods, '우울')) reasons.push('기분 전환이 되도록 밝고 달콤한 맛을 중심으로 골랐어요.');
  else if (has(moods, '행복', '신남')) reasons.push('좋은 기분을 이어갈 수 있게 경쾌한 맛으로 만들었어요.');
  else if (has(moods, '차분', '나른')) reasons.push('편안한 분위기에 어울리게 자극이 적은 부드러운 맛으로 맞췄어요.');
  else if (has(moods, '설렘')) reasons.push('설레는 날에 어울리는 달콤한 맛을 담았어요.');
  else reasons.push('입력하신 취향에 가장 잘 맞는 재료 조합을 골랐어요.');
  const tasteBits: string[] = [];
  if (T.sour >= 3) tasteBits.push('상큼함');
  if (T.sweet >= 3) tasteBits.push('단맛');
  if (T.fizzy >= 3) tasteBits.push('탄산감');
  if (T.bitter >= 3) tasteBits.push('쌉싸름함');
  if (tasteBits.length) reasons.push(`원하신 ${tasteBits.join('·')}을 살리도록 ${mainWord} 비율을 높였어요.`);
  if (u.weather) {
    const t = typeof temp === 'number' ? `${Math.round(temp)}°C` : '';
    if (hot) reasons.push(`오늘은 ${t || '날씨가'} 더워서 시원하게 마시기 좋도록 했어요.`);
    else if (cold) reasons.push(`오늘은 ${t || '날씨가'} 쌀쌀해서 탄산을 조금 줄였어요.`);
    else if (cond) reasons.push(`${cond}${t ? ` ${t}` : ''} 날씨에 가볍게 즐기기 좋은 한 잔이에요.`);
  }

  // ── 제안 (add_ingredient: 미보유 재료 추가 장착 유도) ──
  const suggestions: Suggestion[] = [];
  const profiles = pool.map((i) => profileOf(i.name, i.category).profile);
  const maxOf = (key: keyof FlavorProfile) => Math.max(0, ...profiles.map((p) => p[key]));
  if (u.strength !== 'none' && !pool.some((i) => i.abv > 0)) {
    // 무알콜로 만든 이유는 항상 info 로 (백엔드 fallback 과 같음). add_ingredient 로 넣으면 술이 장착돼 있지만 못 쓰는 경우
    // (잔량 0·성향 제외) '이미 장착된 재료' 규칙으로 안내째 지워졌음.
    // 술 장착 권유 문장은 성인 확인 뒤에만 (SPEC §3.2 — 성인 확인 전에는 규칙기반 문구도 술 장착을 권하지 않음)
    suggestions.push({ type: 'info', message: u.adultVerified === true ? OFFLINE_NO_ALCOHOL_INFO_ADULT : OFFLINE_NO_ALCOHOL_INFO });
  }
  if (T.sour >= 3 && maxOf('sour') < 4) {
    suggestions.push({ type: 'add_ingredient', ingredient: '레몬즙', message: '레몬즙을 장착하면 더 상큼한 맛을 낼 수 있어요.' });
  } else if (T.fizzy >= 3 && maxOf('fizzy') < 4) {
    suggestions.push({ type: 'add_ingredient', ingredient: '탄산수', message: '탄산수를 장착하면 청량감을 더할 수 있어요.' });
  } else if (T.bitter >= 3 && maxOf('bitter') < 3) {
    suggestions.push({
      type: 'add_ingredient',
      ingredient: '토닉워터',
      message: "토닉워터를 장착하면 쌉싸름한 '토닉 스타일'도 만들 수 있어요.",
    });
  } else if (T.sweet >= 4 && maxOf('sweet') < 5) {
    suggestions.push({ type: 'add_ingredient', ingredient: '설탕시럽', message: '시럽을 장착하면 단맛을 더 세밀하게 조절할 수 있어요.' });
  }

  return {
    name,
    description,
    reason: reasons.slice(0, 3).join(' '),
    ingredients: parts.map((p) => ({ pump: p.s.info.pump, name: p.s.info.name, ml: Math.round(p.ml * 10) / 10 })),
    totalMl: cup,
    estimatedAbv: 0,
    flavor,
    garnish: hot ? '얼음 가득 + 레몬 슬라이스 (선택)' : cold ? '얼음 조금 (선택)' : '얼음 + 민트 잎 (선택)',
    tips: '잔에 얼음을 먼저 채우고 제조를 시작하세요.' + (parts.some((p) => p.s.info.category === 'soda') ? ' 탄산은 마지막에 나오도록 순서를 정했어요.' : ''),
    suggestions,
  };
}
