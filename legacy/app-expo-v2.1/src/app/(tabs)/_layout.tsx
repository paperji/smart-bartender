import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IconName } from '@/components/ui/Button';
import { colors } from '@/constants/theme';
import { useDevice } from '@/store/device';
import { isLowStock, useSlots } from '@/store/slots';

function icon(name: IconName, outline: IconName) {
  return ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
    <Ionicons name={focused ? name : outline} size={size} color={color as string} />
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const lowCount = useSlots((s) => s.slots.filter(isLowStock).length);
  const conn = useDevice((s) => s.conn);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.border,
          minHeight: 60 + insets.bottom,
        },
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: '바텐더', tabBarIcon: icon('sparkles', 'sparkles-outline') }} />
      <Tabs.Screen
        name="ingredients"
        options={{
          title: '재료',
          tabBarIcon: icon('beaker', 'beaker-outline'),
          tabBarBadge: lowCount > 0 ? lowCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.warning, color: colors.onPrimary, fontSize: 11 },
        }}
      />
      <Tabs.Screen name="history" options={{ title: '기록', tabBarIcon: icon('time', 'time-outline') }} />
      <Tabs.Screen
        name="device"
        options={{
          title: '기기',
          tabBarIcon: icon('bluetooth', 'bluetooth-outline'),
          tabBarBadge: conn === 'disconnected' ? '!' : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, color: '#fff', fontSize: 11 },
        }}
      />
    </Tabs>
  );
}
