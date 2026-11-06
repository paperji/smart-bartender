import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

import { colors, NATIVE_DRIVER, radius } from '@/constants/theme';
import { useDevice, type ConnState } from '@/store/device';

import { AppText } from './ui/Text';

export function connLabel(conn: ConnState, kind: string): { text: string; color: string } {
  switch (conn) {
    case 'connected':
      return { text: kind === 'demo' ? '데모 기기 연결됨' : '기기 연결됨', color: colors.success };
    case 'connecting':
      return { text: '연결 중…', color: colors.warning };
    case 'reconnecting':
      return { text: '다시 연결 중…', color: colors.warning };
    case 'scanning':
      return { text: '기기 찾는 중…', color: colors.info };
    case 'disconnected':
      return { text: '연결 끊김', color: colors.danger };
    default:
      return { text: '기기 미연결', color: colors.textMuted };
  }
}

/** 홈 상단의 기기 연결 상태 칩 — 누르면 기기 탭으로 이동 */
export function DeviceChip() {
  const conn = useDevice((s) => s.conn);
  const kind = useDevice((s) => s.transportKind);
  const name = useDevice((s) => s.deviceName);
  const { text, color } = connLabel(conn, kind);
  const pulse = useRef(new Animated.Value(1)).current;
  const busy = conn === 'connecting' || conn === 'reconnecting' || conn === 'scanning';
  useEffect(() => {
    if (!busy) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 500, useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, pulse]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text}. 기기 탭으로 이동`}
      onPress={() => router.navigate('/device')}
      style={({ pressed }) => [styles.chip, { borderColor: color + '66', opacity: pressed ? 0.8 : 1 }]}>
      <Animated.View style={[styles.dot, { backgroundColor: color, opacity: pulse }]} />
      <AppText variant="small" color={colors.text} numberOfLines={1} style={{ maxWidth: 150 }}>
        {conn === 'connected' && name ? name : text}
      </AppText>
      <Ionicons name={kind === 'demo' ? 'flask-outline' : 'bluetooth'} size={14} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.card,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
