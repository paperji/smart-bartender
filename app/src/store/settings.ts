/**
 * 앱 설정 — AI 방식·모델, 데모 모드, 성인 인증, 배출 모드, 마지막 연결 기기, 알림 권한 요청 여부, 첫 실행 안내 등
 * (Gemini API 키 자체는 여기 저장하지 않고 platform/secrets 에 따로 보관 — 여기에는 마지막 4자리 힌트만)
 * v3.0: 서버 모드·서버 주소 제거, aiMode 'gemini'(기본, 키가 없으면 실제로는 오프라인) | 'offline' (WEBAPP_DESIGN §4)
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { keyHint } from '@/lib/ai/gemini';
import { effectiveAiMode } from '@/lib/ai/mode';
import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/prompt';
import type { TransportKind } from '@/lib/transport/types';
import type { AiMode, DispenseMode } from '@/lib/types';
import { clearGeminiKey, getGeminiKey, setGeminiKey } from '@/platform/secrets';

import { appStorage, STORAGE_KEYS } from './storage';

export interface RememberedDevice {
  id: string;
  name: string | null;
  at: number;
}

export interface SettingsData {
  /** 설정한 AI 방식 — 'gemini' 여도 키가 없으면 실제로는 오프라인 (useEffectiveAiMode) */
  aiMode: AiMode;
  geminiModel: string;
  /** 저장된 키의 마지막 4자리 (키가 없으면 null) — 화면 표시·"키 있음" 판단용 */
  geminiKeyHint: string | null;
  demoMode: boolean;
  autoReconnect: boolean;
  dispenseMode: DispenseMode;
  adultVerifiedAt: number | null;
  /** 통신 방식별 마지막 연결 기기 (앱 시작 시 자동 재연결) — SPEC §5.5 */
  lastDevices: Partial<Record<TransportKind, RememberedDevice>>;
  /** 첫 제조 때 알림 권한을 이미 물어봤는지 */
  notifyAsked: boolean;
  /** 첫 실행 안내 카드("AI 키를 등록하면…")를 닫았는지 */
  onboardingDismissed: boolean;
}

export interface SettingsState extends SettingsData {
  set: (patch: Partial<SettingsData>) => void;
  rememberDevice: (kind: TransportKind, id: string, name: string | null) => void;
  forgetDevice: (kind: TransportKind) => void;
  reset: () => void;
}

export const SETTINGS_DEFAULTS: SettingsData = {
  aiMode: 'gemini',
  geminiModel: DEFAULT_GEMINI_MODEL,
  geminiKeyHint: null,
  demoMode: true,
  autoReconnect: true,
  dispenseMode: 'seq',
  adultVerifiedAt: null,
  lastDevices: {},
  notifyAsked: false,
  onboardingDismissed: false,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/**
 * 저장돼 있던 설정 → 온전한 설정 값 (알 수 없는 값·모양이 틀린 값은 기본값으로).
 * 설정 값 칸만 꺼냄 — 저장값에 set·reset 같은 이름이 섞여 있어도 함수를 덮어쓰지 않게
 */
export function sanitizeSettings(raw: unknown): SettingsData {
  const p = isObj(raw) ? raw : {};
  const d = SETTINGS_DEFAULTS;
  const lastDevices: SettingsData['lastDevices'] = {};
  if (isObj(p.lastDevices)) {
    for (const [kind, dev] of Object.entries(p.lastDevices)) {
      if (isObj(dev) && typeof dev.id === 'string' && dev.id) {
        lastDevices[kind as TransportKind] = {
          id: dev.id,
          name: typeof dev.name === 'string' ? dev.name : null,
          at: typeof dev.at === 'number' && Number.isFinite(dev.at) ? dev.at : 0,
        };
      }
    }
  }
  return {
    aiMode: p.aiMode === 'gemini' || p.aiMode === 'offline' ? p.aiMode : d.aiMode,
    geminiModel: typeof p.geminiModel === 'string' && p.geminiModel.trim() ? p.geminiModel : DEFAULT_GEMINI_MODEL,
    geminiKeyHint: typeof p.geminiKeyHint === 'string' && p.geminiKeyHint ? p.geminiKeyHint : null,
    demoMode: bool(p.demoMode, d.demoMode),
    autoReconnect: bool(p.autoReconnect, d.autoReconnect),
    dispenseMode: p.dispenseMode === 'seq' || p.dispenseMode === 'par' ? p.dispenseMode : 'seq',
    adultVerifiedAt: typeof p.adultVerifiedAt === 'number' && Number.isFinite(p.adultVerifiedAt) ? p.adultVerifiedAt : null,
    lastDevices,
    notifyAsked: bool(p.notifyAsked, d.notifyAsked),
    onboardingDismissed: bool(p.onboardingDismissed, d.onboardingDismissed),
  };
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...SETTINGS_DEFAULTS,
      set: (patch) => set(patch),
      rememberDevice: (kind, id, name) =>
        set({ lastDevices: { ...get().lastDevices, [kind]: { id, name, at: Date.now() } } }),
      forgetDevice: (kind) => {
        const next = { ...get().lastDevices };
        delete next[kind];
        set({ lastDevices: next });
      },
      reset: () => set({ ...SETTINGS_DEFAULTS, lastDevices: {} }),
    }),
    {
      name: STORAGE_KEYS.settings,
      storage: appStorage,
      version: 1,
      partialize: ({ set: _s, reset: _r, rememberDevice: _a, forgetDevice: _f, ...rest }) => rest,
      merge: (persisted, current) => ({ ...current, ...sanitizeSettings(persisted) }),
    },
  ),
);

/** 실제로 쓸 AI 방식 (설정 'gemini' + 키 있음 → 'gemini', 그 밖 'offline') */
export function useEffectiveAiMode(): AiMode {
  return useSettings((s) => effectiveAiMode(s.aiMode, s.geminiKeyHint));
}

/** 키 저장 + 힌트(마지막 4자리) 갱신. 앞뒤 공백 제거 */
export async function saveGeminiKey(key: string): Promise<void> {
  const k = key.trim();
  if (!k) return deleteGeminiKey();
  await setGeminiKey(k);
  useSettings.getState().set({ geminiKeyHint: keyHint(k) });
}

/** 키 삭제 + 힌트 지움 (AI 방식은 그대로 — 키가 없으면 자동으로 오프라인) */
export async function deleteGeminiKey(): Promise<void> {
  await clearGeminiKey();
  useSettings.getState().set({ geminiKeyHint: null });
}

/** 앱 시작 시: 저장소의 실제 키와 힌트를 맞춤 (다른 탭·저장소 정리로 어긋났을 때) */
export async function syncGeminiKeyHint(): Promise<void> {
  const k = await getGeminiKey();
  const hint = keyHint(k);
  if (useSettings.getState().geminiKeyHint !== hint) useSettings.getState().set({ geminiKeyHint: hint });
}
