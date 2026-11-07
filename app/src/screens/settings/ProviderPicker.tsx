/**
 * AI 고르기 — 추천 AI 목록(Gemini·ChatGPT·Claude·Grok·DeepSeek·Mistral·Groq·OpenRouter)을 카드 버튼으로 (v3.1)
 *  - 설정 › AI 서비스(레시피를 만들 AI)와 키 발급 방법(안내를 볼 AI) 두 곳에서 씀
 *  - 화살표 키로 옮겨 다닐 수 있는 라디오 묶음 (role=radiogroup)
 *  - 카드: AI 이름 · 회사 · 무료/유료 표시 · (설정에서만) 키 저장됨 표시
 */
import { Check } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';

import { AI_PROVIDERS, FREE_LABEL, type AiProviderId } from '@/lib/ai/providers';
import { cx } from '@/ui';

export interface ProviderPickerProps {
  value: AiProviderId;
  onChange: (id: AiProviderId) => void;
  /** 화면 읽기 이름 */
  ariaLabel: string;
  /** 키가 저장된 회사 (설정 화면) */
  saved?: Partial<Record<AiProviderId, unknown>>;
  /** 작게 (키 발급 방법 안) */
  compact?: boolean;
}

export function ProviderPicker({ value, onChange, ariaLabel, saved, compact }: ProviderPickerProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = AI_PROVIDERS.findIndex((p) => p.id === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % AI_PROVIDERS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + AI_PROVIDERS.length) % AI_PROVIDERS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = AI_PROVIDERS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(AI_PROVIDERS[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx('settings-providers', compact && 'settings-providers--compact')} onKeyDown={onKey}>
      {AI_PROVIDERS.map((p, idx) => {
        const on = p.id === value;
        const hasKey = !!saved?.[p.id];
        return (
          <button
            key={p.id}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={cx('settings-provider', on && 'is-selected')}
            onClick={() => onChange(p.id)}>
            <span className="settings-provider__top">
              <span className="settings-provider__name">{p.label}</span>
              <span className={cx('settings-provider__free', `is-${p.free}`)}>{FREE_LABEL[p.free]}</span>
            </span>
            <span className="settings-provider__company">
              {p.company}
              {hasKey ? (
                <span className="settings-provider__saved">
                  <Check size={12} aria-hidden="true" /> 키 저장됨
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
