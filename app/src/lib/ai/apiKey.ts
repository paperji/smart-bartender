/**
 * Gemini API 키 문자열 도우미 (WEBAPP_DESIGN §4) — 설정 화면 형식 검사, 키 확인·레시피 호출 전 검사, 오류 문구에서 키 가리기
 *  - 키는 HTTP 헤더(x-goog-api-key)로 보내므로 보이는 ASCII 문자(0x21~0x7E)만 쓸 수 있어요.
 *    보이지 않는 문자(U+200B 등)나 한글이 섞이면 fetch 가 요청을 만들기 전에 TypeError 를 던지고,
 *    그것을 "인터넷 연결 없음" 으로 잘못 안내했었음 → 저장 전·호출 전에 걸러 "키 오류" 로 안내
 *  - Google 오류 문구에 키가 그대로 들어올 수 있음 (정지된 키: "Consumer 'api_key:<키>' has been suspended.")
 *    → 화면·저장(fallbackReason) 전에 redactKey 로 가림. 키 값은 화면·토스트·로그에 남기지 않음
 */

/** 붙여 넣은 키의 최소 길이 (v2.1 과 같은 20자) */
export const MIN_KEY_LENGTH = 20;

/** 헤더에 그대로 넣을 수 없는 문자 (보이는 ASCII 0x21~0x7E 밖: 빈칸·보이지 않는 문자·한글 등) */
const NON_KEY_CHAR_RE = /[^\x21-\x7E]/;

/** 형식 검사 안내 (해요체) */
export const KEY_FORMAT_TEXT = {
  short: '키가 너무 짧아요. 복사한 키 전체를 다시 붙여 넣어 주세요.',
  space: '키 중간에 빈칸이 있어요. 복사한 키를 그대로 붙여 넣어 주세요.',
  chars: '키에 보이지 않는 문자나 한글 같은 다른 글자가 섞여 있어요. Google AI Studio 의 복사 버튼으로 키를 다시 복사해 붙여 넣어 주세요.',
} as const;

/** 키에 헤더로 보낼 수 없는 문자가 있는지 (앞뒤 공백은 잘라서 봄) */
export function hasInvalidKeyChars(key: string | null | undefined): boolean {
  return NON_KEY_CHAR_RE.test((key ?? '').trim());
}

/** 붙여 넣은 키의 최소 형식 검사 (20자 이상 + 중간 빈칸 없음 + 보이는 ASCII 만). 문제없으면 null */
export function keyFormatProblem(key: string | null | undefined): string | null {
  const k = (key ?? '').trim();
  if (k.length < MIN_KEY_LENGTH) return KEY_FORMAT_TEXT.short;
  if (/\s/.test(k)) return KEY_FORMAT_TEXT.space;
  if (NON_KEY_CHAR_RE.test(k)) return KEY_FORMAT_TEXT.chars;
  return null;
}

/** 가린 자리 표시 */
export const KEY_MASK = '••••';

/**
 * 글에서 API 키를 가림 — 넘겨준 키 값 그대로 + 키 모양(AIza…·AQ.…) + "api_key:…" + "key=…"
 * (Google 오류 문구를 화면에 보이거나 저장하기 전에 사용)
 */
export function redactKey(text: string, key?: string | null): string {
  let s = String(text ?? '');
  const k = (key ?? '').trim();
  if (k.length >= 8) s = s.split(k).join(KEY_MASK);
  return s
    .replace(/api_key:[^'"\s]+/gi, `api_key:${KEY_MASK}`)
    .replace(/([?&]key=)[^&'"\s]+/gi, `$1${KEY_MASK}`)
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, KEY_MASK)
    .replace(/\bAQ\.[0-9A-Za-z_.-]{10,}/g, KEY_MASK);
}

/** 객체·배열 안의 모든 글자에 redactKey (Google 오류 본문 error 객체용, 깊이 제한) */
export function redactKeyDeep<T>(value: T, key?: string | null, depth = 0): T {
  if (typeof value === 'string') return redactKey(value, key) as T;
  if (depth > 8 || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactKeyDeep(v, key, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactKeyDeep(v, key, depth + 1);
  return out as T;
}
