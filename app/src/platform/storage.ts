/**
 * 영구 저장소 (WEBAPP_DESIGN §2) — zustand persist 용 JSON 저장소 + 단순 키-값 도우미
 *  - 브라우저·PWA·Electron·Capacitor(WebView) 모두 localStorage 사용
 *  - localStorage 가 없거나(Node 테스트·사파리 비공개 모드 등) 쓰기에 실패하면 메모리 저장으로 대신함
 *  - 메모리에는 "localStorage 에 쓰지 못한 값"만 둠. 예전처럼 늘 메모리에도 써 두면, 다른 창(탭)에서 localStorage 의 값을
 *    지워도(예: Gemini 키 삭제) 이 창은 메모리의 옛 값을 계속 돌려줬음 → localStorage 가 정상이면 늘 localStorage 값을 따름
 * v3.0 저장 키는 모두 'sb3.' 로 시작 (v2.1 앱의 'sb.' 키와 겹치지 않게)
 */
import { createJSONStorage } from 'zustand/middleware';

/** localStorage 에 쓰지 못한(또는 localStorage 가 없는) 이 창의 최신 값만 */
const memory = new Map<string, string>();

function ls(): Storage | null {
  try {
    const s = (globalThis as any).localStorage as Storage | undefined;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

/** 동기 키-값 저장소 모양 (zustand StateStorage 와 호환) */
export interface SyncStorage {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
}

/**
 * 동기 키-값 저장 (실패하면 메모리)
 *  - getItem: 이 창에서 localStorage 에 쓰지 못한 값이 있으면 그것(가장 최근 값), 아니면 localStorage 값 그대로
 *    (null 이면 null — 다른 창에서 지운 것을 따름). localStorage 를 못 읽으면(예외) null
 *  - setItem: localStorage 에 쓰면 메모리 값은 지우고, 못 쓰면(없음·용량 초과·비공개 모드) 메모리에만
 */
export const kv: SyncStorage = {
  getItem(name) {
    if (memory.has(name)) return memory.get(name) as string;
    const s = ls();
    if (!s) return null;
    try {
      return s.getItem(name);
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    const s = ls();
    if (s) {
      try {
        s.setItem(name, value);
        memory.delete(name);
        return;
      } catch {
        /* 용량 초과·비공개 모드 — 메모리에만 */
      }
    }
    memory.set(name, value);
  },
  removeItem(name) {
    memory.delete(name);
    const s = ls();
    if (!s) return;
    try {
      s.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

/** zustand persist 용 */
export const persistStorage = createJSONStorage(() => kv);
