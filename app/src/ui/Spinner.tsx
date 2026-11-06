import { cx } from './cx';

export interface SpinnerProps {
  /** 지름(px) — 기본 20 */
  size?: number;
  /** 화면 읽기 프로그램용 설명 (기본 '불러오는 중') */
  label?: string;
  /** 색 (기본 currentColor) */
  color?: string;
  className?: string;
}

/** 돌아가는 원 (prefers-reduced-motion 이면 천천히 깜빡임으로 대신) */
export function Spinner({ size = 20, label = '불러오는 중', color, className }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className={cx('sb-spinner', className)} style={{ width: size, height: size, color }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}
