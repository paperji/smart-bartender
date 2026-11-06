/**
 * 설정 화면용 펼치기/접기 카드 ("키 발급 방법", "오픈소스 라이선스")
 * 머리 버튼(aria-expanded·aria-controls) + 펼친 내용. 키트에 같은 것이 없어 이 폴더에 둠.
 */
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { haptic } from '@/platform/haptics';
import { Card, cx } from '@/ui';

export interface DisclosureProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export function Disclosure({ title, subtitle, icon: Icon, defaultOpen = false, children, className }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <Card padded={false} className={cx('settings-disclosure', open && 'is-open', className)}>
      <button
        type="button"
        className="settings-disclosure__toggle"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => {
          haptic.tap();
          setOpen((v) => !v);
        }}>
        {Icon ? <Icon size={20} aria-hidden="true" className="settings-disclosure__icon" /> : null}
        <span className="settings-disclosure__titles">
          <span className="settings-disclosure__title">{title}</span>
          {subtitle ? <span className="settings-disclosure__sub">{subtitle}</span> : null}
        </span>
        <ChevronDown size={20} aria-hidden="true" className="settings-disclosure__chev" />
      </button>
      <div id={`${id}-body`} className="settings-disclosure__body" hidden={!open}>
        {open ? children : null}
      </div>
    </Card>
  );
}
