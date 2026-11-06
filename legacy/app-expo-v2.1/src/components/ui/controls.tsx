import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, space, TOUCH } from '@/constants/theme';
import { haptic } from '@/lib/ui';

import type { IconName } from './Button';
import { AppText } from './Text';

// ───────────────────────── 세그먼트 ─────────────────────────

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  caption?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.segment, style]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: !!o.disabled }}
            accessibilityLabel={o.label}
            disabled={o.disabled}
            onPress={() => {
              haptic.tap();
              onChange(o.value);
            }}
            style={({ pressed }) => [
              styles.segItem,
              active ? styles.segActive : pressed ? { backgroundColor: colors.cardPressed } : null,
              o.disabled ? { opacity: 0.35 } : null,
            ]}>
            <AppText variant="label" color={active ? colors.onPrimary : colors.textSecondary} numberOfLines={1}>
              {o.label}
            </AppText>
            {o.caption ? (
              <AppText variant="small" color={active ? colors.onPrimary : colors.textMuted} numberOfLines={1}>
                {o.caption}
              </AppText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ───────────────────────── 0~5 단계 선택 (맛) ─────────────────────────

const LEVEL_WORDS = ['없음', '아주 약하게', '약하게', '보통', '강하게', '아주 강하게'];

export function LevelSelector({
  label,
  value,
  onChange,
  color = colors.primary,
  icon,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color?: string;
  icon?: IconName;
}) {
  return (
    <View style={styles.level}>
      <View style={styles.levelHead}>
        <View style={styles.levelLabel}>
          {icon ? <Ionicons name={icon} size={16} color={color} /> : null}
          <AppText variant="label">{label}</AppText>
        </View>
        <AppText variant="caption" tone="secondary">
          {value} · {LEVEL_WORDS[value] ?? ''}
        </AppText>
      </View>
      <View style={styles.levelRow} accessibilityRole="adjustable" accessibilityLabel={`${label} ${value}단계`}>
        {[0, 1, 2, 3, 4, 5].map((n) => {
          const on = n <= value && value > 0 && n > 0;
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${n}단계`}
              onPress={() => {
                haptic.tap();
                onChange(n);
              }}
              hitSlop={{ top: 8, bottom: 8 }}
              style={({ pressed }) => [
                styles.levelCell,
                n === 0 ? styles.levelZero : null,
                {
                  backgroundColor: on ? color : n === 0 && value === 0 ? colors.borderStrong : colors.cardAlt,
                  borderColor: on ? color : colors.border,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}>
              {n === 0 ? (
                <Ionicons name="remove" size={14} color={value === 0 ? colors.text : colors.textMuted} />
              ) : (
                <AppText variant="small" color={on ? colors.onPrimary : colors.textMuted}>
                  {n}
                </AppText>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ───────────────────────── 스테퍼 ─────────────────────────

export function Stepper({
  value,
  onChange,
  min,
  max,
  step,
  unit,
  presets,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  presets?: number[];
  format?: (v: number) => string;
}) {
  const set = (v: number) => {
    const n = Math.max(min, Math.min(max, Math.round(v / step) * step));
    if (n !== value) {
      haptic.tap();
      onChange(Math.round(n * 100) / 100);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.stepper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="줄이기"
          disabled={value <= min}
          onPress={() => set(value - step)}
          style={({ pressed }) => [styles.stepBtn, { opacity: value <= min ? 0.35 : pressed ? 0.7 : 1 }]}>
          <Ionicons name="remove" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.stepValue}>
          <AppText variant="title">{format ? format(value) : value}</AppText>
          {unit ? (
            <AppText variant="label" tone="secondary">
              {unit}
            </AppText>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="늘리기"
          disabled={value >= max}
          onPress={() => set(value + step)}
          style={({ pressed }) => [styles.stepBtn, { opacity: value >= max ? 0.35 : pressed ? 0.7 : 1 }]}>
          <Ionicons name="add" size={22} color={colors.text} />
        </Pressable>
      </View>
      {presets?.length ? (
        <View style={styles.presetRow}>
          {presets.map((p) => (
            <Pressable
              key={p}
              accessibilityRole="button"
              accessibilityLabel={`${p}${unit ?? ''}`}
              onPress={() => set(p)}
              style={({ pressed }) => [
                styles.preset,
                p === value ? { borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft } : null,
                pressed ? { opacity: 0.7 } : null,
              ]}>
              <AppText variant="small" color={p === value ? colors.text : colors.textSecondary}>
                {p}
                {unit}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ───────────────────────── 스위치 행 ─────────────────────────

export function SwitchRow({
  title,
  description,
  value,
  onChange,
  disabled,
}: {
  title: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={title}
      disabled={disabled}
      onPress={() => {
        haptic.tap();
        onChange(!value);
      }}
      style={styles.switchRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        {description ? (
          <AppText variant="caption" tone="muted">
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          haptic.tap();
          onChange(v);
        }}
        disabled={disabled}
        trackColor={{ false: colors.borderStrong, true: colors.primary }}
        thumbColor={value ? '#FFF4EA' : '#C9CEDA'}
        {...({ activeThumbColor: '#FFF4EA' } as object)}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  segItem: {
    flex: 1,
    minHeight: TOUCH - 4,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  segActive: { backgroundColor: colors.primary },
  level: { gap: space.sm },
  levelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  levelLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  levelRow: { flexDirection: 'row', gap: 6 },
  levelCell: {
    flex: 1,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelZero: { flex: 0.8 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
  },
  stepBtn: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  presetRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  preset: {
    paddingHorizontal: 12,
    minHeight: 34,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardAlt,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TOUCH + 8,
    paddingVertical: space.sm,
  },
});
