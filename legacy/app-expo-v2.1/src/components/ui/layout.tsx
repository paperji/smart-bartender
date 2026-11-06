import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, MAX_CONTENT_WIDTH, radius, space } from '@/constants/theme';

import type { IconName } from './Button';
import { AppText } from './Text';

/** 화면 기본 틀: 어두운 배경 + 스크롤 + 최대 폭 제한(태블릿/웹) */
export function Screen({
  children,
  scroll = true,
  header,
  footer,
  contentStyle,
  edges = ['top'],
  refreshControl,
  keyboard,
}: {
  children: ReactNode;
  scroll?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: ('top' | 'bottom')[];
  refreshControl?: ScrollViewProps['refreshControl'];
  keyboard?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const padTop = edges.includes('top') ? insets.top : 0;
  const padBottom = edges.includes('bottom') ? insets.bottom : 0;
  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingBottom: space.xxxl + padBottom }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}>
      <View style={styles.inner}>{children}</View>
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.content, contentStyle]}>
      <View style={[styles.inner, styles.flex]}>{children}</View>
    </View>
  );
  return (
    <View style={[styles.root, { paddingTop: padTop }]}>
      {header}
      {keyboard ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
      {footer}
    </View>
  );
}

/** 섹션 제목 */
export function Section({
  title,
  subtitle,
  right,
  children,
  icon,
  style,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.section, style]}>
      <View style={styles.sectionHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.titleRow}>
            {icon ? <Ionicons name={icon} size={18} color={colors.primary} /> : null}
            <AppText variant="heading">{title}</AppText>
          </View>
          {subtitle ? (
            <AppText variant="caption" tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>
      <AppText variant="heading" align="center">
        {title}
      </AppText>
      {message ? (
        <AppText variant="body" tone="muted" align="center" style={{ maxWidth: 320 }}>
          {message}
        </AppText>
      ) : null}
      {action ? <View style={{ marginTop: space.sm }}>{action}</View> : null}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingTop: space.md },
  inner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', gap: space.xl },
  section: { gap: space.md },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
