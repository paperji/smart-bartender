/**
 * 설정 > AI — AI 추천 방식(Gemini 내 키 / 오프라인) + 내 Gemini API 키 등록(BYOK) + 모델 + 키 발급 방법 (WEBAPP_DESIGN §4)
 *  - 키 값은 화면·토스트·로그에 남기지 않음. 입력칸의 [보기]로 본인만 확인, 저장 뒤에는 마지막 4자리만 보여 줌
 *  - [키 확인] = 모델 목록 조회(무료). 입력칸에 키가 있으면 그 키를, 비어 있으면 저장된 키를 확인
 *  - "개발용 테스트 키 사용"은 개발 서버 + 키 미등록일 때만 보임 (platform/devKey)
 */
import { CircleSlash, Eye, EyeOff, FlaskConical, KeyRound, Lock, Save, ShieldCheck, Sparkles, Trash2, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// 형식 검사: 20자 이상 + 중간 빈칸 없음 + 보이는 ASCII 만 (보이지 않는 문자·한글이 섞이면 저장·확인 전에 안내)
import { keyFormatProblem } from '@/lib/ai/apiKey';
import { checkGeminiKey, type GeminiModelInfo, type KeyCheckCode, type KeyCheckResult } from '@/lib/ai/gemini';
import { aiModeCaption } from '@/lib/ai/mode';
import { maskKeyHint } from '@/lib/format';
import type { AiMode } from '@/lib/types';
import { getDevGeminiKey, hasDevGeminiKey } from '@/platform/devKey';
import { getGeminiKey, onGeminiKeyChange, secretStorageLabel } from '@/platform/secrets';
import { deleteGeminiKey, saveGeminiKey, syncGeminiKeyHint, useEffectiveAiMode, useSettings } from '@/store/settings';
import { toast } from '@/store/toast';
import { Badge, Banner, Button, Card, confirm, cx, Divider, IconButton, Section, Segmented, Stack, TextField, type BannerTone } from '@/ui';

import { KeyGuide } from './KeyGuide';
import { ModelPicker } from './ModelPicker';

/** 고른 방식 설명 (v2.1 AI_HELP 에서 서버 모드를 뺀 것) */
const AI_HELP: Record<AiMode, string> = {
  gemini: '내 Gemini API 키로 앱이 직접 Gemini 를 호출해요. 실패하면 오프라인 추천으로 자동 전환돼요.',
  offline: '인터넷 없이 앱에 내장된 규칙으로 추천해요. 시연 장소의 와이파이가 불안정할 때 유용해요.',
};

/** [키 확인] 결과 머리글·색 (WEBAPP_DESIGN §4 결과 문구) — 본문은 lib/ai/gemini 의 message */
const CHECK_VIEW: Record<KeyCheckCode, { tone: BannerTone; title: string }> = {
  OK: { tone: 'success', title: '성공 — 이 키로 AI 추천을 쓸 수 있어요' },
  MODEL_MISSING: { tone: 'warning', title: '키는 정상이에요 — 모델을 바꿔 주세요' },
  INVALID_KEY: { tone: 'error', title: '키가 올바르지 않아요' },
  PERMISSION: { tone: 'error', title: '권한 없음' },
  QUOTA: { tone: 'warning', title: '사용량 한도·크레딧 소진' },
  NETWORK: { tone: 'error', title: '인터넷 연결 없음' },
  ERROR: { tone: 'error', title: '확인하지 못했어요' },
};

interface CheckState {
  res: KeyCheckResult;
  /** 확인한 키: 입력칸의 키(저장 전) / 저장된 키 */
  target: 'input' | 'saved';
  /** 확인할 때의 모델 */
  model: string;
}

/** 키 확인 뒤 모델만 바꿨을 때 결과 문구를 새 모델 기준으로 (키는 그대로라 다시 조회하지 않음) */
function resultFor(c: CheckState, model: string): KeyCheckResult {
  const { res } = c;
  if (!res.ok || c.model === model || res.models.length === 0) return res;
  if (res.models.some((m) => m.id === model)) {
    return { ...res, code: 'OK', message: `키가 확인됐어요. 사용할 수 있는 모델 ${res.models.length}개 중 ${model} 를 써요.` };
  }
  return {
    ...res,
    code: 'MODEL_MISSING',
    message: `키는 정상이에요. 다만 선택한 모델(${model})을 이 키로 쓸 수 없어요. 목록에서 다른 모델을 골라 주세요.`,
  };
}

export function AiSection() {
  const aiMode = useSettings((s) => s.aiMode);
  const keyHint = useSettings((s) => s.geminiKeyHint);
  const geminiModel = useSettings((s) => s.geminiModel);
  const setSettings = useSettings((s) => s.set);
  const effective = useEffectiveAiMode();
  const hasKey = !!keyHint;

  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [check, setCheck] = useState<CheckState | null>(null);
  const [models, setModels] = useState<GeminiModelInfo[]>([]);
  const inputRef = useRef('');
  const seq = useRef(0);
  const devKeyAvailable = hasDevGeminiKey();

  // 다른 창(탭)에서 키를 저장·삭제하면 '저장됨 ••••xxxx' 힌트를 실제 저장소에 맞춤 (새로 고침 없이)
  useEffect(
    () =>
      onGeminiKeyChange((saved) => {
        syncGeminiKeyHint().catch(() => undefined);
        // 저장된 키가 지워졌으면 그 키의 확인 결과도 지움
        if (!saved) setCheck((c) => (c?.target === 'saved' ? null : c));
      }),
    [],
  );

  const onKeyInput = (v: string) => {
    setKeyInput(v);
    inputRef.current = v;
    // 입력한 키의 확인 결과는 키가 바뀌면 지움
    setCheck((c) => (c?.target === 'input' ? null : c));
    if (!v) setShowKey(false);
  };

  const onMode = (v: AiMode) => {
    if (v === 'gemini' && !hasKey) toast('아래에 Gemini API 키를 먼저 저장해 주세요.', 'info');
    setSettings({ aiMode: v });
  };

  const runCheck = async () => {
    const typed = keyInput.trim();
    const target: CheckState['target'] = typed ? 'input' : 'saved';
    const model = geminiModel;
    const my = ++seq.current;
    if (typed) {
      const problem = keyFormatProblem(typed);
      if (problem) {
        // 형식부터 틀리면 Google 에 보내지 않고 바로 안내
        setCheck({ res: { ok: false, code: 'INVALID_KEY', message: problem, models: [] }, target, model });
        return;
      }
    }
    setChecking(true);
    setCheck(null);
    try {
      const key = typed || (await getGeminiKey());
      if (!key) {
        toast('확인할 API 키를 먼저 붙여 넣어 주세요.', 'info');
        return;
      }
      const res = await checkGeminiKey(key, model);
      // 확인하는 동안 다른 확인을 시작했거나 입력한 키가 바뀌었으면 버림
      if (my !== seq.current) return;
      if (target === 'input' && inputRef.current.trim() !== typed) return;
      setCheck({ res, target, model });
      if (res.models.length) setModels(res.models);
    } finally {
      if (my === seq.current) setChecking(false);
    }
  };

  const saveKey = async () => {
    const k = keyInput.trim();
    const problem = keyFormatProblem(k);
    if (problem) {
      toast(problem, 'warning');
      return;
    }
    setSaving(true);
    try {
      await saveGeminiKey(k);
    } catch {
      toast('키를 저장하지 못했어요. 저장 공간을 확인해 주세요.', 'error');
      return;
    } finally {
      setSaving(false);
    }
    setKeyInput('');
    inputRef.current = '';
    setShowKey(false);
    // 방금 확인한 입력 키를 저장했으면 그 결과는 "저장된 키" 결과로, 예전 저장 키 결과는 지움
    setCheck((c) => (c?.target === 'input' ? { ...c, target: 'saved' } : null));
    toast(aiMode === 'offline' ? 'Gemini API 키를 저장했어요. AI 방식을 Gemini 로 바꾸면 써요.' : 'Gemini API 키를 저장했어요.', 'success');
  };

  const deleteKey = async () => {
    const ok = await confirm('API 키 삭제', '이 기기에 저장된 Gemini API 키를 지워요. 키가 없으면 오프라인 추천으로 만들어요.', {
      confirmText: '삭제',
      destructive: true,
    });
    if (!ok) return;
    await deleteGeminiKey();
    setCheck((c) => (c?.target === 'saved' ? null : c));
    toast('API 키를 삭제했어요.', 'success');
  };

  const applyDevKey = async () => {
    const k = getDevGeminiKey();
    if (!k) return;
    await saveGeminiKey(k);
    setCheck(null);
    toast('개발용 테스트 키를 저장했어요.', 'success');
  };

  const shown = check ? resultFor(check, geminiModel) : null;
  const view = shown ? CHECK_VIEW[shown.code] : null;

  return (
    <div className="settings-stack">
      <Section title="AI 추천 방식" icon={Sparkles}>
        <Card className="settings-card">
          <Segmented<AiMode>
            ariaLabel="AI 추천 방식"
            value={aiMode}
            onChange={onMode}
            options={[
              { value: 'gemini', label: 'Gemini(내 키)', icon: Sparkles },
              { value: 'offline', label: '오프라인', icon: WifiOff },
            ]}
          />
          <p className="settings-help">{AI_HELP[aiMode]}</p>
          {aiMode === 'gemini' && !hasKey ? (
            <Banner
              tone="info"
              title="AI 키가 없어 지금은 오프라인 추천을 써요"
              message="아래에 내 Gemini API 키를 등록하면 Gemini 가 레시피를 만들어요. 없어도 오프라인 추천으로 바로 쓸 수 있어요."
            />
          ) : (
            <div className="settings-effective" role="status">
              <Badge
                tone={effective === 'gemini' ? 'info' : 'neutral'}
                icon={effective === 'gemini' ? Sparkles : WifiOff}
                label={effective === 'gemini' ? '지금: Gemini AI 추천' : '지금: 오프라인 추천'}
              />
              <span className="settings-help">{aiModeCaption(aiMode, hasKey)}</span>
            </div>
          )}
        </Card>
      </Section>

      <Section title="Gemini API 키" icon={KeyRound} description="Google AI Studio 에서 발급받은 내 키">
        <Card className="settings-card">
          <div className={cx('settings-keystate', hasKey && 'settings-keystate--saved')}>
            <span className="settings-keystate__text">
              {hasKey ? <Lock size={16} aria-hidden="true" /> : <CircleSlash size={16} aria-hidden="true" />}
              {hasKey ? (
                <span>
                  저장됨 <span className="settings-keystate__hint">{maskKeyHint(keyHint)}</span>
                </span>
              ) : (
                <span>아직 등록한 키가 없어요</span>
              )}
            </span>
            {hasKey ? (
              <Button size="sm" variant="ghost" icon={Trash2} label="삭제" aria-label="저장된 API 키 삭제" onClick={deleteKey} />
            ) : (
              <Badge label="미등록" />
            )}
          </div>

          <TextField
            label={hasKey ? '새 키로 바꾸기' : 'API 키'}
            type={showKey ? 'text' : 'password'}
            value={keyInput}
            onChange={onKeyInput}
            icon={KeyRound}
            className="settings-keyinput"
            placeholder={hasKey ? '새 키로 바꾸려면 입력' : '복사한 키를 붙여 넣으세요'}
            name="gemini-api-key"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            hint={secretStorageLabel()}
            trailing={
              <IconButton
                icon={showKey ? EyeOff : Eye}
                label={showKey ? '키 숨기기' : '키 보기'}
                size="sm"
                className="settings-eye"
                aria-pressed={showKey}
                disabled={!keyInput}
                onClick={() => setShowKey((v) => !v)}
              />
            }
          />

          <div className="settings-actions">
            <Button
              variant="secondary"
              icon={ShieldCheck}
              label="키 확인"
              loading={checking}
              disabled={!keyInput.trim() && !hasKey}
              onClick={runCheck}
            />
            <Button icon={Save} label="저장" loading={saving} disabled={!keyInput.trim()} onClick={saveKey} />
          </div>

          {shown && view && check ? (
            <Banner
              tone={view.tone}
              title={view.title}
              message={
                <>
                  {shown.message}
                  <span className="settings-check-meta">
                    {check.target === 'input' ? '입력한 키를 확인했어요 (아직 저장 전이에요)' : `저장된 키(${maskKeyHint(keyHint) || '••••'})를 확인했어요`}
                  </span>
                </>
              }
              action={check.target === 'input' && shown.ok ? { label: '이 키 저장', icon: Save, onClick: saveKey } : undefined}
              onClose={() => setCheck(null)}
            />
          ) : null}

          {!hasKey && devKeyAvailable ? (
            <Stack gap={4}>
              <Button variant="ghost" size="sm" icon={FlaskConical} label="개발용 테스트 키 사용" onClick={applyDevKey} />
              <span className="settings-help">개발 서버에서만 보이는 버튼이에요. 배포한 앱·APK·EXE 에는 없어요.</span>
            </Stack>
          ) : null}

          <Divider />
          <ModelPicker value={geminiModel} models={models} onCommit={(m) => setSettings({ geminiModel: m })} />
        </Card>
      </Section>

      <KeyGuide />
    </div>
  );
}
