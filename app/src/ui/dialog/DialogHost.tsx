import { AlertTriangle, CheckCircle2, HelpCircle, Info, XCircle, type LucideIcon } from 'lucide-react';
import { useId } from 'react';

import { Button } from '../Button';
import { Modal } from '../Modal';

import { resolveDialog, useDialogs, type DialogTone } from './service';

const TONE_ICON: Record<DialogTone, LucideIcon> = {
  default: HelpCircle,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

/**
 * confirm()/alert() 창을 그림 — App 루트에 1개
 * 화면 읽기: 창 이름 = 제목(h2), 설명 = 질문 문구 → 초점이 버튼으로 가도 열리자마자 질문까지 읽어 줌.
 * 확인창은 바로 답해야 하는 창이라 role=alertdialog
 */
export function DialogHost() {
  const req = useDialogs((s) => s.queue[0] ?? null);
  const uid = useId();
  if (!req) return null;
  const titleId = `${uid}-title`;
  const msgId = `${uid}-msg`;
  const Icon = req.kind === 'alert' && req.tone === 'default' ? Info : TONE_ICON[req.tone];
  const cancel = () => resolveDialog(req.id, false);
  const ok = () => resolveDialog(req.id, true);
  return (
    <Modal
      key={req.id}
      open
      size="sm"
      onClose={req.kind === 'confirm' ? cancel : ok}
      showClose={false}
      role={req.kind === 'confirm' ? 'alertdialog' : 'dialog'}
      labelledBy={titleId}
      describedBy={req.message ? msgId : undefined}
      initialFocus={req.destructive ? '[data-cancel]' : '[data-ok]'}
      className="sb-dialog">
      <div className="sb-dialog__content">
        <div className={`sb-dialog__icon sb-dialog__icon--${req.tone}`} aria-hidden="true">
          <Icon size={26} />
        </div>
        <h2 id={titleId} className="sb-dialog__title">
          {req.title}
        </h2>
        {req.message ? (
          <p id={msgId} className="sb-dialog__msg">
            {req.message}
          </p>
        ) : null}
      </div>
      <div className="sb-dialog__actions">
        {req.kind === 'confirm' ? <Button variant="secondary" label={req.cancelText} onClick={cancel} full data-cancel="" /> : null}
        <Button variant={req.destructive ? 'danger' : 'primary'} label={req.confirmText} onClick={ok} full data-ok="" />
      </div>
    </Modal>
  );
}
