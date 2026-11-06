import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cx, type Tone } from './cx';

export interface BadgeProps {
  label: ReactNode;
  /** neutral(회색, 기본) · accent(당근) · success · warning · danger · info(파랑 — AI 배지) */
  tone?: Tone;
  icon?: LucideIcon;
  /** 채운 배경 (기본: 연한 배경 + 진한 글자) */
  solid?: boolean;
  className?: string;
}

/** 작은 상태 표시 (높이 24px) */
export function Badge({ label, tone = 'neutral', icon: Icon, solid, className }: BadgeProps) {
  return (
    <span className={cx('sb-badge', `sb-badge--${tone}`, solid && 'sb-badge--solid', className)}>
      {Icon ? <Icon size={13} aria-hidden="true" /> : null}
      {label}
    </span>
  );
}
