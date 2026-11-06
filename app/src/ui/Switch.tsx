import type { LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { haptic } from '@/platform/haptics';

import { cx } from './cx';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 있으면 "이름 + 설명 + 스위치" 한 줄(행)로 그림. 없으면 ariaLabel 필요 */
  label?: ReactNode;
  /** 이름 아래 보조 설명 */
  description?: ReactNode;
  icon?: LucideIcon;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

/** 켜기/끄기 (role=switch). label 을 주면 행 전체가 눌림 영역 */
export function Switch({ checked, onChange, label, description, icon: Icon, ariaLabel, disabled, className }: SwitchProps) {
  const id = useId();
  const toggle = () => {
    if (disabled) return;
    haptic.tap();
    onChange(!checked);
  };
  const knob = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={label ? `${id}-l` : undefined}
      aria-describedby={description ? `${id}-d` : undefined}
      aria-label={label ? undefined : ariaLabel}
      disabled={disabled}
      className={cx('sb-switch', checked && 'is-on')}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}>
      <span className="sb-switch__knob" aria-hidden="true" />
    </button>
  );
  if (!label) return <span className={className}>{knob}</span>;
  return (
    <div className={cx('sb-switchrow', disabled && 'is-disabled', className)} onClick={toggle}>
      {Icon ? <Icon size={20} aria-hidden="true" className="sb-switchrow__icon" /> : null}
      <div className="sb-switchrow__text">
        <span id={`${id}-l`} className="sb-switchrow__label">
          {label}
        </span>
        {description ? (
          <span id={`${id}-d`} className="sb-switchrow__desc">
            {description}
          </span>
        ) : null}
      </div>
      {knob}
    </div>
  );
}
