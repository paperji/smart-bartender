import { useId, type CSSProperties } from 'react';

import { cx } from './cx';

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  /** 기본 1 */
  step?: number;
  /** 위에 보이는 이름 (생략하면 ariaLabel 필요) */
  label?: string;
  ariaLabel?: string;
  /** 값 뒤 단위 (예: 'ml') */
  unit?: string;
  /** 값 표시 바꾸기 */
  format?: (v: number) => string;
  /** 아래 눈금 글자 (예: [{ value: 30, label: '30' }]) */
  marks?: { value: number; label: string }[];
  disabled?: boolean;
  className?: string;
}

/** 가로 슬라이더 (<input type="range"> — 키보드·화면 읽기 기본 지원) */
export function Slider({ value, onChange, min, max, step = 1, label, ariaLabel, unit, format, marks, disabled, className }: SliderProps) {
  const id = useId();
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const shown = format ? format(value) : `${value}${unit ?? ''}`;
  return (
    <div className={cx('sb-slider', disabled && 'is-disabled', className)}>
      {label ? (
        <div className="sb-slider__head">
          <label htmlFor={id} className="sb-slider__label">
            {label}
          </label>
          <span className="sb-slider__value sb-num">{shown}</span>
        </div>
      ) : null}
      <input
        id={id}
        type="range"
        className="sb-slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        aria-valuetext={shown}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {marks?.length ? (
        <div className="sb-slider__marks" aria-hidden="true">
          {marks.map((m) => (
            <span key={m.value} style={{ left: `${max > min ? ((m.value - min) / (max - min)) * 100 : 0}%` }}>
              {m.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
