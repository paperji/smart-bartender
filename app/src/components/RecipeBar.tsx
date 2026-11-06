import type { PumpSlot, RecipeIngredient } from '@/lib/types';
import { cx } from '@/ui';

import { colorFor, sharePct } from './color';

export interface RecipeBarProps {
  /** 레시피 재료 (pump·name·ml) — 순서대로 왼쪽부터 칠함 */
  ingredients: readonly Pick<RecipeIngredient, 'pump' | 'name' | 'ml'>[];
  /** 펌프 슬롯 (재료 색을 펌프 번호로 찾음) */
  slots: readonly PumpSlot[];
  /** 막대 두께 px (기본 18). v2.1: 레시피 22, 기록·즐겨찾기 12 */
  height?: number;
  /** 아래 범례(● 이름 25%) 표시 (기본 true) */
  legend?: boolean;
  className?: string;
}

/** 재료 비율 스택 막대 + 범례 (v2.1 RecipeBar) */
export function RecipeBar({ ingredients, slots, height = 18, legend = true, className }: RecipeBarProps) {
  const total = ingredients.reduce((a, b) => a + b.ml, 0) || 1;
  const summary = ingredients.map((i) => `${i.name} ${sharePct(i.ml, total)}%`).join(', ');
  return (
    <div className={cx('dc-recipebar', className)}>
      <div
        className="dc-recipebar__bar"
        style={{ height, borderRadius: height / 2 }}
        {...(legend ? { 'aria-hidden': true } : { role: 'img', 'aria-label': `재료 비율: ${summary}` })}>
        {ingredients.map((i, idx) =>
          i.ml > 0 ? (
            <span
              key={`${i.pump}-${idx}`}
              className="dc-recipebar__seg"
              style={{ flexGrow: i.ml / total, backgroundColor: colorFor(i.pump, slots) }}
            />
          ) : null,
        )}
      </div>
      {legend ? (
        <ul className="dc-recipebar__legend" aria-label="재료 비율">
          {ingredients.map((i, idx) => (
            <li key={`${i.pump}-${idx}`} className="dc-recipebar__item">
              <span className="dc-dot" style={{ backgroundColor: colorFor(i.pump, slots) }} aria-hidden="true" />
              <span>
                {i.name} <span className="sb-num">{sharePct(i.ml, total)}%</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
