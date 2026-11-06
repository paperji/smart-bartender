import type { LucideIcon } from 'lucide-react';
import { Minus } from 'lucide-react';
import { useId, useRef, type CSSProperties, type KeyboardEvent } from 'react';

import { haptic } from '@/platform/haptics';

import { cx } from './cx';

/** 0~5 단계 이름 (v2.1 LevelSelector 와 같음) */
export const SCALE_WORDS = ['없음', '아주 약하게', '약하게', '보통', '강하게', '아주 강하게'];

export interface ScaleSelectorProps {
  /** 맛 이름 (예: '단맛') */
  label: string;
  /** 0~5 */
  value: number;
  onChange: (value: number) => void;
  /** 채움 색 (기본 --accent) — 맛마다 다른 색을 줄 수 있음 */
  color?: string;
  icon?: LucideIcon;
  /** 단계 이름 바꾸기 (6개) */
  words?: string[];
  /** 최댓값 (기본 5) */
  max?: number;
  disabled?: boolean;
  className?: string;
}

/** 맛 세기 0~5 고르기 — 칸을 누르거나 좌우 화살표 키 (role=slider) */
export function ScaleSelector({ label, value, onChange, color, icon: Icon, words = SCALE_WORDS, max = 5, disabled, className }: ScaleSelectorProps) {
  const id = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  const set = (n: number) => {
    const v = Math.max(0, Math.min(max, n));
    if (v === value || disabled) return;
    haptic.tap();
    onChange(v);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const map: Record<string, number> = { ArrowRight: value + 1, ArrowUp: value + 1, ArrowLeft: value - 1, ArrowDown: value - 1, Home: 0, End: max };
    if (e.key in map) {
      e.preventDefault();
      set(map[e.key]);
    }
  };
  const cells = Array.from({ length: max + 1 }, (_, n) => n);
  return (
    <div className={cx('sb-scale', disabled && 'is-disabled', className)} style={color ? ({ '--scale-color': color } as CSSProperties) : undefined}>
      <div className="sb-scale__head">
        <span id={id} className="sb-scale__label">
          {Icon ? <Icon size={16} aria-hidden="true" style={{ color: color ?? 'var(--accent)' }} /> : null}
          {label}
        </span>
        <span className="sb-scale__value sb-num">
          {value} · {words[value] ?? ''}
        </span>
      </div>
      <div
        ref={rowRef}
        className="sb-scale__row"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value}단계, ${words[value] ?? ''}`}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}>
        {cells.map((n) => {
          const on = n > 0 && n <= value;
          return (
            <button
              key={n}
              type="button"
              tabIndex={-1}
              aria-label={`${label} ${n}단계`}
              disabled={disabled}
              className={cx('sb-scale__cell', n === 0 && 'sb-scale__cell--zero', on && 'is-on', n === 0 && value === 0 && 'is-zero')}
              onClick={() => {
                set(n);
                rowRef.current?.focus();
              }}>
              {n === 0 ? <Minus size={14} aria-hidden="true" /> : <span className="sb-num">{n}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
