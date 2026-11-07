/// <reference types="node" />
/**
 * v3.1 여러 AI 회사 (BYOK) — 가짜 fetch 만 씀(실제 AI 호출·실제 키 없음)
 *  - providers: 8곳 목록·키 모양 짐작·조사
 *  - callAi: OpenAI 호환(ChatGPT·DeepSeek 등) 요청 모양·옵션 줄여 다시 요청·Claude 요청 모양·스키마 바꾸기·응답 해석
 *  - classifyAiError: 회사별 오류 → 같은 코드 (크레딧·키·한도·모델)
 *  - generateRecipe·flow: 고른 회사·키·모델로 부름, 결과에 provider
 *  - checkAiKey: 모델 목록으로 키 확인 (OpenRouter 는 /key)
 *  - 설정: v3.0 저장값 옮기기, 회사별 키 저장·힌트, 버전 1 그대로(올리면 예전 설정이 지워짐)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { anthropicSchema, callAi, classifyAiError, openAiBody } from '../src/lib/ai/aiClient';
import { redactKey } from '../src/lib/ai/apiKey';
import { checkAiKey, filterProviderModels } from '../src/lib/ai/keyCheck';
import { buildResponseSchema, jsonShapeHint } from '../src/lib/ai/prompt';
import { AI_ORIGINS, AI_PROVIDERS, guessProvider, providerOf, withJosa } from '../src/lib/ai/providers';
import { buildRequest, generateRecipe } from '../src/lib/ai/recommend';
import { fallbackToast, requestRecommendation } from '../src/lib/flow';
import { defaultSlots } from '../src/lib/presets';
import type { UserInput } from '../src/lib/types';
import { clearAiKey, getAiKey, onAiKeyChange, secretNameFor, setAiKey } from '../src/platform/secrets';
import { kv } from '../src/platform/storage';
import { activeKeyHint, activeModel, deleteAiKey, saveAiKey, sanitizeSettings, SETTINGS_DEFAULTS, syncAiKeyHints, useSettings } from '../src/store/settings';
import { STORAGE_KEYS } from '../src/store/storage';

const FAKE_KEY = 'test-key-not-real-0000-wxyz';
const input: UserInput = {
  moods: ['피곤함'],
  taste: { sweet: 3, sour: 2, bitter: 0, fizzy: 3 },
  strength: 'none',
  weather: null,
  situation: '',
  preference: '',
  cupMl: 200,
};
const req = buildRequest(input, defaultSlots());
const RECIPE = { name: '테스트 에이드', ingredients: [{ pump: 1, name: '사이다', ml: 150 }, { pump: 2, name: '오렌지주스', ml: 50 }] };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

async function withFetch<T>(handler: (c: Call, n: number) => Response | Promise<Response>, fn: (calls: Call[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const c: Call = { url: String(url), method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
    calls.push(c);
    return handler(c, calls.length);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const chat = (content: unknown, finish = 'stop') => json({ choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] });

// ───────────────────────── 목록 ─────────────────────────

test('providers: 8곳, id·주소 겹치지 않음, 모두 https, 기본 모델·발급 주소·단계 있음', () => {
  assert.deepEqual(
    AI_PROVIDERS.map((p) => p.id),
    ['gemini', 'openai', 'anthropic', 'xai', 'deepseek', 'mistral', 'groq', 'openrouter'],
  );
  assert.equal(new Set(AI_ORIGINS).size, AI_PROVIDERS.length);
  for (const p of AI_PROVIDERS) {
    assert.match(p.origin, /^https:\/\/[a-z0-9.-]+$/);
    assert.ok(p.apiBase.startsWith(p.origin), `${p.id} apiBase`);
    assert.match(p.keyPageUrl, /^https:\/\//);
    assert.ok(p.defaultModel && p.suggestedModels[0] === p.defaultModel, `${p.id} 기본 모델이 추천 첫째`);
    assert.ok(p.steps.length >= 3 && p.steps.every((s) => s.title && s.body), `${p.id} 단계`);
    assert.ok(!/Gemini/.test(p.id === 'gemini' ? '' : p.steps.map((s) => s.body).join('')), `${p.id} 안내에 다른 회사 이름 없음`);
  }
  assert.equal(providerOf('nope').id, 'gemini', '모르는 값은 Gemini');
});

test('guessProvider: 키 모양으로 회사 짐작 (sk-… 만 있는 키는 모름)', () => {
  assert.equal(guessProvider('AIzaSyA' + 'x'.repeat(32)), 'gemini');
  assert.equal(guessProvider('AQ.Ab8RN6' + 'x'.repeat(30)), 'gemini');
  assert.equal(guessProvider('sk-proj-' + 'a'.repeat(60)), 'openai');
  assert.equal(guessProvider('sk-ant-api03-' + 'b'.repeat(60)), 'anthropic');
  assert.equal(guessProvider('xai-' + 'c'.repeat(40)), 'xai');
  assert.equal(guessProvider('gsk_' + 'd'.repeat(52)), 'groq');
  assert.equal(guessProvider('sk-or-v1-' + 'e'.repeat(64)), 'openrouter');
  assert.equal(guessProvider('sk-' + 'f'.repeat(32)), null, 'DeepSeek·예전 OpenAI 는 구분 못 함');
  assert.equal(guessProvider(FAKE_KEY), null);
  assert.equal(guessProvider(''), null);
});

test('withJosa: 이름 끝소리에 맞는 조사', () => {
  assert.equal(withJosa('openai', '이/가'), 'ChatGPT가');
  assert.equal(withJosa('xai', '이/가'), 'Grok이');
  assert.equal(withJosa('xai', '으로/로'), 'Grok으로');
  assert.equal(withJosa('mistral', '으로/로'), 'Mistral로', 'ㄹ 받침은 로');
  assert.equal(withJosa('mistral', '을/를'), 'Mistral을');
  assert.equal(withJosa('anthropic', '을/를'), 'Claude를');
});

// ───────────────────────── 요청 모양 ─────────────────────────

test('openAiBody: ChatGPT 는 json_schema + 생각 끄기, DeepSeek 은 json_object + max_tokens + thinking off, 2·3차는 옵션을 줄임', () => {
  const o0 = openAiBody(providerOf('openai'), 'gpt-6-luna', req, 0);
  assert.equal(o0.model, 'gpt-6-luna');
  assert.equal((o0.response_format as any).type, 'json_schema');
  assert.equal((o0.response_format as any).json_schema.strict, false);
  assert.equal(o0.reasoning_effort, 'none');
  assert.equal(o0.max_completion_tokens, 4096);
  assert.equal((o0.messages as any[])[0].role, 'system');
  const o1 = openAiBody(providerOf('openai'), 'gpt-6-luna', req, 1);
  assert.deepEqual(o1.response_format, { type: 'json_object' });
  assert.equal(o1.reasoning_effort, undefined, '2차는 회사 옵션 없음');
  assert.match((o1.messages as any[])[0].content, /응답 JSON 형식/, 'json_object 면 JSON 모양 안내');
  const o2 = openAiBody(providerOf('openai'), 'gpt-6-luna', req, 2);
  assert.equal(o2.response_format, undefined);
  const d0 = openAiBody(providerOf('deepseek'), 'deepseek-flash', req, 0);
  assert.deepEqual(d0.response_format, { type: 'json_object' });
  assert.deepEqual(d0.thinking, { type: 'disabled' });
  assert.equal(d0.max_tokens, 4096);
  assert.equal(d0.max_completion_tokens, undefined);
  assert.match((d0.messages as any[])[0].content, /JSON/, 'DeepSeek 은 프롬프트에 JSON 낱말이 있어야 함');
  const g0 = openAiBody(providerOf('groq'), 'openai/gpt-oss-120b', req, 0);
  assert.equal(g0.reasoning_effort, 'low');
  assert.equal(g0.include_reasoning, false);
  const r0 = openAiBody(providerOf('openrouter'), 'openrouter/free', req, 0);
  assert.deepEqual(r0.provider, { require_parameters: true });
});

test('jsonShapeHint: JSON 낱말·키 이름·쓸 수 있는 펌프 번호', () => {
  const h = jsonShapeHint(req);
  assert.match(h, /JSON/);
  for (const k of ['"recipe"', '"explore"', '"ingredients"', '"estimatedAbv"', '"flavor"', '"suggestions"', '"addIngredient"']) assert.ok(h.includes(k), k);
  assert.match(h, /펌프 번호\(1, 2, 3, 4\)/);
});

test('anthropicSchema: 모든 객체에 additionalProperties:false, 숫자 범위·maxItems 는 뺌, enum·required 는 남김', () => {
  const s = anthropicSchema(buildResponseSchema(req)) as any;
  const walk = (n: any, path: string) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${path}[${i}]`));
    for (const k of ['minimum', 'maximum', 'maxItems', 'minLength', 'maxLength']) assert.ok(!(k in n), `${path}.${k}`);
    if (n.type === 'object') assert.equal(n.additionalProperties, false, `${path} additionalProperties`);
    for (const [k, v] of Object.entries(n)) if (k !== 'enum') walk(v, `${path}.${k}`);
  };
  walk(s, '$');
  assert.deepEqual(s.required, ['recipe', 'explore']);
  assert.deepEqual(s.properties.recipe.properties.ingredients.items.properties.pump.enum, [1, 2, 3, 4]);
});

test('callAi(ChatGPT): 주소·Bearer 헤더(주소에 키 없음)·응답 해석', async () => {
  const raw = await withFetch(
    () => chat(JSON.stringify({ recipe: RECIPE, explore: [] })),
    async (calls) => {
      const r = await callAi('openai', FAKE_KEY, req);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(calls[0].headers.authorization, `Bearer ${FAKE_KEY}`);
      assert.ok(!calls[0].url.includes(FAKE_KEY));
      assert.equal(calls[0].body.model, 'gpt-6-luna', '기본 모델');
      return r;
    },
  );
  assert.equal((raw.recipe as any).name, '테스트 에이드');
});

test('callAi: 400(옵션 거절)이면 옵션을 줄여 다시 — 2차는 json_object, 3차는 기본. 코드 블록·Mistral 조각 배열도 읽음', async () => {
  const raw = await withFetch(
    (c, n) =>
      n < 3
        ? json({ error: { message: `Unsupported parameter (${n})`, type: 'invalid_request_error' } }, 400)
        : chat([{ type: 'thinking', thinking: [] }, { type: 'text', text: '```json\n' + JSON.stringify({ recipe: RECIPE, explore: [] }) + '\n```' }]),
    async (calls) => {
      const r = await callAi('mistral', FAKE_KEY, req, 'mistral-small-latest');
      assert.equal(calls.length, 3);
      assert.equal(calls[0].body.reasoning_effort, 'none');
      assert.deepEqual(calls[1].body.response_format, { type: 'json_object' });
      assert.equal(calls[1].body.reasoning_effort, undefined);
      assert.equal(calls[2].body.response_format, undefined);
      assert.ok(calls.every((c) => c.body.max_tokens === 4096));
      return r;
    },
  );
  assert.equal((raw.recipe as any).ingredients.length, 2);
});

test('callAi: DeepSeek 빈 글(깨진 JSON)이면 한 번 더, 키 오류(401)는 다시 보내지 않고 AUTH (원문의 키는 가림)', async () => {
  const ok = await withFetch(
    (c, n) => (n === 1 ? chat('   ') : chat(JSON.stringify({ recipe: RECIPE, explore: [] }))),
    async (calls) => {
      const r = await callAi('deepseek', FAKE_KEY, req);
      assert.equal(calls.length, 2);
      return r;
    },
  );
  assert.ok(ok.recipe);
  const longKey = 'sk-' + 'q'.repeat(40);
  await withFetch(
    () => json({ error: { message: `Authentication Fails, Your api key: ${longKey} is invalid`, type: 'authentication_error' } }, 401),
    async (calls) => {
      await assert.rejects(callAi('deepseek', longKey, req), (e: any) => {
        assert.equal(e.code, 'AUTH');
        assert.match(e.message, /^DeepSeek 오류\(AUTH\)/);
        assert.ok(!e.message.includes(longKey), '키 값을 가림');
        return true;
      });
      assert.equal(calls.length, 1, '키 오류는 다시 보내지 않음');
    },
  );
});

test('callAi(Claude): /v1/messages · x-api-key · 버전 · 브라우저 허용 헤더 · output_config(effort low + json_schema) · 생각 블록 건너뜀', async () => {
  const raw = await withFetch(
    () => json({ type: 'message', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify({ recipe: RECIPE, explore: [] }) }], stop_reason: 'end_turn' }),
    async (calls) => {
      const r = await callAi('anthropic', FAKE_KEY, req);
      const c = calls[0];
      assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
      assert.equal(c.headers['x-api-key'], FAKE_KEY);
      assert.equal(c.headers['anthropic-version'], '2023-06-01');
      assert.equal(c.headers['anthropic-dangerous-direct-browser-access'], 'true');
      assert.equal(c.headers.authorization, undefined);
      assert.equal(c.body.model, 'claude-haiku-5-5');
      assert.equal(c.body.max_tokens, 4096);
      assert.equal(typeof c.body.system, 'string');
      assert.equal(c.body.temperature, undefined, 'temperature 는 보내지 않음');
      assert.equal(c.body.output_config.effort, 'low');
      assert.equal(c.body.output_config.format.type, 'json_schema');
      assert.equal(c.body.output_config.format.schema.additionalProperties, false);
      return r;
    },
  );
  assert.equal((raw.recipe as any).name, '테스트 에이드');
});

test('callAi: 거절(refusal)·OpenRouter 의 200+error·Grok 의 평평한 오류 본문', async () => {
  await withFetch(
    () => json({ choices: [{ message: { content: null, refusal: '도와드릴 수 없어요' }, finish_reason: 'stop' }] }),
    () => assert.rejects(callAi('openai', FAKE_KEY, req), /ChatGPT에서 레시피를 만들어 주지 않았어요/),
  );
  await withFetch(
    () => json({ error: { code: 402, message: 'Insufficient credits', metadata: { limit_source: 'openrouter_credits' } } }),
    () => assert.rejects(callAi('openrouter', FAKE_KEY, req), (e: any) => e.code === 'BILLING'),
  );
  await withFetch(
    () => json({ code: 'permission-denied', error: "Your team doesn't have any credits yet." }, 403),
    () => assert.rejects(callAi('xai', FAKE_KEY, req), (e: any) => e.code === 'BILLING' && /Grok 오류\(BILLING\)/.test(e.message)),
  );
});

test('classifyAiError: 회사별 오류 → 같은 코드', () => {
  const c = (p: any, status: number, data?: any) => classifyAiError(p, { status, data });
  assert.equal(c('openai', 429, { error: { type: 'insufficient_quota', code: 'credit_balance_exhausted' } }), 'BILLING', 'OpenAI 크레딧 소진은 429');
  assert.equal(c('openai', 429, { error: { message: 'Rate limit reached for requests', code: 'rate_limit_exceeded' } }), 'RATE_LIMIT');
  assert.equal(c('openai', 401, { error: { code: 'invalid_api_key' } }), 'AUTH');
  assert.equal(c('openai', 404, { error: { code: 'model_not_found' } }), 'MODEL');
  assert.equal(c('anthropic', 400, { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }), 'BILLING');
  assert.equal(c('anthropic', 529, { error: { type: 'overloaded_error' } }), 'UPSTREAM');
  assert.equal(c('anthropic', 403, { error: { type: 'permission_error' } }), 'AUTH');
  assert.equal(c('xai', 400, { code: 'invalid-argument', error: 'Incorrect API key provided: xa***b1. You can obtain an API key from https://console.x.ai.' }), 'AUTH');
  assert.equal(c('deepseek', 402, { error: { message: 'Insufficient Balance' } }), 'BILLING');
  assert.equal(c('deepseek', 400, { error: { message: 'Model Not Exist' } }), 'MODEL');
  assert.equal(c('mistral', 401, { detail: 'Invalid API Key' }), 'AUTH');
  assert.equal(c('mistral', 422, { message: 'bad value' }), 'BAD_REQUEST');
  assert.equal(c('groq', 429, { error: { code: 'rate_limit_exceeded' } }), 'RATE_LIMIT');
  assert.equal(classifyAiError('openai', { status: 0, error: 'TIMEOUT' }), 'TIMEOUT');
  assert.equal(classifyAiError('openai', { status: 0, error: 'NETWORK' }), 'NETWORK');
  // Gemini 는 예전 규칙 그대로 (무료 등급 429 의 'billing' 문구는 RATE_LIMIT)
  assert.equal(c('gemini', 429, { error: { message: 'You exceeded your current quota, please check your plan and billing details' } }), 'RATE_LIMIT');
});

test('redactKey: sk-·xai-·gsk_ 모양 키도 가림', () => {
  const t = redactKey('key sk-proj-AAAAAAAAAAAAAAAAAAAA and xai-BBBBBBBBBBBBBBBBBBBB and gsk_CCCCCCCCCCCCCCCCCCCC');
  assert.ok(!/AAAAAAAA|BBBBBBBB|CCCCCCCC/.test(t), t);
});

// ───────────────────────── 레시피 만들기 ─────────────────────────

test('generateRecipe: 고른 회사로 부르고 결과에 provider·model, 실패하면 오프라인 + 그 회사 이름으로 안내', async () => {
  const r = await withFetch(
    () => chat(JSON.stringify({ recipe: RECIPE, explore: [] })),
    () => generateRecipe({ input, slots: defaultSlots(), aiMode: 'ai', aiProvider: 'groq', aiKey: FAKE_KEY }),
  );
  assert.equal(r.source, 'direct');
  assert.equal(r.provider, 'groq');
  assert.equal(r.model, 'openai/gpt-oss-120b');
  const f = await withFetch(
    () => json({ error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }, 429),
    () => generateRecipe({ input, slots: defaultSlots(), aiMode: 'ai', aiProvider: 'anthropic', aiKey: FAKE_KEY }),
  );
  assert.equal(f.source, 'offline');
  assert.equal(f.provider, 'anthropic', '쓰려던 AI');
  assert.equal(f.fallbackCode, 'RATE_LIMIT');
  assert.match(fallbackToast(f)!.message, /^Claude에서 답을 받지 못해 오프라인 추천을 보여드려요/);
  const nokey = await generateRecipe({ input, slots: defaultSlots(), aiMode: 'ai', aiProvider: 'openai', aiKey: null });
  assert.equal(nokey.fallbackCode, 'NO_KEY');
  assert.match(fallbackToast(nokey)!.message, /내 AI 키를 등록할 수 있어요/);
});

test('flow.requestRecommendation: 고른 회사의 저장된 키·모델로 부름 (다른 회사 키는 쓰지 않음)', async () => {
  useSettings.setState({ ...SETTINGS_DEFAULTS, aiModels: {}, aiKeyHints: {}, lastDevices: {} });
  await saveAiKey('gemini', 'gemini-key-not-real-1111');
  await saveAiKey('openai', 'openai-key-not-real-2222');
  useSettings.getState().set({ aiProvider: 'openai', aiModels: { openai: 'gpt-6.1-terra' } });
  try {
    const r = await withFetch(
      () => chat(JSON.stringify({ recipe: RECIPE, explore: [] })),
      async (calls) => {
        const res = await requestRecommendation({ input });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
        assert.equal(calls[0].headers.authorization, 'Bearer openai-key-not-real-2222');
        assert.equal(calls[0].body.model, 'gpt-6.1-terra');
        return res;
      },
    );
    assert.equal(r.provider, 'openai');
    // 고른 회사(Claude)의 키가 없으면 다른 회사 키가 있어도 오프라인
    useSettings.getState().set({ aiProvider: 'anthropic' });
    const none = await withFetch(
      () => {
        throw new Error('부르면 안 됨');
      },
      () => requestRecommendation({ input }),
    );
    assert.equal(none.fallbackCode, 'NO_KEY');
  } finally {
    await deleteAiKey('gemini');
    await deleteAiKey('openai');
    useSettings.setState({ ...SETTINGS_DEFAULTS, aiModels: {}, aiKeyHints: {}, lastDevices: {} });
  }
});

// ───────────────────────── 키 확인 ─────────────────────────

test('checkAiKey: OpenAI 모델 목록으로 확인(유료 안내), 모델 없음·401·403·HTML 응답', async () => {
  const models = { object: 'list', data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-terra' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4o-mini-tts' }, { id: 'dall-e-3' }] };
  const ok = await withFetch(
    () => json(models),
    async (calls) => {
      const r = await checkAiKey('openai', FAKE_KEY);
      assert.equal(calls[0].url, 'https://api.openai.com/v1/models');
      assert.equal(calls[0].method, 'GET');
      assert.equal(calls[0].headers.authorization, `Bearer ${FAKE_KEY}`);
      return r;
    },
  );
  assert.equal(ok.code, 'OK');
  assert.deepEqual(
    ok.models.map((m) => m.id),
    ['gpt-6-luna', 'gpt-6.1-terra'],
    '레시피에 못 쓰는 모델(임베딩·음성·이미지)은 뺌',
  );
  assert.match(ok.message, /크레딧이 없으면/);
  const miss = await withFetch(() => json(models), () => checkAiKey('openai', FAKE_KEY, 'gpt-9'));
  assert.equal(miss.code, 'MODEL_MISSING');
  const bad = await withFetch(() => json({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }, 401), () => checkAiKey('openai', FAKE_KEY));
  assert.equal(bad.code, 'INVALID_KEY');
  const perm = await withFetch(() => json({ error: { type: 'permission_error' } }, 403), () => checkAiKey('anthropic', FAKE_KEY));
  assert.equal(perm.code, 'PERMISSION');
  assert.match(perm.message, /Claude Console/);
  const html = await withFetch(() => new Response('<html>login</html>', { status: 200 }), () => checkAiKey('groq', FAKE_KEY));
  assert.equal(html.code, 'NETWORK');
  assert.match(html.message, /다른 페이지가 응답/);
  const quota = await withFetch(() => json({ error: { message: 'Insufficient Balance' } }, 402), () => checkAiKey('deepseek', FAKE_KEY));
  assert.equal(quota.code, 'QUOTA');
});

test('checkAiKey: OpenRouter 는 /key 로 키 확인 뒤 모델 목록(무료·추천만), Claude 는 x-api-key, Groq 무료는 크레딧 안내 없음', async () => {
  const r = await withFetch(
    (c) =>
      c.url.endsWith('/key')
        ? json({ data: { label: 'x', is_free_tier: true } })
        : json({ data: [{ id: 'openrouter/free' }, { id: 'meta/llama-9:free' }, { id: 'openai/gpt-6-luna' }, { id: 'some/paid-model' }] }),
    async (calls) => {
      const res = await checkAiKey('openrouter', FAKE_KEY);
      assert.deepEqual(
        calls.map((c) => c.url),
        ['https://openrouter.ai/api/v1/key', 'https://openrouter.ai/api/v1/models'],
      );
      return res;
    },
  );
  assert.equal(r.code, 'OK');
  assert.deepEqual(r.models.map((m) => m.id).sort(), ['meta/llama-9:free', 'openai/gpt-6-luna', 'openrouter/free']);
  const orBad = await withFetch(() => json({ error: { code: 401, message: 'No auth credentials found' } }, 401), () => checkAiKey('openrouter', FAKE_KEY));
  assert.equal(orBad.code, 'INVALID_KEY');
  const claude = await withFetch(
    () => json({ data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }, { id: 'claude-sonnet-5-5' }], has_more: false }),
    async (calls) => {
      const res = await checkAiKey('anthropic', FAKE_KEY);
      assert.equal(calls[0].url, 'https://api.anthropic.com/v1/models?limit=100');
      assert.equal(calls[0].headers['x-api-key'], FAKE_KEY);
      return res;
    },
  );
  assert.equal(claude.code, 'OK');
  assert.equal(claude.models[0].id, 'claude-haiku-5-5');
  const groq = await withFetch(() => json({ data: [{ id: 'openai/gpt-oss-120b', active: true }, { id: 'whisper-large-v3' }, { id: 'old', active: false }] }), () => checkAiKey('groq', FAKE_KEY));
  assert.equal(groq.code, 'OK');
  assert.ok(!/크레딧이 없으면/.test(groq.message), '무료 회사는 크레딧 안내 없음');
  assert.deepEqual(groq.models.map((m) => m.id), ['openai/gpt-oss-120b']);
});

test('filterProviderModels: 추천 모델이 먼저', () => {
  const p = providerOf('xai');
  const list = filterProviderModels(p, { data: [{ id: 'grok-2' }, { id: 'grok-4.7' }, { id: 'grok-imagine-image' }, { id: 'grok-4.3' }] });
  assert.deepEqual(list.map((m) => m.id), ['grok-4.3', 'grok-4.7', 'grok-2']);
});

// ───────────────────────── 설정·키 저장 ─────────────────────────

test('sanitizeSettings: v3.0 저장값(aiMode gemini·geminiModel·geminiKeyHint) → v3.1 (ai·aiModels.gemini·aiKeyHints.gemini), 모르는 회사는 버림', () => {
  const s = sanitizeSettings({ aiMode: 'gemini', geminiModel: 'gemini-2.5-flash', geminiKeyHint: 'abcd', demoMode: false });
  assert.equal(s.aiMode, 'ai');
  assert.equal(s.aiProvider, 'gemini');
  assert.deepEqual(s.aiModels, { gemini: 'gemini-2.5-flash' });
  assert.deepEqual(s.aiKeyHints, { gemini: 'abcd' });
  assert.equal(s.demoMode, false);
  const t = sanitizeSettings({ aiMode: 'ai', aiProvider: 'anthropic', aiModels: { anthropic: ' claude-sonnet-5-5 ', bogus: 'x' }, aiKeyHints: { openai: '9999', nope: '1' } });
  assert.equal(t.aiProvider, 'anthropic');
  assert.deepEqual(t.aiModels, { anthropic: 'claude-sonnet-5-5' });
  assert.deepEqual(t.aiKeyHints, { openai: '9999' });
  assert.equal(activeModel(t), 'claude-sonnet-5-5');
  assert.equal(activeKeyHint(t), null, '고른 회사(Claude)의 키는 없음');
  assert.equal(activeModel({ aiProvider: 'deepseek', aiModels: {} }), 'deepseek-flash');
  assert.equal(sanitizeSettings({ aiProvider: 'skynet' }).aiProvider, 'gemini');
});

test('설정 저장 버전은 1 그대로 — v3.0 이 저장한 설정(version 1)을 v3.1 이 읽어도 지워지지 않고 옮겨짐', async () => {
  kv.setItem(
    STORAGE_KEYS.settings,
    JSON.stringify({ state: { aiMode: 'gemini', geminiModel: 'gemini-2.5-pro', geminiKeyHint: 'wxyz', demoMode: false, adultVerifiedAt: 123, notifyAsked: true }, version: 1 }),
  );
  await useSettings.persist.rehydrate();
  const st = useSettings.getState();
  assert.equal(st.demoMode, false);
  assert.equal(st.adultVerifiedAt, 123);
  assert.equal(st.notifyAsked, true);
  assert.equal(st.aiMode, 'ai');
  assert.deepEqual(st.aiModels, { gemini: 'gemini-2.5-pro' });
  assert.deepEqual(st.aiKeyHints, { gemini: 'wxyz' });
  assert.equal(useSettings.persist.getOptions().version, 1);
  kv.removeItem(STORAGE_KEYS.settings);
  useSettings.setState({ ...SETTINGS_DEFAULTS, aiModels: {}, aiKeyHints: {}, lastDevices: {} });
});

test('secrets: 회사마다 따로 저장(sb.secret.<회사>Key, Gemini 는 예전 이름), 알림에 회사, 힌트 맞추기', async () => {
  assert.equal(secretNameFor('gemini'), 'sb.secret.geminiKey');
  assert.equal(secretNameFor('openai'), 'sb.secret.openaiKey');
  const seen: [string | null, boolean][] = [];
  const off = onAiKeyChange((p, has) => seen.push([p, has]));
  try {
    await setAiKey('openai', ` ${FAKE_KEY} `);
    await setAiKey('anthropic', 'claude-key-not-real-3333');
    assert.equal(kv.getItem('sb.secret.openaiKey'), FAKE_KEY);
    assert.equal(await getAiKey('anthropic'), 'claude-key-not-real-3333');
    assert.equal(await getAiKey('gemini'), null, '다른 회사 키와 섞이지 않음');
    await clearAiKey('openai');
    assert.deepEqual(seen, [
      ['openai', true],
      ['anthropic', true],
      ['openai', false],
    ]);
    useSettings.getState().set({ aiKeyHints: { openai: 'zzzz' } });
    await syncAiKeyHints();
    assert.deepEqual(useSettings.getState().aiKeyHints, { anthropic: '3333' }, '저장소의 실제 키에 맞춤');
  } finally {
    off();
    await clearAiKey('anthropic');
    await clearAiKey('openai');
    useSettings.setState({ ...SETTINGS_DEFAULTS, aiModels: {}, aiKeyHints: {}, lastDevices: {} });
  }
});
