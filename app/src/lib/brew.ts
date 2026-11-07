/**
 * 제조 흐름 — 레시피 → (연결/성인/검증 확인) → make 전송 → 진행 화면
 * 작업 종료 시 잔량 자동 차감 + 기록 저장 + 완료/중단/오류/연결 끊김 알림(SPEC §5.1)
 * - 같은 작업이 두 번 끝날 수 있음(연결이 끊겨 "결과 모름"으로 정리 → 재연결 뒤 실제 결과 도착):
 *   잔량은 처음 차감한 양과의 차이만 더 빼고, 기록은 같은 항목의 결과(status·dispensed·uncertain)만 갱신.
 *   작업 구분은 기기 id 가 아니라 앱이 붙인 localKey (run 의 id 는 늘 'run', 다시 만들기는 make id 를 다시 씀)
 * - 기록·알림의 레시피 이름은 그 작업을 시작할 때의 레시피(작업 id 별 스냅샷) — 늦게 끝난 사이 화면의 레시피가 바뀌어도 그대로
 * - 프라이밍(run, purpose 'prime')은 실제 재료가 나오므로 잔량 차감(같은 작업이 다시 끝나면 차이만). 세척(clean)은 끝나면 잔량 확인 안내만
 * - 정리했던 제조가 재연결 뒤 실제로 진행 중이면 진행 화면을 다시 엶
 * v3.0: expo-router → lib/nav.ts, AppState → platform/appState, AdultGate → store/adultGate, Alert → ui/dialog/service
 */
import { cleanText, normName, particle, revalidateRecipe, strengthForAbv, type NormalizeResult } from '@/lib/ai/normalize';
import { preferenceExcludedPumps } from '@/lib/ai/preference';
import type { AiProviderId } from '@/lib/ai/providers';
import { slotsToIngredients } from '@/lib/ai/recommend';
import { DeviceError, deviceClient } from '@/lib/device/client';
import { fmtMl } from '@/lib/format';
import { go } from '@/lib/nav';
import { deviceLimits, dispensedDelta, validateMake, type MakeStep } from '@/lib/protocol';
import type { IngredientMeta } from '@/lib/share/convert';
import type { PumpSlot, Recipe, RecipeSource, Strength } from '@/lib/types';
import { isAppActive } from '@/platform/appState';
import { haptic } from '@/platform/haptics';
import { cancelReminder, notify, requestNotifyPermission, scheduleReminder } from '@/platform/notify';
import { ensureAdult } from '@/store/adultGate';
import { isBusy, useDevice, type JobState } from '@/store/device';
import { useDraft, useSession, type CurrentRecipe } from '@/store/draft';
import { useHistory } from '@/store/history';
import { useSettings } from '@/store/settings';
import { recordSharedUse } from '@/store/shared';
import { isLowStock, useSlots } from '@/store/slots';
import { toast } from '@/store/toast';
import { alertMessage, confirmAsync } from '@/ui/dialog/service';

/** 재료 이름 비교 — SPEC §3.1 normName (소문자, 공백·기호 무시) */
const keyOf = (s: string) => normName(s);

/** 제조 진행 화면이 열려 있는지 (재연결 뒤 진행 화면을 다시 열 때 중복으로 쌓이지 않게) */
let brewingScreenOpen = false;
export function setBrewingScreenOpen(open: boolean) {
  brewingScreenOpen = open;
}

/**
 * 기록/즐겨찾기 레시피를 현재 장착 상태에 맞게 다시 매칭 (이름 기준 → 펌프 번호 갱신)
 * adultVerified: 설정의 성인 확인 값 (기본: 지금 설정) — 확인 전이면 저장된 제안 중 술 장착·대체 제안을 지움 (SPEC §3.2)
 * preference: 지금 성향 문장 (기본: 바텐더 탭 입력) — 알레르기·싫어하는 재료는 레시피 화면의 ml 조정·잔 맞춤과 같은 기준으로
 *   처음부터 빼고 "성향에 적힌 대로 …는 뺐어요" 안내를 남김 (SPEC §3.3 규칙 1, cleanText(…,300) 정리 문장으로 판정)
 */
export function remapSavedRecipe(
  recipe: Recipe,
  slots: PumpSlot[],
  strength?: Strength,
  adultVerified: boolean = !!useSettings.getState().adultVerifiedAt,
  preference: string = useDraft.getState().input?.preference ?? '',
): { recipe: Recipe; warnings: string[] } {
  const ingredients = recipe.ingredients.map((i) => {
    const byName = slots.find((s) => s.name && keyOf(s.name) === keyOf(i.name));
    return byName ? { ...i, pump: byName.pump, name: byName.name } : { ...i, pump: -1 };
  });
  const missing = ingredients.filter((i) => i.pump < 0).map((i) => i.name);
  const installed = slotsToIngredients(slots);
  const res = revalidateRecipe(
    { ...recipe, ingredients: ingredients.filter((i) => i.pump > 0) },
    {
      ingredients: installed,
      strength: strength ?? strengthForAbv(recipe.estimatedAbv),
      cupMl: recipe.totalMl,
      excludePumps: preferenceExcludedPumps(installed, cleanText(preference, 300)),
      adultVerified,
    },
  );
  if (missing.length) res.warnings.unshift(`지금 장착되지 않은 재료(${missing.join(', ')})는 빼고 만들어요.`);
  return res;
}

/**
 * 레시피를 다시 검증(ml 조정·잔 맞춤)하면서 빠진 재료의 안내 문구 (성향 제외·무알콜·미장착·잔량 0 등).
 * 빠진 재료가 없으면 [] — 레시피 화면이 배너에 더하고 토스트로도 알려 "안내 없이 사라지는" 일이 없게 함
 */
export function removalNotes(before: Recipe, res: NormalizeResult): string[] {
  const gone = before.ingredients.filter((i) => i.ml > 0 && !res.recipe.ingredients.some((x) => x.pump === i.pump));
  if (!gone.length) return [];
  const notes = res.warnings.filter((w) => gone.some((g) => w.includes(`'${g.name}'`)));
  if (notes.length) return notes;
  const lastName = gone[gone.length - 1].name;
  return [`${gone.map((g) => `'${g.name}'`).join(', ')}${particle(lastName, '이', '가')} 레시피에서 빠졌어요.`];
}

/** 첫 제조 때 알림 권한 답을 기다리는 최대 시간 — 넘으면 답을 기다리지 않고 제조를 시작 (답은 나중에 와도 처리) */
export const NOTIFY_ASK_WAIT_MS = 1500;

/**
 * 알림 권한 요청 (첫 제조 때 1번). 권한 창·알림 구현이 늦거나 응답하지 않아도 제조가 멈추지 않게
 * NOTIFY_ASK_WAIT_MS 까지만 기다림 (ANDROID-3). 거절하면(늦게 답해도) "화면에서 알려 드릴게요" 안내
 */
function askNotifyPermissionOnce(): Promise<void> {
  const answered = requestNotifyPermission().then(
    (granted) => {
      if (!granted) toast('알림이 꺼져 있어요. 완료되면 화면에서 알려 드릴게요.', 'info');
    },
    () => undefined,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, NOTIFY_ASK_WAIT_MS);
  });
  return Promise.race([answered, waited]).finally(() => clearTimeout(timer));
}

export async function startBrew(): Promise<boolean> {
  const cur = useSession.getState().current;
  if (!cur) return false;
  const recipe = cur.recipe;
  const dev = useDevice.getState();
  if (dev.conn !== 'connected') {
    const goDevice = await confirmAsync(
      '기기가 연결되어 있지 않아요',
      '기기 탭에서 칵테일 메이커를 연결해 주세요. 하드웨어가 없다면 기기 탭의 "데모 모드"로 체험할 수 있어요.',
      { confirmText: '기기 탭으로', cancelText: '닫기' },
    );
    if (goDevice) go('/device');
    return false;
  }
  if (isBusy(dev.job)) {
    toast('기기가 이미 작동 중이에요. 끝난 뒤 다시 시도하세요.', 'warning');
    return false;
  }
  const slots = useSlots.getState().slots;
  // 재료 구성이 레시피와 같은지 확인
  const mismatch = recipe.ingredients.find((i) => {
    const s = slots.find((x) => x.pump === i.pump);
    return !s || keyOf(s.name) !== keyOf(i.name);
  });
  if (mismatch) {
    alertMessage('재료 구성이 바뀌었어요', `펌프 ${mismatch.pump}의 재료가 레시피(${mismatch.name})와 달라요. 다시 추천받아 주세요.`);
    return false;
  }
  const hasAlcohol = recipe.ingredients.some((i) => (slots.find((s) => s.pump === i.pump)?.abv ?? 0) > 0);
  if (hasAlcohol) {
    const ok = await ensureAdult();
    if (!ok) {
      toast('무알콜로 설정하고 다시 추천받아 보세요.', 'info');
      return false;
    }
  }
  // 앱 쪽 사전 검증 — SPEC §2.3 순서·코드 (기기가 알려준 한도 사용, 모르면 v2.0 호환 값)
  const steps = recipe.ingredients.map((i) => ({ p: i.pump, ml: i.ml }));
  const mode = useSettings.getState().dispenseMode;
  const pumpCount = dev.info?.pumps ?? slots.length;
  const v = validateMake(steps, pumpCount, dev.cal ?? [], mode, deviceLimits(dev.info));
  if (!v.ok) {
    alertMessage('이 레시피는 제조할 수 없어요', v.msg ?? '기기 제한을 넘었어요.');
    return false;
  }
  // 첫 제조 때 1번만 알림 권한 요청 (완료되면 앱이 백그라운드여도 알려 드리기 위해) — 답을 오래 기다리지 않고 제조 시작
  const st = useSettings.getState();
  if (!st.notifyAsked) {
    st.set({ notifyAsked: true });
    await askNotifyPermissionOnce();
  }
  try {
    haptic.press();
    // 작업을 만든 즉시(명령 전송 전) 이 작업의 레시피를 기억 → 늦게 끝나도(재연결 뒤 결과 확인) 이 레시피로 기록·알림
    await deviceClient.make(steps, mode, { onStart: (job) => rememberBrew(job.id, cur) });
  } catch (e: any) {
    if (!(e instanceof DeviceError && e.code === 'UNCERTAIN')) {
      alertMessage('제조를 시작하지 못했어요', e?.message ?? String(e));
      return false;
    }
    // 명령은 기기에 닿았지만 응답(ack)을 못 받음 → 기기가 실제로 붓고 있을 수 있으므로 진행 화면에서 확인
  }
  // 모두의 레시피로 실제 기기에서 만들기 시작 → 사용 횟수 1번 (데모 기기의 가짜 제조는 세지 않음, 실패해도 제조와 무관)
  if (cur.sharedId && useDevice.getState().transportKind !== 'demo') recordSharedUse(cur.sharedId).catch(() => undefined);
  useSession.getState().setRejectStreak(0);
  go('/brewing');
  return true;
}

/** 제조 작업을 시작할 때의 레시피·입력 (작업 id 별) */
export interface BrewSnapshot {
  recipe: Recipe;
  source: RecipeSource;
  moods: string[];
  strength: Strength;
  /** 만든 AI 회사 · 공유 레시피 id · 재료 종류·도수 (기록에 남겨 공유할 때 씀, v3.1) */
  provider?: AiProviderId;
  sharedId?: string;
  meta?: IngredientMeta[];
  /** 그 작업을 시작한 레시피 세션 (useSession.current.createdAt) */
  sessionAt: number;
}

/**
 * 작업 id → 시작할 때의 레시피 (기록·알림·진행 화면 이름에 사용 — 지금 화면의 레시피(session.current)가 아님).
 * BUTTON_REPEAT_LAST 다시 만들기는 같은 id 로 같은 레시피를 다시 만들므로 id 로 찾아도 같은 레시피
 */
const brewSnapshots = new Map<string, BrewSnapshot>();
const MAX_TRACKED = 30;

function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_TRACKED) map.delete(map.keys().next().value as K);
}

function rememberBrew(jobId: string, cur: CurrentRecipe) {
  const slots = useSlots.getState().slots;
  const meta = cur.recipe.ingredients.flatMap((i) => {
    const s = slots.find((x) => x.pump === i.pump);
    return s ? [{ name: i.name, category: s.category, abv: s.abv }] : [];
  });
  remember(brewSnapshots, jobId, {
    recipe: cur.recipe,
    source: cur.source,
    moods: cur.input.moods,
    strength: cur.input.strength,
    sessionAt: cur.createdAt,
    ...(cur.source === 'direct' && cur.provider ? { provider: cur.provider } : {}),
    ...(cur.sharedId ? { sharedId: cur.sharedId } : {}),
    ...(meta.length ? { meta } : {}),
  });
}

/** 이 제조 작업을 시작할 때의 레시피 (앱이 시작하지 않은 작업이면 null) */
export function brewSnapshotOf(job: Pick<JobState, 'id' | 'kind'> | null | undefined): BrewSnapshot | null {
  if (!job || job.kind !== 'make') return null;
  return brewSnapshots.get(job.id) ?? null;
}

/** 작업(localKey) → 이미 처리한 결과·기록 ID (같은 작업이 다시 끝나면 차이만 차감·같은 기록 갱신·알림은 결과가 바뀐 경우만) */
interface HandledJob {
  status: JobState['status'];
  reason?: string;
  dispensed: MakeStep[];
  historyId?: string;
}
const handledJobs = new Map<string, HandledJob>();
const jobKey = (job: Pick<JobState, 'id' | 'localKey'>) => job.localKey ?? job.id;

/** 이 작업의 제조 기록 ID (아직 기록 전이면 null) — 진행 화면의 피드백 대상 */
export function jobHistoryId(job: Pick<JobState, 'id' | 'localKey'> | null | undefined): string | null {
  return job ? (handledJobs.get(jobKey(job))?.historyId ?? null) : null;
}

/**
 * 새 작업의 기록 ID: 'h' + 작업 id. 같은 ID 의 기록이 이미 있고 결과가 확정된 것이면(같은 id 를 다시 쓴 새 작업 —
 * 펌웨어 BUTTON_REPEAT_LAST 다시 만들기) 덮어쓰지 않게 뒤에 번호를 붙임. 결과를 모른 채 남긴 기록이면 같은 작업으로 보고 갱신
 */
function historyIdFor(job: JobState): string {
  const base = 'h' + job.id;
  const entries = useHistory.getState().entries;
  const old = entries.find((x) => x.id === base);
  if (!old || old.uncertain) return base;
  let n = 2;
  while (entries.some((x) => x.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** 중단 사유 문구 (제조 화면 배너·알림 공통) */
export function stopReasonText(reason: string | undefined): string {
  switch (reason) {
    case 'button':
      return '기기의 정지 버튼으로 멈췄어요.';
    case 'user':
      return '앱에서 멈췄어요.';
    case 'error':
      return '기기 안전장치가 작동해 멈췄어요.';
    case 'disconnected':
      return '연결이 끊겨 결과를 확인하지 못했어요. 기기와 잔을 직접 확인하세요.';
    case 'unknown':
      return '연결이 끊긴 동안 기기가 멈췄어요(정지 버튼 또는 재부팅).';
    case 'reboot':
      return '연결이 끊긴 동안 기기가 다시 켜져(전원 차단·재부팅) 제조가 멈췄어요.';
    default:
      return '제조가 멈췄어요.';
  }
}

/** 작업 종료 알림 문구 (SPEC §5.1) */
export function jobEndMessage(job: JobState, recipeName: string): { kind: 'done' | 'stopped'; title: string; body: string } {
  const total = (job.dispensed ?? []).reduce((a, b) => a + b.ml, 0);
  if (job.status === 'done') {
    if (job.uncertain) {
      return {
        kind: 'done',
        title: '연결이 끊긴 사이에 제조가 끝났어요',
        body: `${recipeName} 제조가 끝난 것으로 보여요. 중간에 멈췄을 수도 있으니 잔과 재료 잔량을 확인해 주세요. (계획량 ${fmtMl(total)})`,
      };
    }
    return {
      kind: 'done',
      title: '완성됐어요! 맛있게 즐기세요',
      body: `${recipeName} ${fmtMl(total)} 제조가 끝났어요. 잔을 꺼내 주세요.`,
    };
  }
  if (job.reason === 'error') {
    return {
      kind: 'stopped',
      title: '기기 안전장치가 작동했어요',
      body: `펌프가 너무 오래 켜져 있어 모든 펌프를 멈췄어요. 튜브와 기기를 확인해 주세요. (약 ${fmtMl(total)} 나옴)`,
    };
  }
  if (job.reason === 'disconnected') {
    return {
      kind: 'stopped',
      title: '연결이 끊겨 결과를 확인하지 못했어요',
      body: `기기와 잔을 직접 확인하세요. 확인된 양은 약 ${fmtMl(total)} 이에요. (기기는 정해진 양까지만 부어요)`,
    };
  }
  if (job.reason === 'unknown' || job.reason === 'reboot') {
    return {
      kind: 'stopped',
      title: '연결이 끊긴 동안 기기가 멈췄어요',
      body: `${stopReasonText(job.reason)} 확인된 양은 약 ${fmtMl(total)} 이에요. 잔을 확인해 주세요.`,
    };
  }
  return {
    kind: 'stopped',
    title: '제조를 멈췄어요',
    body: `${job.reason === 'button' ? '기기의 정지 버튼으로' : '앱에서'} 멈췄어요. 지금까지 약 ${fmtMl(total)} 나왔어요.`,
  };
}

/**
 * 예비 알림 (RC-1): 안드로이드 APK 는 앱이 백그라운드로 가면 WebView 의 JS 가 거의 멈춰 완료 알림이 앱을 다시 열 때에야 뜸.
 * 그래서 제조가 시작돼 끝 시각을 알면(ack 받은 시각 + 예상 시간) 그 조금 뒤에 OS 가 띄우는 알림을 작업마다 1번 예약해 둠.
 * 실제 결과를 처리하면 onJobEnd 가 같은 알림을 결과 알림으로 바꾸거나 취소 (예약 기능이 없는 웹·EXE 는 아무것도 안 함)
 */
const reminderFor = new Map<string, true>();
/** 예상 시간보다 조금 늦게 — 기기가 예상보다 늦게 끝나도 결과 알림보다 먼저 뜨지 않게 */
export const REMINDER_SLACK_MIN_MS = 5000;
export const REMINDER_SLACK_RATIO = 0.1;

/** 이 작업의 예비 알림 시각 (모르면 null) */
export function reminderAt(job: Pick<JobState, 'ackAt' | 'totalMs'>): number | null {
  if (!job.ackAt || !(job.totalMs > 0)) return null;
  return job.ackAt + job.totalMs + Math.max(REMINDER_SLACK_MIN_MS, Math.round(job.totalMs * REMINDER_SLACK_RATIO));
}

function scheduleBrewReminder(job: JobState) {
  if (job.status !== 'running' || job.uncertain) return;
  const key = jobKey(job);
  if (reminderFor.has(key)) return;
  const at = reminderAt(job);
  if (at == null || at <= Date.now()) return; // 이미 지난 시각이면 예약하지 않음 (플러그인은 지난 시각을 바로 띄움)
  remember(reminderFor, key, true);
  const name = brewSnapshotOf(job)?.recipe.name ?? '음료';
  scheduleReminder(key, 'done', '제조가 끝났을 거예요', `${name} — 앱을 열어 결과를 확인하고 잔을 꺼내 주세요.`, at);
}

/** 루트 레이아웃에서 1회 등록: 작업 종료 → 잔량 차감 + 기록 + 알림, 제조 중 연결 끊김/오류 알림 */
export function registerJobEffects() {
  const offEnd = deviceClient.onJobEnd((job) => {
    const dispensed = job.dispensed ?? [];
    const key = jobKey(job);
    const prev = handledJobs.get(key);
    if (job.kind === 'run') {
      // 프라이밍은 실제 재료가 튜브를 채우고 나옴 → 잔량에서 뺌 (캘리브레이션 측정은 저장할 때 따로 물어봄)
      // 같은 작업이 다시 끝나면(결과 모름 → 재연결 뒤 실제 결과) 처음 뺀 양과의 차이만 더 뺌
      if (job.purpose === 'prime') {
        useSlots.getState().deduct(dispensedDelta(dispensed, prev?.dispensed));
        remember(handledJobs, key, { status: job.status, reason: job.reason, dispensed });
      }
      return;
    }
    if (job.kind === 'clean') {
      if (job.status === 'done') {
        setTimeout(() => toast('세척이 끝났어요. 세척 후에는 재료 탭에서 잔량을 다시 확인해 주세요.', 'info'), 1500);
      }
      return;
    }
    // make
    useSlots.getState().deduct(dispensedDelta(dispensed, prev?.dispensed));
    const snap = brewSnapshotOf(job);
    const cur = useSession.getState().current;
    const historyId = prev?.historyId ?? historyIdFor(job);
    const old = useHistory.getState().entries.find((x) => x.id === historyId);
    // 기록 내용: 이미 있는 기록이면 레시피·입력은 그대로(결과만 갱신), 없으면 작업을 시작할 때의 레시피.
    // 앱이 시작하지 않은 작업(스냅샷 없음)만 지금 화면의 레시피로 (예전 동작)
    const extra = (x: { provider?: AiProviderId; sharedId?: string; meta?: IngredientMeta[] }) => ({
      ...(x.provider ? { provider: x.provider } : {}),
      ...(x.sharedId ? { sharedId: x.sharedId } : {}),
      ...(x.meta?.length ? { meta: x.meta } : {}),
    });
    const base = old
      ? { recipe: old.recipe, source: old.source, moods: old.moods, strength: old.strength, ...extra(old) }
      : snap
        ? { recipe: snap.recipe, source: snap.source, moods: snap.moods, strength: snap.strength, ...extra(snap) }
        : cur
          ? { recipe: cur.recipe, source: cur.source, moods: cur.input.moods, strength: cur.input.strength }
          : null;
    if (base) {
      useHistory.getState().add({
        id: historyId,
        ...base,
        status: job.status === 'done' ? 'done' : 'stopped',
        dispensed,
        ...(job.uncertain ? { uncertain: true } : {}),
      });
      // 진행 화면 피드백 대상은 지금 세션이 이 작업을 만든 세션일 때만 바꿈 (다른 레시피 세션의 기록을 가리키지 않게)
      if (snap ? cur?.createdAt === snap.sessionAt : !!cur) useSession.getState().setBrewHistoryId(historyId);
    }
    remember(handledJobs, key, { status: job.status, reason: job.reason, dispensed, ...(base ? { historyId } : {}) });
    if (!prev || prev.status !== job.status || prev.reason !== job.reason) {
      const m = jobEndMessage(job, base?.recipe.name ?? '음료');
      // 예약해 둔 예비 알림(RC-1)을 이 결과 알림으로 바꿈 — 이미 떠 있었으면 내용이 바뀌고, 아직이면 예약이 취소됨
      notify(m.kind, m.title, m.body, { replaces: key }).catch(() => undefined);
    } else {
      cancelReminder(key).catch(() => undefined);
    }
    const low = useSlots
      .getState()
      .slots.filter((s) => dispensed.some((d) => d.p === s.pump) && isLowStock(s))
      .map((s) => s.name);
    if (low.length) setTimeout(() => toast(`${low.join(', ')} 잔량이 얼마 남지 않았어요.`, 'warning'), 3200);
    else if (job.uncertain) {
      setTimeout(() => toast('연결이 끊긴 동안의 결과라 재료 잔량이 정확하지 않을 수 있어요. 재료 탭에서 확인해 주세요.', 'info'), 3200);
    }
  });

  // 제조 중 연결 끊김 / 제조 시작 오류 / 정리했던 제조가 실제로 진행 중 감시
  let notifiedDisconnectFor: string | null = null;
  const offStore = useDevice.subscribe((st, prev) => {
    const job = st.job;
    if (job && job.kind === 'make') scheduleBrewReminder(job);
    if (
      job &&
      job.kind === 'make' &&
      isBusy(job) &&
      prev.conn === 'connected' &&
      st.conn !== 'connected' &&
      notifiedDisconnectFor !== jobKey(job)
    ) {
      notifiedDisconnectFor = jobKey(job);
      notify(
        'disconnect',
        '블루투스 연결이 끊겼어요',
        '기기는 정해진 양만큼 계속 만들어요. 앱을 열어 다시 연결해 주세요. 급하면 기기의 정지 버튼을 누르세요.',
      ).catch(() => undefined);
    }
    const pj = prev.job;
    if (job && pj && job.kind === 'make' && pj.id === job.id && pj.status !== 'error' && job.status === 'error') {
      cancelReminder(jobKey(job)).catch(() => undefined);
      // 앱이 화면에 있으면 startBrew·진행 화면이 이미 안내함 → 백그라운드일 때만 알림
      if (!isAppActive()) {
        notify('error', job.uncertain ? '제조 여부를 확인하지 못했어요' : '제조를 시작하지 못했어요', job.error ?? '기기 오류').catch(
          () => undefined,
        );
      }
    }
    // 시작 못 함/결과 모름으로 정리했던(또는 앱이 몰랐던) 제조가 재연결 뒤 실제로 진행 중 → 진행 화면을 다시 엶
    if (job && job.kind === 'make' && job.status === 'running' && !(pj && isBusy(pj))) {
      if (!brewingScreenOpen) {
        try {
          go('/brewing');
        } catch {
          /* 내비게이션 준비 전 — 무시 */
        }
      }
      if (!isAppActive()) {
        notify('disconnect', '기기가 제조 중이에요', '다시 연결됐어요. 앱을 열어 진행 상황을 확인하고, 필요하면 비상 정지를 누르세요.').catch(
          () => undefined,
        );
      }
    }
  });
  return () => {
    offEnd();
    offStore();
  };
}
