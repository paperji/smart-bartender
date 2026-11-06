/**
 * Gemini 모델 고르기 — [키 확인]으로 받은 모델 목록이 있으면 목록에서 고르고(직접 입력도 가능),
 * 목록이 없으면 글자로 입력 (기본 gemini-3.6-flash). 바꾸면 바로 설정에 저장.
 */
import { ChevronDown, RotateCcw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import type { GeminiModelInfo } from '@/lib/ai/gemini';
import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/prompt';
import { Button, cx, TextField } from '@/ui';

const CUSTOM = '__custom__';

export interface ModelPickerProps {
  /** 저장된 모델 ID */
  value: string;
  /** 새 모델 ID 저장 (빈 값이면 기본 모델) */
  onCommit: (model: string) => void;
  /** 키 확인으로 받은 모델 목록 (없으면 []) */
  models: GeminiModelInfo[];
}

export function ModelPicker({ value, onCommit, models }: ModelPickerProps) {
  const id = useId();
  const [text, setText] = useState(value);
  const [custom, setCustom] = useState(false);
  const hasList = models.length > 0;
  const inList = models.some((m) => m.id === value);

  // 저장된 값이 바뀌면(초기화·목록에서 고름) 입력칸도 맞춤
  useEffect(() => setText(value), [value]);
  // 새 목록을 받았을 때 저장된 모델이 목록에 있으면 목록 고르기로 (value 변화로는 다시 실행하지 않음 — 직접 입력 중 깜빡임 방지)
  useEffect(() => {
    if (hasList && models.some((m) => m.id === value)) setCustom(false);
  }, [models]);

  const commit = (raw: string) => {
    const v = raw.trim() || DEFAULT_GEMINI_MODEL;
    setText(v);
    if (v !== value) onCommit(v);
  };

  const notAvailable = hasList && !inList;

  if (hasList && !custom) {
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
            {notAvailable ? <option value={value}>{value} (이 키로 쓸 수 없음)</option> : null}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === DEFAULT_GEMINI_MODEL ? `${m.id} (기본·추천)` : m.displayName && m.displayName !== m.id ? `${m.id} — ${m.displayName}` : m.id}
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
            이 키로 쓸 수 있는 모델 {models.length}개 · 고르면 바로 저장돼요. 기본값 {DEFAULT_GEMINI_MODEL}
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
        placeholder={DEFAULT_GEMINI_MODEL}
        error={notAvailable ? '이 키로 쓸 수 없는 모델이에요. 목록에서 골라 주세요.' : undefined}
        hint={
          hasList
            ? `기본값 ${DEFAULT_GEMINI_MODEL} · 목록에 없는 모델 ID 를 직접 적을 수 있어요.`
            : `기본값 ${DEFAULT_GEMINI_MODEL} · [키 확인]을 누르면 쓸 수 있는 모델 목록에서 고를 수 있어요.`
        }
        trailing={
          text.trim() !== DEFAULT_GEMINI_MODEL ? (
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCcw}
              label="기본값"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(DEFAULT_GEMINI_MODEL)}
            />
          ) : null
        }
      />
      {hasList ? (
        <button type="button" className="settings-linkbtn settings-field__more" onClick={() => setCustom(false)}>
          목록에서 고르기
        </button>
      ) : null}
    </div>
  );
}
