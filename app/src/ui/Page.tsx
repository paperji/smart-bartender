import { useLayoutEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';

import { cx } from './cx';

export interface PageProps {
  children?: ReactNode;
  /** 본문 최대 폭: narrow(640px) · normal(880px, 기본) · wide(1120px) */
  width?: 'narrow' | 'normal' | 'wide';
  /** 화면 맨 위 제목 줄 (PageHeader) */
  header?: ReactNode;
  /** 아래에 붙는 버튼 줄 (모바일은 탭바 위에 고정, PC 는 본문 끝) */
  footer?: ReactNode;
  /** 요소 사이 세로 간격 (기본 20px) */
  gap?: number;
  className?: string;
}

/** 화면 한 장의 틀 — 가운데 정렬·최대 폭·여백·세로 간격 */
export function Page({ children, width = 'normal', header, footer, gap = 20, className }: PageProps) {
  const footerRef = useRef<HTMLDivElement>(null);
  const hasFooter = !!footer;
  usePageFooterOffset(footerRef, hasFooter);
  return (
    <div className={cx('sb-page', `sb-page--${width}`, footer ? 'sb-page--with-footer' : null, className)}>
      {header}
      <div className="sb-page__body" style={{ gap }}>
        {children}
      </div>
      {footer ? (
        <div ref={footerRef} className="sb-page__footer">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 아래 버튼 줄이 있는 동안 <html> 에 sb-has-footer + --page-footer-h(버튼 줄 높이)
 * → 모바일에서 토스트가 버튼 줄을 가리지 않고 그 위에 뜸 (components.css .sb-toast-region)
 */
function usePageFooterOffset(ref: { current: HTMLDivElement | null }, active: boolean) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!active || !node || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    const apply = () => root.style.setProperty('--page-footer-h', `${Math.ceil(node.getBoundingClientRect().height)}px`);
    apply();
    root.classList.add('sb-has-footer');
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    ro?.observe(node);
    return () => {
      ro?.disconnect();
      root.classList.remove('sb-has-footer');
      root.style.removeProperty('--page-footer-h');
    };
  }, [ref, active]);
}

export interface ColumnsProps {
  children?: ReactNode;
  /** 왼쪽:오른쪽 비율 (기본 '1fr 1fr'), 900px 미만에서는 1열 */
  template?: string;
  gap?: number;
  className?: string;
}

/** PC(≥900px)에서 2열, 모바일 1열 */
export function Columns({ children, template = '1fr 1fr', gap = 20, className }: ColumnsProps) {
  return (
    <div className={cx('sb-columns', className)} style={{ '--cols': template, gap } as CSSProperties}>
      {children}
    </div>
  );
}

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /** 간격 px (기본 12) */
  gap?: number;
  /** 가로 정렬 (row 일 때 세로 가운데 맞춤) */
  direction?: 'column' | 'row';
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  wrap?: boolean;
}

/** 세로(기본)·가로 쌓기 */
export function Stack({ gap = 12, direction = 'column', align, justify, wrap, className, style, ...rest }: StackProps) {
  return (
    <div
      className={cx('sb-stack', className)}
      style={{
        display: 'flex',
        flexDirection: direction,
        gap,
        alignItems: align ?? (direction === 'row' ? 'center' : undefined),
        justifyContent: justify,
        flexWrap: wrap ? 'wrap' : undefined,
        minWidth: 0,
        ...style,
      }}
      {...rest}
    />
  );
}

/** 가로 쌓기 (Stack direction="row") */
export function Row(props: Omit<StackProps, 'direction'>) {
  return <Stack direction="row" gap={8} {...props} />;
}

/** 구분선 */
export function Divider({ className, inset }: { className?: string; inset?: boolean }) {
  return <hr className={cx('sb-divider', inset && 'sb-divider--inset', className)} />;
}
