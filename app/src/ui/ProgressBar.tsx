import type { ReactNode } from 'react';

import { cx, type Tone } from './cx';

export interface ProgressBarProps {
  /** 0~1 (indeterminate 면 무시) */
  value?: number;
  /** 색 (기본 accent) */
  tone?: Tone;
  /** 위 왼쪽 글자 */
  label?: ReactNode;
  /** 위 오른쪽에 % 표시 */
  showValue?: boolean;
  /** 값을 모를 때 흐르는 막대 */
  indeterminate?: boolean;
  /** 막대 두께 (기본 8px) */
  height?: number;
  /** 화면 읽기 이름 (label 이 없을 때) */
  ariaLabel?: string;
  className?: string;
}

/** 진행 막대 (role=progressbar) */
export function ProgressBar({ value = 0, tone = 'accent', label, showValue, indeterminate, height = 8, ariaLabel, className }: ProgressBarProps) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const pct = Math.round(v * 100);
  return (
    <div className={cx('sb-progress', `sb-progress--${tone}`, indeterminate && 'is-indeterminate', className)}>
      {label || showValue ? (
        <div className="sb-progress__head">
          <span className="sb-progress__label">{label}</span>
          {showValue && !indeterminate ? <span className="sb-progress__value sb-num">{pct}%</span> : null}
        </div>
      ) : null}
      <div
        className="sb-progress__track"
        style={{ height }}
        role="progressbar"
        aria-label={typeof label === 'string' ? label : ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : pct}>
        <div className="sb-progress__fill" style={indeterminate ? undefined : { width: `${pct}%` }} />
      </div>
    </div>
  );
}
