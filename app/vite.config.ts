/**
 * Vite 설정 — 웹·PWA·APK(Capacitor)·EXE(Electron) 공용 빌드 (WEBAPP_DESIGN §1·§2)
 *  - base './' : GitHub Pages 하위 경로·file://·Capacitor·Electron 어디서 열어도 같은 dist 가 동작 (라우팅은 HashRouter)
 *  - PWA: generateSW + 자동 업데이트. 서비스 워커 등록은 src/main.tsx 가 웹(https·localhost)에서만 함(injectRegister: false)
 *    APK·EXE 에서는 등록하지 않고, 남은 등록·캐시는 src/platform/boot.ts 가 지움. "앱 설치" 버튼은 src/platform/install.ts
 *  - 서비스 워커 추가 코드: public/sw-notify.js (제조 알림을 누르면 앱 창으로) — workbox.importScripts
 *  - 아이콘: scripts/gen-icons.mjs (npm run icons) 가 public/icons·android res·electron/icons 를 한 그림에서 만듦
 *  - '@' → src
 */
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'AI 스마트 바텐더',
        short_name: '바텐더',
        description: '기분과 취향을 고르면 AI 가 레시피를 만들고 칵테일 메이커가 만들어 줘요. (팀 홍당무)',
        lang: 'ko',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        // 밝은 톤: 설치한 앱의 제목 줄·시작 화면을 앱 바탕색(--bg)과 같게 (당근색은 아이콘에만)
        background_color: '#F7F6F3',
        theme_color: '#F7F6F3',
        categories: ['food', 'lifestyle', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // 앱 전체 + 글꼴(Pretendard 동적 서브셋 woff2)까지 미리 받아 오프라인에서도 같은 모양
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // HashRouter 라 화면 이동은 늘 index.html — 외부 API(Gemini·Open-Meteo)는 캐시하지 않음
        navigateFallback: 'index.html',
        // 제조 알림을 누르면 앱 창으로 (public/sw-notify.js 의 notificationclick — sw.js 와 같은 폴더 기준 상대 경로)
        importScripts: ['sw-notify.js'],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
});
