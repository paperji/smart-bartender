import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, NATIVE_DRIVER, radius, space } from '@/constants/theme';
import { useToast } from '@/store/toast';

import type { IconName } from './Button';
import { AppText } from './Text';

/** 진행 막대 (부드럽게 채워짐) */
export function ProgressBar({
  value,
  color = colors.primary,
  height = 8,
  track = colors.cardAlt,
  style,
}: {
  value: number; // 0~1
  color?: string;
  height?: number;
  track?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const anim = useRef(new Animated.Value(Math.max(0, Math.min(1, value)))).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: Math.max(0, Math.min(1, value)),
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [value, anim]);
  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }, style]}>
      <Animated.View
        style={{
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: color,
          width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
}

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
const toneMap: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.cardAlt, fg: colors.textSecondary },
  primary: { bg: colors.primarySoft, fg: colors.primary },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  info: { bg: colors.infoSoft, fg: colors.info },
};

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = toneMap[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={t.fg} /> : null}
      <AppText variant="small" color={t.fg} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

/** 안내 배너 */
export function Banner({
  tone = 'info',
  icon,
  title,
  message,
  action,
  style,
}: {
  tone?: Tone;
  icon?: IconName;
  title?: string;
  message: string;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = toneMap[tone];
  const defaultIcon: IconName =
    tone === 'danger' ? 'alert-circle' : tone === 'warning' ? 'warning' : tone === 'success' ? 'checkmark-circle' : 'information-circle';
  return (
    <View style={[styles.banner, { backgroundColor: t.bg, borderColor: t.fg + '55' }, style]}>
      <Ionicons name={icon ?? defaultIcon} size={20} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <AppText variant="label" color={t.fg}>
            {title}
          </AppText>
        ) : null}
        <AppText variant="caption" tone="secondary">
          {message}
        </AppText>
        {action ? <View style={{ marginTop: space.sm, alignSelf: 'flex-start' }}>{action}</View> : null}
      </View>
    </View>
  );
}

/** 화면 하단 토스트 (루트 레이아웃에 1개) */
export function ToastHost() {
  const { message, kind, key, hide } = useToast();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!message) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: NATIVE_DRIVER }).start();
    const t = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: NATIVE_DRIVER }).start(() => hide());
    }, 2800);
    return () => clearTimeout(t);
  }, [key, message, anim, hide]);
  if (!message) return null;
  const tone: Tone = kind === 'error' ? 'danger' : kind === 'success' ? 'success' : kind === 'warning' ? 'warning' : 'info';
  const icon: IconName =
    kind === 'error' ? 'alert-circle' : kind === 'success' ? 'checkmark-circle' : kind === 'warning' ? 'warning' : 'information-circle';
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.toastWrap,
        { bottom: insets.bottom + 92, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
      ]}>
      <Pressable onPress={hide} style={styles.toast} accessibilityRole="alert">
        <Ionicons name={icon} size={20} color={toneMap[tone].fg} />
        <AppText variant="label" style={{ flex: 1 }}>
          {message}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}

/** 로딩 중 점 3개 애니메이션 */
export function PulseDots({ color = colors.primary }: { color?: string }) {
  const a = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loops = a.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(v, { toValue: 1, duration: 380, useNativeDriver: NATIVE_DRIVER }),
          Animated.timing(v, { toValue: 0.3, duration: 380, useNativeDriver: NATIVE_DRIVER }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [a]);
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {a.map((v, i) => (
        <Animated.View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity: v }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  banner: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  toastWrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.cardAlt,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    maxWidth: 560,
    width: '100%',
  },
});
