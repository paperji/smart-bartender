/**
 * 시작점 — 글꼴(Pretendard, 동적 서브셋) · UI 키트 스타일 · 앱 렌더 · (웹만) 서비스 워커 등록
 * 새 버전이 자리를 잡으면 기기 작업·AI 추천·실제 기기 연결이 없을 때 새로고침 (platform/swUpdate.ts)
 */
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './ui/theme.css';
import './ui/components.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { canRegisterServiceWorker } from './platform/detect';
import { reloadWhenIdle } from './platform/swUpdate';

const el = document.getElementById('root');
if (!el) throw new Error('#root 가 없어요');

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA(오프라인 실행·설치): 웹(https·localhost)에서만 등록. file://·APK(Capacitor)·EXE(Electron) 에서는 등록하지 않음
if (import.meta.env.PROD && canRegisterServiceWorker()) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true, onNeedReload: () => reloadWhenIdle() }))
    .catch(() => undefined);
}
