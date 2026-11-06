/**
 * Capacitor 플러그인 불러오기 도우미 (APK 전용 — backends.ts · backButton.ts 가 사용)
 *
 * 주의 (ANDROID-1~4): Capacitor 플러그인 객체(registerPlugin 이 돌려주는 것)는 Proxy 라서 어떤 속성을 물어도 함수를 돌려줘요.
 * `then` 도 함수라서 Promise 를 플러그인 자체로 끝내면(`.then((m) => m.Preferences)`, async 함수에서 `return Plugin`,
 * `resolve(Plugin)`) JS 가 thenable 로 보고 `Plugin.then(resolve, reject)` 를 부르는데, 네이티브에는 then 메서드가 없으니
 * resolve 가 영영 불리지 않아 그 Promise 는 끝나지 않아요(키 저장·AI 추천·제조 시작·알림이 멈춘 원인).
 *  → 플러그인은 늘 상자 `{ plugin }` 에 담아 돌려주고, 쓰는 쪽에서 꺼내 곧바로 메서드를 부를 것.
 *    (모듈 객체·BleClient 같은 보통 객체는 then 이 없어 괜찮지만, 플러그인 Proxy 는 절대 그대로 돌려주지 말 것)
 */

/** 플러그인을 담은 상자 — 상자는 then 이 없어 Promise 결과로 써도 안전 */
export interface PluginBox<P> {
  readonly plugin: P;
}

export interface PluginLoader<P> {
  (): Promise<PluginBox<P>>;
  /** 다음 호출 때 다시 불러오기 (테스트·불러오기 실패 뒤) */
  reset(): void;
}

/**
 * 동적 import 한 모듈에서 플러그인을 골라 상자에 담아 돌려주는 함수 만들기 (처음 1번만 불러오고 기억, 실패하면 다음에 다시)
 * 예: const prefs = pluginLoader(() => import('@capacitor/preferences'), (m) => m.Preferences);
 *     const { plugin: P } = await prefs(); await P.get({ key });
 */
export function pluginLoader<M, P>(load: () => Promise<M>, pick: (m: M) => P): PluginLoader<P> {
  let cached: Promise<PluginBox<P>> | null = null;
  const get = (() => {
    if (!cached) {
      const p: Promise<PluginBox<P>> = load().then(
        (m) => ({ plugin: pick(m) }),
        (e) => {
          if (cached === p) cached = null;
          throw e;
        },
      );
      cached = p;
    }
    return cached;
  }) as PluginLoader<P>;
  get.reset = () => {
    cached = null;
  };
  return get;
}

/** p 가 ms 안에 끝나지 않으면 msg 오류로 끝냄 (네이티브가 응답하지 않아도 화면이 멈추지 않게). p 의 결과는 플러그인이 아니어야 함 */
export function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
