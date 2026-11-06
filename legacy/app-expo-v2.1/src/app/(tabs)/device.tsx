/**
 * ④ 기기 — 검색(여러 기기 중 선택)·연결·해제·다른 기기로 변경, 기기 정보, 캘리브레이션, 프라이밍, 세척, 배출 모드, 설정
 * - 마지막 연결 기기를 기억해 앱 시작 시 자동 재연결 (SPEC §5.5)
 * - calSet 에 0 이 있으면 "캘리브레이션 전" 배너 (SPEC §5.6)
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { CalibrationBanner } from '@/components/CalibrationBanner';
import { connLabel } from '@/components/DeviceChip';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Segmented, SwitchRow } from '@/components/ui/controls';
import { Banner, ProgressBar } from '@/components/ui/feedback';
import { Divider, Row, Screen, Section } from '@/components/ui/layout';
import { AppText } from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';
import { deviceClient } from '@/lib/device/client';
import { LIMITS } from '@/lib/protocol';
import { alertMessage, confirmAsync, fmtDuration, haptic } from '@/lib/ui';
import { isBusy, useDevice } from '@/store/device';
import { useSettings } from '@/store/settings';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';

const KIND_LABEL = { native: '블루투스(BLE)', web: '웹 블루투스(Chrome)', demo: '데모 · 가상 기기' } as const;

/** 신호 세기(RSSI, dBm) → 쉬운 말 */
function signalLabel(rssi?: number): { text: string; bars: 1 | 2 | 3 } | null {
  if (typeof rssi !== 'number') return null;
  if (rssi >= -60) return { text: '강함', bars: 3 };
  if (rssi >= -75) return { text: '보통', bars: 2 };
  return { text: '약함', bars: 1 };
}

export default function DeviceScreen() {
  const st = useDevice();
  const demoMode = useSettings((s) => s.demoMode);
  const dispenseMode = useSettings((s) => s.dispenseMode);
  const setSettings = useSettings((s) => s.set);
  const lastDevices = useSettings((s) => s.lastDevices);
  const slots = useSlots((s) => s.slots);
  const [includeAll, setIncludeAll] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [cleanMs, setCleanMs] = useState<'3000' | '5000' | '10000'>('5000');
  const [priming, setPriming] = useState<number | null>(null);
  const primingRef = useRef<number | null>(null);

  const connected = st.conn === 'connected';
  const busy = isBusy(st.job);
  const { text: connText, color: connColor } = connLabel(st.conn, st.transportKind);
  const isWeb = st.transportKind === 'web';

  useEffect(() => {
    // 탭을 떠날 때 검색 중지
    return () => {
      deviceClient.stopScan().catch(() => undefined);
    };
  }, []);

  const scan = async () => {
    setScanned(false);
    try {
      await deviceClient.scan(includeAll);
    } catch (e: any) {
      alertMessage('기기 검색 실패', e?.message ?? String(e));
    } finally {
      setScanned(true);
    }
  };

  const remembered = lastDevices?.[st.transportKind];

  /** 다른 기기로 변경: 연결 해제 → 다시 검색 → 목록에서 선택 */
  const switchDevice = async () => {
    setScanned(false);
    try {
      await deviceClient.switchDevice(includeAll);
    } catch (e: any) {
      alertMessage('기기 변경', e?.message ?? String(e));
    } finally {
      setScanned(true);
    }
  };

  const forget = async () => {
    const ok = await confirmAsync('기억한 기기 지우기', '다음에 앱을 켤 때 이 기기에 자동으로 연결하지 않아요.', { confirmText: '지우기' });
    if (!ok) return;
    deviceClient.forgetDevice();
    toast('기억한 기기를 지웠어요.', 'success');
  };

  const connect = async (id: string, name: string) => {
    try {
      await deviceClient.connect(id, name);
      haptic.success();
      toast(`${name}에 연결했어요.`, 'success');
    } catch (e: any) {
      alertMessage('연결 실패', e?.message ?? String(e));
    }
  };

  const guard = (fn: () => Promise<unknown>) => async () => {
    if (!connected) {
      toast('먼저 기기를 연결해 주세요.', 'warning');
      return;
    }
    try {
      await fn();
    } catch (e: any) {
      alertMessage('명령 실패', e?.message ?? String(e));
    }
  };

  const startPrime = async (p: number) => {
    if (!connected || busy) return;
    haptic.press();
    primingRef.current = p;
    setPriming(p);
    try {
      // 손을 떼면 stop (안전을 위해 최대 20초). 프라이밍은 실제 재료가 나오므로 끝나면 잔량에서 뺌
      await deviceClient.run(p, 20000, { purpose: 'prime' });
      if (primingRef.current !== p) await deviceClient.stop();
    } catch (e: any) {
      primingRef.current = null;
      setPriming(null);
      toast(e?.message ?? '펌프를 구동하지 못했어요', 'error');
    }
  };
  const endPrime = async () => {
    if (primingRef.current == null) return;
    primingRef.current = null;
    setPriming(null);
    await deviceClient.stop().catch(() => undefined);
  };

  const job = st.job;
  const maintenanceJob = job && job.kind !== 'make' ? job : null;
  const elapsed = maintenanceJob?.ackAt ? Date.now() - maintenanceJob.ackAt : 0;

  return (
    <Screen>
      <View style={{ gap: 4, paddingTop: space.sm }}>
        <AppText variant="display">기기</AppText>
        <AppText variant="body" tone="secondary">
          칵테일 메이커(ESP32)와 블루투스로 연결하고 관리해요.
        </AppText>
      </View>

      {/* 연결 */}
      <Card style={{ gap: space.lg }}>
        <Row style={{ gap: space.md }}>
          <View style={[styles.bigIcon, { backgroundColor: connColor + '22' }]}>
            <Ionicons name={st.transportKind === 'demo' ? 'flask' : 'bluetooth'} size={26} color={connColor} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="heading" numberOfLines={1}>
              {connected ? (st.deviceName ?? 'SmartBartender') : connText}
            </AppText>
            <Row gap={6}>
              <View style={[styles.dot, { backgroundColor: connColor }]} />
              <AppText variant="caption" tone="muted">
                {connected ? connText : st.transportKind ? KIND_LABEL[st.transportKind] : ''}
              </AppText>
            </Row>
          </View>
        </Row>

        {st.availability && !st.availability.ok ? (
          <Banner
            tone="warning"
            title="블루투스를 사용할 수 없어요"
            message={st.availability.reason ?? ''}
            action={!demoMode ? <Button size="sm" variant="outline" label="데모 모드 켜기" onPress={() => setSettings({ demoMode: true })} /> : null}
          />
        ) : null}

        {st.lastError && !connected ? <Banner tone="danger" message={st.lastError} /> : null}

        {connected ? (
          <View style={{ gap: space.sm }}>
            <Button variant="secondary" icon="swap-horizontal" label="다른 기기로 변경" onPress={switchDevice} disabled={busy} full />
            <Button variant="ghost" icon="close-circle" label="연결 해제" onPress={() => deviceClient.disconnect()} full />
          </View>
        ) : st.conn === 'scanning' ? (
          <Button variant="secondary" icon="stop" label="검색 중지" onPress={() => deviceClient.stopScan()} />
        ) : st.conn === 'reconnecting' || st.conn === 'connecting' ? (
          <Button variant="secondary" icon="close" label="연결 취소" onPress={() => deviceClient.disconnect()} />
        ) : (
          <Button
            icon={isWeb ? 'bluetooth' : 'search'}
            label={isWeb ? '기기 선택 (브라우저 창)' : st.transportKind === 'demo' ? '가상 기기 검색' : '주변 기기 검색'}
            onPress={scan}
            disabled={!!st.availability && !st.availability.ok}
          />
        )}

        {!connected && (st.conn === 'scanning' || st.found.length > 0) && !isWeb ? (
          <View style={{ gap: space.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <AppText variant="label" tone="secondary">
                검색된 기기
              </AppText>
              {st.conn === 'scanning' ? <ActivityIndicator color={colors.primary} size="small" /> : null}
            </Row>
            {st.found.length > 1 ? (
              <AppText variant="caption" tone="muted">
                연결할 기기를 눌러 고르세요. 신호가 강할수록 가까이 있는 기기예요.
              </AppText>
            ) : null}
            {st.found.map((d) => {
              const sig = signalLabel(d.rssi);
              const isLast = remembered?.id === d.id;
              return (
                <Pressable
                  key={d.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.name} 연결${sig ? `, 신호 ${sig.text}` : ''}`}
                  onPress={() => connect(d.id, d.name)}
                  style={({ pressed }) => [styles.found, pressed ? { backgroundColor: colors.cardPressed } : null]}>
                  <Ionicons name={d.likely ? 'wine' : 'bluetooth'} size={20} color={d.likely ? colors.primary : colors.textMuted} />
                  <View style={{ flex: 1, gap: 2 }}>
                    {/* 기기 이름은 자르지 않음 (SmartBartender-A1B2 처럼 끝자리로 구분하므로) */}
                    <AppText variant="bodyStrong" style={{ flexShrink: 1 }}>
                      {d.name}
                    </AppText>
                    <AppText variant="small" tone="muted">
                      {d.likely ? '스마트 바텐더' : '다른 기기'}
                      {isLast ? ' · 지난번 기기' : ''}
                    </AppText>
                    {sig ? (
                      <AppText variant="small" tone="muted">
                        신호 {sig.text} ({d.rssi} dBm)
                      </AppText>
                    ) : null}
                  </View>
                  {sig ? <SignalBars bars={sig.bars} /> : null}
                  <Ionicons name="chevron-forward" size={18} color={colors.primary} />
                </Pressable>
              );
            })}
            {st.conn === 'scanning' && st.found.length === 0 ? (
              <AppText variant="caption" tone="muted">
                SmartBartender 를 찾는 중이에요…
              </AppText>
            ) : null}
          </View>
        ) : null}

        {!connected && scanned && st.conn !== 'scanning' && st.found.length === 0 && !isWeb ? (
          <Banner
            tone="info"
            title="기기를 찾지 못했어요"
            message={
              '① 칵테일 메이커 전원이 켜져 있는지(파란 LED 깜빡임) ② 휴대폰과 2m 이내인지 ③ 다른 휴대폰에 이미 연결되어 있지 않은지 확인한 뒤 다시 검색해 보세요.'
            }
          />
        ) : null}

        {!connected && remembered && st.conn !== 'scanning' && st.conn !== 'connecting' && st.conn !== 'reconnecting' ? (
          <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <AppText variant="caption" tone="muted" style={{ flex: 1, minWidth: 160 }}>
              기억한 기기: {remembered.name ?? remembered.id}
              {useSettings.getState().autoReconnect ? ' (앱을 켜면 자동 연결)' : ''}
            </AppText>
            <Button size="sm" variant="ghost" icon="trash-outline" label="지우기" onPress={forget} />
          </Row>
        ) : null}

        {st.transportKind === 'native' && !connected ? (
          <SwitchRow
            title="모든 블루투스 기기 보기"
            description="기기 이름이 안 보일 때 켜 보세요"
            value={includeAll}
            onChange={setIncludeAll}
          />
        ) : null}
      </Card>

      <CalibrationBanner dismissible={false} />

      <Card style={{ gap: space.sm }}>
        <SwitchRow
          title="데모 모드 (가상 기기)"
          description="하드웨어 없이도 연결·제조 과정을 그대로 체험할 수 있어요. 실제 기기를 쓰려면 끄세요."
          value={demoMode}
          onChange={(v) => setSettings({ demoMode: v })}
        />
        {demoMode && connected ? (
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            label="가상 기기 유량 초기화"
            accessibilityHint="가상 기기의 유량을 캘리브레이션 전 기본값으로 되돌려요"
            onPress={() => {
              deviceClient
                .resetDemoCalibration()
                .then(() => toast('가상 기기 유량을 기본값(20ml/초)으로 되돌렸어요.', 'success'))
                .catch(() => undefined);
            }}
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
        {Platform.OS === 'web' && !demoMode ? (
          <AppText variant="caption" tone="muted">
            웹에서는 안드로이드/PC 의 Chrome·Edge 에서 HTTPS 주소로 열어야 실제 기기에 연결할 수 있어요.
          </AppText>
        ) : null}
      </Card>

      {/* 기기 정보 */}
      {connected && st.info ? (
        <Section title="기기 정보" icon="hardware-chip">
          <Card style={{ gap: space.md }}>
            <InfoRow label="이름" value={st.info.name} />
            <InfoRow label="펌웨어" value={`v${st.info.fw}`} />
            <InfoRow label="펌프 수" value={`${st.info.pumps}개`} />
            <InfoRow label="최대 제조량" value={`${st.info.maxMl}ml (재료당 ${st.info.maxStepMl}ml)`} />
            <InfoRow
              label="펌프당 최대 구동"
              value={st.maxPumpMs ? `${Math.round(st.maxPumpMs / 1000)}초` : `알 수 없음 (구버전: ${LIMITS.legacyMaxPumpMs / 1000}초로 계산)`}
            />
            {st.uptimeMs != null ? <InfoRow label="작동 시간" value={fmtDuration(st.uptimeMs)} /> : null}
            <Divider />
            <AppText variant="label" tone="secondary">
              펌프별 유량 (ml/초)
            </AppText>
            <View style={styles.calGrid}>
              {(st.cal ?? []).map((v, i) => {
                const set = st.calSet ? st.calSet[i] : null;
                return (
                  <View key={i} style={[styles.calCell, set === 0 ? { borderColor: colors.warning + '73', borderWidth: 1 } : null]}>
                    <AppText variant="small" tone="muted">
                      펌프 {i + 1}
                    </AppText>
                    <AppText variant="bodyStrong">{v}</AppText>
                    <AppText variant="small" tone="muted" numberOfLines={1}>
                      {slots[i]?.name || '비어 있음'}
                    </AppText>
                    <AppText variant="small" tone={set === 1 ? 'success' : set === 0 ? 'warning' : 'muted'} numberOfLines={1}>
                      {set === 1 ? '측정함' : set === 0 ? '측정 전' : '알 수 없음'}
                    </AppText>
                  </View>
                );
              })}
            </View>
          </Card>
        </Section>
      ) : null}

      {/* 진행 중인 유지보수 작업 */}
      {maintenanceJob && (isBusy(maintenanceJob) || maintenanceJob.status !== 'error') ? (
        <Card tone={isBusy(maintenanceJob) ? 'primary' : 'alt'} style={{ gap: space.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText variant="bodyStrong">
              {maintenanceJob.kind === 'clean' ? '세척' : '펌프 구동'}{' '}
              {isBusy(maintenanceJob) ? '중…' : maintenanceJob.status === 'done' ? '완료' : '중단됨'}
            </AppText>
            <AppText variant="label" tone="secondary">
              {isBusy(maintenanceJob) && maintenanceJob.totalMs ? `약 ${fmtDuration(Math.max(0, maintenanceJob.totalMs - elapsed))} 남음` : ''}
            </AppText>
          </Row>
          <ProgressBar value={(maintenanceJob.status === 'done' ? 100 : maintenanceJob.pct) / 100} />
          {isBusy(maintenanceJob) ? (
            <Button variant="danger" icon="stop-circle" label="정지" onPress={() => deviceClient.stop().catch(() => undefined)} />
          ) : (
            <Button size="sm" variant="ghost" label="닫기" onPress={() => deviceClient.clearJob()} />
          )}
        </Card>
      ) : null}

      {/* 유지보수 */}
      <Section title="캘리브레이션" subtitle="펌프마다 1초에 나오는 양(ml)을 측정해 정확도를 높여요" icon="speedometer">
        <Card onPress={() => router.push('/calibrate')} accessibilityLabel="캘리브레이션 마법사 열기">
          <Row style={{ gap: space.md }}>
            <View style={[styles.bigIcon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="speedometer" size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">캘리브레이션 마법사</AppText>
              <AppText variant="caption" tone="muted">
                계량컵으로 10초 동안 나온 양을 재서 입력하면 자동 계산돼요
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Row>
        </Card>
      </Section>

      <Section title="프라이밍 (튜브 채우기)" subtitle="버튼을 길게 누르고 있는 동안 펌프가 돌아가요. 노즐에서 액체가 나오면 손을 떼세요. 나온 양은 재료 잔량에서 빼요." icon="water">
        <View style={styles.primeGrid}>
          {slots.map((s) => {
            const active = priming === s.pump;
            return (
              <Pressable
                key={s.pump}
                accessibilityRole="button"
                accessibilityLabel={`펌프 ${s.pump} 길게 눌러 채우기`}
                disabled={!connected || (busy && !active)}
                delayLongPress={300}
                onLongPress={() => startPrime(s.pump)}
                onPressOut={endPrime}
                onPress={() => toast('길게 누르고 있어야 펌프가 돌아가요.', 'info')}
                style={({ pressed }) => [
                  styles.prime,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.primarySoft : pressed ? colors.cardPressed : colors.card,
                    opacity: !connected || (busy && !active) ? 0.45 : 1,
                  },
                ]}>
                <View style={[styles.dot, { backgroundColor: s.color, width: 12, height: 12, borderRadius: 6 }]} />
                <AppText variant="bodyStrong">펌프 {s.pump}</AppText>
                <AppText variant="small" tone="muted" numberOfLines={1}>
                  {active ? '채우는 중…' : s.name || '비어 있음'}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title="세척" subtitle="용기에 깨끗한 물을 넣고, 모든 펌프를 차례로 돌려 튜브를 헹궈요" icon="sparkles">
        <Card style={{ gap: space.md }}>
          <Segmented
            value={cleanMs}
            onChange={setCleanMs}
            options={[
              { value: '3000', label: '펌프당 3초' },
              { value: '5000', label: '5초' },
              { value: '10000', label: '10초' },
            ]}
          />
          <Button
            variant="secondary"
            icon="water"
            label="세척 시작"
            disabled={!connected || busy}
            onPress={guard(() => deviceClient.clean(Number(cleanMs)))}
          />
        </Card>
      </Section>

      <Section title="배출 모드" icon="git-branch">
        <Card style={{ gap: space.md }}>
          <Segmented
            value={dispenseMode}
            onChange={(v) => setSettings({ dispenseMode: v })}
            options={[
              { value: 'seq', label: '순차 (권장)' },
              { value: 'par', label: '동시' },
            ]}
          />
          <AppText variant="caption" tone="muted">
            {dispenseMode === 'seq'
              ? '펌프를 하나씩 차례로 돌려요. 전압이 안정적이라 양이 더 정확해요.'
              : '여러 펌프를 한꺼번에 돌려 빨리 만들어요. 전원(5V 4A)이 약하면 기기가 재부팅될 수 있어요.'}
          </AppText>
        </Card>
      </Section>

      {connected ? (
        <Button variant="danger" icon="stop-circle" label="모든 펌프 즉시 정지" onPress={() => deviceClient.stop().catch(() => undefined)} />
      ) : null}

      <Card onPress={() => router.push('/settings')} accessibilityLabel="앱 설정 열기">
        <Row style={{ gap: space.md }}>
          <Ionicons name="settings" size={22} color={colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">앱 설정</AppText>
            <AppText variant="caption" tone="muted">
              AI 모드 · 서버 주소 · Gemini 키 · 성인 인증 · 데이터 초기화 · 앱 정보
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Row>
      </Card>
    </Screen>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <AppText variant="label" tone="muted">
        {label}
      </AppText>
      <AppText variant="label" align="right" style={{ flex: 1, flexShrink: 1 }}>
        {value}
      </AppText>
    </Row>
  );
}

function SignalBars({ bars }: { bars: 1 | 2 | 3 }) {
  return (
    <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[1, 2, 3].map((b) => (
        <View
          key={b}
          style={[styles.bar, { height: 4 + b * 4, backgroundColor: b <= bars ? colors.success : colors.border }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bigIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  found: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 56,
  },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 16 },
  bar: { width: 4, borderRadius: 1 },
  calCell: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 72,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    padding: space.sm,
    gap: 2,
  },
  primeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  prime: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 84,
    borderRadius: radius.md,
    borderWidth: 1.5,
    padding: space.md,
    gap: 4,
    justifyContent: 'center',
  },
});
