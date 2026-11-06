/**
 * 제조 진행 화면 (전체 화면 모달)
 * 펌프별 진행 바, 전체 %, 남은 시간, 비상 정지, 완료 시 피드백(좋아요/별로예요)
 * → "한 잔 더 만들까요?" [예: 같은 입력으로 다시 추천] [아니요, 다른 걸 원해요: 탐색 모드] (SPEC §5.2)
 * 연결이 끊겼을 때: 다시 연결하는 중이면 그 안내 + [제조 화면 닫기], 재연결을 포기·하지 않으면
 * "연결 끊김" 안내 + [닫기] [기기 탭에서 다시 연결] (뒤로가기도 막지 않음 — 화면에 갇히지 않게)
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colorFor } from '@/components/RecipeBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Banner, ProgressBar } from '@/components/ui/feedback';
import { Row } from '@/components/ui/layout';
import { AppText } from '@/components/ui/Text';
import { colors, MAX_CONTENT_WIDTH, radius, space } from '@/constants/theme';
import { brewSnapshotOf, jobHistoryId, setBrewingScreenOpen, stopReasonText } from '@/lib/brew';
import { deviceClient } from '@/lib/device/client';
import { recommendAndShow } from '@/lib/flow';
import { alertMessage, confirmAsync, fmtDuration, fmtMl, haptic } from '@/lib/ui';
import { isBusy, useDevice } from '@/store/device';
import { useSession } from '@/store/draft';
import { useHistory, type Feedback } from '@/store/history';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';

export default function BrewingScreen() {
  const insets = useSafeAreaInsets();
  const job = useDevice((s) => s.job);
  const conn = useDevice((s) => s.conn);
  const reconnectAttempt = useDevice((s) => s.reconnectAttempt);
  const current = useSession((s) => s.current);
  const historyId = useSession((s) => s.brewHistoryId);
  const setFeedback = useHistory((s) => s.setFeedback);
  const slots = useSlots((s) => s.slots);
  const [now, setNow] = useState(Date.now());
  const [fb, setFb] = useState<Feedback>(null);
  const [stopping, setStopping] = useState(false);
  const [nexting, setNexting] = useState(false);
  const running = isBusy(job);
  /** 작업 중인데 연결이 끊김 */
  const linkLost = running && conn !== 'connected';
  /** 자동으로 다시 연결하는 중 */
  const reconnecting = conn === 'reconnecting' || conn === 'connecting';

  // 진행 화면이 열려 있음을 알림 (재연결 뒤 진행 화면을 다시 열 때 중복 방지)
  useEffect(() => {
    setBrewingScreenOpen(true);
    return () => setBrewingScreenOpen(false);
  }, []);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [running]);

  const close = () => {
    deviceClient.clearJob();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  /**
   * 연결이 끊긴 채 작업 중일 때 닫기: 작업을 "결과 모름"으로 정리하고 닫음.
   * 닫아도 앱은 그 작업을 기억해 다시 연결되면 결과를 확인함(deviceClient.clearJob → pendingCheck):
   * 기기가 아직 만드는 중이면 진행 화면이 다시 열리고, 이미 끝났으면 실제 결과로 기록·잔량을 바로잡음
   */
  const closeWhileLost = async () => {
    const ok = await confirmAsync(
      '제조 화면을 닫을까요?',
      '연결이 끊겨 진행 상황을 확인할 수 없어요. 기기는 정해진 양까지만 부으니 기기와 잔을 직접 확인하세요. 다시 연결되면 아직 만드는 중일 때는 진행 화면을 다시 보여 드리고, 이미 끝났으면 실제 결과로 기록을 고쳐 둘게요.',
      { confirmText: '닫기', cancelText: '계속 기다리기' },
    );
    if (!ok) return;
    deviceClient.abandonJob();
    close();
  };

  /**
   * 기기 탭으로 가서 다시 연결 (제조 화면을 닫고 탭 화면으로).
   * 화면에서 지워도 결과를 모르는 작업은 앱이 기억해 두었다가 다시 연결되면 status.last 로 기록·잔량을 바로잡음 (SPEC §2.4 ②)
   */
  const goReconnect = () => {
    deviceClient.abandonJob();
    deviceClient.clearJob();
    if (router.canDismiss()) router.dismissAll();
    router.navigate('/device');
  };

  // 제조 중에는 뒤로가기로 닫히지 않게 (단, 연결이 끊겼으면 닫을지 물어봄 — 화면에 갇히지 않게)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!running) return false;
      if (linkLost) {
        closeWhileLost();
        return true;
      }
      toast('제조 중이에요. 멈추려면 비상 정지를 누르세요.', 'warning');
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, linkLost]);

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
    setNexting(true);
    try {
      const res = await recommendAndShow({ input: current.input, mode: 'normal' }, { nav: 'none' });
      if (res) {
        useSession.getState().setRejectStreak(0);
        deviceClient.clearJob();
        router.dismissTo('/recipe');
      }
    } finally {
      setNexting(false);
    }
  };

  /** 아니요, 다른 걸 원해요 — 탐색(explore) 모드: 새 재료 1개로 만들 수 있는 레시피 */
  const wantDifferent = async () => {
    if (!current || nexting) return;
    setNexting(true);
    try {
      const res = await recommendAndShow({ input: current.input, mode: 'explore' }, { nav: 'none', round: 0 });
      if (res) {
        deviceClient.clearJob();
        router.dismissTo('/explore');
      }
    } finally {
      setNexting(false);
    }
  };

  if (!job) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + space.xl }]}>
        <View style={styles.inner}>
          <AppText variant="title" align="center">
            진행 중인 작업이 없어요
          </AppText>
          <Button label="닫기" onPress={close} />
        </View>
      </View>
    );
  }

  const kindLabel = job.kind === 'make' ? '제조' : job.kind === 'run' ? '펌프 구동' : '세척';
  /** 이 작업을 시작할 때의 레시피 (재연결 뒤 다시 열린 예전 작업이면 지금 화면의 레시피와 다를 수 있음) */
  const jobRecipe = brewSnapshotOf(job)?.recipe ?? current?.recipe ?? null;
  const elapsed = job.ackAt ? now - job.ackAt : 0;
  const timePct = job.totalMs > 0 ? Math.min(99, (elapsed / job.totalMs) * 100) : 0;
  const pct = job.status === 'done' ? 100 : Math.round(Math.max(job.pct, running && job.ackAt ? timePct : 0));
  const remaining = job.totalMs > 0 ? Math.max(0, job.totalMs - elapsed) : 0;
  const nameOf = (p: number) =>
    jobRecipe?.ingredients.find((i) => i.pump === p)?.name ?? slots.find((s) => s.pump === p)?.name ?? `펌프 ${p}`;
  const dispensedTotal = (job.dispensed ?? []).reduce((a, b) => a + b.ml, 0);

  const status = job.status;
  /** 연결이 끊긴 동안 끝나거나 정리돼 결과를 정확히 모름 */
  const lostResult = !running && (job.reason === 'disconnected' || job.reason === 'unknown' || job.reason === 'reboot');
  const head =
    status === 'pending'
      ? job.uncertain
        ? { icon: 'hourglass' as const, color: colors.info, title: '기기 응답을 확인하는 중…' }
        : { icon: 'paper-plane' as const, color: colors.info, title: '기기로 레시피를 보내는 중…' }
      : status === 'running'
        ? { icon: 'water' as const, color: colors.primary, title: `${kindLabel} 중이에요` }
        : status === 'done'
          ? job.uncertain
            ? { icon: 'checkmark-circle' as const, color: colors.success, title: '연결이 끊긴 사이에 끝났어요' }
            : { icon: 'checkmark-circle' as const, color: colors.success, title: job.kind === 'make' ? '완성! 맛있게 즐기세요' : `${kindLabel} 완료` }
          : status === 'stopped'
            ? job.reason === 'disconnected'
              ? { icon: 'bluetooth' as const, color: colors.warning, title: '연결이 끊겼어요' }
              : { icon: 'hand-left' as const, color: colors.warning, title: `${kindLabel}${job.kind === 'make' ? '를' : '을'} 중단했어요` }
            : job.uncertain
              ? { icon: 'help-circle' as const, color: colors.warning, title: `${kindLabel} 여부를 확인하지 못했어요` }
              : { icon: 'alert-circle' as const, color: colors.danger, title: '문제가 생겼어요' };

  return (
    <View style={styles.root}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.inner}>
          {/* 헤더 */}
          <View style={{ alignItems: 'center', gap: space.sm }}>
            <View style={[styles.headIcon, { backgroundColor: head.color + '22' }]}>
              <Ionicons name={head.icon} size={34} color={head.color} />
            </View>
            <AppText variant="title" align="center">
              {head.title}
            </AppText>
            {job.kind === 'make' && jobRecipe ? (
              <AppText variant="body" tone="secondary" align="center">
                {jobRecipe.name}
              </AppText>
            ) : null}
          </View>

          {/* 전체 진행률 */}
          <Card style={{ gap: space.md }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <AppText variant="number" color={head.color}>
                {pct}%
              </AppText>
              <AppText variant="label" tone="secondary">
                {running
                  ? job.ackAt
                    ? `남은 시간 약 ${fmtDuration(remaining)}`
                    : status === 'running'
                      ? '진행 중' // ack 를 못 받았지만 기기가 작업 중이라고 알려 옴 (status running·progress)
                      : '응답 대기 중'
                  : status === 'done'
                    ? `총 ${fmtMl(dispensedTotal)}`
                    : ''}
              </AppText>
            </Row>
            <ProgressBar value={pct / 100} color={head.color} height={14} />
          </Card>

          {linkLost && reconnecting ? (
            <Banner
              tone="warning"
              title="블루투스 연결이 끊겼어요"
              message={`기기는 정해진 양만큼 계속 제조해요. 다시 연결하는 중이에요${reconnectAttempt > 0 ? ` (${reconnectAttempt}번째 시도)` : ''}. 급하면 기기의 정지 버튼을 누르세요.`}
            />
          ) : linkLost ? (
            <Banner
              tone="danger"
              title="연결이 끊겼어요"
              message="자동으로 다시 연결하지 않고 있어요. 기기와 잔을 직접 확인하고, 기기 탭에서 다시 연결해 주세요. 급하면 기기의 정지 버튼을 누르세요."
            />
          ) : null}
          {status === 'pending' && job.uncertain ? (
            <Banner
              tone="info"
              title="기기 응답 확인 중"
              message="명령은 보냈지만 기기의 응답을 아직 받지 못했어요. 기기가 붓고 있을 수 있으니 잔을 그대로 두세요. 확인되는 대로 진행 상황을 보여 드려요."
            />
          ) : null}
          {status === 'done' && job.uncertain ? (
            <Banner
              tone="info"
              message="연결이 끊긴 동안 제조가 끝난 것으로 보여요. 중간에 멈췄을 수도 있으니 잔과 재료 잔량을 확인해 주세요."
            />
          ) : null}
          {status === 'error' ? (
            <Banner
              tone={job.uncertain ? 'warning' : 'danger'}
              title={job.uncertain ? '제조 여부를 확인하지 못했어요' : '제조를 시작하지 못했어요'}
              message={job.error ?? '알 수 없는 오류'}
            />
          ) : null}
          {status === 'stopped' && job.reason === 'error' ? (
            <Banner
              tone="danger"
              title="기기 안전장치가 작동했어요"
              message={`펌프가 너무 오래 켜져 있어서 기기가 모든 펌프를 멈췄어요. 지금까지 약 ${fmtMl(dispensedTotal)} 나왔어요. 튜브가 막히거나 꺾이지 않았는지, 용기에 액체가 있는지 확인해 주세요.`}
            />
          ) : status === 'stopped' && lostResult ? (
            <Banner
              tone="warning"
              title={job.reason === 'disconnected' ? '연결이 끊겨 결과를 확인하지 못했어요' : '연결이 끊긴 동안 기기가 멈췄어요'}
              message={`${stopReasonText(job.reason)} 확인된 양은 약 ${fmtMl(dispensedTotal)}이에요. 기기와 잔을 직접 확인하세요.`}
            />
          ) : status === 'stopped' ? (
            <Banner
              tone="warning"
              message={`${job.reason === 'button' ? '기기의 버튼으로' : '앱에서'} 정지했어요. 지금까지 약 ${fmtMl(dispensedTotal)} 나왔어요.`}
            />
          ) : null}

          {/* 펌프별 */}
          <Card padded={false}>
            {job.pumps.length === 0 ? (
              <View style={{ padding: space.lg }}>
                <AppText variant="caption" tone="muted">
                  기기에서 진행 상황을 받는 중이에요…
                </AppText>
              </View>
            ) : (
              job.pumps.map((p, idx) => {
                const ratio = p.target > 0 ? p.done / p.target : 0;
                const active = running && !p.finished && p.done > 0;
                return (
                  <View key={p.p} style={[styles.pumpRow, idx > 0 ? styles.pumpBorder : null]}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Row>
                        <View style={[styles.dot, { backgroundColor: colorFor(p.p, slots) }]} />
                        <AppText variant="bodyStrong">{nameOf(p.p)}</AppText>
                        <AppText variant="small" tone="muted">
                          펌프 {p.p}
                        </AppText>
                      </Row>
                      <Row gap={6}>
                        <AppText variant="label" tone={p.finished ? 'success' : active ? 'primary' : 'muted'}>
                          {fmtMl(p.done)} / {fmtMl(p.target)}
                        </AppText>
                        {p.finished ? <Ionicons name="checkmark-circle" size={18} color={colors.success} /> : null}
                      </Row>
                    </Row>
                    <ProgressBar value={ratio} color={p.finished ? colors.success : colorFor(p.p, slots)} height={8} />
                  </View>
                );
              })
            )}
          </Card>

          <View style={{ flex: 1 }} />

          {/* 하단 버튼 */}
          {running ? (
            <View style={{ gap: space.sm }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="비상 정지"
                accessibilityHint="모든 펌프를 즉시 멈춥니다"
                onPress={stop}
                disabled={stopping}
                style={({ pressed }) => [styles.stop, { backgroundColor: pressed ? colors.dangerPressed : colors.danger }]}>
                <Ionicons name="stop-circle" size={30} color="#fff" />
                <AppText variant="title" color="#fff">
                  {stopping ? '정지 중…' : '비상 정지'}
                </AppText>
              </Pressable>
              <AppText variant="caption" tone="muted" align="center">
                잔이 넘칠 것 같거나 이상하면 바로 누르세요. 기기의 정지 버튼도 언제든 쓸 수 있어요.
              </AppText>
              {linkLost && !reconnecting ? (
                <Button size="lg" icon="bluetooth" label="기기 탭에서 다시 연결" onPress={goReconnect} full />
              ) : null}
              {linkLost ? (
                <Button
                  variant="outline"
                  icon="close"
                  label="제조 화면 닫기"
                  onPress={closeWhileLost}
                  full
                  accessibilityHint="연결이 끊겨 결과를 확인할 수 없는 상태로 진행 화면을 닫아요"
                />
              ) : null}
            </View>
          ) : (
            <View style={{ gap: space.md }}>
              {(lostResult || (status === 'error' && job.uncertain)) && conn !== 'connected' && !reconnecting ? (
                <Button size="lg" icon="bluetooth" label="기기 탭에서 다시 연결" onPress={goReconnect} full />
              ) : null}
              {job.kind === 'make' && (status === 'done' || status === 'stopped') ? (
                <Card style={{ gap: space.md }}>
                  <AppText variant="bodyStrong" align="center">
                    맛은 어떠셨나요?
                  </AppText>
                  <Row style={{ gap: space.sm }}>
                    <FeedbackBtn icon="thumbs-up" label="좋아요" active={fb === 'like'} onPress={() => giveFeedback('like')} />
                    <FeedbackBtn icon="thumbs-down" label="별로예요" active={fb === 'dislike'} onPress={() => giveFeedback('dislike')} />
                  </Row>
                  <AppText variant="caption" tone="muted" align="center">
                    {job.uncertain
                      ? '피드백은 다음 AI 추천에 반영돼요. 재료 잔량은 확인된 양으로 차감했지만 정확하지 않을 수 있어요.'
                      : '피드백은 다음 AI 추천에 반영돼요. 재료 잔량은 자동으로 차감했어요.'}
                  </AppText>
                </Card>
              ) : null}
              {job.kind === 'make' && (status === 'done' || status === 'stopped') && current ? (
                <Card tone={fb ? 'primary' : 'default'} style={{ gap: space.sm }}>
                  <AppText variant="bodyStrong" align="center">
                    한 잔 더 만들까요?
                  </AppText>
                  <Button
                    icon="repeat"
                    label="예, 같은 취향으로 한 잔 더"
                    onPress={oneMore}
                    loading={nexting}
                    disabled={nexting}
                    full
                  />
                  <Button
                    variant="outline"
                    icon="compass"
                    label="아니요, 다른 걸 원해요"
                    onPress={wantDifferent}
                    disabled={nexting}
                    full
                    accessibilityHint="새 재료 1개를 장착하면 만들 수 있는 레시피를 추천해요"
                  />
                </Card>
              ) : null}
              <Button size="lg" label={status === 'done' && job.kind === 'make' ? '기록 저장하고 닫기' : '닫기'} onPress={close} full />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function FeedbackBtn({ icon, label, active, onPress }: { icon: 'thumbs-up' | 'thumbs-down'; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fb,
        {
          backgroundColor: active ? colors.primarySoft : pressed ? colors.cardPressed : colors.cardAlt,
          borderColor: active ? colors.primaryBorder : colors.border,
        },
      ]}>
      <Ionicons name={active ? icon : (`${icon}-outline` as const)} size={26} color={active ? colors.primary : colors.textSecondary} />
      <AppText variant="label" color={active ? colors.text : colors.textSecondary}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  scroll: { flexGrow: 1 },
  inner: { flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', gap: space.lg },
  headIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  pumpRow: { padding: space.lg, gap: space.sm },
  pumpBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  stop: {
    minHeight: 76,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  fb: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
});
