/**
 * 앱 설정 — AI 모드, 서버 URL, Gemini 키, 데모 모드, 성인 인증, 데이터 초기화, 앱 정보
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Segmented, SwitchRow } from '@/components/ui/controls';
import { Badge, Banner } from '@/components/ui/feedback';
import { Divider, Row, Screen, Section } from '@/components/ui/layout';
import { AppText } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { colors, space } from '@/constants/theme';
import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/prompt';
import { DEFAULT_SERVER_URL, interpretServerStatus, type ServerStatusResult } from '@/lib/ai/recommend';
import { getGeminiKey, secretStorageLabel, setGeminiKey } from '@/lib/secrets';
import type { AiMode } from '@/lib/types';
import { confirmAsync, fmtDate, maskKey } from '@/lib/ui';
import { clearDemoCal } from '@/store/demoCal';
import { useDraft } from '@/store/draft';
import { useHistory } from '@/store/history';
import { useSettings } from '@/store/settings';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';

const AI_HELP: Record<AiMode, string> = {
  server: '팀 서버(Vercel)가 Gemini 를 호출해요. API 키가 휴대폰에 없어서 가장 안전해요. 실패하면 오프라인 추천으로 자동 전환돼요.',
  direct: '내 Gemini API 키로 앱이 직접 Gemini 를 호출해요. 서버가 없을 때 쓰세요. 실패하면 서버 → 오프라인 순으로 시도해요.',
  offline: '인터넷 없이 앱에 내장된 규칙으로 추천해요. 시연 장소의 와이파이가 불안정할 때 유용해요.',
};

export default function SettingsScreen() {
  const s = useSettings();
  const [url, setUrl] = useState(s.serverUrl);
  const [model, setModel] = useState(s.geminiModel);
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ServerStatusResult | null>(null);

  useEffect(() => {
    getGeminiKey().then((k) => setHasKey(!!k));
  }, []);

  const saveUrl = () => {
    const v = url.trim() || DEFAULT_SERVER_URL;
    if (!/^https?:\/\//i.test(v)) {
      toast('주소는 https:// 로 시작해야 해요.', 'warning');
      return;
    }
    s.set({ serverUrl: v });
    setUrl(v);
    toast('서버 주소를 저장했어요.', 'success');
  };

  const testServer = async () => {
    setTesting(true);
    setTestResult(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url.trim() || DEFAULT_SERVER_URL, { method: 'GET', signal: ctrl.signal });
      // HTTP 200 만 보지 않고 상태 확인 응답(SPEC §3.2: service·keyConfigured)까지 확인
      setTestResult(interpretServerStatus(res.status, await res.text()));
    } catch (e: any) {
      setTestResult({ level: 'fail', msg: e?.name === 'AbortError' ? '응답 시간 초과 (10초)' : `연결 실패: ${e?.message ?? e}` });
    } finally {
      clearTimeout(t);
      setTesting(false);
    }
  };

  const saveKey = async () => {
    const k = keyInput.trim();
    if (k.length < 20) {
      toast('API 키 형식이 올바르지 않아요.', 'warning');
      return;
    }
    await setGeminiKey(k);
    s.set({ geminiKeyHint: maskKey(k) });
    setHasKey(true);
    setKeyInput('');
    toast('Gemini API 키를 저장했어요.', 'success');
  };

  const deleteKey = async () => {
    await setGeminiKey(null);
    s.set({ geminiKeyHint: null, aiMode: s.aiMode === 'direct' ? 'server' : s.aiMode });
    setHasKey(false);
    toast('API 키를 삭제했어요.', 'success');
  };

  const resetAll = async () => {
    const ok = await confirmAsync(
      '데이터 초기화',
      '재료 설정, 제조 기록·즐겨찾기·거절 기록, 설정, 기억한 기기, 데모 기기 유량, 저장된 API 키를 모두 지우고 처음 상태로 돌아가요. 되돌릴 수 없어요.',
      { confirmText: '모두 초기화', destructive: true },
    );
    if (!ok) return;
    useSlots.getState().reset();
    useHistory.getState().clear();
    useDraft.getState().resetInput();
    await setGeminiKey(null);
    await clearDemoCal();
    s.reset();
    setUrl(DEFAULT_SERVER_URL);
    setModel(DEFAULT_GEMINI_MODEL);
    setHasKey(false);
    toast('모든 데이터를 초기화했어요.', 'success');
  };

  const version = Constants.expoConfig?.version ?? '2.0.0';

  return (
    <Screen edges={['bottom']} keyboard>
      <Section title="AI 추천 방식" icon="sparkles">
        <Segmented<AiMode>
          value={s.aiMode}
          onChange={(v) => {
            if (v === 'direct' && !hasKey) toast('아래에 Gemini API 키를 먼저 저장해 주세요.', 'info');
            s.set({ aiMode: v });
          }}
          options={[
            { value: 'server', label: '서버' },
            { value: 'direct', label: '직접(Gemini)' },
            { value: 'offline', label: '오프라인' },
          ]}
        />
        <AppText variant="caption" tone="muted">
          {AI_HELP[s.aiMode]}
        </AppText>
      </Section>

      <Section title="AI 서버 주소" icon="server">
        <Card style={{ gap: space.md }}>
          <TextField
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={DEFAULT_SERVER_URL}
            helper="백엔드 POST 주소 (기본: 팀 Vercel 서버 /api)"
          />
          <Row>
            <Button size="sm" label="저장" icon="checkmark" onPress={saveUrl} style={{ flex: 1 }} />
            <Button size="sm" variant="secondary" label="연결 테스트" icon="pulse" onPress={testServer} loading={testing} style={{ flex: 1 }} />
            <Button
              size="sm"
              variant="ghost"
              label="기본값"
              onPress={() => {
                setUrl(DEFAULT_SERVER_URL);
                s.set({ serverUrl: DEFAULT_SERVER_URL });
              }}
            />
          </Row>
          {testResult ? (
            <Banner tone={testResult.level === 'ok' ? 'success' : testResult.level === 'warn' ? 'warning' : 'danger'} message={testResult.msg} />
          ) : null}
        </Card>
      </Section>

      <Section title="Gemini API 키 (직접 모드)" subtitle="Google AI Studio 에서 발급받은 키" icon="key">
        <Card style={{ gap: space.md }}>
          {hasKey ? (
            <Row style={{ justifyContent: 'space-between' }}>
              <Row>
                <Ionicons name="lock-closed" size={16} color={colors.success} />
                <AppText variant="label">저장됨 {s.geminiKeyHint ?? '••••••••'}</AppText>
              </Row>
              <Button size="sm" variant="ghost" icon="trash" label="삭제" onPress={deleteKey} />
            </Row>
          ) : null}
          <TextField
            value={keyInput}
            onChangeText={setKeyInput}
            placeholder={hasKey ? '새 키로 바꾸려면 입력' : 'AIza로 시작하는 키'}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            helper={secretStorageLabel}
          />
          <Button size="sm" label="키 저장" icon="save" onPress={saveKey} disabled={!keyInput.trim()} />
          <TextField
            label="모델"
            value={model}
            onChangeText={setModel}
            onBlur={() => s.set({ geminiModel: model.trim() || DEFAULT_GEMINI_MODEL })}
            autoCapitalize="none"
            autoCorrect={false}
            helper={`기본값 ${DEFAULT_GEMINI_MODEL}`}
          />
        </Card>
      </Section>

      <Section title="기기 연결" icon="bluetooth">
        <Card>
          <SwitchRow
            title="데모 모드 (가상 기기)"
            description="하드웨어 없이 전체 흐름을 체험해요"
            value={s.demoMode}
            onChange={(v) => s.set({ demoMode: v })}
          />
          <Divider />
          <SwitchRow
            title="자동 재연결"
            description="연결이 끊기면 마지막 기기에 자동으로 다시 연결해요"
            value={s.autoReconnect}
            onChange={(v) => s.set({ autoReconnect: v })}
          />
          {s.lastDevices.native || s.lastDevices.web ? (
            <AppText variant="caption" tone="muted">
              기억한 기기: {[s.lastDevices.native?.name ?? s.lastDevices.native?.id, s.lastDevices.web?.name ?? s.lastDevices.web?.id]
                .filter(Boolean)
                .join(', ')}
            </AppText>
          ) : null}
        </Card>
      </Section>

      <Section title="성인 인증" icon="shield-checkmark">
        <Card style={{ gap: space.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText variant="body">
              {s.adultVerifiedAt ? `${fmtDate(s.adultVerifiedAt)}에 확인함` : '아직 확인하지 않음'}
            </AppText>
            <Badge label={s.adultVerifiedAt ? '확인됨' : '미확인'} tone={s.adultVerifiedAt ? 'success' : 'neutral'} />
          </Row>
          <Button
            size="sm"
            variant="secondary"
            label="성인 인증 초기화"
            icon="refresh"
            disabled={!s.adultVerifiedAt}
            onPress={() => {
              s.set({ adultVerifiedAt: null });
              toast('다음에 주류 레시피를 만들 때 다시 확인해요.', 'success');
            }}
          />
          <AppText variant="caption" tone="muted">
            시연·전시처럼 여러 사람이 쓰는 경우 초기화해 두세요.
          </AppText>
        </Card>
      </Section>

      <Section title="데이터" icon="folder">
        <Button variant="danger" icon="trash" label="모든 데이터 초기화" onPress={resetAll} />
      </Section>

      <Section title="앱 정보" icon="information-circle">
        <Card style={{ gap: space.sm }}>
          <AppText variant="heading">AI 스마트 바텐더 v{version}</AppText>
          <AppText variant="body" tone="secondary">
            사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커
          </AppText>
          <Divider style={{ marginVertical: space.sm }} />
          <InfoLine label="팀" value="홍당무" />
          <InfoLine label="소속" value="안양대학교 정보전기전자공학과" />
          <InfoLine label="과목" value="캡스톤디자인 Ⅱ (2026-2학기)" />
          <InfoLine label="통신" value="BLE Nordic UART · JSON 프로토콜 v2.1" />
        </Card>
      </Section>
      <View style={{ height: space.xl }} />
    </Screen>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ alignItems: 'flex-start' }}>
      <AppText variant="label" tone="muted" style={{ width: 64 }}>
        {label}
      </AppText>
      <AppText variant="label" style={{ flex: 1 }}>
        {value}
      </AppText>
    </Row>
  );
}
