/**
 * 캘리브레이션 마법사
 * 펌프 선택 → 계량컵 준비 → 10초 구동(run) → 실제 ml 입력 → mlps 계산 → setcal 저장 → 결과표
 * 저장 뒤, 펌프에 재료가 등록돼 있으면 측정에 쓴 양(튜브 채우기 포함)을 잔량에서 뺄지 물어봄 (물로 측정했으면 빼지 않음)
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PumpNumber } from '@/components/PumpCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/controls';
import { Banner, ProgressBar } from '@/components/ui/feedback';
import { Row, Screen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { colors, space } from '@/constants/theme';
import { josa } from '@/lib/ai/normalize';
import { deviceClient } from '@/lib/device/client';
import { LIMITS } from '@/lib/protocol';
import { alertMessage, confirmAsync, fmtDuration, fmtMl, haptic } from '@/lib/ui';
import { isBusy, useDevice } from '@/store/device';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';

type Step = 'select' | 'prepare' | 'running' | 'measure' | 'saved';

export default function CalibrateScreen() {
  const params = useLocalSearchParams<{ pump?: string }>();
  const initialPump = Number(params.pump) || null;
  const slots = useSlots((s) => s.slots);
  const markCalibrated = useSlots((s) => s.markCalibrated);
  const conn = useDevice((s) => s.conn);
  const cal = useDevice((s) => s.cal);
  const job = useDevice((s) => s.job);
  const kind = useDevice((s) => s.transportKind);

  const [step, setStep] = useState<Step>(initialPump ? 'prepare' : 'select');
  const [pump, setPump] = useState<number | null>(initialPump);
  const [durMs, setDurMs] = useState<'5000' | '10000' | '15000'>('10000');
  const [measured, setMeasured] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedValue, setSavedValue] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  /** 지금 작업이 "튜브 채우기"인지 */
  const primeRef = useRef(false);
  /** 이 화면에서 튜브 채우기로 나온 양 (잔량 차감 안내용) */
  const [primedMl, setPrimedMl] = useState(0);
  const connected = conn === 'connected';
  const ms = Number(durMs);

  // 튜브 채우기로 나온 양 모으기
  useEffect(() => {
    if (!primeRef.current || !job || job.kind !== 'run') return;
    if (job.status === 'done' || job.status === 'stopped') {
      primeRef.current = false;
      const out = (job.dispensed ?? []).reduce((a, b) => a + (b.ml || 0), 0);
      setPrimedMl((v) => Math.round((v + out) * 10) / 10);
    } else if (job.status === 'error') {
      primeRef.current = false;
    }
  }, [job]);

  // 구동 완료/중단 감지
  useEffect(() => {
    if (step !== 'running' || !job || job.kind !== 'run') return;
    if (job.status === 'done') {
      haptic.success();
      setStep('measure');
    } else if (job.status === 'stopped' || job.status === 'error') {
      setStep('prepare');
    }
  }, [job, step]);

  useEffect(() => {
    if (step !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [step]);

  const slot = slots.find((s) => s.pump === pump);
  const ml = parseFloat(measured.replace(',', '.'));
  const mlps = Number.isFinite(ml) && ml > 0 ? Math.round((ml / (ms / 1000)) * 100) / 100 : null;
  const mlpsValid = mlps != null && mlps >= LIMITS.minMlps && mlps <= LIMITS.maxMlps;

  const runPump = async () => {
    if (!pump) return;
    try {
      await deviceClient.run(pump, ms);
      setStep('running');
    } catch (e: any) {
      alertMessage('펌프를 구동하지 못했어요', e?.message ?? String(e));
    }
  };

  const prime = async () => {
    if (!pump) return;
    primeRef.current = true;
    try {
      await deviceClient.run(pump, 3000);
    } catch (e: any) {
      primeRef.current = false;
      alertMessage('프라이밍 실패', e?.message ?? String(e));
    }
  };

  /** 측정에 쓴 재료를 잔량에서 뺄지 물어봄 (캘리브레이션은 물로 할 수도 있어서 자동으로 빼지 않음) */
  const askDeduct = async (p: number, measuredMl: number) => {
    const s = useSlots.getState().slots.find((x) => x.pump === p);
    if (!s || !s.name.trim()) return;
    const used = Math.round((measuredMl + primedMl) * 10) / 10;
    if (!(used > 0)) return;
    const ok = await confirmAsync(
      '재료 잔량에서 뺄까요?',
      `측정에 약 ${fmtMl(used)}${primedMl > 0 ? '(튜브 채우기 포함)' : ''}가 나왔어요. ${josa(s.name, '을', '를')} 넣고 측정했다면 그만큼 잔량에서 뺄게요. 물로 측정했다면 '아니요'를 눌러 주세요.`,
      { confirmText: '잔량에서 빼기', cancelText: '아니요' },
    );
    if (!ok) return;
    useSlots.getState().deduct([{ p, ml: used }]);
    setPrimedMl(0);
    toast(`${s.name} 잔량에서 ${fmtMl(used)}를 뺐어요.`, 'success');
  };

  const save = async () => {
    if (!pump || mlps == null) return;
    setSaving(true);
    try {
      await deviceClient.setCal(pump, mlps);
      markCalibrated(pump);
      setSavedValue(mlps);
      haptic.success();
      setStep('saved');
    } catch (e: any) {
      alertMessage('저장하지 못했어요', e?.message ?? String(e));
      return;
    } finally {
      setSaving(false);
    }
    await askDeduct(pump, ml);
  };

  if (!connected && step !== 'saved') {
    return (
      <Screen edges={['bottom']}>
        <Banner
          tone="warning"
          title="기기가 연결되어 있지 않아요"
          message="캘리브레이션은 기기와 연결된 상태에서만 할 수 있어요. 기기 탭에서 먼저 연결해 주세요."
        />
        <Button label="기기 탭으로" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <StepIndicator step={step} />

      {step === 'select' ? (
        <View style={{ gap: space.md }}>
          <AppText variant="title">어떤 펌프를 측정할까요?</AppText>
          <AppText variant="body" tone="secondary">
            펌프마다 1초에 나오는 양이 조금씩 달라요. 한 번 측정해 두면 레시피 양이 훨씬 정확해져요.
          </AppText>
          {slots.map((s) => (
            <Card
              key={s.pump}
              onPress={() => {
                setPump(s.pump);
                setMeasured('');
                setStep('prepare');
              }}>
              <Row style={{ gap: space.md }}>
                <PumpNumber n={s.pump} color={s.color} />
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong">{s.name || '비어 있음 (물로 측정 가능)'}</AppText>
                  <AppText variant="caption" tone="muted">
                    현재 유량 {cal?.[s.pump - 1] ?? LIMITS.defaultMlps} ml/초{s.needsCal ? ' · 캘리브레이션 권장' : ''}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </Row>
            </Card>
          ))}
        </View>
      ) : null}

      {step === 'prepare' && pump ? (
        <View style={{ gap: space.lg }}>
          <AppText variant="title">펌프 {pump} 준비하기</AppText>
          <Card style={{ gap: space.md }}>
            {[
              `펌프 ${pump} 용기에 ${josa(slot?.name || '물', '을', '를')} 충분히 넣어 주세요. (펌프가 액체에 완전히 잠겨야 해요)`,
              '튜브 안이 액체로 가득 차 있어야 정확해요. 아래 "튜브 채우기"를 눌러 노즐에서 액체가 나올 때까지 채우세요.',
              '계량컵(또는 주방 저울, 물 1g ≈ 1ml)을 노즐 아래에 놓고 눈금/영점을 맞추세요.',
            ].map((t, i) => (
              <Row key={i} style={{ alignItems: 'flex-start', gap: space.md }}>
                <View style={styles.num}>
                  <AppText variant="small" color={colors.onPrimary}>
                    {i + 1}
                  </AppText>
                </View>
                <AppText variant="body" style={{ flex: 1 }}>
                  {t}
                </AppText>
              </Row>
            ))}
            <Button variant="secondary" icon="water" label="튜브 채우기 (3초)" onPress={prime} disabled={isBusy(job)} />
          </Card>
          <View style={{ gap: space.sm }}>
            <AppText variant="label" tone="secondary">
              측정 시간
            </AppText>
            <Segmented
              value={durMs}
              onChange={setDurMs}
              options={[
                { value: '5000', label: '5초' },
                { value: '10000', label: '10초 (권장)' },
                { value: '15000', label: '15초' },
              ]}
            />
          </View>
          <Button size="lg" icon="play" label={`${ms / 1000}초 구동 시작`} onPress={runPump} disabled={isBusy(job)} full />
          <Button variant="ghost" label="다른 펌프 선택" onPress={() => setStep('select')} />
        </View>
      ) : null}

      {step === 'running' && job ? (
        <View style={{ gap: space.lg }}>
          <AppText variant="title">펌프 {pump} 구동 중…</AppText>
          <Card style={{ gap: space.md }}>
            <AppText variant="number" tone="primary">
              {job.ackAt ? fmtDuration(Math.max(0, job.totalMs - (now - job.ackAt))) : '준비 중'}
            </AppText>
            <ProgressBar value={job.ackAt && job.totalMs ? Math.min(1, (now - job.ackAt) / job.totalMs) : 0} height={12} />
            <AppText variant="caption" tone="muted">
              계량컵을 움직이지 말고 끝날 때까지 기다려 주세요.
            </AppText>
          </Card>
          <Button variant="danger" icon="stop-circle" label="정지" onPress={() => deviceClient.stop().catch(() => undefined)} />
        </View>
      ) : null}

      {step === 'measure' && pump ? (
        <View style={{ gap: space.lg }}>
          <AppText variant="title">실제로 나온 양을 입력하세요</AppText>
          <TextField
            label={`${ms / 1000}초 동안 나온 양`}
            placeholder="예: 195"
            keyboardType="decimal-pad"
            value={measured}
            onChangeText={setMeasured}
            suffix="ml"
            autoFocus
            error={measured && !mlpsValid ? `유량이 ${LIMITS.minMlps}~${LIMITS.maxMlps} ml/초 범위를 벗어나요. 다시 확인해 주세요.` : undefined}
          />
          {kind === 'demo' && typeof job?.simActualMl === 'number' ? (
            <Banner
              tone="info"
              title="데모 모드"
              message={`가상 기기에서 약 ${job.simActualMl}ml 가 나왔다고 가정해요.`}
              action={<Button size="sm" variant="outline" label="이 값 입력" onPress={() => setMeasured(String(job.simActualMl))} />}
            />
          ) : null}
          <Card tone="primary" style={{ gap: 4 }}>
            <AppText variant="label" tone="secondary">
              계산된 유량
            </AppText>
            <AppText variant="number" tone="primary">
              {mlps != null ? `${mlps}` : '-'} <AppText variant="heading" tone="secondary">ml/초</AppText>
            </AppText>
            <AppText variant="caption" tone="muted">
              {measured ? `${measured}ml ÷ ${ms / 1000}초` : '나온 양 ÷ 구동 시간'} · 기존 값 {cal?.[pump - 1] ?? LIMITS.defaultMlps} ml/초
            </AppText>
          </Card>
          <Button size="lg" icon="save" label="기기에 저장" onPress={save} loading={saving} disabled={!mlpsValid} full />
          <Button variant="ghost" icon="refresh" label="다시 측정" onPress={() => setStep('prepare')} />
        </View>
      ) : null}

      {step === 'saved' ? (
        <View style={{ gap: space.lg }}>
          <View style={{ alignItems: 'center', gap: space.sm }}>
            <Ionicons name="checkmark-circle" size={56} color={colors.success} />
            <AppText variant="title" align="center">
              저장했어요
            </AppText>
            <AppText variant="body" tone="secondary" align="center">
              펌프 {pump} 유량을 {savedValue} ml/초로 기기에 저장했어요. 전원을 꺼도 유지돼요.
            </AppText>
          </View>
          <Card padded={false}>
            {slots.map((s, i) => (
              <Row key={s.pump} style={[styles.tableRow, i > 0 ? styles.tableBorder : null]}>
                <AppText variant="label" style={{ width: 64 }}>
                  펌프 {s.pump}
                </AppText>
                <AppText variant="body" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
                  {s.name || '비어 있음'}
                </AppText>
                <AppText variant="bodyStrong" tone={s.pump === pump ? 'primary' : 'default'}>
                  {cal?.[s.pump - 1] ?? '-'} ml/s
                </AppText>
              </Row>
            ))}
          </Card>
          <Button
            variant="secondary"
            label="다른 펌프도 측정하기"
            onPress={() => {
              setMeasured('');
              setStep('select');
            }}
          />
          <Button label="완료" onPress={() => router.back()} />
        </View>
      ) : null}
    </Screen>
  );
}

const STEPS: { key: Step; label: string }[] = [
  { key: 'select', label: '선택' },
  { key: 'prepare', label: '준비' },
  { key: 'running', label: '구동' },
  { key: 'measure', label: '입력' },
  { key: 'saved', label: '저장' },
];

function StepIndicator({ step }: { step: Step }) {
  const idx = STEPS.findIndex((s) => s.key === step);
  return (
    <Row style={{ gap: 6 }}>
      {STEPS.map((s, i) => (
        <View key={s.key} style={{ flex: 1, gap: 4 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: i <= idx ? colors.primary : colors.cardAlt }} />
          <AppText variant="small" tone={i === idx ? 'primary' : 'muted'} align="center">
            {s.label}
          </AppText>
        </View>
      ))}
    </Row>
  );
}

const styles = StyleSheet.create({
  num: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  tableRow: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md },
  tableBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
