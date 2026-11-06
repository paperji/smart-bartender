/**
 * 모달 창의 화면 읽기 이름·설명 (aria-labelledby / aria-describedby / aria-label) 고르기 — Modal.tsx 가 씀
 * Modal.tsx 와 따로 둔 이유: 컴포넌트 파일이 컴포넌트가 아닌 값을 내보내면 개발 중 Fast Refresh 가 전체 새로고침으로 바뀜
 * (순수 함수라 tests/ui-fixes.test.ts 에서 그대로 검사)
 */
export interface ModalAriaInput {
  /** Modal 의 useId() 값 — 제목은 `${id}-t`, 설명은 `${id}-d` */
  id: string;
  /** Modal 의 title prop 을 그렸는지 */
  hasTitle: boolean;
  /** Modal 의 description prop 을 그렸는지 */
  hasDescription: boolean;
  ariaLabel?: string;
  /** 본문에 직접 그린 제목 요소 id */
  labelledBy?: string;
  /** 본문에 직접 그린 설명 요소 id (여러 개는 공백으로) */
  describedBy?: string;
}

export interface ModalAria {
  labelledBy?: string;
  describedBy?: string;
  label?: string;
}

export function modalAria({ id, hasTitle, hasDescription, ariaLabel, labelledBy, describedBy }: ModalAriaInput): ModalAria {
  const labelIds = [hasTitle ? `${id}-t` : '', labelledBy?.trim() ?? ''].filter(Boolean).join(' ');
  const descIds = [hasDescription ? `${id}-d` : '', describedBy?.trim() ?? ''].filter(Boolean).join(' ');
  return {
    labelledBy: labelIds || undefined,
    describedBy: descIds || undefined,
    // 이름을 가리키는 요소가 있으면 aria-label 은 쓰지 않음 (둘 다 있으면 labelledby 가 이겨 헷갈림)
    label: labelIds ? undefined : ariaLabel,
  };
}
