/**
 * "키 발급 방법" — Google AI Studio 에서 Gemini API 키를 받는 3단계 그림 설명 (WEBAPP_DESIGN §4)
 * 비용·사용 한도, 키가 이 기기에만 저장된다는 안내 포함. 링크는 새 창(탭)으로 열림.
 */
import { BadgeDollarSign, ClipboardPaste, ExternalLink, Gauge, HelpCircle, KeyRound, LogIn, ShieldCheck } from 'lucide-react';

import { AI_STUDIO_KEY_URL } from '@/lib/ai/gemini';

import { Disclosure } from './Disclosure';

const STEPS = [
  {
    icon: LogIn,
    title: 'Google AI Studio 열기',
    body: (
      <>
        아래 <b>[Google AI Studio 열기]</b>를 눌러 Google 계정으로 로그인해요.
      </>
    ),
  },
  {
    icon: KeyRound,
    title: 'API 키 만들기',
    body: (
      <>
        <b>Create API key</b>(API 키 만들기)를 눌러요. 프로젝트를 고르라고 하면 기본 프로젝트를 고르거나 새로 만들면 돼요.
      </>
    ),
  },
  {
    icon: ClipboardPaste,
    title: '복사해서 붙여 넣기',
    body: (
      <>
        만들어진 키를 복사해 위 <b>API 키</b> 칸에 붙여 넣고 <b>[키 확인]</b> → <b>[저장]</b>을 눌러요.
      </>
    ),
  },
];

export function KeyGuide() {
  return (
    <Disclosure icon={HelpCircle} title="키 발급 방법" subtitle="Google AI Studio 에서 3단계로 무료 발급해요">
      <p className="settings-help">
        API 키는 이 앱이 <b>내 Google 계정으로 Gemini AI 를 부를 때 쓰는 열쇠</b>예요(API = 앱끼리 주고받는 통로).
      </p>
      <ol className="settings-steps settings-steps--3">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={s.title} className="settings-step">
              <span className="settings-step__art" aria-hidden="true">
                <Icon size={24} />
                <span className="settings-step__num">{i + 1}</span>
              </span>
              <div>
                <p className="settings-step__title">
                  <span className="sr-only">{i + 1}단계. </span>
                  {s.title}
                </p>
                <p className="settings-step__body">{s.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <a
        className="sb-btn sb-btn--secondary sb-btn--md sb-btn--full settings-extlink"
        href={AI_STUDIO_KEY_URL}
        target="_blank"
        rel="noopener noreferrer">
        <ExternalLink size={18} aria-hidden="true" />
        <span className="sb-btn__label">Google AI Studio 열기</span>
      </a>
      <ul className="settings-notes">
        <li>
          <Gauge size={16} aria-hidden="true" />
          <span>
            <b>사용 한도</b> — 무료로 쓸 수 있지만 분당·하루 사용량 한도가 있어요. 한도를 넘으면 잠시 뒤 다시 되거나, 그동안은 오프라인 추천으로 이어서 만들어요.
          </span>
        </li>
        <li>
          <BadgeDollarSign size={16} aria-hidden="true" />
          <span>
            <b>비용</b> — 결제(유료 등급)를 연결한 키는 쓴 만큼 요금이 나갈 수 있어요. 사용량과 요금은 Google AI Studio 에서 확인해 주세요.
          </span>
        </li>
        <li>
          <ShieldCheck size={16} aria-hidden="true" />
          <span>
            <b>키 보관</b> — 키는 이 기기에만 저장돼요. 레시피를 만들 때 Google(Gemini)에만 보내고, 팀 서버나 다른 곳으로는 보내지 않아요. 다른 사람과 키를 나누지 마세요.
          </span>
        </li>
      </ul>
    </Disclosure>
  );
}
