/**
 * Capacitor 설정 — 같은 웹 빌드(dist/)를 감싼 안드로이드 APK (WEBAPP_DESIGN §1·§7)
 *  - 이 파일은 Node 의 TypeScript 형식 지우기(type stripping)로 바로 읽혀요(TypeScript 7 은 예전 컴파일러 API 가 없음).
 *    그래서 `import type` 과 타입 표기만 쓰고 enum·namespace 같은 문법은 쓰지 마세요.
 *  - 상태 표시줄·내비게이션 바: 밝은 바탕에 어두운 아이콘(LIGHT), 화면 가장자리까지 그리기(viewport-fit=cover + env(safe-area-inset-*))
 *  - 알림 아이콘: android/app/src/main/res/drawable*\/ic_stat_notify.png (scripts/gen-icons.mjs 가 만듦)
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'kr.ac.anyang.hongdangmu.bartender',
  appName: 'AI 스마트 바텐더',
  webDir: 'dist',
  backgroundColor: '#F7F6F3',
  loggingBehavior: 'debug',
  android: {
    allowMixedContent: false,
    captureInput: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'LIGHT',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#FF7A2F',
    },
  },
};

export default config;
