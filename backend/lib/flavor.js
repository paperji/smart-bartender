'use strict';
/**
 * 재료 맛 프로필(휴리스틱) — 규칙기반 추천(fallback)과 flavor 추정에 공통 사용.
 * 순수 함수만 사용(Node 전용 API 없음) → 앱(React Native)에도 그대로 옮겨 쓸 수 있습니다.
 *
 * 프로필 값은 0~5 (sweet=단맛, sour=신맛, bitter=쓴맛, fizzy=탄산감).
 * 1) category 기본값 → 2) 재료 이름 키워드(첫 번째로 맞는 규칙 1개)로 덮어쓰기.
 */

const TASTE_KEYS = ['sweet', 'sour', 'bitter', 'fizzy'];

const CATEGORY_PROFILE = {
  spirit: { sweet: 0, sour: 0, bitter: 1, fizzy: 0 },
  liqueur: { sweet: 4, sour: 1, bitter: 1, fizzy: 0 },
  wine: { sweet: 1, sour: 2, bitter: 1, fizzy: 0 },
  syrup: { sweet: 5, sour: 0, bitter: 0, fizzy: 0 },
  juice: { sweet: 3, sour: 2, bitter: 0, fizzy: 0 },
  soda: { sweet: 1, sour: 0, bitter: 0, fizzy: 5 },
  dairy: { sweet: 2, sour: 0, bitter: 0, fizzy: 0 },
  water: { sweet: 0, sour: 0, bitter: 0, fizzy: 0 },
  other: { sweet: 1, sour: 1, bitter: 1, fizzy: 0 },
};

// 순서가 중요합니다: 위에서부터 검사해 처음 맞는 규칙 하나만 적용.
const NAME_RULES = [
  { re: /토닉|tonic/i, set: { sweet: 2, bitter: 2, fizzy: 4 } },
  { re: /맥주|beer|하이트|카스|테라|라거|lager/i, set: { sweet: 1, bitter: 3, fizzy: 4 } },
  { re: /콜라|cola|사이다|sprite|스프라이트|환타|fanta|진저\s*에일|ginger\s*ale|레모네이드|lemonade|탄산음료/i, set: { sweet: 3, fizzy: 4 } },
  { re: /탄산수|소다수|soda\s*water|sparkling|club\s*soda|페리에|트레비|씨그램/i, set: { sweet: 0, sour: 0, fizzy: 5 } },
  { re: /커피|coffee|에스프레소|espresso|깔루아|kahlua|콜드\s*브루/i, set: { sweet: 2, bitter: 4 } },
  { re: /캄파리|campari|아페롤|aperol|비터스|bitters|예거/i, set: { sweet: 2, bitter: 4 } },
  { re: /녹차|말차|홍차|보리차|우롱|tea/i, set: { sweet: 1, bitter: 2 } },
  { re: /초코|chocolate|카카오|cacao/i, set: { sweet: 4, bitter: 2 } },
  { re: /그레나딘|grenadine|시럽|syrup|꿀|honey|설탕|아가베/i, set: { sweet: 5 } },
  { re: /우유|milk|크림|cream|요거트|요구르트|yogurt|베일리스|baileys|두유/i, set: { sweet: 2, sour: 0 } },
  { re: /레몬|라임|lemon|lime|유자|자몽|grapefruit|깔라만시|매실/i, set: { sweet: 1, sour: 5 } },
  { re: /크랜베리|cranberry|석류|자두|블루베리|오미자/i, set: { sweet: 3, sour: 3 } },
  { re: /오렌지|orange|귤|감귤|한라봉|트리플\s*섹|triple\s*sec|쿠앵트로|cointreau/i, set: { sweet: 3, sour: 2 } },
  { re: /파인애플|pineapple|망고|mango|복숭아|peach|사과|apple|포도|grape|딸기|strawberry|바나나|banana|코코넛|coconut|리치|lychee|멜론|melon|수박/i, set: { sweet: 4, sour: 1 } },
];

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** 재료 1개의 맛 프로필 {sweet,sour,bitter,fizzy} (0~5) */
function ingredientProfile(ing) {
  const base = CATEGORY_PROFILE[ing && ing.category] || CATEGORY_PROFILE.other;
  const p = { ...base };
  const name = String((ing && ing.name) || '');
  for (const rule of NAME_RULES) {
    if (rule.re.test(name)) {
      Object.assign(p, rule.set);
      break;
    }
  }
  return p;
}

/** 완성 도수(%) → 체감 도수 0~5 (flavor.strength) */
function abvToStrengthLevel(abv) {
  const a = Number(abv) || 0;
  if (a <= 0) return 0;
  if (a <= 5) return 1;
  if (a <= 10) return 2;
  if (a <= 15) return 3;
  if (a <= 20) return 4;
  return 5;
}

/**
 * 레시피 재료(ml)로 맛 추정. items: [{pump, ml}], byPump: Map(pump → 재료)
 * ml 가중평균 v 를 체감 보정: 5 × (v/5)^0.7  (섞으면 묽어지지만 적은 비율도 맛은 꽤 느껴짐)
 * 반환: {sweet,sour,bitter,fizzy} 0~5 정수 (strength 는 호출측에서 도수로 계산)
 */
function estimateFlavor(items, byPump) {
  const acc = { sweet: 0, sour: 0, bitter: 0, fizzy: 0 };
  let total = 0;
  for (const it of items) {
    const ing = byPump.get(it.pump);
    if (!ing || !(it.ml > 0)) continue;
    const p = ingredientProfile(ing);
    for (const k of TASTE_KEYS) acc[k] += p[k] * it.ml;
    total += it.ml;
  }
  const out = {};
  for (const k of TASTE_KEYS) out[k] = total > 0 ? clampInt(5 * Math.pow(Math.max(0, acc[k] / total) / 5, 0.7), 0, 5) : 0;
  return out;
}

module.exports = {
  TASTE_KEYS,
  CATEGORY_PROFILE,
  NAME_RULES,
  ingredientProfile,
  abvToStrengthLevel,
  estimateFlavor,
  clampInt,
};
