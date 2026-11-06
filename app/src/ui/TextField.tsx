import type { LucideIcon } from 'lucide-react';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

import { cx } from './cx';

interface FieldFrameProps {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  counter?: string | null;
  children: ReactNode;
  className?: string;
}

function FieldFrame({ id, label, hint, error, counter, children, className }: FieldFrameProps) {
  return (
    <div className={cx('sb-field', error ? 'has-error' : null, className)}>
      {label || counter ? (
        <div className="sb-field__head">
          {label ? (
            <label htmlFor={id} className="sb-field__label">
              {label}
            </label>
          ) : (
            <span />
          )}
          {counter ? <span className="sb-field__counter sb-num">{counter}</span> : null}
        </div>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-err`} className="sb-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="sb-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> {
  label?: ReactNode;
  /** 아래 보조 설명 */
  hint?: ReactNode;
  /** 오류 문구 (있으면 빨간 테두리 + hint 대신 표시) */
  error?: ReactNode;
  value: string;
  /** 바뀐 글자 (이벤트가 아니라 문자열) */
  onChange: (value: string) => void;
  /** 왼쪽 아이콘 */
  icon?: LucideIcon;
  /** 오른쪽 끝 (단위·버튼 등) */
  trailing?: ReactNode;
  /** maxLength 와 함께 '12/40' 글자 수 표시 */
  counter?: boolean;
  /** 바깥 div 의 className (input 은 className) */
  wrapperClassName?: string;
}

/** 한 줄 입력칸 (높이 48px, 모서리 12px) */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, value, onChange, icon: Icon, trailing, counter, wrapperClassName, className, id: idProp, maxLength, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      error={error}
      counter={counter && maxLength ? `${value.length}/${maxLength}` : null}
      className={wrapperClassName}>
      <div className="sb-input">
        {Icon ? <Icon size={18} aria-hidden="true" className="sb-input__icon" /> : null}
        <input
          ref={ref}
          id={id}
          value={value}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          className={cx('sb-input__control', className)}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
        {trailing ? <div className="sb-input__trailing">{trailing}</div> : null}
      </div>
    </FieldFrame>
  );
});

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** maxLength 와 함께 글자 수 표시 */
  counter?: boolean;
  wrapperClassName?: string;
}

/** 여러 줄 입력칸 (기본 3줄) */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, value, onChange, counter, wrapperClassName, className, id: idProp, maxLength, rows = 3, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      error={error}
      counter={counter && maxLength ? `${value.length}/${maxLength}` : null}
      className={wrapperClassName}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className={cx('sb-textarea', className)}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </FieldFrame>
  );
});
