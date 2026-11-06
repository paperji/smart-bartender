/**
 * 펌프 슬롯(장착 재료) 상태 — 앱 재시작 후에도 유지
 * 저장값은 불러올 때 모양을 확인함(sanitizeSlots) — 깨진 저장값이면 기본 재료로 (화면이 하얗게 멈추지 않게)
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { defaultSlots, emptySlot } from '@/lib/presets';
import { CATEGORIES, type Category, type PumpSlot } from '@/lib/types';

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

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 저장돼 있던 슬롯 하나 → 온전한 PumpSlot (펌프 번호가 없으면 null). 빠진 칸은 빈 슬롯 값으로 */
function sanitizeSlot(raw: unknown): PumpSlot | null {
  if (!isObj(raw) || !finite(raw.pump) || !Number.isInteger(raw.pump) || raw.pump < 1 || raw.pump > MAX_PUMPS) return null;
  const base = emptySlot(raw.pump);
  const capacityMl = finite(raw.capacityMl) && raw.capacityMl > 0 ? raw.capacityMl : base.capacityMl;
  const slot: PumpSlot = {
    pump: raw.pump,
    name: typeof raw.name === 'string' ? raw.name : '',
    category: CATEGORIES.includes(raw.category as Category) ? (raw.category as Category) : base.category,
    abv: finite(raw.abv) ? Math.max(0, Math.min(100, raw.abv)) : 0,
    capacityMl,
    remainingMl: finite(raw.remainingMl) ? Math.max(0, Math.min(capacityMl, raw.remainingMl)) : 0,
    color: typeof raw.color === 'string' && raw.color ? raw.color : base.color,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    updatedAt: finite(raw.updatedAt) ? raw.updatedAt : 0,
  };
  if (raw.needsCal === true) slot.needsCal = true;
  return slot;
}

/**
 * 저장돼 있던 슬롯 목록 → 펌프 1번부터 빈틈없는 목록 (같은 번호는 앞의 것, 빠진 번호는 빈 슬롯).
 * 배열이 아니거나 쓸 수 있는 슬롯이 없으면 null (→ 기본 재료)
 */
export function sanitizeSlots(raw: unknown): PumpSlot[] | null {
  if (!Array.isArray(raw)) return null;
  const byPump = new Map<number, PumpSlot>();
  for (const r of raw) {
    const s = sanitizeSlot(r);
    if (s && !byPump.has(s.pump)) byPump.set(s.pump, s);
  }
  if (!byPump.size) return null;
  const count = Math.max(...byPump.keys());
  const out: PumpSlot[] = [];
  for (let p = 1; p <= count; p++) out.push(byPump.get(p) ?? emptySlot(p));
  return out;
}

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
    {
      name: STORAGE_KEYS.slots,
      storage: appStorage,
      version: 1,
      partialize: (s) => ({ slots: s.slots }),
      // 저장값 모양 확인 (배열이 아니거나 칸이 빠졌으면 홈·재료·탭 배지가 깨짐)
      merge: (persisted, current) => ({ ...current, slots: sanitizeSlots(isObj(persisted) ? persisted.slots : undefined) ?? current.slots }),
    },
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
