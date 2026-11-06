/**
 * 앱 데이터 영구 저장소 (WEBAPP_DESIGN §2 — zustand persist + localStorage)
 * v3.0 키는 모두 'sb3.' 로 시작해 v2.1 앱(‘sb.’)과 겹치지 않음
 */
import { persistStorage } from '@/platform/storage';

export const appStorage = persistStorage;

export const STORAGE_KEYS = {
  slots: 'sb3.slots',
  settings: 'sb3.settings',
  history: 'sb3.history',
  draft: 'sb3.draft',
  /** 데모(가상) 기기의 유량표 — 새로고침 후에도 유지 */
  demoDevice: 'sb3.demoDevice',
} as const;
