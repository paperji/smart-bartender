/**
 * 성인 인증 — 주류(abv>0)가 들어간 레시피를 처음 제조할 때 1회 확인 + 음주 경고
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, StyleSheet, View } from 'react-native';
import { create } from 'zustand';

import { colors, radius, space } from '@/constants/theme';
import { useSettings } from '@/store/settings';

import { Button } from './ui/Button';
import { AppText } from './ui/Text';

interface GateState {
  visible: boolean;
  resolve: ((ok: boolean) => void) | null;
}
const useGate = create<GateState>()(() => ({ visible: false, resolve: null }));

/** 성인 확인이 필요하면 모달을 띄우고 결과를 돌려줍니다 */
export function ensureAdult(): Promise<boolean> {
  if (useSettings.getState().adultVerifiedAt) return Promise.resolve(true);
  return new Promise((resolve) => useGate.setState({ visible: true, resolve }));
}

export function AdultGateHost() {
  const { visible, resolve } = useGate();
  const close = (ok: boolean) => {
    if (ok) useSettings.getState().set({ adultVerifiedAt: Date.now() });
    useGate.setState({ visible: false, resolve: null });
    resolve?.(ok);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => close(false)} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.icon}>
            <Ionicons name="wine" size={28} color={colors.primary} />
          </View>
          <AppText variant="title" align="center">
            만 19세 이상이신가요?
          </AppText>
          <AppText variant="body" tone="secondary" align="center">
            이 레시피에는 알코올이 들어 있어요. 성인 확인 후에 제조할 수 있어요.
          </AppText>
          <View style={styles.warn}>
            {[
              '미성년자에게 술을 제공하는 것은 법으로 금지되어 있어요.',
              '음주 후에는 절대 운전하지 마세요. (음주운전은 범죄입니다)',
              '임신 중이거나 약을 복용 중이라면 음주를 삼가 주세요.',
              '지나친 음주는 건강을 해칩니다.',
            ].map((t) => (
              <View key={t} style={styles.warnRow}>
                <Ionicons name="alert-circle" size={16} color={colors.warning} style={{ marginTop: 2 }} />
                <AppText variant="caption" tone="secondary" style={{ flex: 1 }}>
                  {t}
                </AppText>
              </View>
            ))}
          </View>
          <Button label="네, 만 19세 이상입니다" size="lg" full onPress={() => close(true)} />
          <Button label="아니요" variant="ghost" full onPress={() => close(false)} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: space.lg },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    gap: space.md,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  warn: { backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: space.md, gap: space.sm },
  warnRow: { flexDirection: 'row', gap: space.sm },
});
