'use strict';
/**
 * 스마트 바텐더 v2.1 — 요청 검증(SPEC §3.1) + 레시피 검증·보정(SPEC §3.3 규칙 1~9)
 *
 * 순수 함수만 사용(Node 전용 API 없음). 앱(React Native)에도 같은 규칙이 구현되므로
 * 함수 이름·규칙은 README "검증·보정 규칙" 절과 1:1 로 맞춰 두었습니다.
 *
 *   validateRecipeRequest(body)                    → { ok, value | status, error }
 *   sanitizeIngredients(list, {allowEmpty})        → { ok, ingredients | error }
 *   normalizeRecipe(raw, ingredients, {cupMl, strength, excludePumps, adultVerified}) → SPEC §3.3 규칙 1~7 (+9 의 1차 계산)
 *   capStrength(recipe, ingredients, strength, excludePumps) → SPEC §3.3 규칙 8 (도수 상한) + 규칙 9 재계산
 *   finalizeRecipe(raw, ingredients, opts)         → normalizeRecipe → capStrength (서버가 쓰는 파이프라인)
 *   sanitizeSuggestions(list, ingredients, byPump, strength, adultVerified) → 제안 정리 (SPEC §3.2)
 *   isAlcoholSuggestion(s, ingredients, byPump)    → 술 장착·대체 제안인지 (무알콜·성인 확인 전이면 지움)
 *   lacksMixer(ingredients, strength, excludePumps) → 도수 상한을 맞출 재료가 아예 없는지 (AI 호출 전 검사)
 *
 * excludePumps: 성향(알레르기·싫어하는 재료)으로 뺄 펌프 번호 Set — fallback.preferenceExcludedPumps() 로 계산.
 *   규칙 1 에서 그 펌프를 빼고, 규칙 8 에서 섞을 무알콜 재료로도 고르지 않음.
 * adultVerified: user.adultVerified (=== true 일 때만 성인 확인). 아니면(생략 포함) suggestions 에서 술 장착·대체 제안 제거(SPEC §3.2).
 */

const { estimateFlavor, abvToStrengthLevel, clampInt, TASTE_KEYS } = require('./flavor');
const { looksAlcoholic } = require('./alcohol');

const CATEGORIES = ['spirit', 'liqueur', 'wine', 'syrup', 'juice', 'soda', 'dairy', 'water', 'other'];
const CATEGORY_KO = {
  spirit: '증류주', liqueur: '리큐르', wine: '발효주', syrup: '시럽', juice: '주스',
  soda: '탄산', dairy: '유제품', water: '물', other: '기타',
};
const STRENGTHS = ['none', 'light', 'medium', 'strong'];
const STRENGTH_KO = { none: '무알콜', light: '약하게', medium: '적당히', strong: '강하게' };
/** 도수 목표 범위(%) — max 는 capStrength 의 상한, target 은 규칙기반 추천의 목표값 */
const STRENGTH_ABV = {
  none: { min: 0, max: 0, target: 0 },
  light: { min: 1, max: 5, target: 4 },
  medium: { min: 5, max: 12, target: 9 },
  strong: { min: 12, max: 20, target: 16 },
};
const SUGGESTION_TYPES = ['add_ingredient', 'substitute', 'low_stock', 'info'];
/** 요청 모드 (SPEC §3.1, §5.4) — 생략 시 normal */
const MODES = ['normal', 'explore'];
const CUP = { MIN: 30, MAX: 500, DEFAULT: 200 };
const MAX_PUMPS = 8;
const MAX_SUGGESTIONS = 5;
/** SPEC §3.3 규칙 6: 재료(펌프)당 최대 ml (펌웨어 maxStepMl 과 같음) */
const MAX_STEP_ML = 300;
/** SPEC §3.1: history 는 최근 10개까지 */
const MAX_HISTORY = 10;

// ───────────────────────── 공통 유틸 ─────────────────────────

/** 소수 1자리 반올림 */
function round1(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 10) / 10;
}

/** 숫자 또는 숫자 문자열 → number, 그 외 NaN */
function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/** 문자열 정리: 제어문자 제거, 앞뒤 공백 제거, 최대 길이 */
function cleanText(v, max = 200) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

/** 재료 이름 비교용 정규화(대소문자·공백·기호 무시) */
function normName(s) {
  return String(s || '').toLowerCase().replace(/[\s_\-·.,()[\]'"]/g, '');
}

/** 한국어 조사만 고르기: particle('사이다','이','가') → '가' (한글이 아니면 '이(가)') */
function particle(word, withBatchim, withoutBatchim) {
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
function josa(word, withBatchim, withoutBatchim) {
  return String(word || '') + particle(word, withBatchim, withoutBatchim);
}

function bad(error, status = 400) {
  return { ok: false, status, error };
}

/** excludePumps 옵션 → Set (Set·배열·없음 모두 허용) */
function toPumpSet(v) {
  if (v instanceof Set) return v;
  return new Set(Array.isArray(v) ? v : []);
}

// ───────────────────────── 요청 검증 (SPEC §3.1) ─────────────────────────

/**
 * 장착 재료 목록 검증. 이름이 빈 슬롯은 건너뜀. 펌프 번호 1~8, 중복 불가.
 * remainingMl 이 없거나 숫자가 아니면 null(= 잔량 모름, 제한 없음).
 * allowEmpty: true 이면 재료 0개도 허용(탐색 모드 — 빈 기기에서도 동작, SPEC §5.4)
 */
function sanitizeIngredients(list, { allowEmpty = false } = {}) {
  if (allowEmpty && list == null) return { ok: true, ingredients: [] };
  if (!Array.isArray(list)) return { ok: false, error: 'ingredients 는 배열이어야 합니다. (장착된 재료 목록)' };
  const out = [];
  const seen = new Set();
  for (const raw of list.slice(0, 16)) {
    if (!raw || typeof raw !== 'object') continue;
    const name = cleanText(raw.name, 40);
    if (!name) continue; // 비어 있는 펌프 슬롯
    const pump = toNum(raw.pump);
    if (!Number.isInteger(pump) || pump < 1 || pump > MAX_PUMPS) {
      return { ok: false, error: `'${name}' 의 펌프 번호가 올바르지 않습니다. (1~${MAX_PUMPS} 정수)` };
    }
    if (seen.has(pump)) return { ok: false, error: `펌프 ${pump}번에 재료가 두 번 등록되었습니다.` };
    seen.add(pump);
    let abv = toNum(raw.abv);
    abv = Number.isFinite(abv) ? round1(Math.min(100, Math.max(0, abv))) : 0;
    let category = typeof raw.category === 'string' ? raw.category.trim().toLowerCase() : '';
    if (!CATEGORIES.includes(category)) category = abv >= 20 ? 'spirit' : abv > 0 ? 'wine' : 'other';
    const rem = toNum(raw.remainingMl);
    const remainingMl = Number.isFinite(rem) ? round1(Math.max(0, rem)) : null;
    out.push({ pump, name, category, abv, remainingMl, notes: cleanText(raw.notes, 100) });
  }
  if (!out.length && !allowEmpty) {
    return { ok: false, error: '장착된 재료가 없습니다. 앱의 재료 관리에서 펌프에 재료를 1개 이상 등록해 주세요.' };
  }
  out.sort((a, b) => a.pump - b.pump);
  return { ok: true, ingredients: out };
}

function sanitizeTaste(t) {
  const out = {};
  const src = t && typeof t === 'object' && !Array.isArray(t) ? t : {};
  for (const k of TASTE_KEYS) {
    const v = toNum(src[k]);
    out[k] = Number.isFinite(v) ? clampInt(v, 0, 5) : null; // null = 상관없음
  }
  return out;
}

function sanitizeMoods(m) {
  const arr = Array.isArray(m) ? m : typeof m === 'string' ? m.split(/[,，、]/) : [];
  const out = [];
  for (const x of arr) {
    const s = cleanText(typeof x === 'string' ? x : '', 20);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

function sanitizeWeather(w) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
  const condition = cleanText(w.condition, 30) || null;
  const t = toNum(w.tempC);
  const h = toNum(w.humidity);
  const tempC = Number.isFinite(t) && t >= -50 && t <= 60 ? round1(t) : null;
  const humidity = Number.isFinite(h) && h >= 0 && h <= 100 ? Math.round(h) : null;
  if (condition === null && tempC === null && humidity === null) return null;
  return { condition, tempC, humidity };
}

/**
 * 이전 기록 정리. 앱은 최근 기록부터(최신 → 오래된 순) 보내므로 **앞에서 10개**만 사용 (SPEC §3.1 "최근 10개").
 * rejected:true = 레시피 화면에서 "다른 추천"으로 거절한 레시피 (SPEC §5.3) → liked 가 없으면 false 로 간주.
 */
function sanitizeHistory(h) {
  if (!Array.isArray(h)) return [];
  const out = [];
  for (const x of h) {
    if (out.length >= MAX_HISTORY) break;
    if (!x || typeof x !== 'object') continue;
    const name = cleanText(x.name, 40);
    const rejected = x.rejected === true || x.rejected === 'true';
    let liked = x.liked === true || x.liked === 'true' ? true : x.liked === false || x.liked === 'false' ? false : null;
    if (rejected && liked == null) liked = false;
    const ingredients = [];
    if (Array.isArray(x.ingredients)) {
      for (const i of x.ingredients.slice(0, 8)) {
        if (!i || typeof i !== 'object') continue;
        const n = cleanText(i.name, 40);
        const ml = toNum(i.ml);
        if (n) ingredients.push({ name: n, ml: Number.isFinite(ml) && ml > 0 ? round1(ml) : null });
      }
    }
    if (name || ingredients.length) out.push({ name: name || '이름 없음', liked, rejected, ingredients });
  }
  return out;
}

/** mode 검증: 생략/빈 값 → normal, 그 외 normal|explore 가 아니면 null(→ 400) */
function parseMode(v) {
  if (v == null || v === '') return 'normal';
  if (typeof v !== 'string') return null;
  const m = v.trim().toLowerCase();
  return MODES.includes(m) ? m : null;
}

/**
 * POST version:2 요청 검증.
 * 필수: version=2, ingredients(이름 있는 재료 1개 이상 — 단 mode:"explore" 는 0개·생략 허용).
 * user 는 생략 가능(기본값 사용). strength 생략 시 'none'(무알콜, 가장 안전한 기본값).
 * cupMl 생략 시 200, 허용 30~500. mode 생략 시 'normal', normal|explore 외의 값은 400.
 * adultVerified 는 === true 일 때만 true(그 외·생략·잘못된 타입은 false, 400 아님) → false 면 탐색 제안(SPEC §5.4)과
 * 레시피 suggestions(SPEC §3.2)에서 술 장착·대체 제안 제외.
 */
function validateRecipeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('요청 본문은 JSON 객체여야 합니다.');
  if (Number(body.version) !== 2) return bad('지원하지 않는 요청 버전입니다. version: 2 로 보내 주세요.');
  const mode = parseMode(body.mode);
  if (!mode) return bad('mode 는 "normal"(기본) 또는 "explore"(탐색) 중 하나여야 합니다.');
  if (body.user != null && (typeof body.user !== 'object' || Array.isArray(body.user))) return bad('user 는 객체여야 합니다.');
  const u = body.user || {};

  let strength = 'none';
  if (u.strength != null && u.strength !== '') {
    strength = String(u.strength).trim().toLowerCase();
    if (!STRENGTHS.includes(strength)) return bad('strength 는 none, light, medium, strong 중 하나여야 합니다.');
  }

  let cupMl = CUP.DEFAULT;
  if (u.cupMl != null && u.cupMl !== '') {
    const c = toNum(u.cupMl);
    if (!Number.isFinite(c) || c < CUP.MIN || c > CUP.MAX) return bad(`cupMl(잔 용량)은 ${CUP.MIN}~${CUP.MAX} 사이 숫자여야 합니다.`);
    cupMl = round1(c);
  }

  const ing = sanitizeIngredients(body.ingredients, { allowEmpty: mode === 'explore' });
  if (!ing.ok) return bad(ing.error);

  return {
    ok: true,
    value: {
      mode,
      user: {
        moods: sanitizeMoods(u.moods),
        taste: sanitizeTaste(u.taste),
        strength,
        weather: sanitizeWeather(u.weather),
        situation: cleanText(u.situation, 40),
        preference: cleanText(u.preference, 300),
        cupMl,
        // 만 19세 이상 확인 여부 (SPEC §3.1): 정확히 true 일 때만 true. 생략·문자열 "true"·1 등은 false (400 아님)
        adultVerified: u.adultVerified === true,
      },
      ingredients: ing.ingredients,
      history: sanitizeHistory(body.history),
    },
  };
}

/**
 * 이번 요청에서 실제로 쓸 수 있는 재료 (잔량>0, 무알콜이면 abv=0 만,
 * excludePumps 를 주면 성향으로 뺀 재료도 제외)
 */
function usableIngredients(ingredients, strength, excludePumps) {
  const ex = toPumpSet(excludePumps);
  return ingredients.filter(
    (i) => (i.remainingMl == null || i.remainingMl > 0) && (strength !== 'none' || i.abv === 0) && !ex.has(i.pump)
  );
}

/** SPEC §3.3-8: 섞을 무알콜 재료가 없어 도수 상한을 맞출 수 없을 때의 안내 */
function noMixerMessage(strength) {
  const range = STRENGTH_ABV[strength];
  const label = STRENGTH_KO[strength] || strength;
  return `섞을 무알콜 재료가 없어 '${label}'(최대 ${range ? range.max : 0}%)로 만들 수 없어요. 탄산수·주스 같은 무알콜 재료를 장착하거나 도수를 바꿔 주세요.`;
}

/**
 * 도수 상한을 맞출 재료가 아예 없는지 (AI 를 부르기 전 검사 — SPEC §3.3-8 '섞을 무알콜 재료가 없을 때').
 * strength ≠ none 이고, 쓸 수 있는 재료(잔량>0, 성향 제외 아님)가 1개 이상인데 전부 상한보다 독한 술이면 true.
 * (무알콜 재료나 상한 이하의 술이 하나라도 있으면 false → 레시피 보정 단계에서 다시 판단)
 */
function lacksMixer(ingredients, strength, excludePumps) {
  const range = STRENGTH_ABV[strength];
  if (!range || strength === 'none') return false;
  const usable = usableIngredients(ingredients, strength, excludePumps);
  return usable.length > 0 && usable.every((i) => i.abv > range.max);
}

// ───────────────────────── 레시피 보정 (SPEC §3.3) ─────────────────────────

/** AI 가 준 재료 항목 → 장착 재료 매칭. 이름이 정확히 일치하면 이름 우선, 아니면 펌프 번호. */
function matchIngredient(item, ingredients, byPump) {
  const pump = toNum(item.pump);
  const key = normName(item.name);
  if (key) {
    const sameName = ingredients.filter((i) => normName(i.name) === key);
    if (sameName.length === 1) return sameName[0];
    if (sameName.length > 1) return sameName.find((i) => i.pump === pump) || sameName[0];
  }
  if (Number.isInteger(pump) && byPump.has(pump)) return byPump.get(pump);
  return null;
}

/** 합계를 total 에 맞게 비례 보정 + 반올림 오차는 가장 많은 재료에서 흡수 */
function scaleToTotal(items, total) {
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

function computeAbv(items, byPump) {
  let total = 0;
  let alc = 0;
  for (const it of items) {
    const ing = byPump.get(it.pump);
    total += it.ml;
    alc += it.ml * (ing ? ing.abv : 0);
  }
  return total > 0 ? round1(alc / total) : 0;
}

function sumMl(items) {
  return round1(items.reduce((s, i) => s + i.ml, 0));
}

/**
 * 술 장착·대체 제안 판정 (SPEC §3.2) — 정리된 제안 { type, message, ingredient?, pump? } 하나에 대해:
 * type 이 add_ingredient/substitute 이고
 *   (a) ingredient 가 술 이름(lib/alcohol.js looksAlcoholic)이거나 장착된 술(abv>0) 재료와 normName 이 같거나
 *   (b) pump 가 장착된 술(abv>0) 펌프이거나
 *   (c) message 에 술 이름(looksAlcoholic)이 들어 있으면 true.
 * byPump: 장착 재료 Map(pump → 재료). sanitizeSuggestions 가 strength=none 또는 성인 확인 전일 때 이 판정으로 지움.
 */
function isAlcoholSuggestion(s, ingredients, byPump) {
  if (!s || (s.type !== 'add_ingredient' && s.type !== 'substitute')) return false;
  const ingName = s.ingredient || '';
  const key = normName(ingName);
  const alcIng = !!ingName && (looksAlcoholic(ingName) || ingredients.some((i) => i.abv > 0 && normName(i.name) === key));
  const p = s.pump != null ? byPump.get(s.pump) : null;
  const alcPump = !!p && p.abv > 0;
  return alcIng || alcPump || looksAlcoholic(s.message);
}

/**
 * 술 장착·대체 제안을 지워야 하는지 (SPEC §3.2): 무알콜(strength=none)이거나 성인 확인 전(adultVerified !== true)
 */
function blocksAlcoholSuggestions(strength, adultVerified) {
  return strength === 'none' || adultVerified !== true;
}

/**
 * AI·규칙기반 suggestions 정리 (SPEC §3.2).
 * strength='none'(무알콜)이거나 adultVerified 가 true 가 아니면(성인 확인 전, 생략 포함) 술을 장착·대체하라는
 * add_ingredient/substitute 제안은 제거 — 판정은 isAlcoholSuggestion (재료 이름이 술이거나 장착된 술이거나, 문구에 술 이름).
 */
function sanitizeSuggestions(list, ingredients, byPump, strength, adultVerified = false) {
  const out = [];
  if (!Array.isArray(list)) return out;
  const noAlcohol = blocksAlcoholSuggestions(strength, adultVerified);
  const installedNames = new Set(ingredients.map((i) => normName(i.name)));
  for (const s of list.slice(0, 8)) {
    if (!s || typeof s !== 'object') continue;
    const message = cleanText(s.message, 200);
    if (!message) continue;
    const type = SUGGESTION_TYPES.includes(s.type) ? s.type : 'info';
    const o = { type, message };
    const ingName = cleanText(s.ingredient, 40);
    if (ingName) o.ingredient = ingName;
    const pump = toNum(s.pump);
    if (Number.isInteger(pump) && byPump.has(pump)) o.pump = pump;
    // 무알콜 요청·성인 확인 전에는 술 권유 X
    if (noAlcohol && isAlcoholSuggestion(o, ingredients, byPump)) continue;
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

function mergeSuggestions(ruleBased, fromAi) {
  const covered = new Set(ruleBased.filter((s) => s.type === 'low_stock').map((s) => s.pump));
  const merged = [...ruleBased];
  for (const s of fromAi) {
    if (s.type === 'low_stock' && covered.has(s.pump)) continue;
    if (merged.some((m) => m.message === s.message)) continue;
    merged.push(s);
  }
  return merged.slice(0, MAX_SUGGESTIONS);
}

function sanitizeFlavor(raw, items, byPump, abv) {
  const est = estimateFlavor(items, byPump);
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  const out = {};
  for (const k of TASTE_KEYS) {
    const v = src ? toNum(src[k]) : NaN;
    out[k] = Number.isFinite(v) ? clampInt(v, 0, 5) : est[k];
  }
  out.strength = abvToStrengthLevel(abv); // 도수 체감은 항상 실제 도수로 다시 계산
  return out;
}

function clampCup(v) {
  const c = toNum(v);
  if (!Number.isFinite(c)) return CUP.DEFAULT;
  return round1(Math.min(CUP.MAX, Math.max(CUP.MIN, c)));
}

/**
 * SPEC §3.3 레시피 검증·보정 (백엔드·앱 공통 규칙) — 이 함수는 규칙 1~7 과 9(1차 계산)를 담당.
 *  1. 장착되지 않은 펌프/재료 제거(이름 일치 우선 → 펌프 번호), 같은 펌프 중복은 합산(합산 전 음수는 0)
 *     + opts.excludePumps(성향의 알레르기·싫어하는 재료) 펌프도 제거
 *  2. strength=none → abv>0 재료 제거
 *  3. ml<0 → 0(항목별로 먼저 적용 후 합산), 소수 1자리 반올림, 0ml 재료 제거
 *  4. 총량을 cupMl 에 맞게 비례 보정(반올림 오차는 가장 많은 재료에 반영)
 *  5. remainingMl 초과 → 잔량까지만 사용(소수 1자리 내림) + low_stock 제안 (totalMl < cupMl 가능)
 *  6. 재료당 최대 300ml(펌웨어 maxStepMl) — 초과분은 300 으로 자름 (totalMl < cupMl 가능)
 *  7. 남은 재료가 없으면 오류 { ok:false, code:'EMPTY_RECIPE' }
 *  8. (capStrength 에서) 도수 상한
 *  9. estimatedAbv = Σ(ml×abv)/총ml 재계산(소수 1자리), flavor.strength = 도수 → 0~5
 * suggestions: 무알콜이거나 opts.adultVerified !== true 이면 술 장착·대체 제안 제거(SPEC §3.2, sanitizeSuggestions)
 * 반환: { ok:true, recipe, adjustments:[한국어 설명] } | { ok:false, code, error, adjustments }
 */
function normalizeRecipe(raw, ingredients, opts = {}) {
  const cupMl = clampCup(opts.cupMl);
  const strength = STRENGTHS.includes(opts.strength) ? opts.strength : 'none';
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const byPump = new Map(ingredients.map((i) => [i.pump, i]));
  const excludePumps = toPumpSet(opts.excludePumps);
  const adjustments = [];

  // 1 + 3(음수 → 0): 매칭 & 합산 (처음 등장한 순서 = 붓는 순서 유지)
  const merged = new Map();
  const prefNoted = new Set();
  for (const it of Array.isArray(r.ingredients) ? r.ingredients.slice(0, 20) : []) {
    if (!it || typeof it !== 'object') continue;
    const ing = matchIngredient(it, ingredients, byPump);
    if (!ing) {
      const label = cleanText(it.name, 30) || `펌프 ${cleanText(String(it.pump ?? '?'), 5)}번`;
      adjustments.push(`장착되지 않은 재료 '${label}'${particle(label, '은', '는')} 제외했어요.`);
      continue;
    }
    if (excludePumps.has(ing.pump)) {
      // 성향(알레르기·싫어하는 재료)에 적힌 재료 — AI 가 넣었더라도 뺌
      if (!prefNoted.has(ing.pump)) adjustments.push(`성향에 적힌 대로 '${ing.name}'${particle(ing.name, '은', '는')} 뺐어요.`);
      prefNoted.add(ing.pump);
      continue;
    }
    let ml = toNum(it.ml);
    if (!Number.isFinite(ml) || ml < 0) ml = 0;
    if (merged.has(ing.pump)) adjustments.push(`'${ing.name}'${particle(ing.name, '이', '가')} 여러 번 나와 양을 합쳤어요.`);
    merged.set(ing.pump, (merged.get(ing.pump) || 0) + ml);
  }

  // 2 + 3
  let items = [];
  for (const [pump, ml] of merged) {
    const ing = byPump.get(pump);
    if (strength === 'none' && ing.abv > 0) {
      adjustments.push(`무알콜 선택이라 '${ing.name}'(도수 ${ing.abv}%)${particle(ing.name, '은', '는')} 뺐어요.`);
      continue;
    }
    const v = round1(ml);
    if (v <= 0) continue;
    items.push({ pump, name: ing.name, ml: v });
  }
  if (!items.length) {
    return { ok: false, code: 'EMPTY_RECIPE', error: '레시피에 사용할 수 있는 재료가 없습니다.', adjustments };
  }

  // 4
  const before = sumMl(items);
  items = scaleToTotal(items, cupMl);
  if (Math.abs(before - cupMl) >= 0.5) adjustments.push(`총량을 ${before}ml → ${cupMl}ml 로 맞췄어요.`);

  // 5
  const ruleSuggestions = [];
  for (const it of items) {
    const ing = byPump.get(it.pump);
    if (ing.remainingMl != null && it.ml > ing.remainingMl) {
      const want = it.ml;
      it.ml = Math.floor(ing.remainingMl * 10 + 1e-9) / 10;
      ruleSuggestions.push({
        type: 'low_stock',
        pump: ing.pump,
        ingredient: ing.name,
        message:
          it.ml > 0
            ? `${josa(ing.name, '이', '가')} ${ing.remainingMl}ml 밖에 없어 ${it.ml}ml만 사용해요(필요 ${want}ml). 펌프 ${ing.pump}번 용기를 보충해 주세요.`
            : `${josa(ing.name, '이', '가')} 다 떨어졌어요. 펌프 ${ing.pump}번 용기를 보충해 주세요.`,
      });
      adjustments.push(`'${ing.name}' 잔량이 부족해 ${want}ml → ${it.ml}ml 로 줄였어요.`);
    }
  }

  // 6
  for (const it of items) {
    if (it.ml > MAX_STEP_ML) {
      adjustments.push(`'${it.name}'${particle(it.name, '은', '는')} 한 번에 최대 ${MAX_STEP_ML}ml 까지라 ${it.ml}ml → ${MAX_STEP_ML}ml 로 줄였어요.`);
      it.ml = MAX_STEP_ML;
    }
  }
  items = items.filter((i) => i.ml > 0);

  // 7
  if (!items.length) {
    return { ok: false, code: 'EMPTY_RECIPE', error: '재료 잔량이 부족해 만들 수 있는 재료가 없습니다.', adjustments };
  }

  // 9 (capStrength 가 양을 바꾸면 그곳에서 다시 계산)
  const totalMl = sumMl(items);
  const estimatedAbv = computeAbv(items, byPump);

  const recipe = {
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
    suggestions: mergeSuggestions(ruleSuggestions, sanitizeSuggestions(r.suggestions, ingredients, byPump, strength, opts.adultVerified === true)),
  };
  return { ok: true, recipe, adjustments };
}

/** 도수를 낮출 때 새로 섞을 무알콜 재료 고르기 (탄산 > 주스 > 물 > 기타 > 유제품 > 시럽) */
function pickMixer(ingredients, exclude) {
  const order = { soda: 0, juice: 1, water: 2, other: 3, dairy: 4, syrup: 5 };
  const cands = ingredients.filter(
    (i) => i.abv === 0 && !exclude.has(i.pump) && (i.remainingMl == null || i.remainingMl >= 10) && i.category in order
  );
  cands.sort((a, b) => order[a.category] - order[b.category] || (b.remainingMl ?? 1e9) - (a.remainingMl ?? 1e9));
  return cands[0] || null;
}

/**
 * SPEC §3.3 규칙 8 (capStrength) — 선택한 도수 단계의 상한을 넘으면 술을 줄이고 무알콜 재료를 늘림.
 * light ≤5%, medium ≤12%, strong ≤20%. 총량은 유지, 무알콜 재료는 잔량·재료당 300ml(규칙 6)를 넘지 않게
 * (넘으면 총량이 줄어드는 대신 술을 더 줄여 상한 유지).
 * 레시피에 무알콜 재료가 없으면 장착된 무알콜 재료(탄산>주스>물…, 잔량 10ml 이상, excludePumps 제외)를 하나 추가.
 * 섞을 무알콜 재료가 하나도 없으면 상한을 지킬 수 없으므로 실패 { ok:false, code:'NO_MIXER', error }
 * (규칙 4 가 술만 든 레시피를 cupMl 까지 늘려 놓았으므로 '그대로 두기'는 독한 술 수백 ml 가 됨).
 * 반올림 뒤 나머지는 정리해 합계가 보정 전 총량을 넘지 않게 함(cup 500 → 500.1 이면 펌웨어가 LIMIT 으로 거절).
 * 양을 바꿨다면 규칙 9(estimatedAbv·flavor.strength)를 다시 계산.
 * 반환: { ok:true, recipe, adjustments } | { ok:false, code, error, adjustments }
 */
function capStrength(recipe, ingredients, strength, excludePumps) {
  const range = STRENGTH_ABV[strength];
  const adjustments = [];
  if (!range || strength === 'none' || recipe.estimatedAbv <= range.max + 0.05) return { ok: true, recipe, adjustments };
  const byPump = new Map(ingredients.map((i) => [i.pump, i]));
  const items = recipe.ingredients.map((i) => ({ ...i }));
  const abvOf = (it) => (byPump.get(it.pump) || { abv: 0 }).abv;
  const limitOf = (it) => {
    const rem = (byPump.get(it.pump) || {}).remainingMl;
    return rem != null ? Math.min(rem, MAX_STEP_ML) : MAX_STEP_ML;
  };
  const total = sumMl(items);
  const target = Math.max(0, range.max - 0.2) / 100; // 반올림 여유

  let mix = items.filter((i) => abvOf(i) === 0);
  if (!mix.length) {
    const m = pickMixer(ingredients, new Set([...items.map((i) => i.pump), ...toPumpSet(excludePumps)]));
    if (m) {
      const added = { pump: m.pump, name: m.name, ml: 0 };
      items.push(added); // 무알콜 재료는 마지막에(탄산 손실 방지)
      mix = [added];
    }
  }
  const before = recipe.estimatedAbv;
  if (!mix.length) {
    return { ok: false, code: 'NO_MIXER', error: noMixerMessage(strength), adjustments };
  }
  const alcItems = items.filter((i) => abvOf(i) > 0);
  const alcoholMl = alcItems.reduce((s, i) => s + (i.ml * abvOf(i)) / 100, 0);
  const k = Math.min(1, (target * total) / alcoholMl);
  const freed = alcItems.reduce((s, i) => s + i.ml * (1 - k), 0);
  for (const i of alcItems) i.ml *= k;
  const mixSum = mix.reduce((s, i) => s + i.ml, 0);
  for (const i of mix) i.ml += mixSum > 0 ? freed * (i.ml / mixSum) : freed / mix.length;
  // 무알콜 재료 잔량·300ml(규칙 6) 제한 → 넘으면 총량이 줄어드는 대신 술을 더 줄여 상한 유지
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
    return { ok: false, code: 'EMPTY_RECIPE', error: '도수를 맞추고 나니 사용할 수 있는 재료가 없습니다.', adjustments };
  }
  // 반올림 나머지 정리 (규칙 4 와 같은 취지): 합계 = 보정 뒤 양(≤ 보정 전 총량).
  // 도수가 오르지 않는 쪽으로만 맞춤 — 남으면 가장 많은 술에서 빼고, 모자라면 가장 많은 무알콜 재료에 더함(잔량·300ml 이내)
  const want = Math.min(total, round1(items.reduce((s, i) => s + i.ml, 0)));
  const residual = round1(want - sumMl(out));
  if (residual !== 0) {
    const biggest = (list) => list.reduce((a, b) => (a && a.ml >= b.ml ? a : b), null);
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
    `'${STRENGTH_KO[strength]}'(최대 ${range.max}%)에 맞추려고 술을 줄이고 ${mixNames} 양을 늘렸어요. (${before}% → ${estimatedAbv}%)`
  );
  const flavor = { ...estimateFlavor(out, byPump), ...pickTaste(recipe.flavor), strength: abvToStrengthLevel(estimatedAbv) };
  return { ok: true, recipe: { ...recipe, ingredients: out, totalMl, estimatedAbv, flavor }, adjustments };
}

function pickTaste(f) {
  const o = {};
  if (f) for (const k of TASTE_KEYS) if (Number.isFinite(f[k])) o[k] = f[k];
  return o;
}

/**
 * 백엔드 최종 파이프라인: SPEC §3.3 규칙 1~7 (normalizeRecipe) → 규칙 8·9 (capStrength)
 * opts: { cupMl, strength, excludePumps, adultVerified }  (adultVerified 생략 = 성인 확인 전 → 술 장착·대체 제안 제거)
 * 반환: { ok:true, recipe, adjustments } | { ok:false, code('EMPTY_RECIPE'|'NO_MIXER'), error, adjustments }
 */
function finalizeRecipe(raw, ingredients, opts = {}) {
  const n = normalizeRecipe(raw, ingredients, opts);
  if (!n.ok) return n;
  const strength = STRENGTHS.includes(opts.strength) ? opts.strength : 'none';
  const c = capStrength(n.recipe, ingredients, strength, opts.excludePumps);
  const adjustments = [...n.adjustments, ...c.adjustments];
  if (!c.ok) return { ok: false, code: c.code, error: c.error, adjustments };
  return { ok: true, recipe: c.recipe, adjustments };
}

module.exports = {
  // 상수
  CATEGORIES,
  CATEGORY_KO,
  STRENGTHS,
  STRENGTH_KO,
  STRENGTH_ABV,
  SUGGESTION_TYPES,
  MODES,
  CUP,
  MAX_PUMPS,
  MAX_STEP_ML,
  MAX_HISTORY,
  // 요청 검증
  validateRecipeRequest,
  sanitizeIngredients,
  sanitizeHistory,
  parseMode,
  usableIngredients,
  lacksMixer,
  noMixerMessage,
  // 레시피 보정
  normalizeRecipe,
  capStrength,
  finalizeRecipe,
  sanitizeSuggestions,
  isAlcoholSuggestion,
  blocksAlcoholSuggestions,
  computeAbv,
  scaleToTotal,
  sumMl,
  matchIngredient,
  // 유틸
  round1,
  toNum,
  cleanText,
  normName,
  josa,
  particle,
};
