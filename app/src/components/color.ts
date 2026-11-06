/**
 * 재료 색 도우미 — 펌프 번호 → 색, 밝은 바탕에서도 보이게 하는 테두리 색, 투명도
 * (재료 색은 사용자가 고른 #RRGGBB. 우유·탄산수처럼 아주 옅은 색은 흰 카드 위에서 안 보여서 테두리·막대는 조금 진하게)
 */
import type { PumpSlot } from '@/lib/types';

/** 펌프에 색이 없을 때 쓰는 회색 (--text-decor 와 같은 값 — 꾸밈 전용, 글자 색 X) */
export const FALLBACK_COLOR = '#9AA0A8';

/** 펌프 번호 → 그 펌프 재료 색 (v2.1 RecipeBar colorFor 와 같음, 없으면 회색) */
export function colorFor(pump: number, slots: readonly PumpSlot[]): string {
  return slots.find((s) => s.pump === pump)?.color || FALLBACK_COLOR;
}

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** 상대 휘도 0(검정)~1(흰색) (WCAG 식). #RRGGBB 가 아니면 null */
export function luminance(color: string): number | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 흰 바탕에서 잘 안 보일 만큼 옅은 색인지 (우유·탄산수·토닉워터·사이다 색 등) */
export function isLightColor(color: string, threshold = 0.64): boolean {
  const l = luminance(color);
  return l !== null && l > threshold;
}

/** 테두리·진행 막대용 색 — 옅은 색이면 30% 어둡게, 아니면 그대로 */
export function edgeColor(color: string): string {
  const rgb = parseHex(color);
  if (!rgb || !isLightColor(color)) return color;
  return `#${rgb.map((c) => toHex(c * 0.7)).join('')}`;
}

/** 색에 투명도 입히기 (#RRGGBB → rgba, 그 밖의 색은 color-mix) */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const rgb = parseHex(color);
  if (rgb) return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
  return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
}

/** 전체 중 비율(%) — 정수 반올림 (v2.1 과 같은 Math.round) */
export function sharePct(ml: number, total: number): number {
  return Math.round((ml / (total || 1)) * 100);
}
