import type { Flavor } from '@/lib/types';
import { cx } from '@/ui';

/** 맛 항목 (v2.1 과 같은 순서·이름). 색은 밝은 바탕에서 잘 보이게 조금 진하게 */
export const FLAVOR_ITEMS: readonly { key: keyof Flavor; label: string; color: string }[] = [
  { key: 'sweet', label: '단맛', color: '#FF5C9E' },
  { key: 'sour', label: '신맛', color: '#F2B300' },
  { key: 'bitter', label: '쓴맛', color: '#8B7CF6' },
  { key: 'fizzy', label: '탄산', color: '#23B9A0' },
  { key: 'strength', label: '도수', color: 'var(--accent)' },
];

export interface FlavorBarsProps {
  /** 맛 프로필 0~5 (빠진 값은 0) */
  flavor: Partial<Flavor>;
  className?: string;
}

/** 맛 프로필 (0~5, 칸 5개) — v2.1 FlavorBars */
export function FlavorBars({ flavor, className }: FlavorBarsProps) {
  return (
    <ul className={cx('dc-flavor', className)} aria-label="맛 프로필">
      {FLAVOR_ITEMS.map((it) => {
        const raw = Number(flavor[it.key] ?? 0);
        const v = Math.max(0, Math.min(5, Number.isFinite(raw) ? raw : 0));
        return (
          <li key={it.key} className="dc-flavor__row">
            <span className="sr-only">{`${it.label} ${v}점`}</span>
            <span className="dc-flavor__label" aria-hidden="true">
              {it.label}
            </span>
            <span className="dc-flavor__cells" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} className="dc-flavor__cell" style={n <= v ? { backgroundColor: it.color } : undefined} />
              ))}
            </span>
            <span className="dc-flavor__num sb-num" aria-hidden="true">
              {v}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
