/**
 * 실제로 쓸 AI 방식 (WEBAPP_DESIGN §4)
 * 설정이 'ai' 여도 고른 AI 의 키가 없으면 오프라인 규칙기반 추천으로 동작합니다.
 * (화면 안내 문구·추천 요청 모두 이 함수 기준 — 순수 함수라 테스트에서 그대로 사용)
 * v3.0 저장값 'gemini' 도 'ai' 로 봄
 */
import type { AiMode } from '../types';

export function effectiveAiMode(aiMode: AiMode | 'gemini', key: string | null | undefined): AiMode {
  return (aiMode === 'ai' || aiMode === 'gemini') && typeof key === 'string' && key.trim().length > 0 ? 'ai' : 'offline';
}

/** 설정 화면·홈 화면 안내 문구 (해요체). label: 고른 AI 이름 (예: 'ChatGPT') */
export function aiModeCaption(aiMode: AiMode, hasKey: boolean, label = 'AI'): string {
  if (aiMode === 'offline') return '오프라인 규칙기반 추천을 사용 중이에요.';
  if (!hasKey) return 'AI 키가 없어 오프라인 추천을 사용 중이에요. 설정에서 내 AI 키를 등록할 수 있어요.';
  return `내 ${label} 키로 AI 가 레시피를 만들어요. 연결이 안 되면 오프라인 추천을 써요.`;
}
