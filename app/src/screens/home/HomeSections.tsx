/**
 * 바텐더 홈 — 입력 구역들 (v2.1 src/app/(tabs)/index.tsx 의 기분·맛·도수·날씨·상황·성향·잔 용량, 문구 그대로)
 */
import { AlertTriangle, CloudSun, GlassWater, MapPin, MessageCircleMore, Palette, PencilLine, Smile, Users, Wine, X } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';

import { MOODS, SITUATIONS, WEATHER_CHOICES } from '@/lib/presets';
import type { Strength, Taste, WeatherInfo } from '@/lib/types';
import { haptic } from '@/platform/haptics';
import { fetchCurrentWeather } from '@/platform/weather';
import { Button, Card, Chip, ChipGroup, NumberStepper, Row, ScaleSelector, Section, Segmented, Stack, Text, TextArea, TextField } from '@/ui';

import {
  addCustomMood,
  CUP,
  CUSTOM_MOOD_MAX,
  MAX_MOODS,
  PREFERENCE_MAX,
  STRENGTH_OPTIONS,
  TASTES,
  toggleMood,
  weatherDetail,
  weatherIcon,
  weatherTitle,
} from './homeData';

/** 노란 안내 한 줄 (글자는 본문색 — 노란 글자는 흰 바탕에서 대비가 낮아서) */
function WarnNote({ children, live }: { children: ReactNode; live?: boolean }) {
  return (
    <p className="home-note home-note--warning" role={live ? 'alert' : undefined}>
      <AlertTriangle size={15} aria-hidden="true" className="home-note__icon" />
      <span>{children}</span>
    </p>
  );
}

/* ───────── 기분 ───────── */

export function MoodSection({ moods, onChange }: { moods: string[]; onChange: (moods: string[]) => void }) {
  const [customMood, setCustomMood] = useState('');
  const [showMoodInput, setShowMoodInput] = useState(false);
  const customMoods = moods.filter((m) => !MOODS.includes(m));
  const full = moods.length >= MAX_MOODS;

  const add = () => {
    const next = addCustomMood(moods, customMood);
    if (!next) return;
    onChange(next);
    setCustomMood('');
    setShowMoodInput(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 한글 조합 중 Enter 는 글자 확정용이라 무시
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      add();
    } else if (e.key === 'Escape') {
      setShowMoodInput(false);
    }
  };

  return (
    <Section title="지금 기분은 어때요?" description="여러 개를 골라도 좋아요" icon={Smile}>
      <div className="home-chips" role="group" aria-label="기분">
        {MOODS.map((m) => {
          const sel = moods.includes(m);
          return <Chip key={m} label={m} selected={sel} disabled={!sel && full} onClick={() => onChange(toggleMood(moods, m))} />;
        })}
        {customMoods.map((m) => (
          <Chip
            key={`custom-${m}`}
            label={
              <span className="home-chip-custom">
                {m}
                <X size={14} aria-hidden="true" />
              </span>
            }
            ariaLabel={`${m} 빼기`}
            selected
            onClick={() => onChange(toggleMood(moods, m))}
          />
        ))}
        <Chip label="직접 입력" icon={PencilLine} selected={showMoodInput} onClick={() => setShowMoodInput((v) => !v)} />
      </div>
      {showMoodInput ? (
        <Row gap={8}>
          <TextField
            wrapperClassName="home-grow"
            aria-label="직접 입력할 기분"
            placeholder="예: 들뜸, 시험 끝남"
            value={customMood}
            onChange={setCustomMood}
            onKeyDown={onKeyDown}
            maxLength={CUSTOM_MOOD_MAX}
            enterKeyHint="done"
            autoComplete="off"
            autoFocus
          />
          <Button label="추가" onClick={add} disabled={!customMood.trim() || full} />
        </Row>
      ) : null}
      {full ? (
        <Text variant="caption" tone="secondary">
          기분은 {MAX_MOODS}개까지 고를 수 있어요.
        </Text>
      ) : null}
    </Section>
  );
}

/* ───────── 맛 ───────── */

export function TasteSection({ taste, onChange }: { taste: Taste; onChange: (taste: Taste) => void }) {
  return (
    <Section title="원하는 맛" description="0은 '없음', 5는 '아주 강하게'예요" icon={Palette}>
      <Card>
        <Stack gap={20}>
          {TASTES.map((t) => (
            <ScaleSelector
              key={t.key}
              label={t.label}
              icon={t.icon}
              color={t.color}
              value={taste[t.key]}
              onChange={(v) => onChange({ ...taste, [t.key]: v })}
            />
          ))}
        </Stack>
      </Card>
    </Section>
  );
}

/* ───────── 도수 ───────── */

export function StrengthSection({ value, hasAlcohol, onChange }: { value: Strength; hasAlcohol: boolean; onChange: (s: Strength) => void }) {
  return (
    <Section title="도수" icon={Wine}>
      <Segmented
        ariaLabel="도수"
        options={STRENGTH_OPTIONS.map((o) => ({ ...o, disabled: o.value !== 'none' && !hasAlcohol }))}
        value={value}
        onChange={onChange}
      />
      {!hasAlcohol ? (
        <Text variant="caption" tone="secondary">
          주류가 장착되어 있지 않아 무알콜만 선택할 수 있어요. 재료 탭에서 술을 장착하면 도수를 고를 수 있어요.
        </Text>
      ) : value !== 'none' ? (
        <WarnNote>만 19세 이상만 이용할 수 있어요. 음주 후에는 운전하지 마세요.</WarnNote>
      ) : null}
    </Section>
  );
}

/* ───────── 날씨 ───────── */

export function WeatherSection({ weather, onChange }: { weather: WeatherInfo | null; onChange: (w: WeatherInfo | null) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const w = weather;
  const auto = w && w.source === 'auto' ? w : null;
  const AutoIcon = auto ? weatherIcon(auto.condition) : null;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchCurrentWeather();
      onChange(next);
      haptic.success();
    } catch (e: unknown) {
      setError((e instanceof Error && e.message) || '날씨를 불러오지 못했어요');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title="날씨" description="위치 기반으로 자동으로 불러오거나 직접 고르세요" icon={CloudSun}>
      <Card>
        <Stack gap={12}>
          {auto && AutoIcon ? (
            <div className="home-weather-now">
              <span className="home-weather-now__icon" aria-hidden="true">
                <AutoIcon size={24} />
              </span>
              <div className="home-grow">
                <Text variant="heading" as="p" numeric>
                  {weatherTitle(auto)}
                </Text>
                <Text variant="caption" tone="secondary">
                  {weatherDetail(auto)}
                </Text>
              </div>
              <Button size="sm" variant="ghost" icon={X} label="지우기" aria-label="불러온 날씨 지우기" onClick={() => onChange(null)} />
            </div>
          ) : null}
          <Button variant="secondary" icon={MapPin} label={auto ? '다시 불러오기' : '현재 날씨 불러오기'} loading={loading} full onClick={load} />
          {error ? <WarnNote live>{error}</WarnNote> : null}
          <div className="home-chips" role="group" aria-label="날씨 직접 고르기">
            {WEATHER_CHOICES.map((c) => {
              const sel = w?.source === 'manual' && w.condition === c;
              return <Chip key={c} label={c} icon={weatherIcon(c)} selected={sel} onClick={() => onChange(sel ? null : { condition: c, source: 'manual' })} />;
            })}
          </div>
        </Stack>
      </Card>
    </Section>
  );
}

/* ───────── 상황 ───────── */

export function SituationSection({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <Section title="어떤 상황인가요?" icon={Users}>
      <ChipGroup
        ariaLabel="상황"
        options={SITUATIONS.map((s) => ({ value: s, label: s }))}
        value={value || null}
        onChange={(v) => onChange(v ?? '')}
        allowDeselect
      />
    </Section>
  );
}

/* ───────── 성향 ───────── */

export function PreferenceSection({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <Section title="성향 · 요청 사항" description="좋아하는 맛, 싫어하는 재료, 알레르기 등을 자유롭게" icon={MessageCircleMore}>
      <TextArea
        aria-label="성향 · 요청 사항"
        placeholder="예: 너무 달지 않게, 레몬 향을 좋아해요, 탄산은 약하게"
        value={value}
        onChange={(t) => onChange(t.slice(0, PREFERENCE_MAX))}
        maxLength={PREFERENCE_MAX}
        counter
        rows={3}
      />
    </Section>
  );
}

/* ───────── 잔 용량 ───────── */

export function CupSection({ value, onChange }: { value: number; onChange: (ml: number) => void }) {
  return (
    <Section title="잔 용량" icon={GlassWater}>
      <Card>
        <NumberStepper label="잔 용량" value={value} onChange={onChange} min={CUP.min} max={CUP.max} step={CUP.step} unit="ml" presets={[...CUP.presets]} />
      </Card>
    </Section>
  );
}
