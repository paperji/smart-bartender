import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cx } from './cx';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  message?: ReactNode;
  /** 아래 버튼 등 */
  action?: ReactNode;
  className?: string;
}

/** 빈 목록 안내 (가운데 정렬, 연한 원 안 아이콘) */
export function EmptyState({ icon: Icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div className={cx('sb-empty', className)}>
      {Icon ? (
        <div className="sb-empty__icon" aria-hidden="true">
          <Icon size={28} />
        </div>
      ) : null}
      <p className="sb-empty__title">{title}</p>
      {message ? <p className="sb-empty__msg">{message}</p> : null}
      {action ? <div className="sb-empty__action">{action}</div> : null}
    </div>
  );
}
