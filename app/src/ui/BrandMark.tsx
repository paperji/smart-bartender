/** 홍당무 팀 마크 — 당근 장식을 꽂은 칵테일 잔 (아이콘 public/icons 와 같은 그림) */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="16" fill="#FF7A2F" />
      <path d="M15 20 H49 L35 37 H29 Z" fill="#FFFFFF" />
      <path d="M19.5 25 H44.5 L35 36 H29 Z" fill="#FFD2B5" />
      <path d="M32 37 V48 M24.5 50 H39.5" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M43 11 L50 21 L40.5 19 Z" fill="#E8611A" stroke="#FFFFFF" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M43 11 L41 6.5 M43 11 L45.5 6 M43 11 L48 8.5" stroke="#1E9E6A" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
