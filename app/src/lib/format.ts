/**
 * 화면 표시용 포맷 (v2.1 lib/ui.ts 의 fmt* 그대로)
 */
export function fmtMl(ml: number): string {
  const r = Math.round(ml * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}ml`;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}분 ${r}초` : `${m}분`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `오늘 ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `어제 ${time}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${time}`;
}

/** 키 전체 가리기 (마지막 4자리만) — 입력값에서 바로 만들 때 */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 4) return '••••';
  return `••••••••${k.slice(-4)}`;
}

/** 설정의 geminiKeyHint(마지막 4자리) → 화면 표시 */
export function maskKeyHint(hint: string | null | undefined): string {
  return hint ? `••••••••${hint}` : '';
}
