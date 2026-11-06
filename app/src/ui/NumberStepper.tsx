import { Minus, Plus } from 'lucide-react';
import { useId } from 'react';

import { haptic } from '@/platform/haptics';

import { cx } from './cx';

export interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  /** 값 옆 단위 (예: 'ml') */
  unit?: string;
  /** 아래 빠른 선택 버튼 (예: [150, 200, 250]) */
  presets?: number[];
  /** 값 표시 바꾸기 */
  format?: (v: number) => string;
  /** 화면 읽기 이름 (예: '잔 용량') — 필수 */
  label: string;
  /** 이름을 화면에도 보일지 (기본 false) */
  showLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

/** − 값 + (v2.1 Stepper 와 같은 반올림: step 단위, 소수 2자리) */
export function NumberStepper({ value, onChange, min, max, step, unit, presets, format, label, showLabel, disabled, className }: NumberStepperProps) {
  const id = useId();
  const set = (v: number) => {
    const n = Math.max(min, Math.min(max, Math.round(v / step) * step));
    if (n !== value) {
      haptic.tap();
      onChange(Math.round(n * 100) / 100);
    }
  };
  return (
    <div className={cx('sb-stepper', disabled && 'is-disabled', className)} role="group" aria-labelledby={id}>
      <span id={id} className={showLabel ? 'sb-stepper__label' : 'sr-only'}>
        {label}
      </span>
      <div className="sb-stepper__row">
        <button type="button" className="sb-stepper__btn" aria-label={`${label} 줄이기`} disabled={disabled || value <= min} onClick={() => set(value - step)}>
          <Minus size={20} aria-hidden="true" />
        </button>
        <output className="sb-stepper__value sb-num" aria-live="polite">
          <span className="sb-stepper__num">{format ? format(value) : value}</span>
          {unit ? <span className="sb-stepper__unit">{unit}</span> : null}
        </output>
        <button type="button" className="sb-stepper__btn" aria-label={`${label} 늘리기`} disabled={disabled || value >= max} onClick={() => set(value + step)}>
          <Plus size={20} aria-hidden="true" />
        </button>
      </div>
      {presets?.length ? (
        <div className="sb-stepper__presets">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === value}
              disabled={disabled}
              className={cx('sb-stepper__preset', p === value && 'is-selected')}
              onClick={() => set(p)}>
              <span className="sb-num">
                {p}
                {unit}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
