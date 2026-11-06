/* Node 테스트용 lib/ui 대역 — brew.ts 가 쓰는 것만 (경고창은 __alerts 에 남기고, 확인창은 __confirm 값으로 답함) */
const alerts = [];
const api = {
  alertMessage: (title, msg) => alerts.push({ title, msg }),
  confirmAsync: async () => api.__confirm,
  fmtMl: (ml) => {
    const r = Math.round(ml * 10) / 10;
    return `${Number.isInteger(r) ? r : r.toFixed(1)}ml`;
  },
  haptic: { press() {}, tap() {}, success() {}, warning() {}, error() {}, heavy() {} },
  __alerts: alerts,
  __confirm: true,
};
module.exports = api;
