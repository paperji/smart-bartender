import type { LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { haptic } from '@/platform/haptics';

import { cx } from './cx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** 버튼 글자 (children 대신 써도 됨) */
  label?: ReactNode;
  children?: ReactNode;
  /** primary(당근 채움, 기본) · secondary(흰 바탕+테두리) · ghost(배경 없음) · danger(빨강) */
  variant?: ButtonVariant;
  /** sm(36px) · md(44px, 기본) · lg(52px) — sm 도 터치 영역은 44px 확보 */
  size?: ButtonSize;
  /** 왼쪽 아이콘 (lucide-react 아이콘 컴포넌트) */
  icon?: LucideIcon;
  /** 오른쪽 아이콘 */
  iconRight?: LucideIcon;
  /** 진행 중 — 스피너 표시 + 누를 수 없음 */
  loading?: boolean;
  /** 가로 꽉 채우기 */
  full?: boolean;
  /** 누를 때 진동 (기본 true) */
  haptics?: boolean;
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

/** 기본 버튼 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    label,
    children,
    variant = 'primary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    full = false,
    haptics = true,
    disabled,
    type = 'button',
    className,
    onClick,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      className={cx('sb-btn', `sb-btn--${variant}`, `sb-btn--${size}`, full && 'sb-btn--full', loading && 'is-loading', className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (haptics) haptic.tap();
        onClick?.(e);
      }}
      {...rest}>
      {loading ? <Spinner size={ICON_SIZE[size]} label="처리 중" /> : Icon ? <Icon size={ICON_SIZE[size]} aria-hidden="true" /> : null}
      {label ?? children ? <span className="sb-btn__label">{label ?? children}</span> : null}
      {IconRight && !loading ? <IconRight size={ICON_SIZE[size]} aria-hidden="true" /> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** 화면 읽기 프로그램·툴팁용 이름 (필수) */
  label: string;
  /** ghost(기본) · secondary · primary · danger */
  variant?: ButtonVariant;
  /** sm(36px 보이는 크기, 터치 44px) · md(44px, 기본) · lg(52px) */
  size?: ButtonSize;
  /** 오른쪽 위 작은 표시 (숫자·'!') */
  badge?: ReactNode;
}

/** 아이콘만 있는 버튼 (label 은 aria-label·title 로 들어감) */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, variant = 'ghost', size = 'md', badge, type = 'button', className, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx('sb-iconbtn', `sb-btn--${variant}`, `sb-iconbtn--${size}`, className)}
      onClick={(e) => {
        haptic.tap();
        onClick?.(e);
      }}
      {...rest}>
      <Icon size={size === 'lg' ? 24 : size === 'sm' ? 18 : 20} aria-hidden="true" />
      {badge !== undefined && badge !== null && badge !== false ? <span className="sb-iconbtn__badge">{badge}</span> : null}
    </button>
  );
});
