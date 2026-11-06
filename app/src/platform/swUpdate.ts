/**
 * 웹·PWA 새 버전 적용 시점 (서비스 워커 autoUpdate 의 onNeedReload — src/main.tsx)
 * 새 버전 서비스 워커가 자리를 잡으면 페이지를 새로고침해야 새 화면이 되는데, 아무 때나 하면
 *  - 기기 작업(제조·세척·구동) 중: 결과를 못 받아 기록·잔량 차감이 빠지고, 웹은 "사이트를 새로고침할까요?" 창이 뜸
 *  - AI 추천 중: 요청이 사라짐(사용량만 씀)
 *  - 실제 기기에 연결 중: 블루투스 연결이 끊김(웹은 기기를 다시 골라야 함)
 * → 이런 일이 없을 때 새로고침. 바쁘면 끝나기를 기다렸다가 처음 한가해질 때 1번 (PKG-1)
 * 앱을 처음 열 때 바로 오는 경우(대부분)는 아무 일도 없으니 곧바로 새로고침 — 예전과 같음
 */
import { useDevice, isBusy, type DeviceState } from '@/store/device';
import { useAiBusy } from '@/store/aiBusy';

/** 지금 새로고침하면 안 되는 이유가 있는지 */
export function appBusyForReload(dev: Pick<DeviceState, 'job' | 'conn' | 'transportKind'>, aiBusy: boolean): boolean {
  if (aiBusy) return true;
  if (isBusy(dev.job)) return true;
  // 실제 기기 연결은 새로고침하면 끊김 (데모 가상 기기는 다시 켜지므로 상관없음)
  if (dev.transportKind !== 'demo' && (dev.conn === 'connecting' || dev.conn === 'connected' || dev.conn === 'reconnecting')) return true;
  return false;
}

export interface ReloadDeps {
  busy(): boolean;
  /** 상태가 바뀔 때마다 cb — 해제 함수 반환 */
  subscribe(cb: () => void): () => void;
  reload(): void;
}

const realDeps: ReloadDeps = {
  busy: () => appBusyForReload(useDevice.getState(), useAiBusy.getState().busy),
  subscribe(cb) {
    const a = useDevice.subscribe(cb);
    const b = useAiBusy.subscribe(cb);
    return () => {
      a();
      b();
    };
  },
  reload: () => window.location.reload(),
};

let waiting: (() => void) | null = null;
let reloaded = false;

/** 한가하면 곧바로, 바쁘면 처음 한가해질 때 1번 새로고침 (여러 번 불러도 1번) */
export function reloadWhenIdle(deps: ReloadDeps = realDeps): void {
  if (reloaded || waiting) return;
  const tryReload = (): boolean => {
    if (reloaded) return true;
    if (deps.busy()) return false;
    reloaded = true;
    waiting?.();
    waiting = null;
    deps.reload();
    return true;
  };
  if (tryReload()) return;
  waiting = deps.subscribe(() => {
    tryReload();
  });
}

/** 테스트: 기다림·새로고침 기억 지우기 */
export function resetReloadWhenIdleForTest(): void {
  waiting?.();
  waiting = null;
  reloaded = false;
}
