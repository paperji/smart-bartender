/*
 * 서비스 워커 추가 코드 (웹·PWA 전용) — vite.config.ts 의 workbox.importScripts 로 생성된 sw.js 가 불러옴
 * 제조 알림(platform/notify.ts 의 registration.showNotification)을 누르면 열려 있는 앱 창으로 가고, 없으면 앱을 새로 엶.
 * 서비스 워커가 띄운 알림은 눌러도 기본 동작이 없어서 이 처리가 있어야 함 (PKG-4)
 */
/* eslint-disable no-restricted-globals */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const scope = self.registration.scope;
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((w) => w.url.startsWith(scope));
      if (win) {
        try {
          return await win.focus();
        } catch {
          /* 포커스를 못 하면 새 창으로 */
        }
      }
      return self.clients.openWindow(scope);
    })(),
  );
});
