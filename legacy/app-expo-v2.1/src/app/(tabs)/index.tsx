/**
 * ① 바텐더 (홈) — 기분·맛·도수·날씨·상황·성향·잔 용량 입력 → AI 레시피 만들기
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CalibrationBanner } from '@/components/CalibrationBanner';
import { DeviceChip } from '@/components/DeviceChip';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { LevelSelector, Segmented, Stepper } from '@/components/ui/controls';
import { Banner } from '@/components/ui/feedback';
import { Row, Screen, Section } from '@/components/ui/layout';
import { AppText } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { colors, radius, space } from '@/constants/theme';
import { recommendAndShow } from '@/lib/flow';
import { MOODS, SITUATIONS, WEATHER_CHOICES } from '@/lib/presets';
import type { Strength, Taste } from '@/lib/types';
import { alertMessage, haptic } from '@/lib/ui';
import { fetchCurrentWeather } from '@/lib/weather';
import { DEFAULT_INPUT, useDraft, useSession } from '@/store/draft';
import { useSettings } from '@/store/settings';
import { installedSlots, useSlots } from '@/store/slots';

const STRENGTH_OPTIONS: { value: Strength; label: string }[] = [
  { value: 'none', label: '무알콜' },
  { value: 'light', label: '약하게' },
  { value: 'medium', label: '보통' },
  { value: 'strong', label: '강하게' },
];

const TASTES: { key: keyof Taste; label: string; color: string; icon: 'ice-cream' | 'nutrition' | 'leaf' | 'sparkles' }[] = [
  { key: 'sweet', label: '단맛', color: '#FF6FAE', icon: 'ice-cream' },
  { key: 'sour', label: '신맛', color: '#FFC542', icon: 'nutrition' },
  { key: 'bitter', label: '쓴맛', color: '#8B7CF6', icon: 'leaf' },
  { key: 'fizzy', label: '탄산감', color: '#5CE1C6', icon: 'sparkles' },
];

export default function BartenderScreen() {
  const input = useDraft((s) => s.input);
  const setInput = useDraft((s) => s.setInput);
  const slots = useSlots((s) => s.slots);
  const installed = useMemo(() => installedSlots(slots), [slots]);
  const hasAlcohol = installed.some((s) => s.abv > 0);
  const aiMode = useSettings((s) => s.aiMode);

  const [customMood, setCustomMood] = useState('');
  const [showMoodInput, setShowMoodInput] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // 주류가 없으면 무알콜로 고정
  useEffect(() => {
    if (!hasAlcohol && input.strength !== 'none') setInput({ strength: 'none' });
  }, [hasAlcohol, input.strength, setInput]);

  const customMoods = input.moods.filter((m) => !MOODS.includes(m));

  const toggleMood = (m: string) => {
    const has = input.moods.includes(m);
    setInput({ moods: has ? input.moods.filter((x) => x !== m) : [...input.moods, m].slice(0, 6) });
  };

  const addCustomMood = () => {
    const m = customMood.trim().slice(0, 12);
    if (!m) return;
    if (!input.moods.includes(m)) setInput({ moods: [...input.moods, m].slice(0, 6) });
    setCustomMood('');
    setShowMoodInput(false);
  };

  const loadWeather = async () => {
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const w = await fetchCurrentWeather();
      setInput({ weather: w });
      haptic.success();
    } catch (e: any) {
      setWeatherError(e?.message ?? '날씨를 불러오지 못했어요');
    } finally {
      setWeatherLoading(false);
    }
  };

  const onGenerate = async () => {
    if (installed.length === 0) {
      alertMessage('장착된 재료가 없어요', '재료 탭에서 펌프에 음료(또는 술)를 먼저 등록하거나, 아래 "새 재료 탐색"으로 무엇을 장착할지 추천받아 보세요.');
      return;
    }
    setGenerating(true);
    haptic.press();
    useSession.getState().setRejectStreak(0);
    try {
      await recommendAndShow({ input, mode: 'normal' });
    } finally {
      setGenerating(false);
    }
  };

  /** 탐색(explore) 모드: 새 재료 1개를 장착하면 만들 수 있는 레시피 (빈 기기에서도 동작) */
  const onExplore = async () => {
    setGenerating(true);
    haptic.press();
    try {
      await recommendAndShow({ input, mode: 'explore' }, { round: 0 });
    } finally {
      setGenerating(false);
    }
  };

  const w = input.weather;

  return (
    <Screen>
      {/* 헤더 */}
      <View style={{ gap: space.sm, paddingTop: space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="label" tone="primary" numberOfLines={1} style={{ flex: 1 }}>
            AI 스마트 바텐더
          </AppText>
          <DeviceChip />
        </Row>
        <AppText variant="display">오늘의 한 잔</AppText>
        <AppText variant="body" tone="muted">
          지금 기분과 취향을 알려 주시면 딱 맞게 섞어 드릴게요.
        </AppText>
      </View>

      <CalibrationBanner />

      {/* 장착된 재료 */}
      {installed.length === 0 ? (
        <Banner
          tone="warning"
          title="장착된 재료가 없어요"
          message="재료 탭에서 펌프 1~4번에 들어 있는 음료를 등록하거나, 무엇을 장착하면 좋을지 추천받아 보세요."
          action={
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Button size="sm" variant="outline" label="재료 등록하기" onPress={() => router.navigate('/ingredients')} />
              <Button size="sm" variant="ghost" icon="compass" label="새 재료 탐색" onPress={onExplore} />
            </View>
          }
        />
      ) : (
        <Card onPress={() => router.navigate('/ingredients')} accessibilityLabel="장착된 재료 보기">
          <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
            <AppText variant="label" tone="secondary">
              장착된 재료 {installed.length}개
            </AppText>
            <Row gap={2}>
              <AppText variant="small" tone="muted">
                관리
              </AppText>
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
            </Row>
          </Row>
          <ChipRow>
            {installed.map((s) => (
              <Chip key={s.pump} size="sm" label={`${s.pump}  ${s.name}`} dotColor={s.color} />
            ))}
          </ChipRow>
        </Card>
      )}

      {/* 기분 */}
      <Section title="지금 기분은 어때요?" subtitle="여러 개를 골라도 좋아요" icon="happy">
        <ChipRow>
          {MOODS.map((m) => (
            <Chip key={m} label={m} selected={input.moods.includes(m)} onPress={() => toggleMood(m)} />
          ))}
          {customMoods.map((m) => (
            <Chip key={m} label={m} selected onPress={() => toggleMood(m)} trailingIcon="close" />
          ))}
          <Chip label="직접 입력" icon="create-outline" onPress={() => setShowMoodInput((v) => !v)} selected={showMoodInput} />
        </ChipRow>
        {showMoodInput ? (
          <Row>
            <TextField
              containerStyle={{ flex: 1 }}
              placeholder="예: 들뜸, 시험 끝남"
              value={customMood}
              onChangeText={setCustomMood}
              onSubmitEditing={addCustomMood}
              returnKeyType="done"
              maxLength={12}
              autoFocus
            />
            <Button label="추가" size="md" onPress={addCustomMood} disabled={!customMood.trim()} />
          </Row>
        ) : null}
      </Section>

      {/* 맛 */}
      <Section title="원하는 맛" subtitle="0은 '없음', 5는 '아주 강하게'예요" icon="color-palette">
        <Card style={{ gap: space.lg }}>
          {TASTES.map((t) => (
            <LevelSelector
              key={t.key}
              label={t.label}
              icon={t.icon}
              color={t.color}
              value={input.taste[t.key]}
              onChange={(v) => setInput({ taste: { ...input.taste, [t.key]: v } })}
            />
          ))}
        </Card>
      </Section>

      {/* 도수 */}
      <Section title="도수" icon="wine">
        <Segmented
          options={STRENGTH_OPTIONS.map((o) => ({ ...o, disabled: o.value !== 'none' && !hasAlcohol }))}
          value={input.strength}
          onChange={(v) => setInput({ strength: v })}
        />
        {!hasAlcohol ? (
          <AppText variant="caption" tone="muted">
            주류가 장착되어 있지 않아 무알콜만 선택할 수 있어요. 재료 탭에서 술을 장착하면 도수를 고를 수 있어요.
          </AppText>
        ) : input.strength !== 'none' ? (
          <AppText variant="caption" tone="warning">
            만 19세 이상만 이용할 수 있어요. 음주 후에는 운전하지 마세요.
          </AppText>
        ) : null}
      </Section>

      {/* 날씨 */}
      <Section title="날씨" subtitle="위치 기반으로 자동으로 불러오거나 직접 고르세요" icon="partly-sunny">
        <Card style={{ gap: space.md }}>
          {w && w.source === 'auto' ? (
            <Row style={{ gap: space.md }}>
              <View style={styles.weatherIcon}>
                <Ionicons name={weatherIcon(w.condition)} size={24} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="heading">
                  {typeof w.tempC === 'number' ? `${w.tempC}°C ` : ''}
                  {w.condition}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {[w.place, typeof w.humidity === 'number' ? `습도 ${w.humidity}%` : null].filter(Boolean).join(' · ') || '현재 위치'}
                </AppText>
              </View>
              <Button size="sm" variant="ghost" icon="close" label="지우기" onPress={() => setInput({ weather: null })} />
            </Row>
          ) : null}
          <Button
            variant="secondary"
            icon="location"
            label={w?.source === 'auto' ? '다시 불러오기' : '현재 날씨 불러오기'}
            loading={weatherLoading}
            onPress={loadWeather}
          />
          {weatherError ? (
            <AppText variant="caption" tone="warning">
              {weatherError}
            </AppText>
          ) : null}
          <ChipRow>
            {WEATHER_CHOICES.map((c) => {
              const sel = w?.source === 'manual' && w.condition === c;
              return (
                <Chip
                  key={c}
                  label={c}
                  icon={weatherIcon(c)}
                  selected={sel}
                  onPress={() => setInput({ weather: sel ? null : { condition: c, source: 'manual' } })}
                />
              );
            })}
          </ChipRow>
        </Card>
      </Section>

      {/* 상황 */}
      <Section title="어떤 상황인가요?" icon="people">
        <ChipRow>
          {SITUATIONS.map((s) => (
            <Chip
              key={s}
              label={s}
              selected={input.situation === s}
              onPress={() => setInput({ situation: input.situation === s ? '' : s })}
            />
          ))}
        </ChipRow>
      </Section>

      {/* 성향 */}
      <Section title="성향 · 요청 사항" subtitle="좋아하는 맛, 싫어하는 재료, 알레르기 등을 자유롭게" icon="chatbubble-ellipses">
        <TextField
          multiline
          placeholder="예: 너무 달지 않게, 레몬 향을 좋아해요, 탄산은 약하게"
          value={input.preference}
          onChangeText={(t) => setInput({ preference: t.slice(0, 300) })}
          maxLength={300}
        />
      </Section>

      {/* 잔 용량 */}
      <Section title="잔 용량" icon="pint">
        <Stepper
          value={input.cupMl}
          onChange={(v) => setInput({ cupMl: v })}
          min={100}
          max={400}
          step={10}
          unit="ml"
          presets={[150, 200, 250, 300]}
        />
      </Section>

      {/* CTA */}
      <View style={{ gap: space.md }}>
        <Button size="lg" icon="sparkles" label="AI 레시피 만들기" onPress={onGenerate} loading={generating} full />
        <Button
          variant="outline"
          icon="compass"
          label="새 재료 탐색 (다른 맛 찾기)"
          onPress={onExplore}
          disabled={generating}
          full
          accessibilityHint="재료 하나를 새로 장착하면 만들 수 있는 레시피를 추천해요"
        />
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
            {aiMode === 'server'
              ? 'AI 서버(Gemini)가 추천해요. 연결이 안 되면 오프라인 추천을 써요.'
              : aiMode === 'direct'
                ? 'Gemini 를 직접 호출해요 (내 API 키 사용).'
                : '오프라인 규칙기반 추천을 사용 중이에요.'}
          </AppText>
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            label="초기화"
            onPress={() => setInput({ ...DEFAULT_INPUT, cupMl: input.cupMl })}
          />
        </Row>
      </View>
    </Screen>
  );
}

function weatherIcon(c: string) {
  if (c.includes('비') || c.includes('소나기') || c.includes('뇌우')) return 'rainy' as const;
  if (c.includes('눈')) return 'snow' as const;
  if (c.includes('흐림') || c.includes('안개')) return 'cloudy' as const;
  if (c.includes('구름')) return 'partly-sunny' as const;
  if (c.includes('더움')) return 'flame' as const;
  if (c.includes('추움')) return 'thermometer' as const;
  return 'sunny' as const;
}

const styles = StyleSheet.create({
  weatherIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
