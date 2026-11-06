/**
 * 앱 뼈대 — HashRouter + 화면 배치 + 전역 창(토스트·확인창·성인 확인·AI 로딩) + 시작 처리
 * 라우트(WEBAPP_DESIGN §6): /, /recipe, /brewing, /explore, /history, /ingredients, /ingredients/:pump, /device, /calibrate, /settings
 * 숨은 화면: /ui (UI 키트 모아 보기)
 * 배치: 폭 < 900px → 위 상단바 + 하단 탭바(탭 화면에서만), 폭 ≥ 900px → 왼쪽 세로 내비게이션. 제조 화면(/brewing)은 전체 화면
 */
import { Settings as SettingsIcon } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { HashRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';

import { TAB_PATHS, TABS } from '@/appTabs';
import { AppErrorBoundary, ScreenBoundary } from '@/components';
import { registerJobEffects } from '@/lib/brew';
import { deviceClient } from '@/lib/device/client';
import { noteLocation, setNavigator } from '@/lib/nav';
import { initNotifications } from '@/platform/notify';
import { PlatformHost } from '@/platform/PlatformHost';
import { onGeminiKeyChange } from '@/platform/secrets';
import { BrewingScreen } from '@/screens/brewing/BrewingScreen';
import { CalibrateScreen } from '@/screens/device/CalibrateScreen';
import { DeviceScreen } from '@/screens/device/DeviceScreen';
import { ExploreScreen } from '@/screens/explore/ExploreScreen';
import { HistoryScreen } from '@/screens/history/HistoryScreen';
import { HomeScreen } from '@/screens/home/HomeScreen';
import { IngredientEditScreen } from '@/screens/ingredients/IngredientEditScreen';
import { IngredientsScreen } from '@/screens/ingredients/IngredientsScreen';
import { RecipeScreen } from '@/screens/recipe/RecipeScreen';
import { SettingsScreen } from '@/screens/settings/SettingsScreen';
import { useDevice } from '@/store/device';
import { syncGeminiKeyHint, useSettings } from '@/store/settings';
import { isLowStock, useSlots } from '@/store/slots';
import { AdultGateHost, AiLoadingHost, cx, DeviceChip, DialogHost, IconButton, ToastHost } from '@/ui';
import { BrandMark } from '@/ui/BrandMark';
import { GalleryScreen } from '@/ui/gallery/GalleryScreen';

import './app.css';

/** react-router 의 navigate 를 화면 밖 로직(lib/nav.ts)에 연결 + 이동 기록(dismissTo 용) 남기기 + 화면이 바뀌면 맨 위로 */
function NavBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname } = location;
  useEffect(() => {
    setNavigator((to, opts) => {
      if (typeof to === 'number') navigate(to);
      else navigate(to, opts);
    });
    return () => setNavigator(null);
  }, [navigate]);
  // 주소가 바뀔 때마다(쿼리만 바뀌는 이동 포함) 지금 칸을 이동 기록에 남김 — lib/nav.dismissTo 가 씀
  useEffect(() => noteLocation(), [location]);
  useEffect(() => {
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/**
 * 시작 처리 (v2.1 루트 레이아웃과 같음): 작업 종료 처리 등록, 알림 준비, 키 힌트 맞추기, 데모 모드면 가상 기기 자동 연결
 * 다른 창(탭)에서 키를 저장·삭제하면 힌트를 다시 맞춤 — 설정 화면이 닫혀 있어도 'Gemini 사용 중' 표시가 바로 바뀌게
 */
function useAppBootstrap() {
  const demoMode = useSettings((s) => s.demoMode);
  useEffect(() => registerJobEffects(), []);
  useEffect(() => {
    initNotifications().catch(() => undefined);
    syncGeminiKeyHint().catch(() => undefined);
  }, []);
  useEffect(
    () =>
      onGeminiKeyChange(() => {
        syncGeminiKeyHint().catch(() => undefined);
      }),
    [],
  );
  useEffect(() => {
    deviceClient.init(demoMode).catch((e) => console.warn('[device] init failed', e));
  }, [demoMode]);
}

function TabBadge({ to }: { to: string }) {
  const lowCount = useSlots((s) => s.slots.filter(isLowStock).length);
  const conn = useDevice((s) => s.conn);
  if (to === '/ingredients' && lowCount > 0) {
    return (
      <span className="sb-nav__badge sb-nav__badge--warning" aria-label={`잔량 부족 ${lowCount}개`}>
        {lowCount}
      </span>
    );
  }
  if (to === '/device' && conn === 'disconnected') {
    return (
      <span className="sb-nav__badge sb-nav__badge--danger" aria-label="연결 끊김">
        !
      </span>
    );
  }
  return null;
}

function NavItems({ variant }: { variant: 'rail' | 'tabbar' }) {
  return (
    <>
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('sb-nav__item', `sb-nav__item--${variant}`, isActive && 'is-active')}>
          <span className="sb-nav__icon">
            <Icon size={22} aria-hidden="true" />
            <TabBadge to={to} />
          </span>
          <span className="sb-nav__label">{label}</span>
        </NavLink>
      ))}
    </>
  );
}

/** 탭바가 없는 화면이면 <html> 에 sb-no-tabbar (토스트·아래 버튼 줄 위치용 --tabbar-offset) */
function useTabbarFlag(show: boolean) {
  useEffect(() => {
    document.documentElement.classList.toggle('sb-no-tabbar', !show);
  }, [show]);
}

/** 화면 틀: 왼쪽 내비(PC) · 상단바 · 본문 · 하단 탭바(모바일 탭 화면) */
function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const showTabbar = TAB_PATHS.has(pathname);
  useTabbarFlag(showTabbar);
  return (
    <div className={cx('sb-shell', showTabbar ? 'has-tabbar' : 'no-tabbar')}>
      <a className="sb-skip" href="#sb-main" onClick={(e) => {
        e.preventDefault();
        document.getElementById('sb-main')?.focus();
      }}>
        본문으로 건너뛰기
      </a>
      <nav className="sb-rail" aria-label="주 메뉴">
        <div className="sb-rail__brand">
          <BrandMark size={36} />
          <span className="sb-rail__name">AI 스마트 바텐더</span>
        </div>
        <div className="sb-rail__items">
          <NavItems variant="rail" />
        </div>
        <NavLink to="/settings" className={({ isActive }) => cx('sb-nav__item', 'sb-nav__item--rail', 'sb-rail__settings', isActive && 'is-active')}>
          <span className="sb-nav__icon">
            <SettingsIcon size={22} aria-hidden="true" />
          </span>
          <span className="sb-nav__label">설정</span>
        </NavLink>
      </nav>
      <div className="sb-main-col">
        <header className="sb-topbar">
          <div className="sb-topbar__brand">
            <BrandMark size={28} />
            <span className="sb-topbar__name">AI 스마트 바텐더</span>
          </div>
          <div className="sb-topbar__right">
            <DeviceChip compact />
            <IconButton icon={SettingsIcon} label="앱 설정" className="sb-topbar__settings" onClick={() => navigate('/settings')} />
          </div>
        </header>
        <main id="sb-main" className="sb-main" tabIndex={-1}>
          {/* 화면 하나가 깨져도 내비·탭바는 남게 (홈·레시피 등은 화면 안에서 한 번 더 감쌈) */}
          <ScreenBoundary name="route">
            <Outlet />
          </ScreenBoundary>
        </main>
      </div>
      {showTabbar ? (
        <nav className="sb-tabbar" aria-label="주 메뉴">
          <NavItems variant="tabbar" />
        </nav>
      ) : null}
    </div>
  );
}

/**
 * 왼쪽 내비가 없는 화면이면 <html> 에 sb-no-rail — PC 는 토스트를 화면 가운데로,
 * 모바일은 토스트를 화면 위로 (아래의 비상 정지·피드백·닫기 버튼을 덮어 첫 탭을 가로채지 않게, components.css)
 */
function useNoRailFlag() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('sb-no-rail');
    return () => root.classList.remove('sb-no-rail');
  }, []);
}

/** 전체 화면 (제조 진행) — 내비 없음 */
function BareShell() {
  useTabbarFlag(false);
  useNoRailFlag();
  return (
    <div className="sb-shell sb-shell--bare no-tabbar">
      <main id="sb-main" className="sb-main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

function Hosts() {
  return (
    <>
      <AdultGateHost />
      <AiLoadingHost />
      <DialogHost />
      <ToastHost />
      <PlatformHost />
    </>
  );
}

function Root({ children }: { children?: ReactNode }) {
  useAppBootstrap();
  return (
    <>
      <NavBridge />
      {children}
      <Hosts />
    </>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomeScreen />} />
        <Route path="recipe" element={<RecipeScreen />} />
        <Route path="explore" element={<ExploreScreen />} />
        <Route path="history" element={<HistoryScreen />} />
        <Route path="ingredients" element={<IngredientsScreen />} />
        <Route path="ingredients/:pump" element={<IngredientEditScreen />} />
        <Route path="device" element={<DeviceScreen />} />
        <Route path="calibrate" element={<CalibrateScreen />} />
        <Route path="settings" element={<SettingsScreen />} />
        <Route path="ui" element={<GalleryScreen />} />
      </Route>
      <Route element={<BareShell />}>
        <Route path="brewing" element={<BrewingScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <HashRouter>
      {/* 화면 틀·전역 창까지 깨져도 하얀 화면 대신 복구 카드 (components/ErrorBoundary.tsx) */}
      <AppErrorBoundary name="app" full>
        <Root>
          <AppRoutes />
        </Root>
      </AppErrorBoundary>
    </HashRouter>
  );
}
