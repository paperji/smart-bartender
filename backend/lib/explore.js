'use strict';
/**
 * 탐색(explore) 제안 검증·보정 — SPEC §5.4
 * "지금은 없지만 재료 하나(최대 둘)만 더 장착하면 만들 수 있는 레시피" 카드 목록을 정리합니다.
 * AI 응답과 규칙기반(fallback) 결과 모두 이 함수를 거칩니다.
 *
 * 순수 함수만 사용(Node 전용 API 없음) → 앱에도 그대로 옮겨 쓸 수 있습니다.
 *
 *   normalizeExplore(list, ingredients, {cupMl, strength, mode, adultVerified, excludePumps, excludeName})
 *     → { items, notes, removedAdult, removedNoMixer }
 *   addsSoftIngredient(card)       → 카드가 무알콜 재료를 새로 더하는지 (SPEC §3.3 규칙 8 NO_MIXER 판정)
 *   filterNoMixerExplore(items)    → { items, removed } NO_MIXER 일 때 무알콜 재료를 새로 더하는 카드만 남김
 *
 * 항목 모양 (SPEC §5.4):
 *   { addIngredient, category, abv, recipeName, description,
 *     ingredients: [ {name, ml, installed:true, pump} | {name, ml, installed:false} ], message }
 */

const {
  CATEGORIES, STRENGTHS, STRENGTH_ABV, CUP, MAX_STEP_ML,
  round1, toNum, cleanText, scaleToTotal, particle, josa, normName,
} = require('./recipe');
const { looksAlcoholic, ALCOHOL_CATEGORIES } = require('./alcohol');

/** 모드별 최대 개수: explore 1~3개, normal 0~1개 */
const EXPLORE_MAX = { explore: 3, normal: 1 };
/** 한 항목의 재료 줄 수 상한 / 미장착 재료 상한 */
const MAX_LINES = 5;
const MAX_UNINSTALLED = 2;

/**
 * installed·pump 판정·중복 제거·거절 조합 비교용 이름 키 = SPEC §3.1 공통 normName
 * (소문자화 + 공백과 기호 _ - · . , ( ) [ ] ' " 제거). 규칙 1 매칭(recipe.matchIngredient)과 같은 함수.
 * (술 이름 추정 looksAlcoholic 은 lib/alcohol.js 로 옮김 — 여기서도 그대로 export)
 */
function nameKey(s) {
  return normName(s);
}

/** 미장착 재료 category 추정(AI 가 빠뜨렸을 때) */
function guessCategory(abv) {
  return abv >= 20 ? 'spirit' : abv > 0 ? 'wine' : 'other';
}

/**
 * 앱 재료 프리셋(app/src/lib/presets.ts)의 술 도수 — 이름·별칭(normName) → abv.
 * 앱 parseExplore 가 addIngredient 가 아닌 미장착 줄에 쓰는 도수(프리셋에 정확히 같은 이름이 있으면 그 도수)와 맞추려고 둠.
 * 무알콜 프리셋은 넣지 않음(술 이름 목록에도 없으므로 아래 uninstalledLineAbv 가 0 을 돌려줌 — 앱과 같음).
 */
const PRESET_ALCOHOL_ABV = new Map(
  [
    [['보드카'], 40],
    [['진'], 40],
    [['럼', '화이트럼', '다크럼'], 40],
    [['위스키'], 40],
    [['데킬라'], 38],
    [['소주'], 16.5],
    [['피치트리', '피치 리큐르', '피치슈냅스'], 20],
    [['깔루아', '커피 리큐르'], 20],
    [['말리부', '코코넛 럼'], 21],
    [['화이트와인'], 12],
    [['맥주'], 4.5],
  ].flatMap(([names, abv]) => names.map((n) => [normName(n), abv]))
);

/**
 * addIngredient 가 아닌 미장착 줄의 도수 (앱 parseExplore 와 같은 규칙):
 * 프리셋 술 이름·별칭과 정확히 같으면(normName) 그 도수, 아니면 술 이름 목록(looksAlcoholic)에 해당하면 40, 그 외 0.
 */
function uninstalledLineAbv(name) {
  const k = normName(name);
  if (PRESET_ALCOHOL_ABV.has(k)) return PRESET_ALCOHOL_ABV.get(k);
  return looksAlcoholic(name) ? 40 : 0;
}

/**
 * 도수 상한(capStrength 와 같은 상한값)을 넘으면 술 줄을 줄이고 무알콜 줄을 늘려 총량 유지.
 * abvOf(line) 은 알려진 도수(장착 재료 도수 / addIngredient 의 abv / 그 밖의 미장착 줄은 uninstalledLineAbv).
 * 무알콜 줄이 없어 낮출 수 없으면 false.
 */
function capLinesAbv(lines, abvOf, strength) {
  const range = STRENGTH_ABV[strength];
  if (!range || strength === 'none') return true;
  const total = lines.reduce((s, l) => s + l.ml, 0);
  if (!(total > 0)) return true;
  const alc = lines.reduce((s, l) => s + (l.ml * abvOf(l)) / 100, 0);
  if (alc / total <= range.max / 100 + 0.0005) return true;
  const mix = lines.filter((l) => abvOf(l) === 0);
  if (!mix.length) return false;
  const target = Math.max(0, range.max - 0.2) / 100;
  const k = (target * total) / alc;
  let freed = 0;
  for (const l of lines) {
    if (abvOf(l) > 0) {
      freed += l.ml * (1 - k);
      l.ml *= k;
    }
  }
  const mixSum = mix.reduce((s, l) => s + l.ml, 0);
  for (const l of mix) l.ml += mixSum > 0 ? freed * (l.ml / mixSum) : freed / mix.length;
  return true;
}

/**
 * 줄당 300ml 로 자른 뒤 도수 재확인 (recipe.capStrength 의 2단계와 같은 식).
 * 상한을 넘으면 술 줄(abv>0)만 f = t·M / (A − t·Sa) 배로 줄임 (t = 상한 − 0.2%p, A = 순수 알코올 ml,
 * Sa = 술 줄 합, M = 무알콜 줄 합). 무알콜 줄은 그대로라 합계는 cupMl 보다 작아질 수 있음.
 * 술 줄은 소수 1자리 '내림' → 반올림 때문에 상한을 다시 넘지 않음.
 */
function capAlcoholAfterClip(lines, abvOf, strength) {
  const range = STRENGTH_ABV[strength];
  if (!range || strength === 'none') return;
  const alc = lines.filter((l) => abvOf(l) > 0);
  const Sa = alc.reduce((s, l) => s + l.ml, 0);
  const M = lines.filter((l) => abvOf(l) === 0).reduce((s, l) => s + l.ml, 0);
  const A = alc.reduce((s, l) => s + (l.ml * abvOf(l)) / 100, 0);
  if (!(Sa + M > 0) || A / (Sa + M) <= range.max / 100 + 0.0005) return;
  const t = Math.max(0, range.max - 0.2) / 100;
  const f = A - t * Sa > 0 ? (t * M) / (A - t * Sa) : 0;
  for (const l of alc) l.ml = Math.floor(l.ml * f * 10 + 1e-9) / 10;
}

/**
 * explore 목록 검증·보정.
 *  - 항목: addIngredient(필수, 40자), category(목록 밖이면 추정), abv(0~100, 소수 1자리),
 *          recipeName(40자), description(120자), message(200자, 없으면 기본 문구)
 *  - addIngredient 가 이미 장착된 재료면 항목 제거 (이름: SPEC §3.1 normName)
 *  - strength=none: addIngredient 가 술이면 항목 제거, 술 재료 줄 제거
 *  - adultVerified 가 true 가 아니면(성인 확인 전, SPEC §5.4) 술을 새로 장착하라는 항목 제거:
 *    addIngredient 의 abv>0, 또는 category 가 spirit·liqueur·wine, 또는 미장착(installed:false) 재료 이름이 술 이름(lib/alcohol.js).
 *    (무알콜이면 위 규칙으로 미장착 술 줄을 먼저 뺀 뒤 판정) → 제거한 개수는 removedAdult
 *    (성인 확인 전 + 무알콜에서 위 none 규칙으로 버린 술 항목도 removedAdult 에 셈)
 *  - 성향(알레르기·싫어하는 재료, SPEC §3.3 규칙 1): addIngredient 가 opts.excludeName(이름) 이면 항목 제거,
 *    장착 줄 중 opts.excludePumps 의 펌프, 미장착 줄 중 opts.excludeName(이름) 인 줄은 제거 (규칙기반 후보와 같은 기준)
 *  - 재료 줄: installed/pump 를 장착 재료와 이름 일치로 다시 계산(AI 값 무시), 같은 재료는 합산,
 *             addIngredient 줄이 없으면 항목 제거, 미장착 재료는 addIngredient 포함 최대 2개, 최대 5줄
 *  - ml: 음수/숫자 아님 → 0, 0ml 줄 제거, 합계를 cupMl 로 비례 보정(소수 1자리), 도수 상한, 줄당 300ml
 *        (300ml 로 자른 뒤 도수를 다시 확인해 넘으면 술 줄만 더 줄임 → 합계가 cupMl 보다 작아질 수 있음)
 *        도수: 장착 줄 = 등록 도수, addIngredient 줄 = 항목 abv, 그 밖의 미장착 줄 = uninstalledLineAbv(프리셋 도수 / 술 이름 40 / 0)
 *        무알콜 줄이 없어 도수를 낮출 수 없는 항목은 제거 → 개수는 removedNoMixer
 *  - 같은 addIngredient 중복 제거, 최대 개수: explore 3 / normal 1
 * 반환: { items, notes:[제거·보정 사유(디버그용)], removedAdult:성인 확인 전이라 버린 항목 수,
 *         removedNoMixer: 무알콜 줄이 없어 도수 상한을 못 맞춰 버린 항목 수(= 무알콜 재료를 새로 더하지 않는 항목) }
 *   → 호출측(api/index.js)은 이 때문에 explore 가 0개가 되면 규칙기반 후보로 채움
 *     (removedNoMixer 는 NO_MIXER 탐색 전용일 때만 — SPEC §3.3 규칙 8)
 */
function normalizeExplore(list, ingredients, opts = {}) {
  const notes = [];
  let removedAdult = 0;
  let removedNoMixer = 0;
  const adult = opts.adultVerified === true;
  const excludePumps = opts.excludePumps instanceof Set ? opts.excludePumps : new Set();
  const excludeName = typeof opts.excludeName === 'function' ? opts.excludeName : () => false;
  const mode = opts.mode === 'explore' ? 'explore' : 'normal';
  const max = EXPLORE_MAX[mode];
  const strength = STRENGTHS.includes(opts.strength) ? opts.strength : 'none';
  const c = toNum(opts.cupMl);
  const cupMl = Number.isFinite(c) ? round1(Math.min(CUP.MAX, Math.max(CUP.MIN, c))) : CUP.DEFAULT;
  const installedByKey = new Map();
  for (const i of ingredients || []) if (!installedByKey.has(nameKey(i.name))) installedByKey.set(nameKey(i.name), i);

  const items = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list.slice(0, 10) : []) {
    if (items.length >= max) {
      notes.push(`최대 ${max}개까지만 사용`);
      break;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const addIngredient = cleanText(raw.addIngredient, 40);
    const addKey = nameKey(addIngredient);
    if (!addKey) {
      notes.push('addIngredient 없음');
      continue;
    }
    if (installedByKey.has(addKey)) {
      notes.push(`이미 장착된 재료 '${addIngredient}' 제안 제거`);
      continue;
    }
    if (seen.has(addKey)) {
      notes.push(`중복 제안 '${addIngredient}' 제거`);
      continue;
    }
    let abv = toNum(raw.abv);
    abv = Number.isFinite(abv) ? round1(Math.min(100, Math.max(0, abv))) : looksAlcoholic(addIngredient) ? 40 : 0;
    let category = typeof raw.category === 'string' ? raw.category.trim().toLowerCase() : '';
    if (!CATEGORIES.includes(category)) category = guessCategory(abv);
    const alcoholicAdd = abv > 0 || looksAlcoholic(addIngredient) || ALCOHOL_CATEGORIES.includes(category);
    if (strength === 'none' && alcoholicAdd) {
      notes.push(`무알콜 요청이라 술 '${addIngredient}' 제안 제거`);
      if (!adult) removedAdult += 1; // 성인 확인 전 요청에서 버린 술 항목 → 0개가 되면 AI 재호출 없이 채움 (SPEC §5.4)
      continue;
    }
    if (!adult && alcoholicAdd) {
      notes.push(`성인 확인 전이라 술 '${addIngredient}' 장착 제안 제거`);
      removedAdult += 1;
      continue;
    }
    if (excludeName(addIngredient)) {
      notes.push(`성향에서 뺀 재료 '${addIngredient}' 제안 제거`);
      continue;
    }

    // 재료 줄: 이름으로 장착 여부 재계산 + 같은 재료 합산 (처음 나온 순서 = 붓는 순서)
    const merged = new Map();
    for (const it of Array.isArray(raw.ingredients) ? raw.ingredients.slice(0, 12) : []) {
      if (!it || typeof it !== 'object') continue;
      const name = cleanText(it.name, 40);
      const key = nameKey(name);
      if (!key) continue;
      let ml = toNum(it.ml);
      if (!Number.isFinite(ml) || ml < 0) ml = 0;
      const ing = installedByKey.get(key);
      if (merged.has(key)) merged.get(key).ml += ml;
      else merged.set(key, ing ? { key, name: ing.name, ml, installed: true, pump: ing.pump } : { key, name, ml, installed: false });
    }
    let lines = [...merged.values()];
    if (strength === 'none') {
      lines = lines.filter((l) => {
        const isAlc = l.installed ? installedByKey.get(l.key).abv > 0 : l.key !== addKey && looksAlcoholic(l.name);
        if (isAlc) notes.push(`무알콜 요청이라 '${l.name}' 제외`);
        return !isAlc;
      });
    }
    // 성인 확인 전: 미장착 술(이름으로 판정)을 함께 장착하라는 항목도 버림 (SPEC §5.4)
    if (!adult) {
      const alcLine = lines.find((l) => !l.installed && looksAlcoholic(l.name));
      if (alcLine) {
        notes.push(`성인 확인 전이라 술 '${alcLine.name}'${particle(alcLine.name, '이', '가')} 들어간 '${addIngredient}' 제안 제거`);
        removedAdult += 1;
        continue;
      }
    }
    // 성향(알레르기·싫어하는 재료)으로 뺀 재료 줄 제거 (SPEC §3.3 규칙 1 — 레시피·규칙기반 후보와 같은 기준)
    lines = lines.filter((l) => {
      const ex = l.installed ? excludePumps.has(l.pump) : l.key !== addKey && excludeName(l.name);
      if (ex) notes.push(`성향에서 뺀 재료 '${l.name}' 제외`);
      return !ex;
    });
    for (const l of lines) l.ml = round1(l.ml);
    lines = lines.filter((l) => l.ml > 0);
    const addLine = lines.find((l) => l.key === addKey);
    if (!addLine) {
      notes.push(`'${addIngredient}'${particle(addIngredient, '이', '가')} 재료 목록에 없어 제거`);
      continue;
    }
    addLine.name = addIngredient;
    // 미장착 재료는 addIngredient + (가장 많이 쓰는) 1개까지
    const otherUninstalled = lines.filter((l) => !l.installed && l !== addLine).sort((a, b) => b.ml - a.ml);
    const dropKeys = new Set(otherUninstalled.slice(MAX_UNINSTALLED - 1).map((l) => l.key));
    if (dropKeys.size) {
      notes.push(`미장착 재료가 많아 ${dropKeys.size}개 제외`);
      lines = lines.filter((l) => !dropKeys.has(l.key));
    }
    // 줄 수 상한: addIngredient 는 유지, 나머지는 양이 적은 것부터 제외
    if (lines.length > MAX_LINES) {
      const keep = new Set([addLine, ...lines.filter((l) => l !== addLine).sort((a, b) => b.ml - a.ml).slice(0, MAX_LINES - 1)]);
      lines = lines.filter((l) => keep.has(l));
    }

    // 양: 합계를 cupMl 로 → 도수 상한 → 줄당 300ml
    lines = scaleToTotal(lines, cupMl);
    // 줄별 도수: 장착 = 등록 도수, addIngredient = 항목 abv, 그 밖의 미장착 = 프리셋 도수 / 술 이름이면 40 / 0 (앱과 같음)
    const lineAbv = new Map(
      lines.map((l) => [l.key, l.installed ? installedByKey.get(l.key).abv : l.key === addKey ? abv : uninstalledLineAbv(l.name)])
    );
    const abvOf = (l) => lineAbv.get(l.key) || 0;
    if (!capLinesAbv(lines, abvOf, strength)) {
      notes.push(`'${addIngredient}' 제안은 도수를 낮출 무알콜 재료가 없어 제거`);
      removedNoMixer += 1;
      continue;
    }
    lines = scaleToTotal(lines, cupMl); // 도수 보정 후 반올림 오차 정리(합계 = cupMl)
    for (const l of lines) l.ml = Math.min(MAX_STEP_ML, round1(l.ml));
    // 300ml 로 자르면 무알콜 줄만 줄어 도수가 다시 오를 수 있음 → 술 줄만 더 줄여 상한 유지(합계 < cupMl 허용)
    capAlcoholAfterClip(lines, abvOf, strength);
    lines = lines.filter((l) => l.ml > 0);
    if (!lines.some((l) => l.key === addKey)) continue;

    seen.add(addKey);
    items.push({
      addIngredient,
      category,
      abv,
      recipeName: cleanText(raw.recipeName, 40) || `${addIngredient} 한 잔`,
      description: cleanText(raw.description, 120),
      ingredients: lines.map((l) => (l.installed ? { name: l.name, ml: l.ml, installed: true, pump: l.pump } : { name: l.name, ml: l.ml, installed: false })),
      message: cleanText(raw.message, 200) || `${josa(addIngredient, '을', '를')} 비어 있거나 잘 안 쓰는 펌프에 장착하면 만들 수 있어요.`,
    });
  }
  return { items, notes, removedAdult, removedNoMixer };
}

/**
 * SPEC §3.3 규칙 8 (NO_MIXER explore): 카드가 '무알콜 재료를 새로 더하는지' (백엔드·앱 같은 정의).
 * installed:false 재료 줄 중 하나라도 아래 두 조건을 모두 만족하면 true:
 *   (a) 이름이 술 이름 목록(lib/alcohol.js looksAlcoholic)에 해당하지 않음
 *   (b) 그 줄이 addIngredient 와 같은 재료(normName 일치)라면 카드의 abv 가 0(없으면 0)이고
 *       category 가 ALCOHOL_CATEGORIES(spirit·liqueur·wine)가 아님 (addIngredient 가 아닌 미장착 줄은 (a)만 봄)
 * normalizeExplore 를 거친 카드에 씀 (installed 는 이름으로 다시 계산된 값).
 */
function addsSoftIngredient(card) {
  if (!card || !Array.isArray(card.ingredients)) return false;
  const addKey = normName(card.addIngredient);
  const abv = Number.isFinite(card.abv) ? card.abv : 0;
  const softAdd = abv === 0 && !ALCOHOL_CATEGORIES.includes(card.category);
  return card.ingredients.some(
    (l) => l && !l.installed && !looksAlcoholic(l.name) && (normName(l.name) !== addKey || softAdd)
  );
}

/**
 * NO_MIXER(섞을 무알콜 재료가 없어 recipe:null) 일 때의 explore 카드 거르기 (SPEC §3.3 규칙 8):
 * 무알콜 재료를 새로 하나도 더하지 않는 카드(술만 더하는 카드)는 버림.
 * 반환 { items: 남은 카드, removed: 버린 개수 } → 호출측(api/index.js)은 0개가 되면 AI 재호출 없이 규칙기반 후보(같은 필터)로 채움
 */
function filterNoMixerExplore(items) {
  const list = Array.isArray(items) ? items : [];
  const kept = list.filter(addsSoftIngredient);
  return { items: kept, removed: list.length - kept.length };
}

/** 앞 목록(AI)에 없는 항목을 뒤 목록(fallback)에서 채움 — 같은 addIngredient 는 건너뜀 */
function mergeExplore(primary, extra, max) {
  const out = [...primary];
  const keys = new Set(out.map((e) => nameKey(e.addIngredient)));
  for (const e of extra) {
    if (out.length >= max) break;
    if (keys.has(nameKey(e.addIngredient))) continue;
    keys.add(nameKey(e.addIngredient));
    out.push(e);
  }
  return out.slice(0, max);
}

module.exports = {
  normalizeExplore,
  mergeExplore,
  addsSoftIngredient,
  filterNoMixerExplore,
  nameKey,
  looksAlcoholic,
  uninstalledLineAbv,
  PRESET_ALCOHOL_ABV,
  capAlcoholAfterClip,
  EXPLORE_MAX,
  MAX_UNINSTALLED,
};
