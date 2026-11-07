/// <reference types="node" />
/**
 * v3.1 독립 검토(3차) 반영
 *  - '…-instruct' 는 OpenAI 에서만 부를 수 없는 모델 (Groq·OpenRouter 의 …-instruct 는 대화 모델 → 쓸 수 있음)
 *  - 키 바뀜 알림의 external: 같은 탭 저장은 false, 다른 탭(storage 이벤트)은 true
 *  - 기기를 다시 시작해도(데모 ↔ 실제) 방금 끝난 작업은 남김 (완료 화면·피드백이 사라지지 않게)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkAiKey } from '../src/lib/ai/keyCheck';
import { onAiKeyChange, setAiKey, clearAiKey } from '../src/platform/secrets';

const FAKE = 'test-key-not-real-0000-wxyz';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
async function withFetch<T>(handler: (url: string) => Response, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any) => handler(String(url))) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test("'…-instruct': Groq·OpenRouter 는 쓸 수 있음, OpenAI 의 gpt-3.5-turbo-instruct 는 못 씀", async () => {
  const groq = await withFetch(
    () => json({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'meta-llama/llama-4-scout-17b-16e-instruct' }] }),
    () => checkAiKey('groq', FAKE, 'meta-llama/llama-4-scout-17b-16e-instruct'),
  );
  assert.equal(groq.code, 'OK');
  assert.ok(groq.models.some((m) => m.id === 'meta-llama/llama-4-scout-17b-16e-instruct'), '목록에도 보임');
  const or = await withFetch(
    (u) => (u.endsWith('/key') ? json({ data: {} }) : json({ data: [{ id: 'openrouter/free' }, { id: 'meta-llama/llama-3.3-70b-instruct' }] })),
    () => checkAiKey('openrouter', FAKE, 'meta-llama/llama-3.3-70b-instruct'),
  );
  assert.equal(or.code, 'OK', '목록에 없는 유료 모델도 쓸 수 있음');
  const oa = await withFetch(() => json({ data: [{ id: 'gpt-6-luna' }, { id: 'gpt-3.5-turbo-instruct' }] }), () => checkAiKey('openai', FAKE, 'gpt-3.5-turbo-instruct'));
  assert.equal(oa.code, 'MODEL_MISSING');
});

test('키 바뀜 알림: 같은 탭 저장·삭제는 external=false', async () => {
  const seen: [string | null, boolean, boolean][] = [];
  const off = onAiKeyChange((p, has, ext) => seen.push([p, has, ext]));
  try {
    await setAiKey('groq', 'gsk_' + 'a'.repeat(40));
    await clearAiKey('groq');
    assert.deepEqual(seen, [
      ['groq', true, false],
      ['groq', false, false],
    ]);
  } finally {
    off();
  }
});
