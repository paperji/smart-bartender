/// <reference types="node" />
/**
 * 화면 이동 서비스 dismissTo (FLOW-3) — v2.1 router.dismissTo('/recipe') 처럼 앞 기록의 레시피 화면으로 돌아가고(기록이 겹치지 않게),
 * 없으면 지금 자리를 바꿈. 가짜 window(history·location·popstate)와 react-router 처럼 idx 를 남기는 navigate 대역으로 확인
 *  - [바텐더, 레시피, 탐색] → [바텐더, 레시피] · [바텐더, 레시피, 탐색, 재료 편집] → [바텐더, 레시피]
 *  - [바텐더, 탐색, 재료 편집] → [바텐더, 탐색, 레시피] · 탭 첫 화면을 넘어 더 뒤로 찾지 않음 · 새로고침(기록 모름) → 바꿔 열기
 *  - 같은 주소로 두 번 이동(빠르게 두 번 누름)하면 한 번만 쌓임
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

interface Entry {
  url: string;
  state: { idx: number } | null;
}

/** react-router HashRouter 가 쓰는 만큼만 흉내 낸 window */
function makeWindow() {
  const target = new EventTarget();
  const entries: Entry[] = [{ url: '/', state: null }];
  let index = 0;
  const win = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    location: {
      get hash() {
        return '#' + entries[index].url;
      },
    },
    history: {
      get state() {
        return entries[index].state;
      },
      get length() {
        return entries.length;
      },
      pushState(state: Entry['state'], _t: string, url: string) {
        entries.splice(index + 1);
        entries.push({ url, state });
        index = entries.length - 1;
      },
      replaceState(state: Entry['state'], _t: string, url?: string) {
        entries[index] = { url: url ?? entries[index].url, state };
      },
      go(n: number) {
        // 브라우저처럼 비동기로 이동 → popstate
        setTimeout(() => {
          const next = Math.max(0, Math.min(entries.length - 1, index + n));
          if (next === index) return;
          index = next;
          target.dispatchEvent(new Event('popstate'));
        }, 0);
      },
    },
  };
  return {
    win,
    paths: () => entries.map((e) => e.url),
    at: () => ({ index, url: entries[index].url }),
  };
}

const fake = makeWindow();
(globalThis as any).window = fake.win;
// react-router 처럼 첫 칸에 idx 0
fake.win.history.replaceState({ idx: 0 }, '');

const nav = await import('../src/lib/nav');

/** react-router navigate 대역: push → idx+1, replace → 같은 idx, 숫자 → history.go */
nav.setNavigator((to, opts) => {
  const h = fake.win.history;
  if (typeof to === 'number') h.go(to);
  else if (opts?.replace) h.replaceState({ idx: h.state?.idx ?? 0 }, '', to);
  else h.pushState({ idx: (h.state?.idx ?? 0) + 1 }, '', to);
});

const tick = () => new Promise((r) => setTimeout(r, 5));

/** 기록을 paths 순서대로 다시 만듦 (첫 칸은 바꿔 쓰고 나머지는 go 로 push) */
async function resetTo(paths: string[]) {
  // 맨 앞으로 돌아가 바꿔 쓴 뒤 차례로 push (앞으로 가기 기록은 push 때 지워짐)
  const { index } = fake.at();
  if (index > 0) {
    fake.win.history.go(-index);
    await tick();
  }
  fake.win.history.replaceState({ idx: 0 }, '', paths[0]);
  nav.noteLocation();
  for (const p of paths.slice(1)) nav.go(p);
}

test('dismissTo: [바텐더, 레시피, 탐색] → 레시피로 돌아감 (기록이 [바텐더, 레시피] 로 — 같은 레시피가 두 번 남지 않음)', async () => {
  await resetTo(['/', '/recipe', '/explore']);
  assert.deepEqual(nav.navStackForTest(), ['/', '/recipe', '/explore']);
  nav.dismissTo('/recipe');
  await tick();
  assert.deepEqual(fake.at(), { index: 1, url: '/recipe' });
  assert.deepEqual(nav.navStackForTest(), ['/', '/recipe'], 'popstate 로 기록도 따라감');
  // 뒤로 → 바텐더 (레시피·탐색이 다시 나오지 않음)
  nav.back();
  await tick();
  assert.deepEqual(fake.at(), { index: 0, url: '/' });
});

test('dismissTo: [바텐더, 레시피, 탐색, 재료 편집] → 레시피로 두 칸 돌아감', async () => {
  await resetTo(['/', '/recipe', '/explore', '/ingredients/2?suggest=x&from=explore']);
  nav.dismissTo('/recipe');
  await tick();
  assert.deepEqual(fake.at(), { index: 1, url: '/recipe' });
});

test('dismissTo: [바텐더, 레시피, 재료 편집] (레시피 화면 카드에서 장착) → 레시피로', async () => {
  await resetTo(['/', '/recipe', '/ingredients/3?from=explore']);
  nav.dismissTo('/recipe');
  await tick();
  assert.deepEqual(fake.at(), { index: 1, url: '/recipe' });
});

test('dismissTo: 앞 기록에 레시피가 없으면 [바텐더, 탐색, 재료 편집] → [바텐더, 탐색, 레시피] (편집 자리를 바꿈)', async () => {
  await resetTo(['/', '/explore', '/ingredients/4?from=explore']);
  nav.dismissTo('/recipe');
  await tick();
  assert.deepEqual(fake.at(), { index: 2, url: '/recipe' });
  assert.deepEqual(fake.paths(), ['/', '/explore', '/recipe']);
});

test('dismissTo: 탭 첫 화면(바텐더 등)을 넘어 더 오래된 레시피까지 돌아가지 않음 — 그 자리를 바꿈', async () => {
  await resetTo(['/', '/recipe', '/', '/explore']);
  nav.dismissTo('/recipe');
  await tick();
  assert.deepEqual(fake.at(), { index: 3, url: '/recipe' });
});

test('dismissTo: 제조 화면에서 "한 잔 더" — [바텐더, 레시피, 제조] → 레시피, "다른 걸 원해요" — [바텐더, 탐색, 레시피, 제조] → 탐색', async () => {
  await resetTo(['/', '/recipe', '/brewing']);
  nav.dismissTo('/recipe');
  await tick();
  assert.deepEqual(fake.at(), { index: 1, url: '/recipe' });
  await resetTo(['/', '/explore', '/recipe', '/brewing']);
  nav.dismissTo('/explore');
  await tick();
  assert.deepEqual(fake.at(), { index: 1, url: '/explore' });
  await resetTo(['/', '/recipe', '/brewing']);
  nav.dismissTo('/explore');
  await tick();
  assert.deepEqual(fake.paths(), ['/', '/recipe', '/explore'], '탐색 기록이 없으면 제조 자리를 탐색으로');
});

test('dismissTo: 새로고침 뒤처럼 앞 기록을 모르면 더 찾지 않고 지금 자리를 바꿈', async () => {
  await resetTo(['/', '/recipe', '/explore']);
  nav.resetNavStackForTest();
  nav.dismissTo('/recipe');
  await tick();
  assert.deepEqual(fake.at(), { index: 2, url: '/recipe' });
  assert.deepEqual(fake.paths(), ['/', '/recipe', '/recipe'], '모르면 안전하게 바꿔 열기');
});

test('go: 지금 주소와 같은 곳으로 다시 push 하면 무시 (빠르게 두 번 눌러도 기록은 한 칸)', async () => {
  await resetTo(['/', '/recipe']);
  nav.go('/ingredients/2?suggest=%EC%A7%84&from=explore');
  nav.go('/ingredients/2?suggest=%EC%A7%84&from=explore');
  assert.deepEqual(fake.paths(), ['/', '/recipe', '/ingredients/2?suggest=%EC%A7%84&from=explore']);
  // replace 는 그대로 실행
  nav.go('/ingredients/2?suggest=%EC%A7%84&from=explore', { replace: true });
  assert.equal(fake.paths().length, 3);
});
