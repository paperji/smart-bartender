import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useToast, type ToastKind } from '@/store/toast';

import { cx } from './cx';

const ICON: Record<ToastKind, LucideIcon> = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

/** 토스트 표시 시간 (긴 문구는 조금 더) */
function durationFor(message: string) {
  return Math.min(7000, 2800 + Math.max(0, message.length - 30) * 40);
}

/** 화면 아래 토스트 (store/toast 의 toast(message, kind)) — App 루트에 1개. 누르면 닫힘 */
export function ToastHost() {
  const { message, kind, key, hide } = useToast();
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!message) return;
    setLeaving(false);
    const t1 = setTimeout(() => setLeaving(true), durationFor(message));
    const t2 = setTimeout(() => hide(), durationFor(message) + 220);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [key, message, hide]);
  const Icon = ICON[kind];
  return (
    <div className="sb-toast-region" aria-live="polite" aria-atomic="true">
      {message ? (
        <button
          key={key}
          type="button"
          className={cx('sb-toast', `sb-toast--${kind}`, leaving && 'is-leaving')}
          role={kind === 'error' || kind === 'warning' ? 'alert' : 'status'}
          onClick={hide}>
          <Icon size={20} aria-hidden="true" className="sb-toast__icon" />
          <span className="sb-toast__msg">{message}</span>
        </button>
      ) : null}
    </div>
  );
}
