import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

/** 앱 데이터 영구 저장소 (안드로이드: AsyncStorage, 웹: localStorage) */
export const appStorage = createJSONStorage(() => AsyncStorage);

export const STORAGE_KEYS = {
  slots: 'sb.slots.v2',
  settings: 'sb.settings.v2',
  history: 'sb.history.v2',
  draft: 'sb.draft.v2',
  /** 데모(가상) 기기의 유량표 — 새로고침 후에도 유지 */
  demoDevice: 'sb.demoDevice.v1',
} as const;
