import type { LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { haptic } from '@/platform/haptics';

import { cx } from './cx';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 묶음 이름 (화면 읽기용, 필수) */
  ariaLabel: string;
  /** sm(높이 36px) · md(40px, 기본) — 묶음 안쪽 여백까지 눌려 터치 영역은 44px · 48px */
  size?: 'sm' | 'md';
  /** 가로 꽉 채우기 (기본 true) */
  full?: boolean;
  className?: string;
}

/** 여러 개 중 하나 고르기 (라디오 묶음, 좌우 화살표 키로 이동) */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, size = 'md', full = true, className }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((o) => !o.disabled);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const cur = enabled.findIndex((o) => o.value === value);
    let next = cur;
    if (e.key === 'ArrowRight') next = (cur + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (cur - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else next = enabled.length - 1;
    const o = enabled[next];
    if (!o) return;
    onChange(o.value);
    refs.current[options.indexOf(o)]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx('sb-seg', `sb-seg--${size}`, full && 'sb-seg--full', className)} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const sel = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={sel}
            tabIndex={sel ? 0 : -1}
            disabled={o.disabled}
            className={cx('sb-seg__item', sel && 'is-selected')}
            onClick={() => {
              if (sel) return;
              haptic.tap();
              onChange(o.value);
            }}>
            {Icon ? <Icon size={16} aria-hidden="true" /> : null}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
