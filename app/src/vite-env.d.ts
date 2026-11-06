/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** 개발용 테스트 Gemini 키 — app/.env.development.local, `npm run dev` 에서만 (platform/devKey.ts) */
  readonly VITE_DEV_GEMINI_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
