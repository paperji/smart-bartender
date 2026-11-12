/**
 * 설정 > AI — AI 추천 방식(AI 내 키 / 오프라인) + 레시피를 만들 AI 고르기 + 그 AI 의 API 키 등록(BYOK) + 모델 + 키 발급 방법
 * (WEBAPP_DESIGN §4, v3.1: Gemini 말고도 ChatGPT·Claude·Grok·DeepSeek·Mistral·Groq·OpenRouter)
 *  - 키는 AI 마다 따로 저장 — AI 를 바꿔도 다른 AI 의 키는 남음
 *  - 키 값은 화면·토스트·로그에 남기지 않음. 입력칸의 [보기]로 본인만 확인, 저장 뒤에는 마지막 4자리만 보여 줌
 *  - [키 확인] = 그 회사의 모델 목록 조회(무료). 입력칸에 키가 있으면 그 키를, 비어 있으면 저장된 키를 확인
 *  - 붙여 넣은 키가 다른 회사 키 모양이면(예: Gemini 를 골랐는데 sk-ant-…) [키 확인]·[저장]을 막고(키가 엉뚱한 회사로 가지 않게) 바로 바꿀 수 있게
 *  - "개발용 테스트 키 사용"은 개발 서버 + Gemini + 키 미등록일 때만 보임 (platform/devKey)
 */
import { Bot, CircleSlash, Eye, EyeOff, FlaskConical, KeyRound, Lock, Save, ShieldCheck, Sparkles, Trash2, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// 형식 검사: 20자 이상 + 중간 빈칸 없음 + 보이는 ASCII 만 (보이지 않는 문자·한글이 섞이면 저장·확인 전에 안내)
import { keyFormatProblem } from '@/lib/ai/apiKey';
import type { KeyCheckCode, KeyCheckResult } from '@/lib/ai/gemini';
import { checkAiKey, missingText, modelAvailable, okText, type AiModelInfo } from '@/lib/ai/keyCheck';
import { aiModeCaption } from '@/lib/ai/mode';
import { guessProvider, providerOf, withJosa, type AiProviderId } from '@/lib/ai/providers';
import { maskKeyHint } from '@/lib/format';
import type { AiMode } from '@/lib/types';
import { getDevGeminiKey, hasDevGeminiKey } from '@/platform/devKey';
import { getAiKey, onAiKeyChange, secretStorageLabel } from '@/platform/secrets';
import { activeModel, deleteAiKey, saveAiKey, syncAiKeyHints, useEffectiveAiMode, useSettings } from '@/store/settings';
import { toast } from '@/store/toast';
import { Badge, Banner, Button, Card, confirm, cx, Divider, IconButton, Section, Segmented, Stack, TextField, type BannerTone } from '@/ui';

import { KeyGuide } from './KeyGuide';
import { ModelPicker } from './ModelPicker';
import { ProviderPicker } from './ProviderPicker';

/** 고른 방식 설명 */
const AI_HELP: Record<AiMode, string> = {
  ai: '내 AI API 키로 앱이 직접 AI 를 불러 레시피를 만들어요. 실패하면 오프라인 추천으로 자동 전환돼요.',
  offline: '인터넷 없이 앱에 내장된 규칙으로 추천해요. 시연 장소의 와이파이가 불안정할 때 유용해요.',
};

/** [키 확인] 결과 머리글·색 (WEBAPP_DESIGN §4 결과 문구) — 본문은 keyCheck 의 message */
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
  /** 확인할 때의 회사·모델 */
  provider: AiProviderId;
  model: string;
}

/** 키 확인 뒤 모델만 바꿨을 때 결과 문구를 새 모델 기준으로 (키는 그대로라 다시 조회하지 않음) */
function resultFor(c: CheckState, model: string): KeyCheckResult {
  const { res } = c;
  const ids = res.available ?? res.models.map((m) => m.id);
  if (!res.ok || c.model === model || ids.length === 0) return res;
  const p = providerOf(c.provider);
  if (modelAvailable(p, ids, model)) return { ...res, code: 'OK', message: okText(p, res.models.length || ids.length, model) };
  return { ...res, code: 'MODEL_MISSING', message: missingText(model) };
}

export function AiSection() {
  const aiMode = useSettings((s) => s.aiMode);
  const providerId = useSettings((s) => s.aiProvider);
  const keyHints = useSettings((s) => s.aiKeyHints);
  const model = useSettings((s) => activeModel(s));
  const setSettings = useSettings((s) => s.set);
  const effective = useEffectiveAiMode();
  const provider = providerOf(providerId);
  const keyHint = keyHints[providerId] ?? null;
  const hasKey = !!keyHint;

  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [check, setCheck] = useState<CheckState | null>(null);
  const [models, setModels] = useState<AiModelInfo[]>([]);
  /** 키 확인으로 받은, 이 키로 쓸 수 있는 모든 모델 ID (목록에 안 보이는 모델 포함) */
  const [available, setAvailable] = useState<string[] | null>(null);
  /** 지금 모델 목록이 어느 키로 받은 것인지 (입력칸의 키 / 저장된 키) */
  const modelsFrom = useRef<'input' | 'saved' | null>(null);
  const inputRef = useRef('');
  const seq = useRef(0);
  const devKeyAvailable = providerId === 'gemini' && hasDevGeminiKey();

  // 다른 창(탭)에서 키를 저장·삭제하면 '저장됨 ••••xxxx' 힌트를 실제 저장소에 맞춤 (새로 고침 없이)
  useEffect(
    () =>
      onAiKeyChange((p, saved, external) => {
        syncAiKeyHints(p).catch(() => undefined);
        // 다른 탭에서 저장된 키가 바뀌었거나 지워졌으면 가던 확인·모델 목록은 버림
        // (이 탭에서 저장할 때는 saveKey 가 알아서 함 — 방금 확인한 키를 저장하면 목록을 지키게)
        if ((external || !saved) && (p === null || p === useSettings.getState().aiProvider)) {
          seq.current++;
          setChecking(false);
          setModels([]);
          setAvailable(null);
          modelsFrom.current = null;
        }
        if (!saved) setCheck((c) => (c?.target === 'saved' && (p === null || c.provider === p) ? null : c));
      }),
    [],
  );

  // AI 를 바꾸면 입력칸·확인 결과·모델 목록은 새로
  useEffect(() => {
    seq.current++;
    setKeyInput('');
    inputRef.current = '';
    setShowKey(false);
    setCheck(null);
    setModels([]);
    setAvailable(null);
    setChecking(false);
  }, [providerId]);

  const onKeyInput = (v: string) => {
    setKeyInput(v);
    inputRef.current = v;
    // 입력칸의 키로 받은 목록은 키가 바뀌면 버림 (저장 안 한 키의 목록으로 모델을 판단하지 않게)
    if (modelsFrom.current === 'input') {
      setModels([]);
      setAvailable(null);
      modelsFrom.current = null;
    }
    // 입력한 키의 확인 결과는 키가 바뀌면 지움
    setCheck((c) => (c?.target === 'input' ? null : c));
    if (!v) setShowKey(false);
  };

  const onMode = (v: AiMode) => {
    if (v === 'ai' && !hasKey) toast(`아래에 ${provider.label} API 키를 먼저 저장해 주세요.`, 'info');
    setSettings({ aiMode: v });
  };

  const pickProvider = (id: AiProviderId) => {
    if (id === providerId) return;
    setSettings({ aiProvider: id });
    const p = providerOf(id);
    toast(useSettings.getState().aiKeyHints[id] ? `이제 ${withJosa(id, '으로/로')} 레시피를 만들어요.` : `${withJosa(id, '을/를')} 골랐어요. 아래에 ${p.label} 키를 저장하면 써요.`, 'info');
  };

  /** 붙여 넣은 키가 다른 회사 키 모양인지 */
  const typed = keyInput.trim();
  const guessed = typed ? guessProvider(typed) : null;
  const mismatch = guessed && guessed !== providerId ? providerOf(guessed) : null;

  const runCheck = async () => {
    // 다른 회사 키 모양이면 보내지 않음 (버튼도 막혀 있음)
    if (mismatch) return;
    const target: CheckState['target'] = typed ? 'input' : 'saved';
    const my = ++seq.current;
    if (typed) {
      const problem = keyFormatProblem(typed);
      if (problem) {
        // 형식부터 틀리면 회사에 보내지 않고 바로 안내
        setCheck({ res: { ok: false, code: 'INVALID_KEY', message: problem, models: [] }, target, provider: providerId, model });
        return;
      }
    }
    setChecking(true);
    setCheck(null);
    try {
      const key = typed || (await getAiKey(providerId));
      if (!key) {
        toast('확인할 API 키를 먼저 붙여 넣어 주세요.', 'info');
        return;
      }
      const res = await checkAiKey(providerId, key, model);
      // 확인하는 동안 다른 확인을 시작했거나·AI 를 바꿨거나·입력한 키가 바뀌었으면 버림
      if (my !== seq.current) return;
      if (target === 'input' && inputRef.current.trim() !== typed) return;
      setCheck({ res, target, provider: providerId, model });
      // 이번 확인 결과로 목록을 바꿈 (실패면 비움 — 예전 키의 목록으로 모델을 판단하지 않게)
      setModels(res.ok ? res.models : []);
      setAvailable(res.ok && res.available?.length ? res.available : null);
      modelsFrom.current = res.ok ? target : null;
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
    if (mismatch) {
      toast(`${mismatch.label} 키 같아요. 위에서 ${mismatch.label} 고르기를 누르거나 ${provider.label} 키를 넣어 주세요.`, 'warning');
      return;
    }
    // 저장된 키가 바뀌므로 가던 확인은 버리고, 방금 확인한 그 키가 아니면 모델 목록도 지움
    seq.current++;
    setChecking(false);
    if (!(check?.target === 'input' && check.provider === providerId && check.res.ok)) {
      setModels([]);
      setAvailable(null);
      modelsFrom.current = null;
    }
    setSaving(true);
    try {
      await saveAiKey(providerId, k);
    } catch {
      toast('키를 저장하지 못했어요. 저장 공간을 확인해 주세요.', 'error');
      return;
    } finally {
      setSaving(false);
    }
    // 방금 확인한 키를 저장했으면 목록은 이제 "저장된 키"의 것 (입력칸을 비워도 지우지 않게)
    if (modelsFrom.current === 'input') modelsFrom.current = 'saved';
    setKeyInput('');
    inputRef.current = '';
    setShowKey(false);
    // 방금 확인한 입력 키를 저장했으면 그 결과는 "저장된 키" 결과로, 예전 저장 키 결과는 지움
    setCheck((c) => (c?.target === 'input' ? { ...c, target: 'saved' } : null));
    toast(aiMode === 'offline' ? `${provider.label} API 키를 저장했어요. AI 방식을 'AI' 로 바꾸면 써요.` : `${provider.label} API 키를 저장했어요.`, 'success');
  };

  const deleteKey = async () => {
    const ok = await confirm('API 키 삭제', `이 기기에 저장된 ${provider.label} API 키를 지워요. 키가 없으면 오프라인 추천으로 만들어요.`, {
      confirmText: '삭제',
      destructive: true,
    });
    if (!ok) return;
    seq.current++;
    setChecking(false);
    setModels([]);
    setAvailable(null);
    await deleteAiKey(providerId);
    setCheck((c) => (c?.target === 'saved' ? null : c));
    toast('API 키를 삭제했어요.', 'success');
  };

  const applyDevKey = async () => {
    const k = getDevGeminiKey();
    if (!k) return;
    seq.current++;
    setChecking(false);
    setModels([]);
    setAvailable(null);
    await saveAiKey('gemini', k);
    setCheck(null);
    toast('개발용 테스트 키를 저장했어요.', 'success');
  };

  const shown = check && check.provider === providerId ? resultFor(check, model) : null;
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
              { value: 'ai', label: 'AI(내 키)', icon: Sparkles },
              { value: 'offline', label: '오프라인', icon: WifiOff },
            ]}
          />
          <p className="settings-help">{AI_HELP[aiMode]}</p>
          {aiMode === 'ai' && !hasKey ? (
            <Banner
              tone="info"
              title="AI 키가 없어 지금은 오프라인 추천을 써요"
              message={`아래에 내 ${provider.label} API 키를 등록하면 ${withJosa(providerId, '이/가')} 레시피를 만들어요. 없어도 오프라인 추천으로 바로 쓸 수 있어요.`}
            />
          ) : (
            <div className="settings-effective" role="status">
              <Badge
                tone={effective === 'ai' ? 'info' : 'neutral'}
                icon={effective === 'ai' ? Sparkles : WifiOff}
                label={effective === 'ai' ? `지금: ${provider.label} AI 추천` : '지금: 오프라인 추천'}
              />
              <span className="settings-help">{aiModeCaption(aiMode, hasKey, provider.label)}</span>
            </div>
          )}
        </Card>
      </Section>

      {/* data-tour: 사용법 안내가 비추는 칸 (lib/tutorial.ts) */}
      <div data-tour="settings-ai">
        <Section title="AI 고르기" icon={Bot} description="레시피를 만들 AI 를 골라요. 키는 AI 마다 따로 저장돼요.">
          <Card className="settings-card">
            <ProviderPicker value={providerId} onChange={pickProvider} ariaLabel="레시피를 만들 AI" saved={keyHints} />
            <p className="settings-help">{provider.priceNote}</p>
          </Card>
        </Section>
      </div>

      <Section title={`${provider.label} API 키`} icon={KeyRound} description={`${provider.keySiteLabel}에서 발급받은 내 키`}>
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
              <Button size="sm" variant="ghost" icon={Trash2} label="삭제" aria-label={`저장된 ${provider.label} API 키 삭제`} onClick={deleteKey} />
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
            placeholder={hasKey ? '새 키로 바꾸려면 입력' : `복사한 키를 붙여 넣으세요 (${provider.keyShape})`}
            name={`${provider.id}-api-key`}
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

          {mismatch ? (
            <Banner
              tone="warning"
              title={`${mismatch.label} 키 같아요`}
              message={`붙여 넣은 키가 ${mismatch.label}(${mismatch.company}) 키 모양이에요. 지금 고른 AI 는 ${provider.label}${provider.final === 'none' ? '예요' : '이에요'}. 키가 엉뚱한 회사로 가지 않게 확인·저장을 막았어요.`}
              action={{
                label: `${mismatch.label} 고르기`,
                icon: Bot,
                onClick: () => {
                  const k = keyInput;
                  pickProvider(mismatch.id);
                  // AI 를 바꾸면 입력칸이 비워지므로 붙여 넣은 키를 다시 넣어 줌
                  setTimeout(() => onKeyInput(k), 0);
                },
              }}
            />
          ) : null}

          <div className="settings-actions">
            <Button variant="secondary" icon={ShieldCheck} label="키 확인" loading={checking} disabled={(!keyInput.trim() && !hasKey) || !!mismatch} onClick={runCheck} />
            <Button icon={Save} label="저장" loading={saving} disabled={!keyInput.trim() || !!mismatch} onClick={saveKey} />
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
          <ModelPicker
            value={model}
            models={models}
            available={available}
            providerId={providerId}
            defaultModel={provider.defaultModel}
            suggested={provider.suggestedModels}
            onCommit={(m) => setSettings({ aiModels: { ...useSettings.getState().aiModels, [providerId]: m } })}
          />
        </Card>
      </Section>

      <KeyGuide current={providerId} onUse={pickProvider} />
    </div>
  );
}
