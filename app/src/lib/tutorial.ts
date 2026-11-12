/**
 * 사용법 안내(튜토리얼) — 단계 목록 · 자동으로 열지 판단 · 말풍선 위치 계산 (화면 없는 순수 로직, tests/tutorial.test.ts)
 *  - 처음 접속하면 환영 창: [사용법 보기] → 실제 화면을 차례로 열어 해당 칸을 밝게 비추며 설명 / [건너뛰기] → 바로 사용
 *  - 다시 보기(이미 봤어도): 설정 화면 맨 위 "사용법", 바텐더 화면 오른쪽 위 ? 버튼
 *  - 화면 쪽은 components/TutorialHost.tsx, 진행 상태는 store/tutorial.ts, "봤음" 표시는 settings.tutorialSeen
 * 단계의 target 은 화면 요소의 data-tour 값 — 그 화면 파일에 같은 값이 있어야 함 (테스트가 확인)
 */

export interface TourStep {
  /** 단계 이름 (기록·테스트용) */
  id: string;
  /** 이 단계를 보여 줄 화면 경로 (HashRouter 경로) */
  route: string;
  /** 밝게 비출 요소의 data-tour 값. 없으면 화면 가운데 설명 카드 */
  target?: string;
  title: string;
  body: string;
}

/** 안내 단계 — 화면 순서: 바텐더 → (레시피·제조 설명) → 재료 → 기기 → 공유 → 기록 → 설정 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'input',
    route: '/',
    target: 'home-input',
    title: '오늘의 기분과 취향 고르기',
    body: '바텐더 화면에서 기분·맛(단맛·신맛·쓴맛·탄산)·도수·날씨·상황을 골라요. 전부 고르지 않아도 되고, 마음에 드는 것만 골라도 돼요.',
  },
  {
    id: 'generate',
    route: '/',
    target: 'home-generate',
    title: 'AI 레시피 만들기',
    body: '누르면 기기 펌프에 장착된 재료만으로 레시피를 만들어요. AI 키가 없어도 앱에 들어 있는 오프라인 추천으로 바로 만들어져요.',
  },
  {
    id: 'recipe',
    route: '/',
    title: '레시피 확인 → 기기로 제조',
    body: '레시피 화면에서 재료별 양을 조정하고 [기기로 제조 시작]을 누르면 기기가 섞어 줘요. 제조 중에는 큰 [비상 정지] 버튼으로 언제든 멈출 수 있고, 마음에 들지 않으면 [다른 추천]을 눌러요.',
  },
  {
    id: 'ingredients',
    route: '/ingredients',
    target: 'ingredients-first',
    title: '재료 — 펌프마다 들어 있는 음료',
    body: '[재료] 메뉴에서 펌프 1~4번에 어떤 음료(또는 술)가 들어 있는지 등록해요. 카드를 누르면 이름·도수·남은 양을 바꿀 수 있어요. 처음에는 예시 재료가 들어 있어요.',
  },
  {
    id: 'device',
    route: '/device',
    target: 'device-conn',
    title: '기기 연결',
    body: '[기기] 메뉴에서 블루투스로 칵테일 메이커에 연결해요. 기기가 없어도 데모 모드(가상 기기)로 모든 기능을 그대로 써 볼 수 있어요 — 처음에는 데모 모드가 켜져 있어요.',
  },
  {
    id: 'calibrate',
    route: '/device',
    target: 'device-calibrate',
    title: '캘리브레이션 — 양을 정확하게',
    body: '실제 기기를 처음 쓸 때 한 번 해 주세요. 펌프마다 10초 동안 나온 양을 계량컵으로 재서 입력하면, 레시피 양이 정확해져요.',
  },
  {
    id: 'shared',
    route: '/shared',
    target: 'shared-top',
    title: '모두의 레시피',
    body: '[공유] 메뉴에서는 다른 사람이 공유한 레시피를 많이 만든 순으로 보고, 내 기기로 바로 만들 수 있어요. 내가 만든 레시피도 기록에서 공유할 수 있어요.',
  },
  {
    id: 'history',
    route: '/history',
    target: 'history-tabs',
    title: '기록과 즐겨찾기',
    body: '[기록] 메뉴에 만든 잔과 좋아요·즐겨찾기가 남아요. [다시 만들기]로 마음에 든 잔을 또 만들 수 있어요.',
  },
  {
    id: 'ai',
    route: '/settings',
    target: 'settings-ai',
    title: '내 AI 고르기 (선택)',
    body: '설정에서 Gemini·ChatGPT·Claude 등 내 AI 의 키를 등록하면 AI 가 레시피를 만들어요. 키 발급 방법도 여기 있어요. 키가 없어도 오프라인 추천으로 쓸 수 있어요.',
  },
];

/** 안내가 끝난 뒤 돌아갈 화면 */
export const TOUR_END_ROUTE = '/';

/** 자동으로 환영 창을 열지 판단하는 데 쓰는 상태 */
export interface AutoOpenContext {
  /** 저장된 설정을 다 불러왔는지 (불러오기 전의 기본값으로 판단하지 않게) */
  hydrated: boolean;
  /** 이미 안내를 봤거나 건너뛰었는지 (settings.tutorialSeen) */
  seen: boolean;
  /** 지금 화면 경로 */
  path: string;
  /** 기기가 작업 중 (제조·세척·구동) */
  busy: boolean;
  /** 다른 창(확인창·성인 확인·업데이트 안내 등)이 열려 있음 */
  dialogOpen: boolean;
  /** 안내가 이미 열려 있음 */
  active: boolean;
}

/** 안내를 자동으로 열지 않는 화면 — 제조 진행(전체 화면)·캘리브레이션(작업 중)·UI 키트(개발용) */
const NO_AUTO_PATHS = new Set(['/brewing', '/calibrate', '/ui']);

/** 처음 접속했을 때 환영 창을 열어도 되는지 */
export function shouldAutoOpen(ctx: AutoOpenContext): boolean {
  if (!ctx.hydrated || ctx.seen || ctx.active) return false;
  if (ctx.busy || ctx.dialogOpen) return false;
  return !NO_AUTO_PATHS.has(ctx.path);
}

// ───────────────────────── 말풍선 위치 ─────────────────────────

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 화면 가장자리의 시스템 영역(노치·상태 표시줄·안드로이드 내비게이션 바) — env(safe-area-inset-*) */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  width: number;
  height: number;
  /** 시스템 영역 (없으면 0) — APK 는 화면 끝까지 그리므로 innerHeight 에 내비게이션 바 자리까지 들어 있음 */
  inset?: Insets;
}

export interface TipPlacement {
  top: number;
  left: number;
  /**
   * below/above: 대상 아래/위 · right/left: 대상 오른쪽/왼쪽(가로로 넓고 낮은 화면) · center: 대상 없음(화면 가운데)
   * overlap: 어디에도 자리가 없어 대상과 겹침 — 대상의 반대쪽 끝(대상이 아래 절반이면 화면 위, 아니면 화면 아래)
   */
  side: 'below' | 'above' | 'right' | 'left' | 'center' | 'overlap';
}

/** 화면 가장자리와 말풍선 사이 최소 간격(px) */
export const TIP_MARGIN = 12;
/** 대상과 말풍선 사이 간격(px) */
export const TIP_GAP = 12;
/** 비추는 칸이 대상보다 넓은 정도(px) */
export const HOLE_PAD = 6;
/** 비추는 칸의 최대 높이 = 화면 높이 × 이 값 (긴 목록은 윗부분만 비춤 — 말풍선 자리를 남기게) */
export const HOLE_MAX_RATIO = 0.45;
/** 낮은 화면(가로로 든 휴대폰 등, 높이 < LOW_SCREEN)에서는 칸을 더 낮게 */
export const HOLE_MAX_RATIO_LOW = 0.3;
export const LOW_SCREEN = 520;

const NO_INSET: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const insetOf = (vp: Viewport): Insets => vp.inset ?? NO_INSET;

/** 비출 칸의 최대 높이 비율 (낮은 화면은 더 작게) */
export function holeMaxRatio(vp: Viewport): number {
  return vp.height < LOW_SCREEN ? HOLE_MAX_RATIO_LOW : HOLE_MAX_RATIO;
}

/** 말풍선 폭: 최대 360px, 좁은 화면은 (시스템 영역을 빼고) 양옆 12px 만 남기고 꽉 채움 */
export function tipWidth(vp: Viewport): number {
  const i = insetOf(vp);
  return Math.max(0, Math.min(360, vp.width - i.left - i.right - TIP_MARGIN * 2));
}

/**
 * 비출 칸 — 대상 상자에 여백(HOLE_PAD)을 두르고, 너무 길면 윗부분만(화면 높이 × holeMaxRatio), 화면 밖은 잘라 냄.
 * 대상이 화면에 하나도 안 보이면 null
 */
export function holeBox(target: Box, vp: Viewport): Box | null {
  const top = Math.max(0, target.top - HOLE_PAD);
  const left = Math.max(0, target.left - HOLE_PAD);
  const right = Math.min(vp.width, target.left + target.width + HOLE_PAD);
  const fullBottom = Math.min(vp.height, target.top + target.height + HOLE_PAD);
  const bottom = Math.min(fullBottom, top + Math.round(vp.height * holeMaxRatio(vp)));
  if (right - left < 4 || bottom - top < 4) return null;
  return { top, left, width: right - left, height: bottom - top };
}

/**
 * 말풍선 자리 — 대상(비춘 칸) 아래가 넉넉하면 아래, 아니면 위, 아니면 옆(오른쪽 → 왼쪽),
 * 어디에도 없으면 대상의 반대쪽 끝에 겹쳐 놓음. 시스템 영역(inset)과 가장자리 12px 를 늘 피함.
 * 가로는 대상 가운데에 맞추고 화면 안으로 당김. 대상이 없으면 화면 가운데
 */
export function placeTip(hole: Box | null, tip: { width: number; height: number }, vp: Viewport): TipPlacement {
  const i = insetOf(vp);
  const minX = i.left + TIP_MARGIN;
  const maxX = Math.max(minX, vp.width - i.right - TIP_MARGIN - tip.width);
  const minY = i.top + TIP_MARGIN;
  const maxY = Math.max(minY, vp.height - i.bottom - TIP_MARGIN - tip.height);
  const clampX = (x: number) => Math.min(Math.max(minX, x), maxX);
  const clampY = (y: number) => Math.min(Math.max(minY, y), maxY);
  if (!hole) {
    const usableH = vp.height - i.top - i.bottom;
    const usableW = vp.width - i.left - i.right;
    return { top: clampY(i.top + (usableH - tip.height) / 2), left: clampX(i.left + (usableW - tip.width) / 2), side: 'center' };
  }
  const holeBottom = hole.top + hole.height;
  const holeRight = hole.left + hole.width;
  const left = clampX(hole.left + hole.width / 2 - tip.width / 2);
  const below = vp.height - i.bottom - holeBottom - TIP_GAP - TIP_MARGIN;
  const above = hole.top - TIP_GAP - TIP_MARGIN - i.top;
  if (below >= tip.height) return { top: holeBottom + TIP_GAP, left, side: 'below' };
  if (above >= tip.height) return { top: hole.top - TIP_GAP - tip.height, left, side: 'above' };
  const midY = clampY(hole.top + hole.height / 2 - tip.height / 2);
  if (vp.width - i.right - TIP_MARGIN - (holeRight + TIP_GAP) >= tip.width) return { top: midY, left: holeRight + TIP_GAP, side: 'right' };
  if (hole.left - TIP_GAP - TIP_MARGIN - i.left >= tip.width) return { top: midY, left: hole.left - TIP_GAP - tip.width, side: 'left' };
  // 겹칠 수밖에 없음 — 대상이 화면 아래 절반이면(모바일 아래 버튼 줄 등) 말풍선은 위로, 아니면 아래로
  const holeMid = hole.top + hole.height / 2;
  return { top: holeMid > vp.height / 2 ? minY : maxY, left, side: 'overlap' };
}
