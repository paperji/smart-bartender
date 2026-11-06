/**
 * 설정 > 앱 정보 의 "앱 설치" 줄 도우미 (화면 없이 테스트할 수 있게 따로 둠) — 설치 창 결과 → 토스트 문구 (해요체)
 *  - accepted: 설치 완료 안내
 *  - dismissed: 사용자가 닫음 → 토스트 없음
 *  - unavailable: 설치 창을 열 수 없음 → 메뉴로 설치하는 방법(installHint) 안내
 */
import type { InstallOutcome } from '@/platform/install';

export interface InstallToast {
  message: string;
  kind: 'success' | 'info';
}

export function installOutcomeToast(outcome: InstallOutcome, hint: string | null = null): InstallToast | null {
  if (outcome === 'accepted') return { message: '앱을 설치했어요. 바탕화면·홈 화면의 아이콘으로 열 수 있어요.', kind: 'success' };
  if (outcome === 'unavailable') {
    return { message: hint ? `지금은 설치 창을 열 수 없어요. ${hint}` : '지금은 설치 창을 열 수 없어요.', kind: 'info' };
  }
  return null;
}
