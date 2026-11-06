import { AlertCircle, Wine } from 'lucide-react';
import { useId } from 'react';

import { ADULT_WARNINGS, answerAdultGate, useAdultGate } from '@/store/adultGate';

import { Button } from './Button';
import { Modal } from './Modal';

/**
 * 성인 확인 창 (store/adultGate 의 ensureAdult) — App 루트에 1개. 문구는 v2.1 AdultGate 와 같음
 * 화면 읽기: 창 이름 = 질문(h2), 설명 = 안내 문구 + 음주 경고 목록 → 초점이 '네' 버튼으로 가도 경고까지 읽어 줌
 */
export function AdultGateHost() {
  const visible = useAdultGate((s) => s.visible);
  const uid = useId();
  const titleId = `${uid}-title`;
  const msgId = `${uid}-msg`;
  const warnId = `${uid}-warn`;
  return (
    <Modal
      open={visible}
      size="sm"
      onClose={() => answerAdultGate(false)}
      showClose={false}
      role="alertdialog"
      labelledBy={titleId}
      describedBy={`${msgId} ${warnId}`}
      className="sb-adult">
      <div className="sb-adult__content">
        <div className="sb-adult__icon" aria-hidden="true">
          <Wine size={28} />
        </div>
        <h2 id={titleId} className="sb-adult__title">
          만 19세 이상이신가요?
        </h2>
        <p id={msgId} className="sb-adult__msg">
          이 레시피에는 알코올이 들어 있어요. 성인 확인 후에 제조할 수 있어요.
        </p>
        <ul id={warnId} className="sb-adult__warn">
          {ADULT_WARNINGS.map((t) => (
            <li key={t}>
              <AlertCircle size={16} aria-hidden="true" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <Button label="네, 만 19세 이상입니다" size="lg" full onClick={() => answerAdultGate(true)} />
        <Button label="아니요" variant="ghost" full onClick={() => answerAdultGate(false)} />
      </div>
    </Modal>
  );
}
