/**
 * 앱 설정 — AI 모드, 서버 주소, 데모 모드, 성인 인증, 마지막 연결 기기, 알림 권한 요청 여부 등
 * (Gemini API 키는 여기 저장하지 않고 lib/secrets 의 보안 저장소에 따로 보관)
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/prompt';
import { DEFAULT_SERVER_URL } from '@/lib/ai/recommend';
import type { TransportKind } from '@/lib/transport/types';
import type { AiMode, DispenseMode } from '@/lib/types';

import { appStorage, STORAGE_KEYS } from './storage';

export interface RememberedDevice {
  id: string;
  name: string | null;
  at: number;
}

export interface SettingsState {
  aiMode: AiMode;
  serverUrl: string;
  geminiModel: string;
  /** 보안 저장소에 키가 있는지 표시용 (마지막 4자리만) */
  geminiKeyHint: string | null;
  demoMode: boolean;
  autoReconnect: boolean;
  dispenseMode: DispenseMode;
  adultVerifiedAt: number | null;
  /** 통신 방식별 마지막 연결 기기 (앱 시작 시 자동 재연결) — SPEC §5.5 */
  lastDevices: Partial<Record<TransportKind, RememberedDevice>>;
  /** 첫 제조 때 알림 권한을 이미 물어봤는지 */
  notifyAsked: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set' | 'reset' | 'rememberDevice' | 'forgetDevice'>>) => void;
  rememberDevice: (kind: TransportKind, id: string, name: string | null) => void;
  forgetDevice: (kind: TransportKind) => void;
  reset: () => void;
}

const defaults = {
  aiMode: 'server' as AiMode,
  serverUrl: DEFAULT_SERVER_URL,
  geminiModel: DEFAULT_GEMINI_MODEL,
  geminiKeyHint: null,
  demoMode: true,
  autoReconnect: true,
  dispenseMode: 'seq' as DispenseMode,
  adultVerifiedAt: null,
  lastDevices: {} as Partial<Record<TransportKind, RememberedDevice>>,
  notifyAsked: false,
};

/** v1 의 기본 모델 (새 기본값으로 자동 교체) */
const OLD_DEFAULT_MODELS = ['gemini-2.5-flash'];

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaults,
      set: (patch) => set(patch),
      rememberDevice: (kind, id, name) =>
        set({ lastDevices: { ...get().lastDevices, [kind]: { id, name, at: Date.now() } } }),
      forgetDevice: (kind) => {
        const next = { ...get().lastDevices };
        delete next[kind];
        set({ lastDevices: next });
      },
      reset: () => set({ ...defaults, lastDevices: {} }),
    }),
    {
      name: STORAGE_KEYS.settings,
      storage: appStorage,
      version: 2,
      partialize: ({ set: _s, reset: _r, rememberDevice: _a, forgetDevice: _f, ...rest }) => rest,
      migrate: (persisted: any, version) => {
        const s = { ...(persisted ?? {}) };
        if (version < 2) {
          // v1: lastDeviceId/lastDeviceName 하나만 저장 → 통신 방식별로 분리
          const lastDevices: Partial<Record<TransportKind, RememberedDevice>> = {};
          if (typeof s.lastDeviceId === 'string' && s.lastDeviceId && !s.lastDeviceId.startsWith('demo-device')) {
            lastDevices.native = { id: s.lastDeviceId, name: s.lastDeviceName ?? null, at: Date.now() };
          }
          delete s.lastDeviceId;
          delete s.lastDeviceName;
          s.lastDevices = lastDevices;
          if (!s.geminiModel || OLD_DEFAULT_MODELS.includes(s.geminiModel)) s.geminiModel = DEFAULT_GEMINI_MODEL;
          s.notifyAsked = false;
        }
        return s;
      },
    },
  ),
);
