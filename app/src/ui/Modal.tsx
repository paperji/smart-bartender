import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cx } from './cx';
import { modalAria } from './modalAria';

export interface ModalProps {
  open: boolean;
  /** 닫기 요청 (Esc·바깥 누름·X 버튼). 생략하면 닫을 수 없는 창 */
  onClose?: () => void;
  title?: ReactNode;
  /** 제목 아래 설명 */
  description?: ReactNode;
  children?: ReactNode;
  /** 아래 버튼 줄 */
  footer?: ReactNode;
  /** center(가운데 창, 기본) · sheet(모바일은 아래에서 올라오는 시트, PC 는 가운데) */
  variant?: 'center' | 'sheet';
  /** sm(400px) · md(520px, 기본) · lg(720px) */
  size?: 'sm' | 'md' | 'lg';
  /** 바깥(어두운 곳)을 누르면 닫기 (기본 true) */
  closeOnBackdrop?: boolean;
  /** 오른쪽 위 X 버튼 (기본: onClose 가 있으면 표시) */
  showClose?: boolean;
  /** 제목이 없을 때 화면 읽기 이름 (labelledBy 가 있으면 무시) */
  ariaLabel?: string;
  /** 창 이름이 될 요소 id — 본문(children)에 제목을 직접 그릴 때 (aria-labelledby) */
  labelledBy?: string;
  /** 창 설명이 될 요소 id (여러 개는 공백으로) — 본문의 질문·경고 문구를 열자마자 읽어 주게 (aria-describedby) */
  describedBy?: string;
  /** dialog(기본) · alertdialog(확인·경고처럼 바로 답해야 하는 창) */
  role?: 'dialog' | 'alertdialog';
  /** 처음 초점을 줄 요소 선택자 (기본: 창 안 첫 버튼·입력) */
  initialFocus?: string;
  className?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openCount = 0;

/** 모달 창 — body 끝에 그림, 초점 가두기·Esc·스크롤 잠금·닫으면 이전 초점으로 복귀 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = 'center',
  size = 'md',
  closeOnBackdrop = true,
  showClose,
  ariaLabel,
  labelledBy,
  describedBy,
  role = 'dialog',
  initialFocus,
  className,
}: ModalProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    openCount++;
    document.body.classList.add('sb-modal-open');
    const panel = panelRef.current;
    const first =
      (initialFocus ? panel?.querySelector<HTMLElement>(initialFocus) : null) ??
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!panelRef.current) return;
      if (e.key === 'Escape' && onCloseRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      openCount = Math.max(0, openCount - 1);
      if (!openCount) document.body.classList.remove('sb-modal-open');
      prevFocus?.focus?.();
    };
  }, [open, initialFocus]);

  if (!open || typeof document === 'undefined') return null;
  const closable = !!onClose;
  const aria = modalAria({ id, hasTitle: !!title, hasDescription: !!description, ariaLabel, labelledBy, describedBy });
  return createPortal(
    <div className={cx('sb-modal', `sb-modal--${variant}`)}>
      <div className="sb-modal__backdrop" onClick={() => closable && closeOnBackdrop && onClose?.()} aria-hidden="true" />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={aria.labelledBy}
        aria-describedby={aria.describedBy}
        aria-label={aria.label}
        tabIndex={-1}
        className={cx('sb-modal__panel', `sb-modal__panel--${size}`, className)}>
        {title || (showClose ?? closable) ? (
          <div className="sb-modal__head">
            <div className="sb-modal__titles">
              {title ? (
                <h2 id={`${id}-t`} className="sb-modal__title">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={`${id}-d`} className="sb-modal__desc">
                  {description}
                </p>
              ) : null}
            </div>
            {(showClose ?? closable) && onClose ? (
              <button type="button" className="sb-modal__close" aria-label="닫기" onClick={onClose}>
                <X size={20} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
        {children ? <div className="sb-modal__body">{children}</div> : null}
        {footer ? <div className="sb-modal__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export type SheetProps = Omit<ModalProps, 'variant'>;

/** 아래에서 올라오는 시트 (PC 폭에서는 가운데 창) */
export function Sheet(props: SheetProps) {
  return <Modal {...props} variant="sheet" />;
}
