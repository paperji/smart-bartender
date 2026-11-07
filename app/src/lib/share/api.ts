/**
 * 공유 레시피 서버 (Supabase, v3.1) — 다른 사람이 AI 로 만든 레시피를 올리고·찾고·써 보기
 *  - 앱은 표에 직접 접근하지 않고 아래 함수(RPC)만 부름: share_recipe · browse_shared_recipes · use_shared_recipe ·
 *    report_shared_recipe · delete_shared_recipe (서버 쪽 정의: docs/shared-recipes.sql)
 *  - SHARE_API_KEY 는 Supabase "공개용(publishable) 키" — 브라우저·앱에 넣도록 만든 키라 저장소에 있어도 괜찮아요.
 *    표는 RLS 로 막혀 있고, 위 함수들이 글 길이·도수·연락처·횟수 한도를 서버에서 다시 검사함
 *  - 기기 번호(device.ts)는 "같은 기기는 한 번만 셈"·"내가 올린 것 지우기"에만 쓰고, 화면·서버 응답에 보이지 않음
 *  - 레시피 이유(reason)·기분·날씨 같은 개인 입력은 보내지 않음 (convert.ts buildSharePayload)
 * 서버(무료 등급)는 1주일 동안 아무도 쓰지 않으면 쉬므로, 연결이 안 되면 앱의 나머지 기능은 그대로 두고 안내만 함
 */
import { CATEGORIES, type Category, type Flavor, type RecipeSource, type Strength } from '@/lib/types';

export const SHARE_API_URL = 'https://ikxqrlqouijspalysanl.supabase.co';
/** Supabase 공개용 키 (sb_publishable_…) — 비밀 키가 아님 */
export const SHARE_API_KEY = 'sb_publishable_omqJsqXs5WlbFzV92Xh2iA_w3xWalSE';
/** 한 번 부를 때 시간 제한 */
export const SHARE_TIMEOUT_MS = 12000;
/** 인기 레시피 개수 */
export const TOP_COUNT = 5;
/** 검색 결과 한 번에 가져올 개수 */
export const PAGE_SIZE = 20;

/** 서버 한도와 같은 글 길이 (서버가 다시 자름) */
export const SHARE_LIMITS = { name: 30, nameEn: 40, description: 200, comment: 100, nickname: 16, garnish: 100, tips: 200, aiLabel: 20, query: 40 } as const;

export interface SharedIngredient {
  name: string;
  ml: number;
  abv: number;
  category: Category;
}

export interface SharedRecipe {
  id: string;
  createdAt: number;
  name: string;
  nameEn: string;
  description: string;
  /** 올린 사람의 추천 한마디 */
  comment: string;
  /** 올린 사람이 적은 별명 (빈 값이면 익명) */
  nickname: string;
  ingredients: SharedIngredient[];
  totalMl: number;
  estimatedAbv: number;
  strength: Strength;
  flavor: Flavor;
  garnish: string;
  tips: string;
  source: RecipeSource;
  /** 만든 AI 이름 (예: Gemini, ChatGPT) — 오프라인 추천이면 빈 값 */
  aiLabel: string;
  /** 실제로 만든 기기 수 (같은 기기는 1번) */
  useCount: number;
  /** 신고가 쌓여 목록에서 숨겨졌는지 (내가 올린 것 목록에서만 보임) */
  hidden: boolean;
  /** 이 기기가 올린 레시피인지 */
  mine: boolean;
  /** 이 기기가 이미 만들어 본 레시피인지 */
  used: boolean;
}

/** 올릴 때 보내는 내용 (서버 share_recipe 의 p_recipe) */
export interface SharePayload {
  name: string;
  nameEn: string;
  description: string;
  comment: string;
  nickname: string;
  ingredients: SharedIngredient[];
  flavor: Flavor;
  garnish: string;
  tips: string;
  source: RecipeSource;
  aiLabel: string;
}

export type ShareErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'RATE_LIMIT'
  | 'TOO_MANY'
  | 'BUSY'
  | 'DUPLICATE'
  | 'CONTACT'
  | 'TOO_STRONG'
  | 'INVALID'
  | 'NOT_FOUND'
  | 'OWN_RECIPE'
  | 'SERVER';

/** 오류별 안내 (해요체) */
export const SHARE_ERROR_TEXT: Record<ShareErrorCode, string> = {
  NETWORK: '공유 레시피 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
  TIMEOUT: '공유 레시피 서버가 응답하지 않아요. 잠시 뒤 다시 시도해 주세요.',
  UNAVAILABLE: '공유 레시피 서버가 잠시 쉬고 있어요. 잠시 뒤 다시 시도해 주세요.',
  RATE_LIMIT: '오늘은 더 올리거나 누를 수 없어요. 내일 다시 시도해 주세요.',
  TOO_MANY: '한 기기에서 올릴 수 있는 레시피(50개)를 모두 채웠어요. 예전 공유를 지운 뒤 올려 주세요.',
  BUSY: '지금 레시피를 올리는 사람이 너무 많아요. 잠시 뒤 다시 시도해 주세요.',
  DUPLICATE: '이미 공유한 레시피예요.',
  CONTACT: '링크·전화번호·이메일은 넣을 수 없어요. 해당 글을 지우고 다시 올려 주세요.',
  TOO_STRONG: '도수가 20%를 넘는 레시피는 공유할 수 없어요.',
  INVALID: '레시피 내용이 올바르지 않아 올리지 못했어요.',
  NOT_FOUND: '이 레시피는 지워졌거나 숨겨졌어요.',
  OWN_RECIPE: '내가 올린 레시피는 신고할 수 없어요.',
  SERVER: '공유 레시피 서버에서 오류가 났어요. 잠시 뒤 다시 시도해 주세요.',
};

export class ShareError extends Error {
  readonly code: ShareErrorCode;
  constructor(code: ShareErrorCode, detail?: string) {
    super(detail ? `${SHARE_ERROR_TEXT[code]} (${detail})` : SHARE_ERROR_TEXT[code]);
    this.name = 'ShareError';
    this.code = code;
  }
}

const SERVER_CODES = new Set<ShareErrorCode>(['RATE_LIMIT', 'TOO_MANY', 'BUSY', 'DUPLICATE', 'CONTACT', 'TOO_STRONG', 'INVALID', 'NOT_FOUND', 'OWN_RECIPE']);

/** HTTP 결과 → 오류 코드 (서버 함수는 raise exception '<코드>' → 400 + message) */
export function shareErrorFor(status: number, body: unknown): ShareErrorCode {
  const msg = body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string' ? (body as { message: string }).message : '';
  if (SERVER_CODES.has(msg as ShareErrorCode)) return msg as ShareErrorCode;
  // 22P02(형식 오류: 잘못된 uuid 등)·23514(검사 조건)
  const pg = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  if (pg === '22P02' || pg === '23514' || pg === '23502') return 'INVALID';
  // 쉬는 프로젝트·점검 중(540·503·502·504)
  if (status === 540 || status === 502 || status === 503 || status === 504) return 'UNAVAILABLE';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 404) return 'UNAVAILABLE';
  return 'SERVER';
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface CallOptions {
  fetchFn?: FetchFn;
  timeoutMs?: number;
}

/** 서버 함수 부르기 — 실패하면 ShareError */
export async function rpc<T>(fn: string, body: Record<string, unknown>, opts: CallOptions = {}): Promise<T> {
  const f: FetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 중단(abort)을 따르지 않는 fetch 라도 시간이 지나면 끝나게 함께 겨룸
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      ctrl?.abort();
      reject(new ShareError('TIMEOUT'));
    }, opts.timeoutMs ?? SHARE_TIMEOUT_MS);
  });
  let res: Response;
  let text = '';
  try {
    const go = async () => {
      const r = await f(`${SHARE_API_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: SHARE_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl?.signal,
      });
      return { r, t: await r.text() };
    };
    const out = await Promise.race([go(), timeout]);
    res = out.r;
    text = out.t;
  } catch (e: unknown) {
    if (e instanceof ShareError) throw e;
    throw new ShareError(timedOut || (e as { name?: string })?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // JSON 이 아님 — 와이파이 로그인 페이지·차단 프록시 등
    throw new ShareError(res.ok ? 'NETWORK' : shareErrorFor(res.status, null));
  }
  if (!res.ok) throw new ShareError(shareErrorFor(res.status, parsed));
  return parsed as T;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const level = (v: unknown) => Math.max(0, Math.min(5, Math.round(num(v))));
const STRENGTHS: readonly Strength[] = ['none', 'light', 'medium', 'strong'];

/** 서버 행 → SharedRecipe (모양이 틀린 행은 null) */
export function toSharedRecipe(row: unknown): SharedRecipe | null {
  if (!isObj(row) || typeof row.id !== 'string' || typeof row.name !== 'string' || !Array.isArray(row.ingredients)) return null;
  const ingredients: SharedIngredient[] = row.ingredients
    .filter((i): i is Record<string, unknown> => isObj(i) && typeof i.name === 'string' && num(i.ml, -1) > 0)
    .slice(0, 5)
    .map((i) => ({
      name: str(i.name, SHARE_LIMITS.name),
      ml: num(i.ml),
      abv: Math.max(0, num(i.abv)),
      category: CATEGORIES.includes(i.category as Category) ? (i.category as Category) : 'other',
    }));
  if (!ingredients.length) return null;
  const f = isObj(row.flavor) ? row.flavor : {};
  const created = Date.parse(str(row.created_at, 40));
  return {
    id: row.id,
    createdAt: Number.isFinite(created) ? created : 0,
    name: str(row.name, SHARE_LIMITS.name),
    nameEn: str(row.name_en, SHARE_LIMITS.nameEn),
    description: str(row.description, SHARE_LIMITS.description),
    comment: str(row.comment, SHARE_LIMITS.comment),
    nickname: str(row.nickname, SHARE_LIMITS.nickname),
    ingredients,
    totalMl: num(row.total_ml) || ingredients.reduce((a, b) => a + b.ml, 0),
    estimatedAbv: Math.max(0, num(row.estimated_abv)),
    strength: STRENGTHS.includes(row.strength as Strength) ? (row.strength as Strength) : 'none',
    flavor: { sweet: level(f.sweet), sour: level(f.sour), bitter: level(f.bitter), fizzy: level(f.fizzy), strength: level(f.strength) },
    garnish: str(row.garnish, SHARE_LIMITS.garnish),
    tips: str(row.tips, SHARE_LIMITS.tips),
    source: row.source === 'offline' ? 'offline' : 'direct',
    aiLabel: str(row.ai_label, SHARE_LIMITS.aiLabel),
    useCount: Math.max(0, Math.round(num(row.use_count))),
    hidden: row.hidden === true,
    mine: row.mine === true,
    used: row.used === true,
  };
}

export interface BrowseQuery {
  /** 검색어 (이름·설명·재료·별명, 띄어 쓴 낱말이 모두 들어간 것) — 빈 값이면 전체 */
  query?: string;
  limit?: number;
  offset?: number;
  /** false 면 무알콜만 (성인 확인 전) */
  alcohol?: boolean;
  /** true 면 이 기기가 올린 것만 (숨겨진 것 포함) */
  mine?: boolean;
}

export interface BrowseResult {
  items: SharedRecipe[];
  /** 조건에 맞는 전체 개수 */
  total: number;
}

/** 목록·검색 — 많이 만든 순, 같으면 최근 순 */
export async function browseShared(device: string | null, q: BrowseQuery = {}, opts?: CallOptions): Promise<BrowseResult> {
  const rows = await rpc<unknown>(
    'browse_shared_recipes',
    {
      p_device: device,
      p_query: (q.query ?? '').trim().slice(0, SHARE_LIMITS.query),
      p_limit: q.limit ?? PAGE_SIZE,
      p_offset: q.offset ?? 0,
      p_alcohol: q.alcohol !== false,
      p_mine: q.mine === true,
    },
    opts,
  );
  const list = Array.isArray(rows) ? rows : [];
  const items = list.map(toSharedRecipe).filter((x): x is SharedRecipe => !!x);
  const first = list[0];
  const total = isObj(first) ? Math.max(items.length, Math.round(num(first.total_count, items.length))) : 0;
  return { items, total };
}

/** 올리기 — 공유 레시피 id. 같은 기기가 같은 레시피를 이미 올렸으면 그 id 와 existing:true (서버 v2) */
export async function shareRecipe(device: string, payload: SharePayload, opts?: CallOptions): Promise<{ id: string; estimatedAbv: number; existing: boolean }> {
  const r = await rpc<unknown>('share_recipe', { p_device: device, p_recipe: payload }, opts);
  if (!isObj(r) || typeof r.id !== 'string') throw new ShareError('SERVER');
  return { id: r.id, estimatedAbv: num(r.estimatedAbv), existing: r.existing === true };
}

/** 실제로 만들었음 (같은 기기는 1번, 올린 사람 본인은 세지 않음) — 지금 사용 횟수 */
export async function recordUse(device: string, id: string, opts?: CallOptions): Promise<number> {
  return Math.max(0, Math.round(num(await rpc<unknown>('use_shared_recipe', { p_device: device, p_id: id }, opts))));
}

/** 신고 (같은 기기 1번, 3번 쌓이면 모두에게서 숨김) */
export async function reportShared(device: string, id: string, opts?: CallOptions): Promise<void> {
  await rpc<unknown>('report_shared_recipe', { p_device: device, p_id: id }, opts);
}

/** 내가 올린 레시피 공유 취소 — 지웠으면 true (이미 없으면 false) */
export async function deleteShared(device: string, id: string, opts?: CallOptions): Promise<boolean> {
  return (await rpc<unknown>('delete_shared_recipe', { p_device: device, p_id: id }, opts)) === true;
}
