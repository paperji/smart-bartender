/// <reference types="node" />
/**
 * v3.1 독립 검토(2차) 반영 — 가짜 fetch 만 씀
 *  - 생각 정도: '값'이 거절될 때만 low 로, 옵션 자체를 모르면 바로 다음 단계, 그 한 번은 3번 한도에 세지 않음(기본 요청까지 감)
 *  - 키 확인: 부를 수 없는 모델(Responses 전용·임베딩)은 '쓸 수 있음'이 아님
 *  - 설정 합치기: 예전 탭(v3.0)이 쓴 저장값으로 고른 AI·모델·키 힌트를 덮지 않음
 *  - 즐겨찾기: 내용이 같아도 공유 id 가 다르면 다른 즐겨찾기
 *  - 사용 기록: counted 와 pending 이 함께 남지 않음(다시 보내기가 멈추지 않음)
 *  - 배지 'AI · AI' 없음 · 제조 중에는 기기 다시 시작을 미룸
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { callAi } from '../src/lib/ai/aiClient';
import { checkAiKey } from '../src/lib/ai/keyCheck';
import { buildRequest } from '../src/lib/ai/recommend';
import { defaultSlots } from '../src/lib/presets';
import { aiBadgeText } from '../src/lib/share/convert';
import type { Recipe, UserInput } from '../src/lib/types';
import { findFavorite, useHistory } from '../src/store/history';
import { mergeSettings, SETTINGS_DEFAULTS } from '../src/store/settings';
import { flushSharedUses, recordSharedUse, sanitizeShared, useShared } from '../src/store/shared';

const ROOT = path.resolve(import.meta.dirname, '..');
const input: UserInput = { moods: [], taste: { sweet: 3, sour: 2, bitter: 0, fizzy: 3 }, strength: 'none', weather: null, situation: '', preference: '', cupMl: 200 };
const req = buildRequest(input, defaultSlots());
const RECIPE_JSON = JSON.stringify({ recipe: { name: '에이드', ingredients: [{ pump: 1, name: '사이다', ml: 150 }, { pump: 2, name: '오렌지주스', ml: 50 }] }, explore: [] });
const FAKE = 'test-key-not-real-0000-wxyz';

async function withFetch<T>(handler: (c: { url: string; body: any }, n: number) => Response | Promise<Response>, fn: (calls: { url: string; body: any }[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const c = { url: String(url), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
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
const chat = (content: unknown) => json({ choices: [{ message: { content }, finish_reason: 'stop' }] });

test('생각 정도: 옵션 자체를 모르는 모델(gpt-4 등)은 바로 다음 단계 → json_object 도 거절되면 기본 요청까지 감', async () => {
  await withFetch(
    (c) => {
      if (c.body.reasoning_effort) return json({ error: { message: "Unsupported parameter: 'reasoning_effort' is not supported with this model." } }, 400);
      if (c.body.response_format) return json({ error: { message: "Invalid parameter: 'response_format' of type 'json_object' is not supported with this model." } }, 400);
      return chat(RECIPE_JSON);
    },
    async (calls) => {
      const r = await callAi('openai', FAKE, req, 'gpt-4');
      assert.ok(r.recipe);
      assert.equal(calls.length, 3);
      assert.equal(calls[0].body.reasoning_effort, 'none');
      assert.equal(calls[1].body.reasoning_effort, undefined, 'low 로 다시 보내지 않고 다음 단계');
      assert.equal(calls[2].body.response_format, undefined, '기본 요청');
    },
  );
});

test("생각 정도 '값'이 거절되면 low 로 한 번 — 이 한 번은 한도에 세지 않아 기본 요청까지 4번 갈 수 있음", async () => {
  await withFetch(
    (c, n) => {
      if (n === 1) return json({ error: { message: "Unsupported value: 'reasoning_effort' does not support 'none' with this model." } }, 400);
      if (c.body.response_format) return json({ error: { message: 'response_format is not supported' } }, 400);
      return chat(RECIPE_JSON);
    },
    async (calls) => {
      await callAi('openai', FAKE, req, 'gpt-5.4-mini');
      assert.equal(calls.length, 4);
      assert.equal(calls[1].body.reasoning_effort, 'low');
      assert.equal(calls[3].body.response_format, undefined);
    },
  );
});

test('키 확인: Responses 전용(o3-pro·deep-research)·임베딩 모델은 목록에 있어도 MODEL_MISSING', async () => {
  const models = { data: [{ id: 'gpt-6-luna' }, { id: 'o3-pro' }, { id: 'o3-deep-research' }, { id: 'text-embedding-3-small' }] };
  for (const m of ['o3-pro', 'o3-deep-research', 'text-embedding-3-small']) {
    const r = await withFetch(() => json(models), () => checkAiKey('openai', FAKE, m));
    assert.equal(r.code, 'MODEL_MISSING', m);
    assert.ok(!r.available?.includes(m), `${m} 은 부를 수 없음`);
  }
  const ok = await withFetch(() => json(models), () => checkAiKey('openai', FAKE, 'gpt-6-luna'));
  assert.equal(ok.code, 'OK');
});

test('설정 합치기: v3.0 탭이 쓴 저장값(v3.1 칸 없음)이면 고른 AI·모델·키 힌트는 지금 값을 지킴', () => {
  const current = { ...SETTINGS_DEFAULTS, aiProvider: 'anthropic' as const, aiModels: { anthropic: 'claude-sonnet-5-5' }, aiKeyHints: { anthropic: 'abcd' } };
  const m = mergeSettings({ aiMode: 'gemini', geminiKeyHint: 'wxyz', demoMode: false }, current);
  assert.equal(m.aiProvider, 'anthropic');
  assert.deepEqual(m.aiModels, { anthropic: 'claude-sonnet-5-5' });
  assert.deepEqual(m.aiKeyHints, { anthropic: 'abcd', gemini: 'wxyz' });
  assert.equal(m.demoMode, false, '다른 칸은 저장값');
  const n = mergeSettings({ aiProvider: 'openai', aiModels: {}, aiKeyHints: {} }, current);
  assert.equal(n.aiProvider, 'openai', 'v3.1 저장값이면 그대로 따름');
  assert.deepEqual(n.aiKeyHints, {});
});

test('즐겨찾기: 내용이 같아도 공유 id 가 다른 레시피끼리는 섞이지 않음', () => {
  const r: Recipe = {
    name: '선셋', description: '', reason: '', ingredients: [{ pump: 0, name: '사이다', ml: 100 }], totalMl: 100, estimatedAbv: 0,
    flavor: { sweet: 0, sour: 0, bitter: 0, fizzy: 0, strength: 0 }, garnish: '', tips: '', suggestions: [],
  };
  useHistory.setState({ entries: [], favorites: [], rejections: [] });
  useHistory.getState().toggleFavorite(r, { sharedId: 'A' });
  const favs = useHistory.getState().favorites;
  assert.equal(findFavorite(favs, r, 'B'), undefined, 'B 는 꺼져 보임');
  assert.equal(useHistory.getState().toggleFavorite(r, { sharedId: 'B' }), true, 'B 를 누르면 A 를 지우지 않고 추가');
  assert.equal(useHistory.getState().favorites.length, 2);
  assert.ok(findFavorite(useHistory.getState().favorites, r), '공유 id 없이 찾으면 같은 내용으로 찾음');
  useHistory.setState({ entries: [], favorites: [], rejections: [] });
});

test('사용 기록: 다시 보내기와 제조 시작이 겹쳐도 counted·pending 에 함께 남지 않고, 다음 기록도 보내짐', async () => {
  useShared.setState({ counted: [], pendingUses: ['A'] });
  let n = 0;
  await withFetch(
    async (c) => {
      n++;
      if (c.body.p_id === 'A' && n === 1) {
        await new Promise((r) => setTimeout(r, 30));
        throw new TypeError('늦게 끊김');
      }
      return json(1);
    },
    async () => {
      await Promise.all([flushSharedUses(), recordSharedUse('A')]);
      assert.deepEqual(useShared.getState().counted, ['A']);
      assert.deepEqual(useShared.getState().pendingUses, [], '보낸 A 는 기다리는 목록에서 빠짐');
      useShared.getState().addPending('A');
      assert.deepEqual(useShared.getState().pendingUses, [], '이미 보낸 것은 다시 넣지 않음');
      useShared.setState({ pendingUses: ['B'] });
      await flushSharedUses();
      assert.ok(useShared.getState().counted.includes('B'));
    },
  );
  assert.deepEqual(sanitizeShared({ counted: ['X'], pendingUses: ['X', 'Y'] }).pendingUses, ['Y']);
  useShared.setState({ counted: [], pendingUses: [] });
});

test("배지: 'AI · AI' 대신 'AI 추천', 오프라인은 '앱 추천'", () => {
  assert.equal(aiBadgeText('direct', 'Claude'), 'AI · Claude');
  assert.equal(aiBadgeText('direct', 'AI'), 'AI 추천');
  assert.equal(aiBadgeText('direct', ''), 'AI 추천');
  assert.equal(aiBadgeText('offline', 'Claude'), '앱 추천');
});

test('배선: 다른 탭에서 데모 모드가 바뀌어도 제조 중이면 기기 다시 시작을 미룸', () => {
  const app = readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  assert.match(app, /if \(!isBusy\(useDevice\.getState\(\)\.job\)\) \{\s*run\(\);\s*return;\s*\}/);
  assert.match(app, /useDevice\.subscribe\(\(s\) => \{\s*if \(isBusy\(s\.job\)\) return;/);
});
