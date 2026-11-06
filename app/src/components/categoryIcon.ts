/**
 * 재료 종류(Category) → lucide 아이콘
 * v2.1 CATEGORY_INFO.icon(Ionicons 이름: flame·flask·wine·color-fill·nutrition·sparkles·cafe·water·ellipse)을 lucide 로 옮김
 */
import { Circle, Citrus, CupSoda, Droplets, Flame, FlaskConical, Milk, PaintBucket, Wine, type LucideIcon } from 'lucide-react';

import type { Category } from '@/lib/types';

export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  spirit: Flame,
  liqueur: FlaskConical,
  wine: Wine,
  syrup: PaintBucket,
  juice: Citrus,
  soda: CupSoda,
  dairy: Milk,
  water: Droplets,
  other: Circle,
};

/** 모르는 값이면 '기타' 아이콘 */
export function categoryIcon(category: Category | string | null | undefined): LucideIcon {
  return (category && CATEGORY_ICONS[category as Category]) || CATEGORY_ICONS.other;
}
