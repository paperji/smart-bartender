/**
 * 모두의 레시피 동작 (v3.1) — 화면(모두의 레시피·기록)에서 부름
 *  - openShared: 공유 레시피 → 지금 장착된 재료에 맞춰 레시피 화면으로 (없는 재료는 물어보고 빼고 만듦)
 *      실제로 만들기 시작하면 lib/brew.ts 가 사용 횟수 1번 (데모 기기 제외)
 *  - shareEntry: 제조 기록 한 잔 → 서버에 올림 (별명·한마디)
 *  - cancelShare · reportShared · syncMine(서버의 내 공유 목록과 기기 기록 맞추기)
 */
import { particle } from '@/lib/ai/normalize';
import { go } from '@/lib/nav';
import { browseShared, deleteShared, reportShared as apiReport, shareRecipe, ShareError, type SharedRecipe } from '@/lib/share/api';
import { availability, buildSharePayload, payloadProblem, shareKeyOf, sharedToRecipe, type PayloadOptions, type ShareSource } from '@/lib/share/convert';
import { shareDeviceId } from '@/lib/share/device';
import { useSession } from '@/store/draft';
import { useShared } from '@/store/shared';
import { useSlots } from '@/store/slots';
import { alertMessage, confirm } from '@/ui/dialog/service';

import { buildSavedSession, remakeErrorText } from '../history/remake';

/** 오류 → 사용자 문구 */
export function shareErrorText(e: unknown): string {
  if (e instanceof ShareError) return e.message;
  return '공유 레시피 서버와 주고받지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}

/** 공유 레시피로 만들기 — 레시피 화면을 열었으면 true */
export async function openShared(s: SharedRecipe): Promise<boolean> {
  const slots = useSlots.getState().slots;
  const av = availability(s, slots);
  if (!av.items.some((i) => i.slot)) {
    alertMessage(
      '지금은 만들 수 없어요',
      `이 레시피의 재료(${s.ingredients.map((i) => i.name).join(', ')})가 하나도 장착되어 있지 않아요. 재료 탭에서 펌프에 장착한 뒤 다시 눌러 주세요.`,
    );
    return false;
  }
  if (av.missing.length) {
    const last = av.missing[av.missing.length - 1];
    const ok = await confirm(
      '없는 재료가 있어요',
      `${av.missing.join(', ')}${particle(last, '이', '가')} 장착되어 있지 않아요. 빼고 남은 재료로 비율을 맞춰 만들까요?\n재료 탭에서 장착하면 원래 레시피대로 만들 수 있어요.`,
      { confirmText: '빼고 만들기', cancelText: '취소' },
    );
    if (!ok) return false;
  }
  try {
    const session = buildSavedSession(sharedToRecipe(s), s.source, s.strength, slots, undefined, { sharedId: s.id });
    useSession.getState().setCurrent(session);
    useSession.getState().setRejectStreak(0);
    go('/recipe');
    return true;
  } catch (e) {
    alertMessage('이 레시피로 만들 수 없어요', remakeErrorText(e));
    return false;
  }
}

/** 올릴 내용 미리 만들기 (공유 창의 미리 보기와 실제로 올리는 내용이 같게) */
export function previewPayload(entry: ShareSource, opts: PayloadOptions) {
  return buildSharePayload(entry, useSlots.getState().slots, opts);
}

/** 올리기 전 검사 — 문제가 있으면 안내 문구 (서버와 같은 기준) */
export function shareProblem(entry: ShareSource, opts: PayloadOptions): string | null {
  return payloadProblem(previewPayload(entry, opts));
}

/**
 * 제조 기록 한 잔 올리기 — { id, existing }. existing: 이미 올려 둔 같은 레시피(응답을 못 받았던 공유 등)
 * 시간 초과·연결 끊김이면 서버에는 올라갔을 수 있어, 내 공유 목록으로 한 번 맞춰 보고 있으면 성공으로 봄
 */
export async function shareEntry(entry: ShareSource, opts: PayloadOptions): Promise<{ id: string; existing: boolean }> {
  const payload = previewPayload(entry, opts);
  const key = shareKeyOf(entry.recipe);
  const st = useShared.getState();
  let out: { id: string; existing: boolean };
  try {
    const r = await shareRecipe(shareDeviceId(), payload);
    out = { id: r.id, existing: r.existing };
  } catch (e) {
    if (e instanceof ShareError && (e.code === 'TIMEOUT' || e.code === 'NETWORK' || e.code === 'DUPLICATE')) {
      const mine = await syncMine().catch(() => null);
      const hit = mine?.find((x) => shareKeyOf(sharedToRecipe(x)) === key);
      if (!hit) throw e;
      out = { id: hit.id, existing: true };
    } else throw e;
  }
  st.markShared(key, { id: out.id, at: Date.now(), name: payload.name });
  st.setNickname(opts.nickname ?? '');
  return out;
}

/** 내가 올린 레시피 공유 취소 (확인창 포함) — 지웠으면 true */
export async function cancelShare(id: string, name: string): Promise<boolean> {
  const ok = await confirm('공유 취소', `'${name}'${particle(name, '을', '를')} 모두의 레시피에서 내릴까요? 다른 사람에게 더는 보이지 않아요.`, {
    confirmText: '공유 취소',
    destructive: true,
  });
  if (!ok) return false;
  try {
    await deleteShared(shareDeviceId(), id);
  } catch (e) {
    alertMessage('공유를 취소하지 못했어요', shareErrorText(e));
    return false;
  }
  // 이미 지워져 있었어도(false) 이 기기 기록에서는 뺌
  useShared.getState().unmarkShared(id);
  return true;
}

/** 신고 (확인창 포함) — 신고했으면 true. 신고가 3번 쌓이고 서로 다른 곳(접속 주소 2곳 이상)에서 왔으면 모두에게서 숨김 */
export async function reportShared(s: SharedRecipe): Promise<boolean> {
  const ok = await confirm(
    '레시피 신고',
    `'${s.name}'에 부적절한 이름·글(욕설·광고·개인정보 등)이 있나요? 신고하면 이 기기에서는 바로 안 보이고, 여러 사람의 신고가 쌓이면 모두에게서 숨겨져요.`,
    { confirmText: '신고', destructive: true },
  );
  if (!ok) return false;
  try {
    await apiReport(shareDeviceId(), s.id);
  } catch (e) {
    if (!(e instanceof ShareError && e.code === 'NOT_FOUND')) {
      alertMessage('신고하지 못했어요', shareErrorText(e));
      return false;
    }
  }
  useShared.getState().markReported(s.id);
  return true;
}

/** 서버의 내 공유 목록 → 기기 기록(기록 화면의 '공유됨' 표시)과 맞춤. 목록을 돌려줌 */
export async function syncMine(): Promise<SharedRecipe[]> {
  const { items } = await browseShared(shareDeviceId(), { mine: true, limit: 50 });
  const st = useShared.getState();
  const ids = new Set(items.map((x) => x.id));
  for (const [, v] of Object.entries(st.mine)) if (!ids.has(v.id)) st.unmarkShared(v.id);
  for (const x of items) st.markShared(shareKeyOf(sharedToRecipe(x)), { id: x.id, at: x.createdAt, name: x.name });
  return items;
}
