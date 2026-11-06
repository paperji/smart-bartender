/** className 합치기 (false·null·undefined 는 뺌) */
export function cx(...parts: (string | false | null | undefined | 0)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** 상태 색 이름 — 배지·배너·카드·진행 막대가 같이 씀 */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
