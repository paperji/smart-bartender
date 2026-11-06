/**
 * Gemini API 키 보안 저장 (안드로이드 Keystore / iOS Keychain — expo-secure-store)
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'sb_gemini_api_key';

export async function getGeminiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function setGeminiKey(value: string | null): Promise<void> {
  if (!value) {
    await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
    return;
  }
  await SecureStore.setItemAsync(KEY, value.trim());
}

export const secretStorageLabel = '휴대폰 보안 저장소(Keystore)에 암호화되어 저장됩니다.';
