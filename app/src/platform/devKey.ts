/**
 * 개발용 테스트 키 (WEBAPP_DESIGN §4)
 *  - app/.env.development.local 의 VITE_DEV_GEMINI_KEY 를 `npm run dev` 에서만 읽음
 *  - 배포 빌드(`vite build`)에서는 import.meta.env.DEV 가 false 로 바뀌어 이 분기가 통째로 지워짐(dead code)
 *    + production 모드는 .env.development.local 을 읽지도 않음 → 이중 안전. scripts/check-no-secrets.mjs 가 dist 를 검사
 *  - Node(테스트)에는 import.meta.env 가 없으므로 undefined
 * 키 값을 출력·로그에 남기지 마세요.
 */

interface DevEnv {
  DEV?: boolean;
  VITE_DEV_GEMINI_KEY?: string;
}

/** env 에서 개발용 키 고르기 (DEV 가 true 일 때만) — 순수 함수, 테스트용 export */
export function pickDevKey(env: DevEnv | null | undefined): string | undefined {
  if (!env || env.DEV !== true) return undefined;
  const k = env.VITE_DEV_GEMINI_KEY;
  return typeof k === 'string' && k.trim() ? k.trim() : undefined;
}

/** 개발 서버에서만 개발용 테스트 키, 그 밖에는 undefined */
export function getDevGeminiKey(): string | undefined {
  // 아래 두 줄의 `import.meta.env.DEV` 는 Vite 가 빌드 때 상수(false)로 바꾸므로 이 형태 그대로 두세요
  if (typeof import.meta.env === 'undefined') return undefined;
  if (!import.meta.env.DEV) return undefined;
  return pickDevKey({ DEV: import.meta.env.DEV, VITE_DEV_GEMINI_KEY: import.meta.env.VITE_DEV_GEMINI_KEY });
}

/** "개발용 테스트 키 사용" 버튼을 보여 줄지 (개발 서버 + 키가 있을 때만) */
export function hasDevGeminiKey(): boolean {
  return getDevGeminiKey() !== undefined;
}
