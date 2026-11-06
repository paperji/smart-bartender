/* Node 테스트용 expo-router 대역 — brew.ts 가 쓰는 router 만 (이동 기록을 __pushes 에 남김) */
const pushes = [];
const router = {
  push: (p) => pushes.push(p),
  navigate: (p) => pushes.push(p),
  replace: (p) => pushes.push(p),
  dismissTo: (p) => pushes.push(p),
  back() {},
  dismissAll() {},
  canGoBack: () => true,
  canDismiss: () => true,
};
module.exports = { router, __pushes: pushes };
