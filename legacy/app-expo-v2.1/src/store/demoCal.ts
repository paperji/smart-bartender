/**
 * 데모(가상) 기기의 유량표(cal/calSet) 보관 — 실제 기기의 NVS(플래시) 저장을 흉내냄
 * (안드로이드: AsyncStorage, 웹: localStorage) → 앱을 다시 켜거나 새로고침해도 유지
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DemoCalRecord } from '@/lib/transport/demo';

import { STORAGE_KEYS } from './storage';

type Saved = Record<string, DemoCalRecord>;

function valid(r: any): r is DemoCalRecord {
  return r && Array.isArray(r.cal) && Array.isArray(r.calSet) && r.cal.every((v: unknown) => typeof v === 'number');
}

export async function loadDemoCal(): Promise<Saved> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.demoDevice);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    const out: Saved = {};
    if (obj && typeof obj === 'object') {
      for (const [id, rec] of Object.entries(obj)) if (valid(rec)) out[id] = { cal: rec.cal, calSet: rec.calSet };
    }
    return out;
  } catch {
    return {};
  }
}

let chain: Promise<void> = Promise.resolve();

export function saveDemoCal(deviceId: string, rec: DemoCalRecord): Promise<void> {
  // 저장 순서가 꼬이지 않게 직렬화
  chain = chain
    .then(async () => {
      const cur = await loadDemoCal();
      cur[deviceId] = { cal: rec.cal.slice(), calSet: rec.calSet.slice() };
      await AsyncStorage.setItem(STORAGE_KEYS.demoDevice, JSON.stringify(cur));
    })
    .catch(() => undefined);
  return chain;
}

export async function clearDemoCal(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEYS.demoDevice);
  } catch {
    /* ignore */
  }
}
