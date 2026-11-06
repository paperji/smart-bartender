import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { haptic } from '@/platform/haptics';

import { cx } from './cx';

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 왼쪽 아이콘 (또는 leading 으로 직접 요소) */
  icon?: LucideIcon;
  leading?: ReactNode;
  /** 오른쪽 끝 (값·배지·스위치 등) */
  trailing?: ReactNode;
  /** 있으면 행 전체가 버튼 */
  onClick?: () => void;
  /** 오른쪽 > 표시 (onClick 이 있으면 기본 true) */
  chevron?: boolean;
  /** 빨간 글자 (삭제·초기화) */
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}

/** 목록 한 줄 (최소 높이 56px). 카드 안에 여러 개 넣으면 사이에 구분선 */
export function ListRow({ title, subtitle, icon: Icon, leading, trailing, onClick, chevron, danger, disabled, className }: ListRowProps) {
  const showChevron = chevron ?? !!onClick;
  const inner = (
    <>
      {leading ?? (Icon ? <Icon size={20} aria-hidden="true" className="sb-row__icon" /> : null)}
      <span className="sb-row__text">
        <span className="sb-row__title">{title}</span>
        {subtitle ? <span className="sb-row__sub">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="sb-row__trailing">{trailing}</span> : null}
      {showChevron ? <ChevronRight size={18} aria-hidden="true" className="sb-row__chevron" /> : null}
    </>
  );
  const cls = cx('sb-row', danger && 'sb-row--danger', onClick && 'sb-row--button', disabled && 'is-disabled', className);
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        disabled={disabled}
        onClick={() => {
          haptic.tap();
          onClick();
        }}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}
