'use strict';
/**
 * 규칙기반 추천(fallback) — Gemini 키가 없거나 AI 호출이 실패해도 시연이 끊기지 않도록
 * 장착 재료 + 사용자 입력만으로 결정적(deterministic) 레시피를 만듭니다.
 * 결과는 Gemini 응답과 같은 "원본" 모양이며, 레시피는 finalizeRecipe(), 탐색 제안은 normalizeExplore() 로
 * 반드시 보정해서 사용합니다.
 *
 *   buildFallbackRecipe(user, ingredients, history)          → raw recipe | null(쓸 재료 없음)
 *       history 의 rejected:true(거절) 레시피와 같은 재료 조합은 피함 (SPEC §5.3)
 *   buildFallbackExplore(user, ingredients, history, {mode}) → raw explore 배열 (SPEC §5.4 후보 목록)
 *
 * 순수 함수만 사용(Node 전용 API 없음) → 앱에도 그대로 옮겨 쓸 수 있습니다.
 */

const { ingredientProfile, estimateFlavor, TASTE_KEYS, clampInt } = require('./flavor');
const { STRENGTH_ABV, STRENGTH_KO, round1, normName, josa, particle, finalizeRecipe } = require('./recipe');
const { nameKey, EXPLORE_MAX } = require('./explore');

const POUR_ORDER = { spirit: 0, liqueur: 1, wine: 2, syrup: 3, juice: 4, dairy: 5, other: 6, water: 7, soda: 8 };

/**
 * 도수를 골랐는데 쓸 수 있는 술이 없어 무알콜로 만들었을 때의 info 문구 (SPEC §3.2).
 * 성인 확인 전(user.adultVerified !== true)이면 술 장착을 권하지 않는 앞 문장까지만.
 */
const NO_ALCOHOL_INFO = '장착된 주류가 없어 무알콜로 만들었어요.';
const NO_ALCOHOL_INFO_ADULT = `${NO_ALCOHOL_INFO} 보드카·럼 같은 술을 장착하면 칵테일도 만들 수 있어요.`;

// 기분·상황·날씨 키워드 → 원하는 맛 보정 + 추천 이유 문구
const MOOD_RULES = [
  { re: /피곤|지침|지쳤|무기력|졸|힘들/, delta: { sour: 1, fizzy: 1 }, why: '상큼한 산미와 청량감으로 기분을 깨워 줄', prefix: '리프레시' },
  { re: /우울|슬픔|슬퍼|외로|쓸쓸|울적/, delta: { sweet: 1 }, why: '달콤하고 부드럽게 마음을 달래 줄', prefix: '선샤인' },
  { re: /스트레스|짜증|화남|화나|답답|분노/, delta: { sour: 1, fizzy: 1 }, why: '시원하고 산뜻하게 머리를 식혀 줄', prefix: '쿨다운' },
  { re: /설렘|설레|두근|행복|신남|신나|기쁨|기뻐|축하|들뜸/, delta: { sweet: 1, fizzy: 1 }, why: '화사하고 톡 쏘는 기분 좋은', prefix: '해피' },
  { re: /차분|휴식|릴랙스|편안|잔잔|평온|나른/, delta: { fizzy: -1 }, why: '자극이 덜하고 편안하게 즐길 수 있는', prefix: '릴랙스' },
];
const SITUATION_RULES = [
  { re: /운동/, delta: { sweet: -1, sour: 1 }, why: '운동 후 수분 보충에 좋은 가벼운' },
  { re: /파티|모임|축하/, delta: { fizzy: 1 }, why: '여럿이 즐기기 좋은 화사한' },
  { re: /데이트/, delta: { sweet: 1 }, why: '분위기를 살려 줄 달콤한' },
  { re: /공부|작업|업무/, delta: { sweet: -1 }, why: '무겁지 않고 깔끔한' },
];

function addDelta(d, delta) {
  for (const k of Object.keys(delta)) d[k] = (d[k] ?? 2.5) + delta[k];
}

/** 사용자 입력 → 원하는 맛 벡터(0~5) + 이유 문구 */
function desiredTaste(user) {
  const d = {};
  for (const k of TASTE_KEYS) d[k] = user.taste && Number.isFinite(user.taste[k]) ? user.taste[k] : 2.5;
  const reasons = [];
  let prefix = '';
  const moodText = (user.moods || []).join(' ');
  for (const r of MOOD_RULES) {
    if (r.re.test(moodText)) {
      addDelta(d, r.delta);
      if (!prefix) prefix = r.prefix;
      if (reasons.length < 1) reasons.push(r.why);
    }
  }
  const w = user.weather || {};
  const cond = String(w.condition || '');
  let weatherWhy = '';
  if ((Number.isFinite(w.tempC) && w.tempC >= 25) || /더움|덥|폭염|무더/.test(cond)) {
    addDelta(d, { fizzy: 1, sour: 1 });
    weatherWhy = `더운 날씨${Number.isFinite(w.tempC) ? `(${w.tempC}°C)` : ''}라 시원한 청량감을 더했어요.`;
    if (!prefix) prefix = '썸머';
  } else if ((Number.isFinite(w.tempC) && w.tempC <= 8) || /눈|추움|춥|한파/.test(cond)) {
    addDelta(d, { sweet: 1, fizzy: -1 });
    weatherWhy = `쌀쌀한 날씨${Number.isFinite(w.tempC) ? `(${w.tempC}°C)` : ''}라 달콤하고 포근한 맛으로 골랐어요.`;
    if (!prefix) prefix = '윈터';
  } else if (/비|흐림|소나기|장마/.test(cond)) {
    addDelta(d, { sweet: 1 });
    weatherWhy = `${cond} 날씨에 어울리게 조금 더 달콤하게 맞췄어요.`;
    if (!prefix) prefix = '레이니';
  } else if (cond) {
    weatherWhy = `${cond} 날씨에 가볍게 즐기기 좋은 비율이에요.`;
  }
  let situationWhy = '';
  for (const r of SITUATION_RULES) {
    if (r.re.test(user.situation || '')) {
      addDelta(d, r.delta);
      situationWhy = r.why;
      break;
    }
  }
  const pref = user.preference || '';
  if (/달지\s*않|안\s*단|덜\s*달|단\s*거?\s*싫|단맛\s*싫/.test(pref)) d.sweet -= 2;
  else if (/달달|달콤|단\s*거?\s*좋/.test(pref)) d.sweet += 1;
  if (/상큼|새콤|시큼/.test(pref)) d.sour += 1;
  if (/탄산\S{0,2}\s*(싫|없|빼|x)/i.test(pref)) d.fizzy = 0; // '탄산 싫어', '탄산은 싫어요', '탄산음료 빼고'
  else if (/탄산|톡\s*쏘/.test(pref)) d.fizzy += 1;
  if (/쌉쌀|씁쓸|쓴\s*맛\s*좋/.test(pref)) d.bitter += 1;
  for (const k of TASTE_KEYS) {
    d[k] = Math.min(5, Math.max(0, d[k]));
    if (user.taste && user.taste[k] === 0) d[k] = 0; // 사용자가 0(원하지 않음)을 고르면 기분·날씨 보정보다 우선
  }
  return { d, reasons, weatherWhy, situationWhy, prefix };
}

/**
 * 성향 문장을 절(clause)로 나누는 기준: 문장부호·대조 접속('지만', '는데' …).
 * 쉼표와 '그리고'로는 나누지 않음 — '우유, 사이다는 빼 주세요' 같은 나열을 한 절로 유지(알레르기 누락 방지).
 */
const PREF_CLAUSE_SPLIT = /[.!?;~\n\/]|근데|그런데|하지만|지만|는데|은데|인데/;
/** 부정(빼 달라는) 표현 */
const PREF_NEG_RE = /싫|빼|제외|알레르기|알러지|못먹|안먹|안넣|넣지마|넣지말|넣지않|없이|안좋|좋지않|별로/;
/** 긍정 표현 — 재료 바로 뒤에 부정보다 먼저 나오면 '좋아하는 재료' */
const PREF_POS_RE = /좋|최고|사랑|원해|넣어/;
/** 재료 이름 뒤 몇 글자 안에서 부정 표현을 찾을지 (정규화된 글자 수) */
const PREF_AFTER_WINDOW = 10;
/** '알레르기: 우유, 땅콩' 처럼 이름 앞에 오는 알레르기 표시를 볼 범위 */
const PREF_BEFORE_WINDOW = 12;

/**
 * 성향 입력에서 '싫어/빼줘/알레르기' 가 **그 재료에** 걸려 있으면 제외.
 * 문장을 절로 나눈 뒤(마침표·느낌표·'지만'·'는데' 등), 같은 절 안에서
 *  - 재료 이름 바로 뒤(10글자 안)에 부정 표현이 긍정 표현보다 먼저 나오거나
 *    ('우유는 싫어요', '우유 알레르기', '우유, 사이다는 빼 주세요', '우유는 안 좋아해요')
 *  - 이름 앞(12글자 안)에 '알레르기/알러지/제외' 가 있고 이름 뒤에 긍정 표현이 없으면 ('알레르기: 우유, 땅콩')
 * 제외. 'A 좋아요. B 싫어요', 'A는 좋고 B는 싫어요' 에서 A 는 제외하지 않음.
 */
function excludedByPreference(ing, pref) {
  if (!pref) return false;
  const name = normName(ing.name);
  if (!name || name.length < 2) return false;
  for (const clause of String(pref).split(PREF_CLAUSE_SPLIT)) {
    const c = normName(clause);
    for (let at = c.indexOf(name); at >= 0; at = c.indexOf(name, at + 1)) {
      const after = c.slice(at + name.length, at + name.length + PREF_AFTER_WINDOW);
      const neg = after.search(PREF_NEG_RE);
      const pos = after.search(PREF_POS_RE);
      if (neg >= 0 && (pos < 0 || neg <= pos)) return true;
      const before = c.slice(Math.max(0, at - PREF_BEFORE_WINDOW), at);
      if (/알레르기|알러지|제외/.test(before) && pos < 0) return true;
    }
  }
  return false;
}

/** 성향(알레르기·싫어하는 재료)으로 뺄 장착 재료의 펌프 번호 Set — finalizeRecipe 의 excludePumps 로 넘김 */
function preferenceExcludedPumps(ingredients, preference) {
  return new Set((ingredients || []).filter((i) => excludedByPreference(i, preference)).map((i) => i.pump));
}

/** 잔 전체에서 차지할 수 있는 최대 비율: 시럽 15%, 신맛 5(레몬·라임 등) 20%, 그 외 제한 없음 */
function capShareOf(ing) {
  if (ing.category === 'syrup') return 0.15;
  return ingredientProfile(ing).sour >= 5 ? 0.2 : 1;
}

function historyBonus(ing, history) {
  let b = 0;
  const key = normName(ing.name);
  for (const h of history || []) {
    if (!h.ingredients || !h.ingredients.some((i) => normName(i.name) === key)) continue;
    if (h.liked === true) b += 0.6;
    else if (h.liked === false) b -= 0.8;
  }
  return Math.max(-2, Math.min(1.5, b));
}

function scoreIngredient(ing, d, history, cupMl) {
  const p = ingredientProfile(ing);
  let s = 0;
  for (const k of TASTE_KEYS) s += (p[k] * (d[k] - 2.5)) / 5;
  s += historyBonus(ing, history);
  if (ing.category === 'water') s -= 1;
  if (ing.remainingMl != null && ing.remainingMl < cupMl * 0.3) s -= 0.5;
  return s;
}

/** chosen 에서 강제 포함(force)이 아닌 마지막 재료 하나를 뺌 */
function dropOneUnforced(chosen, force) {
  for (let k = chosen.length - 1; k >= 0; k -= 1) {
    if (!force.has(chosen[k].ing.pump)) {
      chosen.splice(k, 1);
      return true;
    }
  }
  return false;
}

/**
 * 규칙기반 레시피 1개 조립 (내부용).
 * - 무알콜 재료(믹서) 1~3종을 맛 점수로 고르고, 도수 단계 목표(light 4% / medium 9% / strong 16%)에 맞춰 술 양 계산
 * - 시럽은 잔의 15% 이하, 탄산은 마지막에 붓도록 정렬
 * opts.exclude: 이번에 쓰지 않을 펌프 번호 Set (거절 조합 피하기용)
 * opts.force:   반드시 넣을 펌프 번호 배열 (탐색 제안의 새 재료용)
 */
function composeRecipe(user, ingredients, history = [], opts = {}) {
  const cupMl = user.cupMl || 200;
  const strength = user.strength || 'none';
  const { d, reasons, weatherWhy, situationWhy, prefix } = desiredTaste(user);
  const exclude = opts.exclude || new Set();
  const force = new Set(opts.force || []);

  const usable = ingredients.filter(
    (i) =>
      !exclude.has(i.pump) &&
      (force.has(i.pump) || ((i.remainingMl == null || i.remainingMl >= 5) && !excludedByPreference(i, user.preference)))
  );
  let mixers = usable.filter((i) => i.abv === 0);
  const alcohols = strength === 'none' ? [] : usable.filter((i) => i.abv > 0);
  if (!mixers.length && !alcohols.length) return null;

  const scored = mixers
    .map((i) => ({ ing: i, score: scoreIngredient(i, d, history, cupMl) }))
    .sort((a, b) => b.score - a.score || (b.ing.remainingMl ?? 1e9) - (a.ing.remainingMl ?? 1e9));
  // 탄산을 원하지 않으면(fizzy ≤ 1) 다른 선택지가 있을 때 탄산 제외
  let pool = scored;
  if (d.fizzy <= 1 && scored.some((s) => s.ing.category !== 'soda')) pool = scored.filter((s) => s.ing.category !== 'soda');
  const chosen = [];
  for (const s of pool) {
    if (!chosen.length) chosen.push(s);
    else if (chosen.length === 1 && s.score > -0.3) chosen.push(s);
    else if (chosen.length === 2 && s.score > 0.3) chosen.push(s);
  }
  // 탄산을 강하게 원하면 탄산 재료 보장
  if (d.fizzy >= 4 && !chosen.some((s) => s.ing.category === 'soda')) {
    const soda = scored.find((s) => s.ing.category === 'soda');
    if (soda) {
      if (chosen.length >= 3) chosen.pop();
      chosen.push(soda);
    }
  }
  // 강제 포함 무알콜 재료(탐색 제안의 새 재료)
  for (const p of force) {
    const s = scored.find((x) => x.ing.pump === p);
    if (!s || chosen.includes(s)) continue;
    if (chosen.length >= 4) dropOneUnforced(chosen, force); // 새 재료를 넣을 때는 무알콜 재료 최대 4종
    chosen.push(s);
  }

  // 맛이 센 재료(시럽·레몬류)만 골랐다면 양을 채울 기본 재료 하나 추가 (레몬주스 200ml 같은 결과 방지)
  if (chosen.length && chosen.every((s) => capShareOf(s.ing) < 1)) {
    const base = pool.find((s) => capShareOf(s.ing) === 1 && !chosen.includes(s)) || scored.find((s) => capShareOf(s.ing) === 1 && !chosen.includes(s));
    if (base) {
      if (chosen.length >= (force.size ? 4 : 3)) dropOneUnforced(chosen, force);
      chosen.push(base);
    }
  }

  // 술 선택 및 양 계산
  const items = [];
  let noAlcoholAvailable = false;
  if (strength !== 'none') {
    if (!alcohols.length) noAlcoholAvailable = true;
    else {
      const alcScored = alcohols
        .map((i) => ({ ing: i, score: scoreIngredient(i, d, history, cupMl) + (i.category === 'spirit' ? 0.3 : 0) }))
        .sort((a, b) => b.score - a.score);
      let primary = alcScored[0].ing;
      let secondary =
        d.sweet >= 3 && primary.category === 'spirit'
          ? alcScored.find((s) => s.ing.category === 'liqueur' && s.ing.pump !== primary.pump)
          : null;
      // 강제 포함 술: 리큐르는 장착된 증류주가 있으면 보조(30%), 그 외에는 주 재료
      const forcedAlc = alcScored.find((s) => force.has(s.ing.pump));
      if (forcedAlc) {
        const spirit = alcScored.find((s) => s.ing.category === 'spirit' && s !== forcedAlc);
        if (forcedAlc.ing.category === 'liqueur' && spirit) {
          primary = spirit.ing;
          secondary = forcedAlc;
        } else {
          primary = forcedAlc.ing;
          if (secondary && (secondary.ing.pump === primary.pump || primary.category !== 'spirit')) secondary = null;
        }
      }
      const alcoholVolume = (STRENGTH_ABV[strength].target / 100) * cupMl; // 순수 알코올 ml
      const parts = secondary ? [[primary, 0.7], [secondary.ing, 0.3]] : [[primary, 1]];
      let alcMl = 0;
      for (const [ing, share] of parts) {
        const ml = (alcoholVolume * share) / (ing.abv / 100);
        items.push({ pump: ing.pump, name: ing.name, ml });
        alcMl += ml;
      }
      const maxAlc = chosen.length ? cupMl * 0.6 : cupMl;
      if (alcMl > maxAlc) {
        const f = maxAlc / alcMl;
        for (const it of items) it.ml *= f;
      }
    }
  }
  const alcTotal = items.reduce((s, i) => s + i.ml, 0);
  let mixVolume = Math.max(0, cupMl - alcTotal);
  if (!chosen.length) mixVolume = 0;

  // 믹서 분배: 가중치 = e^점수 (취향에 맞는 재료일수록 확실히 많이)
  // 맛이 센 재료는 상한: 시럽 15%, 레몬·라임처럼 신맛 5 인 재료 20%
  const weights = chosen.map((s) => Math.max(0.3, Math.exp(s.score)));
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  const mixItems = chosen.map((s, idx) => ({
    pump: s.ing.pump,
    name: s.ing.name,
    ml: (mixVolume * weights[idx]) / wSum,
    cap: cupMl * capShareOf(s.ing),
  }));
  let overflow = 0;
  for (const m of mixItems) {
    if (m.ml > m.cap) {
      overflow += m.ml - m.cap;
      m.ml = m.cap;
    }
  }
  const others = mixItems.filter((m) => m.ml < m.cap);
  if (overflow > 0 && others.length) {
    const oSum = others.reduce((s, m) => s + m.ml, 0) || 1;
    for (const m of others) m.ml += (overflow * m.ml) / oSum;
  }
  for (const m of mixItems) items.push({ pump: m.pump, name: m.name, ml: m.ml });

  if (!items.length) return null;
  const byPump = new Map(ingredients.map((i) => [i.pump, i]));
  items.sort((a, b) => (POUR_ORDER[byPump.get(a.pump).category] ?? 6) - (POUR_ORDER[byPump.get(b.pump).category] ?? 6));
  for (const it of items) it.ml = round1(it.ml);

  // 이름·설명·이유
  const f = estimateFlavor(items, byPump);
  const hasSoda = items.some((i) => byPump.get(i.pump).category === 'soda');
  const hasDairy = items.some((i) => byPump.get(i.pump).category === 'dairy');
  const hasAlcohol = items.some((i) => byPump.get(i.pump).abv > 0);
  const hasCitrus = items.some((i) => /레몬|라임|자몽|유자|lemon|lime/i.test(i.name));
  // 가장 두드러진 맛(3 이상)으로 이름 짓기. 동점이면 탄산 > 신맛 > 단맛 > 쓴맛
  const top = ['fizzy', 'sour', 'sweet', 'bitter'].reduce((a, k) => (f[k] > f[a] ? k : a), 'fizzy');
  const WORD = { fizzy: '스파클링', sour: hasCitrus ? '시트러스' : '상큼', sweet: '스위트', bitter: '비터' };
  const flavorWord = f[top] >= 3 ? WORD[top] : '밸런스';
  const noun = hasAlcohol
    ? hasSoda ? '하이볼' : f.sour >= 3 ? '사워' : hasDairy ? '밀크 칵테일' : '칵테일'
    : hasSoda ? '에이드' : hasDairy ? '밀크 쿨러' : '쿨러';
  const name = `${prefix || '오늘의'} ${flavorWord} ${noun}`;
  const stems = [f.sweet >= 3 && '달콤', f.sour >= 3 && '상큼', f.bitter >= 3 && '쌉쌀', (f.fizzy >= 3 || hasSoda) && '청량'].filter(Boolean);
  const tasteDesc = stems.length ? stems.map((st, i) => st + (i < stems.length - 1 ? '하고' : '한')).join(' ') : '부드러운';
  const names = items.map((i) => i.name);
  const description = `${josa(names.join('·'), '으로', '로')} 만든 ${tasteDesc} ${noun}`;

  const moodText = (user.moods || []).join(', ');
  const lastMood = (user.moods || [])[user.moods ? user.moods.length - 1 : 0] || '';
  const s1 = moodText
    ? `오늘 ${moodText}${particle(lastMood, '이라고', '라고')} 하셔서 ${reasons[0] || situationWhy || '지금 기분에 어울리는'} 한 잔으로 골랐어요.`
    : `${situationWhy || '입력하신 취향에 맞춘'} 한 잔으로 골랐어요.`;
  const tasteParts = [];
  if (user.taste) {
    if (user.taste.sweet != null && user.taste.sweet >= 4) tasteParts.push('단맛');
    if (user.taste.sour != null && user.taste.sour >= 4) tasteParts.push('신맛');
    if (user.taste.bitter != null && user.taste.bitter >= 4) tasteParts.push('쌉쌀함');
    if (user.taste.fizzy != null && user.taste.fizzy >= 4) tasteParts.push('탄산감');
  }
  const s2 = weatherWhy || (tasteParts.length ? `좋아하시는 ${tasteParts.join('·')}을 살렸어요.` : '');
  const s3 = strength !== 'none' && hasAlcohol ? `도수는 '${STRENGTH_KO[strength]}'에 맞춰 조절했어요.` : '';
  const reason = [s1, s2, s3].filter(Boolean).join(' ');

  const hot = (user.weather && Number.isFinite(user.weather.tempC) && user.weather.tempC >= 25) || false;
  const garnish = hot ? '얼음 가득 + 레몬 슬라이스(선택)' : hasCitrus ? '얼음 + 레몬/라임 슬라이스(선택)' : '얼음 적당히';
  const tipsArr = ['잔에 얼음을 먼저 채우고 제조를 시작하세요.'];
  if (hasSoda) tipsArr.push('탄산은 마지막에 들어가니 세게 젓지 말고 살짝만 섞어 주세요.');
  if (hasAlcohol) tipsArr.push('천천히 즐기세요.');
  const tips = tipsArr.join(' ');

  // 능동 제안 (BM 핵심: 미보유 재료 추가 장착 유도)
  // 성인 확인 전(user.adultVerified !== true)에는 규칙기반 문구도 술 장착을 권하지 않음 (SPEC §3.2)
  const suggestions = [];
  const installed = ingredients.map((i) => i.name).join(' ');
  if (noAlcoholAvailable) {
    suggestions.push({ type: 'info', message: user.adultVerified === true ? NO_ALCOHOL_INFO_ADULT : NO_ALCOHOL_INFO });
  }
  if (!ingredients.some((i) => i.category === 'soda') && d.fizzy >= 3) {
    suggestions.push({ type: 'add_ingredient', ingredient: '탄산수', message: '탄산수(또는 토닉워터)를 추가 장착하면 더 청량한 하이볼·에이드를 만들 수 있어요.' });
  } else if (!/레몬|라임|lemon|lime/i.test(installed) && d.sour >= 3) {
    suggestions.push({ type: 'add_ingredient', ingredient: '레몬주스', message: '레몬주스(또는 라임주스)를 추가 장착하면 산뜻한 사워 스타일도 가능해요.' });
  } else if (!ingredients.some((i) => i.category === 'syrup') && d.sweet >= 4) {
    suggestions.push({ type: 'add_ingredient', ingredient: '그레나딘 시럽', message: '그레나딘 시럽을 추가 장착하면 더 달콤하고 색감이 예쁜 음료를 만들 수 있어요.' });
  } else if (hasAlcohol && !/토닉|tonic/i.test(installed)) {
    suggestions.push({ type: 'add_ingredient', ingredient: '토닉워터', message: "토닉워터를 추가 장착하면 쌉싸름한 '진토닉 스타일'도 만들 수 있어요." });
  }

  const flavor = {};
  for (const k of TASTE_KEYS) flavor[k] = clampInt(f[k], 0, 5);

  return { name, nameEn: '', description, reason, ingredients: items, flavor, garnish, tips, suggestions, style: { prefix: prefix || '오늘의', noun } };
}

// ───────────────────────── 거절(rejected) 조합 피하기 — SPEC §5.3 ─────────────────────────

/** 재료 조합 키: 이름(SPEC §3.1 normName)을 정렬해 이어 붙임 */
function comboKey(names) {
  return [...new Set(names.map(nameKey).filter(Boolean))].sort().join('|');
}

/** history 에서 거절된 레시피들의 재료 조합 키 Set */
function rejectedCombos(history) {
  const out = new Set();
  for (const h of history || []) {
    if (h && h.rejected && Array.isArray(h.ingredients) && h.ingredients.length) out.add(comboKey(h.ingredients.map((i) => i.name)));
  }
  out.delete('');
  return out;
}

function hasAlcohol(raw, byPump) {
  return raw.ingredients.some((i) => (byPump.get(i.pump) || { abv: 0 }).abv > 0);
}

const REJECT_NOTE = '지난번에 넘기신 추천과 겹치지 않게 다른 재료 조합으로 골랐어요.';

/**
 * 규칙기반 레시피 생성 (서버·앱 공통 진입점).
 * 거절된 레시피와 같은 재료 조합이 나오면 → 재료를 1개(그다음 2개) 빼거나, 안 쓴 재료를 1개 넣어
 * "다른 조합"을 찾음(술이 있던 레시피는 술이 빠지지 않는 후보 우선). 다른 조합이 전혀 없을 때만
 * 같은 재료로 비율을 바꾸고 새 재료 장착(탐색 모드)을 권하는 안내를 붙임.
 * 거절 조합 비교는 **최종 보정 결과**(finalizeRecipe — 규칙 8 이 뺀 무알콜 재료를 다시 넣을 수 있음)의 재료로 함.
 */
function buildFallbackRecipe(user, ingredients, history = []) {
  const base = composeRecipe(user, ingredients, history);
  const rejected = rejectedCombos(history);
  if (!base || !rejected.size) return base;
  const strength = user.strength || 'none';
  const finalOpts = { cupMl: user.cupMl, strength, excludePumps: preferenceExcludedPumps(ingredients, user.preference) };
  /** 최종 보정 뒤 재료 조합 키 (보정 실패면 null) */
  const finalCombo = (raw) => {
    const f = finalizeRecipe(raw, ingredients, finalOpts);
    return f.ok ? comboKey(f.recipe.ingredients.map((i) => i.name)) : null;
  };
  const baseKey = finalCombo(base);
  if (baseKey == null || !rejected.has(baseKey)) return base; // 보정 실패는 호출측이 처리(422 등)
  /** 대안: 보정에 실패하거나 최종 조합이 거절 조합이면 쓰지 않음 */
  const isRejected = (raw) => {
    const k = finalCombo(raw);
    return k == null || rejected.has(k);
  };

  const byPump = new Map(ingredients.map((i) => [i.pump, i]));
  const needAlcohol = strength !== 'none' && hasAlcohol(base, byPump);
  const used = base.ingredients.map((i) => i.pump);
  // 무알콜 재료부터 바꿔 봄 (술을 빼면 원하는 도수를 못 맞추므로 마지막)
  const order = [...used.filter((p) => byPump.get(p).abv === 0), ...used.filter((p) => byPump.get(p).abv > 0)];
  const tries = order.map((p) => ({ exclude: new Set([p]) }));
  for (let a = 0; a < order.length; a += 1) {
    for (let b = a + 1; b < order.length; b += 1) tries.push({ exclude: new Set([order[a], order[b]]) });
  }
  for (const i of ingredients) if (!used.includes(i.pump)) tries.push({ force: [i.pump] });

  let alcoholFree = null;
  for (const t of tries) {
    const alt = composeRecipe(user, ingredients, history, t);
    if (!alt || isRejected(alt)) continue;
    if (needAlcohol && !hasAlcohol(alt, byPump)) {
      if (!alcoholFree) alcoholFree = alt;
      continue;
    }
    alt.suggestions.unshift({ type: 'info', message: REJECT_NOTE });
    return alt;
  }
  if (alcoholFree) {
    alcoholFree.suggestions.unshift({ type: 'info', message: `${REJECT_NOTE} (이번 조합에는 술이 들어가지 않아요)` });
    return alcoholFree;
  }
  // 다른 조합이 없음 → 비율만 바꿈: 가장 많은 무알콜 재료의 25%를 두 번째 무알콜 재료로 옮김
  const mix = base.ingredients.filter((i) => byPump.get(i.pump).abv === 0).sort((x, y) => y.ml - x.ml);
  if (mix.length >= 2) {
    const move = mix[0].ml * 0.25;
    mix[0].ml = round1(mix[0].ml - move);
    mix[1].ml = round1(mix[1].ml + move);
  }
  base.suggestions.unshift({
    type: 'info',
    message: '지금 장착된 재료로는 새 조합이 없어 비율을 바꿔 봤어요. 새 재료를 장착하면 전혀 다른 한 잔을 만들 수 있어요.',
  });
  return base;
}

// ───────────────────────── 탐색(explore) 제안 — SPEC §5.4 후보 목록 ─────────────────────────

/**
 * SPEC §5.4 표의 '산미 재료(레몬·라임·자몽 등)' / '휴식/디저트 상황' 판정 — 앱 오프라인 탐색(offline-explore.ts)도
 * 이 문자열 그대로 써야 서버 fallback 과 같은 후보가 나옴. RELAX_RE 는 situation + preference 에 대해 검사.
 */
const SOUR_NAME_RE = /레몬|라임|자몽|유자|깔라만시|매실|lemon|lime|grapefruit/i;
const RELAX_RE = /휴식|디저트|릴랙스|편안|차분|힐링/;

/**
 * SPEC §5.4 fallback 후보 목록 (위에서부터 우선). t = 맛 취향(없으면 2.5), c = 장착 상태·요청 조건.
 * 술 후보는 strength ≠ none 이고 user.adultVerified === true(만 19세 이상 확인)일 때만.
 * '진 · 보드카 · 화이트 럼' 은 한 줄: 제외되지 않은 첫 이름 1개만 사용.
 */
const EXPLORE_CANDIDATES = [
  { names: ['탄산수'], category: 'soda', abv: 0, when: (t, c) => !c.has('soda') && t.fizzy >= 2 },
  { names: ['토닉워터'], category: 'soda', abv: 0, when: (t, c) => !c.has('soda') || t.bitter >= 2 },
  { names: ['레몬즙'], category: 'juice', abv: 0, when: (t, c) => !c.hasSour && t.sour >= 2 },
  { names: ['설탕시럽'], category: 'syrup', abv: 0, when: (t, c) => !c.has('syrup') && t.sweet >= 2 },
  { names: ['그레나딘 시럽'], category: 'syrup', abv: 0, when: (t, c) => !c.has('syrup') },
  { names: ['크랜베리주스'], category: 'juice', abv: 0, when: (t, c) => c.count('juice') <= 1 },
  { names: ['우유'], category: 'dairy', abv: 0, when: (t, c) => !c.has('dairy') && c.relax },
  { names: ['진', '보드카', '화이트 럼'], category: 'spirit', abv: 40, when: (t, c) => c.strength !== 'none' && !c.has('spirit') && c.adult },
  { names: ['트리플섹'], category: 'liqueur', abv: 30, when: (t, c) => c.strength !== 'none' && !c.has('liqueur') && c.adult },
];
/** 조건을 만족하는 후보가 없을 때 채우는 순서 */
const EXPLORE_FILL = ['탄산수', '레몬즙', '설탕시럽'];
/** 장착 재료만으로는 '양을 채울 기본 재료'가 없을 때(빈 기기 등) 함께 권할 두 번째 새 재료 */
const EXPLORE_PARTNERS = {
  탄산수: ['레몬즙', '크랜베리주스'],
  토닉워터: ['레몬즙', '크랜베리주스'],
  레몬즙: ['탄산수', '토닉워터', '크랜베리주스'],
  설탕시럽: ['탄산수', '크랜베리주스'],
  '그레나딘 시럽': ['탄산수', '우유'],
  크랜베리주스: ['탄산수', '토닉워터'],
  우유: ['그레나딘 시럽', '설탕시럽'],
  진: ['토닉워터', '탄산수'],
  보드카: ['크랜베리주스', '토닉워터'],
  '화이트 럼': ['탄산수', '크랜베리주스'],
  트리플섹: ['크랜베리주스', '탄산수'],
};
/** 탐색 카드 이름에 쓸 짧은 말 (예: "리프레시 토닉 에이드") */
const EXPLORE_LABEL = {
  탄산수: '스파클링', 토닉워터: '토닉', 레몬즙: '레몬', 설탕시럽: '스위트', '그레나딘 시럽': '그레나딘',
  크랜베리주스: '크랜베리', 우유: '밀키', 진: '진', 보드카: '보드카', '화이트 럼': '럼', 트리플섹: '오렌지',
};
const CANDIDATE_BY_NAME = new Map();
for (const cand of EXPLORE_CANDIDATES) {
  for (const n of cand.names) CANDIDATE_BY_NAME.set(n, { name: n, category: cand.category, abv: cand.abv });
}

const VIRTUAL_PUMP = 101; // 미장착(가상) 재료용 펌프 번호 — 결과(installed:false 줄)에는 남지 않음
const VIRTUAL_PUMP2 = 102;

/**
 * 탐색 제안(원본) 만들기. 개수: mode explore 최대 3개, normal 1개 (SPEC §5.4).
 * - 후보 목록을 위에서부터 조건 검사. 장착된 재료와 이름이 같거나(SPEC §3.1 normName),
 *   거절 기록(rejected)에 2번 이상 나온 재료, 성향에 '싫어/알레르기' 로 적힌 재료는 제외.
 *   무알콜이거나 성인 확인 전(user.adultVerified !== true)이면 술 후보 제외 — 아래 채우기·안전장치에서도.
 * - 조건을 만족하는 후보가 없으면 탄산수 → 레몬즙 → 설탕시럽 순으로 채움.
 * - 각 후보로 [쓸 수 있는 장착 재료 + 새 재료] 레시피를 composeRecipe 로 만들고, 장착 재료를 하나도 못 쓰거나
 *   양을 채울 기본 재료가 없으면(빈 기기 등) 두 번째 새 재료(EXPLORE_PARTNERS)를 함께 권함 → 미장착 최대 2개.
 * 결과는 normalizeExplore() 로 보정해서 사용.
 */
function buildFallbackExplore(user, ingredients, history = [], { mode = 'normal' } = {}) {
  const max = EXPLORE_MAX[mode === 'explore' ? 'explore' : 'normal'];
  const strength = user.strength || 'none';
  const adult = user.adultVerified === true;
  const tasteOf = (k) => (user.taste && Number.isFinite(user.taste[k]) ? user.taste[k] : 2.5);
  const t = { sweet: tasteOf('sweet'), sour: tasteOf('sour'), bitter: tasteOf('bitter'), fizzy: tasteOf('fizzy') };
  const installedKeys = new Set(ingredients.map((i) => nameKey(i.name)));
  const cats = ingredients.map((i) => i.category);
  const c = {
    strength,
    adult,
    has: (cat) => cats.includes(cat),
    count: (cat) => cats.filter((x) => x === cat).length,
    hasSour: ingredients.some((i) => SOUR_NAME_RE.test(i.name)),
    relax: RELAX_RE.test(`${user.situation || ''} ${user.preference || ''}`),
  };
  // 거절 기록에 반복(2번 이상) 등장한 재료
  const rejectCount = new Map();
  for (const h of history || []) {
    if (!h || !h.rejected || !Array.isArray(h.ingredients)) continue;
    for (const k of new Set(h.ingredients.map((i) => nameKey(i.name)))) rejectCount.set(k, (rejectCount.get(k) || 0) + 1);
  }
  const excluded = (name, { ignoreRejected = false } = {}) =>
    installedKeys.has(nameKey(name)) ||
    (!ignoreRejected && (rejectCount.get(nameKey(name)) || 0) >= 2) ||
    excludedByPreference({ name }, user.preference) ||
    ((strength === 'none' || !adult) && (CANDIDATE_BY_NAME.get(name) || { abv: 0 }).abv > 0);

  const picked = [];
  const take = (name) => {
    if (picked.length >= max || picked.some((p) => p.name === name)) return;
    picked.push(CANDIDATE_BY_NAME.get(name));
  };
  for (const cand of EXPLORE_CANDIDATES) {
    if (picked.length >= max) break;
    if (!cand.when(t, c)) continue;
    const name = cand.names.find((n) => !excluded(n));
    if (name) take(name);
  }
  if (!picked.length) for (const n of EXPLORE_FILL) if (!excluded(n)) take(n);
  // (안전장치) 그래도 없으면 조건 무시 → 거절 기록 무시 순으로 1개 이상 확보
  if (!picked.length) for (const n of CANDIDATE_BY_NAME.keys()) if (!excluded(n)) take(n);
  if (!picked.length) for (const n of CANDIDATE_BY_NAME.keys()) if (!excluded(n, { ignoreRejected: true })) take(n);

  // 쓸 수 있는 장착 재료 (잔량 5ml 이상, 무알콜 요청이면 술 제외)
  const usable = ingredients.filter((i) => (i.remainingMl == null || i.remainingMl >= 5) && (strength !== 'none' || i.abv === 0));
  const isBase = (ing) => ing.abv === 0 && ing.category !== 'syrup' && ingredientProfile(ing).sour < 5;
  const out = [];
  const combos = new Set();
  const comboOf = (r) => comboKey(r.ingredients.map((l) => l.name));
  for (const cand of picked) {
    const v1 = { pump: VIRTUAL_PUMP, name: cand.name, category: cand.category, abv: cand.abv, remainingMl: null, notes: '' };
    let pool = [...usable, v1];
    let raw = composeRecipe(user, pool, history, { force: [VIRTUAL_PUMP] });
    let partner = null;
    const lineIngs = (r) => (r ? r.ingredients.map((l) => pool.find((x) => x.pump === l.pump)).filter(Boolean) : []);
    const needsPartner = (r) => !r || !lineIngs(r).some((x) => x.pump < 100) || !lineIngs(r).some(isBase);
    if (needsPartner(raw) || combos.has(comboOf(raw))) {
      const options = (EXPLORE_PARTNERS[cand.name] || []).filter((n) => n !== cand.name && !excluded(n, { ignoreRejected: true }));
      for (const pn of options) {
        const pc = CANDIDATE_BY_NAME.get(pn);
        const p = { pump: VIRTUAL_PUMP2, name: pn, category: pc.category, abv: pc.abv, remainingMl: null, notes: '' };
        const pool2 = [...usable, v1, p];
        const r2 = composeRecipe(user, pool2, history, { force: [VIRTUAL_PUMP, VIRTUAL_PUMP2] });
        if (!r2 || combos.has(comboOf(r2))) continue;
        partner = p;
        pool = pool2;
        raw = r2;
        break;
      }
    }
    if (!raw || !raw.ingredients.some((l) => l.pump === VIRTUAL_PUMP) || combos.has(comboOf(raw))) continue;
    combos.add(comboOf(raw));
    const lines = raw.ingredients.map((l) =>
      l.pump < 100 ? { name: l.name, ml: l.ml, installed: true, pump: l.pump } : { name: l.name, ml: l.ml, installed: false }
    );
    const message = partner
      ? `${josa(cand.name, '과', '와')} ${josa(partner.name, '을', '를')} 비어 있거나 잘 안 쓰는 펌프에 장착하면 만들 수 있어요.`
      : `${josa(cand.name, '을', '를')} 비어 있거나 잘 안 쓰는 펌프에 장착하면 만들 수 있어요.`;
    out.push({
      addIngredient: cand.name,
      category: cand.category,
      abv: cand.abv,
      recipeName: raw.style ? `${raw.style.prefix} ${EXPLORE_LABEL[cand.name] || cand.name} ${raw.style.noun}` : raw.name,
      description: raw.description,
      ingredients: lines,
      message,
    });
  }
  return out;
}

module.exports = {
  buildFallbackRecipe,
  buildFallbackExplore,
  composeRecipe,
  rejectedCombos,
  comboKey,
  EXPLORE_CANDIDATES,
  desiredTaste,
  scoreIngredient,
  excludedByPreference,
  preferenceExcludedPumps,
  NO_ALCOHOL_INFO,
  NO_ALCOHOL_INFO_ADULT,
  // SPEC §5.4 후보 조건에 쓰는 정규식 (앱 오프라인 탐색과 같은 문자열로 맞출 것)
  SOUR_NAME_RE,
  RELAX_RE,
};
