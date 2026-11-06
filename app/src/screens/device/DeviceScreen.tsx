/**
 * ④ 기기 — v2.1 (tabs)/device.tsx 를 밝은 톤·반응형으로 옮김 (기능·문구 그대로)
 * - 연결 카드: 기기 이름·상태·펌웨어/펌프/캘리브레이션 요약, 검색 목록(이름·신호), 연결·해제·다른 기기로 변경·검색 중지·연결 취소,
 *   기억한 기기(앱 시작 시 자동 재연결, SPEC §5.5)·지우기, 블루투스 사용 불가 안내, 마지막 오류
 * - calSet 에 0 이 있으면 "캘리브레이션 전" 배너 (SPEC §5.6, 공용 CalibrationBanner)
 * - 데모 모드·자동 재연결 스위치, 가상 기기 유량 초기화, 연결 방식(Web Bluetooth/APK) 안내
 * - 기기 정보(펌웨어·한도·작동 시간·펌프별 유량/측정 여부)
 * - 작업 카드: 진행 중·마지막 작업(세척·펌프 구동·프라이밍, 제조 중이면 진행 화면 바로가기),
 *   재연결 뒤 status.last 로 확정된 결과와 "결과 확인 필요"(uncertain) 안내 — 판정은 device/client.ts
 * - 캘리브레이션 마법사(#/calibrate), 프라이밍(길게 누르는 동안 구동, 최대 20초), 세척(펌프당 3/5/10초), 배출 모드(순차/동시),
 *   모든 펌프 즉시 정지, 앱 설정(#/settings)
 * 배치: 모바일 1열(v2.1 순서 그대로), PC(≥900px) 2열 — 왼쪽 연결·정보, 오른쪽 작업·관리
 */
import {
  ArrowLeftRight,
  Bluetooth,
  ChevronRight,
  CircleHelp,
  Cpu,
  Droplets,
  FlaskConical,
  Gauge,
  GitBranch,
  MonitorSmartphone,
  OctagonX,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Square,
  Trash2,
  Unplug,
  Waves,
  Wine,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

import { CalibrationBanner } from '@/components';
import { deviceClient } from '@/lib/device/client';
import { fmtDuration } from '@/lib/format';
import { go } from '@/lib/nav';
import { LIMITS } from '@/lib/protocol';
import type { FoundDevice } from '@/lib/transport/types';
import type { PumpSlot } from '@/lib/types';
import { isElectron, PLATFORM_LABEL, platformKind } from '@/platform/detect';
import { haptic } from '@/platform/haptics';
import { isBusy, useDevice, type JobState } from '@/store/device';
import { useSettings } from '@/store/settings';
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
  Divider,
  Page,
  PageHeader,
  ProgressBar,
  Row,
  Section,
  Segmented,
  Spinner,
  Stack,
  Switch,
  Text,
} from '@/ui';

import { calSetLabel, connectionGuide, jobView, kindLabel, signalLabel } from './deviceText';
import './device.css';

type CleanMs = '3000' | '5000' | '10000';

/** 프라이밍: 이만큼 누르고 있어야 펌프가 돌기 시작 (v2.1 delayLongPress 300ms) */
const PRIME_HOLD_MS = 300;
/** 프라이밍 한 번 최대 구동 (손을 떼면 바로 멈춤, 안전을 위해 최대 20초 — v2.1 그대로) */
const PRIME_MAX_MS = 20000;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 웹: 브라우저가 예전에 허락한 기기 목록(getDevices)을 지원하는지 — 없으면 다시 열 때마다 기기를 골라야 함 */
function webCanAutoConnect(): boolean {
  const bt = typeof navigator !== 'undefined' ? (navigator as Navigator & { bluetooth?: { getDevices?: unknown } }).bluetooth : undefined;
  return !!bt && typeof bt.getDevices === 'function';
}

export function DeviceScreen() {
  const st = useDevice();
  const demoMode = useSettings((s) => s.demoMode);
  const autoReconnect = useSettings((s) => s.autoReconnect);
  const dispenseMode = useSettings((s) => s.dispenseMode);
  const setSettings = useSettings((s) => s.set);
  const lastDevices = useSettings((s) => s.lastDevices);
  const slots = useSlots((s) => s.slots);
  const [includeAll, setIncludeAll] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [cleanMs, setCleanMs] = useState<CleanMs>('5000');

  const connected = st.conn === 'connected';
  const busy = isBusy(st.job);
  const kind = st.transportKind;
  const { text: connText, tone: connTone } = connLabel(st.conn, kind);
  const isWeb = kind === 'web';
  const remembered = lastDevices?.[kind];
  const linking = st.conn === 'scanning' || st.conn === 'connecting' || st.conn === 'reconnecting';
  const prime = usePriming(connected, busy);

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
    } catch (e) {
      alertMessage('기기 검색 실패', errMsg(e));
    } finally {
      setScanned(true);
    }
  };

  /** 다른 기기로 변경: 연결 해제 → 다시 검색 → 목록에서 선택 */
  const switchDevice = async () => {
    setScanned(false);
    try {
      await deviceClient.switchDevice(includeAll);
    } catch (e) {
      alertMessage('기기 변경', errMsg(e));
    } finally {
      setScanned(true);
    }
  };

  const forget = async () => {
    const ok = await confirm('기억한 기기 지우기', '다음에 앱을 켤 때 이 기기에 자동으로 연결하지 않아요.', { confirmText: '지우기' });
    if (!ok) return;
    deviceClient.forgetDevice();
    toast('기억한 기기를 지웠어요.', 'success');
  };

  const connect = async (id: string, name: string) => {
    try {
      await deviceClient.connect(id, name);
      haptic.success();
      toast(`${name}에 연결했어요.`, 'success');
    } catch (e) {
      alertMessage('연결 실패', errMsg(e));
    }
  };

  const guard = (fn: () => Promise<unknown>) => async () => {
    if (!connected) {
      toast('먼저 기기를 연결해 주세요.', 'warning');
      return;
    }
    try {
      await fn();
    } catch (e) {
      alertMessage('명령 실패', errMsg(e));
    }
  };

  const resetDemoCal = () => {
    deviceClient
      .resetDemoCalibration()
      .then(() => toast(`가상 기기 유량을 기본값(${LIMITS.defaultMlps}ml/초)으로 되돌렸어요.`, 'success'))
      .catch(() => undefined);
  };

  const job = st.job;
  // 유지보수 작업(세척·구동·프라이밍): 진행 중·끝남(결과 모름 포함). 시작 자체를 거부당한 작업(오류 안내창이 이미 뜸)은 숨김 — v2.1
  // 제조 작업: 진행 중일 때만 (끝나면 제조 화면·기록에서 보여 줌)
  const jobShown =
    job && (job.kind === 'make' ? isBusy(job) : isBusy(job) || job.status !== 'error' || !!job.uncertain) ? job : null;

  const KindIcon = kind === 'demo' ? FlaskConical : Bluetooth;
  const info = st.info;
  const calCount = st.calSet ? st.calSet.filter((v) => v === 1).length : null;
  const showFound = !connected && !isWeb && (st.conn === 'scanning' || st.found.length > 0);
  const scanLabel = isWeb ? (isElectron() ? '기기 선택' : '기기 선택 (브라우저 창)') : kind === 'demo' ? '가상 기기 검색' : '주변 기기 검색';
  const autoOnStart = kind === 'demo' || (autoReconnect && (kind !== 'web' || webCanAutoConnect()));

  // ───────── 왼쪽(모바일 위쪽): 연결 ─────────
  const connectionCard = (
    <Card className="device-card device-conn" aria-label="기기 연결">
      <div className="device-conn__head">
        <span className={cx('device-bigicon', `device-tone--${connTone}`)} aria-hidden="true">
          <KindIcon size={26} />
        </span>
        <div className="device-conn__titles">
          <Text variant="heading" as="p" className="device-conn__name">
            {connected ? (st.deviceName ?? 'SmartBartender') : connText}
          </Text>
          <p className="device-conn__state" role="status">
            <span className={cx('device-dot', `device-tone--${connTone}`)} aria-hidden="true" />
            <span>
              {connected ? connText : kindLabel(kind, isElectron())}
              {st.conn === 'reconnecting' && st.reconnectAttempt > 0 ? ` · ${st.reconnectAttempt}번째 시도` : ''}
            </span>
          </p>
        </div>
        {linking ? <Spinner size={20} label={connText} /> : null}
      </div>

      {connected && info ? (
        <div className="device-conn__facts">
          <Badge label={`펌웨어 v${info.fw}`} icon={Cpu} />
          <Badge label={`펌프 ${info.pumps}개`} icon={Droplets} />
          {calCount != null ? (
            <Badge
              tone={calCount >= (st.calSet?.length ?? 0) ? 'success' : 'warning'}
              icon={Gauge}
              label={`캘리브레이션 ${calCount}/${st.calSet?.length ?? info.pumps}`}
            />
          ) : (
            <Badge icon={Gauge} label="캘리브레이션 알 수 없음" />
          )}
        </div>
      ) : null}

      {st.availability && !st.availability.ok ? (
        <Banner
          tone="warning"
          title="블루투스를 사용할 수 없어요"
          message={st.availability.reason ?? ''}
          action={!demoMode ? <Button size="sm" variant="secondary" icon={FlaskConical} label="데모 모드 켜기" onClick={() => setSettings({ demoMode: true })} /> : null}
        />
      ) : null}

      {st.lastError && !connected ? <Banner tone="error" message={st.lastError} /> : null}

      {connected ? (
        <Stack gap={8}>
          <Button variant="secondary" icon={ArrowLeftRight} label="다른 기기로 변경" onClick={switchDevice} disabled={busy} full />
          <Button variant="ghost" icon={Unplug} label="연결 해제" onClick={() => deviceClient.disconnect().catch(() => undefined)} full />
        </Stack>
      ) : st.conn === 'scanning' ? (
        <Button variant="secondary" icon={Square} label="검색 중지" onClick={() => deviceClient.stopScan().catch(() => undefined)} full />
      ) : st.conn === 'reconnecting' || st.conn === 'connecting' ? (
        <Button variant="secondary" icon={X} label="연결 취소" onClick={() => deviceClient.disconnect().catch(() => undefined)} full />
      ) : (
        <Button
          icon={isWeb ? Bluetooth : Search}
          label={scanLabel}
          onClick={scan}
          disabled={!!st.availability && !st.availability.ok}
          full
        />
      )}

      {showFound ? (
        <div className="device-found">
          <Row justify="space-between">
            <Text variant="label" tone="secondary">
              검색된 기기
            </Text>
            {st.conn === 'scanning' ? <Spinner size={18} label="검색 중" /> : null}
          </Row>
          {st.found.length > 1 ? (
            <Text variant="caption" tone="muted">
              연결할 기기를 눌러 고르세요. 신호가 강할수록 가까이 있는 기기예요.
            </Text>
          ) : null}
          {st.found.length ? (
            <ul className="device-found__list">
              {st.found.map((d) => (
                <li key={d.id}>
                  <FoundRow device={d} isLast={remembered?.id === d.id} onPick={() => connect(d.id, d.name)} />
                </li>
              ))}
            </ul>
          ) : null}
          {st.conn === 'scanning' && st.found.length === 0 ? (
            <Text variant="caption" tone="muted">
              SmartBartender 를 찾는 중이에요…
            </Text>
          ) : null}
        </div>
      ) : null}

      {!connected && scanned && st.conn !== 'scanning' && st.found.length === 0 && !isWeb ? (
        <Banner
          tone="info"
          title="기기를 찾지 못했어요"
          message="① 칵테일 메이커 전원이 켜져 있는지(파란 LED 깜빡임) ② 휴대폰(PC)과 2m 이내인지 ③ 다른 휴대폰·PC에 이미 연결되어 있지 않은지 확인한 뒤 다시 검색해 보세요."
        />
      ) : null}

      {!connected && remembered && !linking ? (
        <Row justify="space-between" wrap className="device-remembered">
          <Text variant="caption" tone="muted" className="device-remembered__text">
            기억한 기기: {remembered.name ?? remembered.id}
            {autoOnStart ? ' (앱을 켜면 자동 연결)' : ''}
          </Text>
          <Button size="sm" variant="ghost" icon={Trash2} label="지우기" onClick={forget} />
        </Row>
      ) : null}

      {kind === 'native' && !connected ? (
        <Switch label="모든 블루투스 기기 보기" description="기기 이름이 안 보일 때 켜 보세요" checked={includeAll} onChange={setIncludeAll} />
      ) : null}
    </Card>
  );

  const modeCard = (
    <Card className="device-card">
      <Switch
        icon={FlaskConical}
        label="데모 모드 (가상 기기)"
        description="하드웨어 없이도 연결·제조 과정을 그대로 체험할 수 있어요. 실제 기기를 쓰려면 끄세요."
        checked={demoMode}
        onChange={(v) => setSettings({ demoMode: v })}
      />
      {demoMode && connected ? (
        <div className="device-demo-tools">
          <Button size="sm" variant="secondary" icon={RotateCcw} label="가상 기기 유량 초기화" onClick={resetDemoCal} />
          <Text variant="caption" tone="muted">
            가상 기기의 유량을 캘리브레이션 전 기본값({LIMITS.defaultMlps}ml/초)으로 되돌려요. 캘리브레이션 마법사를 다시 체험할 때 써요.
          </Text>
        </div>
      ) : null}
      <Divider />
      <Switch
        icon={RefreshCw}
        label="자동 재연결"
        description="연결이 끊기면 마지막 기기에 자동으로 다시 연결해요"
        checked={autoReconnect}
        onChange={(v) => setSettings({ autoReconnect: v })}
      />
    </Card>
  );

  const pk = platformKind();
  // 실행 환경별 안내 (EXE 는 브라우저가 아니라 앱 안 기기 선택 창 — DEV-3)
  const guide = connectionGuide(pk, webCanAutoConnect());
  const transportSection = (
    <Section title="연결 방식" icon={MonitorSmartphone} description="실제 칵테일 메이커에 연결할 때 알아 두세요">
      <Card className="device-card">
        <dl className="device-info">
          <div className="device-info__row">
            <dt>실행 환경</dt>
            <dd>{PLATFORM_LABEL[pk]}</dd>
          </div>
          <div className="device-info__row">
            <dt>실제 기기 연결</dt>
            <dd>{guide.label}</dd>
          </div>
        </dl>
        <ul className="device-notes">
          {guide.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        {demoMode ? (
          <Text variant="caption" tone="muted">
            지금은 데모 모드예요. 데모 모드를 끄면 이 방식으로 실제 기기에 연결해요.
          </Text>
        ) : null}
      </Card>
    </Section>
  );

  const infoSection =
    connected && info ? (
      <Section title="기기 정보" icon={Cpu}>
        <Card className="device-card">
          <dl className="device-info">
            <InfoRow label="이름" value={info.name} />
            <InfoRow label="펌웨어" value={`v${info.fw}`} />
            <InfoRow label="펌프 수" value={`${info.pumps}개`} />
            <InfoRow label="최대 제조량" value={`${info.maxMl}ml (재료당 ${info.maxStepMl}ml)`} />
            <InfoRow
              label="펌프당 최대 구동"
              value={st.maxPumpMs ? `${Math.round(st.maxPumpMs / 1000)}초` : `알 수 없음 (구버전: ${LIMITS.legacyMaxPumpMs / 1000}초로 계산)`}
            />
            {st.uptimeMs != null ? <InfoRow label="작동 시간" value={fmtDuration(st.uptimeMs)} /> : null}
          </dl>
          <Divider />
          <Text variant="label" tone="secondary" as="p">
            펌프별 유량 (ml/초)
          </Text>
          <ul className="device-calgrid">
            {(st.cal ?? []).map((v, i) => {
              const set = st.calSet ? st.calSet[i] : null;
              const lab = calSetLabel(set);
              return (
                <li key={i} className={cx('device-calcell', set === 0 && 'is-uncal')}>
                  <span className="device-calcell__pump">펌프 {i + 1}</span>
                  <span className="device-calcell__value sb-num">{v}</span>
                  <span className="device-calcell__name">{slots[i]?.name || '비어 있음'}</span>
                  <span>
                    <Badge tone={lab.tone} label={lab.text} />
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </Section>
    ) : null;

  // ───────── 오른쪽(모바일 아래쪽): 작업·관리 ─────────
  const calibrateSection = (
    <Section title="캘리브레이션" description="펌프마다 1초에 나오는 양(ml)을 측정해 정확도를 높여요" icon={Gauge}>
      <LinkCard
        icon={Gauge}
        accent
        title="캘리브레이션 마법사"
        caption="계량컵으로 10초 동안 나온 양을 재서 입력하면 자동 계산돼요"
        pressLabel="캘리브레이션 마법사 열기"
        onPress={() => go('/calibrate')}
      />
    </Section>
  );

  const primeSection = (
    <Section
      title="프라이밍 (튜브 채우기)"
      description="버튼을 길게 누르고 있는 동안 펌프가 돌아가요. 노즐에서 액체가 나오면 손을 떼세요. 나온 양은 재료 잔량에서 빼요."
      icon={Droplets}>
      <div className="device-prime-grid">
        {slots.map((s) => {
          const active = prime.priming === s.pump;
          return (
            <PrimeButton
              key={s.pump}
              slot={s}
              active={active}
              blocked={!connected || (busy && !active)}
              onStart={() => prime.start(s.pump)}
              onEnd={prime.end}
            />
          );
        })}
      </div>
      <Text variant="caption" tone="muted">
        키보드: 버튼에 초점을 두고 스페이스바를 누르고 있는 동안 돌아가요. 한 번에 최대 {PRIME_MAX_MS / 1000}초까지만 돌아요.
      </Text>
    </Section>
  );

  const cleanSection = (
    <Section title="세척" description="용기에 깨끗한 물을 넣고, 모든 펌프를 차례로 돌려 튜브를 헹궈요" icon={Sparkles}>
      <Card className="device-card">
        <Segmented<CleanMs>
          ariaLabel="펌프당 세척 시간"
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
          icon={Waves}
          label="세척 시작"
          disabled={!connected || busy}
          onClick={guard(() => deviceClient.clean(Number(cleanMs)))}
          full
        />
      </Card>
    </Section>
  );

  const dispenseSection = (
    <Section title="배출 모드" icon={GitBranch}>
      <Card className="device-card">
        <Segmented
          ariaLabel="배출 모드"
          value={dispenseMode}
          onChange={(v) => setSettings({ dispenseMode: v })}
          options={[
            { value: 'seq', label: '순차 (권장)' },
            { value: 'par', label: '동시' },
          ]}
        />
        <Text variant="caption" tone="muted">
          {dispenseMode === 'seq'
            ? '펌프를 하나씩 차례로 돌려요. 전압이 안정적이라 양이 더 정확해요.'
            : '여러 펌프를 한꺼번에 돌려 빨리 만들어요. 전원(5V 4A)이 약하면 기기가 재부팅될 수 있어요.'}
        </Text>
      </Card>
    </Section>
  );

  const settingsCard = (
    <LinkCard
      icon={SettingsIcon}
      title="앱 설정"
      caption="AI 키 · 모델 · 성인 인증 · 데이터 초기화 · 앱 정보"
      pressLabel="앱 설정 열기"
      onPress={() => go('/settings')}
    />
  );

  return (
    <Page width="wide" header={<PageHeader title="기기" subtitle="칵테일 메이커(ESP32)와 블루투스로 연결하고 관리해요." />}>
      <Columns template="1fr 1fr" className="device-cols">
        <Stack gap={20}>
          {connectionCard}
          <CalibrationBanner dismissible={false} />
          {modeCard}
          {infoSection}
          {transportSection}
        </Stack>
        <Stack gap={20}>
          {jobShown ? <JobCard job={jobShown} /> : null}
          {calibrateSection}
          {primeSection}
          {cleanSection}
          {dispenseSection}
          {connected ? (
            <Button variant="danger" icon={OctagonX} label="모든 펌프 즉시 정지" onClick={() => deviceClient.stop().catch(() => undefined)} full />
          ) : null}
          {settingsCard}
        </Stack>
      </Columns>
    </Page>
  );
}

// ───────────────────────── 조각 ─────────────────────────

/** 다른 화면으로 가는 카드 (v2.1 Card onPress + 아이콘·제목·설명·›) */
function LinkCard(props: { icon: LucideIcon; title: string; caption: string; pressLabel: string; onPress: () => void; accent?: boolean }) {
  const { icon: Icon, title, caption, pressLabel, onPress, accent } = props;
  return (
    <Card onPress={onPress} pressLabel={pressLabel}>
      <span className="device-link">
        <span className={cx('device-bigicon', 'device-bigicon--sm', accent ? 'device-tone--accent' : 'device-tone--neutral')} aria-hidden="true">
          <Icon size={22} />
        </span>
        <span className="device-link__text">
          <span className="device-link__title">{title}</span>
          <span className="device-link__caption">{caption}</span>
        </span>
        <ChevronRight size={20} aria-hidden="true" className="device-link__chevron" />
      </span>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="device-info__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SignalBars({ bars }: { bars: 1 | 2 | 3 }) {
  return (
    <span className="device-bars" aria-hidden="true">
      {[1, 2, 3].map((b) => (
        <span key={b} className={cx('device-bars__bar', b <= bars && 'is-on')} style={{ height: 4 + b * 4 }} />
      ))}
    </span>
  );
}

/** 검색된 기기 한 줄 — 이름은 자르지 않음 (SmartBartender-A1B2 처럼 끝자리로 구분하므로) */
function FoundRow({ device: d, isLast, onPick }: { device: FoundDevice; isLast: boolean; onPick: () => void }) {
  const sig = signalLabel(d.rssi);
  const Icon = d.likely ? Wine : Bluetooth;
  return (
    <button
      type="button"
      className="device-found__row"
      aria-label={`${d.name} 연결${sig ? `, 신호 ${sig.text}` : ''}`}
      onClick={() => {
        haptic.tap();
        onPick();
      }}>
      <Icon size={20} aria-hidden="true" className={cx('device-found__icon', d.likely && 'is-likely')} />
      <span className="device-found__text">
        <span className="device-found__name">{d.name}</span>
        <span className="device-found__sub">
          {d.likely ? '스마트 바텐더' : '다른 기기'}
          {isLast ? ' · 지난번 기기' : ''}
        </span>
        {sig ? (
          <span className="device-found__sub sb-num">
            신호 {sig.text} ({d.rssi} dBm)
          </span>
        ) : null}
      </span>
      {sig ? <SignalBars bars={sig.bars} /> : null}
      <ChevronRight size={18} aria-hidden="true" className="device-found__chevron" />
    </button>
  );
}

/** 진행 중·마지막 작업 카드 (v2.1 유지보수 작업 카드 + 결과 확인 필요 안내 + 제조 중 바로가기) */
function JobCard({ job }: { job: JobState }) {
  const running = isBusy(job);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);
  const v = jobView(job);
  const elapsed = job.ackAt ? now - job.ackAt : 0;
  // 프라이밍은 손을 떼면 끝나므로(20초는 최대값) 남은 시간을 보여 주지 않음
  const holdToRun = job.kind === 'run' && job.purpose === 'prime';
  const remain = running && !holdToRun && job.totalMs && job.ackAt ? `약 ${fmtDuration(Math.max(0, job.totalMs - elapsed))} 남음` : '';
  const pct = job.status === 'done' ? 100 : job.pct;
  const cardTone = running ? 'accent' : v.tone === 'warning' ? 'warning' : v.tone === 'success' ? 'success' : 'neutral';
  return (
    <Card tone={cardTone} className="device-card device-job" aria-label="기기 작업">
      <div className="device-job__head" aria-live="polite">
        <Text variant="label" as="p" className="device-job__title">
          {v.title}
        </Text>
        {remain ? (
          <Text variant="caption" tone="secondary" numeric>
            {remain}
          </Text>
        ) : null}
      </div>
      {v.badge ? (
        <div>
          <Badge tone="warning" icon={CircleHelp} label={v.badge} />
        </div>
      ) : null}
      <ProgressBar
        value={pct / 100}
        tone={running ? 'accent' : job.status === 'done' && !job.uncertain ? 'success' : v.tone === 'warning' ? 'warning' : 'neutral'}
        indeterminate={running && job.status === 'pending' && !!job.uncertain}
        ariaLabel={`${v.title} 진행률`}
      />
      {v.message ? (
        <Text variant="caption" tone="secondary">
          {v.message}
        </Text>
      ) : null}
      {running ? (
        <Stack gap={8}>
          {job.kind === 'make' ? <Button variant="secondary" icon={Play} label="제조 진행 화면 보기" onClick={() => go('/brewing')} full /> : null}
          <Button variant="danger" icon={OctagonX} label="정지" onClick={() => deviceClient.stop().catch(() => undefined)} full />
        </Stack>
      ) : (
        <div>
          <Button size="sm" variant="ghost" label="닫기" onClick={() => deviceClient.clearJob()} />
        </div>
      )}
    </Card>
  );
}

/**
 * 프라이밍 상태 (v2.1 startPrime/endPrime 그대로) + 웹 안전장치:
 * 화면을 떠나거나 창이 가려지면(다른 탭·앱) 바로 멈춤 — 손을 뗀 이벤트를 못 받는 경우 대비
 */
function usePriming(connected: boolean, busy: boolean) {
  const [priming, setPriming] = useState<number | null>(null);
  const ref = useRef<number | null>(null);
  const job = useDevice((s) => s.job);

  const end = async () => {
    if (ref.current == null) return;
    ref.current = null;
    setPriming(null);
    await deviceClient.stop().catch(() => undefined);
  };
  const endRef = useRef(end);
  endRef.current = end;

  const start = async (p: number) => {
    if (!connected || busy) return;
    haptic.press();
    ref.current = p;
    setPriming(p);
    try {
      // 손을 떼면 stop (안전을 위해 최대 20초). 프라이밍은 실제 재료가 나오므로 끝나면 잔량에서 뺌 (brew.ts)
      await deviceClient.run(p, PRIME_MAX_MS, { purpose: 'prime' });
      if (ref.current !== p) await deviceClient.stop();
    } catch (e) {
      ref.current = null;
      setPriming(null);
      toast(e instanceof Error && e.message ? e.message : '펌프를 구동하지 못했어요', 'error');
    }
  };

  // 최대 시간이 지나 기기가 먼저 멈춤 → "채우는 중" 표시 끄기
  useEffect(() => {
    if (ref.current == null || !job || job.kind !== 'run' || job.purpose !== 'prime') return;
    if (!isBusy(job)) {
      ref.current = null;
      setPriming(null);
    }
  }, [job]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void endRef.current();
    };
    const onBlur = () => void endRef.current();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', onBlur);
      // 누른 채로 화면을 떠남 → 멈춤
      if (ref.current != null) {
        ref.current = null;
        deviceClient.stop().catch(() => undefined);
      }
    };
  }, []);

  return { priming, start, end };
}

interface PrimeButtonProps {
  slot: PumpSlot;
  active: boolean;
  /** 누를 수 없음 (미연결·다른 작업 중) — disabled 대신 aria-disabled: 누르는 도중 비활성이 돼도 손 뗀 이벤트를 받게 */
  blocked: boolean;
  onStart: () => void;
  onEnd: () => void;
}

/**
 * 길게 누르는 동안 펌프 구동 (v2.1 onLongPress + onPressOut).
 * 손 뗌은 창 전체의 pointerup/pointercancel 로 받음 → 버튼 밖으로 손가락이 나가도·스크롤로 취소돼도 반드시 멈춤
 */
function PrimeButton({ slot, active, blocked, onStart, onEnd }: PrimeButtonProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(false);
  const detach = useRef<(() => void) | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const finish = (hint: boolean) => {
    detach.current?.();
    detach.current = null;
    const waiting = timer.current != null;
    clearTimer();
    if (started.current) {
      started.current = false;
      onEnd();
    } else if (waiting && hint) {
      toast('길게 누르고 있어야 펌프가 돌아가요.', 'info');
    }
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(
    () => () => {
      detach.current?.();
      clearTimer();
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (blocked || (e.pointerType === 'mouse' && e.button !== 0)) return;
    finishRef.current(false);
    started.current = false;
    const up = () => finishRef.current(true);
    const cancel = () => finishRef.current(false);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    detach.current = () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    timer.current = setTimeout(() => {
      timer.current = null;
      started.current = true;
      onStart();
    }, PRIME_HOLD_MS);
  };

  const isKey = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter';
  const empty = !slot.name;
  return (
    <button
      type="button"
      className={cx('device-prime', active && 'is-active', blocked && 'is-blocked')}
      aria-disabled={blocked || undefined}
      aria-pressed={active}
      aria-label={`펌프 ${slot.pump} 길게 눌러 채우기${empty ? ' (비어 있음)' : `, ${slot.name}`}`}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (!isKey(e)) return;
        e.preventDefault();
        if (e.repeat || blocked || started.current) return;
        started.current = true;
        onStart();
      }}
      onKeyUp={(e) => {
        if (!isKey(e)) return;
        e.preventDefault();
        finish(false);
      }}
      onBlur={() => finish(false)}>
      <span className="device-prime__top">
        <span className="dc-dot device-prime__dot" style={{ backgroundColor: slot.color }} aria-hidden="true" />
        <span className="device-prime__pump">펌프 {slot.pump}</span>
      </span>
      <span className="device-prime__name">{active ? '채우는 중…' : slot.name || '비어 있음'}</span>
    </button>
  );
}
