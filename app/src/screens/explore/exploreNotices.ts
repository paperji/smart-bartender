/**
 * 새 재료 탐색 화면의 안내 문구 (순수 함수 — 화면 밖에서도 그대로 테스트 가능)
 *  - 추천 출처 배지 (v2.1 explore.tsx SOURCE_BADGE — v3.0 은 서버 모드가 없어 direct·offline 두 가지)
 *  - 오프라인 추천으로 바뀐 이유 배너 (v2.1: fallbackReason && source==='offline' → 노란 배너)
 *    v3.0: 키가 없는 것(NO_KEY)은 오류가 아니라 기본 상태라 파란 안내로, 나머지 AI 오류는 v2.1 처럼 노란 배너로
 *    v3.1: 배지·문구에 고른 AI 이름(ChatGPT·Claude 등)
 */
import { CloudOff, Sparkles, type LucideIcon } from 'lucide-react';

import { providerLabel, type AiProviderId } from '@/lib/ai/providers';
import { AI_ERROR_TEXT, type AiErrorCode } from '@/lib/ai/recommend';
import type { RecipeSource } from '@/lib/types';

export interface SourceBadgeInfo {
  label: string;
  tone: 'info' | 'warning';
  icon: LucideIcon;
}

/** 추천 출처 배지 — AI 는 파랑(디자인 §3 "정보·AI 배지"), 오프라인은 v2.1 처럼 노랑 */
export const SOURCE_BADGE: Record<RecipeSource, SourceBadgeInfo> = {
  direct: { label: 'AI 추천', tone: 'info', icon: Sparkles },
  offline: { label: '오프라인 추천', tone: 'warning', icon: CloudOff },
};

/** 출처 배지 — AI 가 만들었으면 'AI 추천 · ChatGPT' 처럼 AI 이름까지 */
export function sourceBadge(source: RecipeSource | string | undefined, provider?: AiProviderId): SourceBadgeInfo {
  const b = SOURCE_BADGE[source as RecipeSource] ?? SOURCE_BADGE.offline;
  return source === 'direct' && provider ? { ...b, label: `${b.label} · ${providerLabel(provider)}` } : b;
}

export interface FallbackNotice {
  /** nokey: 키가 없어 처음부터 오프라인(기본 상태) / error: AI 를 쓰려다 실패 */
  kind: 'nokey' | 'error';
  tone: 'info' | 'warning';
  title: string;
  message: string;
  /** 설정 화면에서 고칠 수 있는 원인(키 없음·키 오류·모델·크레딧)이면 [설정] 버튼 */
  settings: boolean;
}

/** 설정에서 고칠 수 있는 AI 오류 */
const SETTINGS_CODES = new Set(['AUTH', 'MODEL', 'BILLING']);

/**
 * 오프라인 추천으로 바뀐 이유 배너 (없으면 null).
 * v2.1 문구: "AI 대신 오프라인 추천을 사용했어요" / "인터넷 또는 AI 서버 문제로 앱에 내장된 규칙으로 골랐어요. (이유 120자)"
 * v3.0: 이유는 AI 오류 분류의 쉬운 문구(AI_ERROR_TEXT)를 먼저 쓰고, 괄호가 겹치지 않게 "이유: …" 로
 */
export function fallbackNotice(ex: {
  source: RecipeSource | string;
  fallbackReason?: string;
  fallbackCode?: string;
  provider?: AiProviderId;
}): FallbackNotice | null {
  if (ex.source !== 'offline' || !ex.fallbackReason) return null;
  const code = ex.fallbackCode;
  if (code === 'NO_KEY') {
    return {
      kind: 'nokey',
      tone: 'info',
      title: 'AI 키가 없어 오프라인 추천을 보여드려요',
      message: 'AI 키가 없어 앱에 내장된 규칙으로 골랐어요. 설정에서 내 AI 키를 등록하면 AI 가 골라 줘요.',
      settings: true,
    };
  }
  const why = code && code in AI_ERROR_TEXT ? AI_ERROR_TEXT[code as AiErrorCode] : null;
  const settings = !!code && SETTINGS_CODES.has(code);
  const lead =
    code === 'TIMEOUT'
      ? 'AI 응답이 너무 늦어'
      : code === 'INVALID_RECIPE'
        ? 'AI 가 보낸 결과를 쓸 수 없어'
        : settings || code === 'RATE_LIMIT' || code === 'BAD_REQUEST'
          ? `${ex.provider ? providerLabel(ex.provider) : 'AI'}에서 답을 받지 못해`
          : '인터넷 또는 AI 서버 문제로';
  const detail = (why ?? ex.fallbackReason).slice(0, 120);
  return {
    kind: 'error',
    tone: 'warning',
    title: 'AI 대신 오프라인 추천을 사용했어요',
    message: `${lead} 앱에 내장된 규칙으로 골랐어요. 이유: ${detail}`,
    settings,
  };
}

/** 안내(warnings) 줄 — v2.1 처럼 앞에서 4줄까지, 빈 줄·중복 제거 */
export function noticeLines(warnings: readonly string[] | null | undefined, max = 4): string[] {
  const out: string[] = [];
  for (const w of warnings ?? []) {
    const t = String(w ?? '').trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** "다시 탐색" 요청 값 (v2.1 과 같은 variation 공식) */
export function nextExploreRound(round: number, rand: () => number = Math.random): { round: number; variation: number } {
  const next = Math.max(0, Math.floor(round || 0)) + 1;
  return { round: next, variation: next * 7919 + Math.floor(rand() * 1000) };
}
