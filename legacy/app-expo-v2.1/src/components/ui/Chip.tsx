import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, space } from '@/constants/theme';
import { haptic } from '@/lib/ui';

import type { IconName } from './Button';
import { AppText } from './Text';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  dotColor?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
  trailingIcon?: IconName;
}

export function Chip({ label, selected, onPress, icon, dotColor, disabled, size = 'md', style, trailingIcon }: ChipProps) {
  const fg = selected ? colors.primary : colors.textSecondary;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled || !onPress}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      hitSlop={size === 'sm' ? 6 : 2}
      style={({ pressed }) => [
        styles.chip,
        size === 'sm' ? styles.sm : styles.md,
        {
          backgroundColor: selected ? colors.primarySoft : pressed ? colors.cardPressed : colors.cardAlt,
          borderColor: selected ? colors.primaryBorder : colors.border,
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}>
      {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      {icon ? <Ionicons name={icon} size={size === 'sm' ? 14 : 16} color={fg} /> : null}
      <AppText variant={size === 'sm' ? 'small' : 'label'} color={selected ? colors.text : colors.textSecondary} numberOfLines={1}>
        {label}
      </AppText>
      {selected && !trailingIcon ? <Ionicons name="checkmark" size={14} color={colors.primary} /> : null}
      {trailingIcon ? <Ionicons name={trailingIcon} size={14} color={fg} /> : null}
    </Pressable>
  );
}

export function ChipRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  md: { minHeight: 40, paddingHorizontal: 14 },
  sm: { minHeight: 32, paddingHorizontal: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
