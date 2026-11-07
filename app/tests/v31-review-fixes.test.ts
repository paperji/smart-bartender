/// <reference types="node" />
/**
 * v3.1 독립 검토(1차) 반영 — 가짜 fetch 만 씀
 *  AI: 다른 회사 키 모양이면 보내지 않음 · OpenRouter "No endpoints found" 다시 보내기 · 생각 정도 거절이면 'low' 로 ·
 *      잘린 응답은 다시 보내지 않음 · Mistral 'Invalid model' = MODEL · Responses 전용 모델 거름 · Claude 별칭 · v3.0 기본 모델 고정 안 함
 *  공유: 서버와 같은 기준 검사 · AI 이름(예전 기록만 Gemini) · 설명·팁 빼기 · 응답을 못 받은 공유 맞추기 · 사용 기록은 보내기 전에 남김 ·
 *        즐겨찾기·다시 만들기가 공유 id·AI 를 이어받음
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { callAi, classifyAiError, keyOwnerProblem } from '../src/lib/ai/aiClient';
import { checkAiKey, filterProviderModels, modelAvailable } from '../src/lib/ai/keyCheck';
import { providerOf } from '../src/lib/ai/providers';
import { buildRequest } from '../src/lib/ai/recommend';
import { defaultSlots } from '../src/lib/presets';
import { buildSharePayload, payloadProblem, shareAiLabel } from '../src/lib/share/convert';
import type { Recipe, UserInput } from '../src/lib/types';
import { buildSavedSession, favoriteOrigin } from '../src/screens/history/remake';
import { shareEntry } from '../src/screens/shared/sharedActions';
import { findFavorite, isFavorite, useHistory } from '../src/store/history';
import { sanitizeSettings } from '../src/store/settings';
import { recordSharedUse, useShared } from '../src/store/shared';

const input: UserInput = { moods: [], taste: { sweet: 3, sour: 2, bitter: 0, fizzy: 3 }, strength: 'none', weather: null, situation: '', preference: '', cupMl: 200 };
const req = buildRequest(input, defaultSlots());
const RECIPE_JSON = JSON.stringify({ recipe: { name: '에이드', ingredients: [{ pump: 1, name: '사이다', ml: 150 }, { pump: 2, name: '오렌지주스', ml: 50 }] }, explore: [] });
const FAKE = 'test-key-not-real-0000-wxyz';

interface Call {
  url: string;
  body: any;
  headers: Record<string, string>;
}
async function withFetch<T>(handler: (c: Call, n: number) => Response | Promise<Response>, fn: (calls: Call[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const c = { url: String(url), headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
    calls.push(c);
    return handler(c, calls.length);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const chat = (content: unknown, finish = 'stop') => json({ choices: [{ message: { content }, finish_reason: finish }] });

// ───────────────────────── AI ─────────────────────────

test('다른 회사 키 모양이면 보내지 않음: callAi·checkAiKey 모두 fetch 없이 거절', async () => {
  const claudeKey = 'sk-ant-api03-' + 'x'.repeat(60);
  assert.match(keyOwnerProblem('gemini', claudeKey)!, /Claude 키 모양이에요\. 설정에서 AI 를 Claude로 바꾸거나 Gemini 키를/);
  assert.equal(keyOwnerProblem('anthropic', claudeKey), null);
  assert.equal(keyOwnerProblem('deepseek', 'sk-' + 'a'.repeat(32)), null, 'sk-… 만 있는 키는 막지 않음');
  await withFetch(
    () => {
      throw new Error('보내면 안 됨');
    },
    async (calls) => {
      await assert.rejects(callAi('gemini', claudeKey, req), (e: any) => e.code === 'AUTH' && !e.message.includes(claudeKey));
      await assert.rejects(callAi('openai', 'AIza' + 'b'.repeat(35), req), (e: any) => e.code === 'AUTH');
      const r = await checkAiKey('gemini', claudeKey);
      assert.equal(r.code, 'INVALID_KEY');
      assert.match(r.message, /^이 키는 Claude 키 모양이에요/);
      assert.equal(calls.length, 0);
    },
  );
});

test('OpenRouter "No endpoints found…"(옵션을 다 지원하는 곳 없음)이면 옵션을 줄여 다시', async () => {
  const raw = await withFetch(
    (c, n) => (n === 1 ? json({ error: { code: 404, message: 'No endpoints found that can handle the requested parameters.' } }, 404) : chat(RECIPE_JSON)),
    async (calls) => {
      const r = await callAi('openrouter', FAKE, req);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0].body.provider, { require_parameters: true });
      assert.equal(calls[1].body.provider, undefined);
      return r;
    },
  );
  assert.ok(raw.recipe);
});

test('생각 정도(reasoning_effort) 값이 거절되면 같은 단계에서 low 로 다시 (옵션을 통째로 빼지 않음)', async () => {
  await withFetch(
    (c, n) => (n === 1 ? json({ error: { message: "Unsupported value: 'reasoning_effort' does not support 'none' with this model.", type: 'invalid_request_error' } }, 400) : chat(RECIPE_JSON)),
    async (calls) => {
      await callAi('openai', FAKE, req, 'gpt-5.4-mini');
      assert.equal(calls.length, 2);
      assert.equal(calls[0].body.reasoning_effort, 'none');
      assert.equal(calls[1].body.reasoning_effort, 'low');
      assert.equal(calls[1].body.response_format.type, 'json_schema', '같은 단계 그대로');
    },
  );
});

test('길이 제한으로 끊긴 응답은 다시 보내지 않음, 빈 글은 같은 요청으로 한 번만 더', async () => {
  await withFetch(
    () => json({ content: [{ type: 'text', text: '{"recipe": {"name": "끊' }], stop_reason: 'max_tokens' }),
    async (calls) => {
      await assert.rejects(callAi('anthropic', FAKE, req), /너무 길어 중간에 끊겼어요/);
      assert.equal(calls.length, 1);
    },
  );
  await withFetch(
    () => chat(''),
    async (calls) => {
      await assert.rejects(callAi('deepseek', FAKE, req), /레시피를 만들지 못했어요/);
      assert.equal(calls.length, 2, '빈 글은 1번만 더');
      assert.deepEqual(calls[1].body.thinking, { type: 'disabled' }, '같은 옵션으로');
    },
  );
});

test("Mistral 'Invalid model' 400 은 MODEL (다시 보내지 않음)", async () => {
  assert.equal(classifyAiError('mistral', { status: 400, data: { object: 'error', message: 'Invalid model: mistral-foo', type: 'invalid_model' } }), 'MODEL');
  await withFetch(
    () => json({ object: 'error', message: 'Invalid model: mistral-foo', type: 'invalid_model' }, 400),
    async (calls) => {
      await assert.rejects(callAi('mistral', FAKE, req, 'mistral-foo'), (e: any) => e.code === 'MODEL');
      assert.equal(calls.length, 1);
    },
  );
});

test('모델 목록: ChatGPT 의 Responses 전용(-pro·deep-research) 모델은 뺌, Claude 날짜 이름이 있으면 별칭도 있음', () => {
  const p = providerOf('openai');
  const ids = filterProviderModels(p, { data: [{ id: 'gpt-6-luna' }, { id: 'o3-pro' }, { id: 'gpt-5-pro-2025-10-06' }, { id: 'o4-mini-deep-research' }, { id: 'gpt-6.1-terra' }] }).map((m) => m.id);
  assert.deepEqual(ids.sort(), ['gpt-6-luna', 'gpt-6.1-terra']);
  const c = providerOf('anthropic');
  assert.equal(modelAvailable(c, ['claude-haiku-4-5-20251001'], 'claude-haiku-4-5'), true);
  assert.equal(modelAvailable(c, ['claude-haiku-4-5-20251001'], 'claude-haiku'), false);
  assert.equal(modelAvailable(p, ['gpt-6-luna-2026'], 'gpt-6-luna'), false, '별칭 규칙은 Claude 만');
});

test('키 확인: 거르기 전 모든 모델 ID(available)를 돌려줘 목록에 안 보이는 유료 모델도 OK', async () => {
  const r = await withFetch(
    (c) => (c.url.endsWith('/key') ? json({ data: {} }) : json({ data: [{ id: 'openrouter/free' }, { id: 'anthropic/claude-haiku-5-5' }] })),
    () => checkAiKey('openrouter', FAKE, 'anthropic/claude-haiku-5-5'),
  );
  assert.equal(r.code, 'OK');
  assert.ok(r.available?.includes('anthropic/claude-haiku-5-5'));
  assert.ok(!r.models.some((m) => m.id === 'anthropic/claude-haiku-5-5'), '고르는 목록에는 없어도');
});

test('설정 옮기기: v3.0 이 늘 저장하던 기본 모델(gemini-3.6-flash)은 고정하지 않음, 직접 고른 모델만 옮김', () => {
  assert.deepEqual(sanitizeSettings({ aiMode: 'gemini', geminiModel: 'gemini-3.6-flash' }).aiModels, {});
  assert.deepEqual(sanitizeSettings({ aiMode: 'gemini', geminiModel: 'gemini-2.5-pro' }).aiModels, { gemini: 'gemini-2.5-pro' });
});

// ───────────────────────── 공유 ─────────────────────────

const R: Recipe = {
  name: '하이볼',
  description: '비 오는 날 우울한 당신을 위한 한 잔',
  reason: '',
  ingredients: [
    { pump: 1, name: '사이다', ml: 150 },
    { pump: 2, name: '오렌지주스', ml: 50 },
  ],
  totalMl: 200,
  estimatedAbv: 0,
  flavor: { sweet: 3, sour: 1, bitter: 0, fizzy: 4, strength: 0 },
  garnish: '레몬',
  tips: '오늘 힘드셨죠',
  suggestions: [],
};

test('payloadProblem: 서버와 같은 기준(재료 수·양·총량·이름 중복·도수·연락처)으로 미리 알려 줌', () => {
  const base = buildSharePayload({ recipe: R, source: 'direct' }, defaultSlots());
  assert.equal(payloadProblem(base), null);
  const ing = (n: number, ml = 20) => Array.from({ length: n }, (_, i) => ({ name: `재료${i}`, ml, abv: 0, category: 'other' as const }));
  assert.match(payloadProblem({ ...base, ingredients: ing(6) })!, /5가지를 넘는/);
  assert.match(payloadProblem({ ...base, ingredients: ing(1, 25) })!, /30ml 보다 적어/);
  assert.match(payloadProblem({ ...base, ingredients: [{ name: '물', ml: 0.5, abv: 0, category: 'water' }, ...ing(1, 100)] })!, /1ml 보다 적게/);
  assert.match(payloadProblem({ ...base, ingredients: [{ name: '물', ml: 320, abv: 0, category: 'water' }] })!, /300ml 를 넘어/);
  assert.match(payloadProblem({ ...base, ingredients: [{ name: '사이다', ml: 50, abv: 0, category: 'soda' }, { name: '사이다', ml: 50, abv: 0, category: 'soda' }] })!, /같은 이름의 재료/);
  assert.match(payloadProblem({ ...base, ingredients: [{ name: '보드카', ml: 100, abv: 40, category: 'spirit' }, { name: '사이다', ml: 50, abv: 0, category: 'soda' }] })!, /20%를 넘는/);
  assert.match(payloadProblem({ ...base, comment: 'www.spam.kr' })!, /링크/);
});

test('shareAiLabel: AI 이름이 없으면 예전 기록(meta 없음)만 Gemini, 새 기록은 AI. 설명·팁 빼고 올리기', () => {
  assert.equal(shareAiLabel({ source: 'direct' }), 'Gemini');
  assert.equal(shareAiLabel({ source: 'direct', meta: [{ name: '사이다', category: 'soda', abv: 0 }] }), 'AI');
  assert.equal(shareAiLabel({ source: 'direct', aiLabel: 'Claude' }), 'Claude');
  assert.equal(shareAiLabel({ source: 'offline', aiLabel: 'Claude' }), '');
  const p = buildSharePayload({ recipe: R, source: 'direct' }, defaultSlots(), { withNotes: false });
  assert.equal(p.description, '');
  assert.equal(p.tips, '');
  assert.equal(p.garnish, '레몬', '가니시는 그대로');
});

test('shareEntry: 이미 올린 레시피(existing)·응답을 못 받은 공유는 내 공유 목록으로 맞춰 성공 처리', async () => {
  useShared.setState({ mine: {} });
  const row = {
    id: 'sid-1', created_at: '2026-11-08T00:00:00Z', name: '하이볼', name_en: '', description: '', comment: '', nickname: '',
    ingredients: [{ name: '사이다', ml: 150, abv: 0, category: 'soda' }, { name: '오렌지주스', ml: 50, abv: 0, category: 'juice' }],
    total_ml: 200, estimated_abv: 0, strength: 'none', flavor: {}, garnish: '', tips: '', source: 'direct', ai_label: 'AI', use_count: 0, hidden: false, mine: true, used: false, total_count: 1,
  };
  await withFetch(
    (c) => {
      if (c.url.endsWith('/share_recipe')) throw new TypeError('connection reset');
      return json([row]);
    },
    async (calls) => {
      const r = await shareEntry({ recipe: R, source: 'direct' }, { nickname: 'QA' });
      assert.deepEqual(r, { id: 'sid-1', existing: true });
      assert.ok(calls.some((c) => c.url.endsWith('/browse_shared_recipes') && c.body.p_mine === true));
    },
  );
  assert.ok(Object.values(useShared.getState().mine).some((m) => m.id === 'sid-1'), '기록 화면에 공유됨');
  await withFetch(
    () => json({ id: 'sid-1', existing: true }),
    async () => assert.deepEqual(await shareEntry({ recipe: R, source: 'direct' }, {}), { id: 'sid-1', existing: true }),
  );
  useShared.setState({ mine: {} });
});

test('recordSharedUse: 보내기 전에 기다리는 목록에 남김 (보내는 도중 앱이 닫혀도 다음에 다시)', async () => {
  useShared.setState({ counted: [], pendingUses: [] });
  let seenPending: string[] = [];
  await withFetch(
    () => {
      seenPending = [...useShared.getState().pendingUses];
      return json(1);
    },
    () => recordSharedUse('r9'),
  );
  assert.deepEqual(seenPending, ['r9'], '요청을 보내는 동안 이미 남아 있음');
  assert.deepEqual(useShared.getState().pendingUses, []);
  assert.deepEqual(useShared.getState().counted, ['r9']);
  useShared.setState({ counted: [], pendingUses: [] });
});

test('즐겨찾기·다시 만들기가 공유 id·AI 를 이어받음 (남의 레시피를 내 것으로 다시 공유하지 않게)', () => {
  useHistory.setState({ entries: [], favorites: [], rejections: [] });
  const pump0: Recipe = { ...R, ingredients: R.ingredients.map((i) => ({ ...i, pump: 0 })) };
  assert.equal(useHistory.getState().toggleFavorite(pump0, { sharedId: 'S1', source: 'direct' }), true);
  // 레시피 화면(펌프 번호가 붙은 같은 레시피)에서도 같은 즐겨찾기로 봄
  assert.equal(isFavorite(useHistory.getState().favorites, R, 'S1'), true);
  assert.equal(findFavorite(useHistory.getState().favorites, R)?.sharedId, undefined, '공유 id 없이 펌프가 다르면 다른 레시피');
  const fav = useHistory.getState().favorites[0];
  const o = favoriteOrigin(fav, []);
  assert.equal(o.sharedId, 'S1');
  const s = buildSavedSession(R, 'direct', 'none', defaultSlots(), input, { sharedId: o.sharedId, provider: 'anthropic' });
  assert.equal(s.sharedId, 'S1');
  assert.equal(s.provider, 'anthropic');
  assert.equal(buildSavedSession(R, 'offline', 'none', defaultSlots(), input, { provider: 'anthropic' }).provider, undefined, '오프라인 레시피에는 AI 없음');
  assert.equal(useHistory.getState().toggleFavorite(R, { sharedId: 'S1' }), false, '같은 공유 id 로 해제');
  useHistory.setState({ entries: [], favorites: [], rejections: [] });
});
