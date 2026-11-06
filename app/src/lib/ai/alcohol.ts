/**
 * 이름만 보고 술인지 추정 — 백엔드 backend/lib/alcohol.js 와 같은 정규식·목록 (SPEC §3.2, §5.4)
 *  - 무알콜 요청이나 성인 확인 전(adultVerified !== true)에 술을 권하는 제안(add_ingredient/substitute) 지우기
 *    (normalize.ts sanitizeSuggestions·isAlcoholSuggestion — SPEC §3.2)
 *  - 성인 확인 전(adultVerified=false) 탐색 결과에서 술을 새로 장착하라는 항목 버리기 (explore.ts parseExplore)
 * 순수 함수 (React Native 비의존).
 */
import type { Category } from '../types';

/**
 * 백엔드 ALCOHOL_NAME_RE 와 같은 문자열 (parity 테스트에서 source 를 비교).
 * 럼·진은 이름 하나뿐 아니라 문장 속('럼을 장착하면…')에서도 잡음 — 앞은 문자열 처음·한글 아닌 글자, 뒤는 끝·한글 아닌 글자·조사.
 * '처럼'·'드럼'·'럼주스'·'진저에일'·'진토닉'·'진하게'·'매실주스'·'블루큐라소(무알콜 시럽)'는 술로 보지 않음 (자세한 설명은 백엔드 alcohol.js)
 */
export const ALCOHOL_NAME_RE =
  /보드카|vodka|위스키|whisk|데킬라|테킬라|tequila|브랜디|brandy|코냑|리큐르|리큐어|liqueur|와인|wine|샴페인|champagne|맥주|beer|소주|사케|막걸리|동동주|고량주|매실주(?!스)|복분자주(?!스)|트리플\s*섹|triple\s*sec|쿠앵트로|cointreau|오렌지\s*큐라소|orange\s*cura[cç]ao|그랑\s*마르니에|grand\s*marnier|아마레또|amaretto|미도리|midori|압생트|absinthe|깔루아|kahlua|피치\s*트리|peach\s*tree|말리부|malibu|슈냅스|schnapps|코코넛\s*럼|베일리스|baileys|캄파리|campari|아페롤|aperol|버무스|vermouth|예거|jäger|(?:^|[^가-힣])(?:(?:화이트|다크|골드|라이트|스파이스드|블랙)\s*)?럼(?:주(?!스))?(?=$|[^가-힣]|[을를이가은는과와도만으로의에랑])|\brum\b|(?:^|[^가-힣])(?:(?:런던\s*)?드라이\s*)?진(?=$|[^가-힣]|[을이은과만으의에랑])|\bgin\b/i;

/** 술 종류(category) — 증류주·리큐르·발효주(와인/맥주) */
export const ALCOHOL_CATEGORIES: Category[] = ['spirit', 'liqueur', 'wine'];

/** 이름이 술 이름 목록에 해당하는지 (도수를 모르는 미장착 재료·제안 문구용) */
export function looksAlcoholic(name: unknown): boolean {
  return ALCOHOL_NAME_RE.test(String(name || ''));
}
