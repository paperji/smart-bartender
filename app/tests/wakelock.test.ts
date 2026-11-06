/// <reference types="node" />
/**
 * 화면 켜 두기 (platform/wakeLock, FLOW-4) — 다시 요청하는 도중 해제하면, 늦게 받은 잠금도 바로 풀어야 함
 * 가짜 navigator.wakeLock(요청에 30ms 걸림) + 가짜 document(visibilitychange)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installFakeDocument } from './stubs/document';

const doc = installFakeDocument();

let held = 0;
let requests = 0;
const sentinels: { released: boolean; release: () => Promise<void> }[] = [];
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    wakeLock: {
      request: (_type: string) =>
        new Promise((resolve) => {
          requests++;
          setTimeout(() => {
            held++;
            const s = {
              released: false,
              release: async () => {
                if (!s.released) {
                  s.released = true;
                  held--;
                }
              },
            };
            sentinels.push(s);
            resolve(s);
          }, 30);
        }),
    },
  },
});

const { keepScreenOn } = await import('../src/platform/wakeLock');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 브라우저가 탭을 가릴 때처럼 잡고 있던 잠금을 모두 풂 */
async function browserHides() {
  doc.emit('background');
  for (const s of sentinels) await s.release();
}

test('wakeLock: 기본 — 잡고, 해제하면 풀림', async () => {
  held = 0;
  const release = await keepScreenOn();
  assert.equal(held, 1);
  release();
  await wait(5);
  assert.equal(held, 0);
});

test('wakeLock: 다시 보일 때 다시 요청하는 도중 해제하면, 늦게 받은 잠금도 바로 풂 (제조가 끝났는데 화면이 켜진 채로 남지 않게)', async () => {
  held = 0;
  sentinels.length = 0;
  const release = await keepScreenOn();
  assert.equal(held, 1);
  await browserHides();
  assert.equal(held, 0);
  doc.emit('active'); // 다시 요청 시작 (30ms)
  await wait(5);
  release(); // 요청이 끝나기 전에 해제
  await wait(60);
  assert.equal(held, 0, '해제 뒤에 받은 잠금은 바로 풀려야 함');
});

test('wakeLock: 보임 이벤트가 겹쳐도 요청은 하나만 (잠금이 둘 생기지 않게)', async () => {
  held = 0;
  sentinels.length = 0;
  const release = await keepScreenOn();
  await browserHides();
  const before = requests;
  doc.emit('active');
  doc.emit('active');
  doc.emit('active');
  await wait(60);
  assert.equal(requests - before, 1, '진행 중인 요청이 있으면 다시 요청하지 않음');
  assert.equal(held, 1);
  release();
  await wait(5);
  assert.equal(held, 0);
});
