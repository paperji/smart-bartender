/**
 * 재료 프리셋 · 카테고리 정보 · 맛 프로필 (순수 데이터)
 * - 재료 탭의 "빠른 선택"과 오프라인(규칙기반) 추천기의 맛 추정에 함께 쓰입니다.
 */
import { normName } from './ai/normalize';
import type { Category, PumpSlot } from './types';

export interface FlavorProfile {
  sweet: number; // 0~5
  sour: number;
  bitter: number;
  fizzy: number;
}

export interface IngredientPreset {
  name: string;
  category: Category;
  abv: number;
  color: string;
  profile: FlavorProfile;
  /** 레시피에서 차지할 수 있는 최대 비율(0~1). 레몬즙·시럽처럼 강한 재료는 작게 */
  maxShare?: number;
  /** 검색용 별칭 */
  aliases?: string[];
}

export const CATEGORY_INFO: Record<Category, { label: string; icon: string; defaultColor: string }> = {
  spirit: { label: '증류주', icon: 'flame', defaultColor: '#D4A373' },
  liqueur: { label: '리큐르', icon: 'flask', defaultColor: '#B57EDC' },
  wine: { label: '와인·맥주', icon: 'wine', defaultColor: '#C2185B' },
  syrup: { label: '시럽', icon: 'color-fill', defaultColor: '#FFB347' },
  juice: { label: '주스', icon: 'nutrition', defaultColor: '#FF9F43' },
  soda: { label: '탄산', icon: 'sparkles', defaultColor: '#C9D6E8' },
  dairy: { label: '유제품', icon: 'cafe', defaultColor: '#EFE6D2' },
  water: { label: '물', icon: 'water', defaultColor: '#7FC8F8' },
  other: { label: '기타', icon: 'ellipse', defaultColor: '#9AA3B5' },
};

/** 재료 색상 팔레트 (보조 색은 재료 표시에만 사용) */
export const INGREDIENT_COLORS = [
  '#5CE1C6', // 민트
  '#FF6FAE', // 핑크
  '#FFC542', // 레몬
  '#FF9F43', // 오렌지
  '#FF5A5F', // 석류/체리
  '#8B7CF6', // 바이올렛
  '#4DA3FF', // 블루
  '#7BD88F', // 라임
  '#B0794F', // 콜라
  '#D4A373', // 위스키
  '#EFE6D2', // 우유
  '#C9D6E8', // 투명(탄산/물)
];

export const PRESETS: IngredientPreset[] = [
  // 탄산
  { name: '사이다', category: 'soda', abv: 0, color: '#C9D6E8', profile: { sweet: 4, sour: 1, bitter: 0, fizzy: 5 }, aliases: ['스프라이트', '칠성사이다'] },
  { name: '콜라', category: 'soda', abv: 0, color: '#B0794F', profile: { sweet: 5, sour: 1, bitter: 1, fizzy: 5 }, aliases: ['코카콜라', '펩시'] },
  { name: '토닉워터', category: 'soda', abv: 0, color: '#DDE7F2', profile: { sweet: 2, sour: 1, bitter: 4, fizzy: 5 }, aliases: ['토닉'] },
  { name: '탄산수', category: 'soda', abv: 0, color: '#E3ECF5', profile: { sweet: 0, sour: 0, bitter: 0, fizzy: 5 }, aliases: ['트레비', '페리에', '소다수'] },
  { name: '진저에일', category: 'soda', abv: 0, color: '#F2C879', profile: { sweet: 4, sour: 1, bitter: 1, fizzy: 5 } },
  { name: '레모네이드', category: 'soda', abv: 0, color: '#FFE27A', profile: { sweet: 4, sour: 3, bitter: 0, fizzy: 4 } },
  // 주스
  { name: '오렌지주스', category: 'juice', abv: 0, color: '#FF9F43', profile: { sweet: 4, sour: 2, bitter: 0, fizzy: 0 }, aliases: ['오렌지'] },
  { name: '파인애플주스', category: 'juice', abv: 0, color: '#FFD35C', profile: { sweet: 4, sour: 2, bitter: 0, fizzy: 0 }, aliases: ['파인애플'] },
  { name: '사과주스', category: 'juice', abv: 0, color: '#F4D06F', profile: { sweet: 4, sour: 1, bitter: 0, fizzy: 0 }, aliases: ['사과'] },
  { name: '포도주스', category: 'juice', abv: 0, color: '#8B4F9E', profile: { sweet: 5, sour: 1, bitter: 0, fizzy: 0 }, aliases: ['포도'] },
  { name: '자몽주스', category: 'juice', abv: 0, color: '#FF7F7F', profile: { sweet: 2, sour: 3, bitter: 3, fizzy: 0 }, aliases: ['자몽'] },
  { name: '크랜베리주스', category: 'juice', abv: 0, color: '#D7263D', profile: { sweet: 3, sour: 3, bitter: 1, fizzy: 0 }, aliases: ['크랜베리'] },
  { name: '레몬즙', category: 'juice', abv: 0, color: '#FFC542', profile: { sweet: 0, sour: 5, bitter: 1, fizzy: 0 }, maxShare: 0.15, aliases: ['레몬', '레몬주스'] },
  { name: '라임즙', category: 'juice', abv: 0, color: '#7BD88F', profile: { sweet: 0, sour: 5, bitter: 1, fizzy: 0 }, maxShare: 0.15, aliases: ['라임'] },
  { name: '사고주스', category: 'juice', abv: 0, color: '#F7E1A0', profile: { sweet: 4, sour: 1, bitter: 0, fizzy: 0 }, aliases: ['사고'] },
  // 시럽
  { name: '설탕시럽', category: 'syrup', abv: 0, color: '#F5E6C8', profile: { sweet: 5, sour: 0, bitter: 0, fizzy: 0 }, maxShare: 0.1, aliases: ['시럽', '심플시럽'] },
  { name: '그레나딘시럽', category: 'syrup', abv: 0, color: '#FF5A5F', profile: { sweet: 5, sour: 1, bitter: 0, fizzy: 0 }, maxShare: 0.1, aliases: ['그레나딘', '석류시럽'] },
  { name: '블루큐라소시럽', category: 'syrup', abv: 0, color: '#4DA3FF', profile: { sweet: 5, sour: 1, bitter: 1, fizzy: 0 }, maxShare: 0.1, aliases: ['블루큐라소'] },
  // 유제품·물
  { name: '우유', category: 'dairy', abv: 0, color: '#EFE6D2', profile: { sweet: 1, sour: 0, bitter: 0, fizzy: 0 } },
  { name: '물', category: 'water', abv: 0, color: '#7FC8F8', profile: { sweet: 0, sour: 0, bitter: 0, fizzy: 0 }, aliases: ['생수'] },
  // 주류
  { name: '보드카', category: 'spirit', abv: 40, color: '#E3ECF5', profile: { sweet: 0, sour: 0, bitter: 1, fizzy: 0 } },
  { name: '진', category: 'spirit', abv: 40, color: '#D8EEF0', profile: { sweet: 0, sour: 0, bitter: 2, fizzy: 0 } },
  { name: '럼', category: 'spirit', abv: 40, color: '#D4A373', profile: { sweet: 1, sour: 0, bitter: 1, fizzy: 0 }, aliases: ['화이트럼', '다크럼'] },
  { name: '위스키', category: 'spirit', abv: 40, color: '#C68642', profile: { sweet: 1, sour: 0, bitter: 2, fizzy: 0 } },
  { name: '데킬라', category: 'spirit', abv: 38, color: '#F1E3B5', profile: { sweet: 0, sour: 0, bitter: 2, fizzy: 0 } },
  { name: '소주', category: 'spirit', abv: 16.5, color: '#E8F4EC', profile: { sweet: 1, sour: 0, bitter: 2, fizzy: 0 } },
  { name: '진로토닉', category: 'soda', abv: 0, color: '#DDE7F2', profile: { sweet: 3, sour: 1, bitter: 2, fizzy: 5 }, aliases: ['진로 토닉'] },
  { name: '피치트리', category: 'liqueur', abv: 20, color: '#FFB38A', profile: { sweet: 5, sour: 1, bitter: 0, fizzy: 0 }, aliases: ['피치 리큐르', '피치슈냅스'] },
  { name: '깔루아', category: 'liqueur', abv: 20, color: '#6F4E37', profile: { sweet: 5, sour: 0, bitter: 2, fizzy: 0 }, aliases: ['커피 리큐르'] },
  { name: '말리부', category: 'liqueur', abv: 21, color: '#F3F0E6', profile: { sweet: 4, sour: 0, bitter: 0, fizzy: 0 }, aliases: ['코코넛 럼'] },
  { name: '화이트와인', category: 'wine', abv: 12, color: '#F2E8A6', profile: { sweet: 2, sour: 3, bitter: 1, fizzy: 0 } },
  { name: '맥주', category: 'wine', abv: 4.5, color: '#F2B53B', profile: { sweet: 1, sour: 0, bitter: 3, fizzy: 4 } },
];

/** 프리셋 이름/별칭으로 찾기 (공백 무시, 부분 일치 허용) */
export function findPreset(name: string): IngredientPreset | undefined {
  const key = name.replace(/\s+/g, '').toLowerCase();
  if (!key) return undefined;
  const exact = PRESETS.find(
    (p) => p.name.replace(/\s+/g, '').toLowerCase() === key || p.aliases?.some((a) => a.replace(/\s+/g, '').toLowerCase() === key),
  );
  if (exact) return exact;
  return PRESETS.find(
    (p) =>
      key.includes(p.name.replace(/\s+/g, '').toLowerCase()) ||
      p.aliases?.some((a) => key.includes(a.replace(/\s+/g, '').toLowerCase())),
  );
}

/**
 * 이름이 프리셋 이름·별칭과 정확히 같을 때만 그 프리셋 (SPEC §3.1 normName 비교).
 * 부분 일치는 쓰지 않음 — 예: '진저 시럽'이 '진'(증류주 40%)으로 잘못 잡히지 않게
 */
export function findExactPreset(name: string): IngredientPreset | undefined {
  const k = normName(name);
  if (!k) return undefined;
  return PRESETS.find((p) => normName(p.name) === k || p.aliases?.some((a) => normName(a) === k));
}

/** 카테고리 기본 맛 프로필 (프리셋에 없는 재료용) */
export function categoryProfile(category: Category): FlavorProfile {
  switch (category) {
    case 'soda':
      return { sweet: 3, sour: 1, bitter: 0, fizzy: 5 };
    case 'juice':
      return { sweet: 3, sour: 2, bitter: 0, fizzy: 0 };
    case 'syrup':
      return { sweet: 5, sour: 0, bitter: 0, fizzy: 0 };
    case 'dairy':
      return { sweet: 1, sour: 0, bitter: 0, fizzy: 0 };
    case 'water':
      return { sweet: 0, sour: 0, bitter: 0, fizzy: 0 };
    case 'spirit':
      return { sweet: 0, sour: 0, bitter: 2, fizzy: 0 };
    case 'liqueur':
      return { sweet: 4, sour: 0, bitter: 1, fizzy: 0 };
    case 'wine':
      return { sweet: 2, sour: 2, bitter: 2, fizzy: 1 };
    default:
      return { sweet: 2, sour: 1, bitter: 1, fizzy: 0 };
  }
}

export function profileOf(name: string, category: Category): { profile: FlavorProfile; maxShare: number } {
  const p = findPreset(name);
  if (p) return { profile: p.profile, maxShare: p.maxShare ?? 1 };
  const maxShare = category === 'syrup' ? 0.1 : 1;
  return { profile: categoryProfile(category), maxShare };
}

/** 첫 실행 기본 재료 (무알콜 전시용) */
export function defaultSlots(count = 4): PumpSlot[] {
  const now = Date.now();
  const base: Omit<PumpSlot, 'pump' | 'updatedAt'>[] = [
    { name: '사이다', category: 'soda', abv: 0, capacityMl: 1000, remainingMl: 1000, color: '#C9D6E8', notes: '' },
    { name: '오렌지주스', category: 'juice', abv: 0, capacityMl: 1000, remainingMl: 1000, color: '#FF9F43', notes: '' },
    { name: '레몬즙', category: 'juice', abv: 0, capacityMl: 500, remainingMl: 500, color: '#FFC542', notes: '' },
    { name: '콜라', category: 'soda', abv: 0, capacityMl: 1000, remainingMl: 1000, color: '#B0794F', notes: '' },
  ];
  const slots: PumpSlot[] = [];
  for (let i = 0; i < count; i++) {
    const b = base[i];
    slots.push(
      b
        ? { ...b, pump: i + 1, updatedAt: now }
        : emptySlot(i + 1),
    );
  }
  return slots;
}

export function emptySlot(pump: number): PumpSlot {
  return {
    pump,
    name: '',
    category: 'other',
    abv: 0,
    capacityMl: 1000,
    remainingMl: 0,
    color: INGREDIENT_COLORS[(pump - 1) % INGREDIENT_COLORS.length],
    notes: '',
    updatedAt: Date.now(),
  };
}

export const MOODS = ['행복', '설렘', '피곤함', '스트레스', '우울', '차분', '신남', '나른함'];
export const SITUATIONS = ['혼술', '파티', '데이트', '휴식', '운동 후', '공부/작업', '식사와 함께'];
export const WEATHER_CHOICES = ['맑음', '흐림', '비', '눈', '더움', '추움'];
