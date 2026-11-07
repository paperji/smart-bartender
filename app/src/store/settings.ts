/**
 * 앱 설정 — AI 방식·회사·모델, 데모 모드, 성인 인증, 배출 모드, 마지막 연결 기기, 알림 권한 요청 여부, 첫 실행 안내 등
 * (AI API 키 자체는 여기 저장하지 않고 platform/secrets 에 회사별로 따로 보관 — 여기에는 마지막 4자리 힌트만)
 * v3.0: 서버 모드·서버 주소 제거, aiMode (기본 AI, 키가 없으면 실제로는 오프라인) | 'offline' (WEBAPP_DESIGN §4)
 * v3.1: AI 회사 고르기(aiProvider) · 회사별 모델(aiModels)·키 힌트(aiKeyHints). 예전 저장값(aiMode 'gemini'·geminiModel·
 *       geminiKeyHint)은 불러올 때 aiMode 'ai'·aiModels.gemini·aiKeyHints.gemini 로 옮김
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { keyHint } from '@/lib/ai/gemini';
import { effectiveAiMode } from '@/lib/ai/mode';
import { AI_PROVIDERS, DEFAULT_PROVIDER, isProviderId, providerOf, type AiProviderId } from '@/lib/ai/providers';
import type { TransportKind } from '@/lib/transport/types';
import type { AiMode, DispenseMode } from '@/lib/types';
import { clearAiKey, getAiKey, setAiKey } from '@/platform/secrets';

import { appStorage, STORAGE_KEYS } from './storage';

export interface RememberedDevice {
  id: string;
  name: string | null;
  at: number;
}

export interface SettingsData {
  /** 설정한 AI 방식 — 'ai' 여도 고른 회사의 키가 없으면 실제로는 오프라인 (useEffectiveAiMode) */
  aiMode: AiMode;
  /** 레시피를 만들 AI 회사 (v3.1) */
  aiProvider: AiProviderId;
  /** 회사별로 고른 모델 (없으면 그 회사 기본 모델) */
  aiModels: Partial<Record<AiProviderId, string>>;
  /** 회사별 저장된 키의 마지막 4자리 — 화면 표시·"키 있음" 판단용 */
  aiKeyHints: Partial<Record<AiProviderId, string>>;
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

/** v3.0 의 기본 Gemini 모델 (옮길 때 비교용) */
const V30_DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

export const SETTINGS_DEFAULTS: SettingsData = {
  aiMode: 'ai',
  aiProvider: DEFAULT_PROVIDER,
  aiModels: {},
  aiKeyHints: {},
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
  // 회사별 모델·키 힌트 (모르는 회사·빈 값은 버림). v3.0 의 geminiModel·geminiKeyHint 는 Gemini 칸으로
  const aiModels: SettingsData['aiModels'] = {};
  const aiKeyHints: SettingsData['aiKeyHints'] = {};
  if (isObj(p.aiModels)) {
    for (const [id, m] of Object.entries(p.aiModels)) if (isProviderId(id) && typeof m === 'string' && m.trim()) aiModels[id] = m.trim();
  }
  if (isObj(p.aiKeyHints)) {
    for (const [id, h] of Object.entries(p.aiKeyHints)) if (isProviderId(id) && typeof h === 'string' && h) aiKeyHints[id] = h;
  }
  // v3.0 은 기본값('gemini-3.6-flash')도 늘 저장했으므로, 기본값이면 옮기지 않음 (나중에 기본 모델을 바꾸면 따라가게)
  if (!aiModels.gemini && typeof p.geminiModel === 'string' && p.geminiModel.trim() && p.geminiModel.trim() !== V30_DEFAULT_GEMINI_MODEL) {
    aiModels.gemini = p.geminiModel.trim();
  }
  if (!aiKeyHints.gemini && typeof p.geminiKeyHint === 'string' && p.geminiKeyHint) aiKeyHints.gemini = p.geminiKeyHint;
  return {
    aiMode: p.aiMode === 'ai' || p.aiMode === 'gemini' ? 'ai' : p.aiMode === 'offline' ? 'offline' : d.aiMode,
    aiProvider: isProviderId(p.aiProvider) ? p.aiProvider : d.aiProvider,
    aiModels,
    aiKeyHints,
    demoMode: bool(p.demoMode, d.demoMode),
    autoReconnect: bool(p.autoReconnect, d.autoReconnect),
    dispenseMode: p.dispenseMode === 'seq' || p.dispenseMode === 'par' ? p.dispenseMode : 'seq',
    adultVerifiedAt: typeof p.adultVerifiedAt === 'number' && Number.isFinite(p.adultVerifiedAt) ? p.adultVerifiedAt : null,
    lastDevices,
    notifyAsked: bool(p.notifyAsked, d.notifyAsked),
    onboardingDismissed: bool(p.onboardingDismissed, d.onboardingDismissed),
  };
}

/**
 * 저장값 + 지금 값 합치기. 다른 탭이 쓴 저장값을 다시 읽을 때(App 의 storage 이벤트), 예전 버전(v3.0) 탭이 쓴 값에는
 * v3.1 칸(aiProvider·aiModels·aiKeyHints)이 없으므로 그 칸은 지금 값을 지킴 (기본값으로 덮어 고른 AI 가 바뀌지 않게)
 */
export function mergeSettings<T extends SettingsData>(persisted: unknown, current: T): T {
  const p = isObj(persisted) ? persisted : {};
  const s = sanitizeSettings(p);
  const hasNew = 'aiProvider' in p || 'aiModels' in p || 'aiKeyHints' in p;
  if (hasNew || !isObj(persisted)) return { ...current, ...s };
  return {
    ...current,
    ...s,
    aiProvider: current.aiProvider,
    aiModels: { ...current.aiModels, ...s.aiModels },
    aiKeyHints: { ...current.aiKeyHints, ...s.aiKeyHints },
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
      reset: () => set({ ...SETTINGS_DEFAULTS, aiModels: {}, aiKeyHints: {}, lastDevices: {} }),
    }),
    {
      name: STORAGE_KEYS.settings,
      storage: appStorage,
      // 버전은 1 그대로 — 올리면 migrate 가 없을 때 zustand 가 예전 저장값을 통째로 버림(업데이트하면 설정이 지워짐).
      // v3.0 → v3.1 옮기기는 merge 의 sanitizeSettings 가 함
      version: 1,
      partialize: ({ set: _s, reset: _r, rememberDevice: _a, forgetDevice: _f, ...rest }) => rest,
      merge: (persisted, current) => mergeSettings(persisted, current),
    },
  ),
);

/** 고른 회사의 키 힌트 (없으면 null) */
export function activeKeyHint(s: Pick<SettingsData, 'aiProvider' | 'aiKeyHints'>): string | null {
  return s.aiKeyHints[s.aiProvider] ?? null;
}

/** 고른 회사의 모델 (고른 적 없으면 그 회사 기본 모델) */
export function activeModel(s: Pick<SettingsData, 'aiProvider' | 'aiModels'>, provider: AiProviderId = s.aiProvider): string {
  return s.aiModels[provider] || providerOf(provider).defaultModel;
}

/** 실제로 쓸 AI 방식 (설정 'ai' + 고른 회사의 키 있음 → 'ai', 그 밖 'offline') */
export function useEffectiveAiMode(): AiMode {
  return useSettings((s) => effectiveAiMode(s.aiMode, activeKeyHint(s)));
}

/** 회사 키 저장 + 힌트(마지막 4자리) 갱신. 앞뒤 공백 제거 */
export async function saveAiKey(provider: AiProviderId, key: string): Promise<void> {
  const k = key.trim();
  if (!k) return deleteAiKey(provider);
  await setAiKey(provider, k);
  const st = useSettings.getState();
  st.set({ aiKeyHints: { ...st.aiKeyHints, [provider]: keyHint(k) ?? undefined } });
}

/** 회사 키 삭제 + 힌트 지움 (AI 방식은 그대로 — 키가 없으면 자동으로 오프라인) */
export async function deleteAiKey(provider: AiProviderId): Promise<void> {
  await clearAiKey(provider);
  const next = { ...useSettings.getState().aiKeyHints };
  delete next[provider];
  useSettings.getState().set({ aiKeyHints: next });
}

/** 모든 회사 키 삭제 (설정 초기화) */
export async function deleteAllAiKeys(): Promise<void> {
  for (const p of AI_PROVIDERS) await clearAiKey(p.id).catch(() => undefined);
  useSettings.getState().set({ aiKeyHints: {} });
}

/** 앱 시작 시·다른 창에서 바꿨을 때: 저장소의 실제 키와 힌트를 맞춤 (provider 를 주면 그 회사만) */
export async function syncAiKeyHints(provider?: AiProviderId | null): Promise<void> {
  const ids = provider ? [provider] : AI_PROVIDERS.map((p) => p.id);
  const found: Partial<Record<AiProviderId, string | null>> = {};
  for (const id of ids) found[id] = keyHint(await getAiKey(id));
  const cur = useSettings.getState().aiKeyHints;
  const next = { ...cur };
  let changed = false;
  for (const id of ids) {
    const h = found[id];
    if ((cur[id] ?? null) === (h ?? null)) continue;
    changed = true;
    if (h) next[id] = h;
    else delete next[id];
  }
  if (changed) useSettings.getState().set({ aiKeyHints: next });
}

/** v3.0 호환 이름 */
export const saveGeminiKey = (key: string): Promise<void> => saveAiKey('gemini', key);
export const deleteGeminiKey = (): Promise<void> => deleteAiKey('gemini');
export const syncGeminiKeyHint = (): Promise<void> => syncAiKeyHints('gemini');
