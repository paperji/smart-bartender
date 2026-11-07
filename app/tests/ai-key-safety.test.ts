/// <reference types="node" />
/**
 * Gemini 키 안전·키 확인 회귀 테스트 (리뷰 AI-2·AI-3·AI-4·AI-5, PKG-3) — 실제 Gemini 호출 없음(가짜 fetch만)
 *  - AI-2: 보이지 않는 문자(U+200B)·한글이 섞인 키 → 형식 검사에서 걸러지고, 키 확인·레시피 호출도 보내지 않고 "키 오류"(예전: 인터넷 연결 없음)
 *  - AI-3: 정지된 키의 Google 문구 "Consumer 'api_key:<키>' has been suspended." → 화면 안내·fallbackReason·오류 본문에서 키를 가림
 *  - AI-4: 다른 창에서 지운 키를 이 창이 메모리에서 계속 돌려주지 않음 + 다른 창의 저장·삭제를 알림(storage 이벤트)
 *  - AI-5: 200 인데 모델 목록이 아닌 응답(HTML·빈 응답·다른 JSON) → [키 확인] 성공으로 보지 않음
 *  - PKG-3: 설정 > 앱 정보 의 [앱 설치] 버튼·안내가 platform/install.ts 의 usePwaInstall·installHint 를 씀
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { hasInvalidKeyChars, KEY_FORMAT_TEXT, KEY_MASK, keyFormatProblem, redactKey, redactKeyDeep } from '../src/lib/ai/apiKey';
import { BAD_MODELS_RESPONSE_TEXT, checkGeminiKey, GeminiListError, listModels, NOT_GEMINI_RESPONSE_TEXT } from '../src/lib/ai/gemini';
import { DEFAULT_GEMINI_MODEL } from '../src/lib/ai/prompt';
import { callGemini, buildRequest, generateRecipe, GEMINI_ERROR_TEXT } from '../src/lib/ai/recommend';
import { defaultSlots } from '../src/lib/presets';
import type { UserInput } from '../src/lib/types';
import { clearGeminiKey, GEMINI_KEY_STORAGE, getGeminiKey, onGeminiKeyChange, setGeminiKey } from '../src/platform/secrets';
import { kv } from '../src/platform/storage';
import { fallbackNotice as exploreFallbackNotice } from '../src/screens/explore/exploreNotices';
import { fallbackNotice as recipeFallbackNotice } from '../src/screens/recipe/recipeLogic';
import { installOutcomeToast } from '../src/screens/settings/installRow';
import { saveGeminiKey, syncGeminiKeyHint, useSettings } from '../src/store/settings';

const GEMINI_PREFIX = 'https://generativelanguage.googleapis.com/';
/** 실제 키처럼 보이지 않는 가짜 키 */
const FAKE_KEY = 'test-key-not-real-0000-wxyz';
/** Google 키 모양(AIza + 35자)의 가짜 키 — 소스에 키 모양 글자가 남지 않게 실행 중에 만듦 */
const AIZA_SHAPED = ['AI', 'za', 'FAKEfakeFAKEfake', 'FAKEfakeFAKEfake', 'x00'].join('');

const input: UserInput = {
  moods: ['피곤함'],
  taste: { sweet: 3, sour: 2, bitter: 0, fizzy: 3 },
  strength: 'none',
  weather: null,
  situation: '',
  preference: '',
  cupMl: 200,
};

/**
 * 가짜 fetch — 진짜 fetch 처럼 Request 를 먼저 만들어 헤더를 검사함(ByteString 이 아니면 TypeError).
 * Google 주소가 아니면 오류. 응답은 handler 가 만듦
 */
async function withFakeFetch<T>(handler: (url: string) => Response | Promise<Response>, fn: (calls: string[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith(GEMINI_PREFIX)) throw new TypeError(`가짜 fetch: 정해지지 않은 주소(${u})`);
    new Request(u, { method: init?.method, headers: init?.headers }); // 헤더 값 검사 (진짜 fetch 와 같은 TypeError)
    calls.push(u);
    return handler(u);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const MODELS = { models: [{ name: `models/${DEFAULT_GEMINI_MODEL}`, displayName: 'Default', supportedGenerationMethods: ['generateContent'] }] };

// ───────────────────────── AI-2: 헤더에 쓸 수 없는 문자가 든 키 ─────────────────────────

const ZWSP_KEY = `${FAKE_KEY.slice(0, 10)}​${FAKE_KEY.slice(10)}`;
const HANGUL_KEY = `${FAKE_KEY.slice(0, 10)}ㄱ${FAKE_KEY.slice(10)}`;

test('AI-2 형식 검사: 보이지 않는 문자(U+200B·U+FEFF 등)·한글이 섞이면 저장·확인 전에 안내, 정상 키·앞뒤 공백은 통과', () => {
  assert.equal(/\s/.test(ZWSP_KEY), false, '전제: U+200B 는 \\s 에 걸리지 않음');
  assert.equal(keyFormatProblem(ZWSP_KEY), KEY_FORMAT_TEXT.chars);
  assert.equal(keyFormatProblem(HANGUL_KEY), KEY_FORMAT_TEXT.chars);
  assert.equal(keyFormatProblem(`${FAKE_KEY}⁠`), KEY_FORMAT_TEXT.chars, '단어 잇기(U+2060)');
  assert.equal(keyFormatProblem(`${FAKE_KEY}é`), KEY_FORMAT_TEXT.chars, 'Latin-1 이어도 키 문자가 아님');
  assert.equal(keyFormatProblem(`${FAKE_KEY.slice(0, 5)} ${FAKE_KEY.slice(5)}`), KEY_FORMAT_TEXT.space, '중간 빈칸은 빈칸 안내');
  assert.equal(keyFormatProblem(`${FAKE_KEY.slice(0, 5)} ${FAKE_KEY.slice(5)}`), KEY_FORMAT_TEXT.space, 'NBSP 도 빈칸');
  assert.equal(keyFormatProblem('short-key'), KEY_FORMAT_TEXT.short);
  assert.equal(keyFormatProblem(FAKE_KEY), null);
  assert.equal(keyFormatProblem(`  ${FAKE_KEY}\n`), null, '앞뒤 공백은 잘라서 봄');
  assert.equal(keyFormatProblem(AIZA_SHAPED), null);
  assert.equal(hasInvalidKeyChars(ZWSP_KEY), true);
  assert.equal(hasInvalidKeyChars(` ${FAKE_KEY} `), false);
  assert.ok(!/인터넷|연결/.test(KEY_FORMAT_TEXT.chars), '연결 문제로 안내하지 않음');
});

test('AI-2 전제 확인: 이런 키를 헤더에 넣으면 요청을 만들기 전에 TypeError (예전엔 이것을 NETWORK 로 분류)', () => {
  assert.throws(() => new Request(GEMINI_PREFIX, { headers: { 'x-goog-api-key': ZWSP_KEY } }), TypeError);
  assert.throws(() => new Request(GEMINI_PREFIX, { headers: { 'x-goog-api-key': HANGUL_KEY } }), TypeError);
});

test('AI-2 [키 확인]: 보이지 않는 문자·한글이 든 키는 Google 에 보내지 않고 INVALID_KEY + 다시 복사 안내 (인터넷 연결 없음 아님)', async () => {
  for (const k of [ZWSP_KEY, HANGUL_KEY]) {
    const r = await withFakeFetch(
      () => json(MODELS),
      async (calls) => {
        const res = await checkGeminiKey(k);
        assert.equal(calls.length, 0, '네트워크 요청 없음');
        return res;
      },
    );
    assert.deepEqual([r.ok, r.code, r.errorCode], [false, 'INVALID_KEY', 'AUTH']);
    assert.equal(r.message, KEY_FORMAT_TEXT.chars);
    assert.ok(!r.message.includes(FAKE_KEY));
    await assert.rejects(listModels(k), (e: unknown) => e instanceof GeminiListError && e.code === 'AUTH' && e.status === 0);
  }
});

test('AI-2 레시피: 저장된 키에 보이지 않는 문자가 있으면 Gemini 를 부르지 않고 AUTH(키 확인 안내) — NETWORK·"인터넷 또는 AI 서버 문제" 아님', async () => {
  const r = await withFakeFetch(
    () => json({}),
    async (calls) => {
      const res = await generateRecipe({ input, slots: defaultSlots(), aiMode: 'ai', aiKey: ZWSP_KEY });
      assert.equal(calls.length, 0, '네트워크 요청 없음');
      return res;
    },
  );
  assert.equal(r.source, 'offline');
  assert.equal(r.fallbackCode, 'AUTH');
  assert.ok(r.fallbackReason?.includes(GEMINI_ERROR_TEXT.AUTH));
  const n = recipeFallbackNotice(r);
  assert.ok(n, '레시피 화면 안내');
  assert.equal(n.kind, 'key', '설정에서 키 확인으로 안내');
  assert.ok(!/인터넷/.test(`${n.message} ${n.detail ?? ''}`), JSON.stringify(n));
  const e = exploreFallbackNotice({ source: r.source, fallbackReason: r.fallbackReason, fallbackCode: r.fallbackCode });
  assert.ok(e && e.settings && !/인터넷/.test(e.message), JSON.stringify(e));
  // callGemini 를 바로 불러도 같음
  await assert.rejects(callGemini(HANGUL_KEY, buildRequest(input, defaultSlots())), (err: any) => err?.code === 'AUTH');
});

// ───────────────────────── AI-3: Google 오류 문구 속 키 가리기 ─────────────────────────

const suspendedBody = (key: string) => ({
  error: {
    code: 403,
    message: `Permission denied: Consumer 'api_key:${key}' has been suspended.`,
    status: 'PERMISSION_DENIED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'CONSUMER_SUSPENDED', metadata: { consumer: `api_key:${key}` } }],
  },
});

test('AI-3 redactKey: 넘긴 키 값 + 키 모양(AIza…·AQ.…) + api_key:… + key=… 를 가림, 다른 글은 그대로', () => {
  assert.equal(redactKey(`Consumer 'api_key:${FAKE_KEY}' has been suspended.`, FAKE_KEY), `Consumer 'api_key:${KEY_MASK}' has been suspended.`);
  assert.equal(redactKey(`Consumer 'api_key:${FAKE_KEY}' has been suspended.`), `Consumer 'api_key:${KEY_MASK}' has been suspended.`, '키를 몰라도 api_key: 뒤는 가림');
  assert.equal(redactKey(`bad ${AIZA_SHAPED} here`), `bad ${KEY_MASK} here`);
  const aq = ['AQ', '.', 'Ab8RN6', 'fakeFAKEfake_123'].join('');
  assert.equal(redactKey(`x ${aq} y`), `x ${KEY_MASK} y`);
  assert.equal(redactKey('see https://x.test/v1?alt=json&key=abc123'), `see https://x.test/v1?alt=json&key=${KEY_MASK}`);
  assert.equal(redactKey('see the FAQ.documentation page'), 'see the FAQ.documentation page', 'FAQ. 같은 글은 그대로');
  const plain = 'API key not valid. Please pass a valid API key.';
  assert.equal(redactKey(plain, FAKE_KEY), plain);
  assert.equal(redactKey(`${FAKE_KEY}${FAKE_KEY}`, FAKE_KEY), `${KEY_MASK}${KEY_MASK}`);
  const deep = redactKeyDeep(suspendedBody(FAKE_KEY), FAKE_KEY);
  assert.ok(!JSON.stringify(deep).includes(FAKE_KEY));
  assert.equal(deep.error.details[0].reason, 'CONSUMER_SUSPENDED', '분류에 쓰는 다른 값은 그대로');
  assert.equal(deep.error.code, 403);
});

test('AI-3 레시피: 정지된 키 문구의 키 값이 fallbackReason·레시피 안내(detail)·탐색 안내에 나오지 않음 (가짜 fetch)', async () => {
  for (const key of [FAKE_KEY, AIZA_SHAPED]) {
    for (const mode of ['normal', 'explore'] as const) {
      const r = await withFakeFetch(
        () => json(suspendedBody(key), 403),
        () => generateRecipe({ input, slots: defaultSlots(), aiMode: 'ai', aiKey: key, mode }),
      );
      assert.equal(r.fallbackCode, 'AUTH');
      assert.ok(r.fallbackReason && !r.fallbackReason.includes(key), `${mode}: fallbackReason 에 키 없음`);
      assert.ok(r.fallbackReason.includes(`api_key:${KEY_MASK}`), r.fallbackReason);
      if (mode === 'normal') {
        const n = recipeFallbackNotice(r);
        assert.ok(n?.detail, '원문(가린 것)은 그대로 보여 줌');
        assert.ok(!n.detail.includes(key), n.detail);
        assert.match(n.detail, /has been suspe/);
      } else {
        const e = exploreFallbackNotice({ source: r.source, fallbackReason: r.fallbackReason, fallbackCode: r.fallbackCode });
        assert.ok(e && !e.message.includes(key));
      }
    }
  }
});

test('AI-3 [키 확인]: 정지된 키 → PERMISSION, 안내·오류 본문(data)·message 에 키 없음', async () => {
  const r = await withFakeFetch(() => json(suspendedBody(AIZA_SHAPED), 403), () => checkGeminiKey(AIZA_SHAPED));
  assert.deepEqual([r.ok, r.code], [false, 'PERMISSION']);
  assert.ok(!r.message.includes(AIZA_SHAPED));
  const err = await withFakeFetch(
    () => json(suspendedBody(AIZA_SHAPED), 403),
    () => listModels(AIZA_SHAPED).then(
      () => null,
      (e: unknown) => e,
    ),
  );
  assert.ok(err instanceof GeminiListError);
  assert.equal(err.code, 'AUTH');
  assert.ok(!err.message.includes(AIZA_SHAPED), err.message);
  assert.ok(!JSON.stringify(err.data).includes(AIZA_SHAPED), '오류 본문에도 키 없음');
});

// ───────────────────────── AI-5: 200 인데 모델 목록이 아님 ─────────────────────────

test('AI-5 [키 확인]: 200 HTML(와이파이 로그인·차단 페이지)·빈 응답 → 성공 아님(NETWORK + 다른 페이지가 응답 안내)', async () => {
  const html = () => new Response('<html><body>Wi-Fi login</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const empty = () => new Response('', { status: 200 });
  for (const h of [html, empty]) {
    const r = await withFakeFetch(h, () => checkGeminiKey(FAKE_KEY));
    assert.equal(r.ok, false, '키를 확인한 것이 아님 → [이 키 저장] 을 보이지 않음');
    assert.equal(r.code, 'NETWORK');
    assert.equal(r.message, NOT_GEMINI_RESPONSE_TEXT);
    assert.deepEqual(r.models, []);
    assert.ok(!/키는 정상/.test(r.message));
  }
});

test('AI-5 [키 확인]: 200 JSON 인데 models 배열이 없음({}·{models:"x"}·배열) → ERROR(확인하지 못했어요), 실제 목록이 오면 그대로', async () => {
  for (const body of [{}, { models: 'x' }, [1, 2]]) {
    const r = await withFakeFetch(() => json(body), () => checkGeminiKey(FAKE_KEY));
    assert.deepEqual([r.ok, r.code], [false, 'ERROR'], JSON.stringify(body));
    assert.equal(r.message, BAD_MODELS_RESPONSE_TEXT);
  }
  // 정상 목록 (기본 모델 있음) → OK, 빈 목록(진짜 응답) → 키는 정상·모델 없음
  const ok = await withFakeFetch(() => json(MODELS), () => checkGeminiKey(FAKE_KEY));
  assert.deepEqual([ok.ok, ok.code], [true, 'OK']);
  const none = await withFakeFetch(() => json({ models: [] }), () => checkGeminiKey(FAKE_KEY));
  assert.deepEqual([none.ok, none.code], [true, 'MODEL_MISSING']);
  // 둘째 쪽이 모델 목록이 아니면 거기까지만 (첫 쪽 결과는 씀)
  const paged = await withFakeFetch(
    (u) => (u.includes('pageToken=') ? json({}) : json({ ...MODELS, nextPageToken: 'p2' })),
    async (calls) => {
      const ms = await listModels(FAKE_KEY);
      assert.equal(calls.length, 2);
      return ms;
    },
  );
  assert.deepEqual(
    paged.map((m) => m.id),
    [DEFAULT_GEMINI_MODEL],
  );
});

// ───────────────────────── AI-4: 다른 창에서 지운 키 ─────────────────────────

/** 두 창이 같이 쓰는 가짜 localStorage */
function fakeLocalStorage() {
  const store = new Map<string, string>();
  let failWrites = false;
  let failReads = false;
  const ls = {
    getItem(k: string) {
      if (failReads) throw new Error('SecurityError');
      return store.has(k) ? (store.get(k) as string) : null;
    },
    setItem(k: string, v: string) {
      if (failWrites) throw new Error('QuotaExceededError');
      store.set(k, String(v));
    },
    removeItem(k: string) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
    key(i: number) {
      return Array.from(store.keys())[i] ?? null;
    },
    get length() {
      return store.size;
    },
  };
  return {
    store,
    ls,
    setFailWrites(v: boolean) {
      failWrites = v;
    },
    setFailReads(v: boolean) {
      failReads = v;
    },
  };
}

test('AI-4 kv: localStorage 가 정상이면 늘 localStorage 값을 따름 — 다른 창이 지우거나 바꾸면 이 창도 그대로 봄', async () => {
  const g = globalThis as any;
  const fake = fakeLocalStorage();
  const prev = g.localStorage;
  await clearGeminiKey(); // 이 창의 메모리 값 정리
  g.localStorage = fake.ls;
  try {
    await setGeminiKey(FAKE_KEY); // 이 창(A)에서 저장
    assert.equal(fake.store.get(GEMINI_KEY_STORAGE), FAKE_KEY);
    assert.equal(await getGeminiKey(), FAKE_KEY);
    fake.store.delete(GEMINI_KEY_STORAGE); // 다른 창(B)에서 삭제
    assert.equal(await getGeminiKey(), null, '지운 키를 계속 쓰지 않음 (예전: 메모리의 옛 키를 돌려줌)');
    fake.store.set(GEMINI_KEY_STORAGE, 'other-window-key-0000-abcd'); // 다른 창에서 새 키 저장
    assert.equal(await getGeminiKey(), 'other-window-key-0000-abcd');

    // 쓰기 실패(용량 초과·비공개 모드) → 이 창의 최신 값은 메모리로 (localStorage 의 옛 값보다 우선)
    fake.setFailWrites(true);
    kv.setItem('sb3.test.x', 'v1');
    assert.equal(kv.getItem('sb3.test.x'), 'v1', '메모리 대신 저장');
    fake.store.set('sb3.test.y', 'old');
    kv.setItem('sb3.test.y', 'new');
    assert.equal(kv.getItem('sb3.test.y'), 'new', '쓰지 못한 최신 값이 옛 값보다 우선');
    fake.setFailWrites(false);
    kv.setItem('sb3.test.y', 'saved');
    assert.equal(fake.store.get('sb3.test.y'), 'saved');
    fake.store.delete('sb3.test.y');
    assert.equal(kv.getItem('sb3.test.y'), null, '쓰기에 성공하면 메모리 값은 버리고 localStorage 를 따름');
    kv.removeItem('sb3.test.x');
    assert.equal(kv.getItem('sb3.test.x'), null);

    // 읽기 예외 → null (메모리 값이 없으면)
    fake.setFailReads(true);
    assert.equal(kv.getItem(GEMINI_KEY_STORAGE), null);
    fake.setFailReads(false);
  } finally {
    await clearGeminiKey();
    if (prev === undefined) delete g.localStorage;
    else g.localStorage = prev;
  }
  // localStorage 가 없으면(Node·일부 WebView) 메모리로 그대로 동작
  kv.setItem('sb3.test.mem', 'm');
  assert.equal(kv.getItem('sb3.test.mem'), 'm');
  kv.removeItem('sb3.test.mem');
  assert.equal(kv.getItem('sb3.test.mem'), null);
});

test('AI-4 secrets: 다른 창의 키 저장·삭제·전체 지우기(storage 이벤트) → onGeminiKeyChange 알림 → 힌트(저장됨 ••••xxxx) 맞춤', async () => {
  const g = globalThis as any;
  const fake = fakeLocalStorage();
  const prevLs = g.localStorage;
  const prevWin = g.window;
  const win = new EventTarget();
  g.localStorage = fake.ls;
  g.window = win;
  const seen: boolean[] = [];
  const offSeen = onGeminiKeyChange((v) => seen.push(v));
  // 설정 화면(AiSection)과 같은 구독: 알림이 오면 힌트를 실제 저장소에 맞춤
  let synced: Promise<void> = Promise.resolve();
  const offSync = onGeminiKeyChange(() => {
    synced = syncGeminiKeyHint();
  });
  const fire = (key: string | null, newValue: string | null) => {
    if (key) {
      if (newValue == null) fake.store.delete(key);
      else fake.store.set(key, newValue);
    } else fake.store.clear();
    win.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }));
  };
  try {
    await saveGeminiKey(FAKE_KEY);
    assert.equal((useSettings.getState().aiKeyHints.gemini ?? null), 'wxyz');
    seen.length = 0;
    fire(GEMINI_KEY_STORAGE, null); // 다른 창에서 삭제
    await synced;
    assert.deepEqual(seen, [false]);
    assert.equal((useSettings.getState().aiKeyHints.gemini ?? null), null, '새로 고침 없이 힌트가 지워짐');
    assert.equal(await getGeminiKey(), null);
    fire(GEMINI_KEY_STORAGE, 'other-window-key-0000-abcd'); // 다른 창에서 저장
    await synced;
    assert.deepEqual(seen, [false, true]);
    assert.equal((useSettings.getState().aiKeyHints.gemini ?? null), 'abcd');
    fire('sb3.settings', '{}'); // 다른 저장 키 → 알림 없음
    assert.deepEqual(seen, [false, true]);
    fire(null, null); // localStorage.clear()
    await synced;
    assert.deepEqual(seen, [false, true, false]);
    assert.equal((useSettings.getState().aiKeyHints.gemini ?? null), null);
  } finally {
    offSeen();
    offSync();
    await clearGeminiKey();
    useSettings.getState().set({ aiKeyHints: {} });
    if (prevLs === undefined) delete g.localStorage;
    else g.localStorage = prevLs;
    if (prevWin === undefined) delete g.window;
    else g.window = prevWin;
  }
});

// ───────────────────────── PKG-3: 설정의 [앱 설치] ─────────────────────────

test('PKG-3 설치 결과 토스트: 설치함 → 완료 안내 / 닫음 → 없음 / 열 수 없음 → 메뉴 설치 안내', () => {
  assert.deepEqual(installOutcomeToast('accepted'), { message: '앱을 설치했어요. 바탕화면·홈 화면의 아이콘으로 열 수 있어요.', kind: 'success' });
  assert.equal(installOutcomeToast('dismissed', '무시'), null);
  const u = installOutcomeToast('unavailable', 'Chrome 메뉴(⋮) → "앱 설치" 또는 "홈 화면에 추가"를 눌러 주세요.');
  assert.equal(u?.kind, 'info');
  assert.match(u!.message, /^지금은 설치 창을 열 수 없어요\. Chrome 메뉴/);
  assert.equal(installOutcomeToast('unavailable')?.message, '지금은 설치 창을 열 수 없어요.');
});

test('PKG-3 설정 > 앱 정보: usePwaInstall 의 canInstall 일 때만 [앱 설치] 버튼, 안내는 installHint() (코드 모양 검사)', () => {
  const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'settings', 'AppInfoSection.tsx'), 'utf8');
  assert.match(src, /import \{ installHint, usePwaInstall \} from '@\/platform\/install';/);
  assert.match(src, /const \{ canInstall, install \} = usePwaInstall\(\);/);
  assert.match(src, /\{canInstall \? <Button icon=\{Download\} label="앱 설치"/);
  assert.match(src, /const hint = installHint\(\);/);
  assert.match(src, /<InstallRow \/>/, '앱 정보 카드에 설치 줄을 넣음');
  assert.ok(!src.includes('Chrome·Edge 메뉴의 <b>앱 설치</b>'), '예전 고정 안내 대신 installHint()');
});

test('PKG-3 platform/install: beforeinstallprompt 를 받으면 canInstall → 버튼으로 설치 창, 결과에 따라 상태·안내 바뀜 (가짜 window)', async () => {
  const g = globalThis as any;
  const prevWin = g.window;
  const win = new EventTarget();
  g.window = win;
  try {
    const inst = await import('../src/platform/install');
    inst.initPwaInstall();
    assert.equal(inst.getPwaInstallState().canInstall, false);
    assert.match(inst.installHint() ?? '', /앱 설치/, '설치 창을 못 열 때는 메뉴로 설치하는 방법');
    let prevented = false;
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    const origPrevent = ev.preventDefault.bind(ev);
    ev.preventDefault = () => {
      prevented = true;
      origPrevent();
    };
    win.dispatchEvent(ev);
    assert.equal(prevented, true, '브라우저 기본 배너 대신 앱 안 버튼');
    assert.equal(inst.getPwaInstallState().canInstall, true, '[앱 설치] 버튼이 보일 상태');
    assert.match(inst.installHint() ?? '', /버튼을 누르면/);
    assert.equal(await inst.promptPwaInstall(), 'accepted');
    assert.deepEqual(inst.getPwaInstallState(), { canInstall: false, installed: true });
    assert.equal(inst.installHint(), '이미 앱으로 설치돼 있어요.');
    assert.equal(await inst.promptPwaInstall(), 'unavailable', '한 번 쓴 이벤트는 다시 못 씀');
  } finally {
    if (prevWin === undefined) delete g.window;
    else g.window = prevWin;
  }
});
