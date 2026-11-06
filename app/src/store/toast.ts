import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

interface ToastState {
  message: string | null;
  kind: ToastKind;
  key: number;
  show: (message: string, kind?: ToastKind) => void;
  hide: () => void;
}

export const useToast = create<ToastState>()((set, get) => ({
  message: null,
  kind: 'info',
  key: 0,
  show: (message, kind = 'info') => set({ message, kind, key: get().key + 1 }),
  hide: () => set({ message: null }),
}));

export const toast = (message: string, kind: ToastKind = 'info') => useToast.getState().show(message, kind);
