/**
 * 레시피 화면 — 비율 막대, 재료별 ml 조정, 도수/맛 프로필, 추천 이유, 가니시·팁, 제안 카드
 * - "다른 추천" = 거절: history 에 {liked:false, rejected:true} 로 남겨 다음 추천에서 같은 조합을 피함 (SPEC §5.3)
 * - 연속 2회 거절 시 "새 재료를 장착해 볼까요?" 배너 → 탐색(explore) 모드
 * - normal 모드 응답의 explore(0~1개)는 "새 재료로 이런 것도" 카드로 표시
 * - ml 조정·잔 맞춤 때 다시 검증하면서 빠진 재료(성향 제외·무알콜·잔량 0 등)는 안내 배너에 더하고 토스트로도 알림
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExploreCard } from '@/components/ExploreCard';
import { FlavorBars } from '@/components/FlavorBars';
import { colorFor, RecipeBar } from '@/components/RecipeBar';
import { Button, IconButton, type IconName } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, Banner } from '@/components/ui/feedback';
import { EmptyState, Row, Screen, Section } from '@/components/ui/layout';
import { AppText } from '@/components/ui/Text';
import { colors, MAX_CONTENT_WIDTH, radius, space } from '@/constants/theme';
import { cleanText, normalizeRecipe, revalidateRecipe, STRENGTH_ABV, STRENGTH_KO } from '@/lib/ai/normalize';
import { preferenceExcludedPumps } from '@/lib/ai/preference';
import { slotsToIngredients } from '@/lib/ai/recommend';
import { removalNotes, startBrew } from '@/lib/brew';
import { openInstall, recommendAndShow } from '@/lib/flow';
import { deviceLimits, estimateMakeMs } from '@/lib/protocol';
import type { Recipe, RecipeSource, Suggestion } from '@/lib/types';
import { fmtDuration, fmtMl, haptic } from '@/lib/ui';
import { isBusy, useDevice } from '@/store/device';
import { useSession } from '@/store/draft';
import { isFavorite, useHistory } from '@/store/history';
import { useSettings } from '@/store/settings';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';

const SOURCE_BADGE: Record<RecipeSource, { label: string; tone: 'primary' | 'warning' | 'info' | 'success'; icon: IconName }> = {
  gemini: { label: 'Gemini AI 추천', tone: 'primary', icon: 'sparkles' },
  direct: { label: 'Gemini 직접 추천', tone: 'primary', icon: 'key' },
  fallback: { label: '서버 기본 추천', tone: 'info', icon: 'server' },
  offline: { label: '오프라인 추천', tone: 'warning', icon: 'cloud-offline' },
};

const SUG_ICON: Record<Suggestion['type'], IconName> = {
  add_ingredient: 'add-circle',
  substitute: 'swap-horizontal',
  low_stock: 'warning',
  info: 'information-circle',
};

export default function RecipeScreen() {
  const current = useSession((s) => s.current);
  const setCurrent = useSession((s) => s.setCurrent);
  const slots = useSlots((s) => s.slots);
  const cal = useDevice((s) => s.cal);
  const info = useDevice((s) => s.info);
  const job = useDevice((s) => s.job);
  const rejectStreak = useSession((s) => s.rejectStreak);
  const mode = useSettings((s) => s.dispenseMode);
  const adultVerified = useSettings((s) => !!s.adultVerifiedAt);
  const favorites = useHistory((s) => s.favorites);
  const toggleFavorite = useHistory((s) => s.toggleFavorite);
  const insets = useSafeAreaInsets();
  const [regen, setRegen] = useState(false);
  const [starting, setStarting] = useState(false);

  const r = current?.recipe;
  const etaMs = useMemo(
    () => (r ? estimateMakeMs(r.ingredients.map((i) => ({ p: i.pump, ml: i.ml })), cal, mode) : 0),
    [r, cal, mode],
  );

  if (!current || !r) {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="sparkles-outline"
          title="아직 레시피가 없어요"
          message="바텐더 탭에서 기분과 취향을 입력하고 AI 레시피를 만들어 보세요."
          action={<Button label="바텐더로 가기" onPress={() => router.navigate('/')} />}
        />
      </Screen>
    );
  }

  const limits = deviceLimits(info);
  const ingredients = slotsToIngredients(slots);
  // 성향(알레르기·싫어하는 재료)으로 뺀 재료는 ml 조정·잔 맞춤 때 도수 보정용 재료로도 다시 넣지 않음 (SPEC §3.3 규칙 1·8)
  // 성향 문장은 요청(buildRequest)·서버와 같게 정리한 것으로 판정 (줄바꿈·연속 공백 → 공백 1개, 300자)
  // adultVerified: ml 조정 뒤 다시 검증할 때도 성인 확인 전이면 술 장착·대체 제안을 지움 (SPEC §3.2, 요청과 같은 설정 값)
  const ctx = {
    ingredients,
    strength: current.input.strength,
    maxStepMl: limits.maxStepMl,
    excludePumps: preferenceExcludedPumps(ingredients, cleanText(current.input.preference, 300)),
    adultVerified,
  };
  const fav = isFavorite(favorites, r);
  const badge = SOURCE_BADGE[current.source];
  const cupMl = current.input.cupMl;

  const applyRecipe = (next: Recipe, warnings?: string[]) =>
    setCurrent({ ...current, recipe: next, warnings: warnings ?? current.warnings });

  /**
   * 다시 검증하면서 재료가 빠졌으면(성향 제외·무알콜·잔량 0 등) 그 안내를 기존 안내(서버 보정 문구 등)에 더함 — 안내 없이 사라지지 않게.
   * 반환: 새로 더한 안내 (토스트로도 보여 줌)
   */
  const applyChecked = (before: Recipe, res: ReturnType<typeof revalidateRecipe>): string[] => {
    const notes = removalNotes(before, res).filter((n) => !current.warnings.includes(n));
    applyRecipe(res.recipe, notes.length ? [...current.warnings, ...notes] : undefined);
    return notes;
  };

  const adjust = (pump: number, delta: number) => {
    const total = r.ingredients.reduce((a, b) => a + b.ml, 0);
    const item = r.ingredients.find((i) => i.pump === pump);
    if (!item) return;
    let ml = Math.round((item.ml + delta) * 10) / 10;
    if (ml > limits.maxStepMl) {
      ml = limits.maxStepMl;
      toast(`재료 하나는 최대 ${limits.maxStepMl}ml 까지예요.`, 'warning');
    }
    if (total + (ml - item.ml) > limits.maxTotalMl) {
      toast(`한 잔은 최대 ${limits.maxTotalMl}ml 까지 만들 수 있어요.`, 'warning');
      return;
    }
    if (ml <= 0 && r.ingredients.length === 1) {
      toast('재료가 최소 1개는 있어야 해요.', 'warning');
      return;
    }
    haptic.tap();
    const draft = {
      ...r,
      ingredients: r.ingredients.map((i) => (i.pump === pump ? { ...i, ml: Math.max(0, ml) } : i)),
    };
    try {
      const res = revalidateRecipe(draft, ctx);
      const notes = applyChecked(draft, res);
      const st = current.input.strength;
      const capNote = res.capped ? `'${STRENGTH_KO[st]}'(최대 ${STRENGTH_ABV[st].max}%)를 넘지 않게 술 양을 맞췄어요.` : '';
      if (notes.length) toast([...notes, capNote].filter(Boolean).join(' '), 'warning');
      else if (capNote) toast(capNote, 'info');
    } catch (e: any) {
      toast(e?.message ?? '조정할 수 없어요', 'error');
    }
  };

  const fitToCup = () => {
    try {
      const res = normalizeRecipe(r, { ...ctx, cupMl });
      const notes = applyChecked(r, res);
      // 재료가 빠졌으면 성공 토스트가 그 사실을 가리지 않게 안내를 함께 (경고)
      if (notes.length) toast(`잔 용량 ${cupMl}ml 에 맞췄어요. ${notes.join(' ')}`, 'warning');
      else toast(`잔 용량 ${cupMl}ml 에 맞췄어요.`, 'success');
    } catch (e: any) {
      toast(e?.message ?? '맞출 수 없어요', 'error');
    }
  };

  /** "다른 추천" = 거절 → 기록에 남기고 같은 입력으로 다시 추천 */
  const regenerate = async () => {
    setRegen(true);
    const variation = current.variation + 1;
    useHistory.getState().addRejection(r);
    const streak = useSession.getState().rejectStreak + 1;
    useSession.getState().setRejectStreak(streak);
    try {
      const res = await recommendAndShow(
        { input: current.input, mode: 'normal', variation: variation * 7919 + Math.floor(Math.random() * 1000) },
        { variation, nav: 'none' },
      );
      if (res) {
        haptic.success();
        toast(streak >= 2 ? '마음에 드는 게 없나요? 아래에서 새 재료를 추천해 드릴게요.' : '방금 레시피는 다음 추천에서 피할게요.', 'info');
      }
    } finally {
      setRegen(false);
    }
  };

  /** 연속 거절 → 탐색(explore) 모드 */
  const explore = async () => {
    setRegen(true);
    try {
      const res = await recommendAndShow({ input: current.input, mode: 'explore' }, { round: 0 });
      if (res) useSession.getState().setRejectStreak(0);
    } finally {
      setRegen(false);
    }
  };

  const onStart = async () => {
    setStarting(true);
    try {
      await startBrew();
    } finally {
      setStarting(false);
    }
  };

  const openSuggestion = (s: Suggestion) => {
    if (s.type === 'low_stock' && s.pump) {
      router.push({ pathname: '/ingredient-edit', params: { pump: String(s.pump) } });
      return;
    }
    const empty = slots.find((x) => !x.name);
    if (empty) {
      router.push({ pathname: '/ingredient-edit', params: { pump: String(empty.pump), suggest: s.ingredient ?? '' } });
    } else {
      router.navigate({ pathname: '/ingredients', params: { suggest: s.ingredient ?? '' } });
    }
  };

  const total = r.ingredients.reduce((a, b) => a + b.ml, 0);
  const totalOff = Math.abs(total - cupMl) >= 1;

  return (
    <>
      <Stack.Screen
        options={{
          title: '추천 레시피',
          headerRight: () => (
            <IconButton
              icon={fav ? 'star' : 'star-outline'}
              color={fav ? colors.warning : colors.textSecondary}
              label={fav ? '즐겨찾기 해제' : '즐겨찾기'}
              onPress={() => {
                const added = toggleFavorite(r);
                toast(added ? '즐겨찾기에 추가했어요.' : '즐겨찾기에서 뺐어요.', 'success');
              }}
            />
          ),
        }}
      />
      <Screen
        edges={[]}
        footer={
          <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
            <View style={styles.footerInner}>
              <Button
                variant="secondary"
                icon="refresh"
                label="다른 추천"
                onPress={regenerate}
                loading={regen}
                accessibilityHint="이 레시피는 거절하고 다른 레시피를 추천받아요"
                style={{ flex: 1 }}
              />
              <Button
                icon="play"
                label={isBusy(job) ? '기기 작동 중' : '기기로 제조 시작'}
                onPress={onStart}
                loading={starting}
                disabled={isBusy(job) || regen}
                style={{ flex: 1.6 }}
              />
            </View>
          </View>
        }>
        {/* 제목 */}
        <View style={{ gap: space.sm }}>
          <Row style={{ flexWrap: 'wrap' }}>
            <Badge label={badge.label} tone={badge.tone} icon={badge.icon} />
            {r.estimatedAbv > 0 ? <Badge label={`도수 ${r.estimatedAbv}%`} tone="danger" icon="wine" /> : <Badge label="무알콜" tone="success" icon="leaf" />}
            {current.fromSaved ? <Badge label="저장된 레시피" tone="info" icon="bookmark" /> : null}
          </Row>
          <AppText variant="display">{r.name}</AppText>
          {r.description ? (
            <AppText variant="body" tone="secondary">
              {r.description}
            </AppText>
          ) : null}
        </View>

        {current.fallbackReason && current.source === 'offline' ? (
          <Banner
            tone="warning"
            title="AI 대신 오프라인 추천을 사용했어요"
            message={`인터넷 또는 AI 서버 문제로 앱에 내장된 규칙으로 레시피를 만들었어요. (${current.fallbackReason.slice(0, 120)})`}
          />
        ) : null}
        {current.warnings.length ? <Banner tone="info" message={current.warnings.join('\n')} /> : null}

        {rejectStreak >= 2 ? (
          <Banner
            tone="primary"
            icon="compass"
            title="새 재료를 장착해 볼까요?"
            message="연속으로 다른 추천을 고르셨어요. 지금 재료 말고, 재료 1개만 새로 넣으면 만들 수 있는 레시피를 찾아 드릴게요."
            action={
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                <Button size="sm" icon="compass" label="새 재료 추천 받기" onPress={explore} disabled={regen} />
                <Button size="sm" variant="ghost" label="괜찮아요" onPress={() => useSession.getState().setRejectStreak(0)} />
              </View>
            }
          />
        ) : null}

        {/* 비율 + 수치 */}
        <Card style={{ gap: space.lg }}>
          <RecipeBar ingredients={r.ingredients} slots={slots} height={22} legend={false} />
          <View style={styles.stats}>
            <Stat label="총량" value={fmtMl(r.totalMl)} />
            <Stat label="예상 도수" value={`${r.estimatedAbv}%`} />
            <Stat label="예상 시간" value={fmtDuration(etaMs)} />
          </View>
        </Card>

        {/* 재료별 ml */}
        <Section
          title="재료"
          subtitle="± 버튼으로 양을 조절할 수 있어요 (5ml 단위)"
          right={
            totalOff ? (
              <Button size="sm" variant="outline" icon="resize" label={`${cupMl}ml 맞추기`} onPress={fitToCup} />
            ) : null
          }>
          <Card padded={false}>
            {r.ingredients.map((i, idx) => {
              const slot = slots.find((s) => s.pump === i.pump);
              return (
                <View key={i.pump} style={[styles.ingRow, idx > 0 ? styles.ingBorder : null]}>
                  <View style={[styles.swatch, { backgroundColor: colorFor(i.pump, slots) }]} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {i.name}
                    </AppText>
                    <AppText variant="small" tone="muted">
                      펌프 {i.pump} · {Math.round((i.ml / (total || 1)) * 100)}%{slot && slot.abv > 0 ? ` · ${slot.abv}%` : ''}
                    </AppText>
                  </View>
                  <View style={styles.adjust}>
                    <AdjustBtn icon="remove" label={`${i.name} 줄이기`} onPress={() => adjust(i.pump, -5)} />
                    <AppText variant="bodyStrong" style={styles.mlText}>
                      {fmtMl(i.ml)}
                    </AppText>
                    <AdjustBtn icon="add" label={`${i.name} 늘리기`} onPress={() => adjust(i.pump, 5)} />
                  </View>
                </View>
              );
            })}
          </Card>
        </Section>

        {/* 추천 이유 */}
        {r.reason ? (
          <Section title="추천 이유" icon="chatbubble-ellipses">
            <Card tone="primary">
              <AppText variant="body">{r.reason}</AppText>
            </Card>
          </Section>
        ) : null}

        {/* 맛 프로필 */}
        <Section title="맛 프로필" icon="pie-chart">
          <Card>
            <FlavorBars flavor={r.flavor} />
          </Card>
        </Section>

        {/* 가니시 & 팁 */}
        {r.garnish || r.tips ? (
          <Section title="가니시 & 팁" icon="leaf">
            <Card style={{ gap: space.md }}>
              {r.garnish ? <InfoLine icon="flower" title="가니시" text={r.garnish} /> : null}
              {r.tips ? <InfoLine icon="bulb" title="팁" text={r.tips} /> : null}
            </Card>
          </Section>
        ) : null}

        {/* 제안 */}
        {r.suggestions.length ? (
          <Section title="바텐더의 제안" icon="bulb">
            <View style={{ gap: space.sm }}>
              {r.suggestions.map((s, idx) => (
                <Card key={idx} tone={s.type === 'low_stock' ? 'warning' : s.type === 'add_ingredient' ? 'info' : 'alt'}>
                  <Row style={{ alignItems: 'flex-start', gap: space.md }}>
                    <Ionicons
                      name={SUG_ICON[s.type]}
                      size={22}
                      color={s.type === 'low_stock' ? colors.warning : s.type === 'add_ingredient' ? colors.info : colors.textSecondary}
                    />
                    <View style={{ flex: 1, gap: space.sm }}>
                      <AppText variant="body">{s.message}</AppText>
                      {s.type === 'add_ingredient' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          icon="add"
                          label={`재료 탭에서 ${s.ingredient ?? '재료'} 장착하기`}
                          onPress={() => openSuggestion(s)}
                          style={{ alignSelf: 'flex-start' }}
                        />
                      ) : s.type === 'low_stock' && s.pump ? (
                        <Button
                          size="sm"
                          variant="outline"
                          icon="water"
                          label={`펌프 ${s.pump} 잔량 채우기`}
                          onPress={() => openSuggestion(s)}
                          style={{ alignSelf: 'flex-start' }}
                        />
                      ) : null}
                    </View>
                  </Row>
                </Card>
              ))}
            </View>
          </Section>
        ) : null}

        {/* 새 재료 탐색 (normal 모드 응답의 explore 0~1개) */}
        {current.explore?.length ? (
          <Section title="새 재료로 이런 것도 만들 수 있어요" subtitle="재료 1개만 바꿔 끼우면 돼요" icon="compass">
            <View style={{ gap: space.md }}>
              {current.explore.map((x) => (
                <ExploreCard key={x.addIngredient} item={x} onInstall={openInstall} compact />
              ))}
            </View>
          </Section>
        ) : null}

        <AppText variant="caption" tone="muted" align="center">
          잔을 노즐 아래에 놓고 얼음을 먼저 채운 뒤 제조를 시작하세요.
        </AppText>
      </Screen>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="small" tone="muted">
        {label}
      </AppText>
      <AppText variant="heading">{value}</AppText>
    </View>
  );
}

function InfoLine({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <Row style={{ alignItems: 'flex-start', gap: space.md }}>
      <Ionicons name={icon} size={18} color={colors.primary} style={{ marginTop: 3 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="label" tone="secondary">
          {title}
        </AppText>
        <AppText variant="body">{text}</AppText>
      </View>
    </Row>
  );
}

function AdjustBtn({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.adjBtn, pressed ? { backgroundColor: colors.cardPressed } : null]}>
      <Ionicons name={icon} size={18} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: space.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    gap: 2,
  },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  ingBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  swatch: { width: 12, height: 40, borderRadius: 6 },
  adjust: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  adjBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mlText: { minWidth: 64, textAlign: 'center' },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  footerInner: { flexDirection: 'row', gap: space.sm, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
});
