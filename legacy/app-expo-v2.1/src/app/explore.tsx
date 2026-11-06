/**
 * 새 재료 탐색 화면 (explore 모드 결과, SPEC §5.4)
 * - 탐색 카드 1~3개: 레시피 이름·설명·재료(미장착 재료 강조)·메시지 + "펌프 N에 장착하기"
 * - 함께 온 "지금 재료로 만들 수 있는 레시피"(있으면) 바로가기
 * - 다시 탐색 (다른 새 재료)
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExploreCard } from '@/components/ExploreCard';
import { Button, type IconName } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, Banner } from '@/components/ui/feedback';
import { EmptyState, Row, Screen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/Text';
import { colors, MAX_CONTENT_WIDTH, space } from '@/constants/theme';
import { openInstall, recommendAndShow } from '@/lib/flow';
import type { RecipeSource } from '@/lib/types';
import { fmtMl } from '@/lib/ui';
import { useSession } from '@/store/draft';
import { installedSlots, useSlots } from '@/store/slots';

const SOURCE_BADGE: Record<RecipeSource, { label: string; tone: 'primary' | 'warning' | 'info'; icon: IconName }> = {
  gemini: { label: 'Gemini AI 추천', tone: 'primary', icon: 'sparkles' },
  direct: { label: 'Gemini 직접 추천', tone: 'primary', icon: 'key' },
  fallback: { label: '서버 기본 추천', tone: 'info', icon: 'server' },
  offline: { label: '오프라인 추천', tone: 'warning', icon: 'cloud-offline' },
};

export default function ExploreScreen() {
  const ex = useSession((s) => s.explore);
  const current = useSession((s) => s.current);
  const slots = useSlots((s) => s.slots);
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  if (!ex) {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="compass-outline"
          title="탐색 결과가 없어요"
          message="바텐더 탭에서 '새 재료 탐색'을 눌러 보세요."
          action={<Button label="바텐더로 가기" onPress={() => router.navigate('/')} />}
        />
      </Screen>
    );
  }

  const badge = SOURCE_BADGE[ex.source];
  const installedCount = installedSlots(slots).length;

  const again = async () => {
    setBusy(true);
    try {
      const round = ex.round + 1;
      await recommendAndShow(
        { input: ex.input, mode: 'explore', exploreRound: round, variation: round * 7919 + Math.floor(Math.random() * 1000) },
        { round, nav: 'none' },
      );
    } finally {
      setBusy(false);
    }
  };

  const showRecipe = () => {
    if (!ex.recipe) return;
    // 탐색 결과와 함께 온 레시피를 현재 레시피로 (이미 같으면 그대로)
    if (!current || current.recipe !== ex.recipe) {
      useSession.getState().setCurrent({
        recipe: ex.recipe,
        explore: [],
        mode: 'normal',
        source: ex.source,
        model: ex.model,
        warnings: [],
        fallbackReason: ex.fallbackReason,
        createdAt: Date.now(),
        input: ex.input,
        variation: 0,
      });
    }
    router.dismissTo('/recipe');
  };

  return (
    <Screen
      edges={[]}
      footer={
        <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
          <View style={styles.footerInner}>
            <Button variant="secondary" icon="refresh" label="다시 탐색" onPress={again} loading={busy} style={{ flex: 1 }} />
            <Button variant="ghost" icon="home" label="바텐더로" onPress={() => router.navigate('/')} style={{ flex: 1 }} />
          </View>
        </View>
      }>
      <View style={{ gap: space.sm }}>
        <Row style={{ flexWrap: 'wrap' }}>
          <Badge label={badge.label} tone={badge.tone} icon={badge.icon} />
          <Badge label="탐색 모드" tone="info" icon="compass" />
        </Row>
        <AppText variant="display">새 재료로 색다르게</AppText>
        <AppText variant="body" tone="secondary">
          재료 1개만 새로 장착하면 만들 수 있는 레시피예요. 마음에 드는 카드에서 "펌프에 장착하기"를 누르면 재료 설정 화면이 열리고,
          저장하면 바로 그 레시피를 다시 추천해 드려요.
        </AppText>
      </View>

      {ex.fallbackReason && ex.source === 'offline' ? (
        <Banner
          tone="warning"
          title="AI 대신 오프라인 추천을 사용했어요"
          message={`인터넷 또는 AI 서버 문제로 앱에 내장된 규칙으로 골랐어요. (${ex.fallbackReason.slice(0, 120)})`}
        />
      ) : null}
      {ex.warnings.length ? <Banner tone="info" message={ex.warnings.slice(0, 4).join('\n')} /> : null}

      {ex.items.length === 0 ? (
        <Banner tone="info" title="지금은 추천할 새 재료가 없어요" message="맛 취향이나 도수를 바꿔 다시 탐색해 보세요." />
      ) : (
        <View style={{ gap: space.lg }}>
          {ex.items.map((item) => (
            <ExploreCard key={item.addIngredient} item={item} onInstall={openInstall} />
          ))}
        </View>
      )}

      {ex.recipe ? (
        <Card onPress={showRecipe} accessibilityLabel="지금 재료로 만들 수 있는 레시피 보기">
          <Row style={{ gap: space.md }}>
            <Ionicons name="wine" size={24} color={colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="label" tone="secondary">
                새 재료 없이 지금 재료로는
              </AppText>
              <AppText variant="bodyStrong" numberOfLines={2}>
                {ex.recipe.name}
              </AppText>
              <AppText variant="caption" tone="muted">
                {fmtMl(ex.recipe.totalMl)} · {ex.recipe.estimatedAbv > 0 ? `도수 ${ex.recipe.estimatedAbv}%` : '무알콜'} · 눌러서 보기
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Row>
        </Card>
      ) : installedCount === 0 && !ex.warnings.length ? (
        <Banner
          tone="neutral"
          icon="information-circle"
          message="지금은 장착된 재료가 없어서 새 재료만으로 만드는 레시피를 골랐어요. 카드의 재료를 펌프에 넣어 보세요."
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  footerInner: { flexDirection: 'row', gap: space.sm, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
});
