/**
 * 모두의 레시피(공유) — 이 기기에 남기는 것 (v3.1)
 *  - nickname: 공유할 때 쓰는 별명 (다음 공유 때 미리 채움, 비우면 익명)
 *  - mine: 내가 올린 레시피 (레시피 키 → 공유 id) — 기록 화면의 "공유됨" 표시·공유 취소용
 *  - counted: 사용 횟수를 이미 보낸 공유 레시피 (같은 레시피를 또 만들어도 다시 보내지 않음 — 서버도 기기당 1번만 셈)
 *  - pendingUses: 인터넷이 끊겨 못 보낸 사용 기록 (앱을 켤 때·모두의 레시피를 열 때 다시 보냄)
 *  - reported: 내가 신고한 레시피 (서버도 이 기기에는 다시 보여 주지 않음)
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { recordUse, ShareError, SHARE_LIMITS } from '@/lib/share/api';
import { shareDeviceId } from '@/lib/share/device';

import { appStorage } from './storage';

export const SHARED_STORAGE_KEY = 'sb3.shared';
const MAX_IDS = 300;

export interface MyShare {
  id: string;
  at: number;
  name: string;
}

interface SharedData {
  nickname: string;
  mine: Record<string, MyShare>;
  counted: string[];
  pendingUses: string[];
  reported: string[];
}

interface SharedState extends SharedData {
  setNickname: (n: string) => void;
  markShared: (key: string, share: MyShare) => void;
  unmarkShared: (id: string) => void;
  markCounted: (id: string) => void;
  addPending: (id: string) => void;
  removePending: (id: string) => void;
  markReported: (id: string) => void;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 80).slice(-MAX_IDS) : []);
const addId = (list: string[], id: string) => (list.includes(id) ? list : [...list, id].slice(-MAX_IDS));

/** 저장값 → 온전한 값 */
export function sanitizeShared(raw: unknown): SharedData {
  const p = isObj(raw) ? raw : {};
  const mine: Record<string, MyShare> = {};
  if (isObj(p.mine)) {
    for (const [k, v] of Object.entries(p.mine)) {
      if (isObj(v) && typeof v.id === 'string' && v.id) {
        mine[k] = { id: v.id, at: typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : 0, name: typeof v.name === 'string' ? v.name : '' };
      }
    }
  }
  const counted = ids(p.counted);
  return {
    nickname: typeof p.nickname === 'string' ? p.nickname.slice(0, SHARE_LIMITS.nickname) : '',
    mine,
    counted,
    // 이미 보낸 것은 기다리는 목록에서 뺌 (예전에 함께 남은 것 정리)
    pendingUses: ids(p.pendingUses).filter((id) => !counted.includes(id)),
    reported: ids(p.reported),
  };
}

export const useShared = create<SharedState>()(
  persist(
    (set, get) => ({
      nickname: '',
      mine: {},
      counted: [],
      pendingUses: [],
      reported: [],
      setNickname: (n) => set({ nickname: n.slice(0, SHARE_LIMITS.nickname) }),
      markShared: (key, share) => set({ mine: { ...get().mine, [key]: share } }),
      unmarkShared: (id) => set({ mine: Object.fromEntries(Object.entries(get().mine).filter(([, v]) => v.id !== id)) }),
      markCounted: (id) => set({ counted: addId(get().counted, id), pendingUses: get().pendingUses.filter((x) => x !== id) }),
      addPending: (id) => (get().counted.includes(id) ? undefined : set({ pendingUses: addId(get().pendingUses, id) })),
      removePending: (id) => set({ pendingUses: get().pendingUses.filter((x) => x !== id) }),
      markReported: (id) => set({ reported: addId(get().reported, id) }),
    }),
    {
      name: SHARED_STORAGE_KEY,
      storage: appStorage,
      version: 1,
      partialize: ({ nickname, mine, counted, pendingUses, reported }) => ({ nickname, mine, counted, pendingUses, reported }),
      merge: (persisted, current) => ({ ...current, ...sanitizeShared(persisted) }),
    },
  ),
);

/** 다시 보내도 소용없는 오류 (지워졌거나 하루 한도) — 기다리는 목록에서 뺌 */
const GIVE_UP = new Set(['NOT_FOUND', 'INVALID', 'RATE_LIMIT']);

/**
 * 공유 레시피로 실제로 만들기 시작함 → 사용 횟수 1번 (이 기기에서 처음일 때만). 실패해도 제조에는 영향 없음
 * 인터넷 문제로 못 보내면 기다리는 목록에 넣고 나중에 다시 보냄
 */
export async function recordSharedUse(id: string): Promise<void> {
  const st = useShared.getState();
  if (!id) return;
  if (st.counted.includes(id)) {
    st.removePending(id);
    return;
  }
  // 보내기 전에 먼저 남겨 둠 — 보내는 도중 앱이 닫혀도 다음에 다시 보냄 (서버는 같은 기기 1번만 셈)
  st.addPending(id);
  try {
    await recordUse(shareDeviceId(), id);
    useShared.getState().markCounted(id);
  } catch (e) {
    if (e instanceof ShareError && GIVE_UP.has(e.code)) useShared.getState().markCounted(id);
    // 그사이 다른 요청(제조 시작 등)이 이미 보냈으면 다시 넣지 않음
    else if (!useShared.getState().counted.includes(id)) useShared.getState().addPending(id);
  }
}

let flushing: Promise<void> | null = null;

/** 못 보낸 사용 기록 다시 보내기 (앱 시작·모두의 레시피 화면) */
export function flushSharedUses(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const id of [...useShared.getState().pendingUses]) {
      // 보낸 게 확인될 때(markCounted)까지 기다리는 목록에 그대로 둠
      await recordSharedUse(id);
      // 인터넷이 여전히 안 되면 남은 것은 다음에
      const st = useShared.getState();
      if (st.pendingUses.includes(id) && !st.counted.includes(id)) break;
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
