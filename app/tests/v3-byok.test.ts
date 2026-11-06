/// <reference types="node" />
/**
 * v3.0 사용자 본인 Gemini 키(BYOK) 테스트 (WEBAPP_DESIGN §4) — 실제 Gemini 호출 없음(가짜 fetch만)
 *  - 개발용 테스트 키(devKey): 개발 서버(DEV)가 아니면 늘 undefined, 배포 빌드에서 지워지는 형태(import.meta.env.DEV)
 *  - 모델 목록(listModels): generateContent 를 지원하는 gemini 텍스트 모델만, 쪽 나눔, 키는 헤더로만
 *  - [키 확인] 오류 분류: 400·401·403(키 오류/권한 없음)·429·402(한도·크레딧)·연결 실패·시간 초과
 *  - 실제 AI 방식: 키가 없으면 오프라인 (effectiveAiMode·generateRecipe NO_KEY·flow.requestRecommendation)
 *  - 키 저장(secrets)·설정 힌트(마지막 4자리)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { checkGeminiKey, filterGeminiModels, keyCheckCodeFor, keyHint, listModels } from '../src/lib/ai/gemini';
import { effectiveAiMode } from '../src/lib/ai/mode';
import { DEFAULT_GEMINI_MODEL } from '../src/lib/ai/prompt';
import { classifyGeminiError, generateRecipe, NO_KEY_TEXT } from '../src/lib/ai/recommend';
import { fallbackToast, requestRecommendation } from '../src/lib/flow';
import { defaultSlots } from '../src/lib/presets';
import type { UserInput } from '../src/lib/types';
import { getDevGeminiKey, hasDevGeminiKey, pickDevKey } from '../src/platform/devKey';
import { clearGeminiKey, GEMINI_KEY_STORAGE, getGeminiKey, onGeminiKeyChange, registerSecretBackend, setGeminiKey } from '../src/platform/secrets';
import { kv } from '../src/platform/storage';
import { deleteGeminiKey, saveGeminiKey, SETTINGS_DEFAULTS, syncGeminiKeyHint, useSettings } from '../src/store/settings';

const GEMINI_PREFIX = 'https://generativelanguage.googleapis.com/';
/** 실제 키처럼 보이지 않는 가짜 키 (검사 규칙 AQ./AIza 모양이 아님) */
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

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/** fetch 를 가짜로 바꿔 실행 — handler 가 응답을 만듦. Google 주소가 아니면 오류 */
async function withFakeFetch<T>(handler: (c: Call) => Response | Promise<Response>, fn: (calls: Call[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith(GEMINI_PREFIX)) throw new TypeError(`가짜 fetch: 정해지지 않은 주소(${u})`);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const c: Call = { url: u, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const gErr = (status: number, message: string, extra: Record<string, unknown> = {}) => json({ error: { code: status, message, ...extra } }, status);

const MODELS_BODY = {
  models: [
    { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent', 'countTokens'], inputTokenLimit: 1048576 },
    { name: 'models/gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-embedding-001', displayName: 'Gemini Embedding', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-2.5-flash-image', displayName: 'Nano Banana', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-preview-tts', displayName: 'TTS', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.0-flash-live-001', displayName: 'Live', supportedGenerationMethods: ['bidiGenerateContent'] },
    { name: 'models/gemini-2.5-flash-native-audio-dialog', displayName: 'Audio', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemma-3-27b-it', displayName: 'Gemma 3', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/imagen-4.0-generate-001', displayName: 'Imagen', supportedGenerationMethods: ['predict'] },
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash', displayName: '중복', supportedGenerationMethods: ['generateContent'] },
    { name: 42 },
    null,
  ],
};

// ───────────────────────── 개발용 테스트 키 ─────────────────────────

test('개발용 테스트 키: 개발 서버(DEV)가 아니면 undefined — Node(테스트)·배포 빌드 모두', () => {
  assert.equal(getDevGeminiKey(), undefined, 'Node 에는 import.meta.env 가 없음 → undefined');
  assert.equal(hasDevGeminiKey(), false);
  assert.equal(pickDevKey(undefined), undefined);
  assert.equal(pickDevKey(null), undefined);
  assert.equal(pickDevKey({ DEV: false, VITE_DEV_GEMINI_KEY: FAKE_KEY }), undefined, 'PROD 빌드');
  assert.equal(pickDevKey({ VITE_DEV_GEMINI_KEY: FAKE_KEY }), undefined, 'DEV 값이 없으면 개발 서버가 아님');
  assert.equal(pickDevKey({ DEV: true }), undefined, '키 없음');
  assert.equal(pickDevKey({ DEV: true, VITE_DEV_GEMINI_KEY: '   ' }), undefined, '빈 키');
  assert.equal(pickDevKey({ DEV: true, VITE_DEV_GEMINI_KEY: `  ${FAKE_KEY} ` }), FAKE_KEY, '개발 서버에서만 (앞뒤 공백 제거)');
});

test('개발용 테스트 키: 배포 빌드에서 지워지도록 import.meta.env.DEV 로 감싼 형태 그대로 (코드 모양 검사)', () => {
  const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'platform', 'devKey.ts'), 'utf8');
  const body = src.slice(src.indexOf('export function getDevGeminiKey'));
  assert.match(body, /if \(!import\.meta\.env\.DEV\) return undefined;/, 'DEV 가 아니면 바로 끝남 (Vite 가 false 로 바꿔 아래를 지움)');
  assert.ok(body.indexOf('!import.meta.env.DEV') < body.indexOf('VITE_DEV_GEMINI_KEY'), '키를 읽는 줄은 DEV 확인 뒤에만');
});

// ───────────────────────── 모델 목록 ─────────────────────────

test('모델 목록 거르기: generateContent 를 지원하는 gemini 텍스트 모델만 (임베딩·이미지·음성·실시간·gemma·imagen 제외), 기본 모델 먼저, 중복 없음', () => {
  const ms = filterGeminiModels(MODELS_BODY);
  assert.deepEqual(
    ms.map((m) => m.id),
    [DEFAULT_GEMINI_MODEL, 'gemini-2.5-pro', 'gemini-2.5-flash'],
  );
  assert.equal(ms[1].displayName, 'Gemini 2.5 Pro');
  assert.equal(ms[1].inputTokenLimit, 1048576);
  assert.deepEqual(filterGeminiModels(null), []);
  assert.deepEqual(filterGeminiModels({ models: 'x' }), []);
});

test('listModels: GET /v1beta/models, 키는 x-goog-api-key 헤더로만(주소에 없음), 다음 쪽(nextPageToken)까지 (가짜 fetch)', async () => {
  const page2 = { models: [{ name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent'] }] };
  const out = await withFakeFetch(
    (c) => (c.url.includes('pageToken=') ? json(page2) : json({ ...MODELS_BODY, nextPageToken: 'p2' })),
    async (calls) => {
      const ms = await listModels(`  ${FAKE_KEY}  `);
      assert.equal(calls.length, 2);
      for (const c of calls) {
        assert.equal(c.method, 'GET');
        assert.ok(c.url.startsWith(`${GEMINI_PREFIX}v1beta/models?`), c.url);
        assert.equal(c.headers['x-goog-api-key'], FAKE_KEY, '앞뒤 공백 없이 헤더로');
        assert.ok(!c.url.includes(FAKE_KEY), '키가 주소에 들어가지 않음');
      }
      assert.match(calls[1].url, /pageToken=p2/);
      return ms;
    },
  );
  assert.deepEqual(
    out.map((m) => m.id),
    [DEFAULT_GEMINI_MODEL, 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  );
  await assert.rejects(listModels('   '), (e: any) => e.code === 'AUTH', '빈 키는 호출하지 않음');
});

// ───────────────────────── [키 확인] 오류 분류 ─────────────────────────

test('[키 확인] 오류 분류: 400·401·403 키 오류 → INVALID_KEY / 403 권한 → PERMISSION / 429·402 → QUOTA / 연결 실패·시간 초과 → NETWORK', () => {
  const e = (status: number, message: string, extra: Record<string, unknown> = {}) => ({ status, data: { error: { code: status, message, ...extra } } });
  const invalid400 = e(400, 'API key not valid. Please pass a valid API key.', { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] });
  const cases: { r: any; gemini: string; key: string }[] = [
    { r: invalid400, gemini: 'AUTH', key: 'INVALID_KEY' },
    { r: e(401, 'Request had invalid authentication credentials.', { status: 'UNAUTHENTICATED' }), gemini: 'AUTH', key: 'INVALID_KEY' },
    { r: e(403, 'API key not valid', { details: [{ reason: 'API_KEY_INVALID' }] }), gemini: 'AUTH', key: 'INVALID_KEY' },
    { r: e(403, 'Generative Language API has not been used in project 123 before or it is disabled.', { status: 'PERMISSION_DENIED' }), gemini: 'AUTH', key: 'PERMISSION' },
    { r: e(403, 'Permission denied', { status: 'PERMISSION_DENIED' }), gemini: 'AUTH', key: 'PERMISSION' },
    { r: e(429, 'You exceeded your current quota, please check your plan and billing details.', { status: 'RESOURCE_EXHAUSTED' }), gemini: 'RATE_LIMIT', key: 'QUOTA' },
    { r: e(429, 'Your prepayment credits are depleted.'), gemini: 'BILLING', key: 'QUOTA' },
    { r: e(402, 'Payment required'), gemini: 'BILLING', key: 'QUOTA' },
    { r: e(400, 'Invalid JSON payload received.'), gemini: 'BAD_REQUEST', key: 'ERROR' },
    { r: e(500, 'Internal error'), gemini: 'UPSTREAM', key: 'ERROR' },
    { r: { status: 0, error: 'NETWORK' }, gemini: 'NETWORK', key: 'NETWORK' },
    { r: { status: 0, error: 'TIMEOUT' }, gemini: 'TIMEOUT', key: 'NETWORK' },
  ];
  for (const c of cases) {
    assert.equal(classifyGeminiError(c.r), c.gemini, `classify ${JSON.stringify(c.r)}`);
    assert.equal(keyCheckCodeFor(c.r), c.key, `key ${JSON.stringify(c.r)}`);
  }
});

test('[키 확인] checkGeminiKey: 성공(모델 있음)·모델 없음·400·403·429·연결 실패·시간 초과 → 결과 종류와 해요체 안내 (가짜 fetch)', async () => {
  const run = (handler: (c: Call) => Response | Promise<Response>, model = DEFAULT_GEMINI_MODEL, timeoutMs?: number) =>
    withFakeFetch(handler, () => checkGeminiKey(FAKE_KEY, model, timeoutMs ? { timeoutMs } : {}));
  const ok = await run(() => json(MODELS_BODY));
  assert.equal(ok.ok, true);
  assert.equal(ok.code, 'OK');
  assert.equal(ok.models.length, 3);
  assert.match(ok.message, /키가 확인됐어요/);
  const missing = await run(() => json(MODELS_BODY), 'gemini-9-ultra');
  assert.equal(missing.ok, true, '키 자체는 정상');
  assert.equal(missing.code, 'MODEL_MISSING');
  assert.match(missing.message, /gemini-9-ultra/);
  const bad = await run(() => gErr(400, 'API key not valid. Please pass a valid API key.', { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] }));
  assert.deepEqual([bad.ok, bad.code, bad.models.length], [false, 'INVALID_KEY', 0]);
  assert.match(bad.message, /API 키가 올바르지 않아요/);
  const perm = await run(() => gErr(403, 'Method doesn’t allow unregistered callers.', { status: 'PERMISSION_DENIED' }));
  assert.equal(perm.code, 'PERMISSION');
  assert.match(perm.message, /권한이 없어요/);
  const quota = await run(() => gErr(429, 'Resource has been exhausted (e.g. check quota).', { status: 'RESOURCE_EXHAUSTED' }));
  assert.equal(quota.code, 'QUOTA');
  assert.match(quota.message, /한도|크레딧/);
  const net = await run(() => {
    throw new TypeError('fetch failed');
  });
  assert.equal(net.code, 'NETWORK');
  assert.match(net.message, /인터넷/);
  const slow = await run(
    (c) =>
      new Promise<Response>((_r, rej) => {
        void c;
        setTimeout(() => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), 200);
      }),
    DEFAULT_GEMINI_MODEL,
    20,
  );
  assert.equal(slow.code, 'NETWORK', '시간 초과도 연결 문제로 안내');
  for (const r of [ok, missing, bad, perm, quota, net, slow]) assert.ok(!r.message.includes(FAKE_KEY), '안내에 키 값이 없음');
});

// ───────────────────────── 실제 AI 방식: 키가 없으면 오프라인 ─────────────────────────

test('effectiveAiMode: gemini 설정이어도 키가 없으면(null·빈 문자열·공백) offline, offline 설정은 늘 offline', () => {
  assert.equal(effectiveAiMode('gemini', null), 'offline');
  assert.equal(effectiveAiMode('gemini', undefined), 'offline');
  assert.equal(effectiveAiMode('gemini', ''), 'offline');
  assert.equal(effectiveAiMode('gemini', '   '), 'offline');
  assert.equal(effectiveAiMode('gemini', FAKE_KEY), 'gemini');
  assert.equal(effectiveAiMode('offline', FAKE_KEY), 'offline');
  assert.equal(SETTINGS_DEFAULTS.aiMode, 'gemini', '기본 설정은 gemini');
  assert.equal(SETTINGS_DEFAULTS.geminiModel, 'gemini-3.6-flash');
  assert.equal(effectiveAiMode(SETTINGS_DEFAULTS.aiMode, SETTINGS_DEFAULTS.geminiKeyHint), 'offline', '처음 설치(키 없음) → 오프라인');
});

test('generateRecipe: gemini 인데 키가 없으면 Gemini 를 부르지 않고 오프라인 추천 + fallbackCode NO_KEY (기존 안내 방식: fallbackReason)', async () => {
  const r = await withFakeFetch(
    () => {
      throw new Error('부르면 안 됨');
    },
    async (calls) => {
      const res = await generateRecipe({ input, slots: defaultSlots(), aiMode: 'gemini', geminiKey: null });
      assert.equal(calls.length, 0, 'Gemini 호출 없음');
      return res;
    },
  );
  assert.equal(r.source, 'offline');
  assert.equal(r.fallbackCode, 'NO_KEY');
  assert.equal(r.fallbackReason, NO_KEY_TEXT);
  assert.ok(r.recipe && r.recipe.totalMl === 200);
  // 토스트 문구: 키 없음은 안내(info), Gemini 오류는 경고(warning) + 분류 문구
  assert.deepEqual(fallbackToast(r)?.kind, 'info');
  assert.match(fallbackToast(r)!.message, /AI 키가 없어 오프라인 추천/);
  assert.match(fallbackToast({ source: 'offline', fallbackReason: 'x', fallbackCode: 'RATE_LIMIT' })!.message, /사용량 한도/);
  assert.equal(fallbackToast({ source: 'offline', fallbackReason: 'x', timedOut: true, fallbackCode: 'TIMEOUT' })!.message, 'AI 응답이 너무 늦어 오프라인 추천을 보여드려요.');
  assert.equal(fallbackToast({ source: 'direct' }), null);
  assert.equal(fallbackToast({ source: 'offline' }), null, '오프라인 설정(이유 없음)은 토스트 없음');
  // offline 설정은 fallbackReason·fallbackCode 없음
  const off = await generateRecipe({ input, slots: defaultSlots(), aiMode: 'offline', geminiKey: FAKE_KEY });
  assert.equal(off.fallbackReason, undefined);
  assert.equal(off.fallbackCode, undefined);
});

test('generateRecipe: Gemini 오류(429)도 같은 분류로 안내하고 오프라인 추천으로 이어감 (가짜 fetch)', async () => {
  const r = await withFakeFetch(
    () => gErr(429, 'You exceeded your current quota', { status: 'RESOURCE_EXHAUSTED' }),
    () => generateRecipe({ input, slots: defaultSlots(), aiMode: 'gemini', geminiKey: FAKE_KEY }),
  );
  assert.equal(r.source, 'offline');
  assert.equal(r.fallbackCode, 'RATE_LIMIT');
  assert.match(r.fallbackReason ?? '', /Gemini 오류\(RATE_LIMIT\): 사용량 한도/);
  assert.ok(!(r.fallbackReason ?? '').includes(FAKE_KEY));
});

test('flow.requestRecommendation: 저장된 키·모델로 Gemini 호출(키는 헤더), 키를 지우면 오프라인 (설정 힌트는 마지막 4자리)', async () => {
  useSettings.setState({ ...SETTINGS_DEFAULTS, lastDevices: {} });
  await deleteGeminiKey();
  // 키 없음 → 오프라인 (fetch 호출 없음)
  const noKey = await withFakeFetch(
    () => {
      throw new Error('부르면 안 됨');
    },
    () => requestRecommendation({ input }),
  );
  assert.equal(noKey.source, 'offline');
  assert.equal(noKey.fallbackCode, 'NO_KEY');
  // 키 저장 → 힌트 = 마지막 4자리, Gemini 호출
  await saveGeminiKey(`  ${FAKE_KEY}  `);
  assert.equal(await getGeminiKey(), FAKE_KEY);
  assert.equal(useSettings.getState().geminiKeyHint, 'wxyz');
  assert.equal(effectiveAiMode(useSettings.getState().aiMode, useSettings.getState().geminiKeyHint), 'gemini');
  useSettings.getState().set({ geminiModel: 'gemini-2.5-flash' });
  const recipe = { name: '테스트 에이드', ingredients: [{ pump: 1, name: '사이다', ml: 150 }, { pump: 2, name: '오렌지주스', ml: 50 }] };
  const viaGemini = await withFakeFetch(
    () => json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ recipe, explore: [] }) }] } }] }),
    async (calls) => {
      const r = await requestRecommendation({ input });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, 'POST');
      assert.ok(calls[0].url.startsWith(`${GEMINI_PREFIX}v1beta/models/gemini-2.5-flash:generateContent`), calls[0].url);
      assert.equal(calls[0].headers['x-goog-api-key'], FAKE_KEY);
      assert.ok(!calls[0].url.includes(FAKE_KEY));
      return r;
    },
  );
  assert.equal(viaGemini.source, 'direct');
  assert.equal(viaGemini.model, 'gemini-2.5-flash');
  // 오프라인 설정이면 키가 있어도 Gemini 를 부르지 않음
  useSettings.getState().set({ aiMode: 'offline' });
  const off = await withFakeFetch(
    () => {
      throw new Error('부르면 안 됨');
    },
    () => requestRecommendation({ input }),
  );
  assert.equal(off.source, 'offline');
  assert.equal(off.fallbackReason, undefined);
  // 키 삭제 → 힌트 지움
  await deleteGeminiKey();
  assert.equal(await getGeminiKey(), null);
  assert.equal(useSettings.getState().geminiKeyHint, null);
  useSettings.setState({ ...SETTINGS_DEFAULTS, lastDevices: {} });
});

test('secrets: localStorage 키 이름 sb.secret.geminiKey, 앞뒤 공백 제거, 바뀜 알림, 저장소 교체(Capacitor Preferences 자리), 힌트 맞추기', async () => {
  assert.equal(GEMINI_KEY_STORAGE, 'sb.secret.geminiKey');
  const seen: boolean[] = [];
  const off = onGeminiKeyChange((v) => seen.push(v));
  await setGeminiKey(`\n${FAKE_KEY}\t`);
  assert.equal(kv.getItem(GEMINI_KEY_STORAGE), FAKE_KEY);
  await setGeminiKey('   ');
  assert.equal(await getGeminiKey(), null, '빈 값 저장 = 삭제');
  await setGeminiKey(FAKE_KEY);
  await clearGeminiKey();
  assert.deepEqual(seen, [true, false, true, false]);
  off();
  // 다른 저장소(예: Capacitor Preferences)로 교체
  const mem = new Map<string, string>();
  registerSecretBackend({
    get: async (k) => mem.get(k) ?? null,
    set: async (k, v) => void mem.set(k, v),
    remove: async (k) => void mem.delete(k),
  });
  try {
    await setGeminiKey(FAKE_KEY);
    assert.equal(mem.get(GEMINI_KEY_STORAGE), FAKE_KEY);
    assert.equal(kv.getItem(GEMINI_KEY_STORAGE), null, 'localStorage 에는 없음');
    useSettings.getState().set({ geminiKeyHint: null });
    await syncGeminiKeyHint();
    assert.equal(useSettings.getState().geminiKeyHint, 'wxyz', '시작 시 힌트를 실제 키에 맞춤');
    await clearGeminiKey();
    await syncGeminiKeyHint();
    assert.equal(useSettings.getState().geminiKeyHint, null);
  } finally {
    registerSecretBackend(null);
  }
  assert.equal(keyHint('short'), '••••', '짧은 값은 가림');
  assert.equal(keyHint(null), null);
});
