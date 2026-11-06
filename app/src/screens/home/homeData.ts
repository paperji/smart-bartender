/**
 * 바텐더 홈 — 화면에서 쓰는 고정 데이터·순수 도우미 (v2.1 src/app/(tabs)/index.tsx 의 상수·weatherIcon 과 같은 값)
 */
import type { LucideIcon } from 'lucide-react';
import { Citrus, Cloud, CloudRain, CloudSun, Flame, IceCreamCone, Leaf, Snowflake, Sparkles, Sun, Thermometer } from 'lucide-react';

import { FLAVOR_ITEMS } from '@/components';
import type { Strength, Taste, UserInput, WeatherInfo } from '@/lib/types';

/** 기분은 최대 6개 (v2.1: slice(0, 6)) */
export const MAX_MOODS = 6;
/** 직접 입력 기분 최대 글자 (v2.1: 12) */
export const CUSTOM_MOOD_MAX = 12;
/** 성향·요청 사항 최대 글자 (v2.1·서버: 300) */
export const PREFERENCE_MAX = 300;

/** 잔 용량 (v2.1 Stepper 와 같은 범위) */
export const CUP = { min: 100, max: 400, step: 10, presets: [150, 200, 250, 300] } as const;

export const STRENGTH_OPTIONS: { value: Strength; label: string }[] = [
  { value: 'none', label: '무알콜' },
  { value: 'light', label: '약하게' },
  { value: 'medium', label: '보통' },
  { value: 'strong', label: '강하게' },
];

export function strengthLabel(s: Strength): string {
  return STRENGTH_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

/** 맛 색은 레시피 화면 맛 프로필(FlavorBars)과 같은 색 — 밝은 바탕용 */
function flavorColor(key: keyof Taste): string {
  return FLAVOR_ITEMS.find((f) => f.key === key)?.color ?? 'var(--accent)';
}

/** 맛 4가지 (v2.1 TASTES 와 같은 순서·이름) */
export const TASTES: { key: keyof Taste; label: string; color: string; icon: LucideIcon }[] = [
  { key: 'sweet', label: '단맛', color: flavorColor('sweet'), icon: IceCreamCone },
  { key: 'sour', label: '신맛', color: flavorColor('sour'), icon: Citrus },
  { key: 'bitter', label: '쓴맛', color: flavorColor('bitter'), icon: Leaf },
  { key: 'fizzy', label: '탄산감', color: flavorColor('fizzy'), icon: Sparkles },
];

/** 날씨 문구 → 아이콘 (v2.1 weatherIcon 과 같은 판정 순서) */
export function weatherIcon(c: string): LucideIcon {
  if (c.includes('비') || c.includes('소나기') || c.includes('뇌우')) return CloudRain;
  if (c.includes('눈')) return Snowflake;
  if (c.includes('흐림') || c.includes('안개')) return Cloud;
  if (c.includes('구름')) return CloudSun;
  if (c.includes('더움')) return Flame;
  if (c.includes('추움')) return Thermometer;
  return Sun;
}

/** 자동으로 불러온 날씨 제목 — "23.4°C 맑음" (v2.1 과 같음) */
export function weatherTitle(w: WeatherInfo): string {
  return `${typeof w.tempC === 'number' ? `${w.tempC}°C ` : ''}${w.condition}`;
}

/** 자동으로 불러온 날씨 보조 줄 — "장소 · 습도 60%" (없으면 '현재 위치') */
export function weatherDetail(w: WeatherInfo): string {
  return [w.place, typeof w.humidity === 'number' ? `습도 ${w.humidity}%` : null].filter(Boolean).join(' · ') || '현재 위치';
}

/** 기분 켜기/끄기 (v2.1 toggleMood — 6개가 넘으면 더하지 않음) */
export function toggleMood(moods: string[], m: string): string[] {
  return moods.includes(m) ? moods.filter((x) => x !== m) : [...moods, m].slice(0, MAX_MOODS);
}

/** 직접 입력한 기분 더하기 (v2.1 addCustomMood — 앞뒤 공백 제거·12자·중복 무시). 넣을 게 없으면 null */
export function addCustomMood(moods: string[], raw: string): string[] | null {
  const m = raw.trim().slice(0, CUSTOM_MOOD_MAX);
  if (!m) return null;
  return moods.includes(m) ? moods : [...moods, m].slice(0, MAX_MOODS);
}

/** PC 요약 카드용 한 줄씩 (고르지 않은 항목은 안내 문구) */
export function summaryRows(input: UserInput): { label: string; value: string; empty: boolean }[] {
  const pref = input.preference.replace(/\s+/g, ' ').trim();
  const w = input.weather;
  return [
    { label: '기분', value: input.moods.length ? input.moods.join(' · ') : '고르지 않았어요', empty: !input.moods.length },
    { label: '맛', value: TASTES.map((t) => `${t.label} ${input.taste[t.key]}`).join(' · '), empty: false },
    { label: '도수', value: strengthLabel(input.strength), empty: false },
    { label: '날씨', value: w ? (w.source === 'auto' ? weatherTitle(w) : w.condition) : '고르지 않았어요', empty: !w },
    { label: '상황', value: input.situation || '고르지 않았어요', empty: !input.situation },
    { label: '요청', value: pref ? (pref.length > 40 ? `${pref.slice(0, 40)}…` : pref) : '없어요', empty: !pref },
    { label: '잔 용량', value: `${input.cupMl}ml`, empty: false },
  ];
}
