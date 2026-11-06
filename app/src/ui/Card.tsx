import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';

import { cx, type Tone } from './cx';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** 배경·테두리 색 (기본 neutral = 흰 카드). accent 는 당근 연한 배경 */
  tone?: Tone;
  /** 안쪽 여백 (기본 true = 16px, 'lg' = 24px, false = 0) */
  padded?: boolean | 'lg';
  /** 점선 테두리 (빈 슬롯 등) */
  dashed?: boolean;
  /** 그림자 없이 평평하게 (카드 안의 카드) */
  flat?: boolean;
  /** 누를 수 있는 카드 — 키보드(Enter/Space)·초점·눌림 효과 포함 */
  onPress?: () => void;
  /** 누를 수 있는 카드의 화면 읽기 이름 */
  pressLabel?: string;
}

/** 흰 카드 (모서리 16px, 옅은 그림자) */
export function Card({ children, tone = 'neutral', padded = true, dashed, flat, onPress, pressLabel, className, ...rest }: CardProps) {
  const interactive = !!onPress;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onPress) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPress();
    }
  };
  return (
    <div
      className={cx(
        'sb-card',
        tone !== 'neutral' && `sb-card--${tone}`,
        padded === 'lg' ? 'sb-card--pad-lg' : padded ? 'sb-card--pad' : null,
        dashed && 'sb-card--dashed',
        flat && 'sb-card--flat',
        interactive && 'sb-card--interactive',
        className,
      )}
      {...(interactive ? { role: 'button', tabIndex: 0, onClick: onPress, onKeyDown, 'aria-label': pressLabel } : null)}
      {...rest}>
      {children}
    </div>
  );
}
