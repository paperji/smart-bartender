/**
 * 확인창·안내창 서비스 (React Native Alert / window.confirm 대신 — WEBAPP_DESIGN §5)
 *  - confirm(title, message, opts) → Promise<boolean>  (취소·바깥 누름·Esc = false)
 *  - alert(title, message, opts)   → Promise<void>     (확인 누르면 끝남)
 *  - 화면에는 ui/dialog/DialogHost 가 그림 (App 루트에 1개). 여러 개가 동시에 오면 차례로 보여 줌
 * 순수 TS(React 비의존) — lib/brew.ts·lib/flow.ts 같은 화면 밖 로직에서도 사용
 */
import { create } from 'zustand';

export type DialogTone = 'default' | 'danger' | 'warning' | 'info' | 'success';

export interface DialogOptions {
  /** 확인 버튼 글자 (기본 '확인') */
  confirmText?: string;
  /** 취소 버튼 글자 (기본 '취소', confirm 만) */
  cancelText?: string;
  /** 되돌릴 수 없는 동작 — 확인 버튼을 빨간색으로 */
  destructive?: boolean;
  /** 머리 아이콘 색 */
  tone?: DialogTone;
}

export interface DialogRequest {
  id: number;
  kind: 'confirm' | 'alert';
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  destructive: boolean;
  tone: DialogTone;
  resolve: (ok: boolean) => void;
}

interface DialogState {
  queue: DialogRequest[];
}

export const useDialogs = create<DialogState>()(() => ({ queue: [] }));

let seq = 0;

function push(kind: DialogRequest['kind'], title: string, message: string, opts: DialogOptions = {}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req: DialogRequest = {
      id: ++seq,
      kind,
      title,
      message,
      confirmText: opts.confirmText ?? '확인',
      cancelText: opts.cancelText ?? '취소',
      destructive: !!opts.destructive,
      tone: opts.tone ?? (opts.destructive ? 'danger' : 'default'),
      resolve,
    };
    useDialogs.setState({ queue: [...useDialogs.getState().queue, req] });
  });
}

/** 확인창 — 확인이면 true */
export function confirm(title: string, message: string, opts?: DialogOptions): Promise<boolean> {
  return push('confirm', title, message, opts);
}

/** 안내창 — 확인을 누르면 끝남 */
export async function alert(title: string, message: string, opts?: DialogOptions): Promise<void> {
  await push('alert', title, message, opts);
}

/** DialogHost 가 답할 때 호출 */
export function resolveDialog(id: number, ok: boolean): void {
  const q = useDialogs.getState().queue;
  const req = q.find((d) => d.id === id);
  if (!req) return;
  useDialogs.setState({ queue: q.filter((d) => d.id !== id) });
  req.resolve(req.kind === 'alert' ? true : ok);
}

/** v2.1 이름 그대로 (lib/ui.ts confirmAsync) */
export const confirmAsync = confirm;

/** v2.1 이름 그대로 (lib/ui.ts alertMessage) — 기다리지 않는 안내창 */
export function alertMessage(title: string, message: string): void {
  void alert(title, message);
}
