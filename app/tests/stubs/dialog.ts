/**
 * 테스트용 확인창·안내창 대역 (v2.1 의 lib/ui 대역 대신) — ui/dialog/service 의 창을 바로 답함
 *  - 안내창(alert)·확인창(confirm) 모두 alerts 에 { kind, title, msg } 로 남김
 *  - 확인창은 setConfirmAnswer(값) 으로 정한 답 (기본 true)
 */
import { resolveDialog, useDialogs } from '../../src/ui/dialog/service';

export const alerts: { kind: 'confirm' | 'alert'; title: string; msg: string }[] = [];
let answer = true;

export function setConfirmAnswer(v: boolean): void {
  answer = v;
}

let installed: (() => void) | null = null;

export function installDialogStub(): typeof alerts {
  if (installed) return alerts;
  const handled = new Set<number>();
  installed = useDialogs.subscribe((s) => {
    for (const d of s.queue) {
      if (handled.has(d.id)) continue;
      handled.add(d.id);
      alerts.push({ kind: d.kind, title: d.title, msg: d.message });
      queueMicrotask(() => resolveDialog(d.id, d.kind === 'confirm' ? answer : true));
    }
  });
  return alerts;
}
