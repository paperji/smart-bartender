/**
 * 테스트용 document 대역 — platform/appState.ts 가 쓰는 visibilityState + visibilitychange 이벤트만
 * (v2.1 의 react-native AppState.__emit 대신). 앱 모듈을 불러오기 전에 설치해야 함
 */
type Visibility = 'visible' | 'hidden';

export interface FakeDocument {
  /** 앱 상태 바꾸기: 'active' = 보임, 'background' = 가려짐 → visibilitychange 발생 */
  emit(state: 'active' | 'background'): void;
}

export function installFakeDocument(): FakeDocument {
  const g = globalThis as any;
  if (g.__sbFakeDocument) return g.__sbFakeDocument as FakeDocument;
  const target = new EventTarget();
  let visibility: Visibility = 'visible';
  const doc = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
  if (typeof g.document === 'undefined') g.document = doc;
  const api: FakeDocument = {
    emit(state) {
      visibility = state === 'active' ? 'visible' : 'hidden';
      target.dispatchEvent(new Event('visibilitychange'));
    },
  };
  g.__sbFakeDocument = api;
  return api;
}
