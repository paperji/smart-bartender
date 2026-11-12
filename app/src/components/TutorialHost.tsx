/**
 * 사용법 안내(튜토리얼) 화면 — App 의 전역 창 자리(Hosts)에 한 번 둠
 *  - 처음 접속: 환영 창 [사용법 보기] / [건너뛰기] (lib/tutorial.shouldAutoOpen 조건일 때 자동으로)
 *  - 안내: 단계마다 그 화면으로 이동 → data-tour 요소를 찾아 화면에 보이게 굴린 뒤 그 칸만 밝게 비추고 옆에 말풍선
 *          (요소를 못 찾으면 화면 가운데 설명 카드). 안내 중에는 뒤 화면을 누를 수 없음(실수로 다른 화면으로 가지 않게)
 *  - 키보드: → 다음 · ← 이전 · Esc 그만 보기 (안드로이드 뒤로 버튼도 Esc — platform/capacitor/backButton)
 *  - 마지막: "준비 끝" 창 [첫 잔 만들어 보기] → 바텐더 화면 + 안내 토스트 / [닫기]
 * 진행 상태: store/tutorial.ts, 단계·위치 계산: lib/tutorial.ts
 */
import { ArrowLeft, ArrowRight, Bluetooth, Check, PlayCircle, Sparkles } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';

import { locationPath } from '@/lib/nav';
import { holeBox, placeTip, shouldAutoOpen, tipWidth, TOUR_STEPS, type Box, type Insets, type Viewport } from '@/lib/tutorial';
import { isBusy, useDevice } from '@/store/device';
import { useSettings } from '@/store/settings';
import { toast } from '@/store/toast';
import { useTutorial } from '@/store/tutorial';
import { Button, cx, Modal } from '@/ui';

import './tutorial.css';

/** 화면 위에 열린 창(확인창·성인 확인·업데이트 안내 등). 안내 말풍선 자신은 빼고 셈 */
function otherDialogOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return Array.from(document.querySelectorAll('[aria-modal="true"]')).some((el) => !el.closest('.sb-tour'));
}

/** 안내 창이 닫힌 뒤 초점 — 이전 요소가 사라졌으면(환영 창 버튼 등) 본문으로 (화면 읽기·키보드 사용자가 길을 잃지 않게) */
function restoreFocus(prev: HTMLElement | null) {
  if (typeof document === 'undefined') return;
  if (prev?.isConnected && prev !== document.body) prev.focus({ preventScroll: true });
  else document.getElementById('sb-main')?.focus({ preventScroll: true });
}

const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ───────────────────────── 처음 접속하면 자동으로 환영 창 ───────────────────────── */

function useAutoOpen(path: string) {
  const seen = useSettings((s) => s.tutorialSeen);
  const phase = useTutorial((s) => s.phase);
  useEffect(() => {
    if (seen || phase !== 'idle') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryOpen = () => {
      const ctx = {
        hydrated: useSettings.persist?.hasHydrated?.() ?? true,
        seen: useSettings.getState().tutorialSeen,
        path: locationPath(),
        busy: isBusy(useDevice.getState().job),
        dialogOpen: otherDialogOpen(),
        active: useTutorial.getState().phase !== 'idle',
      };
      if (shouldAutoOpen(ctx)) useTutorial.getState().openWelcome();
      // 다른 창이 닫히거나 기기 작업이 끝나기를 기다렸다가 다시 봄 (봤거나 이미 열렸으면 그만)
      else if (!ctx.seen && !ctx.active) timer = setTimeout(tryOpen, 1000);
    };
    // 첫 화면이 다 그려진 뒤 (업데이트 안내처럼 시작하자마자 뜨는 창이 먼저 자리 잡게)
    timer = setTimeout(tryOpen, 700);
    return () => clearTimeout(timer);
  }, [path, seen, phase]);
}

/* ───────────────────────── 환영 창 ───────────────────────── */

/** 창을 닫은 뒤 초점이 갈 곳이 없으면(처음 접속 — 아무것도 누르기 전에 뜬 창) 본문으로 */
const focusMainSoon = () =>
  requestAnimationFrame(() => {
    if (document.activeElement === document.body || !document.activeElement) restoreFocus(null);
  });

/** 창이 열릴 때 주 버튼(아래 버튼 줄)에 초점을 주면 낮은 화면에서 창이 맨 아래까지 굴러감 → 맨 위(제목)부터 보이게 되돌림 */
function useScrollTopOnOpen(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => document.querySelector('.sb-welcome')?.scrollTo?.({ top: 0 }));
    return () => cancelAnimationFrame(raf);
  }, [open]);
}

function WelcomeDialog({ open }: { open: boolean }) {
  const start = useTutorial((s) => s.start);
  const closeTour = useTutorial((s) => s.close);
  const close = () => {
    closeTour();
    focusMainSoon();
  };
  useScrollTopOnOpen(open);
  const titleId = useId();
  const descId = useId();
  return (
    <Modal
      open={open}
      onClose={close}
      closeOnBackdrop={false}
      size="sm"
      labelledBy={titleId}
      describedBy={descId}
      initialFocus=".sb-welcome__start"
      className="sb-welcome"
      footer={
        <div className="sb-welcome__actions">
          <Button variant="secondary" label="건너뛰기" onClick={close} />
          <Button className="sb-welcome__start" icon={PlayCircle} label="사용법 보기 (1분)" onClick={start} />
        </div>
      }>
      <div className="sb-welcome__hero" aria-hidden="true">
        <Sparkles size={28} />
      </div>
      <h2 id={titleId} className="sb-welcome__title">
        AI 스마트 바텐더에 오신 걸 환영해요
      </h2>
      <p id={descId} className="sb-welcome__lead">
        처음이라면 1분 사용법으로 화면을 하나씩 둘러봐요. 이미 써 보셨다면 [건너뛰기]를 눌러 바로 시작하세요.
      </p>
      <ul className="sb-welcome__points">
        <li>
          <Sparkles size={18} aria-hidden="true" />
          <span>기분과 취향을 고르면 AI 가 지금 장착된 재료로 레시피를 만들어요.</span>
        </li>
        <li>
          <Bluetooth size={18} aria-hidden="true" />
          <span>블루투스로 칵테일 메이커에 보내면 기기가 음료를 섞어 줘요.</span>
        </li>
        <li>
          <PlayCircle size={18} aria-hidden="true" />
          <span>기기가 없어도 데모 모드(가상 기기)로 처음부터 끝까지 체험할 수 있어요.</span>
        </li>
      </ul>
      <p className="sb-welcome__note">사용법은 언제든 설정 화면 맨 위 [사용법 다시 보기]나 바텐더 화면 오른쪽 위 ? 버튼으로 다시 볼 수 있어요.</p>
    </Modal>
  );
}

/* ───────────────────────── 마지막 "준비 끝" 창 ───────────────────────── */

function DoneDialog({ open }: { open: boolean }) {
  const finish = useTutorial((s) => s.finish);
  const closeTour = useTutorial((s) => s.close);
  const close = () => {
    closeTour();
    focusMainSoon();
  };
  const prev = useTutorial((s) => s.prev);
  const titleId = useId();
  const descId = useId();
  useScrollTopOnOpen(open);
  const tryFirst = () => {
    finish();
    // 창이 닫히고 바텐더 화면이 그려진 뒤 본문에 초점
    requestAnimationFrame(() => restoreFocus(null));
    toast('기분을 하나 고르고 [AI 레시피 만들기]를 눌러 보세요. 데모 모드면 기기 없이도 제조까지 볼 수 있어요.', 'info');
  };
  return (
    <Modal
      open={open}
      onClose={close}
      closeOnBackdrop={false}
      size="sm"
      labelledBy={titleId}
      describedBy={descId}
      initialFocus=".sb-welcome__start"
      className="sb-welcome"
      footer={
        <div className="sb-welcome__actions">
          <Button variant="ghost" icon={ArrowLeft} label="이전" onClick={prev} />
          <Button variant="secondary" label="닫기" onClick={close} />
          <Button className="sb-welcome__start" icon={Sparkles} label="첫 잔 만들어 보기" onClick={tryFirst} />
        </div>
      }>
      <div className="sb-welcome__hero sb-welcome__hero--done" aria-hidden="true">
        <Check size={28} />
      </div>
      <h2 id={titleId} className="sb-welcome__title">
        준비 끝!
      </h2>
      <p id={descId} className="sb-welcome__lead">
        이제 직접 한 잔 만들어 볼까요? 바텐더 화면에서 기분을 고르고 [AI 레시피 만들기]를 누르면 돼요. 데모 모드라면 기기 없이도 제조
        과정까지 볼 수 있어요.
      </p>
      <p className="sb-welcome__note">사용법은 설정 화면 맨 위 [사용법 다시 보기]에서 언제든 다시 볼 수 있어요.</p>
    </Modal>
  );
}

/* ───────────────────────── 안내 (비추기 + 말풍선) ───────────────────────── */

/** 시스템 영역(env(safe-area-inset-*)) 재기 — 숨은 고정 요소의 padding 으로 (APK 는 화면 끝까지 그려 내비게이션 바가 겹침) */
let insetProbe: HTMLDivElement | null = null;
function readInsets(): Insets {
  if (typeof document === 'undefined') return { top: 0, right: 0, bottom: 0, left: 0 };
  if (!insetProbe || !insetProbe.isConnected) {
    insetProbe = document.createElement('div');
    insetProbe.className = 'sb-tour__inset-probe';
    insetProbe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(insetProbe);
  }
  const cs = getComputedStyle(insetProbe);
  const px = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
}

const sameInsets = (a?: Insets, b?: Insets) =>
  !!a && !!b && a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

const viewport = (): Viewport => ({
  width: typeof window === 'undefined' ? 360 : window.innerWidth,
  height: typeof window === 'undefined' ? 640 : window.innerHeight,
  inset: readInsets(),
});

/** data-tour 값이 같은 요소 중 지금 보이는 첫 요소 (모바일 아래 버튼 줄 / PC 오른쪽 카드처럼 같은 값이 둘일 수 있음) */
function findVisible(id: string): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`));
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

/** 위치가 고정된 요소(모바일 아래 버튼 줄 sticky · PC 오른쪽 따라오는 카드 sticky 등)는 이미 보이므로 굴리지 않음 */
function isPinned(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    const pos = getComputedStyle(n).position;
    if (pos === 'fixed' || pos === 'sticky') return true;
  }
  return false;
}

/** 대상이 화면 위쪽 1/4 쯤에 오게 굴림 (아래에 말풍선 자리를 남김). 이미 그 근처면 그대로 */
function scrollToTarget(el: HTMLElement) {
  if (isPinned(el)) return;
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const want = Math.max(72, Math.round(vh * 0.2));
  if (r.top >= want - 8 && r.top <= vh * 0.45) return;
  window.scrollTo({ top: Math.max(0, window.scrollY + r.top - want), behavior: reduceMotion() ? 'auto' : 'smooth' });
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function TourOverlay() {
  const step = useTutorial((s) => s.step);
  const next = useTutorial((s) => s.next);
  const prev = useTutorial((s) => s.prev);
  const close = useTutorial((s) => s.close);
  const def = TOUR_STEPS[step];
  const total = TOUR_STEPS.length;
  const { pathname } = useLocation();
  const titleId = useId();
  const bodyId = useId();
  const tipRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [searching, setSearching] = useState(!!def?.target);
  /** 대상이 사라지면(창 폭이 바뀌어 다른 버튼이 보이게 됨 등) 다시 찾기 */
  const [seek, setSeek] = useState(0);
  const [rect, setRect] = useState<Box | null>(null);
  const [vp, setVp] = useState<Viewport>(viewport);
  const [tipH, setTipH] = useState(220);
  /** 안내를 열기 직전의 초점 (? 버튼 등) — 첫 그림 때 잡음(아래 효과가 [다음]으로 초점을 옮기기 전에) */
  const [prevFocus] = useState<HTMLElement | null>(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  /** 화면 읽기용 단계 안내 — 첫 단계는 창 이름·설명으로 읽히므로 비워 두고, 넘길 때마다 제목과 설명을 함께 */
  const firstStep = useRef(step);

  // 단계 화면에 도착하면 대상 찾기 (화면이 그려지고 목록이 불러와질 때까지 잠깐 기다림, 최대 2.5초)
  useEffect(() => {
    setTarget(null);
    setRect(null);
    if (!def?.target) {
      setSearching(false);
      return;
    }
    setSearching(true);
    if (pathname !== def.route) return; // 이동이 끝나면 다시 들어옴
    const id = def.target;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      const el = findVisible(id);
      if (el) {
        scrollToTarget(el);
        setTarget(el);
        setSearching(false);
        return;
      }
      if (Date.now() - started > 2500) {
        setSearching(false); // 못 찾음 → 가운데 설명 카드
        return;
      }
      timer = setTimeout(look, 80);
    };
    timer = setTimeout(look, 60);
    return () => clearTimeout(timer);
  }, [def, pathname, seek]);

  // 대상 위치 따라가기 (부드럽게 굴러가는 동안·목록이 늘어날 때·창 크기가 바뀔 때)
  useEffect(() => {
    if (!target) return;
    let raf = 0;
    let last: Box | null = null;
    const tick = () => {
      if (!target.isConnected) {
        setSeek((n) => n + 1);
        return;
      }
      const r = target.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        setSeek((n) => n + 1);
        return;
      }
      const box: Box = { top: r.top, left: r.left, width: r.width, height: r.height };
      if (!sameBox(box, last)) {
        last = box;
        setRect(box);
      }
      const v = viewport();
      setVp((p) => (p.width === v.width && p.height === v.height && sameInsets(p.inset, v.inset) ? p : v));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  // 대상 없는 단계에서도 창 크기를 따라감
  useEffect(() => {
    const onResize = () => setVp(viewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 말풍선 높이 재기 (글 길이·폭에 따라 다름)
  useLayoutEffect(() => {
    const h = tipRef.current?.offsetHeight;
    if (h && Math.abs(h - tipH) > 1) setTipH(h);
  });

  // 단계가 바뀌면 [다음]에 초점 (화면 읽기 프로그램은 아래 aria-live 로 새 단계를 읽음)
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [step]);

  // 키보드: Esc 그만 · → 다음 · ← 이전 · Tab 은 말풍선 안에서만 (다른 창이 위에 열려 있으면 그 창에 맡김)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (otherDialogOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      const inField = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (!inField && e.key === 'ArrowRight') {
        e.preventDefault();
        next();
        return;
      }
      if (!inField && e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
        return;
      }
      if (e.key !== 'Tab' || !tipRef.current) return;
      const items = Array.from(tipRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const lastEl = items[items.length - 1];
      if (!tipRef.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [close, next, prev]);

  // 안내가 끝나면 원래 초점으로 — 다음 그림 때 ("준비 끝" 창으로 넘어가면 그 창이 초점을 가져가므로 그대로 둠)
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        if (!document.querySelector('.sb-modal')) restoreFocus(prevFocus);
      });
    },
    [prevFocus],
  );

  // 안내 밖에서 화면이 바뀜(브라우저 뒤로·앞으로 등) — 단계 화면으로 돌아오지 않으면 안내를 닫음 (설명과 화면이 어긋난 채 남지 않게)
  useEffect(() => {
    if (!def || pathname === def.route) return;
    const t = setTimeout(() => {
      const { phase, step: now } = useTutorial.getState();
      if (phase === 'tour' && TOUR_STEPS[now]?.route !== locationPath()) close();
    }, 1500);
    return () => clearTimeout(t);
  }, [def, pathname, close]);

  if (!def || typeof document === 'undefined') return null;
  const hole = target && rect ? holeBox(rect, vp) : null;
  const width = tipWidth(vp);
  const place = placeTip(hole, { width, height: tipH }, vp);
  const last = step >= total - 1;

  return createPortal(
    <div className={cx('sb-tour', !hole && 'sb-tour--plain')}>
      {/* 뒤 화면 누름 막기 (비춘 칸도 눌리지 않음 — 안내 중에 다른 화면으로 가지 않게) */}
      <div className="sb-tour__shade" aria-hidden="true" />
      {hole ? <div className="sb-tour__hole" aria-hidden="true" style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} /> : null}
      <div
        ref={tipRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={cx('sb-tour__tip', `is-${place.side}`)}
        style={{ top: place.top, left: place.left, width }}>
        <div className="sb-tour__head">
          <span className="sb-tour__count sb-num">
            {step + 1} / {total}
          </span>
          <button type="button" className="sb-tour__skip" onClick={close}>
            건너뛰기
          </button>
        </div>
        <h2 id={titleId} className="sb-tour__title">
          {def.title}
        </h2>
        <p id={bodyId} className="sb-tour__body">
          {def.body}
        </p>
        {searching ? <p className="sb-tour__hint">화면을 여는 중…</p> : null}
        <div className="sb-tour__dots" aria-hidden="true">
          {TOUR_STEPS.map((s, i) => (
            <span key={s.id} className={cx('sb-tour__dot', i === step && 'is-on', i < step && 'is-past')} />
          ))}
        </div>
        <div className="sb-tour__actions">
          <Button variant="secondary" size="sm" icon={ArrowLeft} label="이전" onClick={prev} disabled={step === 0} />
          <Button ref={nextRef} size="sm" iconRight={last ? Check : ArrowRight} label={last ? '마치기' : '다음'} onClick={next} />
        </div>
        <p className="sr-only" aria-live="polite">
          {step === firstStep.current ? '' : `${step + 1}번째 안내, 모두 ${total}개 중. ${def.title}. ${def.body}`}
        </p>
      </div>
    </div>,
    document.body,
  );
}

/* ───────────────────────── 전역 자리 ───────────────────────── */

export function TutorialHost() {
  const phase = useTutorial((s) => s.phase);
  const busy = useDevice((s) => isBusy(s.job));
  const { pathname } = useLocation();
  useAutoOpen(pathname);
  // 기기가 작업을 시작했거나(재연결 뒤 진행 중 제조를 찾음 등) 제조·캘리브레이션 화면이 열리면 바로 비킴 — 비상 정지를 가리지 않게
  useEffect(() => {
    if (phase !== 'idle' && (busy || pathname === '/brewing' || pathname === '/calibrate')) useTutorial.getState().suspend();
  }, [phase, busy, pathname]);
  return (
    <>
      <WelcomeDialog open={phase === 'welcome'} />
      {phase === 'tour' ? <TourOverlay /> : null}
      <DoneDialog open={phase === 'done'} />
    </>
  );
}
