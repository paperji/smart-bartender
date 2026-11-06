import { Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { colors, type as typo } from '@/constants/theme';

export type TextVariant = keyof typeof typo;
export type TextTone = 'default' | 'secondary' | 'muted' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'onPrimary' | 'disabled';

const toneColor: Record<TextTone, string> = {
  default: colors.text,
  secondary: colors.textSecondary,
  muted: colors.textMuted,
  primary: colors.primary,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
  onPrimary: colors.onPrimary,
  disabled: colors.textDisabled,
};

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  color?: string;
  align?: TextStyle['textAlign'];
  weight?: TextStyle['fontWeight'];
}

export function AppText({ variant = 'body', tone = 'default', color, align, weight, style, ...rest }: AppTextProps) {
  return (
    <RNText
      {...rest}
      style={[
        typo[variant],
        { color: color ?? toneColor[tone] },
        align ? { textAlign: align } : null,
        weight ? { fontWeight: weight } : null,
        style,
      ]}
    />
  );
}
