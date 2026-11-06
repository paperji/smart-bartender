/// <reference types="node" />
/**
 * 새 재료 탐색 화면 안내(screens/explore/exploreNotices) — 출처 배지·오프라인 이유 배너·안내 줄·다시 탐색 값
 * 화면 작업자가 만든 확인용 테스트를 tests/ 로 모음 (v3.0 통합). 순수 함수·대역만 — 실제 Gemini·기기 호출 없음
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fallbackNotice, nextExploreRound, noticeLines, sourceBadge } from '../src/screens/explore/exploreNotices';

test('sourceBadge', () => {
  assert.equal(sourceBadge('direct').label, 'Gemini AI 추천');
  assert.equal(sourceBadge('offline').label, '오프라인 추천');
  assert.equal(sourceBadge('weird').label, '오프라인 추천');
});

test('fallbackNotice', () => {
  assert.equal(fallbackNotice({ source: 'direct', fallbackReason: 'x' }), null);
  assert.equal(fallbackNotice({ source: 'offline' }), null);
  const nk = fallbackNotice({ source: 'offline', fallbackReason: 'Gemini API 키가 설정되지 않았어요', fallbackCode: 'NO_KEY' })!;
  assert.equal(nk.kind, 'nokey'); assert.equal(nk.tone, 'info'); assert.equal(nk.settings, true);
  const auth = fallbackNotice({ source: 'offline', fallbackReason: 'Gemini 오류(AUTH): ...', fallbackCode: 'AUTH' })!;
  assert.equal(auth.tone, 'warning'); assert.equal(auth.settings, true);
  assert.match(auth.message, /^Gemini 를 쓰지 못해 앱에 내장된 규칙으로 골랐어요\. 이유: API 키가/);
  const net = fallbackNotice({ source: 'offline', fallbackReason: 'Gemini 오류(NETWORK): ...', fallbackCode: 'NETWORK' })!;
  assert.match(net.message, /^인터넷 또는 AI 서버 문제로/); assert.equal(net.settings, false);
  const to = fallbackNotice({ source: 'offline', fallbackReason: 't', fallbackCode: 'TIMEOUT' })!;
  assert.match(to.message, /^AI 응답이 너무 늦어/);
  const unk = fallbackNotice({ source: 'offline', fallbackReason: 'a'.repeat(300) })!;
  assert.ok(unk.message.endsWith('이유: ' + 'a'.repeat(120)));
  assert.ok(!unk.message.includes('a'.repeat(121)));
});

test('noticeLines', () => {
  assert.deepEqual(noticeLines(['a', ' ', 'a', 'b', 'c', 'd', 'e']), ['a', 'b', 'c', 'd']);
  assert.deepEqual(noticeLines(undefined), []);
});

test('nextExploreRound', () => {
  assert.deepEqual(nextExploreRound(0, () => 0), { round: 1, variation: 7919 });
  assert.deepEqual(nextExploreRound(2, () => 0.5), { round: 3, variation: 3 * 7919 + 500 });
});
