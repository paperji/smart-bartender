import type { ReactNode } from 'react';

import { cx } from '@/ui';

export interface ProgressRingProps {
  /** 0~100 */
  pct: number;
  /** 값을 아직 모름 — 짧은 호가 돌아감 (prefers-reduced-motion 이면 멈춤) */
  indeterminate?: boolean;
  /** 지름 px (CSS 변수 --ring-size 로도 바꿀 수 있음) */
  size?: number;
  /** 화면 읽기 이름 */
  ariaLabel: string;
  /** 화면 읽기 값 설명 (예: "62%, 남은 시간 약 12초") */
  valueText?: string;
  /** 가운데 내용 */
  children?: ReactNode;
  className?: string;
}

const R = 52;
const C = 2 * Math.PI * R;

/** 전체 진행 원 (색은 부모의 --brew-tone, 바탕 원은 --border) */
export function ProgressRing({ pct, indeterminate, size, ariaLabel, valueText, children, className }: ProgressRingProps) {
  const v = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const offset = indeterminate ? C * 0.75 : C * (1 - v / 100);
  return (
    <div
      className={cx('brew-ring', indeterminate && 'is-indeterminate', className)}
      style={size ? { width: size, height: size } : undefined}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(v)}
      aria-valuetext={valueText}>
      <svg className="brew-ring__svg" viewBox="0 0 120 120" aria-hidden="true">
        <circle className="brew-ring__track" cx="60" cy="60" r={R} />
        <circle
          className="brew-ring__fill"
          cx="60"
          cy="60"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={offset}
          style={v <= 0 && !indeterminate ? { opacity: 0 } : undefined}
        />
      </svg>
      <div className="brew-ring__center">{children}</div>
    </div>
  );
}
