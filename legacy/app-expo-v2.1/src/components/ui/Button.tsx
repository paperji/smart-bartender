import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow, space, TOUCH } from '@/constants/theme';
import { haptic } from '@/lib/ui';

import { AppText } from './Text';

export type IconName = ComponentProps<typeof Ionicons>['name'];
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  delayLongPress?: number;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  children?: ReactNode;
}

const palette: Record<Variant, { bg: string; bgPressed: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, bgPressed: colors.primaryPressed, fg: colors.onPrimary },
  secondary: { bg: colors.cardAlt, bgPressed: colors.cardPressed, fg: colors.text, border: colors.border },
  outline: { bg: 'transparent', bgPressed: colors.primarySoft, fg: colors.primary, border: colors.primaryBorder },
  ghost: { bg: 'transparent', bgPressed: colors.cardAlt, fg: colors.textSecondary },
  danger: { bg: colors.danger, bgPressed: colors.dangerPressed, fg: '#FFFFFF' },
};

const heights: Record<Size, number> = { sm: 40, md: TOUCH, lg: 58 };

export function Button({
  label,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  delayLongPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading,
  disabled,
  full,
  style,
  accessibilityHint,
}: ButtonProps) {
  const p = palette[variant];
  const isDisabled = disabled || loading;
  const textVariant = size === 'lg' ? 'heading' : size === 'sm' ? 'label' : 'bodyStrong';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      delayLongPress={delayLongPress}
      hitSlop={size === 'sm' ? 4 : 0}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: heights[size],
          paddingHorizontal: size === 'sm' ? space.md : space.lg,
          backgroundColor: pressed ? p.bgPressed : p.bg,
          borderColor: p.border ?? 'transparent',
          borderWidth: p.border ? 1 : 0,
          opacity: isDisabled ? 0.45 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        variant === 'primary' && size === 'lg' && !isDisabled ? shadow.glow : null,
        full ? { alignSelf: 'stretch' } : null,
        style,
      ]}>
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={p.fg} size="small" />
        ) : icon ? (
          <Ionicons name={icon} size={size === 'lg' ? 22 : 18} color={p.fg} />
        ) : null}
        <AppText variant={textVariant} color={p.fg} numberOfLines={1}>
          {label}
        </AppText>
        {iconRight && !loading ? <Ionicons name={iconRight} size={18} color={p.fg} /> : null}
      </View>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  color = colors.textSecondary,
  size = 22,
  bg,
  disabled,
  style,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  color?: string;
  size?: number;
  bg?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.icon,
        { backgroundColor: pressed ? colors.cardPressed : (bg ?? 'transparent'), opacity: disabled ? 0.4 : 1 },
        style,
      ]}>
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
