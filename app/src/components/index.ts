/**
 * 공용 도메인 컴포넌트 — 여러 화면이 같이 쓰는 칵테일·펌프 전용 조각 (사용법: src/components/README.md, 모아 보기: #/ui 아래쪽)
 *   import { RecipeBar, FlavorBars, ExploreCard, PumpCard, PumpNumber, CalibrationBanner } from '@/components';
 */
import './components.css';

export { CalibrationBanner, CalibrationNotice, calibratePath, resetCalibrationBanner, type CalibrationBannerProps, type CalibrationNoticeProps } from './CalibrationBanner';
export { CATEGORY_ICONS, categoryIcon } from './categoryIcon';
export { colorFor, edgeColor, FALLBACK_COLOR, isLightColor, luminance, sharePct, withAlpha } from './color';
export { ColorProgress, type ColorProgressProps } from './ColorProgress';
export { AppErrorBoundary, ScreenBoundary } from './ErrorBoundary';
export { ExploreCard, pumpPickText, usePumpPick, type ExploreCardProps } from './ExploreCard';
export { FLAVOR_ITEMS, FlavorBars, type FlavorBarsProps } from './FlavorBars';
export { PumpCard, PumpNumber, type PumpCardProps, type PumpNumberProps } from './PumpCard';
export { RecipeBar, type RecipeBarProps } from './RecipeBar';
