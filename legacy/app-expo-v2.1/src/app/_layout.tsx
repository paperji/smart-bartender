import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AdultGateHost } from '@/components/AdultGate';
import { AiLoadingHost } from '@/components/AiLoading';
import { ToastHost } from '@/components/ui/feedback';
import { colors } from '@/constants/theme';
import { registerJobEffects } from '@/lib/brew';
import { deviceClient } from '@/lib/device/client';
import { initNotifications } from '@/lib/notify';
import { useDraft } from '@/store/draft';
import { useHistory } from '@/store/history';
import { useSettings } from '@/store/settings';
import { useSlots } from '@/store/slots';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.bgElevated,
    text: colors.text,
    border: colors.border,
    notification: colors.primary,
  },
};

/** 저장된 데이터(AsyncStorage)를 다 불러올 때까지 대기 */
function useHydrated() {
  const stores = [useSlots, useSettings, useHistory, useDraft];
  const [ready, setReady] = useState(() => stores.every((s) => s.persist.hasHydrated()));
  useEffect(() => {
    if (ready) return;
    const check = () => {
      if (stores.every((s) => s.persist.hasHydrated())) setReady(true);
    };
    const unsubs = stores.map((s) => s.persist.onFinishHydration(check));
    check();
    // 저장소 오류 대비 안전 타이머
    const t = setTimeout(() => setReady(true), 2500);
    return () => {
      unsubs.forEach((u) => u());
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  return ready;
}

export default function RootLayout() {
  const ready = useHydrated();
  const demoMode = useSettings((s) => s.demoMode);

  useEffect(() => registerJobEffects(), []);

  // 제조 알림 준비 (안드로이드 채널 'brew'). 권한은 첫 제조 때 요청
  useEffect(() => {
    initNotifications().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => undefined);
    deviceClient.init(demoMode).catch((e) => console.warn('[device] init failed', e));
  }, [ready, demoMode]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '700' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
            headerBackButtonDisplayMode: 'minimal',
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="recipe" options={{ title: '추천 레시피' }} />
          <Stack.Screen name="explore" options={{ title: '새 재료 탐색' }} />
          <Stack.Screen
            name="brewing"
            options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false, animation: 'fade' }}
          />
          <Stack.Screen name="calibrate" options={{ presentation: 'modal', title: '캘리브레이션' }} />
          <Stack.Screen name="ingredient-edit" options={{ presentation: 'modal', title: '재료 설정' }} />
          <Stack.Screen name="settings" options={{ title: '앱 설정' }} />
        </Stack>
        <AdultGateHost />
        <AiLoadingHost />
        <ToastHost />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
