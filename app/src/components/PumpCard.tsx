import { ChevronRight, CirclePlus, Gauge, TriangleAlert } from 'lucide-react';

import { fmtMl } from '@/lib/format';
import { CATEGORY_INFO } from '@/lib/presets';
import type { PumpSlot } from '@/lib/types';
import { isLowStock } from '@/store/slots';
import { Badge, Card, cx } from '@/ui';

import { categoryIcon } from './categoryIcon';
import { edgeColor, withAlpha } from './color';
import { ColorProgress } from './ColorProgress';

export interface PumpCardProps {
  slot: PumpSlot;
  /** 카드를 눌렀을 때 (보통 재료 편집 화면으로) */
  onPress: () => void;
  /** 이 펌프의 유량(ml/s) — 있으면 '· 3.2 ml/s' 표시 (useDevice cal[pump-1]) */
  mlps?: number | null;
  className?: string;
}

/** 재료 탭의 펌프 한 칸 — 빈 펌프 / 장착된 재료(잔량 막대·잔량 부족·캘리브레이션 권장 배지). v2.1 PumpCard */
export function PumpCard({ slot, onPress, mlps, className }: PumpCardProps) {
  const empty = !slot.name;
  if (empty) {
    return (
      <Card dashed onPress={onPress} pressLabel={`펌프 ${slot.pump} 비어 있음. 눌러서 재료 장착`} className={cx('dc-pumpcard', className)}>
        <div className="dc-pumpcard__row">
          <PumpNumber n={slot.pump} color="var(--border-strong)" />
          <div className="dc-pumpcard__main">
            <p className="dc-pumpcard__empty-title">비어 있음</p>
            <p className="dc-pumpcard__meta">눌러서 재료를 장착하세요</p>
          </div>
          <CirclePlus size={28} className="dc-pumpcard__add" aria-hidden="true" />
        </div>
      </Card>
    );
  }
  const info = CATEGORY_INFO[slot.category] ?? CATEGORY_INFO.other;
  const CatIcon = categoryIcon(slot.category);
  const ratio = slot.capacityMl > 0 ? slot.remainingMl / slot.capacityMl : 0;
  const low = isLowStock(slot);
  return (
    <Card
      onPress={onPress}
      pressLabel={`펌프 ${slot.pump} ${slot.name}, 남은 양 ${Math.round(slot.remainingMl)}ml`}
      className={cx('dc-pumpcard', low && 'dc-pumpcard--low', className)}>
      <div className="dc-pumpcard__body">
        <div className="dc-pumpcard__row">
          <PumpNumber n={slot.pump} color={slot.color} />
          <div className="dc-pumpcard__main">
            <p className="dc-pumpcard__name">{slot.name}</p>
            <p className="dc-pumpcard__meta">
              <CatIcon size={14} aria-hidden="true" />
              <span>
                {info.label}
                {slot.abv > 0 ? ` · ${slot.abv}%` : ' · 무알콜'}
                {mlps ? ` · ${mlps} ml/s` : ''}
              </span>
            </p>
          </div>
          <ChevronRight size={20} className="dc-pumpcard__chevron" aria-hidden="true" />
        </div>
        <div className="dc-pumpcard__stock">
          <ColorProgress
            value={ratio}
            color={low ? 'var(--yellow)' : slot.color}
            height={8}
            label={<span className={low ? 'dc-tone-warning' : undefined}>남은 양 {fmtMl(slot.remainingMl)} / {fmtMl(slot.capacityMl)}</span>}
            valueText={`${Math.round(ratio * 100)}%`}
            ariaLabel={`${slot.name} 남은 양`}
          />
        </div>
        {low || slot.needsCal ? (
          <div className="dc-pumpcard__badges">
            {low ? <Badge tone="warning" icon={TriangleAlert} label="잔량 부족 — 보충 필요" /> : null}
            {slot.needsCal ? <Badge tone="info" icon={Gauge} label="캘리브레이션 권장" /> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export interface PumpNumberProps {
  /** 펌프 번호 */
  n: number;
  /** 테두리·옅은 배경 색 (재료 색). 옅은 색은 테두리를 자동으로 조금 진하게 */
  color: string;
  /** 지름 px (기본 44, 재료 편집 화면 52) */
  size?: number;
  className?: string;
}

/** 동그란 펌프 번호 배지 ('PUMP' + 번호) — 재료 카드·캘리브레이션·재료 편집에서 씀. v2.1 PumpNumber */
export function PumpNumber({ n, color, size = 44, className }: PumpNumberProps) {
  return (
    <span
      className={cx('dc-pumpnum', className)}
      role="img"
      aria-label={`펌프 ${n}`}
      style={{ width: size, height: size, borderColor: edgeColor(color), backgroundColor: withAlpha(color, 0.16) }}>
      <span className="dc-pumpnum__cap" aria-hidden="true">
        PUMP
      </span>
      <span className="dc-pumpnum__n sb-num" aria-hidden="true" style={size >= 52 ? { fontSize: 18 } : undefined}>
        {n}
      </span>
    </span>
  );
}
