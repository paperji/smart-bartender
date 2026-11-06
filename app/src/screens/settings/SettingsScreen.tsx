/**
 * 앱 설정 (v2.1 src/app/settings.tsx → 밝은 톤, WEBAPP_DESIGN §4·§6)
 *  - AI: 추천 방식(Gemini 내 키 / 오프라인)·Gemini API 키 등록(키 확인·저장·삭제)·모델·키 발급 방법 → AiSection
 *  - 기기 연결(데모 모드·자동 재연결·기억한 기기), 배출 모드(순차/동시), 성인 인증(만 19세) 상태·초기화, 데이터 초기화
 *  - 앱 정보(버전·실행 환경·내려받기·개인정보·오픈소스) → AppInfoSection
 * 배치: PC(≥900px) 2열 [AI | 기기·배출·성인·데이터·앱 정보], 모바일 1열(같은 순서)
 */
import { Bluetooth, Database, GitBranch, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { fmtDate } from '@/lib/format';
import type { DispenseMode } from '@/lib/types';
import { clearDemoCal } from '@/store/demoCal';
import { useDevice } from '@/store/device';
import { useDraft, useSession } from '@/store/draft';
import { useHistory } from '@/store/history';
import { deleteGeminiKey, useSettings } from '@/store/settings';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';
import { Badge, Button, Card, Columns, confirm, Divider, Page, PageHeader, Section, Segmented, Switch, Text } from '@/ui';

import { AiSection } from './AiSection';
import { AppInfoSection } from './AppInfoSection';

import './SettingsScreen.css';

/** 기기가 작업(제조·프라이밍·세척) 중인지 */
function useDeviceBusy(): boolean {
  return useDevice((s) => s.job?.status === 'pending' || s.job?.status === 'running');
}

function DeviceSettings() {
  const demoMode = useSettings((s) => s.demoMode);
  const autoReconnect = useSettings((s) => s.autoReconnect);
  const lastDevices = useSettings((s) => s.lastDevices);
  const set = useSettings((s) => s.set);
  const busy = useDeviceBusy();
  const remembered = [lastDevices.native, lastDevices.web]
    .filter((d): d is NonNullable<typeof d> => !!d)
    .map((d) => d.name ?? d.id);
  return (
    <Section title="기기 연결" icon={Bluetooth}>
      <Card className="settings-card">
        <Switch
          label="데모 모드 (가상 기기)"
          description={busy ? '기기가 작업 중이라 끝난 뒤에 바꿀 수 있어요' : '하드웨어 없이 전체 흐름을 체험해요'}
          checked={demoMode}
          disabled={busy}
          onChange={(v) => set({ demoMode: v })}
        />
        <Divider />
        <Switch
          label="자동 재연결"
          description="연결이 끊기면 마지막 기기에 자동으로 다시 연결해요"
          checked={autoReconnect}
          onChange={(v) => set({ autoReconnect: v })}
        />
        {remembered.length ? (
          <Text variant="caption" tone="muted">
            기억한 기기: {remembered.join(', ')}
          </Text>
        ) : null}
      </Card>
    </Section>
  );
}

function DispenseSettings() {
  const dispenseMode = useSettings((s) => s.dispenseMode);
  const set = useSettings((s) => s.set);
  return (
    <Section title="배출 모드" icon={GitBranch}>
      <Card className="settings-card">
        <Segmented<DispenseMode>
          ariaLabel="배출 모드"
          value={dispenseMode}
          onChange={(v) => set({ dispenseMode: v })}
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
}

function AdultSettings() {
  const adultVerifiedAt = useSettings((s) => s.adultVerifiedAt);
  const set = useSettings((s) => s.set);
  return (
    <Section title="성인 인증" icon={ShieldCheck} description="주류가 들어간 레시피를 처음 만들 때 만 19세 이상인지 확인해요">
      <Card className="settings-card">
        <div className="settings-status">
          <Text>{adultVerifiedAt ? `${fmtDate(adultVerifiedAt)}에 확인함` : '아직 확인하지 않음'}</Text>
          <Badge label={adultVerifiedAt ? '확인됨' : '미확인'} tone={adultVerifiedAt ? 'success' : 'neutral'} />
        </div>
        <Button
          size="sm"
          variant="secondary"
          label="성인 인증 초기화"
          icon={RefreshCw}
          disabled={!adultVerifiedAt}
          onClick={() => {
            set({ adultVerifiedAt: null });
            toast('다음에 주류 레시피를 만들 때 다시 확인해요.', 'success');
          }}
        />
        <Text variant="caption" tone="muted">
          시연·전시처럼 여러 사람이 쓰는 경우 초기화해 두세요.
        </Text>
      </Card>
    </Section>
  );
}

function DataSettings({ onReset }: { onReset: () => void }) {
  const busy = useDeviceBusy();
  const resetAll = async () => {
    if (busy) {
      toast('기기가 작업 중이에요. 끝난 뒤에 초기화해 주세요.', 'warning');
      return;
    }
    const ok = await confirm(
      '데이터 초기화',
      '재료 설정, 제조 기록·즐겨찾기·거절 기록, 설정, 기억한 기기, 데모 기기 유량, 저장된 API 키를 모두 지우고 처음 상태로 돌아가요. 되돌릴 수 없어요.',
      { confirmText: '모두 초기화', destructive: true },
    );
    if (!ok) return;
    useSlots.getState().reset();
    useHistory.getState().clear();
    useDraft.getState().resetInput();
    const session = useSession.getState();
    session.setCurrent(null);
    session.setExplore(null);
    session.setRejectStreak(0);
    session.setInstallTarget(null);
    await deleteGeminiKey().catch(() => undefined);
    await clearDemoCal();
    useSettings.getState().reset();
    onReset();
    toast('모든 데이터를 초기화했어요.', 'success');
  };
  return (
    <Section title="데이터" icon={Database}>
      <Button variant="danger" icon={Trash2} label="모든 데이터 초기화" full onClick={resetAll} />
    </Section>
  );
}

export function SettingsScreen() {
  // 데이터 초기화 뒤 AI 칸의 입력·확인 결과·모델 목록도 처음 상태로 (다시 그림)
  const [resetSeq, setResetSeq] = useState(0);
  return (
    <Page width="wide" gap={28} header={<PageHeader title="앱 설정" subtitle="AI 키·기기·성인 인증·데이터·앱 정보" back />}>
      <Columns template="1fr 1fr" gap={28}>
        <AiSection key={resetSeq} />
        <div className="settings-stack">
          <DeviceSettings />
          <DispenseSettings />
          <AdultSettings />
          <DataSettings onReset={() => setResetSeq((n) => n + 1)} />
          <AppInfoSection />
        </div>
      </Columns>
    </Page>
  );
}
