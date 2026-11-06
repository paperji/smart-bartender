import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { haptic } from '@/platform/haptics';

import { cx } from './cx';

export interface ChipProps {
  label: ReactNode;
  /** 선택됨 (당근 연한 배경 + 진한 글자) */
  selected?: boolean;
  onClick?: () => void;
  icon?: LucideIcon;
  /** 왼쪽 색 점 (재료 색 등) */
  dotColor?: string;
  disabled?: boolean;
  /** sm(32px 보이는 높이, 터치 44px) · md(40px, 기본) */
  size?: 'sm' | 'md';
  /** 화면 읽기 이름 (label 이 글자가 아닐 때) */
  ariaLabel?: string;
  /** ChipGroup 안에서 쓰는 역할 (기본: 토글 버튼) */
  role?: 'radio' | 'checkbox';
  className?: string;
}

/** 알약 모양 선택 칩 (단독으로 쓰면 aria-pressed 토글 버튼) */
export function Chip({ label, selected = false, onClick, icon: Icon, dotColor, disabled, size = 'md', ariaLabel, role, className }: ChipProps) {
  return (
    <button
      type="button"
      role={role}
      aria-pressed={role ? undefined : selected}
      aria-checked={role ? selected : undefined}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cx('sb-chip', `sb-chip--${size}`, selected && 'is-selected', className)}
      onClick={() => {
        haptic.tap();
        onClick?.();
      }}>
      {dotColor ? <span className="sb-chip__dot" style={{ background: dotColor }} aria-hidden="true" /> : null}
      {Icon ? <Icon size={size === 'sm' ? 14 : 16} aria-hidden="true" /> : null}
      <span>{label}</span>
    </button>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
  dotColor?: string;
  disabled?: boolean;
}

interface ChipGroupBase<T extends string> {
  options: ChipOption<T>[];
  /** 묶음 이름 (화면 읽기용, 필수) */
  ariaLabel: string;
  size?: 'sm' | 'md';
  className?: string;
}

export interface ChipGroupSingleProps<T extends string> extends ChipGroupBase<T> {
  multiple?: false;
  /** 선택값 (없으면 null) */
  value: T | null;
  onChange: (value: T | null) => void;
  /** 선택한 칩을 다시 누르면 선택 해제 (기본 false) */
  allowDeselect?: boolean;
}

export interface ChipGroupMultiProps<T extends string> extends ChipGroupBase<T> {
  multiple: true;
  value: T[];
  onChange: (value: T[]) => void;
  /** 최대 선택 개수 (넘으면 더 선택 안 됨) */
  max?: number;
}

export type ChipGroupProps<T extends string> = ChipGroupSingleProps<T> | ChipGroupMultiProps<T>;

/** 칩 묶음 — 하나만(radiogroup) 또는 여러 개(group) 선택 */
export function ChipGroup<T extends string>(props: ChipGroupProps<T>) {
  const { options, ariaLabel, size = 'md', className } = props;
  if (props.multiple) {
    const { value, onChange, max } = props;
    return (
      <div role="group" aria-label={ariaLabel} className={cx('sb-chipgroup', className)}>
        {options.map((o) => {
          const sel = value.includes(o.value);
          const full = !sel && max !== undefined && value.length >= max;
          return (
            <Chip
              key={o.value}
              role="checkbox"
              label={o.label}
              icon={o.icon}
              dotColor={o.dotColor}
              size={size}
              selected={sel}
              disabled={o.disabled || full}
              onClick={() => onChange(sel ? value.filter((v) => v !== o.value) : [...value, o.value])}
            />
          );
        })}
      </div>
    );
  }
  const { value, onChange, allowDeselect } = props;
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx('sb-chipgroup', className)}>
      {options.map((o) => {
        const sel = value === o.value;
        return (
          <Chip
            key={o.value}
            role="radio"
            label={o.label}
            icon={o.icon}
            dotColor={o.dotColor}
            size={size}
            selected={sel}
            disabled={o.disabled}
            onClick={() => onChange(sel ? (allowDeselect ? null : o.value) : o.value)}
          />
        );
      })}
    </div>
  );
}
