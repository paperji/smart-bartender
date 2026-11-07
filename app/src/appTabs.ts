/**
 * 주 메뉴 탭 목록 (모바일 하단 탭바 · PC 왼쪽 내비)
 * App.tsx 와 따로 둔 이유: 컴포넌트 파일이 컴포넌트가 아닌 값을 내보내면 개발 중 화면만 바꾸는 갱신(Fast Refresh)이
 * 앱 전체 새로고침으로 바뀌어 세션 레시피·제조 상태가 사라짐
 */
import { Beaker, Bluetooth, History as HistoryIcon, Sparkles, Users, type LucideIcon } from 'lucide-react';

export interface TabDef {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const TABS: TabDef[] = [
  { to: '/', label: '바텐더', icon: Sparkles },
  // v3.1 모두의 레시피 (공유 레시피 인기 TOP 5·검색)
  { to: '/shared', label: '공유', icon: Users },
  { to: '/ingredients', label: '재료', icon: Beaker },
  { to: '/history', label: '기록', icon: HistoryIcon },
  { to: '/device', label: '기기', icon: Bluetooth },
];

/** 하단 탭바가 보이는 화면 (모바일) */
export const TAB_PATHS = new Set(TABS.map((t) => t.to));
