/**
 * 디자인 시스템 토큰 — 색·간격(8pt)·반경·타이포·그림자
 * 무드: 어두운 바(bar) 배경 + 팀 '홍당무'의 캐럿 오렌지 포인트.
 * 보조 색(민트/핑크 등)은 재료 색상에만 사용합니다.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const colors = {
  bg: '#0E1018',
  bgElevated: '#121521',
  card: '#171A24',
  cardAlt: '#1E2230',
  cardPressed: '#232838',
  border: '#2A2F3E',
  borderStrong: '#3A4154',
  overlay: 'rgba(6, 8, 12, 0.72)',

  text: '#F4F5F8',
  textSecondary: '#B4BACA',
  textMuted: '#8A91A5', // 카드 위 대비 약 5:1
  textDisabled: '#5A6074',

  primary: '#FF7A1A', // 캐럿 오렌지
  primaryPressed: '#E8670A',
  primarySoft: 'rgba(255, 122, 26, 0.14)',
  primaryBorder: 'rgba(255, 122, 26, 0.45)',
  onPrimary: '#1B0E04', // 오렌지 위 글자는 어두운 색(대비 7:1 이상)

  success: '#3DDC97',
  successSoft: 'rgba(61, 220, 151, 0.14)',
  warning: '#FFC542',
  warningSoft: 'rgba(255, 197, 66, 0.14)',
  danger: '#FF4D5E',
  dangerPressed: '#E03A4B',
  dangerSoft: 'rgba(255, 77, 94, 0.14)',
  info: '#6CB8FF',
  infoSoft: 'rgba(108, 184, 255, 0.14)',
} as const;

/** 8pt 그리드 */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** 최소 터치 영역 (Android 48dp / iOS 44pt) */
export const TOUCH = 48;

const fontFamily = Platform.select({ web: 'system-ui, -apple-system, "Segoe UI", "Noto Sans KR", "Malgun Gothic", sans-serif', default: undefined });

export const type = {
  display: { fontSize: 28, lineHeight: 36, fontWeight: '800', letterSpacing: -0.5, fontFamily },
  title: { fontSize: 22, lineHeight: 30, fontWeight: '700', letterSpacing: -0.3, fontFamily },
  heading: { fontSize: 18, lineHeight: 26, fontWeight: '700', fontFamily },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400', fontFamily },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600', fontFamily },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600', fontFamily },
  caption: { fontSize: 13, lineHeight: 19, fontWeight: '400', fontFamily },
  small: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontFamily },
  number: { fontSize: 32, lineHeight: 38, fontWeight: '800', fontFamily, fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export const shadow = {
  card: Platform.select<ViewStyle>({
    android: { elevation: 2 },
    web: { boxShadow: '0 4px 18px rgba(0,0,0,0.28)' } as ViewStyle,
    default: { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  }),
  glow: Platform.select<ViewStyle>({
    android: { elevation: 6 },
    web: { boxShadow: '0 8px 24px rgba(255,122,26,0.35)' } as ViewStyle,
    default: { shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  }),
};

export const MAX_CONTENT_WIDTH = 720;

/** 웹에는 네이티브 애니메이션 드라이버가 없음 */
export const NATIVE_DRIVER = Platform.OS !== 'web';

export const navTheme = {
  dark: true,
  colors: {
    primary: colors.primary,
    background: colors.bg,
    card: colors.bgElevated,
    text: colors.text,
    border: colors.border,
    notification: colors.primary,
  },
};
