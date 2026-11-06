/* Node 테스트용 알림 대역 — 보낸 알림을 __sent 에 남김 */
const sent = [];
module.exports = {
  notify: async (kind, title, body) => {
    sent.push({ kind, title, body });
  },
  requestNotifyPermission: async () => true,
  __sent: sent,
};
