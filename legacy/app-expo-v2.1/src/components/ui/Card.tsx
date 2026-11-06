import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow, space } from '@/constants/theme';
import { haptic } from '@/lib/ui';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  tone?: 'default' | 'alt' | 'primary' | 'warning' | 'danger' | 'success' | 'info';
  dashed?: boolean;
  accessibilityLabel?: string;
}

const toneStyle: Record<NonNullable<CardProps['tone']>, ViewStyle> = {
  default: { backgroundColor: colors.card, borderColor: colors.border },
  alt: { backgroundColor: colors.cardAlt, borderColor: colors.border },
  primary: { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder },
  warning: { backgroundColor: colors.warningSoft, borderColor: 'rgba(255,197,66,0.4)' },
  danger: { backgroundColor: colors.dangerSoft, borderColor: 'rgba(255,77,94,0.45)' },
  success: { backgroundColor: colors.successSoft, borderColor: 'rgba(61,220,151,0.4)' },
  info: { backgroundColor: colors.infoSoft, borderColor: 'rgba(108,184,255,0.4)' },
};

export function Card({ children, onPress, onLongPress, style, padded = true, tone = 'default', dashed, accessibilityLabel }: CardProps) {
  const base = [
    styles.card,
    toneStyle[tone],
    padded ? styles.padded : null,
    dashed ? { borderStyle: 'dashed' as const, borderWidth: 1.5 } : null,
    tone === 'default' ? shadow.card : null,
  ];
  if (!onPress && !onLongPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={
        onPress
          ? () => {
              haptic.tap();
              onPress();
            }
          : undefined
      }
      onLongPress={onLongPress}
      style={({ pressed }) => [base, pressed ? { backgroundColor: colors.cardPressed } : null, style]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  padded: { padding: space.lg },
});
