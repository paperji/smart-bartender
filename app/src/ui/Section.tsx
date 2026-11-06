import type { LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { cx } from './cx';

export interface SectionHeaderProps {
  title: ReactNode;
  /** 제목 왼쪽 아이콘 */
  icon?: LucideIcon;
  /** 제목 아래 보조 설명 */
  description?: ReactNode;
  /** 오른쪽 끝 (버튼·링크 등) */
  action?: ReactNode;
  /** 제목 태그 id (Section 이 aria-labelledby 로 연결) */
  id?: string;
  /** h2(기본) | h3 */
  level?: 2 | 3;
  className?: string;
}

/** 구역 제목 줄 */
export function SectionHeader({ title, icon: Icon, description, action, id, level = 2, className }: SectionHeaderProps) {
  const H = level === 3 ? 'h3' : 'h2';
  return (
    <div className={cx('sb-section__head', className)}>
      <div className="sb-section__titles">
        <H id={id} className="sb-section__title">
          {Icon ? <Icon size={18} aria-hidden="true" className="sb-section__icon" /> : null}
          {title}
        </H>
        {description ? <p className="sb-section__desc">{description}</p> : null}
      </div>
      {action ? <div className="sb-section__action">{action}</div> : null}
    </div>
  );
}

export interface SectionProps extends Omit<SectionHeaderProps, 'id' | 'className'> {
  children?: ReactNode;
  className?: string;
  /** 안쪽 요소 사이 간격 (기본 12px) */
  gap?: number;
}

/** 제목 + 내용 묶음 (<section aria-labelledby>) */
export function Section({ children, className, gap = 12, ...head }: SectionProps) {
  const id = useId();
  return (
    <section className={cx('sb-section', className)} aria-labelledby={id} style={{ gap }}>
      <SectionHeader {...head} id={id} />
      {children}
    </section>
  );
}
