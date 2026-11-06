/**
 * 앱 전역 도메인 타입 (docs/SPEC.md §2, §3 과 일치)
 * 이 파일은 React Native 에 의존하지 않는 순수 타입입니다(테스트에서 그대로 사용).
 */

/** 재료 종류 (SPEC §3.1) */
export type Category =
  | 'spirit'
  | 'liqueur'
  | 'wine'
  | 'syrup'
  | 'juice'
  | 'soda'
  | 'dairy'
  | 'water'
  | 'other';

export const CATEGORIES: Category[] = [
  'spirit',
  'liqueur',
  'wine',
  'syrup',
  'juice',
  'soda',
  'dairy',
  'water',
  'other',
];

/** 펌프 슬롯에 장착된 재료 */
export interface PumpSlot {
  /** 펌프 번호 (1부터 시작, 펌프 1 = 릴레이 CH1 = GPIO26) */
  pump: number;
  /** 재료 이름. 빈 문자열이면 비어 있는 슬롯 */
  name: string;
  category: Category;
  /** 알코올 도수(%) */
  abv: number;
  /** 용기 용량(ml) */
  capacityMl: number;
  /** 남은 양(ml) */
  remainingMl: number;
  /** 화면 표시 색상 (#RRGGBB) */
  color: string;
  notes: string;
  /** 재료 변경 후 캘리브레이션 권장 표시 */
  needsCal?: boolean;
  updatedAt: number;
}

export type Strength = 'none' | 'light' | 'medium' | 'strong';

export interface Taste {
  sweet: number;
  sour: number;
  bitter: number;
  fizzy: number;
}

export interface WeatherInfo {
  condition: string;
  tempC?: number;
  humidity?: number;
  /** 'auto' = 위치 기반 자동, 'manual' = 사용자가 직접 선택 */
  source?: 'auto' | 'manual';
  place?: string;
}

/** 사용자가 홈 화면에서 입력하는 값 */
export interface UserInput {
  moods: string[];
  taste: Taste;
  strength: Strength;
  weather: WeatherInfo | null;
  situation: string;
  preference: string;
  cupMl: number;
}

/** AI 서버로 보내는 재료 정보 (SPEC §3.1 ingredients[]) */
export interface IngredientInfo {
  pump: number;
  name: string;
  category: Category;
  abv: number;
  remainingMl: number;
  notes: string;
}

/**
 * AI 요청에 넣는 이전 기록 (SPEC §3.1 history, 최신 기록부터 최대 10개 — 서버는 앞에서 10개 사용)
 * - liked=true  : 👍 좋아요
 * - liked=false, rejected=false : 제조 후 👎 별로예요
 * - liked=false, rejected=true  : 레시피 화면에서 "다른 추천"(거절) — 같은 재료 조합을 피함 (SPEC §5.3)
 */
export interface HistoryHint {
  name: string;
  liked: boolean;
  rejected: boolean;
  ingredients: { name: string; ml: number }[];
}

/** 추천 모드 (SPEC §5.4) — normal: 지금 재료로 / explore: 새 재료 1개(최대 2개)를 장착하면 만들 수 있는 레시피 */
export type RecommendMode = 'normal' | 'explore';

/** POST {AI_SERVER}/api 요청 본문 (SPEC §3.1) */
export interface RecipeRequest {
  version: 2;
  user: {
    moods: string[];
    taste: Taste;
    strength: Strength;
    weather: { condition: string; tempC?: number; humidity?: number } | null;
    situation: string;
    preference: string;
    cupMl: number;
    /**
     * 만 19세 이상 확인을 마쳤는지 (설정의 성인 확인 값, SPEC §3.1). false 면
     *  - 탐색 제안에서 술을 새로 장착하라는 항목을 빼요 (§5.4)
     *  - 레시피 suggestions 에서도 술 add_ingredient/substitute 제안을 지워요 — 무알콜(strength=none)과 같은 판정,
     *    AI·서버 fallback·오프라인 모두 (§3.2)
     *  - 규칙기반 문구(오프라인 추천·직접 Gemini 프롬프트의 안내)도 술 장착을 권하지 않아요 (§3.2)
     * 실제 주류 제조는 제조 직전에 따로 확인합니다.
     */
    adultVerified: boolean;
  };
  ingredients: IngredientInfo[];
  history: HistoryHint[];
  mode: RecommendMode;
}

export interface RecipeIngredient {
  pump: number;
  name: string;
  ml: number;
}

export type SuggestionType = 'add_ingredient' | 'substitute' | 'low_stock' | 'info';

export interface Suggestion {
  type: SuggestionType;
  message: string;
  ingredient?: string;
  pump?: number;
}

export interface Flavor {
  sweet: number;
  sour: number;
  bitter: number;
  fizzy: number;
  strength: number;
}

export interface Recipe {
  name: string;
  /** 영어 이름 (선택) */
  nameEn?: string;
  description: string;
  reason: string;
  ingredients: RecipeIngredient[];
  totalMl: number;
  estimatedAbv: number;
  flavor: Flavor;
  garnish: string;
  tips: string;
  suggestions: Suggestion[];
}

/**
 * 레시피 출처
 * - gemini: 서버(백엔드)가 Gemini 로 생성
 * - fallback: 서버가 자체 규칙으로 생성(서버 측 대체)
 * - direct: 앱이 Gemini 를 직접 호출
 * - offline: 앱 내장 규칙기반 추천
 */
export type RecipeSource = 'gemini' | 'fallback' | 'direct' | 'offline';

/** 탐색(explore) 항목의 재료 — installed·pump 는 앱이 이름 일치로 다시 계산 (SPEC §5.4) */
export interface ExploreIngredient {
  name: string;
  ml: number;
  installed: boolean;
  /** 장착된 재료면 그 펌프 번호 */
  pump?: number;
}

/** 탐색(explore) 항목 — "이 재료를 장착하면 이런 레시피를 만들 수 있어요" */
export interface ExploreItem {
  /** 새로 장착할 재료 이름 */
  addIngredient: string;
  category: Category;
  abv: number;
  recipeName: string;
  description: string;
  ingredients: ExploreIngredient[];
  message: string;
}

export interface RecipeResult {
  /** explore 모드에서 사용할 수 있는 재료가 없으면 null (SPEC §5.4) */
  recipe: Recipe | null;
  /** 탐색 제안 (normal 모드 0~1개, explore 모드 1~3개) */
  explore: ExploreItem[];
  mode: RecommendMode;
  source: RecipeSource;
  model?: string;
  /** 정규화 과정에서 바뀐 내용 / 대체 사유 */
  warnings: string[];
  /** AI 호출 실패로 오프라인 추천을 썼다면 그 원인 */
  fallbackReason?: string;
  /** 서버 fallback 사유 코드 (SPEC §3.2 warningCode: NO_API_KEY·TIMEOUT·RATE_LIMIT…) — 진단용 */
  warningCode?: string;
  /** 오프라인으로 바뀐 원인이 AI 응답 시간 초과인지 (안내 문구 구분용) */
  timedOut?: boolean;
}

/** 기기 배출 모드 */
export type DispenseMode = 'seq' | 'par';

export type AiMode = 'server' | 'direct' | 'offline';
