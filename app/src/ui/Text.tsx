import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react';

import { cx } from './cx';

export type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'small';
export type TextTone = 'default' | 'secondary' | 'muted' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'inherit';

export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, 'color'> {
  /** 글자 크기·굵기 묶음 (기본 body 15px) */
  variant?: TextVariant;
  /** 글자 색 (기본 default = --text) */
  tone?: TextTone;
  /** 렌더할 태그 (기본: display·title → h2, heading → h3, 그 밖 p) */
  as?: ElementType;
  align?: 'left' | 'center' | 'right';
  weight?: 400 | 500 | 600 | 700 | 800;
  /** 숫자 고정폭 (tabular-nums) */
  numeric?: boolean;
  /** 한 줄로 자르고 … 표시 */
  truncate?: boolean;
  children?: ReactNode;
}

const DEFAULT_TAG: Record<TextVariant, ElementType> = {
  display: 'h1',
  title: 'h2',
  heading: 'h3',
  body: 'p',
  label: 'span',
  caption: 'p',
  small: 'span',
};

/** 글자 — 크기(variant)와 색(tone)을 토큰으로만 */
export function Text({ variant = 'body', tone = 'default', as, align, weight, numeric, truncate, className, style, children, ...rest }: TextProps) {
  const Tag = as ?? DEFAULT_TAG[variant];
  const st: CSSProperties = { ...(align ? { textAlign: align } : null), ...(weight ? { fontWeight: weight } : null), ...style };
  return (
    <Tag
      className={cx('sb-text', `sb-text--${variant}`, tone !== 'default' && `sb-tone--${tone}`, numeric && 'sb-num', truncate && 'sb-text--truncate', className)}
      style={st}
      {...rest}>
      {children}
    </Tag>
  );
}
