/* Node 테스트용 react-native 대역 — DeviceClient 가 쓰는 부분만 (Platform · AppState) */
const listeners = new Set();
const AppState = {
  currentState: 'active',
  addEventListener(_type, cb) {
    listeners.add(cb);
    return { remove: () => listeners.delete(cb) };
  },
  /** 테스트에서 앱 상태 변경 흉내 */
  __emit(state) {
    AppState.currentState = state;
    for (const cb of Array.from(listeners)) cb(state);
  },
};
module.exports = {
  Platform: { OS: 'android', Version: 34, select: (o) => o.android ?? o.native ?? o.default },
  AppState,
  PermissionsAndroid: {},
};
