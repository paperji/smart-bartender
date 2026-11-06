/**
 * 성향(자유 입력)에서 알레르기·싫어하는 재료 찾기 — SPEC §3.3 규칙 1 (백엔드 backend/lib/fallback.js 를 그대로 옮김)
 *
 * 쓰는 곳 (모두 이 함수 하나로 판정):
 *  - 레시피 보정 규칙 1·8: normalizeRecipe 의 excludePumps (장착 재료에서 빼고, 도수 보정 때 섞을 재료로도 고르지 않음)
 *  - 오프라인 추천의 재료 고르기, 오프라인 탐색 후보·짝 재료 제외 (SPEC §5.4)
 *  - 성향으로 모두 빠졌을 때의 안내 문구 (recommend.ts noUsableMessage)
 * 순수 함수 (React Native 비의존).
 */
import type { IngredientInfo } from '../types';
import { normName } from './normalize';

/**
 * 성향 문장을 절(clause)로 나누는 기준: 문장부호·대조 접속('지만', '는데' …).
 * 쉼표와 '그리고'로는 나누지 않음 — '우유, 사이다는 빼 주세요' 같은 나열을 한 절로 유지(알레르기 누락 방지).
 */
export const PREF_CLAUSE_SPLIT = /[.!?;~\n\/]|근데|그런데|하지만|지만|는데|은데|인데/;
/** 부정(빼 달라는) 표현 */
export const PREF_NEG_RE = /싫|빼|제외|알레르기|알러지|못먹|안먹|안넣|넣지마|넣지말|넣지않|없이|안좋|좋지않|별로/;
/** 긍정 표현 — 재료 바로 뒤에 부정보다 먼저 나오면 '좋아하는 재료' */
export const PREF_POS_RE = /좋|최고|사랑|원해|넣어/;
/** 재료 이름 뒤 몇 글자 안에서 부정 표현을 찾을지 (정규화된 글자 수) */
export const PREF_AFTER_WINDOW = 10;
/** '알레르기: 우유, 땅콩' 처럼 이름 앞에 오는 알레르기 표시를 볼 범위 */
export const PREF_BEFORE_WINDOW = 12;
/** 이름 앞에 오면 제외로 보는 표시 */
const PREF_BEFORE_RE = /알레르기|알러지|제외/;

/**
 * 성향 입력에서 '싫어/빼줘/알레르기' 가 **그 재료에** 걸려 있으면 true.
 * 문장을 절로 나눈 뒤(마침표·느낌표·'지만'·'는데' 등), 같은 절 안에서
 *  - 재료 이름 바로 뒤(10글자 안)에 부정 표현이 긍정 표현보다 먼저 나오거나
 *    ('우유는 싫어요', '우유 알레르기', '우유, 사이다는 빼 주세요', '우유는 안 좋아해요')
 *  - 이름 앞(12글자 안)에 '알레르기/알러지/제외' 가 있고 이름 뒤에 긍정 표현이 없으면 ('알레르기: 우유, 땅콩')
 * 제외. 'A 좋아요. B 싫어요', 'A는 좋고 B는 싫어요' 에서 A 는 제외하지 않음.
 * 이름은 SPEC §3.1 normName 으로 비교, 2글자 미만 이름('진' 등)은 판정하지 않음 (백엔드와 같음).
 * ing: 재료 객체({ name }) 또는 이름 문자열
 */
export function excludedByPreference(
  ing: { name?: unknown } | string | null | undefined,
  pref: string | null | undefined,
): boolean {
  if (!pref) return false;
  const name = normName(typeof ing === 'string' ? ing : ing?.name);
  if (!name || name.length < 2) return false;
  for (const clause of String(pref).split(PREF_CLAUSE_SPLIT)) {
    const c = normName(clause);
    for (let at = c.indexOf(name); at >= 0; at = c.indexOf(name, at + 1)) {
      const after = c.slice(at + name.length, at + name.length + PREF_AFTER_WINDOW);
      const neg = after.search(PREF_NEG_RE);
      const pos = after.search(PREF_POS_RE);
      if (neg >= 0 && (pos < 0 || neg <= pos)) return true;
      const before = c.slice(Math.max(0, at - PREF_BEFORE_WINDOW), at);
      if (PREF_BEFORE_RE.test(before) && pos < 0) return true;
    }
  }
  return false;
}

/** 성향(알레르기·싫어하는 재료)으로 뺄 장착 재료의 펌프 번호 Set — normalizeRecipe 의 excludePumps 로 넘김 */
export function preferenceExcludedPumps(
  ingredients: Pick<IngredientInfo, 'pump' | 'name'>[] | null | undefined,
  preference: string | null | undefined,
): Set<number> {
  return new Set((ingredients ?? []).filter((i) => excludedByPreference(i, preference)).map((i) => i.pump));
}
