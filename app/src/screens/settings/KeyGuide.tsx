/**
 * "키 발급 방법" (v3.1) — 추천 AI 목록에서 하나를 고르면 그 AI 의 API 키를 받는 단계를 보여 줌
 *  - 처음에는 지금 고른 AI(설정)의 안내. 다른 AI 를 눌러 미리 볼 수 있고, [이 AI 로 쓰기]로 바로 바꿀 수 있음
 *  - 단계 · [○○ 열기](새 창) · 무료/비용 · 알아 둘 것 · 키 보관 안내
 */
import { BadgeDollarSign, ExternalLink, HelpCircle, Info, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { FREE_LABEL, providerOf, type AiProviderId } from '@/lib/ai/providers';
import { Badge, Button } from '@/ui';

import { Disclosure } from './Disclosure';
import { ProviderPicker } from './ProviderPicker';

export interface KeyGuideProps {
  /** 설정에서 고른 AI (처음 보여 줄 안내) */
  current: AiProviderId;
  /** [이 AI 로 쓰기] */
  onUse: (id: AiProviderId) => void;
}

export function KeyGuide({ current, onUse }: KeyGuideProps) {
  const [shown, setShown] = useState<AiProviderId>(current);
  // 설정에서 AI 를 바꾸면 안내도 그 AI 로
  useEffect(() => setShown(current), [current]);
  const p = providerOf(shown);
  return (
    <Disclosure icon={HelpCircle} title="키 발급 방법" subtitle="AI 를 고르면 그 AI 의 API 키 받는 방법을 알려 드려요">
      <p className="settings-help">
        API 키는 이 앱이 <b>내 계정으로 AI 를 부를 때 쓰는 열쇠</b>예요(API = 앱끼리 주고받는 통로). 아래에서 키를 받을 AI 를 골라 보세요.
      </p>
      <ProviderPicker value={shown} onChange={setShown} ariaLabel="키 발급 방법을 볼 AI" compact />

      <div className="settings-guide-head" aria-live="polite">
        <span className="settings-guide-title">
          {p.label} <span className="settings-guide-company">({p.company})</span>
        </span>
        <Badge label={FREE_LABEL[p.free]} tone={p.free === 'free' ? 'success' : p.free === 'partial' ? 'info' : 'warning'} />
      </div>
      <p className="settings-help">{p.priceNote}</p>

      <ol className={`settings-steps settings-steps--${Math.min(p.steps.length, 4)}`} aria-label={`${p.label} API 키 받는 단계`}>
        {p.steps.map((s, i) => (
          <li key={`${p.id}-${i}`} className="settings-step">
            <span className="settings-step__art" aria-hidden="true">
              <span className="settings-step__num settings-step__num--big">{i + 1}</span>
            </span>
            <div>
              <p className="settings-step__title">
                <span className="sr-only">{i + 1}단계. </span>
                {s.title}
              </p>
              <p className="settings-step__body">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <a className="sb-btn sb-btn--secondary sb-btn--md sb-btn--full settings-extlink" href={p.keyPageUrl} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={18} aria-hidden="true" />
        <span className="sb-btn__label">{p.keySiteLabel} 열기</span>
      </a>
      {shown !== current ? <Button variant="ghost" label={`이 AI(${p.label})로 레시피 만들기`} onClick={() => onUse(shown)} full /> : null}

      <ul className="settings-notes">
        {p.notes.map((n, i) => (
          <li key={`${p.id}-n${i}`}>
            {i === 0 && p.free !== 'free' ? <BadgeDollarSign size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
            <span>{n}</span>
          </li>
        ))}
        <li>
          <ShieldCheck size={16} aria-hidden="true" />
          <span>
            <b>키 보관</b> — 키는 이 기기에만 저장돼요. 레시피를 만들 때 {p.company}에만 보내고, 팀 서버나 다른 곳으로는 보내지 않아요. 다른 사람과 키를 나누지 마세요.
          </span>
        </li>
      </ul>
    </Disclosure>
  );
}
