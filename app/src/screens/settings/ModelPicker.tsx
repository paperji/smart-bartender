/**
 * 모델 고르기 (v3.1 — 고른 AI 회사 기준) — [키 확인]으로 받은 모델 목록이 있으면 그 목록에서, 없으면 그 회사 추천 모델에서 고름
 * (직접 입력도 가능). 바꾸면 바로 설정에 저장 (회사마다 따로).
 */
import { ChevronDown, RotateCcw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { modelAvailable, type AiModelInfo } from '@/lib/ai/keyCheck';
import { providerOf, type AiProviderId } from '@/lib/ai/providers';
import { Button, cx, TextField } from '@/ui';

const CUSTOM = '__custom__';

export interface ModelPickerProps {
  /** 저장된 모델 ID */
  value: string;
  /** 새 모델 ID 저장 (빈 값이면 기본 모델) */
  onCommit: (model: string) => void;
  /** 키 확인으로 받은 모델 목록 (없으면 []) — 고르는 목록 */
  models: AiModelInfo[];
  /** 키 확인으로 받은, 이 키로 부를 수 있는 모든 모델 ID (목록에 안 보이는 모델도 판단). 아직 모르면 null */
  available?: readonly string[] | null;
  /** 고른 AI (Claude 날짜 이름 ↔ 별칭 판단) */
  providerId: AiProviderId;
  /** 그 회사 기본 모델 */
  defaultModel: string;
  /** 키 확인 전에 보여 줄 추천 모델 */
  suggested: readonly string[];
}

export function ModelPicker({ value, onCommit, models, available, providerId, defaultModel, suggested }: ModelPickerProps) {
  const id = useId();
  const [text, setText] = useState(value);
  const [custom, setCustom] = useState(false);
  const checked = models.length > 0;
  const options: AiModelInfo[] = checked ? models : suggested.map((m) => ({ id: m, displayName: m }));
  const inList = options.some((m) => m.id === value);
  const usable = (id: string) => !!available && modelAvailable(providerOf(providerId), available, id);

  // 저장된 값이 바뀌면(초기화·목록에서 고름·회사 바꿈) 입력칸도 맞춤
  useEffect(() => setText(value), [value]);
  // 새 목록을 받았거나 회사가 바뀌었을 때 저장된 모델이 목록에 있으면 목록 고르기로
  // (쓸 수 있는데 목록에만 없는 모델 — Claude 별칭·OpenRouter 유료 — 은 목록 고르기 그대로: 선택 칸에 그 값이 따로 보임)
  useEffect(() => {
    setCustom(!options.some((m) => m.id === value) && !usable(value));
  }, [models, available, defaultModel]);

  const commit = (raw: string) => {
    const v = raw.trim() || defaultModel;
    setText(v);
    if (v !== value) onCommit(v);
  };

  // 쓸 수 없음은 키 확인 결과(모든 모델 ID)로만 판단 — 목록에 안 보이는 유료 모델 등은 쓸 수 있음
  const notAvailable = checked && !inList && !!available && !usable(value);

  if (!custom) {
    return (
      <div className="settings-field">
        <div className="settings-field__head">
          <label htmlFor={id} className="settings-field__label">
            모델
          </label>
          <button type="button" className="settings-linkbtn" onClick={() => setCustom(true)}>
            직접 입력
          </button>
        </div>
        <div className="settings-select-wrap">
          <select
            id={id}
            className={cx('settings-select', notAvailable && 'has-error')}
            value={value}
            aria-invalid={notAvailable || undefined}
            aria-describedby={`${id}-hint`}
            onChange={(e) => {
              if (e.target.value === CUSTOM) setCustom(true);
              else commit(e.target.value);
            }}>
            {!inList ? <option value={value}>{notAvailable ? `${value} (이 키로 쓸 수 없음)` : value}</option> : null}
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === defaultModel ? `${m.id} (기본·추천)` : m.displayName && m.displayName !== m.id ? `${m.id} — ${m.displayName}` : m.id}
              </option>
            ))}
            <option value={CUSTOM}>직접 입력…</option>
          </select>
          <ChevronDown size={18} aria-hidden="true" className="settings-select-wrap__chev" />
        </div>
        {notAvailable ? (
          <p id={`${id}-hint`} className="settings-field__error" role="alert">
            선택한 모델을 이 키로 쓸 수 없어요. 목록에서 다른 모델을 골라 주세요.
          </p>
        ) : (
          <p id={`${id}-hint`} className="settings-field__hint">
            {checked
              ? `이 키로 쓸 수 있는 모델 ${models.length}개 · 고르면 바로 저장돼요. 기본값 ${defaultModel}`
              : `추천 모델이에요. [키 확인]을 누르면 이 키로 쓸 수 있는 모델 목록이 나와요. 기본값 ${defaultModel}`}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="settings-field">
      <TextField
        label="모델"
        value={text}
        onChange={setText}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(text);
        }}
        className="settings-keyinput"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        placeholder={defaultModel}
        error={notAvailable ? '이 키로 쓸 수 없는 모델이에요. 목록에서 골라 주세요.' : undefined}
        hint={`기본값 ${defaultModel} · 목록에 없는 모델 ID 를 직접 적을 수 있어요.`}
        trailing={
          text.trim() !== defaultModel ? (
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCcw}
              label="기본값"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(defaultModel)}
            />
          ) : null
        }
      />
      <button type="button" className="settings-linkbtn settings-field__more" onClick={() => setCustom(false)}>
        목록에서 고르기
      </button>
    </div>
  );
}
