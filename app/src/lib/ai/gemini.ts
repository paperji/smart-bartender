/**
 * Gemini 키 도우미 — 설정 > AI 의 [키 확인]·모델 목록 (WEBAPP_DESIGN §4)
 *  - listModels(key): GET /v1beta/models (무료 호출) → generateContent 를 지원하는 gemini 텍스트 모델만
 *  - checkGeminiKey(key, model): 모델 목록 조회로 키 유효성 + 선택한 모델이 있는지 확인, 결과 문구(해요체)
 *  - 오류 분류는 recommend.ts 의 classifyGeminiError(백엔드와 같은 규칙) 를 그대로 쓰고,
 *    키 확인 화면용으로 AUTH 를 "키가 올바르지 않음" / "권한 없음" 으로 한 번 더 나눔
 * 키는 Google(generativelanguage.googleapis.com) 외에는 보내지 않습니다. 키 값을 로그에 남기지 않습니다.
 *  - 헤더에 쓸 수 없는 문자(보이지 않는 문자·한글 등)가 든 키는 보내지 않고 "키 오류" (예전: fetch TypeError → "인터넷 연결 없음")
 *  - 200 인데 모델 목록이 아닌 응답(와이파이 로그인·차단 페이지 등)은 성공으로 보지 않음
 *  - Google 오류 본문·문구에 든 키 값은 가림(apiKey.ts redactKey)
 */
import { hasInvalidKeyChars, KEY_FORMAT_TEXT, redactKey, redactKeyDeep } from './apiKey';
import { classifyGeminiError, type GeminiErrorCode } from './recommend';
import { DEFAULT_GEMINI_MODEL } from './prompt';

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** 키 확인(모델 목록) 시간 제한 */
export const LIST_MODELS_TIMEOUT_MS = 10000;
/** Google AI Studio 키 발급 주소 */
export const AI_STUDIO_KEY_URL = 'https://aistudio.google.com/apikey';

export interface GeminiModelInfo {
  /** 모델 ID ('models/' 를 뗀 이름, 예: gemini-3.6-flash) — 설정의 geminiModel 에 저장하는 값 */
  id: string;
  displayName: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

/** 텍스트 생성용이 아닌 gemini 모델 (이미지·음성·임베딩·실시간 등) */
const NON_TEXT_RE = /(embedding|image|imagen|tts|audio|live|vision|robotics|computer-use|veo|aqa|native)/i;

/**
 * /v1beta/models 응답 → 레시피 생성에 쓸 수 있는 모델만 (순수 함수 — 테스트용으로 따로 export)
 * 조건: supportedGenerationMethods 에 generateContent, 이름이 gemini 로 시작, 이미지·음성·임베딩 등 아님.
 * 정렬: 기본 모델 먼저, 그다음 이름 내림차순(새 버전이 위로). 같은 ID 는 하나만.
 */
export function filterGeminiModels(body: unknown): GeminiModelInfo[] {
  const list: any[] = body && typeof body === 'object' && Array.isArray((body as any).models) ? (body as any).models : [];
  const seen = new Set<string>();
  const out: GeminiModelInfo[] = [];
  for (const m of list) {
    if (!m || typeof m !== 'object' || typeof m.name !== 'string') continue;
    const id = m.name.replace(/^models\//, '').trim();
    if (!/^gemini-/i.test(id) || NON_TEXT_RE.test(id)) continue;
    const methods: unknown = m.supportedGenerationMethods;
    if (!Array.isArray(methods) || !methods.includes('generateContent')) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      displayName: typeof m.displayName === 'string' && m.displayName.trim() ? m.displayName.trim() : id,
      ...(typeof m.description === 'string' && m.description.trim() ? { description: m.description.trim().slice(0, 200) } : {}),
      ...(typeof m.inputTokenLimit === 'number' ? { inputTokenLimit: m.inputTokenLimit } : {}),
      ...(typeof m.outputTokenLimit === 'number' ? { outputTokenLimit: m.outputTokenLimit } : {}),
    });
  }
  return out.sort((a, b) => {
    if (a.id === DEFAULT_GEMINI_MODEL) return -1;
    if (b.id === DEFAULT_GEMINI_MODEL) return 1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** 모델 목록 조회 실패 */
export class GeminiListError extends Error {
  readonly code: GeminiErrorCode;
  readonly status: number;
  /** Google 이 준 오류 본문 (error 객체) — 키 확인 분류용. 키 값은 가려서 넣음(정지된 키 문구에는 키가 들어 있음) */
  readonly data: unknown;
  /** [키 확인] 화면에 기본 문구 대신 보여 줄 안내 (해요체) — 키 문자 오류·Gemini 가 아닌 응답 */
  readonly userMessage?: string;
  constructor(code: GeminiErrorCode, status: number, data: unknown, message: string, userMessage?: string) {
    super(message);
    this.name = 'GeminiListError';
    this.code = code;
    this.status = status;
    this.data = data;
    if (userMessage) this.userMessage = userMessage;
  }
}

/** 200 인데 JSON 모델 목록이 아닐 때 (와이파이 로그인 페이지·회사/학교 네트워크 차단 페이지 등) */
export const NOT_GEMINI_RESPONSE_TEXT =
  'Gemini 대신 다른 페이지가 응답했어요. 와이파이 로그인이 필요한지, 네트워크가 Google 을 막고 있지 않은지 확인한 뒤 다시 시도해 주세요.';
/** 200 이고 JSON 이지만 모델 목록 형식이 아닐 때 */
export const BAD_MODELS_RESPONSE_TEXT = 'Gemini 응답 형식이 예상과 달라 키를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';

/**
 * 키로 모델 목록 조회 (GET /v1beta/models, 쪽 나눔은 최대 5쪽까지 따라감).
 * 실패하면 GeminiListError(code = classifyGeminiError 결과)
 *  - 빈 키·헤더에 쓸 수 없는 문자가 든 키: 보내지 않고 AUTH(status 0)
 *  - JSON 이 아닌 응답(HTML·빈 응답): NETWORK(Gemini 가 아닌 곳이 응답) / JSON 인데 models 배열이 없음(첫 쪽): UPSTREAM
 */
export async function listModels(key: string, opts: { timeoutMs?: number } = {}): Promise<GeminiModelInfo[]> {
  const k = (key ?? '').trim();
  if (!k) throw new GeminiListError('AUTH', 0, null, 'API 키가 비어 있어요');
  // 보이지 않는 문자·한글 등은 헤더로 보낼 수 없어 fetch 가 TypeError → 연결 오류로 오인됨. 보내기 전에 키 오류로
  if (hasInvalidKeyChars(k)) throw new GeminiListError('AUTH', 0, null, '키에 쓸 수 없는 문자가 있어요', KEY_FORMAT_TEXT.chars);
  const timeoutMs = opts.timeoutMs ?? LIST_MODELS_TIMEOUT_MS;
  const all: unknown[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const url = `${GEMINI_API_BASE}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl?.abort();
    }, timeoutMs);
    let res: Response;
    let body: any = null;
    try {
      res = await fetch(url, { method: 'GET', headers: { 'x-goog-api-key': k }, signal: ctrl?.signal });
      const text = await res.text();
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
    } catch (e: any) {
      const code = classifyGeminiError({ status: 0, error: timedOut || e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK' });
      throw new GeminiListError(code, 0, null, code === 'TIMEOUT' ? '응답 시간이 넘었어요' : '인터넷 연결을 확인해 주세요');
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 400 || body?.error) {
      const code = classifyGeminiError({ status: res.status, data: body });
      // 정지된 키 문구 "Consumer 'api_key:<키>' …" 처럼 키가 들어 있을 수 있어 가림 (분류는 위에서 원본으로 끝냄)
      const data = body?.error != null ? redactKeyDeep(body.error, k) : null;
      throw new GeminiListError(code, res.status, data, redactKey(String(body?.error?.message ?? `HTTP ${res.status}`), k).slice(0, 120));
    }
    if (!body || typeof body !== 'object') {
      // 200 인데 JSON 이 아님(HTML·빈 응답) — 와이파이 로그인 페이지·차단 프록시 등. 키를 확인한 것이 아니므로 성공으로 보지 않음
      throw new GeminiListError('NETWORK', 0, null, `Gemini 가 아닌 응답(HTTP ${res.status})`, NOT_GEMINI_RESPONSE_TEXT);
    }
    if (!Array.isArray(body.models)) {
      // 첫 쪽부터 모델 목록이 없으면 확인 실패 (다음 쪽에서 없으면 거기까지만)
      if (page === 0) throw new GeminiListError('UPSTREAM', res.status, null, '모델 목록 형식이 달라요', BAD_MODELS_RESPONSE_TEXT);
      break;
    }
    all.push(...body.models);
    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : '';
    if (!pageToken) break;
  }
  return filterGeminiModels({ models: all });
}

/** [키 확인] 결과 종류 (WEBAPP_DESIGN §4 결과 문구) */
export type KeyCheckCode =
  | 'OK'
  | 'MODEL_MISSING'
  | 'INVALID_KEY'
  | 'PERMISSION'
  | 'QUOTA'
  | 'NETWORK'
  | 'ERROR';

export interface KeyCheckResult {
  /** 키를 쓸 수 있는지 (MODEL_MISSING 도 키 자체는 정상 → true) */
  ok: boolean;
  code: KeyCheckCode;
  /** 화면에 그대로 보여 줄 안내 (해요체) */
  message: string;
  /** 쓸 수 있는 모델 목록 (실패하면 []) */
  models: GeminiModelInfo[];
  /** 분류 전 Gemini 오류 코드 (진단용) */
  errorCode?: GeminiErrorCode;
}

const KEY_CHECK_TEXT: Record<Exclude<KeyCheckCode, 'OK' | 'MODEL_MISSING'>, string> = {
  INVALID_KEY: 'API 키가 올바르지 않아요. 복사한 키 전체를 다시 붙여 넣어 주세요.',
  PERMISSION: '이 키로는 Gemini API 를 쓸 권한이 없어요. Google AI Studio 에서 키의 프로젝트·제한 설정을 확인해 주세요.',
  QUOTA: '사용량 한도에 걸렸거나 크레딧이 모두 소진됐어요. 잠시 후 다시 시도하거나 Google AI Studio 에서 확인해 주세요.',
  NETWORK: '인터넷에 연결되어 있지 않아요. 연결을 확인한 뒤 다시 시도해 주세요.',
  ERROR: 'Gemini 서버에서 오류가 났어요. 잠시 후 다시 시도해 주세요.',
};

/**
 * Gemini 오류 → [키 확인] 결과 종류 (classifyGeminiError 결과를 화면용으로 한 번 더 나눔)
 *  - 400·401·403 + API_KEY_INVALID / "API key not valid" → INVALID_KEY (401 은 항상 INVALID_KEY)
 *  - 그 밖 403 (PERMISSION_DENIED·API 미사용 설정 등) → PERMISSION
 *  - 429 RESOURCE_EXHAUSTED(RATE_LIMIT)·402 크레딧 소진(BILLING) → QUOTA
 *  - 연결 실패·시간 초과 → NETWORK
 */
export function keyCheckCodeFor(r: { status: number; data?: any; error?: 'TIMEOUT' | 'NETWORK' }): KeyCheckCode {
  const code = classifyGeminiError(r);
  const detail = JSON.stringify((r.data && (r.data.error ?? r.data)) || {});
  const invalidKey = /API_KEY_INVALID|API key not valid|API_KEY_EXPIRED|expired/i.test(detail);
  switch (code) {
    case 'TIMEOUT':
    case 'NETWORK':
      return 'NETWORK';
    case 'RATE_LIMIT':
    case 'BILLING':
      return 'QUOTA';
    case 'AUTH':
      if (invalidKey || r.status === 401 || r.status === 400) return 'INVALID_KEY';
      return 'PERMISSION';
    case 'BAD_REQUEST':
      return invalidKey ? 'INVALID_KEY' : 'ERROR';
    default:
      return 'ERROR';
  }
}

/** [키 확인] — 모델 목록 조회(무료)로 키 유효성과 선택 모델 존재를 확인 */
export async function checkGeminiKey(
  key: string,
  model: string = DEFAULT_GEMINI_MODEL,
  opts: { timeoutMs?: number } = {},
): Promise<KeyCheckResult> {
  try {
    const models = await listModels(key, opts);
    const want = (model || DEFAULT_GEMINI_MODEL).trim();
    if (!models.some((m) => m.id === want)) {
      return {
        ok: true,
        code: 'MODEL_MISSING',
        message: `키는 정상이에요. 다만 선택한 모델(${want})을 이 키로 쓸 수 없어요. 목록에서 다른 모델을 골라 주세요.`,
        models,
      };
    }
    return { ok: true, code: 'OK', message: `키가 확인됐어요. 사용할 수 있는 모델 ${models.length}개 중 ${want} 를 써요.`, models };
  } catch (e: any) {
    if (e instanceof GeminiListError) {
      const code: KeyCheckCode =
        e.status === 0
          ? e.code === 'TIMEOUT' || e.code === 'NETWORK'
            ? 'NETWORK'
            : 'INVALID_KEY'
          : keyCheckCodeFor({ status: e.status, data: { error: e.data } });
      const message = e.userMessage ?? KEY_CHECK_TEXT[code as keyof typeof KEY_CHECK_TEXT];
      return { ok: false, code, message, models: [], errorCode: e.code };
    }
    return { ok: false, code: 'ERROR', message: KEY_CHECK_TEXT.ERROR, models: [] };
  }
}

/** 설정에 저장할 키 힌트 — 마지막 4자리만 (너무 짧은 값은 가림). 화면 표시는 lib/format.ts maskKeyHint */
export function keyHint(key: string | null | undefined): string | null {
  const k = (key ?? '').trim();
  if (!k) return null;
  return k.length <= 8 ? '••••' : k.slice(-4);
}
