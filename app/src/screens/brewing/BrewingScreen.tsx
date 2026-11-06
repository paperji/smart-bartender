/**
 * 제조 진행 화면 (전체 화면 — 내비 없음) · v2.1 src/app/brewing.tsx 의 기능·문구를 밝은 톤으로 옮김
 * 전체 진행 원(%·남은 시간), 펌프별 진행 막대(ml), 비상 정지, 완료 시 피드백(좋아요/별로예요)
 * → "한 잔 더 만들까요?" [예: 같은 입력으로 다시 추천] [아니요, 다른 걸 원해요: 탐색 모드] (SPEC §5.2)
 * 연결이 끊겼을 때: 다시 연결하는 중이면 그 안내 + [제조 화면 닫기], 재연결을 포기·하지 않으면
 * "연결 끊김" 안내 + [기기 탭에서 다시 연결] [제조 화면 닫기] (뒤로가기도 막지 않고 닫을지 물어봄 — 화면에 갇히지 않게)
 * 웹: 제조 중 화면 켜 두기(Wake Lock), 뒤로가기 막기(popstate), 탭 닫기 확인(beforeunload), 첫 제조 알림 권한(못 물어봤으면 여기서 버튼)
 * 배치: 모바일(<900px) 한 줄 — 진행 원 · 안내 · 펌프별 · (완료 카드) · 아래에 붙은 비상 정지,
 *       PC(≥900px) 2열 — 왼쪽(고정) 진행 원 + 비상 정지/닫기, 오른쪽 안내 · 펌프별 · 완료 카드
 */
import {
  Bell,
  BellRing,
  Bluetooth,
  BluetoothOff,
  CircleAlert,
  CircleCheck,
  CircleQuestionMark,
  Compass,
  Droplets,
  GlassWater,
  Hand,
  Hourglass,
  OctagonX,
  PartyPopper,
  Repeat,
  Send,
  ThumbsDown,
  ThumbsUp,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { colorFor, ColorProgress, ScreenBoundary } from '@/components';
import { brewSnapshotOf, jobHistoryId, setBrewingScreenOpen } from '@/lib/brew';
import { deviceClient } from '@/lib/device/client';
import { recommendAndShow } from '@/lib/flow';
import { fmtMl } from '@/lib/format';
import { back, go } from '@/lib/nav';
import { isWeb } from '@/platform/detect';
import { haptic } from '@/platform/haptics';
import { notificationsAvailable, notifyPermission, requestNotifyPermission } from '@/platform/notify';
import { useWakeLock } from '@/platform/useWakeLock';
import { wakeLockSupported } from '@/platform/wakeLock';
import { isBusy, useDevice, type JobState } from '@/store/device';
import { useSession } from '@/store/draft';
import { useHistory, type Feedback } from '@/store/history';
import { useSettings } from '@/store/settings';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';
import { alertMessage, Banner, Button, Card, confirmAsync, cx, EmptyState, Section, Text } from '@/ui';

import {
  brewHead,
  brewNotices,
  brewProgress,
  closeLabel,
  feedbackCaption,
  needsReconnectButton,
  progressCaption,
  pumpName,
  showsResultCards,
  type BrewIcon,
} from './brewingView';
import { dismissTo, useBrewBackGuard, useLeaveWarning, useToastLift } from './brewingNav';
import { ProgressRing } from './ProgressRing';

import './BrewingScreen.css';

const HEAD_ICONS: Record<BrewIcon, LucideIcon> = {
  hourglass: Hourglass,
  send: Send,
  pour: Droplets,
  check: CircleCheck,
  celebrate: PartyPopper,
  bluetooth: BluetoothOff,
  hand: Hand,
  help: CircleQuestionMark,
  alert: CircleAlert,
};

/** 알림 권한 안내를 이번 실행에서 닫았는지 (다시 켤 때까지 안 보임) */
let notifyCardDismissed = false;

function BrewingScreenContent() {
  const liveJob = useDevice((s) => s.job);
  const conn = useDevice((s) => s.conn);
  const reconnectAttempt = useDevice((s) => s.reconnectAttempt);
  const current = useSession((s) => s.current);
  const historyId = useSession((s) => s.brewHistoryId);
  const setFeedback = useHistory((s) => s.setFeedback);
  const slots = useSlots((s) => s.slots);
  const [now, setNow] = useState(() => Date.now());
  const [fb, setFb] = useState<Feedback>(null);
  const [stopping, setStopping] = useState(false);
  const [nexting, setNexting] = useState<'more' | 'explore' | null>(null);
  /** 화면을 닫는 중 — 작업 표시를 지운 뒤 화면이 바뀔 때까지 마지막 모습을 그대로 둠("작업 없음"이 깜빡이지 않게) */
  const [frozen, setFrozen] = useState<JobState | null>(null);
  const [notifyAsk, setNotifyAsk] = useState(false);
  const askingClose = useRef(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const stopHintId = useId();
  const exploreHintId = useId();

  const job = liveJob ?? frozen;
  const running = isBusy(liveJob);
  /** 작업 중인데 연결이 끊김 */
  const linkLost = running && conn !== 'connected';
  /** 자동으로 다시 연결하는 중 */
  const reconnecting = conn === 'reconnecting' || conn === 'connecting';
  const jobKey = liveJob ? (liveJob.localKey ?? liveJob.id) : null;

  // 진행 화면이 열려 있음을 알림 (재연결 뒤 진행 화면을 다시 열 때 중복 방지)
  useEffect(() => {
    setBrewingScreenOpen(true);
    return () => setBrewingScreenOpen(false);
  }, []);

  // 새 작업이면 피드백 선택을 비움
  useEffect(() => {
    if (jobKey) setFb(null);
  }, [jobKey]);

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [running]);

  // 제조 중 화면 켜 두기 (화면이 꺼지면 블루투스가 끊길 수 있음 — WEBAPP_DESIGN §7)
  useWakeLock(running);
  useLeaveWarning(running);
  useToastLift(actionsRef, running);

  // 첫 제조 알림 권한: startBrew 가 1번 물어보지만, 브라우저가 창을 띄우지 않았거나 닫기만 했으면(아직 '묻지 않음') 여기서 버튼으로
  useEffect(() => {
    if (!running || notifyCardDismissed || !notificationsAvailable()) {
      setNotifyAsk(false);
      return;
    }
    let alive = true;
    void notifyPermission().then((p) => {
      if (alive) setNotifyAsk(p === 'default');
    });
    return () => {
      alive = false;
    };
  }, [running]);

  /** 작업 표시를 지우고 화면을 떠남 (마지막 모습은 화면이 바뀔 때까지 유지) */
  const leave = (navigate: () => void) => {
    setFrozen(useDevice.getState().job ?? job);
    deviceClient.clearJob();
    navigate();
  };

  /** 닫기 — 앱 안 이전 화면으로 (없으면 바텐더) */
  const close = () => leave(() => back('/'));

  /**
   * 연결이 끊긴 채 작업 중일 때 닫기: 작업을 "결과 모름"으로 정리하고 닫음.
   * 닫아도 앱은 그 작업을 기억해 다시 연결되면 결과를 확인함(deviceClient.clearJob → pendingCheck):
   * 기기가 아직 만드는 중이면 진행 화면이 다시 열리고, 이미 끝났으면 실제 결과로 기록·잔량을 바로잡음
   */
  const closeWhileLost = async () => {
    if (askingClose.current) return;
    askingClose.current = true;
    try {
      const ok = await confirmAsync(
        '제조 화면을 닫을까요?',
        '연결이 끊겨 진행 상황을 확인할 수 없어요. 기기는 정해진 양까지만 부으니 기기와 잔을 직접 확인하세요. 다시 연결되면 아직 만드는 중일 때는 진행 화면을 다시 보여 드리고, 이미 끝났으면 실제 결과로 기록을 고쳐 둘게요.',
        { confirmText: '닫기', cancelText: '계속 기다리기' },
      );
      if (!ok) return;
      deviceClient.abandonJob();
      close();
    } finally {
      askingClose.current = false;
    }
  };

  /**
   * 기기 탭으로 가서 다시 연결 (제조 화면을 닫고 기기 화면으로).
   * 화면에서 지워도 결과를 모르는 작업은 앱이 기억해 두었다가 다시 연결되면 status.last 로 기록·잔량을 바로잡음 (SPEC §2.4 ②)
   */
  const goReconnect = () => {
    deviceClient.abandonJob();
    leave(() => go('/device', { replace: true }));
  };

  // 제조 중에는 뒤로가기로 닫히지 않게 (단, 연결이 끊겼으면 닫을지 물어봄 — 화면에 갇히지 않게)
  useBrewBackGuard(running, () => {
    if (linkLost) void closeWhileLost();
    else toast('제조 중이에요. 멈추려면 비상 정지를 누르세요.', 'warning');
  });

  const stop = async () => {
    setStopping(true);
    haptic.heavy();
    try {
      await deviceClient.stop();
    } catch {
      alertMessage('정지 명령을 보내지 못했어요', '기기의 빨간 정지 버튼을 직접 누르거나 전원을 분리하세요.');
    } finally {
      setStopping(false);
    }
  };

  const giveFeedback = (v: Feedback) => {
    setFb(v);
    haptic.tap();
    // 이 작업의 기록 (재연결 뒤 다시 열린 예전 작업이면 지금 세션의 기록이 아니라 그 작업의 기록)
    const target = jobHistoryId(job) ?? historyId;
    if (target) setFeedback(target, v);
    toast(v === 'like' ? '좋아요! 다음 추천에 반영할게요.' : '아쉬웠군요. 다음엔 다른 조합을 추천할게요.', 'success');
  };

  /** 한 잔 더 — 같은 입력(기분·맛·도수…)으로 다시 추천 → 레시피 화면 */
  const oneMore = async () => {
    if (!current || nexting) return;
    setNexting('more');
    try {
      const res = await recommendAndShow({ input: current.input, mode: 'normal' }, { nav: 'none' });
      if (res) {
        useSession.getState().setRejectStreak(0);
        leave(() => dismissTo('/recipe'));
      }
    } finally {
      setNexting(null);
    }
  };

  /** 아니요, 다른 걸 원해요 — 탐색(explore) 모드: 새 재료 1개로 만들 수 있는 레시피 */
  const wantDifferent = async () => {
    if (!current || nexting) return;
    setNexting('explore');
    try {
      const res = await recommendAndShow({ input: current.input, mode: 'explore' }, { nav: 'none', round: 0 });
      // v2.1 router.dismissTo('/explore') — 앞 기록에 탐색 화면이 있으면 그리로 돌아가고, 없으면 제조 화면 자리를 탐색 화면으로
      if (res) leave(() => dismissTo('/explore'));
    } finally {
      setNexting(null);
    }
  };

  const enableNotify = async () => {
    useSettings.getState().set({ notifyAsked: true });
    const granted = await requestNotifyPermission();
    setNotifyAsk(false);
    toast(
      granted ? '알림을 켰어요. 제조가 끝나면 알려 드릴게요.' : '알림이 꺼져 있어요. 완료되면 화면에서 알려 드릴게요.',
      granted ? 'success' : 'info',
    );
  };

  const dismissNotify = () => {
    notifyCardDismissed = true;
    setNotifyAsk(false);
  };

  if (!job) {
    return (
      <div className="brew-screen brew-tone--info">
        <div className="brew-empty">
          <EmptyState
            icon={GlassWater}
            title="진행 중인 작업이 없어요"
            action={
              <div className="brew-empty__btn">
                <Button size="lg" label="닫기" onClick={close} full />
              </div>
            }
          />
        </div>
      </div>
    );
  }

  const head = brewHead(job);
  const HeadIcon = HEAD_ICONS[head.icon];
  /** 이 작업을 시작할 때의 레시피 (재연결 뒤 다시 열린 예전 작업이면 지금 화면의 레시피와 다를 수 있음) */
  const jobRecipe = brewSnapshotOf(job)?.recipe ?? current?.recipe ?? null;
  const progress = brewProgress(job, now);
  const caption = progressCaption(job, progress);
  const notices = brewNotices(job, { linkLost, reconnecting, reconnectAttempt });
  const resultCards = showsResultCards(job);
  const oneMoreCard = resultCards && !!current;
  const showReconnect = !running && needsReconnectButton(job, conn, reconnecting);
  const wakeHint = running && isWeb() && !wakeLockSupported();

  return (
    <div className={cx('brew-screen', `brew-tone--${head.tone}`, running && 'is-running')}>
      <div className="brew-wrap">
        {/* 왼쪽(PC): 진행 원 + 비상 정지/닫기 */}
        <div className="brew-col brew-col--side">
          <section className="brew-hero" aria-labelledby="brew-title">
            <div className="brew-hero__titles">
              <h1 id="brew-title" className="brew-hero__title" aria-live="polite">
                {head.title}
              </h1>
              {job.kind === 'make' && jobRecipe ? <p className="brew-hero__recipe">{jobRecipe.name}</p> : null}
            </div>
            <ProgressRing
              pct={progress.pct}
              indeterminate={progress.indeterminate}
              ariaLabel="전체 진행률"
              valueText={caption ? `${progress.pct}%, ${caption}` : `${progress.pct}%`}
              className={cx(job.status === 'done' && 'is-done')}>
              <HeadIcon size={26} aria-hidden="true" className="brew-ring__icon" />
              <span className="brew-ring__pct sb-num">
                {progress.pct}
                <small>%</small>
              </span>
              {caption ? <span className="brew-ring__sub sb-num">{caption}</span> : null}
            </ProgressRing>
          </section>

          {running ? (
            <>
              <div ref={actionsRef} className="brew-actions brew-bottom is-running">
                <button
                  type="button"
                  className="brew-stop"
                  onClick={stop}
                  disabled={stopping}
                  aria-describedby={stopHintId}>
                  <OctagonX size={30} aria-hidden="true" />
                  <span>{stopping ? '정지 중…' : '비상 정지'}</span>
                </button>
                <span id={stopHintId} className="sr-only">
                  모든 펌프를 즉시 멈춰요
                </span>
                <Text variant="caption" tone="muted" align="center">
                  잔이 넘칠 것 같거나 이상하면 바로 누르세요. 기기의 정지 버튼도 언제든 쓸 수 있어요.
                </Text>
              </div>
              {linkLost || wakeHint ? (
                <div className="brew-lost">
                  {linkLost && !reconnecting ? (
                    <Button size="lg" icon={Bluetooth} label="기기 탭에서 다시 연결" onClick={goReconnect} full />
                  ) : null}
                  {linkLost ? (
                    <Button
                      variant="secondary"
                      icon={X}
                      label="제조 화면 닫기"
                      onClick={() => void closeWhileLost()}
                      full
                      title="연결이 끊겨 결과를 확인할 수 없는 상태로 진행 화면을 닫아요"
                    />
                  ) : null}
                  {wakeHint ? (
                    <Text variant="small" tone="muted" align="center" as="p">
                      이 브라우저는 화면 켜 두기를 지원하지 않아요. 제조가 끝날 때까지 화면이 꺼지지 않게 해 주세요.
                    </Text>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              {showReconnect ? (
                <div className="brew-reconnect brew-bottom">
                  <Button size="lg" icon={Bluetooth} label="기기 탭에서 다시 연결" onClick={goReconnect} full />
                </div>
              ) : null}
              <div className={cx('brew-actions', !showReconnect && !resultCards && 'brew-bottom')}>
                <Button size="lg" variant={oneMoreCard ? 'secondary' : 'primary'} label={closeLabel(job)} onClick={close} full />
              </div>
            </>
          )}
        </div>

        {/* 오른쪽(PC): 안내 · 펌프별 진행 · 완료 카드 */}
        <div className="brew-col brew-col--main">
          {notices.length || notifyAsk ? (
            <div className="brew-status">
              {notices.map((n) => (
                <Banner key={n.key} tone={n.tone} title={n.title} message={n.message} />
              ))}
              {notifyAsk ? (
                <Banner
                  tone="info"
                  icon={Bell}
                  title="완료 알림을 켤까요?"
                  message="다른 화면을 보고 있어도 제조가 끝나거나 멈추면 알림으로 알려 드려요."
                  action={{ label: '알림 켜기', icon: BellRing, onClick: () => void enableNotify() }}
                  onClose={dismissNotify}
                />
              ) : null}
            </div>
          ) : null}

          {running || job.pumps.length > 0 ? (
            <Section title="펌프별 진행" className="brew-pumps" gap={10}>
              <Card padded={false}>
                {job.pumps.length === 0 ? (
                  <Text variant="caption" tone="muted" className="brew-pumps__empty">
                    기기에서 진행 상황을 받는 중이에요…
                  </Text>
                ) : (
                  <ul className="brew-pumps__list">
                    {job.pumps.map((p) => {
                      const name = pumpName(p.p, jobRecipe, slots);
                      const ratio = p.target > 0 ? p.done / p.target : 0;
                      const active = running && !p.finished && p.done > 0;
                      return (
                        <li key={p.p} className="brew-pump">
                          <div className="brew-pump__head">
                            <span className="dc-dot" style={{ backgroundColor: colorFor(p.p, slots) }} aria-hidden="true" />
                            <span className="brew-pump__name">{name}</span>
                            <span className="brew-pump__no">펌프 {p.p}</span>
                            <span className={cx('brew-pump__ml', 'sb-num', p.finished ? 'is-done' : active && 'is-active')}>
                              {fmtMl(p.done)} / {fmtMl(p.target)}
                            </span>
                            {p.finished ? <CircleCheck size={18} className="brew-pump__check" aria-label="완료" role="img" /> : null}
                          </div>
                          <ColorProgress
                            value={ratio}
                            color={p.finished ? 'var(--green)' : colorFor(p.p, slots)}
                            ariaLabel={`${name} 진행`}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </Section>
          ) : null}

          {resultCards ? (
            <div className={cx('brew-result', !showReconnect && 'brew-bottom')}>
              <Card className="brew-card">
                <Text variant="heading" as="h2" align="center">
                  맛은 어떠셨나요?
                </Text>
                <div className="brew-fb-row">
                  <FeedbackButton icon={ThumbsUp} label="좋아요" active={fb === 'like'} onClick={() => giveFeedback('like')} />
                  <FeedbackButton icon={ThumbsDown} label="별로예요" active={fb === 'dislike'} onClick={() => giveFeedback('dislike')} />
                </div>
                <Text variant="caption" tone="muted" align="center">
                  {feedbackCaption(job)}
                </Text>
              </Card>
              {oneMoreCard ? (
                <Card tone={fb ? 'accent' : 'neutral'} className="brew-card">
                  <Text variant="heading" as="h2" align="center">
                    한 잔 더 만들까요?
                  </Text>
                  <Button
                    icon={Repeat}
                    label="예, 같은 취향으로 한 잔 더"
                    onClick={() => void oneMore()}
                    loading={nexting === 'more'}
                    disabled={!!nexting}
                    full
                  />
                  <Button
                    variant="secondary"
                    icon={Compass}
                    label="아니요, 다른 걸 원해요"
                    onClick={() => void wantDifferent()}
                    loading={nexting === 'explore'}
                    disabled={!!nexting}
                    full
                    aria-describedby={exploreHintId}
                  />
                  <span id={exploreHintId} className="sr-only">
                    새 재료 1개를 장착하면 만들 수 있는 레시피를 추천해요
                  </span>
                </Card>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FeedbackButton({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cx('brew-fb', active && 'is-active')} aria-pressed={active} onClick={onClick}>
      <Icon size={26} aria-hidden="true" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.18 : undefined} />
      <span>{label}</span>
    </button>
  );
}

/** 화면을 그리다 오류가 나도 앱 전체가 하얀 화면으로 멈추지 않게 복구 카드로 (components/ErrorBoundary) */
export function BrewingScreen() {
  return (
    <ScreenBoundary name="brewing">
      <BrewingScreenContent />
    </ScreenBoundary>
  );
}
