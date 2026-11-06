import type { ReactNode } from 'react';

import { cx } from '@/ui';

import { edgeColor } from './color';

export interface ColorProgressProps {
  /** 0~1 */
  value: number;
  /** 채움 색 (재료 색 #RRGGBB 또는 CSS 색·var(--green) 등). 아주 옅은 재료 색은 자동으로 조금 진하게 */
  color: string;
  /** 막대 두께 (기본 8px) */
  height?: number;
  /** 화면 읽기 이름 (예: '콜라 남은 양') */
  ariaLabel?: string;
  /** 위쪽 글자 줄 (왼쪽 label, 오른쪽 valueText) */
  label?: ReactNode;
  valueText?: ReactNode;
  className?: string;
}

/**
 * 재료 색 진행 막대 — UI 키트 ProgressBar 는 tone(당근·초록…)만 받아서, 재료 색이 필요한 곳(펌프 잔량·제조 중 펌프별 진행)에 씀.
 * v2.1 `<ProgressBar value color height />` 자리.
 */
export function ColorProgress({ value, color, height = 8, ariaLabel, label, valueText, className }: ColorProgressProps) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const pct = Math.round(v * 100);
  return (
    <div className={cx('dc-progress', className)}>
      {label || valueText ? (
        <div className="dc-progress__head">
          <span>{label}</span>
          {valueText ? <span className="sb-num">{valueText}</span> : null}
        </div>
      ) : null}
      <div
        className="dc-progress__track"
        style={{ height }}
        role="progressbar"
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}>
        <div className="dc-progress__fill" style={{ width: `${pct}%`, background: edgeColor(color) }} />
      </div>
    </div>
  );
}
