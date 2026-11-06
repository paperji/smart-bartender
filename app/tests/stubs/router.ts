/**
 * 테스트용 화면 이동 대역 (v2.1 의 expo-router 대역 대신) — lib/nav.ts 에 이동 기록기를 등록
 * brew.ts·flow.ts 가 go('/brewing') 등으로 이동하면 pushes 에 경로가 남음
 */
import { setNavigator } from '../../src/lib/nav';

export const pushes: string[] = [];

export function installRouterStub(): string[] {
  setNavigator((to) => {
    if (typeof to === 'string') pushes.push(to);
  });
  return pushes;
}
