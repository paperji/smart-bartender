/**
 * 테스트용 알림 대역 (v2.1 의 lib/notify 대역 대신) — platform/notify 에 기록용 구현을 끼움
 * 보낸 알림은 sent 에 { kind, title, body } 로 남음 (시스템 알림을 "띄운 것"으로 처리 → 토스트 없음)
 */
import { registerNotifyBackend, type NotifyKind } from '../../src/platform/notify';

export const sent: { kind: NotifyKind; title: string; body: string }[] = [];

export function installNotifyStub(): typeof sent {
  registerNotifyBackend({
    permission: async () => 'granted',
    requestPermission: async () => true,
    show: async (kind, title, body) => {
      sent.push({ kind, title, body });
      return true;
    },
  });
  return sent;
}
