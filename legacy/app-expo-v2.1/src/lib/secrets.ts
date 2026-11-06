/**
 * Gemini API 키 저장 — 웹 버전용 (브라우저 localStorage)
 * 웹에는 보안 저장소가 없으므로 공용 PC 에서는 키를 입력하지 마세요.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'sb_gemini_api_key';

export async function getGeminiKey(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function setGeminiKey(value: string | null): Promise<void> {
  if (!value) {
    await AsyncStorage.removeItem(KEY);
    return;
  }
  await AsyncStorage.setItem(KEY, value.trim());
}

export const secretStorageLabel = '웹 브라우저 저장소에 저장됩니다. 공용 컴퓨터에서는 입력하지 마세요.';
