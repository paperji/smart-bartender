import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { SLOW_AFTER_MS, SLOW_TEXT, useAiBusy } from '@/store/aiBusy';

import { cx } from './cx';

export interface AiLoadingProps {
  /** 큰 제목 (예: 'AI 바텐더가 레시피를 고민 중이에요') */
  title?: string;
  /** 1.6초마다 바뀌는 안내 문장 */
  lines?: string[];
  /** 그림 크기 (기본 120px) */
  size?: number;
  /** "오래 걸리는 중" 문구를 보일지 */
  slow?: boolean;
  className?: string;
}

/**
 * 칵테일 잔이 차오르고 거품이 올라오는 로딩 그림 + 문구.
 * prefers-reduced-motion 이면 움직임 없이 반쯤 찬 잔만 보여 줌(문구는 계속 바뀜).
 */
export function AiLoading({ title, lines = [], size = 120, slow, className }: AiLoadingProps) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    if (lines.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % lines.length), 1600);
    return () => clearInterval(t);
  }, [lines]);
  return (
    <div className={cx('sb-ailoading', className)} role="status" aria-live="polite">
      <svg className="sb-ailoading__art" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <clipPath id="sb-glass-clip">
            <path d="M28 30 L92 30 L64 64 L56 64 Z" />
          </clipPath>
        </defs>
        <circle cx="60" cy="60" r="56" fill="var(--accent-soft)" />
        {/* 잔 안 음료 (차오름) */}
        <g clipPath="url(#sb-glass-clip)">
          <rect className="sb-ailoading__liquid" x="20" y="30" width="80" height="40" fill="var(--accent)" />
          <circle className="sb-ailoading__bubble sb-ailoading__bubble--1" cx="54" cy="58" r="2.2" fill="#fff" opacity="0.85" />
          <circle className="sb-ailoading__bubble sb-ailoading__bubble--2" cx="62" cy="60" r="1.6" fill="#fff" opacity="0.85" />
          <circle className="sb-ailoading__bubble sb-ailoading__bubble--3" cx="68" cy="56" r="1.9" fill="#fff" opacity="0.85" />
        </g>
        {/* 잔 테두리 + 다리 */}
        <path d="M28 30 L92 30 L64 64 L56 64 Z" fill="none" stroke="var(--text)" strokeWidth="3" strokeLinejoin="round" />
        <path d="M60 64 L60 88 M46 90 L74 90" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" />
        {/* 당근 장식 */}
        <g className="sb-ailoading__garnish">
          <path d="M84 18 L96 34 L80 30 Z" fill="var(--accent-strong)" />
          <path d="M84 18 L80 10 M84 18 L88 9 M84 18 L91 13" stroke="var(--green)" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      </svg>
      {title ? <p className="sb-ailoading__title">{title}</p> : null}
      {lines.length ? (
        <p key={idx} className="sb-ailoading__line">
          {lines[idx % lines.length]}
        </p>
      ) : null}
      {slow ? <p className="sb-ailoading__slow">{SLOW_TEXT}</p> : null}
      <span className="sb-ailoading__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

/** AI 추천 중 전체 화면 로딩 (store/aiBusy 의 withAiBusy) — App 루트에 1개 */
export function AiLoadingHost() {
  const { busy, title, lines } = useAiBusy();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) return;
    setSlow(false);
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [busy]);
  if (!busy || typeof document === 'undefined') return null;
  return createPortal(
    <div className="sb-busy" aria-modal="true" role="dialog" aria-label={title}>
      <div className="sb-busy__card">
        <AiLoading title={title} lines={lines} slow={slow} />
      </div>
    </div>,
    document.body,
  );
}
