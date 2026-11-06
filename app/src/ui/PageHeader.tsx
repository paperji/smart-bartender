import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { back as navBack } from '@/lib/nav';

import { IconButton } from './Button';
import { cx } from './cx';

export interface PageHeaderProps {
  title: ReactNode;
  /** 제목 아래 작은 설명 */
  subtitle?: ReactNode;
  /**
   * 뒤로 버튼. true = 앱 안 이전 화면(없으면 홈 '/'), 문자열 = 앱 안 기록이 없을 때 갈 경로(예: '/ingredients')
   * onBack 을 주면 그것을 대신 호출
   */
  back?: boolean | string;
  onBack?: () => void;
  /** 오른쪽 끝 버튼들 (IconButton 등) */
  actions?: ReactNode;
  /** 제목 크기: page(28px, 기본 — 탭 화면) · sub(22px — 상세 화면) */
  size?: 'page' | 'sub';
  className?: string;
}

/** 화면 제목 줄 — 뒤로 버튼·제목·오른쪽 동작 */
export function PageHeader({ title, subtitle, back, onBack, actions, size, className }: PageHeaderProps) {
  const hasBack = !!back || !!onBack;
  const sz = size ?? (hasBack ? 'sub' : 'page');
  return (
    <header className={cx('sb-pagehead', `sb-pagehead--${sz}`, className)}>
      {hasBack ? (
        <IconButton
          icon={ArrowLeft}
          label="뒤로"
          className="sb-pagehead__back"
          onClick={() => (onBack ? onBack() : navBack(typeof back === 'string' ? back : '/'))}
        />
      ) : null}
      <div className="sb-pagehead__titles">
        <h1 className="sb-pagehead__title">{title}</h1>
        {subtitle ? <p className="sb-pagehead__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="sb-pagehead__actions">{actions}</div> : null}
    </header>
  );
}
