/**
 * 캘리브레이션 마법사 (#/calibrate, `?pump=N` 이면 그 펌프부터) — v2.1 calibrate.tsx 를 밝은 톤·반응형으로 옮김
 * 펌프 선택 → 계량컵 준비(튜브 채우기 3초) → 10초 구동(run) → 실제 ml 입력 → mlps 계산 → setcal 저장 → 결과표
 * 저장 뒤, 펌프에 재료가 등록돼 있으면 측정에 쓴 양(튜브 채우기 포함)을 잔량에서 뺄지 물어봄 (물로 측정했으면 빼지 않음)
 */
import { Bluetooth, ChevronRight, CircleCheck, Droplets, OctagonX, Play, RotateCcw, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { PumpNumber } from '@/components';
import { josa } from '@/lib/ai/normalize';
import { deviceClient } from '@/lib/device/client';
import { fmtDuration, fmtMl } from '@/lib/format';
import { back, go } from '@/lib/nav';
import { LIMITS } from '@/lib/protocol';
import { haptic } from '@/platform/haptics';
import { isBusy, useDevice } from '@/store/device';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';
import {
  alertMessage,
  Badge,
  Banner,
  Button,
  Card,
  Columns,
  confirm,
  connLabel,
  cx,
  Page,
  PageHeader,
  ProgressBar,
  Segmented,
  Stack,
  Text,
  TextField,
} from '@/ui';

import { calSetLabel, runCountdown } from './deviceText';
import './device.css';

type Step = 'select' | 'prepare' | 'running' | 'measure' | 'saved';
type DurMs = '5000' | '10000' | '15000';

/** 튜브 채우기 한 번 구동 시간 (v2.1 그대로) */
const PRIME_MS = 3000;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function CalibrateScreen() {
  const [params] = useSearchParams();
  const slots = useSlots((s) => s.slots);
  const markCalibrated = useSlots((s) => s.markCalibrated);
  const conn = useDevice((s) => s.conn);
  const cal = useDevice((s) => s.cal);
  const calSet = useDevice((s) => s.calSet);
  const job = useDevice((s) => s.job);
  const kind = useDevice((s) => s.transportKind);

  // ?pump=N (배너의 "캘리브레이션 마법사") — 없는 펌프 번호면 고르기부터
  const [initialPump] = useState<number | null>(() => {
    const n = Number(params.get('pump'));
    return Number.isInteger(n) && n >= 1 && n <= slots.length ? n : null;
  });
  const [step, setStep] = useState<Step>(initialPump ? 'prepare' : 'select');
  const [pump, setPump] = useState<number | null>(initialPump);
  const [durMs, setDurMs] = useState<DurMs>('10000');
  const [measured, setMeasured] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedValue, setSavedValue] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** 지금 작업이 "튜브 채우기"인지 */
  const primeRef = useRef(false);
  const [priming, setPriming] = useState(false);
  /** 이 화면에서 튜브 채우기로 나온 양 (잔량 차감 안내용) */
  const [primedMl, setPrimedMl] = useState(0);
  const connected = conn === 'connected';
  const ms = Number(durMs);
  const secs = ms / 1000;
  const busy = isBusy(job);

  // 튜브 채우기로 나온 양 모으기
  useEffect(() => {
    if (!primeRef.current || !job || job.kind !== 'run') return;
    if (job.status === 'done' || job.status === 'stopped') {
      primeRef.current = false;
      setPriming(false);
      const out = (job.dispensed ?? []).reduce((a, b) => a + (b.ml || 0), 0);
      setPrimedMl((v) => Math.round((v + out) * 10) / 10);
    } else if (job.status === 'error') {
      primeRef.current = false;
      setPriming(false);
    }
  }, [job]);

  // 구동 완료/중단 감지
  useEffect(() => {
    if (step !== 'running' || !job || job.kind !== 'run') return;
    if (job.status === 'done') {
      haptic.success();
      setStep('measure');
    } else if (job.status === 'stopped' || job.status === 'error') {
      toast('구동이 멈췄어요. 준비를 확인하고 다시 측정해 주세요.', 'warning');
      setStep('prepare');
    }
  }, [job, step]);

  useEffect(() => {
    if (step !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [step]);

  // 단계가 바뀌면 맨 위로 (모바일에서 아래 버튼을 누른 뒤 새 단계 제목이 보이게)
  useEffect(() => {
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }, [step]);

  const slot = slots.find((s) => s.pump === pump);
  const countdown = runCountdown(job, now);
  const ml = parseFloat(measured.replace(',', '.'));
  const mlps = Number.isFinite(ml) && ml > 0 ? Math.round((ml / secs) * 100) / 100 : null;
  const mlpsValid = mlps != null && mlps >= LIMITS.minMlps && mlps <= LIMITS.maxMlps;

  const runPump = async () => {
    if (!pump) return;
    try {
      await deviceClient.run(pump, ms);
      // 시계를 지금으로 맞춘 뒤 구동 화면으로 (앞 단계에 머문 시간이 남은 시간에 더해져 잠깐 '29초'처럼 보이지 않게 — UI-8)
      setNow(Date.now());
      setStep('running');
    } catch (e) {
      alertMessage('펌프를 구동하지 못했어요', errMsg(e));
    }
  };

  const prime = async () => {
    if (!pump) return;
    primeRef.current = true;
    setPriming(true);
    try {
      await deviceClient.run(pump, PRIME_MS);
    } catch (e) {
      primeRef.current = false;
      setPriming(false);
      alertMessage('프라이밍 실패', errMsg(e));
    }
  };

  /** 측정에 쓴 재료를 잔량에서 뺄지 물어봄 (캘리브레이션은 물로 할 수도 있어서 자동으로 빼지 않음) */
  const askDeduct = async (p: number, measuredMl: number) => {
    const s = useSlots.getState().slots.find((x) => x.pump === p);
    if (!s || !s.name.trim()) return;
    const used = Math.round((measuredMl + primedMl) * 10) / 10;
    if (!(used > 0)) return;
    const ok = await confirm(
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
    if (!pump || mlps == null || !mlpsValid) return;
    setSaving(true);
    try {
      await deviceClient.setCal(pump, mlps);
      markCalibrated(pump);
      setSavedValue(mlps);
      haptic.success();
      setStep('saved');
    } catch (e) {
      alertMessage('저장하지 못했어요', errMsg(e));
      return;
    } finally {
      setSaving(false);
    }
    await askDeduct(pump, ml);
  };

  const pick = (p: number) => {
    setPump(p);
    setMeasured('');
    setStep('prepare');
  };

  const header = <PageHeader title="캘리브레이션" back="/device" />;

  if (!connected && step !== 'saved') {
    const { text } = connLabel(conn, kind);
    return (
      <Page width="narrow" header={header}>
        <Banner
          tone="warning"
          title="기기가 연결되어 있지 않아요"
          message="캘리브레이션은 기기와 연결된 상태에서만 할 수 있어요. 기기 탭에서 먼저 연결해 주세요."
        />
        <Text variant="caption" tone="secondary">
          지금 상태: {text}
        </Text>
        <Button label="기기 탭으로" icon={Bluetooth} onClick={() => go('/device', { replace: true })} />
      </Page>
    );
  }

  return (
    <Page width="normal" header={header}>
      <StepIndicator step={step} />

      {step === 'select' ? (
        <Stack gap={16}>
          <Stack gap={4}>
            <Text variant="title">어떤 펌프를 측정할까요?</Text>
            <Text tone="secondary">펌프마다 1초에 나오는 양이 조금씩 달라요. 한 번 측정해 두면 레시피 양이 훨씬 정확해져요.</Text>
          </Stack>
          <ul className="calibrate-pumps">
            {slots.map((s) => {
              const set = calSet ? calSet[s.pump - 1] : null;
              const lab = calSetLabel(set);
              return (
                <li key={s.pump}>
                  <Card onPress={() => pick(s.pump)} pressLabel={`펌프 ${s.pump} ${s.name || '비어 있음'} 측정하기`}>
                    <span className="calibrate-pump">
                      <PumpNumber n={s.pump} color={s.color} />
                      <span className="calibrate-pump__text">
                        <span className="calibrate-pump__name">{s.name || '비어 있음 (물로 측정 가능)'}</span>
                        <span className="calibrate-pump__meta">
                          <span className="sb-num">
                            현재 유량 {cal?.[s.pump - 1] ?? LIMITS.defaultMlps} ml/초{s.needsCal ? ' · 캘리브레이션 권장' : ''}
                          </span>
                          {set != null ? <Badge tone={lab.tone} label={lab.text} /> : null}
                        </span>
                      </span>
                      <ChevronRight size={20} aria-hidden="true" className="calibrate-pump__chevron" />
                    </span>
                  </Card>
                </li>
              );
            })}
          </ul>
        </Stack>
      ) : null}

      {step === 'prepare' && pump ? (
        <Stack gap={16}>
          <Text variant="title">펌프 {pump} 준비하기</Text>
          <Columns template="3fr 2fr">
            <Card className="device-card">
              <ol className="calibrate-howto">
                {[
                  `펌프 ${pump} 용기에 ${josa(slot?.name || '물', '을', '를')} 충분히 넣어 주세요. (펌프가 액체에 완전히 잠겨야 해요)`,
                  '튜브 안이 액체로 가득 차 있어야 정확해요. 아래 "튜브 채우기"를 눌러 노즐에서 액체가 나올 때까지 채우세요.',
                  '계량컵(또는 주방 저울, 물 1g ≈ 1ml)을 노즐 아래에 놓고 눈금/영점을 맞추세요.',
                ].map((t, i) => (
                  <li key={i}>
                    <span className="calibrate-howto__num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <Text as="span">{t}</Text>
                  </li>
                ))}
              </ol>
              <Button
                variant="secondary"
                icon={Droplets}
                label={priming && busy ? '튜브 채우는 중…' : `튜브 채우기 (${PRIME_MS / 1000}초)`}
                onClick={prime}
                loading={priming && busy}
                disabled={busy}
              />
              {primedMl > 0 ? (
                <Text variant="caption" tone="secondary">
                  지금까지 튜브 채우기로 약 {fmtMl(primedMl)} 나왔어요.
                </Text>
              ) : null}
            </Card>
            <Stack gap={16}>
              <Stack gap={8}>
                <Text variant="label" tone="secondary" as="p">
                  측정 시간
                </Text>
                <Segmented<DurMs>
                  ariaLabel="측정 시간"
                  value={durMs}
                  onChange={setDurMs}
                  options={[
                    { value: '5000', label: '5초' },
                    { value: '10000', label: '10초 (권장)' },
                    { value: '15000', label: '15초' },
                  ]}
                />
              </Stack>
              <Button size="lg" icon={Play} label={`${secs}초 구동 시작`} onClick={runPump} disabled={busy} full />
              <Button variant="ghost" label="다른 펌프 선택" onClick={() => setStep('select')} />
            </Stack>
          </Columns>
        </Stack>
      ) : null}

      {step === 'running' ? (
        <Stack gap={16}>
          <Text variant="title">펌프 {pump} 구동 중…</Text>
          <Card className="device-card">
            <p className="calibrate-big" aria-live="off">
              {countdown ? fmtDuration(countdown.remainingMs) : '준비 중'}
            </p>
            <ProgressBar
              value={countdown?.progress ?? 0}
              height={12}
              ariaLabel={`펌프 ${pump} 구동 진행률`}
            />
            <Text variant="caption" tone="secondary">
              계량컵을 움직이지 말고 끝날 때까지 기다려 주세요.
            </Text>
          </Card>
          <Button variant="danger" icon={OctagonX} label="정지" onClick={() => deviceClient.stop().catch(() => undefined)} />
        </Stack>
      ) : null}

      {step === 'measure' && pump ? (
        <Stack gap={16}>
          <Text variant="title">실제로 나온 양을 입력하세요</Text>
          <Columns>
            <Stack gap={16}>
              <TextField
                label={`${secs}초 동안 나온 양`}
                placeholder="예: 195"
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                value={measured}
                onChange={setMeasured}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && mlpsValid && !saving) void save();
                }}
                trailing="ml"
                autoFocus
                error={measured && !mlpsValid ? `유량이 ${LIMITS.minMlps}~${LIMITS.maxMlps} ml/초 범위를 벗어나요. 다시 확인해 주세요.` : undefined}
              />
              {kind === 'demo' && typeof job?.simActualMl === 'number' ? (
                <Banner
                  tone="info"
                  title="데모 모드"
                  message={`가상 기기에서 약 ${job.simActualMl}ml 가 나왔다고 가정해요.`}
                  action={{ label: '이 값 입력', onClick: () => setMeasured(String(job.simActualMl)) }}
                />
              ) : null}
            </Stack>
            <Stack gap={12}>
              <Card tone="accent" className="device-card calibrate-result" aria-live="polite">
                <Text variant="label" tone="secondary" as="p">
                  계산된 유량
                </Text>
                <p className="calibrate-big">
                  {mlps != null ? `${mlps}` : '-'}
                  <span className="calibrate-big__unit">ml/초</span>
                </p>
                <Text variant="caption" tone="secondary" numeric>
                  {measured ? `${measured}ml ÷ ${secs}초` : '나온 양 ÷ 구동 시간'} · 기존 값 {cal?.[pump - 1] ?? LIMITS.defaultMlps} ml/초
                </Text>
              </Card>
              <Button size="lg" icon={Save} label="기기에 저장" onClick={save} loading={saving} disabled={!mlpsValid} full />
              <Button variant="ghost" icon={RotateCcw} label="다시 측정" onClick={() => setStep('prepare')} />
            </Stack>
          </Columns>
        </Stack>
      ) : null}

      {step === 'saved' ? (
        <Stack gap={20}>
          <div className="calibrate-done" role="status">
            <CircleCheck size={56} aria-hidden="true" className="calibrate-done__icon" />
            <Text variant="title" align="center">
              저장했어요
            </Text>
            <Text tone="secondary" align="center">
              펌프 {pump} 유량을 {savedValue} ml/초로 기기에 저장했어요. 전원을 꺼도 유지돼요.
            </Text>
          </div>
          <Card padded={false}>
            <ul className="calibrate-table" aria-label="펌프별 유량">
              {slots.map((s) => (
                <li key={s.pump} className={cx('calibrate-table__row', s.pump === pump && 'is-current')}>
                  <span className="calibrate-table__pump">펌프 {s.pump}</span>
                  <span className="calibrate-table__name">{s.name || '비어 있음'}</span>
                  <span className="calibrate-table__value">{cal?.[s.pump - 1] ?? '-'} ml/s</span>
                </li>
              ))}
            </ul>
          </Card>
          <div className="calibrate-actions">
            <Button
              variant="secondary"
              label="다른 펌프도 측정하기"
              onClick={() => {
                setMeasured('');
                setStep('select');
              }}
            />
            <Button label="완료" onClick={() => back('/device')} />
          </div>
        </Stack>
      ) : null}
    </Page>
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
    <ol className="calibrate-steps" aria-label={`${STEPS.length}단계 중 ${idx + 1}단계: ${STEPS[idx]?.label ?? ''}`}>
      {STEPS.map((s, i) => (
        <li
          key={s.key}
          className={cx('calibrate-steps__item', i < idx && 'is-done', i === idx && 'is-current')}
          aria-current={i === idx ? 'step' : undefined}>
          <span className="calibrate-steps__bar" aria-hidden="true" />
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
