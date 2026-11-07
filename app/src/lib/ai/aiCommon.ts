/**
 * AI 호출 공통 도구 (v3.1 — 여러 AI 회사 공용, recommend.ts·aiClient.ts·gemini.ts 가 씀)
 *  - AiError · fetchJson(시간 제한) · extractJson(코드 블록·앞뒤 글 제거) · splitGeminiJson({recipe, explore} 나누기)
 *  - 오류 코드(AiErrorCode)와 쉬운 안내(AI_ERROR_TEXT) — 회사와 상관없이 같은 코드
 *  - classifyGeminiError: Gemini 오류 분류 — 백엔드 backend/lib/gemini.js classify() 와 같은 규칙 (parity 테스트로 비교)
 */

/** AI 호출 1회 시간 제한 (SPEC §3.1: 25초) */
export const AI_TIMEOUT_MS = 25000;

export class AiError extends Error {
  /** 'TIMEOUT' = 응답 시간 초과 (안내 문구 구분용). AI 호출 오류는 AiErrorCode */
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

export async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: any }> {
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

/** AI 가 준 글 → JSON (```json 코드 블록·앞뒤 설명이 붙어 있어도 첫 { ~ 마지막 } 을 꺼냄) */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1));
      } catch {
        /* 아래 오류 */
      }
    }
    throw new AiError('AI 응답을 해석하지 못했어요');
  }
}

/** AI 응답 JSON → { recipe, explore } (예전 형식: 최상위가 레시피) */
export function splitGeminiJson(json: any): { recipe: unknown | null; explore: unknown } {
  if (json && typeof json === 'object' && ('recipe' in json || 'explore' in json)) {
    const r = json.recipe && typeof json.recipe === 'object' ? json.recipe : null;
    return { recipe: r, explore: json.explore };
  }
  return { recipe: json && typeof json === 'object' ? json : null, explore: [] };
}

/** AI 호출 오류 코드 (SPEC §3.2 warningCode 와 같은 이름) — 회사와 상관없이 같은 코드 */
export type AiErrorCode = 'TIMEOUT' | 'NETWORK' | 'RATE_LIMIT' | 'BILLING' | 'AUTH' | 'MODEL' | 'BAD_REQUEST' | 'UPSTREAM';
/** 예전 이름 (v3.0) */
export type GeminiErrorCode = AiErrorCode;

/**
 * Gemini HTTP 결과 → 오류 코드 — 백엔드 backend/lib/gemini.js classify() 와 같은 규칙 (parity 테스트로 비교)
 *  - BILLING: 402 또는 "prepayment credits are depleted" 처럼 선불 크레딧 소진 문구일 때만.
 *    'billing' 단어만으로는 판단하지 않음 — 무료 등급의 일반 429 문구 "You exceeded your current quota, please check your
 *    plan and billing details" 에도 들어 있어, 그것은 RATE_LIMIT(무료 등급 한도 초과, 잠시 후 다시 시도)
 *  - AUTH: 401·403 또는 API_KEY_INVALID / API key not valid / PERMISSION_DENIED
 *  - RATE_LIMIT 429 · MODEL 404 · BAD_REQUEST 400 · 그 밖 UPSTREAM
 * r.error: fetch 자체가 실패한 경우 'TIMEOUT' | 'NETWORK'
 */
export function classifyGeminiError(r: { status: number; data?: any; error?: 'TIMEOUT' | 'NETWORK' }): AiErrorCode {
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

/** 키가 없어 AI 를 부르지 않았을 때 (fallbackCode 'NO_KEY') */
export const NO_KEY_TEXT = 'AI API 키가 설정되지 않았어요';

/** 오류 코드별 쉬운 안내 (오프라인 추천으로 바뀐 이유에 보임) — 회사와 상관없는 문구 */
export const AI_ERROR_TEXT: Record<AiErrorCode, string> = {
  TIMEOUT: '응답 시간이 넘었어요',
  NETWORK: 'AI 서버에 연결하지 못했어요',
  RATE_LIMIT: '사용량 한도에 걸렸어요(무료 등급은 잠시 후 다시 시도)',
  BILLING: '사용 크레딧이 없어요(AI 회사 사이트에서 결제 확인)',
  AUTH: 'API 키가 올바르지 않거나 권한이 없어요(설정에서 키 확인)',
  MODEL: '모델을 찾을 수 없어요(설정에서 모델 이름 확인)',
  BAD_REQUEST: '요청이 거절됐어요',
  UPSTREAM: 'AI 서버 오류예요',
};
/** 예전 이름 (v3.0) */
export const GEMINI_ERROR_TEXT = AI_ERROR_TEXT;
