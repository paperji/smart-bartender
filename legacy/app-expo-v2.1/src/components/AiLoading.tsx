/**
 * AI 추천 중 전체 화면 로딩 (루트 레이아웃에 1개) — 홈 · 레시피 · 제조 완료 · 탐색 화면이 함께 사용
 * 10초가 넘으면 "조금 오래 걸리고 있어요" 안내 (서버가 AI 를 다시 부르는 중일 수 있음, 최대 약 50초)
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { create } from 'zustand';

import { colors, radius, space } from '@/constants/theme';

import { PulseDots } from './ui/feedback';
import { AppText } from './ui/Text';

interface BusyState {
  busy: boolean;
  title: string;
  lines: string[];
}

const NORMAL_LINES = [
  '기분과 취향을 분석하고 있어요',
  '장착된 재료를 살펴보는 중이에요',
  '황금 비율을 계산하고 있어요',
  '레시피 이름을 짓고 있어요',
];
/** 이 시간이 지나면 "오래 걸리는 중" 안내 */
const SLOW_AFTER_MS = 10000;

const EXPLORE_LINES = [
  '지금 재료와 어울리는 새 재료를 찾는 중이에요',
  '펌프 하나만 바꿔도 되는 조합을 고르고 있어요',
  '새 레시피를 설계하고 있어요',
];

export const useAiBusy = create<BusyState>()(() => ({ busy: false, title: '', lines: NORMAL_LINES }));

/** fn 이 끝날 때까지 로딩 화면 표시 */
export async function withAiBusy<T>(fn: () => Promise<T>, kind: 'normal' | 'explore' = 'normal'): Promise<T> {
  useAiBusy.setState({
    busy: true,
    title: kind === 'explore' ? 'AI 바텐더가 새 재료를 찾고 있어요' : 'AI 바텐더가 레시피를 고민 중이에요',
    lines: kind === 'explore' ? EXPLORE_LINES : NORMAL_LINES,
  });
  try {
    return await fn();
  } finally {
    useAiBusy.setState({ busy: false });
  }
}

export function AiLoadingHost() {
  const { busy, title, lines } = useAiBusy();
  const [idx, setIdx] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) return;
    setIdx(0);
    setSlow(false);
    const t = setInterval(() => setIdx((i) => (i + 1) % lines.length), 1600);
    const s = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearInterval(t);
      clearTimeout(s);
    };
  }, [busy, lines]);
  return (
    <Modal visible={busy} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityLiveRegion="polite">
          <View style={styles.icon}>
            <Ionicons name="sparkles" size={30} color={colors.primary} />
          </View>
          <AppText variant="heading" align="center">
            {title}
          </AppText>
          <AppText variant="body" tone="secondary" align="center">
            {lines[idx % lines.length]}
          </AppText>
          {slow ? (
            <AppText variant="caption" tone="muted" align="center">
              조금 오래 걸리고 있어요. AI 응답이 늦으면 앱에 내장된 추천으로 바꿔 드릴게요.
            </AppText>
          ) : null}
          <PulseDots />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    gap: space.md,
    alignItems: 'center',
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
