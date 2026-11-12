/// <reference types="node" />
/**
 * 사용법 안내(튜토리얼) — lib/tutorial.ts · store/tutorial.ts · settings.tutorialSeen · components/TutorialHost.tsx
 *  - 단계 목록: 경로가 실제 라우트이고, 비출 대상(data-tour)이 그 화면 파일에 있음
 *  - 처음 접속 자동 열기 조건 (저장값을 다 읽은 뒤 · 아직 안 봄 · 제조 중 아님 · 다른 창 없음 · 제조/캘리브레이션 화면 아님)
 *  - 비출 칸·말풍선 위치 (아래 → 위 → 겹침, 화면 안으로 당김, 긴 대상은 윗부분만)
 *  - 진행 상태: 시작하면 tutorialSeen 저장, 단계 이동은 바꿔 열기(replace), 끝·닫기
 *  - 화면: 말풍선은 aria-modal 창(안드로이드 뒤로 = Esc 로 닫힘), z-index 는 다른 창 아래·탭바 위, 누르는 영역 44px
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { setNavigator } from '../src/lib/nav';
import {
  HOLE_MAX_RATIO,
  HOLE_MAX_RATIO_LOW,
  HOLE_PAD,
  holeBox,
  placeTip,
  shouldAutoOpen,
  TIP_GAP,
  TIP_MARGIN,
  tipWidth,
  TOUR_STEPS,
  type AutoOpenContext,
} from '../src/lib/tutorial';
import { useDevice } from '../src/store/device';
import { mergeSettings, sanitizeSettings, SETTINGS_DEFAULTS, useSettings } from '../src/store/settings';
import { useToast } from '../src/store/toast';
import { useTutorial } from '../src/store/tutorial';

const SRC = path.join(import.meta.dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(path.join(SRC, ...p), 'utf8');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// ───────────────────────── 단계 목록 ─────────────────────────

/** App.tsx 의 라우트 경로 ('/', '/recipe', …) */
function appRoutes(): Set<string> {
  const app = read('App.tsx');
  const set = new Set<string>();
  if (/<Route index /.test(app)) set.add('/');
  for (const m of app.matchAll(/<Route path="([^"*]+)"/g)) set.add('/' + m[1]);
  return set;
}

/** 경로 → 그 화면 폴더 */
const SCREEN_DIR: Record<string, string> = {
  '/': 'home',
  '/ingredients': 'ingredients',
  '/device': 'device',
  '/shared': 'shared',
  '/history': 'history',
  '/settings': 'settings',
};

test('단계 목록: 이름이 겹치지 않고, 제목·설명이 있고, 휴대폰 말풍선에 맞는 길이', () => {
  assert.ok(TOUR_STEPS.length >= 6 && TOUR_STEPS.length <= 12, `단계 수 ${TOUR_STEPS.length}`);
  const ids = new Set(TOUR_STEPS.map((s) => s.id));
  assert.equal(ids.size, TOUR_STEPS.length);
  for (const s of TOUR_STEPS) {
    assert.ok(s.title.trim().length > 0 && s.title.length <= 24, `${s.id} 제목 길이 ${s.title.length}`);
    assert.ok(s.body.trim().length > 0 && s.body.length <= 140, `${s.id} 설명 길이 ${s.body.length}`);
  }
  // 첫 단계는 바텐더(첫 화면)에서 시작
  assert.equal(TOUR_STEPS[0].route, '/');
});

test('단계 목록: 경로는 실제 라우트, 비출 대상(data-tour)은 그 화면 파일에 있음', () => {
  const routes = appRoutes();
  for (const s of TOUR_STEPS) {
    assert.ok(routes.has(s.route), `${s.id}: 없는 경로 ${s.route}`);
    if (!s.target) continue;
    const dir = SCREEN_DIR[s.route];
    assert.ok(dir, `${s.id}: 화면 폴더를 모름 ${s.route}`);
    const files = filesUnder(path.join(SRC, 'screens', dir));
    const hit = files.some((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes(`data-tour="${s.target}"`) || new RegExp(`data-tour=\\{[^}]*'${s.target}'`).test(src);
    });
    assert.ok(hit, `${s.id}: screens/${dir} 에 data-tour="${s.target}" 이 없음`);
  }
  // 대상이 없는(가운데 카드) 단계도 있음 — 레시피·제조처럼 처음엔 볼 수 없는 화면 설명
  assert.ok(TOUR_STEPS.some((s) => !s.target));
});

test('AI 레시피 만들기 버튼은 모바일(아래 버튼 줄)·PC(오른쪽 카드) 둘 다 표시가 있음 — 보이는 쪽을 비춤', () => {
  const home = read('screens', 'home', 'HomeScreen.tsx');
  const cards = read('screens', 'home', 'HomeCards.tsx');
  assert.match(home, /footer=\{wide \? undefined : <Button[^\n]*data-tour="home-generate"/);
  assert.match(cards, /label="AI 레시피 만들기"[^\n]*data-tour="home-generate"/);
});

// ───────────────────────── 자동으로 열기 ─────────────────────────

const ctx = (patch: Partial<AutoOpenContext> = {}): AutoOpenContext => ({
  hydrated: true,
  seen: false,
  path: '/',
  busy: false,
  dialogOpen: false,
  active: false,
  ...patch,
});

test('처음 접속: 저장값을 읽었고 아직 안 봤으면 환영 창을 엶', () => {
  assert.equal(shouldAutoOpen(ctx()), true);
  for (const p of ['/', '/ingredients', '/history', '/device', '/shared', '/settings', '/recipe', '/explore']) {
    assert.equal(shouldAutoOpen(ctx({ path: p })), true, p);
  }
});

test('처음 접속: 이미 봤거나·저장값을 읽기 전·안내 중·기기 작업 중·다른 창이 열려 있으면 열지 않음', () => {
  assert.equal(shouldAutoOpen(ctx({ seen: true })), false);
  assert.equal(shouldAutoOpen(ctx({ hydrated: false })), false);
  assert.equal(shouldAutoOpen(ctx({ active: true })), false);
  assert.equal(shouldAutoOpen(ctx({ busy: true })), false);
  assert.equal(shouldAutoOpen(ctx({ dialogOpen: true })), false);
});

test('처음 접속: 제조 진행·캘리브레이션·UI 키트 화면에서는 열지 않음', () => {
  for (const p of ['/brewing', '/calibrate', '/ui']) assert.equal(shouldAutoOpen(ctx({ path: p })), false, p);
});

// ───────────────────────── 비출 칸·말풍선 위치 ─────────────────────────

const PHONE = { width: 375, height: 700 };
const PC = { width: 1280, height: 800 };

test('말풍선 폭: 최대 360px, 좁은 화면은 양옆 12px 만 남김', () => {
  assert.equal(tipWidth(PC), 360);
  assert.equal(tipWidth(PHONE), 351);
  assert.equal(tipWidth({ width: 320, height: 600 }), 296);
});

test('비출 칸: 여백을 두르고, 긴 대상은 화면 높이의 45% 까지만, 화면 밖은 잘라 냄', () => {
  const h = holeBox({ top: 100, left: 20, width: 200, height: 50 }, PHONE)!;
  assert.deepEqual(h, { top: 100 - HOLE_PAD, left: 20 - HOLE_PAD, width: 200 + HOLE_PAD * 2, height: 50 + HOLE_PAD * 2 });
  const tall = holeBox({ top: 80, left: 0, width: 375, height: 1500 }, PHONE)!;
  assert.equal(tall.height, Math.round(PHONE.height * HOLE_MAX_RATIO));
  assert.equal(tall.left, 0);
  assert.equal(tall.width, 375);
  // 화면 아래로 완전히 벗어남 → 비출 칸 없음 (가운데 카드)
  assert.equal(holeBox({ top: 900, left: 0, width: 100, height: 40 }, PHONE), null);
});

test('말풍선 자리: 아래가 넉넉하면 아래, 아니면 위, 둘 다 좁으면 화면 아래쪽에 겹침, 대상 없으면 가운데', () => {
  const tip = { width: 351, height: 220 };
  const top = { top: 100, left: 12, width: 351, height: 60 };
  const below = placeTip(top, tip, PHONE);
  assert.equal(below.side, 'below');
  assert.equal(below.top, top.top + top.height + TIP_GAP);

  const bottomBtn = { top: 600, left: 12, width: 351, height: 56 }; // 모바일 아래 버튼 줄
  const above = placeTip(bottomBtn, tip, PHONE);
  assert.equal(above.side, 'above');
  assert.equal(above.top, bottomBtn.top - TIP_GAP - tip.height);

  const big = { top: 150, left: 0, width: 375, height: 400 };
  const over = placeTip(big, tip, PHONE);
  assert.equal(over.side, 'overlap');
  assert.equal(over.top, PHONE.height - TIP_MARGIN - tip.height);

  const center = placeTip(null, tip, PHONE);
  assert.equal(center.side, 'center');
  assert.equal(center.top, (PHONE.height - tip.height) / 2);
});

test('말풍선 자리: 가로는 대상 가운데, 화면 밖으로 나가지 않게 당김 (PC 왼쪽·오른쪽 끝)', () => {
  const tip = { width: 360, height: 200 };
  const mid = placeTip({ top: 100, left: 500, width: 200, height: 40 }, tip, PC);
  assert.equal(mid.left, 500 + 100 - 180);
  const leftEdge = placeTip({ top: 100, left: 0, width: 40, height: 40 }, tip, PC);
  assert.equal(leftEdge.left, TIP_MARGIN);
  const rightEdge = placeTip({ top: 100, left: 1240, width: 40, height: 40 }, tip, PC);
  assert.equal(rightEdge.left, PC.width - TIP_MARGIN - tip.width);
  // 말풍선이 화면보다 커도 위·왼쪽 여백은 지킴
  const huge = placeTip(null, { width: 400, height: 900 }, PHONE);
  assert.equal(huge.top, TIP_MARGIN);
  assert.equal(huge.left, TIP_MARGIN);
});

test('말풍선 자리: 시스템 영역(안드로이드 내비게이션 바·상태 표시줄)을 피함', () => {
  const vp = { width: 375, height: 800, inset: { top: 24, right: 0, bottom: 48, left: 0 } };
  const tip = { width: 351, height: 220 };
  // 위아래 모두 좁아 겹치는 경우도 내비게이션 바 위에서 멈춤
  const over = placeTip({ top: 200, left: 0, width: 375, height: 360 }, tip, vp);
  assert.equal(over.side, 'overlap');
  assert.ok(over.top + tip.height <= vp.height - 48 - TIP_MARGIN, `아래 ${over.top + tip.height}`);
  // 아래 자리 계산도 내비게이션 바를 뺌: 바가 없으면 아래(below)지만 바가 있으면 위(above)
  const hole = { top: 470, left: 12, width: 351, height: 50 };
  assert.equal(placeTip(hole, tip, { width: 375, height: 800 }).side, 'below');
  assert.equal(placeTip(hole, tip, vp).side, 'above');
  // 가운데 카드도 시스템 영역 안쪽 가운데
  const c = placeTip(null, { width: 351, height: 300 }, vp);
  assert.ok(c.top >= 24 + TIP_MARGIN && c.top + 300 <= 800 - 48 - TIP_MARGIN);
  // 가로 모드 노치(왼쪽 영역)
  assert.equal(tipWidth({ width: 800, height: 360, inset: { top: 0, right: 0, bottom: 0, left: 44 } }), 360);
  assert.equal(tipWidth({ width: 375, height: 800, inset: { top: 0, right: 10, bottom: 0, left: 10 } }), 331);
});

test('말풍선 자리: 낮고 넓은 화면(가로 모드)은 대상 옆에, 옆도 없으면 대상 반대쪽 끝에 (대상을 덮지 않게)', () => {
  const LAND = { width: 800, height: 360 };
  const tip = { width: 360, height: 220 };
  // 왼쪽 좁은 대상 → 오른쪽 옆
  const right = placeTip({ top: 80, left: 20, width: 300, height: 120 }, tip, LAND);
  assert.equal(right.side, 'right');
  assert.ok(right.left >= 20 + 300 + TIP_GAP);
  // 오른쪽 대상 → 왼쪽 옆
  const left = placeTip({ top: 80, left: 460, width: 320, height: 120 }, tip, LAND);
  assert.equal(left.side, 'left');
  assert.ok(left.left + tip.width <= 460 - TIP_GAP);
  // 폭 전체를 차지하는 아래쪽 대상(모바일 아래 버튼 줄) → 말풍선은 화면 위
  const W = { width: 640, height: 360 };
  const bottomBar = placeTip({ top: 280, left: 10, width: 620, height: 64 }, { width: 360, height: 260 }, W);
  assert.equal(bottomBar.side, 'overlap');
  assert.equal(bottomBar.top, TIP_MARGIN);
  // 폭 전체 위쪽 대상 → 말풍선은 화면 아래
  const topBar = placeTip({ top: 60, left: 10, width: 620, height: 108 }, { width: 360, height: 260 }, W);
  assert.equal(topBar.side, 'overlap');
  assert.equal(topBar.top, 360 - TIP_MARGIN - 260);
  // 위에 자리가 있으면 겹치지 않고 위
  assert.equal(placeTip({ top: 280, left: 10, width: 620, height: 64 }, { width: 360, height: 230 }, W).side, 'above');
  // 낮은 화면은 비출 칸도 더 낮게
  const h = holeBox({ top: 60, left: 0, width: 640, height: 900 }, W)!;
  assert.equal(h.height, Math.round(360 * HOLE_MAX_RATIO_LOW));
});

// ───────────────────────── 저장값 ─────────────────────────

test('설정 tutorialSeen: 기본 false, 저장값 true 는 유지, 모양이 틀리면 false', () => {
  assert.equal(SETTINGS_DEFAULTS.tutorialSeen, false);
  assert.equal(sanitizeSettings({}).tutorialSeen, false);
  assert.equal(sanitizeSettings({ tutorialSeen: true }).tutorialSeen, true);
  assert.equal(sanitizeSettings({ tutorialSeen: 'yes' }).tutorialSeen, false);
  // v3.1.0 까지의 저장값(이 칸이 없음) → 업데이트한 사람도 한 번은 환영 창을 보고 [건너뛰기]로 넘길 수 있음
  assert.equal(sanitizeSettings({ aiMode: 'ai', aiProvider: 'gemini', onboardingDismissed: true, demoMode: false }).tutorialSeen, false);
});

// ───────────────────────── 진행 상태 ─────────────────────────

const moves: { to: string; replace: boolean }[] = [];
setNavigator((to, opts) => {
  if (typeof to === 'string') moves.push({ to, replace: !!opts?.replace });
});

function resetAll() {
  useTutorial.setState({ phase: 'idle', step: 0 });
  useSettings.getState().set({ tutorialSeen: false });
  moves.length = 0;
}

test('설정 합치기: 예전 버전 탭이 쓴 값(tutorialSeen 칸 없음)은 이 탭의 "봤음"을 지우지 않음, 데이터 초기화(false 직접 저장)는 따라감', () => {
  const current = { ...SETTINGS_DEFAULTS, tutorialSeen: true };
  const oldTab = { aiMode: 'ai', aiProvider: 'gemini', aiModels: {}, aiKeyHints: {}, demoMode: true, onboardingDismissed: true };
  assert.equal(mergeSettings(oldTab, current).tutorialSeen, true);
  assert.equal(mergeSettings({ aiMode: 'ai', demoMode: true }, current).tutorialSeen, true); // v3.0 모양
  assert.equal(mergeSettings({ ...oldTab, tutorialSeen: false }, current).tutorialSeen, false);
  // 처음 불러올 때(지금 값 = 기본값) 칸이 없으면 false — 업데이트한 사람도 환영 창을 한 번 봄
  assert.equal(mergeSettings(oldTab, { ...SETTINGS_DEFAULTS }).tutorialSeen, false);
});

test('진행: 환영 창 → [건너뛰기] 하면 봤음으로 저장하고 아무 데도 가지 않음', () => {
  resetAll();
  useTutorial.getState().openWelcome();
  assert.equal(useTutorial.getState().phase, 'welcome');
  useTutorial.getState().close();
  assert.equal(useTutorial.getState().phase, 'idle');
  assert.equal(useSettings.getState().tutorialSeen, true);
  assert.deepEqual(moves, []);
});

test('진행: [사용법 보기] → 바로 봤음으로 저장(중간에 꺼도 다시 강제로 열리지 않음), 단계마다 그 화면으로 바꿔 열기', () => {
  resetAll();
  useTutorial.getState().openWelcome();
  useTutorial.getState().start();
  assert.equal(useTutorial.getState().phase, 'tour');
  assert.equal(useTutorial.getState().step, 0);
  assert.equal(useSettings.getState().tutorialSeen, true);
  for (let i = 1; i < TOUR_STEPS.length; i++) {
    useTutorial.getState().next();
    assert.equal(useTutorial.getState().step, i);
  }
  // 테스트에는 주소가 없어 늘 '/' 로 보이므로, '/' 가 아닌 단계 화면만 이동 기록에 남음 — 모두 바꿔 열기
  const expected = TOUR_STEPS.slice(1).map((s) => s.route).filter((r) => r !== '/');
  assert.deepEqual(moves.map((m) => m.to), expected);
  assert.ok(moves.every((m) => m.replace), '안내 이동은 기록을 쌓지 않음');
  // 마지막 단계에서 [마치기] → 준비 끝 창
  useTutorial.getState().next();
  assert.equal(useTutorial.getState().phase, 'done');
});

test('진행: 이미 봤어도(tutorialSeen = true) 다시 보기를 누르면 처음 단계부터 다시 시작', () => {
  resetAll();
  useSettings.getState().set({ tutorialSeen: true });
  useTutorial.getState().start();
  assert.equal(useTutorial.getState().phase, 'tour');
  assert.equal(useTutorial.getState().step, 0);
  useTutorial.getState().close();
  useTutorial.getState().start();
  assert.equal(useTutorial.getState().phase, 'tour', '두 번째도');
  useTutorial.getState().close();
});

test('진행: 첫 단계에서 [이전]은 그대로, 준비 끝 창의 [이전]은 마지막 단계로', () => {
  resetAll();
  useTutorial.getState().start();
  useTutorial.getState().prev();
  assert.equal(useTutorial.getState().step, 0);
  assert.equal(useTutorial.getState().phase, 'tour');
  useTutorial.setState({ phase: 'done', step: 0 });
  useTutorial.getState().prev();
  assert.equal(useTutorial.getState().phase, 'tour');
  assert.equal(useTutorial.getState().step, TOUR_STEPS.length - 1);
});

test('진행: [첫 잔 만들어 보기](finish) → 닫고 바텐더로, 안내 중에는 환영 창이 다시 열리지 않음', () => {
  resetAll();
  useTutorial.getState().start();
  useTutorial.getState().openWelcome();
  assert.equal(useTutorial.getState().phase, 'tour', '안내 중 openWelcome 은 무시');
  useTutorial.setState({ phase: 'done' });
  useTutorial.getState().finish();
  assert.equal(useTutorial.getState().phase, 'idle');
  assert.equal(useSettings.getState().tutorialSeen, true);
});

test('진행: 안내 중이 아니면 다음·이전은 아무것도 하지 않음', () => {
  resetAll();
  useTutorial.getState().next();
  useTutorial.getState().prev();
  assert.equal(useTutorial.getState().phase, 'idle');
  assert.deepEqual(moves, []);
});

test('기기 작업 중(제조·세척): 안내를 시작하지 않고(안내 토스트), 단계 이동·마치기에서 화면을 옮기지 않음 — 제조 화면을 떠나지 않게', () => {
  resetAll();
  const running = { id: 'm1', kind: 'make', status: 'running', totalMs: 10000, ackAt: 1 } as never;
  useDevice.setState({ job: running });
  try {
    useTutorial.getState().start();
    assert.equal(useTutorial.getState().phase, 'idle');
    assert.equal(useSettings.getState().tutorialSeen, false, '시작하지 않았으니 봤음으로 치지 않음');
    assert.match(useToast.getState().message ?? '', /기기가 작동 중/);
    // 이미 안내 중일 때 작업이 시작되면 다음 단계로 넘겨도 화면을 옮기지 않음
    useTutorial.setState({ phase: 'tour', step: 2 });
    useTutorial.getState().next();
    useTutorial.getState().finish();
    assert.deepEqual(moves, []);
  } finally {
    useDevice.setState({ job: null });
  }
});

test('suspend: 환영 창이면 봤음으로 치지 않고 닫음(작업이 끝나면 다시 뜸), 안내 중이면 닫고 봤음', () => {
  resetAll();
  useTutorial.getState().openWelcome();
  useTutorial.getState().suspend();
  assert.equal(useTutorial.getState().phase, 'idle');
  assert.equal(useSettings.getState().tutorialSeen, false);
  useTutorial.getState().start();
  useTutorial.getState().suspend();
  assert.equal(useTutorial.getState().phase, 'idle');
  assert.equal(useSettings.getState().tutorialSeen, true);
});

// ───────────────────────── 화면 (소스·CSS 검사) ─────────────────────────

test('말풍선은 aria-modal 창 — 안드로이드 뒤로 버튼(= Esc)이 안내를 닫음, 키보드 → ← Esc 지원', () => {
  const host = read('components', 'TutorialHost.tsx');
  assert.match(host, /role="dialog"\s+aria-modal="true"/);
  assert.match(host, /aria-labelledby=\{titleId\}/);
  assert.match(host, /e\.key === 'Escape'[\s\S]{0,80}close\(\)/);
  assert.match(host, /ArrowRight/);
  assert.match(host, /ArrowLeft/);
  // 다른 창이 위에 열려 있으면 키보드를 그 창에 맡김
  assert.match(host, /if \(otherDialogOpen\(\)\) return;/);
  // 뒤로 버튼은 aria-modal 창이 있으면 Esc 를 보냄 (backButton.ts)
  const back = read('platform', 'capacitor', 'backButton.ts');
  assert.match(back, /\[aria-modal="true"\]/);
  assert.match(back, /key: 'Escape'/);
  // App 의 전역 창 자리에 들어 있음
  assert.match(read('App.tsx'), /<TutorialHost \/>/);
});

test('화면: 기기가 작업을 시작하거나 제조·캘리브레이션 화면이 열리면 안내가 비킴, 안내 밖 화면 이동이면 닫음, sticky 대상은 굴리지 않음', () => {
  const host = read('components', 'TutorialHost.tsx');
  assert.match(host, /busy \|\| pathname === '\/brewing' \|\| pathname === '\/calibrate'\)\) useTutorial\.getState\(\)\.suspend\(\)/);
  assert.match(host, /TOUR_STEPS\[now\]\?\.route !== locationPath\(\)\) close\(\)/);
  assert.match(host, /pos === 'fixed' \|\| pos === 'sticky'/);
  // 화면 읽기: 단계를 넘기면 제목과 설명을 함께 읽음
  assert.match(host, /aria-live="polite"[\s\S]{0,200}\$\{def\.title\}\. \$\{def\.body\}/);
  // 시스템 영역 재기
  assert.match(read('components', 'tutorial.css'), /\.sb-tour__inset-probe \{[^}]*env\(safe-area-inset-bottom/);
});

test('CSS: 안내 층은 탭바·상단바 위, 다른 창·토스트 아래 / 건너뛰기 누르는 영역 44px / 움직임 줄이기 설정 존중', () => {
  const css = read('components', 'tutorial.css');
  const z = Number(/\.sb-tour \{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);
  const comp = read('ui', 'components.css');
  const modalZ = Number(/\.sb-modal \{[^}]*z-index:\s*(\d+)/.exec(comp)?.[1]);
  const appCss = read('app.css');
  const topbarZ = Number(/\.sb-topbar \{[^}]*z-index:\s*(\d+)/.exec(appCss)?.[1]);
  const tabbarZ = Number(/\.sb-tabbar \{[^}]*z-index:\s*(\d+)/.exec(appCss)?.[1]);
  assert.ok(z > topbarZ && z > tabbarZ, `안내 ${z} > 상단바 ${topbarZ}·탭바 ${tabbarZ}`);
  assert.ok(z < modalZ, `안내 ${z} < 창 ${modalZ}`);
  assert.match(css, /\.sb-tour__skip \{[^}]*min-height:\s*44px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('다시 보기: 설정 맨 위 [사용법 다시 보기]·바텐더 ? 버튼이 안내를 시작 (이미 봤어도)', () => {
  const settings = read('screens', 'settings', 'SettingsScreen.tsx');
  // 이미 봤으면 '사용법 다시 보기', 아직이면 '사용법 보기' — 어느 쪽이든 안내를 처음부터 시작
  assert.match(settings, /label=\{seen \? '사용법 다시 보기' : '사용법 보기'\}[^\n]*onClick=\{startTutorial\}/);
  // 찾기 쉽게 설정 화면 맨 위 — 2열(AI·기기…)보다 앞 (휴대폰에서 긴 AI 칸 아래로 묻히지 않게), 한 번만
  const body = settings.slice(settings.indexOf('export function SettingsScreen'));
  const at = body.indexOf('<TutorialSettings />');
  assert.ok(at > 0 && at < body.indexOf('<Columns'), '사용법 칸이 2열보다 앞');
  assert.equal(body.split('<TutorialSettings />').length - 1, 1);
  const home = read('screens', 'home', 'HomeScreen.tsx');
  assert.match(home, /label="사용법 보기" onClick=\{startTutorial\}/);
});
