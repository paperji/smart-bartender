/**
 * 펌프 슬롯(장착 재료) 상태 — 앱 재시작 후에도 유지
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { defaultSlots, emptySlot } from '@/lib/presets';
import type { PumpSlot } from '@/lib/types';

import { appStorage, STORAGE_KEYS } from './storage';

export const MAX_PUMPS = 8;

interface SlotsState {
  slots: PumpSlot[];
  updateSlot: (pump: number, patch: Partial<PumpSlot>) => void;
  clearSlot: (pump: number) => void;
  fillSlot: (pump: number) => void;
  /** 제조 후 잔량 차감 */
  deduct: (dispensed: { p: number; ml: number }[]) => void;
  /** 기기가 알려준 펌프 수에 맞게 슬롯 개수 조정 */
  ensurePumpCount: (n: number) => void;
  markCalibrated: (pump: number) => void;
  reset: () => void;
}

const MATERIAL_KEYS: (keyof PumpSlot)[] = ['name', 'category'];

export const useSlots = create<SlotsState>()(
  persist(
    (set, get) => ({
      slots: defaultSlots(4),
      updateSlot: (pump, patch) =>
        set({
          slots: get().slots.map((s) => {
            if (s.pump !== pump) return s;
            const changedMaterial = MATERIAL_KEYS.some((k) => k in patch && patch[k] !== s[k]) && !!s.name;
            const next: PumpSlot = { ...s, ...patch, pump, updatedAt: Date.now() };
            next.remainingMl = Math.max(0, Math.min(next.capacityMl, next.remainingMl));
            if (changedMaterial) next.needsCal = true;
            return next;
          }),
        }),
      clearSlot: (pump) =>
        set({ slots: get().slots.map((s) => (s.pump === pump ? { ...emptySlot(pump), color: s.color } : s)) }),
      fillSlot: (pump) =>
        set({
          slots: get().slots.map((s) => (s.pump === pump ? { ...s, remainingMl: s.capacityMl, updatedAt: Date.now() } : s)),
        }),
      deduct: (dispensed) =>
        set({
          slots: get().slots.map((s) => {
            const used = dispensed.filter((d) => d.p === s.pump).reduce((a, b) => a + (b.ml || 0), 0);
            if (!used) return s;
            return { ...s, remainingMl: Math.max(0, Math.round((s.remainingMl - used) * 10) / 10) };
          }),
        }),
      ensurePumpCount: (n) => {
        const count = Math.max(1, Math.min(MAX_PUMPS, Math.round(n)));
        const cur = get().slots;
        if (cur.length === count) return;
        if (cur.length > count) {
          // 데이터는 지우지 않고, 남는 슬롯이 비어 있을 때만 줄임
          const extra = cur.slice(count);
          if (extra.some((s) => s.name)) return;
          set({ slots: cur.slice(0, count) });
          return;
        }
        const add: PumpSlot[] = [];
        for (let p = cur.length + 1; p <= count; p++) add.push(emptySlot(p));
        set({ slots: [...cur, ...add] });
      },
      markCalibrated: (pump) =>
        set({ slots: get().slots.map((s) => (s.pump === pump ? { ...s, needsCal: false } : s)) }),
      reset: () => set({ slots: defaultSlots(4) }),
    }),
    { name: STORAGE_KEYS.slots, storage: appStorage, version: 1, partialize: (s) => ({ slots: s.slots }) },
  ),
);

export function installedSlots(slots: PumpSlot[]) {
  return slots.filter((s) => s.name.trim().length > 0);
}

/** 잔량 부족 기준: 50ml 미만 또는 용량의 15% 미만 */
export function isLowStock(s: PumpSlot) {
  if (!s.name) return false;
  return s.remainingMl < Math.max(50, s.capacityMl * 0.15);
}
