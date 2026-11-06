/// <reference types="node" />
/**
 * 백엔드(backend/lib/*.js) ↔ 앱(src/lib/ai/*.ts) 결과 비교 (parity) — 같은 입력을 양쪽에 넣고 결과가 같은지 확인
 *  - SPEC §3.3 규칙 1 성향 제외(excludedByPreference / preferenceExcludedPumps) — 성향 문장 코퍼스 42개 × 재료 이름
 *  - 규칙 1·8 이 들어간 최종 보정(finalizeRecipe ↔ normalizeRecipe + excludePumps), NO_MIXER·반올림
 *  - SPEC §3.2 무알콜·성인 확인 전 술 제안 제거(sanitizeSuggestions(…, adultVerified)), 술 이름 판별(alcohol)
 *  - SPEC §5.4 adultVerified on/off 탐색(normalizeExplore ↔ parseExplore, 규칙기반 후보, 서버 fallback ↔ 앱 오프라인)
 *  - SPEC §3.3 규칙 8 NO_MIXER explore 카드 거르기(addsSoftIngredient·filterNoMixerExplore, 규칙기반·가짜 AI 결과 채우기)
 *  - SPEC §3.1 422 판정(서버 핸들러 ↔ 앱 사전 판정), Gemini 오류 분류(classify ↔ classifyGeminiError)
 * 백엔드 핸들러는 GEMINI_API_KEY 를 비운 채로만 부름(실제 Gemini 호출 없음 — 422 는 AI 호출 전, 그 밖은 NO_API_KEY → 규칙기반).
 * AI 결과 비교는 백엔드 gemini.generateRecipe 자리를 가짜 함수로, 앱은 가짜 fetch 로 같은 JSON 을 넣음(네트워크 없음).
 * 실행: npm test (backend 폴더가 없으면 skip)
 * v3.0: 앱의 서버 모드 제거 — "앱이 서버 응답을 다시 검증" 비교는 같은 원본을 Gemini(사용자 키, 가짜 fetch) 응답으로 넣는 비교로 옮기거나
 *       (성인 확인 전 suggestions) 순수 함수 재검증(normalizeRecipe scaleToCup:false — 무작위 비교)으로 남김. 서버 대기 시간(50초) 비교는 지움.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

import { ALCOHOL_CATEGORIES, ALCOHOL_NAME_RE, looksAlcoholic } from '../src/lib/ai/alcohol';
import { addsSoftIngredient, filterNoMixerExplore, parseExplore, uninstalledIsAlcohol } from '../src/lib/ai/explore';
import { cleanText, normalizeRecipe, normName, RecipeError, sanitizeSuggestions } from '../src/lib/ai/normalize';
import { OFFLINE_NO_ALCOHOL_INFO, OFFLINE_NO_ALCOHOL_INFO_ADULT } from '../src/lib/ai/offline';
import { exploreCandidates, offlineExplore } from '../src/lib/ai/offline-explore';
import { excludedByPreference, preferenceExcludedPumps } from '../src/lib/ai/preference';
import { buildResponseSchema, buildUserPrompt } from '../src/lib/ai/prompt';
import {
  buildRequest,
  classifyGeminiError,
  generateRecipe,
  lacksMixer,
  slotsToIngredients,
  targetHint,
  usableIngredients,
} from '../src/lib/ai/recommend';
import { findExactPreset, PRESETS } from '../src/lib/presets';
import type { ExploreItem, IngredientInfo, PumpSlot, Strength, UserInput } from '../src/lib/types';

// 백엔드 핸들러가 실제 Gemini 를 부르지 않도록 (키 없음 → NO_API_KEY → 규칙기반)
process.env.GEMINI_API_KEY = '';

const requireBackend = createRequire(path.join(import.meta.dirname, 'x.js'));
function load(rel: string): any | null {
  try {
    return requireBackend(`../../backend/${rel}`);
  } catch {
    return null;
  }
}
const BE = {
  recipe: load('lib/recipe.js'),
  fallback: load('lib/fallback.js'),
  explore: load('lib/explore.js'),
  alcohol: load('lib/alcohol.js'),
  gemini: load('lib/gemini.js'),
  prompt: load('lib/prompt.js'),
  api: load('api/index.js'),
};
const noBackend = !BE.recipe || !BE.fallback || !BE.explore || !BE.alcohol ? 'backend/lib 를 불러올 수 없음' : false;

// ───────────────────────── 성향 문장 코퍼스 (SPEC §3.3 규칙 1) ─────────────────────────

const PREF_CORPUS = [
  '우유 알레르기',
  '알레르기: 우유, 땅콩',
  '우유는 좋고 사이다는 싫어요',
  '우유, 사이다는 빼 주세요',
  '진저에일 좋아요. 레몬 싫어요',
  '우유 좋아요',
  '우유는 싫어요',
  '우유는 안 좋아해요',
  '사이다 빼고 콜라 넣어 주세요',
  '땅콩 알러지가 있어요',
  '탄산은 싫어요',
  '토닉워터 최고! 콜라는 별로',
  '레몬즙 없이 만들어 주세요',
  '오렌지주스를 사랑해요',
  '자몽주스는 못 먹어요',
  '크랜베리주스 넣지 마세요',
  '보드카는 원해요 하지만 진은 싫어요',
  '단 거 좋아해요',
  '오늘은 상큼한 게 좋아요',
  '설탕시럽은 조금만',
  '그레나딘 시럽 제외',
  '제외할 재료: 콜라',
  '우유랑 사이다 둘 다 좋아요',
  '코코넛밀크 알레르기 있어요, 파인애플주스는 괜찮아요',
  'I hate milk',
  '사이다는 별로지만 콜라는 좋아요',
  '레몬은 좋은데 라임은 싫어',
  '토닉워터/탄산수 빼주세요',
  '우유 들어간 건 싫어요',
  '콜라 넣어 주세요. 사이다 넣지 말고요',
  '오렌지주스 안 넣었으면 해요',
  '땅콩, 우유 알레르기',
  '레몬 레몬 레몬 좋아',
  '사이다~ 싫어',
  '보드카 좋지 않아요',
  '진저에일은 최고예요 근데 탄산수는 별로예요',
  '',
  '알레르기 없어요. 아무거나 좋아요',
  '우유가 들어가면 배가 아파서 빼 주세요',
  '설탕시럽, 그레나딘 시럽 넣어',
  '(우유) 알레르기 있음; 오렌지 주스는 OK',
  'Coke 싫어, sprite 좋아',
];
const PREF_NAMES = [
  '우유', '사이다', '땅콩', '진저에일', '레몬', '레몬즙', '오렌지주스', '오렌지 주스', '토닉워터', '콜라', '탄산수',
  '자몽주스', '크랜베리주스', '보드카', '진', '설탕시럽', '그레나딘 시럽', '코코넛밀크', '파인애플주스', '라임', 'coke', 'Sprite',
];

test('규칙 1 성향 제외: 코퍼스 42개 × 재료 이름 — 앱 excludedByPreference = 백엔드 (+ 대표 문장 기대값)', { skip: noBackend }, () => {
  assert.ok(PREF_CORPUS.length >= 30, `코퍼스 ${PREF_CORPUS.length}개`);
  let compared = 0;
  for (const pref of PREF_CORPUS) {
    for (const name of PREF_NAMES) {
      const app = excludedByPreference({ name }, pref);
      const be = BE.fallback.excludedByPreference({ name }, pref);
      assert.equal(app, be, `'${pref}' / '${name}': 앱 ${app}, 백엔드 ${be}`);
      assert.equal(excludedByPreference(name, pref), app, '문자열 인자도 같은 결과');
      compared++;
    }
  }
  assert.ok(compared >= 30 * PREF_NAMES.length);
  // 대표 문장 (SPEC §3.3 규칙 1 설명과 같은 판정)
  const ex = (pref: string, name: string) => excludedByPreference({ name }, pref);
  assert.equal(ex('우유 알레르기', '우유'), true);
  assert.equal(ex('알레르기: 우유, 땅콩', '우유'), true);
  assert.equal(ex('알레르기: 우유, 땅콩', '땅콩'), true);
  assert.equal(ex('우유는 좋고 사이다는 싫어요', '우유'), false, '좋고 → 우유는 제외 안 함');
  assert.equal(ex('우유는 좋고 사이다는 싫어요', '사이다'), true);
  assert.equal(ex('우유, 사이다는 빼 주세요', '우유'), true, '쉼표로 나누지 않음 → 나열 모두 제외');
  assert.equal(ex('우유, 사이다는 빼 주세요', '사이다'), true);
  assert.equal(ex('진저에일 좋아요. 레몬 싫어요', '진저에일'), false, '마침표로 절을 나눔');
  assert.equal(ex('진저에일 좋아요. 레몬 싫어요', '레몬'), true);
  assert.equal(ex('사이다는 별로지만 콜라는 좋아요', '콜라'), false, "'지만' 으로 절을 나눔");
  assert.equal(ex('우유 좋아요', '우유'), false);
  assert.equal(ex('보드카는 원해요 하지만 진은 싫어요', '진'), false, '2글자 미만 이름은 판정하지 않음');
});

test('preferenceExcludedPumps: 앱 = 백엔드 (장착 재료 × 코퍼스)', { skip: noBackend }, () => {
  const ings: IngredientInfo[] = PREF_NAMES.slice(0, 8).map((name, i) => ({ pump: i + 1, name, category: 'other', abv: 0, remainingMl: 500, notes: '' }));
  for (const pref of PREF_CORPUS) {
    const app = [...preferenceExcludedPumps(ings, pref)].sort();
    const be = [...BE.fallback.preferenceExcludedPumps(ings, pref)].sort();
    assert.deepEqual(app, be, `'${pref}'`);
  }
});

// ───────────────────────── 이름 비교·술 이름 판별 ─────────────────────────

test('normName·술 이름 판별(ALCOHOL_NAME_RE·ALCOHOL_CATEGORIES·looksAlcoholic): 앱 = 백엔드', { skip: noBackend }, () => {
  assert.equal(ALCOHOL_NAME_RE.source, BE.alcohol.ALCOHOL_NAME_RE.source);
  assert.equal(ALCOHOL_NAME_RE.flags, BE.alcohol.ALCOHOL_NAME_RE.flags);
  if (BE.alcohol.ALCOHOL_CATEGORIES) assert.deepEqual(ALCOHOL_CATEGORIES, BE.alcohol.ALCOHOL_CATEGORIES);
  const names = [
    '보드카', 'Vodka', '진', ' 드라이 진 ', '진저에일', '진토닉', 'gin', 'ginger ale', '럼', '화이트 럼', '다크럼', '럼주스', 'rum', 'drum',
    '트리플 섹', 'Triple Sec', '깔루아', '맥주', '무알콜 맥주', '와인', '레드와인', '소주', '사케', '피치트리', '말리부', '탄산수', '오렌지주스',
    '위스키', 'whiskey', '예거마이스터', 'Jägermeister', '', '토닉워터를 장착하면 진토닉 스타일', '위스키와 어울려요',
  ];
  for (const n of names) assert.equal(looksAlcoholic(n), BE.alcohol.looksAlcoholic(n), n);
  for (const n of ['그레나딘-시럽', '레몬·라임 주스', "Ginger_Ale (캔)", '[우유]', '"토닉" 워터', 'A.B,C']) {
    assert.equal(normName(n), BE.recipe.normName(n), n);
  }
});

// ───────────────────────── 최종 보정 (규칙 1~9, 성향 제외 + NO_MIXER·반올림) ─────────────────────────

const POOL: IngredientInfo[] = [
  { pump: 1, name: '보드카', category: 'spirit', abv: 40, remainingMl: 650, notes: '' },
  { pump: 2, name: '우유', category: 'dairy', abv: 0, remainingMl: 900, notes: '' },
  { pump: 3, name: '사이다', category: 'soda', abv: 0, remainingMl: 1000, notes: '' },
  { pump: 4, name: '오렌지주스', category: 'juice', abv: 0, remainingMl: 900, notes: '' },
  { pump: 5, name: '진저에일', category: 'soda', abv: 0, remainingMl: 800, notes: '' },
  { pump: 6, name: '레몬즙', category: 'juice', abv: 0, remainingMl: 60, notes: '' },
  { pump: 7, name: '트리플섹', category: 'liqueur', abv: 30, remainingMl: 500, notes: '' },
  { pump: 8, name: '맥주', category: 'wine', abv: 4.5, remainingMl: 500, notes: '' },
];
/** 앞 8개만 쓰임(백엔드·앱 모두 list.slice(0, 8)) */
const RAW_SUGGESTIONS = [
  { type: 'add_ingredient', ingredient: '토닉워터', message: "토닉워터를 추가 장착하면 쌉싸름한 '진토닉 스타일'도 만들 수 있어요." },
  { type: 'add_ingredient', ingredient: '진저에일', message: '진저에일을 장착하면 청량해요.' },
  { type: 'add_ingredient', ingredient: '보드카', message: '보드카를 장착하면 칵테일도 만들 수 있어요.' },
  { type: 'substitute', ingredient: '럼', message: '럼 대신 보드카를 써도 좋아요.' },
  { type: 'substitute', pump: 1, message: '펌프 1 재료를 줄여 보세요.' },
  { type: 'add_ingredient', ingredient: '탄산수', message: '탄산수를 장착하면 위스키 하이볼도 가능해요.' },
  { type: 'info', message: '보드카를 넣으면 더 좋아요.' },
  { type: 'low_stock', ingredient: '레몬즙', message: '레몬즙이 얼마 안 남았어요.' },
  { type: 'add_ingredient', ingredient: '오렌지주스', message: '오렌지주스를 장착하세요.' },
  { type: 'substitute', ingredient: 'Vodka', message: 'Use vodka.' },
  { type: 'weird', message: '알 수 없는 종류' },
  { type: 'add_ingredient', ingredient: '그레나딘 시럽', message: '그레나딘 시럽으로 색을 내요.' },
];

test('최종 보정: 앱 normalizeRecipe(excludePumps, adultVerified) = 백엔드 finalizeRecipe — 성향·NO_MIXER·반올림·제안 정리(성인 확인 on/off/생략) 포함 600건', { skip: noBackend }, () => {
  let seed = 20261106;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const strengths: Strength[] = ['none', 'light', 'medium', 'strong'];
  let ok = 0;
  const codes = new Map<string, number>();
  let prefCut = 0;
  let adultCut = 0;
  for (let n = 0; n < 600; n++) {
    const cupMl = pick([30, 100, 150, 200, 250, 333, 500]);
    const strength = pick(strengths);
    const ing = POOL.filter(() => rnd() < 0.6).map((i) => ({ ...i, remainingMl: rnd() < 0.2 ? Math.round(rnd() * 40) : Math.round(rnd() * 900) }));
    if (!ing.length) ing.push({ ...POOL[0] });
    const pref = pick(PREF_CORPUS);
    const items = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => {
      const it = pick(ing);
      return rnd() < 0.1 ? { pump: 9, name: '없는재료', ml: 30 } : { pump: it.pump, name: it.name, ml: Math.round((rnd() * 260 - 10) * 10) / 10 };
    });
    const suggestions = RAW_SUGGESTIONS.filter(() => rnd() < 0.4);
    const raw = { name: '테스트', ingredients: items, flavor: { sweet: 3, sour: 2, bitter: 1, fizzy: 4 }, suggestions };
    const appEx = preferenceExcludedPumps(ing, pref);
    const beEx = BE.fallback.preferenceExcludedPumps(ing, pref);
    assert.deepEqual([...appEx].sort(), [...beEx].sort());
    if (appEx.size) prefCut++;
    // 성인 확인 on/off/생략(SPEC §3.2 — 확인 전이면 술 장착·대체 제안 제거). 난수 순서를 바꾸지 않게 n 으로 고름
    const adultVerified = n % 3 === 0 ? undefined : n % 3 === 1;
    const adultOpt = adultVerified === undefined ? {} : { adultVerified };
    let app: any = null;
    let appCode = '';
    try {
      app = normalizeRecipe(raw, { ingredients: ing, strength, cupMl, excludePumps: appEx, ...adultOpt }).recipe;
    } catch (e) {
      assert.ok(e instanceof RecipeError, String(e));
      appCode = e.code;
    }
    const be = BE.recipe.finalizeRecipe(raw, ing, { cupMl, strength, excludePumps: beEx, ...adultOpt });
    if (!be.ok) {
      assert.equal(app, null, `#${n} 백엔드는 실패(${be.code}), 앱은 성공`);
      assert.equal(appCode, be.code, `#${n} 실패 코드`);
      codes.set(be.code, (codes.get(be.code) ?? 0) + 1);
      continue;
    }
    assert.ok(app, `#${n} 앱은 실패(${appCode}), 백엔드는 성공`);
    assert.deepEqual(
      app.ingredients.map((i: any) => [i.pump, i.ml]),
      be.recipe.ingredients.map((i: any) => [i.pump, i.ml]),
      `#${n} 재료`,
    );
    for (const i of app.ingredients) assert.ok(!appEx.has(i.pump), `#${n} 성향으로 뺀 펌프 ${i.pump} 가 들어감`);
    assert.equal(app.totalMl, be.recipe.totalMl, `#${n} totalMl`);
    assert.ok(app.totalMl <= cupMl + 1e-9, `#${n} 합계 ${app.totalMl} > 잔 ${cupMl}`);
    assert.equal(app.estimatedAbv, be.recipe.estimatedAbv, `#${n} abv`);
    assert.equal(app.flavor.strength, be.recipe.flavor.strength, `#${n} flavor.strength`);
    assert.deepEqual(app.suggestions, be.recipe.suggestions, `#${n} suggestions`);
    if (adultVerified !== true || strength === 'none') {
      const alcPumps = new Set(ing.filter((i) => i.abv > 0).map((i) => i.pump));
      const pushy = app.suggestions.filter((s: any) => s.type === 'add_ingredient' || s.type === 'substitute');
      for (const s of pushy) {
        assert.ok(!looksAlcoholic(s.ingredient) && !looksAlcoholic(s.message) && !alcPumps.has(s.pump), `#${n} 술 권유 남음 ${JSON.stringify(s)}`);
      }
    }
    if (adultVerified !== true && strength !== 'none') adultCut++;
    ok++;
  }
  assert.ok(adultCut > 50, `성인 확인 전 + 술 허용 도수 비교 ${adultCut}건`);
  assert.ok(ok > 150, `성공 비교 ${ok}건`);
  assert.ok(prefCut > 100, `성향 제외가 걸린 경우 ${prefCut}건`);
  assert.ok((codes.get('NO_MIXER') ?? 0) > 0, `NO_MIXER 비교 ${codes.get('NO_MIXER') ?? 0}건`);
});

test('규칙 8 NO_MIXER: 섞을 재료가 성향으로 빠지면 실패 / 다른 무알콜 재료가 있으면 그것으로 — 앱 = 백엔드', { skip: noBackend }, () => {
  const vodka = POOL[0];
  const milk = POOL[1];
  const cider = POOL[2];
  const oj = POOL[3];
  const run = (ing: IngredientInfo[], pref: string, strength: Strength, cupMl = 200) => {
    const raw = { name: 't', ingredients: [{ pump: 1, name: '보드카', ml: 200 }] };
    const ex = preferenceExcludedPumps(ing, pref);
    let app: any;
    try {
      app = { ok: true, recipe: normalizeRecipe(raw, { ingredients: ing, strength, cupMl, excludePumps: ex }).recipe };
    } catch (e: any) {
      app = { ok: false, code: e.code };
    }
    const be = BE.recipe.finalizeRecipe(raw, ing, { cupMl, strength, excludePumps: BE.fallback.preferenceExcludedPumps(ing, pref) });
    assert.equal(app.ok, be.ok, `${pref} ${strength}`);
    if (!be.ok) assert.equal(app.code, be.code);
    else assert.deepEqual(app.recipe.ingredients, be.recipe.ingredients);
    assert.equal(lacksMixer(ing, strength, ex), BE.recipe.lacksMixer(ing, strength, ex), `lacksMixer ${pref}`);
    assert.deepEqual(
      usableIngredients(ing, strength, ex).map((i) => i.pump),
      BE.recipe.usableIngredients(ing, strength, ex).map((i: any) => i.pump),
    );
    return app;
  };
  assert.equal(run([vodka], '', 'light').code, 'NO_MIXER');
  assert.equal(run([vodka, milk], '우유 알레르기', 'light').code, 'NO_MIXER', '섞을 재료(우유)가 성향으로 빠짐');
  const r = run([vodka, milk, cider], '사이다는 싫어요', 'medium');
  assert.deepEqual(r.recipe.ingredients.map((i: any) => i.name), ['보드카', '우유'], '사이다 대신 우유를 섞음');
  const r2 = run([vodka, milk, cider, oj], '우유, 사이다는 빼 주세요', 'strong', 500);
  assert.deepEqual(r2.recipe.ingredients.map((i: any) => i.name), ['보드카', '오렌지주스']);
  assert.ok(r2.recipe.totalMl <= 500 && r2.recipe.estimatedAbv <= 20.05);
});

// ───────────────────────── 무알콜 시 술 제안 제거 (SPEC §3.2) ─────────────────────────

test('sanitizeSuggestions: 무알콜이거나 성인 확인 전이면 술 장착·대체 제안 제거 — 앱 = 백엔드 (none·light·medium × 성인 확인 on/off/생략)', { skip: noBackend }, () => {
  const ing = POOL.slice(0, 4);
  const byPump = new Map(ing.map((i) => [i.pump, i] as const));
  for (const strength of ['none', 'light', 'medium'] as Strength[]) {
    for (const adult of [undefined, false, true]) {
      const app = adult === undefined ? sanitizeSuggestions(RAW_SUGGESTIONS, ing, byPump, strength) : sanitizeSuggestions(RAW_SUGGESTIONS, ing, byPump, strength, adult);
      const be =
        adult === undefined
          ? BE.recipe.sanitizeSuggestions(RAW_SUGGESTIONS, ing, byPump, strength)
          : BE.recipe.sanitizeSuggestions(RAW_SUGGESTIONS, ing, byPump, strength, adult);
      assert.deepEqual(app, be, `${strength} adult=${adult}`);
    }
  }
  // 성인 확인 전(생략 포함)은 술 허용 도수여도 무알콜과 같은 판정 (SPEC §3.2)
  const kid = sanitizeSuggestions(RAW_SUGGESTIONS, ing, byPump, 'medium', false);
  assert.deepEqual(kid, sanitizeSuggestions(RAW_SUGGESTIONS, ing, byPump, 'none', true));
  assert.deepEqual(sanitizeSuggestions(RAW_SUGGESTIONS, ing, byPump, 'medium'), kid, '생략 = 성인 확인 전');
  assert.ok(!kid.some((s) => s.message.includes('럼 대신')), '성인 확인 전이면 술 대체 제안도 제거');
  const none = sanitizeSuggestions(RAW_SUGGESTIONS, ing, byPump, 'none');
  const has = (m: string) => none.some((s) => s.message.includes(m));
  assert.ok(!has('보드카를 장착하면'), '술 장착 제안 제거');
  assert.ok(!has('럼 대신'), '술 대체 제안 제거');
  assert.ok(!has('펌프 1 재료'), '장착된 술 펌프 대상 제안 제거');
  assert.ok(!has('위스키 하이볼'), '문구에 술 이름');
  assert.ok(!has('Use vodka'));
  assert.ok(has('보드카를 넣으면'), 'info 는 그대로');
  assert.ok(has('진저에일을 장착하면'), "'진저에일' 은 술이 아님");
  const medium = sanitizeSuggestions(RAW_SUGGESTIONS, ing, byPump, 'medium', true);
  assert.ok(medium.some((s) => s.message.includes('보드카를 장착하면')) === false, '장착된 재료(보드카)는 추가 장착 제안 X');
  assert.ok(medium.some((s) => s.message.includes('럼 대신')), '술 허용 + 성인 확인이면 대체 제안 유지');
  // 앱 보정 파이프라인에도 적용됨 (오프라인·직접 Gemini·서버 결과 모두 normalizeRecipe 를 거침)
  const r = normalizeRecipe(
    { ingredients: [{ pump: 3, name: '사이다', ml: 200 }], suggestions: RAW_SUGGESTIONS },
    { ingredients: ing, strength: 'none', cupMl: 200 },
  ).recipe;
  const pushy = r.suggestions.filter((s) => s.type === 'add_ingredient' || s.type === 'substitute');
  assert.ok(pushy.length > 0);
  assert.ok(pushy.every((s) => !looksAlcoholic(s.ingredient) && !looksAlcoholic(s.message)), JSON.stringify(pushy));
});

// ───────────────────────── 탐색 adultVerified (SPEC §5.4) ─────────────────────────

const EX_ING: IngredientInfo[] = [
  { pump: 1, name: '사이다', category: 'soda', abv: 0, remainingMl: 800, notes: '' },
  { pump: 2, name: '오렌지주스', category: 'juice', abv: 0, remainingMl: 800, notes: '' },
  { pump: 3, name: '보드카', category: 'spirit', abv: 40, remainingMl: 500, notes: '' },
];
const RAW_EXPLORE_LISTS: unknown[][] = [
  [
    { addIngredient: '진', category: 'spirit', abv: 40, recipeName: 'a', ingredients: [{ name: '진', ml: 40 }, { name: '사이다', ml: 160 }] },
    { addIngredient: '토닉워터', category: 'soda', abv: 0, recipeName: 'b', ingredients: [{ name: '보드카', ml: 30 }, { name: '토닉워터', ml: 170 }] },
    { addIngredient: '크랜베리주스', category: 'juice', abv: 0, recipeName: 'c', ingredients: [{ name: '크랜베리주스', ml: 100 }, { name: '사이다', ml: 100 }] },
  ],
  [
    { addIngredient: '탄산수', category: 'soda', abv: 0, ingredients: [{ name: '탄산수', ml: 150 }, { name: '화이트 럼', ml: 50 }] }, // 미장착 술 같이
    { addIngredient: '트리플섹', category: 'liqueur', abv: 30, ingredients: [{ name: '트리플섹', ml: 20 }, { name: '오렌지주스', ml: 180 }] },
    { addIngredient: '샴페인', category: 'wine', abv: 12, ingredients: [{ name: '샴페인', ml: 100 }, { name: '오렌지주스', ml: 100 }] },
    { addIngredient: '레몬즙', category: 'juice', abv: 0, ingredients: [{ name: '레몬즙', ml: 20 }, { name: '사이다', ml: 180 }] },
  ],
  [
    { addIngredient: 'Kahlua', abv: 20, ingredients: [{ name: 'Kahlua', ml: 30 }, { name: '오렌지주스', ml: 170 }] },
    { addIngredient: '그레나딘 시럽', category: 'syrup', abv: 0, ingredients: [{ name: '그레나딘 시럽', ml: 20 }, { name: '위스키', ml: 0 }, { name: '사이다', ml: 180 }] }, // 0ml 술 줄도 판정
    { addIngredient: '설탕시럽', category: 'syrup', abv: 0, ingredients: [{ name: '설탕시럽', ml: 15 }, { name: '보드카', ml: 30 }, { name: '사이다', ml: 155 }] }, // 장착된 술은 OK
    { addIngredient: '우유', category: 'dairy', abv: 0, ingredients: [{ name: '우유', ml: 100 }, { name: '오렌지주스', ml: 100 }] },
  ],
];

test('adultVerified on/off: 탐색 결과에서 술 장착 항목 제거 — 앱 parseExplore = 백엔드 normalizeExplore', { skip: noBackend }, () => {
  for (const [li, list] of RAW_EXPLORE_LISTS.entries()) {
    for (const strength of ['none', 'medium'] as Strength[]) {
      for (const adultVerified of [false, true]) {
        for (const mode of ['explore', 'normal'] as const) {
          const app = parseExplore(list, { ingredients: EX_ING, strength, cupMl: 200, mode, adultVerified });
          const be = BE.explore.normalizeExplore(list, EX_ING, { cupMl: 200, strength, mode, adultVerified }).items;
          const shape = (xs: any[]) => xs.map((x) => [x.addIngredient, x.ingredients.map((i: any) => [i.name, i.installed, i.pump ?? null])]);
          assert.deepEqual(shape(app), shape(be), `목록 ${li} ${strength} adult=${adultVerified} ${mode}`);
          if (!adultVerified || strength === 'none') {
            for (const x of app) {
              assert.ok(!(x.abv > 0) && !ALCOHOL_CATEGORIES.includes(x.category), `${x.addIngredient} 는 술 장착 제안`);
              assert.ok(x.ingredients.every((i) => i.installed || !looksAlcoholic(i.name)), `${x.addIngredient} 에 미장착 술`);
            }
          }
        }
      }
    }
  }
  // 생략(undefined)은 false 와 같음 (SPEC §3.1 생략 시 false). 장착된 술(보드카)을 쓰는 항목은 '술 장착'이 아니라 유지
  assert.deepEqual(
    parseExplore(RAW_EXPLORE_LISTS[0], { ingredients: EX_ING, strength: 'medium', cupMl: 200, mode: 'explore' }).map((x) => x.addIngredient),
    ['토닉워터', '크랜베리주스'],
  );
});

const slot = (pump: number, name: string, category: PumpSlot['category'], abv = 0, remainingMl = 800): PumpSlot => ({
  pump,
  name,
  category,
  abv,
  capacityMl: 1000,
  remainingMl,
  color: '#fff',
  notes: '',
  updatedAt: 0,
});
const input: UserInput = {
  moods: [],
  taste: { sweet: 0, sour: 0, bitter: 0, fizzy: 0 },
  strength: 'medium',
  weather: null,
  situation: '',
  preference: '',
  cupMl: 200,
};

test('adultVerified on/off: 규칙기반 탐색 후보 — 앱 오프라인 = 백엔드 fallback (진·보드카·화이트 럼, 트리플섹은 성인 확인 때만)', { skip: noBackend }, () => {
  const scenarios: { slots: PumpSlot[]; u: Partial<UserInput> }[] = [
    { slots: [slot(1, '사이다', 'soda'), slot(2, '레몬즙', 'juice'), slot(3, '오렌지주스', 'juice'), slot(4, '설탕시럽', 'syrup')], u: {} },
    { slots: [slot(1, '사이다', 'soda'), slot(2, '레몬즙', 'juice'), slot(3, '오렌지주스', 'juice'), slot(4, '설탕시럽', 'syrup')], u: { preference: '진은 싫고 보드카도 싫어요' } },
    { slots: [slot(1, '사이다', 'soda'), slot(2, '레몬즙', 'juice'), slot(3, '오렌지주스', 'juice'), slot(4, '설탕시럽', 'syrup')], u: { strength: 'none' } },
    { slots: [slot(1, '사이다', 'soda'), slot(2, '오렌지주스', 'juice')], u: { taste: { sweet: 3, sour: 3, bitter: 1, fizzy: 3 } } },
    { slots: [slot(1, '보드카', 'spirit', 40), slot(2, '사이다', 'soda'), slot(3, '레몬즙', 'juice'), slot(4, '설탕시럽', 'syrup')], u: {} },
    { slots: [slot(1, '우유', 'dairy'), slot(2, '사이다', 'soda'), slot(3, '레몬즙', 'juice'), slot(4, '그레나딘 시럽', 'syrup')], u: { preference: '탄산수 알레르기' } },
  ];
  for (const [si, sc] of scenarios.entries()) {
    for (const adultVerified of [false, true]) {
      const req = buildRequest({ ...input, ...sc.u }, sc.slots, [], 'explore', adultVerified);
      const app = exploreCandidates(req).slice(0, 3).map((c) => c.name);
      const be = BE.explore
        .normalizeExplore(BE.fallback.buildFallbackExplore(req.user, req.ingredients, [], { mode: 'explore' }), req.ingredients, {
          cupMl: 200,
          strength: req.user.strength,
          mode: 'explore',
          adultVerified,
        })
        .items.map((x: any) => x.addIngredient);
      assert.deepEqual(app, be, `시나리오 ${si} adult=${adultVerified}`);
      const alcohol = ['진', '보드카', '화이트 럼', '트리플섹'];
      if (!adultVerified || req.user.strength === 'none') assert.ok(!app.some((n) => alcohol.includes(n)), `시나리오 ${si}: ${app}`);
    }
  }
  const adultNames = (v: boolean) =>
    exploreCandidates(buildRequest(input, scenarios[0].slots, [], 'explore', v)).map((c) => c.name);
  assert.deepEqual(adultNames(true), ['진', '트리플섹']);
  assert.deepEqual(adultNames(false), ['탄산수']);
  // '진'은 1글자라 성향 판정을 하지 않음(백엔드와 같음) → '진 · 보드카 · 화이트 럼' 줄의 첫 이름 '진' 그대로
  assert.deepEqual(
    exploreCandidates(buildRequest({ ...input, preference: '진은 싫고 보드카도 싫어요' }, scenarios[0].slots, [], 'explore', true)).map((c) => c.name),
    ['진', '트리플섹'],
  );
  // 장착된 이름과 같으면 다음 이름 (진 장착 → spirit 장착이라 술 줄 자체가 빠지므로, 거절 기록 2회로 '진'을 빼서 확인)
  const rejectedGin = [1, 2].map((k) => ({ name: `r${k}`, liked: false, rejected: true, ingredients: [{ name: '진', ml: 40 }] }));
  const reqR = buildRequest(input, scenarios[0].slots, rejectedGin, 'explore', true);
  assert.deepEqual(exploreCandidates(reqR).map((c) => c.name), ['보드카', '트리플섹']);
  const beR = BE.explore
    .normalizeExplore(BE.fallback.buildFallbackExplore(reqR.user, reqR.ingredients, reqR.history, { mode: 'explore' }), reqR.ingredients, {
      cupMl: 200,
      strength: 'medium',
      mode: 'explore',
      adultVerified: true,
    })
    .items.map((x: any) => x.addIngredient);
  assert.deepEqual(beR, ['보드카', '트리플섹']);
});

test('성향 문장에 줄바꿈·연속 공백이 있어도 앱이 보내는 문장 = 백엔드가 쓰는 문장 → 빠지는 재료 같음 (규칙 1)', { skip: noBackend }, () => {
  const slots = [slot(1, '우유', 'dairy'), slot(2, '사이다', 'soda'), slot(3, '오렌지주스', 'juice')];
  for (const preference of ['땅콩 알레르기\n우유', '우유\n싫어요', '사이다\r\n싫어요', '우유' + ' '.repeat(320) + '싫어', '오렌지주스는\t\t별로']) {
    const req = buildRequest({ ...input, preference }, slots, [], 'normal', false);
    const v = BE.recipe.validateRecipeRequest(JSON.parse(JSON.stringify(req)));
    assert.ok(v.ok);
    assert.equal(req.user.preference, v.value.user.preference, JSON.stringify(preference));
    const app = [...preferenceExcludedPumps(req.ingredients, req.user.preference)].sort();
    const be = [...BE.fallback.preferenceExcludedPumps(v.value.ingredients, v.value.user.preference)].sort();
    assert.deepEqual(app, be, JSON.stringify(preference));
  }
  // 서버는 '땅콩 알레르기⏎우유' 를 한 절로 보고 우유를 뺌 → 앱도 같은 문장으로 판정해 뺌
  const r = buildRequest({ ...input, preference: '땅콩 알레르기\n우유' }, slots, [], 'normal', false);
  assert.deepEqual([...preferenceExcludedPumps(r.ingredients, r.user.preference)], [1]);
});

test('탐색 후보·카드: 앱 오프라인 = 백엔드 fallback (normal 모드 채우기·안전장치·빈 기기 짝 재료, 무작위 400건)', { skip: noBackend }, () => {
  let seed = 4242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const POOL: [string, PumpSlot['category'], number][] = [
    ['사이다', 'soda', 0], ['탄산수', 'soda', 0], ['레몬즙', 'juice', 0], ['오렌지주스', 'juice', 0], ['크랜베리주스', 'juice', 0],
    ['설탕시럽', 'syrup', 0], ['그레나딘 시럽', 'syrup', 0], ['우유', 'dairy', 0], ['녹차', 'other', 0],
    ['보드카', 'spirit', 40], ['트리플섹', 'liqueur', 30], ['소주', 'wine', 16.5],
  ];
  const HNAMES = ['탄산수', '레몬즙', '토닉워터', '설탕시럽', '크랜베리주스', '우유', '그레나딘 시럽', '진'];
  for (let n = 0; n < 400; n++) {
    const k = Math.floor(rnd() * 5);
    const used = new Set<string>();
    const slots: PumpSlot[] = [];
    for (let p = 1; p <= k; p++) {
      const [name, cat, abv] = pick(POOL);
      if (used.has(name)) continue;
      used.add(name);
      slots.push(slot(p, name, cat, abv, rnd() < 0.1 ? 0 : 500));
    }
    const names = slots.map((s) => s.name);
    const history = Array.from({ length: Math.floor(rnd() * 6) }, (_, i) => ({
      name: `h${i}`,
      liked: false,
      rejected: rnd() < 0.7,
      ingredients: [{ name: pick(HNAMES), ml: 50 }, { name: pick(HNAMES), ml: 50 }],
    }));
    const u: Partial<UserInput> = {
      strength: pick(['none', 'light', 'medium', 'strong'] as const),
      taste: { sweet: Math.floor(rnd() * 6), sour: Math.floor(rnd() * 6), bitter: Math.floor(rnd() * 6), fizzy: Math.floor(rnd() * 6) },
      situation: pick(['', '휴식', '파티']),
      preference: names.length && rnd() < 0.4 ? `${pick(names)} 싫어요` : '',
    };
    const mode = rnd() < 0.5 || !slots.length ? 'explore' : 'normal'; // 빈 기기는 explore 만 (normal 은 400)
    const adultVerified = rnd() < 0.5;
    const req = buildRequest({ ...input, ...u }, slots, history, mode, adultVerified);
    const v = BE.recipe.validateRecipeRequest(JSON.parse(JSON.stringify(req)));
    assert.ok(v.ok, String(v.error));
    const V = v.value;
    const exCtx = { ingredients: req.ingredients, strength: req.user.strength, cupMl: req.user.cupMl, mode, adultVerified } as const;
    const app = parseExplore(offlineExplore(req, { adultVerified }), exCtx).map((e) => e.addIngredient);
    const be = BE.explore
      .normalizeExplore(BE.fallback.buildFallbackExplore(V.user, V.ingredients, V.history, { mode }), V.ingredients, {
        cupMl: V.user.cupMl,
        strength: V.user.strength,
        mode,
        adultVerified,
      })
      .items.map((x: any) => x.addIngredient);
    const ctx = { names, u, mode, adultVerified, rej: history.filter((h) => h.rejected).map((h) => h.ingredients.map((i) => i.name)) };
    assert.deepEqual(app, be, `#${n} ${JSON.stringify(ctx)}`);
    if (mode === 'explore') assert.ok(app.length >= 1, `#${n}: explore 모드는 1개 이상`);
  }
});

// ───────────────────────── 서버 핸들러 ↔ 앱 (422 판정, explore fallback) ─────────────────────────

async function callHandler(body: unknown): Promise<{ status: number; json: any }> {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    end(b?: string) {
      this.body = b ?? '';
      this.writableEnded = true;
    },
  };
  await BE.api({ method: 'POST', body }, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}
const noApi = noBackend || (typeof BE.api !== 'function' ? 'backend/api/index.js 를 불러올 수 없음' : false);

test('normal 모드에서 만들 수 있는 재료가 없음: 서버는 AI 호출 전 422, 앱은 바로 같은 뜻의 안내 (성향·NO_MIXER·무알콜·잔량)', { skip: noApi }, async () => {
  const cases: { name: string; slots: PumpSlot[]; u: Partial<UserInput>; key: RegExp; code: string }[] = [
    { name: '성향으로 모두 제외', slots: [slot(1, '우유', 'dairy'), slot(2, '사이다', 'soda')], u: { strength: 'none', preference: '우유, 사이다는 빼 주세요' }, key: /성향에 적힌 재료\(알레르기·싫어하는 재료\)를 빼면 만들 수 있는 재료가 없/, code: 'NO_USABLE' },
    { name: '섞을 재료 없음', slots: [slot(1, '보드카', 'spirit', 40)], u: { strength: 'light' }, key: /섞을 무알콜 재료가 없어/, code: 'NO_MIXER' },
    { name: '섞을 재료가 성향으로 빠짐', slots: [slot(1, '보드카', 'spirit', 40), slot(2, '우유', 'dairy')], u: { strength: 'light', preference: '우유 알레르기' }, key: /섞을 무알콜 재료가 없어/, code: 'NO_MIXER' },
    { name: '무알콜인데 술만', slots: [slot(1, '보드카', 'spirit', 40)], u: { strength: 'none' }, key: /무알콜로 만들 수 있는 재료\(도수 0%\)가 없/, code: 'NO_USABLE' },
    { name: '잔량 0', slots: [slot(1, '사이다', 'soda', 0, 0)], u: { strength: 'none' }, key: /잔량이 모두 0ml/, code: 'NO_USABLE' },
  ];
  for (const c of cases) {
    const req = buildRequest({ ...input, ...c.u }, c.slots, [], 'normal', false);
    const be = await callHandler(req);
    assert.equal(be.status, 422, `${c.name}: 서버 ${be.status}`);
    assert.match(be.json.error, c.key, `${c.name}: 서버 문구 ${be.json.error}`);
    await assert.rejects(
      generateRecipe({ input: { ...input, ...c.u }, slots: c.slots, aiMode: 'offline', mode: 'normal' }),
      (e: any) => {
        assert.ok(e instanceof RecipeError);
        assert.equal(e.code, c.code, c.name);
        assert.match(e.message, c.key, `${c.name}: 앱 문구 ${e.message}`);
        return true;
      },
    );
  }
});

test('explore 모드 + adultVerified on/off: 서버 fallback 결과와 앱 오프라인 결과의 새 재료가 같고, 성인 확인 전에는 술 장착 제안 없음', { skip: noApi }, async () => {
  const slots = [slot(1, '사이다', 'soda'), slot(2, '레몬즙', 'juice'), slot(3, '오렌지주스', 'juice'), slot(4, '설탕시럽', 'syrup')];
  for (const adultVerified of [false, true]) {
    const req = buildRequest(input, slots, [], 'explore', adultVerified);
    assert.equal(req.user.adultVerified, adultVerified, '요청 user 에 adultVerified 포함');
    const be = await callHandler(req);
    assert.equal(be.status, 200);
    assert.equal(be.json.warningCode, 'NO_API_KEY', '실제 Gemini 를 부르지 않음');
    const app = await generateRecipe({ input, slots, aiMode: 'offline', mode: 'explore', adultVerified });
    const beNames = be.json.explore.map((x: any) => x.addIngredient);
    const appNames = app.explore.map((x) => x.addIngredient);
    assert.deepEqual(appNames, beNames, `adult=${adultVerified}`);
    if (!adultVerified) {
      for (const x of [...be.json.explore, ...app.explore]) {
        assert.ok(!(x.abv > 0) && !ALCOHOL_CATEGORIES.includes(x.category), `${x.addIngredient}`);
      }
    } else {
      assert.ok(appNames.includes('진') && appNames.includes('트리플섹'), String(appNames));
    }
  }
});

// ───────────────────────── 2026-11-07 개정: 성인 확인 전 레시피 제안 · NO_MIXER explore (SPEC §3.2, §3.3 규칙 8) ─────────────────────────

/** 술을 장착·대체하라는 제안 (술 이름·장착된 술 이름·장착된 술 펌프·문구의 술 이름) — 남아 있으면 안 되는 것 */
function alcoholPushes(list: any[], ing: IngredientInfo[]): any[] {
  const alcPumps = new Set(ing.filter((i) => i.abv > 0).map((i) => i.pump));
  const alcNames = new Set(ing.filter((i) => i.abv > 0).map((i) => normName(i.name)));
  return (list ?? []).filter(
    (s) =>
      (s.type === 'add_ingredient' || s.type === 'substitute') &&
      (looksAlcoholic(s.ingredient) || (s.ingredient && alcNames.has(normName(s.ingredient))) || looksAlcoholic(s.message) || alcPumps.has(s.pump)),
  );
}

const GEMINI_PREFIX = 'https://generativelanguage.googleapis.com/';

/**
 * fetch 를 가짜로 바꿔 실행 (실제 네트워크 호출 없음). aiJson: 직접 Gemini 응답의 JSON 본문.
 * 그 밖의 주소는 오류 → 실수로 운영 서버·Gemini 를 부르지 않음. calls: 불린 주소 목록
 */
async function withFakeFetch<T>(routes: { aiJson?: () => unknown }, fn: (calls: string[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (routes.aiJson && u.startsWith(GEMINI_PREFIX)) {
      const text = JSON.stringify(routes.aiJson());
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    }
    throw new TypeError(`가짜 fetch: 정해지지 않은 주소(${u})는 부르지 않음`);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test('성인 확인 전 레시피 suggestions (§3.2): 서버 fallback·앱 오프라인 모두 술 장착 권유 없음 + 서버 결과를 앱이 Gemini 응답으로 받아 다시 검증해도 같은 제안', { skip: noApi }, async () => {
  const slots = [slot(1, '사이다', 'soda'), slot(2, '오렌지주스', 'juice'), slot(3, '레몬즙', 'juice')];
  let infoChecked = 0;
  for (const adultVerified of [false, true]) {
    for (const strength of ['light', 'medium', 'strong'] as Strength[]) {
      const u = { ...input, strength, taste: { sweet: 3, sour: 3, bitter: 1, fizzy: 3 } };
      const req = buildRequest(u, slots, [], 'normal', adultVerified);
      const be = await callHandler(req);
      assert.equal(be.status, 200, `${strength} adult=${adultVerified}`);
      assert.equal(be.json.warningCode, 'NO_API_KEY', '실제 Gemini 를 부르지 않음');
      const beSug: any[] = be.json.recipe.suggestions;
      const app = await generateRecipe({ input: u, slots, aiMode: 'offline', mode: 'normal', adultVerified });
      const appSug = app.recipe!.suggestions;
      const noAlcInfo = (list: any[]) => list.filter((s) => s.type === 'info' && /무알콜로 만들었어요/.test(s.message));
      if (!adultVerified) {
        assert.deepEqual(alcoholPushes(beSug, req.ingredients), [], `서버 ${strength}: ${JSON.stringify(beSug)}`);
        assert.deepEqual(alcoholPushes(appSug, req.ingredients), [], `앱 ${strength}: ${JSON.stringify(appSug)}`);
        // 규칙기반 문구도 술 장착을 권하지 않음 ("…무알콜로 만들었어요." 까지만)
        for (const s of [...noAlcInfo(beSug), ...noAlcInfo(appSug)]) assert.ok(!looksAlcoholic(s.message), s.message);
        assert.ok(noAlcInfo(beSug).length === 1 && noAlcInfo(appSug).length === 1, `${JSON.stringify(beSug)} / ${JSON.stringify(appSug)}`);
        assert.equal(noAlcInfo(appSug)[0].message, OFFLINE_NO_ALCOHOL_INFO);
        infoChecked++;
      } else {
        // 성인 확인 뒤: 앱 오프라인도 서버와 같은 info 문구 (술 장착 안내 포함)
        assert.ok(noAlcInfo(beSug).some((s) => looksAlcoholic(s.message)), `성인 확인 뒤 서버 문구는 술 장착 안내 포함 ${JSON.stringify(beSug)}`);
        assert.deepEqual(noAlcInfo(appSug).map((s) => s.message), noAlcInfo(beSug).map((s: any) => s.message), JSON.stringify(appSug));
        assert.equal(noAlcInfo(appSug)[0].message, OFFLINE_NO_ALCOHOL_INFO_ADULT);
      }
      // 같은 레시피를 Gemini 응답으로 받아 앱이 다시 검증(normalizeRecipe, 잔 맞춤 포함)해도 제안이 그대로 (가짜 fetch)
      const viaGemini = await withFakeFetch({ aiJson: () => ({ recipe: be.json.recipe, explore: [] }) }, () =>
        generateRecipe({ input: u, slots, aiMode: 'gemini', geminiKey: 'test-key-not-real', mode: 'normal', adultVerified }),
      );
      assert.equal(viaGemini.source, 'direct');
      assert.deepEqual(viaGemini.recipe!.suggestions, beSug, `${strength} adult=${adultVerified}`);
    }
  }
  assert.equal(infoChecked, 3);
});

/** addsSoftIngredient 비교용 카드 (정리된 모양 + 원본 모양: abv 문자열·없음, installed 생략, ingredients 없음, null) */
const SOFT_CARDS: any[] = [
  { addIngredient: '토닉워터', category: 'soda', abv: 0, ingredients: [{ name: '보드카', ml: 20, installed: true, pump: 1 }, { name: '토닉워터', ml: 180, installed: false }] },
  { addIngredient: '진', category: 'spirit', abv: 40, ingredients: [{ name: '진', ml: 20, installed: false }, { name: '우유', ml: 180, installed: true, pump: 2 }] },
  { addIngredient: '진', category: 'spirit', abv: 40, ingredients: [{ name: '진', ml: 20, installed: false }, { name: '토닉워터', ml: 180, installed: false }] },
  { addIngredient: '맥주', category: 'wine', abv: 4.5, ingredients: [{ name: '맥주', ml: 200, installed: false }] },
  { addIngredient: '라거', category: 'wine', abv: 5, ingredients: [{ name: '라거', ml: 200, installed: false }] },
  { addIngredient: '무알콜 진', category: 'spirit', abv: 0, ingredients: [{ name: '무알콜 진', ml: 100, installed: false }, { name: '보드카', ml: 10, installed: true, pump: 1 }] },
  { addIngredient: '오렌지 리큐르', category: 'other', abv: 0, ingredients: [{ name: '오렌지 리큐르', ml: 50, installed: false }] },
  { addIngredient: '탄산수', category: 'soda', abv: 5, ingredients: [{ name: '탄산수', ml: 200, installed: false }] },
  { addIngredient: '탄산수', category: 'soda', abv: '0', ingredients: [{ name: '탄산수', ml: 200, installed: false }] },
  { addIngredient: '탄산수', category: 'soda', ingredients: [{ name: '탄산 수', ml: 200, installed: false }] },
  { addIngredient: '그레나딘 시럽', category: 'syrup', abv: 0, ingredients: [{ name: '그레나딘-시럽', ml: 20 }, { name: '보드카', ml: 30, installed: true }] },
  { addIngredient: '트리플섹', category: 'liqueur', abv: 30, ingredients: [{ name: '트리플섹', ml: 20, installed: false }, { name: '레몬즙', ml: 20, installed: false }, { name: '보드카', ml: 30, installed: true }] },
  { addIngredient: '트리플섹', category: 'liqueur', abv: 30, ingredients: [{ name: '트리플섹', ml: 20, installed: false }, { name: '위스키', ml: 20, installed: false }] },
  { addIngredient: '사이다', category: 'soda', abv: 0, ingredients: [{ name: '사이다', ml: 200, installed: true, pump: 3 }] },
  { addIngredient: '사이다', category: 'soda', abv: 0, ingredients: [] },
  { addIngredient: '사이다', category: 'soda', abv: 0 },
  null,
];
/**
 * 기대값 (위 카드 순서) — 백엔드 기준 구현 backend/lib/explore.js addsSoftIngredient 와 같은 정의:
 *   SPEC §3.3 규칙 8 의 "무알콜 재료(abv 0 이고 category 가 spirit·liqueur·wine 이 아닌 것)" +
 *   새 재료 이름이 술 이름 목록(§5.4 와 같은 backend/lib/alcohol.js)에 해당하지 않을 것.
 *   (이름 조건은 AI 가 도수·종류를 잘못 적은 술 카드를 막는 장치 — 그래서 #6 '오렌지 리큐르'(other, abv 0)는 false.
 *    '무알콜 맥주'·'논알콜 와인'처럼 술 이름이 든 무알콜 재료도 버려짐. SPEC 문구에는 이 이름 조건이 아직 없음 — SPEC 반영 필요)
 */
const SOFT_EXPECT = [true, false, true, false, false, false, false, false, true, true, true, true, false, false, false, false, false];

test('NO_MIXER 카드 판정 (§3.3 규칙 8): 앱 addsSoftIngredient·filterNoMixerExplore = 백엔드 (+ 기준 구현 정의대로의 기대값)', { skip: noBackend }, () => {
  assert.equal(typeof BE.explore.addsSoftIngredient, 'function', '백엔드 lib/explore.js addsSoftIngredient 미반영');
  assert.equal(SOFT_CARDS.length, SOFT_EXPECT.length);
  for (const [i, card] of SOFT_CARDS.entries()) {
    const app = addsSoftIngredient(card);
    assert.equal(app, BE.explore.addsSoftIngredient(card), `#${i} ${JSON.stringify(card)}`);
    assert.equal(app, SOFT_EXPECT[i], `#${i} 기대값 ${JSON.stringify(card)}`);
  }
  const list = SOFT_CARDS.filter(Boolean);
  const app = filterNoMixerExplore(list);
  const be = BE.explore.filterNoMixerExplore(list);
  assert.deepEqual(app.items.map((x: any) => x.addIngredient), be.items.map((x: any) => x.addIngredient));
  assert.equal(app.removed, be.removed);
  assert.equal(app.removed, SOFT_EXPECT.filter((v, i) => SOFT_CARDS[i] && !v).length);
});

test('NO_MIXER explore (§3.3 규칙 8) 규칙기반: 서버 fallback = 앱 오프라인 — recipe:null, 같은 안내, 무알콜 재료를 새로 더하는 카드만 (성인 확인 on/off)', { skip: noApi }, async () => {
  const scenarios: { name: string; slots: PumpSlot[]; u: Partial<UserInput> }[] = [
    { name: '독한 술만', slots: [slot(1, '보드카', 'spirit', 40)], u: { strength: 'light' } },
    { name: '섞을 재료가 성향으로 빠짐', slots: [slot(1, '보드카', 'spirit', 40), slot(2, '우유', 'dairy')], u: { strength: 'medium', preference: '우유 알레르기' } },
    { name: '강하게 + 상한보다 독한 술만', slots: [slot(1, '보드카', 'spirit', 40), slot(2, '트리플섹', 'liqueur', 30)], u: { strength: 'strong', taste: { sweet: 4, sour: 1, bitter: 0, fizzy: 4 } } },
    { name: '무알콜 재료 잔량 0', slots: [slot(1, '보드카', 'spirit', 40), slot(2, '사이다', 'soda', 0, 0)], u: { strength: 'light' } },
    { name: '진 장착 + 쓴맛', slots: [slot(1, '진', 'spirit', 40)], u: { strength: 'medium', taste: { sweet: 0, sour: 0, bitter: 3, fizzy: 0 } } },
  ];
  let cards = 0;
  for (const sc of scenarios) {
    for (const adultVerified of [false, true]) {
      const u = { ...input, ...sc.u };
      const req = buildRequest(u, sc.slots, [], 'explore', adultVerified);
      assert.ok(lacksMixer(req.ingredients, req.user.strength, preferenceExcludedPumps(req.ingredients, req.user.preference)), `${sc.name}: NO_MIXER 상황`);
      const be = await callHandler(req);
      assert.equal(be.status, 200, sc.name);
      assert.equal(be.json.warningCode, 'NO_API_KEY');
      assert.equal(be.json.recipe, null);
      const app = await generateRecipe({ input: u, slots: sc.slots, aiMode: 'offline', mode: 'explore', adultVerified });
      assert.equal(app.recipe, null);
      const label = `${sc.name} adult=${adultVerified}`;
      assert.deepEqual(app.explore.map((x) => x.addIngredient), be.json.explore.map((x: any) => x.addIngredient), label);
      assert.ok(app.explore.length >= 1, label);
      for (const x of [...app.explore, ...be.json.explore]) {
        assert.ok(addsSoftIngredient(x) && BE.explore.addsSoftIngredient(x), `${label}: ${JSON.stringify(x)}`);
        cards++;
      }
      // 도수 단계 이름만 다를 수 있음(앱 화면 이름 '보통' / 백엔드 '적당히' — 원래부터 다름) → 이름을 빼고 비교
      const unlabel = (t: string) => String(t).replace(/'[^']*'\(최대/, "'_'(최대");
      assert.equal(unlabel(app.warnings[0]), unlabel(be.json.notice), `${label}: 안내 문구`);
      if (!adultVerified) for (const x of app.explore) assert.ok(!(x.abv > 0) && !ALCOHOL_CATEGORIES.includes(x.category), label);
    }
  }
  assert.ok(cards >= 20, `비교한 카드 ${cards}장`);
});

test('NO_MIXER explore + AI 결과(가짜): 서버 finalize = 앱 직접 Gemini — 술만 더하는 카드는 버리고, 0개면 AI 재호출 없이 규칙기반으로 채움', { skip: noApi || !BE.gemini ? 'backend api/gemini 없음' : false }, async () => {
  const GIN_MILK = { addIngredient: '진', category: 'spirit', abv: 40, recipeName: '진 밀크', ingredients: [{ name: '진', ml: 20 }, { name: '우유', ml: 180 }] };
  const TONIC = { addIngredient: '토닉워터', category: 'soda', abv: 0, recipeName: '보드카 토닉', ingredients: [{ name: '보드카', ml: 20 }, { name: '토닉워터', ml: 180 }] };
  const BEER = { addIngredient: '맥주', category: 'wine', abv: 4.5, recipeName: '비어', ingredients: [{ name: '맥주', ml: 200 }] };
  const LAGER = { addIngredient: '라거', category: 'wine', abv: 5, recipeName: '라거', ingredients: [{ name: '라거', ml: 200 }] };
  const CIDER = { addIngredient: '애플 사이더', category: 'wine', abv: 4.5, recipeName: '사이더', ingredients: [{ name: '애플 사이더', ml: 200 }] };
  const CRAN = { addIngredient: '크랜베리주스', category: 'juice', abv: 0, recipeName: '케이프 코더', ingredients: [{ name: '보드카', ml: 30 }, { name: '크랜베리주스', ml: 170 }] };
  const milkAllergy = { slots: [slot(1, '보드카', 'spirit', 40), slot(2, '우유', 'dairy')], u: { strength: 'light' as Strength, preference: '우유 알레르기' } };
  const cases: { name: string; slots: PumpSlot[]; u: Partial<UserInput>; adult: boolean; ai: unknown; want: string[] | null }[] = [
    { name: '무알콜 카드만 남음', ...milkAllergy, adult: true, ai: { recipe: null, explore: [GIN_MILK, TONIC, BEER] }, want: ['토닉워터'] },
    // GIN_MILK 는 성향 제외(우유)로 우유 줄이 지워져 도수 상한을 못 맞춰 먼저 빠짐(앱·백엔드 같음) → '약하게' 상한 안의 술만 카드 3장
    { name: '앞 3장이 모두 술만 → 규칙기반으로 채움', ...milkAllergy, adult: true, ai: { explore: [BEER, LAGER, CIDER, TONIC] }, want: null },
    { name: '성향 제외 재료(우유)가 든 카드', ...milkAllergy, adult: true, ai: { explore: [GIN_MILK, TONIC] }, want: ['토닉워터'] },
    { name: '성인 확인 전', slots: [slot(1, '보드카', 'spirit', 40)], u: { strength: 'light' }, adult: false, ai: { explore: [GIN_MILK, TONIC, CRAN] }, want: ['토닉워터', '크랜베리주스'] },
  ];
  const realGen = BE.gemini.generateRecipe;
  let aiJson: unknown = null;
  let beAiCalls = 0;
  // 백엔드 AI 호출 자리를 가짜로 (GEMINI_API_KEY 는 비운 채, 네트워크 없음): 같은 AI JSON 을 finalize 에 넣음 (gemini.generateRecipe 와 같은 반환 모양)
  BE.gemini.generateRecipe = async (_req: unknown, finalize: (raw: unknown) => any) => {
    beAiCalls++;
    const fin = finalize(aiJson);
    return fin.ok
      ? { ok: true, model: 'fake-model', recipe: fin.recipe, explore: fin.explore || [], adjustments: fin.adjustments || [], attempts: 1 }
      : { ok: false, code: 'BAD_RESPONSE', model: 'fake-model', attempts: 1 };
  };
  try {
    for (const c of cases) {
      aiJson = c.ai;
      const u = { ...input, ...c.u };
      const req = buildRequest(u, c.slots, [], 'explore', c.adult);
      beAiCalls = 0;
      const be = await callHandler(req);
      assert.equal(be.status, 200, c.name);
      assert.equal(be.json.source, 'gemini', `${c.name}: AI 결과(가짜)로 응답`);
      assert.equal(be.json.recipe, null);
      assert.equal(beAiCalls, 1, `${c.name}: 서버 AI 재호출 없음`);
      const app = await withFakeFetch({ aiJson: () => aiJson }, async (calls) => {
        const r = await generateRecipe({ input: u, slots: c.slots, aiMode: 'gemini', geminiKey: 'test-key-not-real', mode: 'explore', adultVerified: c.adult });
        assert.deepEqual(calls.map((x) => x.startsWith(GEMINI_PREFIX)), [true], `${c.name}: 앱 AI 재호출 없음(가짜 Gemini 1번)`);
        return r;
      });
      assert.equal(app.source, 'direct');
      assert.equal(app.recipe, null);
      const appNames = app.explore.map((x) => x.addIngredient);
      const beNames = be.json.explore.map((x: any) => x.addIngredient);
      assert.deepEqual(appNames, beNames, c.name);
      if (c.want) assert.deepEqual(appNames, c.want, c.name);
      else {
        assert.ok(appNames.length >= 1, c.name);
        assert.ok(app.warnings.includes('AI 제안에 무알콜 재료를 새로 더하는 카드가 없어 앱이 대신 골랐어요.'), JSON.stringify(app.warnings));
      }
      for (const x of [...app.explore, ...be.json.explore]) assert.ok(addsSoftIngredient(x) && BE.explore.addsSoftIngredient(x), `${c.name}: ${JSON.stringify(x)}`);
    }
  } finally {
    BE.gemini.generateRecipe = realGen;
  }
});

// ───────────────────────── 2026-11-07 개정 교차검증 (review3 parity: 앱 ↔ 백엔드 무작위 비교에서 찾은 것) ─────────────────────────

/** 작은 결정적 난수 (테스트마다 같은 순서) */
function lcg(seed0: number) {
  let seed = seed0 >>> 0;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  return { rnd, ri: (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1)), pick: <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] };
}

test('술 이름 목록 (SPEC §5.4 "백엔드와 같은 목록"): 앱 재료 프리셋의 술 이름·별칭(피치트리·말리부 등)도 목록에 있음 → 성인 확인 전 제안·탐색 줄 제거가 앱 = 백엔드', { skip: noBackend }, () => {
  // 앱의 미장착 술 판정(uninstalledIsAlcohol: 목록 + 프리셋)이 목록(looksAlcoholic)과 같은 결과가 되어야 백엔드와 같음
  for (const p of PRESETS) {
    for (const n of [p.name, ...(p.aliases ?? [])]) {
      assert.equal(looksAlcoholic(n), p.abv > 0, `프리셋 ${n} (${p.abv}%)`);
      assert.equal(BE.alcohol.looksAlcoholic(n), p.abv > 0, `백엔드 목록 ${n}`);
      assert.equal(uninstalledIsAlcohol(n), looksAlcoholic(n), `uninstalledIsAlcohol ${n}`);
      // 탐색 카드의 미장착 줄 도수: 앱 parseExplore(프리셋 도수 / 술 이름 40 / 0) = 백엔드 uninstalledLineAbv (백엔드가 프리셋 술 도수표를 복제 — presets.ts 를 바꾸면 같이 바꿔야 함)
      if (BE.explore.uninstalledLineAbv) {
        const appAbv = findExactPreset(n)?.abv ?? (uninstalledIsAlcohol(n) ? 40 : 0);
        assert.equal(BE.explore.uninstalledLineAbv(n), appAbv, `미장착 줄 도수 ${n}`);
      }
    }
  }
  assert.equal(typeof BE.explore.uninstalledLineAbv, 'function', '백엔드 lib/explore.js uninstalledLineAbv 미반영');
  for (const n of ['피치 시럽', '피치 아이스티', '코코넛 밀크', '코코넛워터', '복숭아 주스']) assert.equal(BE.alcohol.looksAlcoholic(n), false, n);
  // 성인 확인 전: 피치트리·말리부 장착·대체 제안은 술 제안으로 지움 (SPEC §3.2)
  const ing = POOL.slice(1, 6);
  const byPump = new Map(ing.map((i) => [i.pump, i] as const));
  const list = [
    { type: 'add_ingredient', ingredient: '피치트리', message: '피치트리를 장착하면 복숭아 향 칵테일도 돼요.' },
    { type: 'add_ingredient', ingredient: '말리부', message: '말리부를 추가 장착해 보세요.' },
    { type: 'substitute', ingredient: '코코넛 럼', message: '코코넛 럼으로 바꿔도 좋아요.' },
    { type: 'add_ingredient', ingredient: '복숭아 시럽', message: '피치 슈냅스 대신 복숭아 시럽도 좋아요.' },
    { type: 'add_ingredient', ingredient: '탄산수', message: '탄산수를 장착하면 청량해요.' },
  ];
  for (const adult of [false, true]) {
    const a = sanitizeSuggestions(list, ing, byPump, 'light', adult);
    const b = BE.recipe.sanitizeSuggestions(list, ing, byPump, 'light', adult);
    assert.deepEqual(a, b, `adult=${adult}`);
    assert.deepEqual(a.map((x) => x.ingredient), adult ? list.map((x) => x.ingredient) : ['탄산수'], `adult=${adult}`);
  }
  // 성인 확인 전: 미장착 말리부·피치트리 줄이 든 탐색 카드는 버림 (앱 parseExplore = 백엔드 normalizeExplore)
  const cards = [
    { addIngredient: '토닉워터', category: 'soda', abv: 0, ingredients: [{ name: '토닉워터', ml: 160 }, { name: '말리부', ml: 30 }] },
    { addIngredient: '크랜베리주스', category: 'juice', abv: 0, ingredients: [{ name: '크랜베리주스', ml: 160 }, { name: '피치트리', ml: 30 }] },
    { addIngredient: '탄산수', category: 'soda', abv: 0, ingredients: [{ name: '탄산수', ml: 160 }, { name: '사이다', ml: 30 }] },
  ];
  for (const adultVerified of [false, true]) {
    const app = parseExplore(cards, { ingredients: ing, strength: 'strong', cupMl: 200, mode: 'explore', adultVerified }).map((x) => x.addIngredient);
    const be = BE.explore.normalizeExplore(cards, ing, { cupMl: 200, strength: 'strong', mode: 'explore', adultVerified });
    assert.deepEqual(app, be.items.map((x: any) => x.addIngredient), `adult=${adultVerified}`);
    assert.deepEqual(app, adultVerified ? ['토닉워터', '크랜베리주스', '탄산수'] : ['탄산수']);
    assert.equal(be.removedAdult, adultVerified ? 0 : 2);
  }
});

test('규칙기반 문구 (SPEC §3.2 예시 문장): 앱 오프라인의 성인 확인 전 안내 = 백엔드 fallback NO_ALCOHOL_INFO = "장착된 주류가 없어 무알콜로 만들었어요."', { skip: noBackend }, () => {
  assert.equal(OFFLINE_NO_ALCOHOL_INFO, '장착된 주류가 없어 무알콜로 만들었어요.');
  if (BE.fallback.NO_ALCOHOL_INFO !== undefined) {
    assert.equal(OFFLINE_NO_ALCOHOL_INFO, BE.fallback.NO_ALCOHOL_INFO);
    assert.ok(String(BE.fallback.NO_ALCOHOL_INFO_ADULT).startsWith(OFFLINE_NO_ALCOHOL_INFO));
    assert.equal(OFFLINE_NO_ALCOHOL_INFO_ADULT, BE.fallback.NO_ALCOHOL_INFO_ADULT, '성인 확인 뒤 문구도 같음');
  }
});

test('최종 suggestions: strength 4종 × 성인 확인 켬/끔/생략 모두 앱 = 백엔드, 서버 결과를 앱이 같은 값으로 다시 검증해도 그대로 (무작위 150건)', { skip: noBackend }, () => {
  const { rnd, ri, pick } = lcg(20261107);
  const extra = ['피치트리', '말리부', 'Gin', '럼', '와인', '토닉워터', '탄산수', '레몬즙', '보드카', '우유'];
  let blockedChecked = 0;
  for (let n = 0; n < 150; n++) {
    const ing = POOL.filter(() => rnd() < 0.6).map((i) => ({ ...i, remainingMl: rnd() < 0.2 ? ri(0, 40) : ri(100, 900) }));
    if (!ing.length) ing.push({ ...POOL[2] });
    const items = Array.from({ length: ri(1, 4) }, () => {
      const it = pick(ing);
      return { pump: it.pump, name: it.name, ml: ri(5, 150) };
    });
    const suggestions = [
      ...RAW_SUGGESTIONS.filter(() => rnd() < 0.3),
      ...Array.from({ length: ri(0, 3) }, () => {
        const nm = pick([...extra, ...ing.map((i) => i.name)]);
        const type = pick(['add_ingredient', 'substitute', 'info', 'low_stock']);
        const message = `${nm}${pick(['를 장착하면 좋아요', ' 대신 써 보세요', '가 얼마 안 남았어요'])}`;
        return rnd() < 0.3 ? { type, ingredient: nm, message, pump: pick(ing).pump } : { type, ingredient: nm, message };
      }),
    ];
    const raw = { name: '테스트', ingredients: items, flavor: { sweet: 2, sour: 2, bitter: 1, fizzy: 2 }, suggestions };
    const cupMl = pick([100, 200, 300]);
    for (const strength of ['none', 'light', 'medium', 'strong'] as Strength[]) {
      for (const adultVerified of [true, false, undefined]) {
        const opt = adultVerified === undefined ? {} : { adultVerified };
        const be = BE.recipe.finalizeRecipe(raw, ing, { cupMl, strength, ...opt });
        const label = `#${n} ${strength} adult=${adultVerified}`;
        let app: any = null;
        try {
          app = normalizeRecipe(raw, { ingredients: ing, strength, cupMl, ...opt }).recipe;
        } catch (e) {
          assert.ok(e instanceof RecipeError);
          assert.equal(be.ok, false, label);
          assert.equal(e.code, be.code, label);
          continue;
        }
        assert.ok(be.ok, `${label}: 백엔드 실패 ${be.code}`);
        assert.deepEqual(app.suggestions, be.recipe.suggestions, label);
        // 앱이 서버 결과(같은 adultVerified)를 다시 검증(잔 맞춤 없이)해도 그대로 (recommend.ts finish(fromServer))
        const again = normalizeRecipe(be.recipe, { ingredients: ing, strength, cupMl, scaleToCup: false, ...opt }).recipe;
        assert.deepEqual(again.suggestions, be.recipe.suggestions, `${label} 재검증`);
        if (strength === 'none' || adultVerified !== true) {
          blockedChecked++;
          assert.deepEqual(alcoholPushes(app.suggestions, ing), [], label);
        }
      }
    }
  }
  assert.ok(blockedChecked > 600, `술 제안 제거 확인 ${blockedChecked}건`);
});

test('NO_MIXER explore (§3.3 규칙 8) 무작위: 가짜 AI 결과(술만 더하는 카드·무알콜 카드·술+무알콜·무알콜 진·빈 결과) → 서버 = 앱 직접 Gemini, 규칙기반도 같음 (40건)', { skip: noApi || !BE.gemini ? 'backend api/gemini 없음' : false }, async () => {
  const { rnd, ri, pick } = lcg(7);
  const STRONG: [string, PumpSlot['category'], number][] = [['보드카', 'spirit', 40], ['진', 'spirit', 40], ['위스키', 'spirit', 40], ['트리플섹', 'liqueur', 30], ['깔루아', 'liqueur', 20], ['소주', 'wine', 16.5], ['화이트 와인', 'wine', 12]];
  const SOFTS: [string, PumpSlot['category']][] = [['우유', 'dairy'], ['사이다', 'soda'], ['오렌지주스', 'juice'], ['토닉워터', 'soda'], ['설탕시럽', 'syrup'], ['녹차', 'other']];
  const CAPS: Record<string, number> = { light: 5, medium: 12, strong: 20 };
  const realGen = BE.gemini.generateRecipe;
  let aiJson: unknown = null;
  let beAiCalls = 0;
  // 백엔드 AI 호출 자리를 가짜로 (GEMINI_API_KEY 는 비운 채, 네트워크 없음): 같은 AI JSON 을 finalize 에 1번 넣음
  const fakeGen = async (_req: unknown, finalize: (raw: unknown) => any) => {
    beAiCalls++;
    const fin = finalize(aiJson);
    return fin.ok
      ? { ok: true, model: 'fake-model', recipe: fin.recipe, explore: fin.explore || [], adjustments: fin.adjustments || [], attempts: 1 }
      : { ok: false, code: 'BAD_RESPONSE', model: 'fake-model', attempts: 1 };
  };
  let done = 0;
  let filled = 0;
  try {
    for (let n = 0; done < 40 && n < 200; n++) {
      const strength = pick(['light', 'medium', 'strong'] as Strength[]);
      const strongs = STRONG.filter((x) => x[2] > CAPS[strength]);
      const slots: PumpSlot[] = [];
      for (const a of strongs.filter(() => rnd() < 0.5).slice(0, 3)) slots.push(slot(slots.length + 1, a[0], a[1], a[2]));
      if (!slots.length) slots.push(slot(1, strongs[0][0], strongs[0][1], strongs[0][2]));
      let preference = '';
      const soft = pick(SOFTS);
      const r0 = rnd();
      if (r0 < 0.35) slots.push(slot(slots.length + 1, soft[0], soft[1], 0, 0)); // 잔량 0
      else if (r0 < 0.7) {
        slots.push(slot(slots.length + 1, soft[0], soft[1]));
        preference = pick([`${soft[0]} 알레르기`, `${soft[0]}\n싫어요`, `알레르기: ${soft[0]}`]);
      }
      const adultVerified = rnd() < 0.5;
      const u = { ...input, strength, preference, taste: { sweet: ri(0, 5), sour: ri(0, 5), bitter: ri(0, 5), fizzy: ri(0, 5) } };
      const req = buildRequest(u, slots, [], 'explore', adultVerified);
      if (!lacksMixer(req.ingredients, strength, preferenceExcludedPumps(req.ingredients, req.user.preference))) continue;
      const base = () => pick(req.ingredients).name;
      const card = (k: string) => {
        const a = pick(STRONG);
        const s = pick(SOFTS.filter((x) => !req.ingredients.some((i) => i.name === x[0])));
        if (k === 'alc') return { addIngredient: a[0], category: a[1], abv: a[2], recipeName: '술만', ingredients: [{ name: base(), ml: 30 }, { name: a[0], ml: 120 }] };
        if (k === 'soft') return { addIngredient: s[0], category: s[1], abv: 0, recipeName: '무알콜', ingredients: [{ name: base(), ml: 20 }, { name: s[0], ml: 170 }] };
        if (k === 'mix') return { addIngredient: a[0], category: a[1], abv: a[2], recipeName: '술+무알콜', ingredients: [{ name: a[0], ml: 20 }, { name: s[0], ml: 170 }] };
        return { addIngredient: '무알콜 진', category: 'spirit', abv: 0, recipeName: '제로', ingredients: [{ name: '무알콜 진', ml: 150 }, { name: base(), ml: 10 }] };
      };
      aiJson = { recipe: null, explore: Array.from({ length: ri(0, 4) }, () => card(pick(['alc', 'alc', 'soft', 'mix', 'zero']))) };
      const label = `#${n} ${strength} adult=${adultVerified} ${JSON.stringify(req.ingredients.map((i) => [i.name, i.remainingMl]))} pref=${JSON.stringify(req.user.preference)} ai=${JSON.stringify((aiJson as any).explore.map((x: any) => x.recipeName))}`;
      BE.gemini.generateRecipe = fakeGen;
      beAiCalls = 0;
      const be = await callHandler(req);
      BE.gemini.generateRecipe = realGen;
      assert.equal(be.status, 200, label);
      assert.equal(be.json.recipe, null, label);
      assert.equal(beAiCalls, 1, `${label}: 서버 AI 재호출 없음`);
      const beNames = be.json.explore.map((x: any) => x.addIngredient);
      const app = await withFakeFetch({ aiJson: () => aiJson }, async (calls) => {
        const r = await generateRecipe({ input: u, slots, aiMode: 'gemini', geminiKey: 'test-key-not-real', mode: 'explore', adultVerified });
        assert.deepEqual(calls.map((x) => x.startsWith(GEMINI_PREFIX)), [true], `${label}: 앱 AI 1번`);
        return r;
      });
      assert.equal(app.recipe, null, label);
      assert.deepEqual(app.explore.map((x) => x.addIngredient), beNames, `${label}: 앱 직접 Gemini = 서버`);
      if (app.warnings.some((w) => /앱이 대신 골랐어요/.test(w))) filled++;
      for (const x of [...app.explore, ...be.json.explore]) assert.ok(addsSoftIngredient(x) && BE.explore.addsSoftIngredient(x), `${label}: ${JSON.stringify(x)}`);
      // 규칙기반 (AI 없음, 키 없음 → NO_API_KEY): 서버 fallback = 앱 오프라인
      const be0 = await callHandler(req);
      assert.equal(be0.json.warningCode, 'NO_API_KEY');
      const off = await generateRecipe({ input: u, slots, aiMode: 'offline', mode: 'explore', adultVerified });
      assert.deepEqual(off.explore.map((x) => x.addIngredient), be0.json.explore.map((x: any) => x.addIngredient), `${label}: 규칙기반`);
      for (const x of [...off.explore, ...be0.json.explore]) assert.ok(addsSoftIngredient(x) && BE.explore.addsSoftIngredient(x), `${label}: 규칙기반 ${JSON.stringify(x)}`);
      done++;
    }
  } finally {
    BE.gemini.generateRecipe = realGen;
  }
  assert.equal(done, 40, `NO_MIXER 상황 ${done}건`);
  assert.ok(filled >= 3, `AI 카드가 모두 걸러져 규칙기반으로 채운 경우 ${filled}건`);
});

test('성향 문장 정리 (§3.3 규칙 1 cleanText(…,300)): 제어문자·줄바꿈·탭·특수 공백·300자 넘는 문장 — 앱이 보낸 문장 = 백엔드가 쓰는 문장, 빠지는 재료·ml 조정 재검증(recipe.tsx)·탐색 카드 재요청도 같음 (무작위 300건)', { skip: noBackend }, () => {
  const { rnd, ri, pick } = lcg(300);
  const WS = [' ', '  ', '\n', '\r\n', '\t', ' ', '　', ' ', '\v', '\f', '\u0001', '\u001f', '\u007f', '​', '﻿', ''];
  const slots = [slot(1, '우유', 'dairy'), slot(2, '사이다', 'soda'), slot(3, '토닉워터', 'soda'), slot(4, '보드카', 'spirit', 40), slot(5, '오렌지주스', 'juice'), slot(6, '그레나딘 시럽', 'syrup')];
  const names = slots.map((s) => s.name);
  let excluded = 0;
  for (let n = 0; n < 300; n++) {
    const A = pick(names);
    const B = pick(names);
    const t = pick([`${A} 싫어요`, `${A}는 좋고 ${B}는 별로`, `알레르기: ${A}, ${B}`, `${A} 좋아요. ${B} 빼 주세요`, `${A}\n${B} 싫어`, `제외: ${A}`]);
    let pref = t.split(' ').map((w) => w + pick(WS)).join(pick(WS));
    if (rnd() < 0.2) pref = pick(WS).repeat(ri(1, 300)) + pref;
    if (rnd() < 0.2) pref = 'ㅋ'.repeat(ri(250, 299)) + pref;
    const u = { ...input, strength: 'light' as Strength, preference: pref };
    const label = `#${n} ${JSON.stringify(pref.slice(-60))}`;
    assert.equal(cleanText(pref, 300), BE.recipe.cleanText(pref, 300), label);
    const target = { addIngredient: '탄산수', recipeName: pick(['시트러스 탄산', '우유 없이 탄산']) } as ExploreItem;
    for (const inp of [u, targetHint(u, target)]) {
      const req = buildRequest(inp, slots, [], 'normal', true);
      const v = BE.recipe.validateRecipeRequest(JSON.parse(JSON.stringify(req)));
      assert.ok(v.ok, label);
      assert.equal(req.user.preference, v.value.user.preference, `${label}: 보낸 문장 = 서버가 쓰는 문장`);
      const exA = [...preferenceExcludedPumps(req.ingredients, req.user.preference)].sort();
      const exB = [...BE.fallback.preferenceExcludedPumps(v.value.ingredients, v.value.user.preference)].sort();
      assert.deepEqual(exA, exB, `${label}: 빠지는 재료`);
      if (inp === u) {
        // recipe.tsx 가 ml 조정·잔 맞춤 재검증 때 쓰는 문장 (cleanText(input.preference, 300)) 도 같은 결과
        assert.deepEqual([...preferenceExcludedPumps(slotsToIngredients(slots), cleanText(u.preference, 300))].sort(), exA, `${label}: recipe.tsx`);
        if (exA.length) excluded++;
      }
    }
  }
  assert.ok(excluded > 100, `성향 제외가 걸린 경우 ${excluded}건`);
});

// ───────────────────────── 프롬프트 (직접 Gemini) ─────────────────────────

test('직접 Gemini 프롬프트·스키마: 성인 확인 전 안내 문장이 백엔드와 같고, 탐색 스키마는 술 종류·도수를 막음', { skip: noBackend || !BE.prompt ? 'backend/lib/prompt.js 없음' : false }, () => {
  for (const adultVerified of [false, true]) {
    const req = buildRequest(input, [slot(1, '사이다', 'soda')], [], 'explore', adultVerified);
    const v = BE.recipe.validateRecipeRequest(req);
    assert.ok(v.ok);
    const beText: string = BE.prompt.buildUserPrompt(v.value);
    const appText = buildUserPrompt(req);
    const line = (t: string) => t.split('\n').find((l) => l.startsWith('- 성인 확인 전')) ?? null;
    assert.equal(line(appText), line(beText), `adult=${adultVerified}`);
    assert.equal(line(appText) === null, adultVerified);
    const schema: any = buildResponseSchema(req);
    const exItem = schema.properties.explore.items.properties;
    assert.equal(exItem.category.enum.includes('spirit'), adultVerified);
    assert.equal(exItem.abv.maximum, adultVerified ? 100 : 0);
  }
});

// ───────────────────────── Gemini 오류 분류 · 시간 한도 ─────────────────────────

test("Gemini 오류 분류: 앱 classifyGeminiError = 백엔드 classify ('billing' 단어만으로 BILLING 아님, 무료 등급 한도 초과 = RATE_LIMIT)", { skip: noBackend || !BE.gemini ? 'backend/lib/gemini.js 없음' : false }, () => {
  const err = (status: number, message: string, extra: Record<string, unknown> = {}) => ({ status, data: { error: { code: status, message, ...extra } } });
  const cases: { r: any; want: string }[] = [
    { r: err(429, 'You exceeded your current quota, please check your plan and billing details.', { status: 'RESOURCE_EXHAUSTED' }), want: 'RATE_LIMIT' },
    { r: err(429, 'Resource has been exhausted (e.g. check quota).'), want: 'RATE_LIMIT' },
    { r: err(429, 'Your prepayment credits are depleted. Please go to AI Studio to manage your billing.'), want: 'BILLING' },
    { r: err(402, 'Payment required'), want: 'BILLING' },
    { r: err(400, 'Billing account not configured for this project? see billing docs'), want: 'BAD_REQUEST' },
    { r: err(400, 'API key not valid. Please pass a valid API key.', { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] }), want: 'AUTH' },
    { r: err(403, 'Permission denied', { status: 'PERMISSION_DENIED' }), want: 'AUTH' },
    { r: err(401, 'unauthenticated'), want: 'AUTH' },
    { r: err(404, 'models/gemini-9 is not found'), want: 'MODEL' },
    { r: err(400, 'Invalid JSON payload received.'), want: 'BAD_REQUEST' },
    { r: err(500, 'Internal error'), want: 'UPSTREAM' },
    { r: err(503, 'The model is overloaded.'), want: 'UPSTREAM' },
    { r: { status: 0, data: null, error: 'TIMEOUT' }, want: 'TIMEOUT' },
    { r: { status: 0, data: null, error: 'NETWORK' }, want: 'NETWORK' },
    { r: { status: 200, data: { error: { message: 'weird' } } }, want: 'UPSTREAM' },
  ];
  for (const c of cases) {
    const app = classifyGeminiError(c.r);
    assert.equal(app, BE.gemini.classify(c.r), JSON.stringify(c.r));
    assert.equal(app, c.want, JSON.stringify(c.r));
  }
});
