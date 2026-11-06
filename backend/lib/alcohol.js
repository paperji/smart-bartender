'use strict';
/**
 * 이름만 보고 술인지 추정 (도수를 모르는 미장착 재료·제안 문구용).
 * recipe.js(제안 정리)와 explore.js(탐색 카드) 양쪽에서 쓰므로 순환 require 를 피하려고 따로 둠.
 * 순수 함수만 사용(Node 전용 API 없음).
 * 목록에는 앱 재료 프리셋(app/src/lib/presets.ts)의 술 이름·별칭(피치트리·말리부·피치슈냅스·코코넛 럼 등)도 모두 들어 있음
 * → 앱의 미장착 술 판정(프리셋 참고)과 같은 결과 (SPEC §5.4 '같은 목록', app/tests/parity.test.ts 로 확인).
 * 앱 app/src/lib/ai/alcohol.ts 의 ALCOHOL_NAME_RE 는 이 정규식과 **같은 문자열**이어야 함(parity 테스트가 source 비교).
 *
 * 럼·진: 이름 하나일 때뿐 아니라 문장 속('럼을 장착하면…', '진을 추가로…')에서도 잡도록
 *   앞 = 문자열 처음 또는 한글이 아닌 글자(공백·따옴표 등), 뒤 = 문자열 끝·한글이 아닌 글자·조사 로 경계를 둠.
 *   앞에 붙는 수식어(화이트·다크·골드·라이트·스파이스드·블랙 럼 / (런던) 드라이 진)는 붙여 써도 됨.
 *   오탐 방지: '처럼'·'드럼'(앞이 한글), '럼주스'·'럼블', '진저(에일)'·'진토닉'·'진로(토닉)'·'진하게'·'진짜'·'진도'(뒤가 조사가 아님)는 술로 보지 않음.
 *   ('진토닉 스타일' 문구는 SPEC §3.2 예시처럼 토닉워터 제안으로 유지)
 * 매실주·복분자주는 '매실주스'·'복분자주스'(무알콜)와 구분. 큐라소는 '오렌지 큐라소'만 — 앱 프리셋에서
 *   '블루큐라소'는 무알콜 시럽(블루큐라소시럽)의 별칭이라 술 목록에 넣지 않음.
 */

const ALCOHOL_NAME_RE =
  /보드카|vodka|위스키|whisk|데킬라|테킬라|tequila|브랜디|brandy|코냑|리큐르|리큐어|liqueur|와인|wine|샴페인|champagne|맥주|beer|소주|사케|막걸리|동동주|고량주|매실주(?!스)|복분자주(?!스)|트리플\s*섹|triple\s*sec|쿠앵트로|cointreau|오렌지\s*큐라소|orange\s*cura[cç]ao|그랑\s*마르니에|grand\s*marnier|아마레또|amaretto|미도리|midori|압생트|absinthe|깔루아|kahlua|피치\s*트리|peach\s*tree|말리부|malibu|슈냅스|schnapps|코코넛\s*럼|베일리스|baileys|캄파리|campari|아페롤|aperol|버무스|vermouth|예거|jäger|(?:^|[^가-힣])(?:(?:화이트|다크|골드|라이트|스파이스드|블랙)\s*)?럼(?:주(?!스))?(?=$|[^가-힣]|[을를이가은는과와도만으로의에랑])|\brum\b|(?:^|[^가-힣])(?:(?:런던\s*)?드라이\s*)?진(?=$|[^가-힣]|[을이은과만으의에랑])|\bgin\b/i;

/** 술 종류(category) — 증류주·리큐르·발효주(와인/맥주) */
const ALCOHOL_CATEGORIES = ['spirit', 'liqueur', 'wine'];

function looksAlcoholic(name) {
  return ALCOHOL_NAME_RE.test(String(name || ''));
}

module.exports = { ALCOHOL_NAME_RE, ALCOHOL_CATEGORIES, looksAlcoholic };
