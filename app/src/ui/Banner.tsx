import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './Button';
import { cx } from './cx';

export type BannerTone = 'info' | 'success' | 'warning' | 'error';

export interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  /** 본문 (children 대신 써도 됨) */
  message?: ReactNode;
  children?: ReactNode;
  /** 아이콘 바꾸기 (기본: tone 별 아이콘) */
  icon?: LucideIcon;
  /** 아래 버튼 하나 — { label, onClick } 또는 직접 만든 요소 */
  action?: { label: string; onClick: () => void; icon?: LucideIcon } | ReactNode;
  /** 있으면 오른쪽 위 닫기(X) 버튼 */
  onClose?: () => void;
  className?: string;
}

const ICONS: Record<BannerTone, LucideIcon> = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

function isActionObj(a: BannerProps['action']): a is { label: string; onClick: () => void; icon?: LucideIcon } {
  return !!a && typeof a === 'object' && 'label' in (a as object) && 'onClick' in (a as object);
}

/** 화면 안 안내 상자 (info 파랑 · success 초록 · warning 노랑 · error 빨강) */
export function Banner({ tone = 'info', title, message, children, icon, action, onClose, className }: BannerProps) {
  const Icon = icon ?? ICONS[tone];
  return (
    <div className={cx('sb-banner', `sb-banner--${tone}`, className)} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden="true" className="sb-banner__icon" />
      <div className="sb-banner__body">
        {title ? <p className="sb-banner__title">{title}</p> : null}
        {message ?? children ? <div className="sb-banner__msg">{message ?? children}</div> : null}
        {action ? (
          <div className="sb-banner__action">
            {isActionObj(action) ? <Button size="sm" variant="secondary" label={action.label} icon={action.icon} onClick={action.onClick} /> : action}
          </div>
        ) : null}
      </div>
      {onClose ? (
        <button type="button" className="sb-banner__close" aria-label="닫기" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
