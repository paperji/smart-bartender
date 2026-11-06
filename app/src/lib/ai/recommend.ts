/**
 * AI 레시피 생성 오케스트레이터 (SPEC §3, §5.4) — v3.0: 서버 모드 제거, 사용자 본인 키(BYOK) (WEBAPP_DESIGN §4)
 *  - gemini : 앱에서 Gemini REST 직접 호출(사용자 키, v2.1 의 'direct' 경로 그대로) → 실패 시 오프라인 추천
 *             키가 없으면 Gemini 를 부르지 않고 바로 오프라인 추천(fallbackReason·fallbackCode 'NO_KEY' 로 안내)
 *  - offline: 앱 내장 규칙기반 추천만
 * 요청에는 mode("normal"|"explore"), history(최신 기록부터 최대 10개, liked/rejected),
 * user.adultVerified(설정의 성인 확인 값 — false 면 탐색(§5.4)과 레시피 suggestions(§3.2) 모두 술 장착·대체 제안을 하지 않고,
 * 규칙기반 문구도 술 장착을 권하지 않음, SPEC §3.1) 포함.
 * Gemini·오프라인 원본은 normalizeRecipe(SPEC §3.3 규칙 1~9) 로 보정합니다.
 * 규칙 1 의 성향 제외(알레르기·싫어하는 재료)는 preference.ts 로 계산해 모든 경로의 보정에 excludePumps 로 넘김.
 * 성인 확인 전이면 레시피 suggestions 의 술 장착·대체 제안도 지움(normalizeRecipe 의 adultVerified — SPEC §3.2).
 * explore 는 parseExplore 로 다시 검증(성인 확인 전이면 술 장착 항목 제거).
 * explore 모드에서 NO_MIXER 로 recipe:null 이면 무알콜 재료를 새로 더하는 카드만 남기고(filterNoMixerExplore — 판정 addsSoftIngredient),
 * 0개가 되면 AI 재호출 없이 오프라인 탐색(같은 필터)으로 채움 (SPEC §3.3 규칙 8).
 * normal 모드에서 만들 수 있는 재료가 없으면(잔량 0·무알콜인데 술만·성향으로 모두 제외·도수 상한을 맞출 무알콜 재료 없음)
 * AI 를 부르지 않고 바로 안내 (백엔드가 422 를 주는 경우와 같은 판정·같은 뜻의 문구).
 * 시간 제한 (SPEC §3.1): 직접 Gemini 25초. (브라우저·Node 공통 — fetch 만 사용)
 */
import type {
  AiMode,
  ExploreItem,
  HistoryHint,
  IngredientInfo,
  PumpSlot,
  Recipe,
  RecipeRequest,
  RecipeResult,
  RecipeSource,
  RecommendMode,
  UserInput,
} from '../types';
import { hasInvalidKeyChars, redactKey } from './apiKey';
import { exploreToRawRecipe, filterNoMixerExplore, nameKey, parseExplore } from './explore';
import { clampCup, cleanText, noMixerMessage, normalizeRecipe, RecipeError, STRENGTH_ABV, STRENGTH_KO } from './normalize';
import { offlineRecipe } from './offline';
import { offlineExplore } from './offline-explore';
import { excludedByPreference, preferenceExcludedPumps } from './preference';
import { buildResponseSchema, buildUserPrompt, DEFAULT_GEMINI_MODEL, SYSTEM_PROMPT } from './prompt';

/** 직접 Gemini 호출 1회 시간 제한 (SPEC §3.1: 25초) */
export const AI_TIMEOUT_MS = 25000;
/** history 최대 개수 (SPEC §3.1) */
export const HISTORY_LIMIT = 10;

export function slotsToIngredients(slots: PumpSlot[]): IngredientInfo[] {
  return slots
    .filter((s) => s.name.trim().length > 0)
    .map((s) => ({
      pump: s.pump,
      name: s.name.trim(),
      category: s.category,
      abv: s.abv,
      remainingMl: Math.max(0, Math.round(s.remainingMl)),
      notes: s.notes ?? '',
    }));
}

/**
 * history 는 최신 기록부터 최대 10개 (SPEC §3.1 — 서버는 앞에서 10개를 사용)
 * adultVerified: 설정의 성인 확인 값 (생략 시 false — SPEC §3.1)
 * preference: 서버가 쓰는 것과 똑같이 정리해서 보냄(백엔드 validateRecipeRequest 의 cleanText(…, 300): 줄바꿈·연속 공백 → 공백 1개).
 *   앱의 성향 제외(preference.ts)·오프라인 추천도 이 정리된 문장을 쓰므로 서버와 같은 재료가 빠짐
 *   (원문 그대로면 '땅콩 알레르기⏎우유' 처럼 줄바꿈이 절 경계가 되어 앱만 우유를 빼지 않았음)
 */
export function buildRequest(
  input: UserInput,
  slots: PumpSlot[],
  history: HistoryHint[] = [],
  mode: RecommendMode = 'normal',
  adultVerified = false,
): RecipeRequest {
  return {
    version: 2,
    user: {
      moods: input.moods,
      taste: input.taste,
      strength: input.strength,
      weather: input.weather
        ? {
            condition: input.weather.condition,
            ...(typeof input.weather.tempC === 'number' ? { tempC: input.weather.tempC } : {}),
            ...(typeof input.weather.humidity === 'number' ? { humidity: input.weather.humidity } : {}),
          }
        : null,
      situation: input.situation,
      preference: cleanText(input.preference, 300),
      cupMl: clampCup(input.cupMl),
      adultVerified: adultVerified === true,
    },
    ingredients: slotsToIngredients(slots),
    history: history.slice(0, HISTORY_LIMIT).map((h) => ({
      name: h.name,
      liked: !!h.liked,
      rejected: !!h.rejected,
      ingredients: h.ingredients.map((i) => ({ name: i.name, ml: i.ml })),
    })),
    mode,
  };
}

export class AiError extends Error {
  /** 'TIMEOUT' = 응답 시간 초과 (안내 문구 구분용). 직접 Gemini 호출은 classifyGeminiError 의 코드 */
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: any }> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl?.abort();
      reject(new AiError(`응답 시간이 ${Math.round(timeoutMs / 1000)}초를 넘었어요`, 'TIMEOUT'));
    }, timeoutMs);
  });
  try {
    const res = (await Promise.race([fetch(url, { ...init, signal: ctrl?.signal }), timeout])) as Response;
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { status: res.status, body };
  } catch (e: any) {
    if (e instanceof AiError) throw e;
    if (e?.name === 'AbortError') throw new AiError('요청이 취소됐어요(시간 초과)', 'TIMEOUT');
    throw new AiError(`네트워크 오류: ${e?.message ?? e}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
    throw new AiError('AI 응답을 해석하지 못했어요');
  }
}

/** Gemini 응답 JSON → { recipe, explore } (예전 형식: 최상위가 레시피) */
export function splitGeminiJson(json: any): { recipe: unknown | null; explore: unknown } {
  if (json && typeof json === 'object' && ('recipe' in json || 'explore' in json)) {
    const r = json.recipe && typeof json.recipe === 'object' ? json.recipe : null;
    return { recipe: r, explore: json.explore };
  }
  return { recipe: json && typeof json === 'object' ? json : null, explore: [] };
}

/** 직접 Gemini 호출 오류 코드 (SPEC §3.2 warningCode 와 같은 이름) */
export type GeminiErrorCode =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'RATE_LIMIT'
  | 'BILLING'
  | 'AUTH'
  | 'MODEL'
  | 'BAD_REQUEST'
  | 'UPSTREAM';

/**
 * Gemini HTTP 결과 → 오류 코드 — 백엔드 backend/lib/gemini.js classify() 와 같은 규칙 (parity 테스트로 비교)
 *  - BILLING: 402 또는 "prepayment credits are depleted" 처럼 선불 크레딧 소진 문구일 때만.
 *    'billing' 단어만으로는 판단하지 않음 — 무료 등급의 일반 429 문구 "You exceeded your current quota, please check your
 *    plan and billing details" 에도 들어 있어, 그것은 RATE_LIMIT(무료 등급 한도 초과, 잠시 후 다시 시도)
 *  - AUTH: 401·403 또는 API_KEY_INVALID / API key not valid / PERMISSION_DENIED
 *  - RATE_LIMIT 429 · MODEL 404 · BAD_REQUEST 400 · 그 밖 UPSTREAM
 * r.error: fetch 자체가 실패한 경우 'TIMEOUT' | 'NETWORK'
 */
export function classifyGeminiError(r: { status: number; data?: any; error?: 'TIMEOUT' | 'NETWORK' }): GeminiErrorCode {
  if (r.error === 'TIMEOUT') return 'TIMEOUT';
  if (r.error === 'NETWORK') return 'NETWORK';
  const detail = JSON.stringify((r.data && r.data.error) || {});
  if (r.status === 402 || /prepay|prepayment|credits? (are |is )?depleted/i.test(detail)) return 'BILLING';
  if (r.status === 401 || r.status === 403 || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(detail)) return 'AUTH';
  if (r.status === 429) return 'RATE_LIMIT';
  if (r.status === 404) return 'MODEL';
  if (r.status === 400) return 'BAD_REQUEST';
  return 'UPSTREAM';
}

/** 키가 없어 Gemini 를 부르지 않았을 때 (fallbackCode 'NO_KEY') */
export const NO_KEY_TEXT = 'Gemini API 키가 설정되지 않았어요';

/** 오류 코드별 쉬운 안내 (오프라인 추천으로 바뀐 이유에 보임) */
export const GEMINI_ERROR_TEXT: Record<GeminiErrorCode, string> = {
  TIMEOUT: '응답 시간이 넘었어요',
  NETWORK: 'Gemini 서버에 연결하지 못했어요',
  RATE_LIMIT: '사용량 한도에 걸렸어요(무료 등급은 잠시 후 다시 시도)',
  BILLING: '사용 크레딧이 없어요(Google AI Studio 결제 확인)',
  AUTH: 'API 키가 올바르지 않거나 권한이 없어요(설정에서 키 확인)',
  MODEL: '모델을 찾을 수 없어요(설정에서 모델 이름 확인)',
  BAD_REQUEST: '요청이 거절됐어요',
  UPSTREAM: 'Gemini 서버 오류예요',
};

/** 모델 이름의 주 버전 (gemini-3.6-flash → 3). 모르면 null — 백엔드 majorVersion 과 같음 */
function geminiMajor(model: string): number | null {
  const mm = /^gemini-(\d+)/.exec(String(model || ''));
  return mm ? Number(mm[1]) : null;
}

/**
 * Gemini REST generateContent 직접 호출 (JSON 모드 + responseJsonSchema).
 * temperature 는 Gemini 2.x 이하에만 보냄 (3 이상은 공식 문서 권장대로 보내지 않음 — 백엔드와 같음).
 * 실패하면 AiError(code = classifyGeminiError 결과)
 */
export async function callGemini(
  apiKey: string,
  req: RecipeRequest,
  model = DEFAULT_GEMINI_MODEL,
  timeoutMs = AI_TIMEOUT_MS,
): Promise<{ recipe: unknown | null; explore: unknown }> {
  const m0 = model || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m0)}:generateContent`;
  const major = geminiMajor(m0);
  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
    responseJsonSchema: buildResponseSchema(req),
  };
  if (major != null && major < 3) generationConfig.temperature = 0.9;
  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(req) }] }],
    generationConfig,
  };
  const key = (apiKey ?? '').trim();
  // 보이지 않는 문자·한글 등이 든 키는 헤더로 보낼 수 없어 fetch 가 요청 전에 TypeError → 예전엔 NETWORK 로 오인. 보내지 않고 키 오류로
  if (hasInvalidKeyChars(key)) {
    throw new AiError(`Gemini 오류(AUTH): ${GEMINI_ERROR_TEXT.AUTH} — 키에 쓸 수 없는 문자(보이지 않는 문자·한글 등)가 있어요`, 'AUTH');
  }
  let status: number;
  let body: any;
  try {
    ({ status, body } = await fetchJson(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(payload),
      },
      timeoutMs,
    ));
  } catch (e: any) {
    const code = classifyGeminiError({ status: 0, error: e instanceof AiError && e.code === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK' });
    throw new AiError(`Gemini 오류(${code}): ${GEMINI_ERROR_TEXT[code]}`, code);
  }
  if (status >= 400 || body?.error) {
    const code = classifyGeminiError({ status, data: body });
    // Google 원문은 화면(레시피 안내의 괄호)·임시 저장(fallbackReason)에 쓰이므로 키 값을 가린 뒤 자름
    // (정지된 키: "Permission denied: Consumer 'api_key:<키>' has been suspended." — 80자 안에 키 전체가 들어감)
    const m = redactKey(String(body?.error?.message ?? `HTTP ${status}`), key).slice(0, 80);
    throw new AiError(`Gemini 오류(${code}): ${GEMINI_ERROR_TEXT[code]} — ${m}`, code);
  }
  const text: string | undefined = body?.candidates?.[0]?.content?.parts
    ?.map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .join('');
  if (!text) {
    const reason = body?.promptFeedback?.blockReason || body?.candidates?.[0]?.finishReason || '빈 응답';
    throw new AiError(`Gemini 가 레시피를 만들지 못했어요 (${reason})`);
  }
  const split = splitGeminiJson(extractJson(text));
  if (req.mode === 'normal' && !split.recipe) throw new AiError('Gemini 응답에 레시피가 없어요');
  return split;
}

export interface GenerateOptions {
  input: UserInput;
  slots: PumpSlot[];
  /** 이전 기록 (최신 기록부터, SPEC §3.1) */
  history?: HistoryHint[];
  /** gemini(사용자 키로 Gemini 직접 호출, 키가 없으면 오프라인) | offline */
  aiMode: AiMode;
  geminiKey?: string | null;
  geminiModel?: string;
  /** normal(기본) | explore */
  mode?: RecommendMode;
  /**
   * 만 19세 확인 여부 (요청 user.adultVerified). false·생략이면 탐색(Gemini·오프라인)의 술 후보·술 장착 카드 제거(§5.4),
   * 레시피 suggestions 의 술 add_ingredient/substitute 제거·규칙기반 문구의 술 장착 권유 없음(§3.2)
   */
  adultVerified?: boolean;
  /** "다시 추천" 카운터 (오프라인 추천 다양성) */
  variation?: number;
  /** "다시 탐색" 횟수 (오프라인 탐색 후보 순서) */
  exploreRound?: number;
  /** 탐색 카드에서 새 재료를 장착한 뒤 "해당 레시피" 재요청 */
  target?: ExploreItem | null;
  /** 시간 제한 직접 지정 (기본: AI_TIMEOUT_MS 25초) */
  timeoutMs?: number;
}

/**
 * 이번 요청에서 실제로 쓸 수 있는 재료 (잔량>0, 무알콜이면 abv=0 만, excludePumps(성향으로 뺀 재료) 제외)
 * — 백엔드 recipe.js usableIngredients 와 같음
 */
export function usableIngredients(
  ingredients: IngredientInfo[],
  strength: RecipeRequest['user']['strength'],
  excludePumps?: ReadonlySet<number>,
): IngredientInfo[] {
  return ingredients.filter(
    (i) => i.remainingMl > 0 && (strength !== 'none' || !(i.abv > 0)) && !(excludePumps && excludePumps.has(i.pump)),
  );
}

/**
 * 도수 상한을 맞출 재료가 아예 없는지 (SPEC §3.3 규칙 8 'NO_MIXER' 를 AI 호출 전에 판정 — 백엔드 lacksMixer 와 같음).
 * strength ≠ none 이고, 쓸 수 있는 재료(잔량>0, 성향 제외 아님)가 1개 이상인데 전부 상한보다 독한 술이면 true
 */
export function lacksMixer(
  ingredients: IngredientInfo[],
  strength: RecipeRequest['user']['strength'],
  excludePumps?: ReadonlySet<number>,
): boolean {
  const range = STRENGTH_ABV[strength];
  if (!range || strength === 'none') return false;
  const usable = usableIngredients(ingredients, strength, excludePumps);
  return usable.length > 0 && usable.every((i) => i.abv > range.max);
}

/** explore 모드: 도수 상한을 맞출 무알콜 재료가 없을 때 (백엔드 noMixerNotice 와 같은 문구) */
function noMixerNotice(strength: RecipeRequest['user']['strength']): string {
  const range = STRENGTH_ABV[strength];
  return `지금 장착된 재료로는 '${STRENGTH_KO[strength]}'(최대 ${range ? range.max : 0}%) 도수를 맞출 무알콜 재료가 없어요. 아래 재료를 장착해 보세요.`;
}

/**
 * 지금 만들 수 있는 재료가 없는 이유 — 백엔드 api/index.js noUsableMessage 와 같은 판정 순서·같은 뜻의 문구
 * (normal: 오류 안내 / explore: 탐색 화면 맨 위 안내)
 *  장착 재료 없음 → 무알콜인데 술만 → 도수 상한을 맞출 무알콜 재료 없음 → 성향으로 모두 제외 → 잔량 부족
 */
export function noUsableMessage(
  req: RecipeRequest,
  { explore = false, excludePumps = new Set<number>(), noMixer = false }: { explore?: boolean; excludePumps?: ReadonlySet<number>; noMixer?: boolean } = {},
): string {
  const strength = req.user.strength;
  if (!req.ingredients.length) {
    return explore
      ? '장착된 재료가 없어요. 아래 재료 중 하나를 펌프에 장착해 보세요.'
      : '장착된 재료가 없어요. 재료 탭에서 펌프에 재료를 먼저 등록해 주세요.';
  }
  if (strength === 'none' && !req.ingredients.some((i) => !(i.abv > 0))) {
    return explore
      ? '지금 장착된 재료는 모두 술이라 무알콜로는 만들 수 없어요. 아래 무알콜 재료를 장착해 보세요.'
      : '무알콜로 만들 수 있는 재료(도수 0%)가 없어요. 주스·탄산 같은 무알콜 재료를 장착하거나 도수를 바꿔 주세요.';
  }
  if (noMixer) return explore ? noMixerNotice(strength) : noMixerMessage(strength);
  if (excludePumps.size && usableIngredients(req.ingredients, strength).length) {
    return explore
      ? '성향에 적힌 재료(알레르기·싫어하는 재료)를 빼면 쓸 수 있는 재료가 없어요. 아래 재료를 장착해 보세요.'
      : '성향에 적힌 재료(알레르기·싫어하는 재료)를 빼면 만들 수 있는 재료가 없어요. 다른 재료를 장착하거나 성향 문구를 확인해 주세요.';
  }
  return explore
    ? '사용할 수 있는 재료의 잔량이 부족해요. 용기를 보충하거나 아래 재료를 장착해 보세요.'
    : '사용할 수 있는 재료의 잔량이 모두 0ml 예요. 용기를 보충한 뒤 재료 탭에서 잔량을 수정해 주세요.';
}

/**
 * 장착 재료가 있는데도 지금 재료로 만들 레시피가 없을 때(explore) 안내 문구 — 백엔드 noUsableMessage/noMixerNotice 와 같은 문구
 * (빈 기기는 탐색 화면이 따로 안내). code: 레시피 보정이 실패한 이유(RecipeError.code)
 * excludePumps: 성향으로 뺀 펌프 (생략하면 요청의 성향으로 계산)
 */
export function noUsableNotice(req: RecipeRequest, code?: string, excludePumps?: ReadonlySet<number>): string | undefined {
  if (!req.ingredients.length) return undefined;
  const strength = req.user.strength;
  const ex = excludePumps ?? preferenceExcludedPumps(req.ingredients, req.user.preference);
  const noMixer = code === 'NO_MIXER' || lacksMixer(req.ingredients, strength, ex);
  if (!noMixer && usableIngredients(req.ingredients, strength, ex).length) {
    // 재료는 있지만 이번 레시피 보정이 실패함 (백엔드 fallback 실패 notice 와 같은 문구)
    return '지금 장착된 재료와 요청 조건으로는 만들 수 있는 레시피가 없어요. 아래 재료를 장착해 보세요.';
  }
  return noUsableMessage(req, { explore: true, excludePumps: ex, noMixer });
}

/** 탐색 카드로 재료를 장착한 뒤 재요청할 때 AI 에게 줄 힌트 (요청에만 쓰고 저장하지 않음) */
export function targetHint(input: UserInput, target: ExploreItem): UserInput {
  const hint = `방금 '${target.addIngredient}'를 펌프에 새로 장착했어요. '${target.recipeName}'처럼 이 재료를 살린 레시피를 원해요.`;
  const pref = input.preference.trim();
  return { ...input, preference: (pref ? `${pref} / ${hint}` : hint).slice(0, 300) };
}

export async function generateRecipe(opts: GenerateOptions): Promise<RecipeResult> {
  const mode: RecommendMode = opts.mode ?? 'normal';
  const reqInput = opts.target ? targetHint(opts.input, opts.target) : opts.input;
  const adultVerified = opts.adultVerified === true;
  const req = buildRequest(reqInput, opts.slots, opts.history, mode, adultVerified);
  if (mode === 'normal' && req.ingredients.length === 0) {
    throw new RecipeError('장착된 재료가 없어요. 재료 탭에서 펌프에 재료를 먼저 등록해 주세요.', 'NO_INGREDIENTS');
  }
  const strength = req.user.strength;
  // SPEC §3.3 규칙 1: 성향(알레르기·싫어하는 재료)으로 뺄 펌프 — Gemini·오프라인 결과 보정, 도수 보정(섞을 재료) 모두에서 제외
  const excludePumps = preferenceExcludedPumps(req.ingredients, req.user.preference);
  // 만들 수 있는 재료가 없거나(잔량 0·무알콜인데 술만·성향으로 모두 제외) 도수 상한을 맞출 무알콜 재료가 없음 (백엔드와 같은 판정)
  const noMixer = lacksMixer(req.ingredients, strength, excludePumps);
  const exploreOnly = !usableIngredients(req.ingredients, strength, excludePumps).length || noMixer;
  if (mode === 'normal' && exploreOnly) {
    // 백엔드는 이 경우 AI 를 부르지 않고 422 → 앱도 Gemini 를 기다리지 않고 바로 같은 뜻의 안내
    throw new RecipeError(noUsableMessage(req, { excludePumps, noMixer }), noMixer ? 'NO_MIXER' : 'NO_USABLE');
  }
  // adultVerified: 성인 확인 전이면 레시피 suggestions 에서도 술 장착·대체 제안을 지움 (SPEC §3.2 — Gemini·오프라인 모두)
  const ctx = { ingredients: req.ingredients, strength, cupMl: req.user.cupMl, excludePumps, adultVerified };
  // 탐색 카드에도 같은 성향 제외 적용: 제외 재료를 새로 장착하라는 카드는 버리고, 제외 재료 줄은 지움 (SPEC §5.4 — 백엔드 exploreOpts 와 같음)
  const excludeName = (name: string) => excludedByPreference({ name }, req.user.preference);
  const exCtx = { ingredients: req.ingredients, strength, cupMl: req.user.cupMl, mode, adultVerified, excludePumps, excludeName };
  const errors: string[] = [];
  let timedOut = false;
  const exploreOpts = { adultVerified, variation: opts.exploreRound ?? 0 };
  const offlineEx = () => parseExplore(offlineExplore(req, exploreOpts), exCtx);

  /**
   * 원본(raw) → 검증된 결과. normal 모드에서 레시피가 틀리면 예외 → 다음 방법(오프라인)으로
   */
  const finish = (raw: { recipe: unknown | null; explore: unknown }, source: RecipeSource, model?: string): RecipeResult => {
    const warnings: string[] = [];
    let recipe: Recipe | null = null;
    let recipeErrCode: string | undefined = exploreOnly && noMixer ? 'NO_MIXER' : undefined;
    // explore 인데 지금 재료로 만들 수 없으면(exploreOnly) 레시피는 쓰지 않음 (백엔드도 recipe:null)
    if (raw.recipe != null && !(mode === 'explore' && exploreOnly)) {
      try {
        const n = normalizeRecipe(raw.recipe, ctx);
        recipe = n.recipe;
        warnings.push(...n.warnings);
      } catch (e) {
        if (mode === 'normal') throw e;
        recipeErrCode = e instanceof RecipeError ? e.code : undefined;
      }
    } else if (mode === 'normal') {
      throw new AiError('레시피가 비어 있어요');
    }
    let explore = parseExplore(raw.explore, exCtx);
    // SPEC §3.3 규칙 8: NO_MIXER(도수 상한을 맞출 무알콜 재료가 없음 → explore 에서 recipe:null)이면
    // 무알콜 재료를 새로 하나도 더하지 않는 카드는 버리고, 0개가 되면 AI 재호출 없이 오프라인 탐색(같은 필터)으로 채움 (백엔드와 같음)
    const noMixerExplore = mode === 'explore' && !recipe && recipeErrCode === 'NO_MIXER';
    const exploreFilter = (xs: ExploreItem[]) => (noMixerExplore ? filterNoMixerExplore(xs).items : xs);
    const parsedCount = explore.length;
    explore = exploreFilter(explore);
    if (mode === 'explore' && explore.length === 0) {
      explore = exploreFilter(offlineEx());
      if (explore.length) {
        warnings.push(
          noMixerExplore && parsedCount > 0
            ? 'AI 제안에 무알콜 재료를 새로 더하는 카드가 없어 앱이 대신 골랐어요.'
            : 'AI 가 새 재료 제안을 주지 않아 앱이 대신 골랐어요.',
        );
      }
    }
    if (mode === 'explore' && explore.length === 0 && !recipe) {
      throw new RecipeError('새 재료 추천을 만들지 못했어요. 맛 취향을 바꿔 다시 시도해 주세요.', 'NO_EXPLORE');
    }
    if (mode === 'explore' && !recipe) {
      // 재료는 있지만 지금 재료로 만들 레시피가 없음 → 이유를 맨 앞에 (백엔드 notice 와 같은 문구)
      const n = noUsableNotice(req, recipeErrCode, excludePumps);
      if (n) warnings.unshift(n);
    }
    return {
      recipe,
      explore,
      mode,
      source,
      model,
      warnings: Array.from(new Set(warnings)),
    };
  };

  let fallbackCode: string | undefined;
  /** 사용자 키로 Gemini 직접 호출 (v2.1 의 direct 경로). 실패하면 null → 오프라인 추천 (오류 문구는 fallbackReason) */
  const attemptGemini = async (): Promise<RecipeResult | null> => {
    try {
      if (!opts.geminiKey) throw new AiError(NO_KEY_TEXT, 'NO_KEY');
      const model = opts.geminiModel || DEFAULT_GEMINI_MODEL;
      const raw = await callGemini(opts.geminiKey, req, model, opts.timeoutMs ?? AI_TIMEOUT_MS);
      return finish(raw, 'direct', model);
    } catch (e: any) {
      if (e instanceof AiError && e.code === 'TIMEOUT') timedOut = true;
      fallbackCode = e instanceof AiError ? e.code : e instanceof RecipeError ? 'INVALID_RECIPE' : undefined;
      errors.push(e?.message ?? String(e));
      return null;
    }
  };

  if (opts.aiMode === 'gemini') {
    const r = await attemptGemini();
    if (r) return r;
  }

  // 오프라인 규칙기반 추천 (항상 마지막 안전망)
  let rawRecipe: unknown | null = null;
  if (req.ingredients.length && !exploreOnly) {
    if (opts.target) {
      // 탐색 카드의 재료가 모두 장착돼 "해당 레시피"를 그대로 만들 수 있을 때만 그것을 사용
      // (빈 기기 탐색처럼 새 재료가 2개인데 1개만 장착했으면 이름과 내용이 다른 음료가 되므로 일반 추천으로)
      try {
        const target = opts.target;
        const raw = exploreToRawRecipe(target);
        const t = normalizeRecipe(raw, ctx).recipe;
        const complete = target.ingredients.every((ti) => t.ingredients.some((i) => nameKey(i.name) === nameKey(ti.name)));
        if (complete) rawRecipe = raw;
      } catch {
        /* 아래 일반 오프라인 추천 */
      }
    }
    if (!rawRecipe) rawRecipe = offlineRecipe(req, { variation: opts.variation });
  }
  const res = finish({ recipe: rawRecipe, explore: offlineExplore(req, exploreOpts) }, 'offline');
  return {
    ...res,
    fallbackReason: opts.aiMode === 'offline' ? undefined : errors.join(' / ') || undefined,
    ...(opts.aiMode !== 'offline' && fallbackCode ? { fallbackCode } : {}),
    ...(timedOut && opts.aiMode !== 'offline' ? { timedOut: true } : {}),
  };
}
