/**
 * [키 확인] — 고른 AI 회사의 무료 모델 목록 조회로 키가 맞는지 + 고른 모델이 있는지 확인 (v3.1, 모든 회사)
 *  - Gemini: gemini.ts checkGeminiKey 그대로 (GET /v1beta/models)
 *  - OpenAI 호환: GET {apiBase}/models (Bearer) — OpenRouter 는 GET /api/v1/key 로 키 확인 뒤 모델 목록
 *  - Claude: GET /v1/models (x-api-key)
 *  - 유료 회사는 목록이 보여도 크레딧이 없으면 레시피 요청이 실패하므로 성공 문구에 그 점을 덧붙임
 * 키는 그 회사 주소로만 보내고, 오류 원문에 든 키 값은 가립니다.
 */
import { AiError, fetchJson } from './aiCommon';
import { anthropicHeaders, classifyAiError, errorMessageOf, keyOwnerProblem } from './aiClient';
import { hasInvalidKeyChars, KEY_FORMAT_TEXT, redactKey } from './apiKey';
import { checkGeminiKey, LIST_MODELS_TIMEOUT_MS, listModels, type GeminiModelInfo, type KeyCheckCode, type KeyCheckResult } from './gemini';
import { providerOf, type AiProvider, type AiProviderId } from './providers';

export type AiModelInfo = GeminiModelInfo;

/** 모델 목록 조회 실패 */
export class ModelListError extends Error {
  readonly check: KeyCheckCode;
  constructor(check: KeyCheckCode, message: string) {
    super(message);
    this.name = 'ModelListError';
    this.check = check;
  }
}

/** 레시피(글 대화)에 쓸 수 없는 모델 이름 (모든 회사) */
const NON_CHAT_RE = /(embed|moderation|whisper|tts|transcribe|audio|realtime|speech|image|imagine|dall-e|sora|video|vision-only|ocr|guard|safeguard|search-preview|computer-use|codex)/i;
/**
 * OpenAI 만: chat/completions 로 부를 수 없는 모델 — Responses API 전용(…-pro·deep-research)·예전 completions 전용(…-instruct·babbage·davinci)
 * (Groq·OpenRouter 의 '…-instruct' 는 보통의 대화 모델이라 여기에 넣지 않음)
 */
const OPENAI_NOT_CHAT_RE = /(-pro(-|$)|deep-research|instruct$|babbage|davinci)/i;

/** 이 앱이 chat/completions·messages 로 부를 수 있는 모델인지 (목록을 좁히는 규칙 — OpenRouter 무료만 — 은 빼고) */
export function callableModel(p: AiProvider, m: any): boolean {
  const id = typeof m?.id === 'string' ? m.id.trim() : '';
  if (!id || NON_CHAT_RE.test(id) || m.active === false) return false;
  if (p.id === 'openai' && (!/^(gpt-|o\d|chatgpt-)/i.test(id) || OPENAI_NOT_CHAT_RE.test(id))) return false;
  if (p.id === 'xai' && !/^grok/i.test(id)) return false;
  if (p.id === 'mistral' && m.capabilities && m.capabilities.completion_chat === false) return false;
  return true;
}

/** 회사별: 목록 응답 → 레시피에 쓸 모델 (기본·추천 모델 먼저, 그다음 이름 내림차순) */
export function filterProviderModels(p: AiProvider, body: unknown): AiModelInfo[] {
  const list: any[] = body && typeof body === 'object' && Array.isArray((body as any).data) ? (body as any).data : [];
  const seen = new Set<string>();
  const out: AiModelInfo[] = [];
  for (const m of list) {
    const id = typeof m?.id === 'string' ? m.id.trim() : '';
    // 부를 수 없는 모델은 빼고 (callableModel — 키 확인의 '쓸 수 있음'과 같은 기준)
    if (seen.has(id) || !callableModel(p, m)) continue;
    // 목록을 좁히는 규칙: OpenRouter 는 무료·추천만 보여 줌(수백 개라) — 다른 모델도 직접 입력하면 쓸 수 있음
    if (p.id === 'openrouter' && !(id.endsWith(':free') || id === 'openrouter/free' || p.suggestedModels.includes(id))) continue;
    seen.add(id);
    const name = typeof m.display_name === 'string' ? m.display_name : typeof m.name === 'string' ? m.name : '';
    out.push({ id, displayName: name.trim() || id });
  }
  const rank = (id: string) => {
    const i = p.suggestedModels.indexOf(id);
    return i >= 0 ? i : 100;
  };
  return out.sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; body: any }> {
  return fetchJson(url, { method: 'GET', headers }, timeoutMs);
}

/** 오류 → [키 확인] 결과 종류 */
function checkCodeFor(p: AiProvider, status: number, body: unknown): KeyCheckCode {
  const code = classifyAiError(p.id, { status, data: body });
  switch (code) {
    case 'TIMEOUT':
    case 'NETWORK':
      return 'NETWORK';
    case 'RATE_LIMIT':
    case 'BILLING':
      return 'QUOTA';
    case 'AUTH':
      return status === 403 ? 'PERMISSION' : 'INVALID_KEY';
    default:
      return 'ERROR';
  }
}

/**
 * 고른 회사의 모델 목록 (키 확인 겸). 실패하면 ModelListError
 * all: 목록에서 거르기 전 모든 모델 이름 (고른 모델이 있는지 볼 때)
 */
export async function listAiModels(providerId: AiProviderId, key: string, opts: { timeoutMs?: number } = {}): Promise<{ models: AiModelInfo[]; all: Set<string> }> {
  const p = providerOf(providerId);
  const k = (key ?? '').trim();
  if (!k) throw new ModelListError('INVALID_KEY', KEY_FORMAT_TEXT.short);
  if (hasInvalidKeyChars(k)) throw new ModelListError('INVALID_KEY', KEY_FORMAT_TEXT.chars);
  const timeoutMs = opts.timeoutMs ?? LIST_MODELS_TIMEOUT_MS;
  if (p.kind === 'gemini') {
    const models = await listModels(k, { timeoutMs });
    return { models, all: new Set(models.map((m) => m.id)) };
  }
  const headers = p.kind === 'anthropic' ? anthropicHeaders(k) : { Authorization: `Bearer ${k}` };
  delete (headers as Record<string, string>)['Content-Type'];
  const fail = (status: number, body: unknown) => {
    const check = checkCodeFor(p, status, body);
    return new ModelListError(check, redactKey(errorMessageOf(body, status), k).slice(0, 120));
  };
  try {
    if (p.id === 'openrouter') {
      // 모델 목록은 키 없이도 보이므로, 키는 /key 로 따로 확인
      const r = await getJson(`${p.apiBase}/key`, headers, timeoutMs);
      if (r.status >= 400 || r.body?.error) throw fail(r.status, r.body);
    }
    const url = p.kind === 'anthropic' ? `${p.apiBase}/models?limit=100` : `${p.apiBase}/models`;
    const r = await getJson(url, headers, timeoutMs);
    if (r.status >= 400 || r.body?.error) throw fail(r.status, r.body);
    if (!r.body || typeof r.body !== 'object' || !Array.isArray(r.body.data)) {
      // 와이파이 로그인 페이지·차단 프록시 등 (JSON 모델 목록이 아님)
      throw new ModelListError('NETWORK', `${p.label} 대신 다른 페이지가 응답했어요. 와이파이 로그인이 필요한지, 네트워크가 막고 있지 않은지 확인해 주세요.`);
    }
    // 부를 수 있는 모든 모델 (고르는 목록은 filterProviderModels 로 더 좁힘 — OpenRouter 무료·추천만)
    const all = new Set<string>(r.body.data.filter((m: any) => callableModel(p, m)).map((m: any) => m.id.trim()));
    return { models: filterProviderModels(p, r.body), all };
  } catch (e) {
    if (e instanceof ModelListError) throw e;
    const timeout = e instanceof AiError && e.code === 'TIMEOUT';
    throw new ModelListError('NETWORK', timeout ? '응답 시간이 넘었어요' : '인터넷 연결을 확인해 주세요');
  }
}

function checkText(p: AiProvider, code: Exclude<KeyCheckCode, 'OK' | 'MODEL_MISSING'>): string {
  switch (code) {
    case 'INVALID_KEY':
      return 'API 키가 올바르지 않아요. 복사한 키 전체를 다시 붙여 넣어 주세요.';
    case 'PERMISSION':
      return `이 키로는 ${p.label} API 를 쓸 권한이 없어요. ${p.keySiteLabel}에서 키의 권한·작업 공간 설정을 확인해 주세요.`;
    case 'QUOTA':
      return `크레딧이 없거나 사용량 한도에 걸렸어요. ${p.keySiteLabel}에서 충전·한도를 확인하거나 잠시 뒤 다시 시도해 주세요.`;
    case 'NETWORK':
      return '인터넷에 연결되어 있지 않아요. 연결을 확인한 뒤 다시 시도해 주세요.';
    default:
      return `${p.label} 서버에서 오류가 났어요. 잠시 후 다시 시도해 주세요.`;
  }
}

/** 성공 문구 — 유료 회사는 크레딧 안내를 덧붙임 */
export function okText(p: AiProvider, count: number, model: string): string {
  const base = `키가 확인됐어요. 사용할 수 있는 모델 ${count}개 중 ${model} 를 써요.`;
  return p.free === 'paid' ? `${base} 크레딧이 없으면 레시피를 만들 때 오류가 나니 충전 상태도 확인해 주세요.` : base;
}

/** 고른 모델이 있는지 — Claude 는 목록에 날짜 붙은 이름(claude-haiku-4-5-20251001)만 있어도 별칭(claude-haiku-4-5)을 받음 */
export function modelAvailable(p: AiProvider, all: ReadonlySet<string> | readonly string[], want: string): boolean {
  const list = Array.isArray(all) ? all : [...(all as ReadonlySet<string>)];
  if (list.includes(want)) return true;
  if (p.kind !== 'anthropic') return false;
  const esc = want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dated = new RegExp(`^${esc}-\\d{8}$`);
  return list.some((id) => dated.test(id));
}

export function missingText(model: string): string {
  return `키는 정상이에요. 다만 선택한 모델(${model})을 이 키로 쓸 수 없어요. 목록에서 다른 모델을 골라 주세요.`;
}

/** [키 확인] — 모든 회사 */
export async function checkAiKey(providerId: AiProviderId, key: string, model?: string, opts: { timeoutMs?: number } = {}): Promise<KeyCheckResult> {
  const p = providerOf(providerId);
  const want = (model || p.defaultModel).trim();
  // 다른 회사 키 모양이면 보내지 않음 (키가 엉뚱한 회사로 가지 않게)
  const owner = keyOwnerProblem(p.id, (key ?? '').trim());
  if (owner) return { ok: false, code: 'INVALID_KEY', message: owner.replace('저장된 키가', '이 키는') + '.', models: [] };
  if (p.kind === 'gemini') {
    const r = await checkGeminiKey(key, want, opts);
    return { ...r, available: r.models.map((m) => m.id) };
  }
  try {
    const { models, all } = await listAiModels(p.id, key, opts);
    const available = [...all];
    if (!modelAvailable(p, all, want)) return { ok: true, code: 'MODEL_MISSING', message: missingText(want), models, available };
    return { ok: true, code: 'OK', message: okText(p, models.length || all.size, want), models, available };
  } catch (e) {
    if (e instanceof ModelListError) {
      const code = e.check === 'OK' || e.check === 'MODEL_MISSING' ? 'ERROR' : e.check;
      const userText = code === 'INVALID_KEY' && (e.message === KEY_FORMAT_TEXT.chars || e.message === KEY_FORMAT_TEXT.short) ? e.message : null;
      const net = code === 'NETWORK' && /다른 페이지가 응답/.test(e.message) ? e.message : null;
      return { ok: false, code, message: userText ?? net ?? checkText(p, code), models: [] };
    }
    return { ok: false, code: 'ERROR', message: checkText(p, 'ERROR'), models: [] };
  }
}
