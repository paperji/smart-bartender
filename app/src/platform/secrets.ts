/**
 * Gemini API 키 저장 (WEBAPP_DESIGN §4 — 사용자 본인 키, BYOK)
 *  - 브라우저·PWA·Electron: localStorage 'sb.secret.geminiKey'
 *  - 안드로이드 APK: @capacitor/preferences — 앱 시작 때 capacitor/backends.ts 가 registerSecretBackend 로 끼움(예전 localStorage 키는 옮김)
 * 키는 기기 밖(Google 제외)으로 보내지 않고, 로그·토스트에 값을 남기지 않습니다.
 * 키 저장/삭제 + 설정의 마지막 4자리 힌트 갱신은 store/settings.ts 의 saveGeminiKey/deleteGeminiKey 를 쓰세요.
 */
import { isCapacitor, isElectron } from './detect';
import { kv } from './storage';

export const GEMINI_KEY_STORAGE = 'sb.secret.geminiKey';

/** 키 저장소 구현 (비동기 — Capacitor Preferences 와 같은 모양) */
export interface SecretBackend {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

const localBackend: SecretBackend = {
  async get(name) {
    return kv.getItem(name);
  },
  async set(name, value) {
    kv.setItem(name, value);
  },
  async remove(name) {
    kv.removeItem(name);
  },
};

let backend: SecretBackend = localBackend;

/** 키 저장소 교체 — APK 는 capacitor/backends.ts 의 capacitorSecretBackend(Preferences, 예전 localStorage 키 옮김), 테스트는 대역. null 이면 localStorage */
export function registerSecretBackend(b: SecretBackend | null): void {
  backend = b ?? localBackend;
}

type Listener = (hasKey: boolean) => void;
const listeners = new Set<Listener>();

/**
 * 키 저장·삭제 알림 (설정 화면 갱신용). 해제 함수 반환
 * 브라우저·PWA·Electron(localStorage 저장)에서는 다른 창(탭)에서 키를 저장·삭제해도 알림 (window 'storage' 이벤트)
 * — 받는 쪽은 store/settings.ts syncGeminiKeyHint() 로 '저장됨 ••••xxxx' 힌트를 맞추면 됨
 */
export function onGeminiKeyChange(cb: Listener): () => void {
  listeners.add(cb);
  watchOtherWindows();
  return () => {
    listeners.delete(cb);
  };
}

let watching = false;

/** 다른 창의 localStorage 변경(키 저장·삭제·전체 지우기) → 알림. 처음 구독할 때 1번만 등록 */
function watchOtherWindows(): void {
  if (watching || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  watching = true;
  window.addEventListener('storage', (e: StorageEvent) => {
    // APK(Capacitor Preferences) 등 다른 저장소를 쓰면 localStorage 변경과 무관
    if (backend !== localBackend) return;
    // e.key === null: 다른 창에서 localStorage.clear()
    if (e.key !== GEMINI_KEY_STORAGE && e.key !== null) return;
    emit(e.key === null ? false : !!(e.newValue && e.newValue.trim()));
  });
}

function emit(hasKey: boolean) {
  for (const l of Array.from(listeners)) {
    try {
      l(hasKey);
    } catch {
      /* ignore */
    }
  }
}

export async function getGeminiKey(): Promise<string | null> {
  try {
    const v = await backend.get(GEMINI_KEY_STORAGE);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export async function setGeminiKey(value: string | null | undefined): Promise<void> {
  const v = (value ?? '').trim();
  if (!v) {
    await clearGeminiKey();
    return;
  }
  await backend.set(GEMINI_KEY_STORAGE, v);
  emit(true);
}

export async function clearGeminiKey(): Promise<void> {
  try {
    await backend.remove(GEMINI_KEY_STORAGE);
  } finally {
    emit(false);
  }
}

/** 키가 어디에 저장되는지 안내 (설정 화면) */
export function secretStorageLabel(): string {
  if (isCapacitor()) return '이 휴대폰 앱 안의 저장소에만 저장돼요. 다른 곳으로 보내지 않아요(Google 제외).';
  if (isElectron()) return '이 PC 의 앱 저장소에만 저장돼요. 공용 PC 에서는 사용 뒤 꼭 삭제해 주세요.';
  return '이 브라우저 저장소에만 저장돼요. 공용 컴퓨터에서는 입력하지 마세요.';
}
