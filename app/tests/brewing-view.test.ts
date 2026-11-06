/// <reference types="node" />
/**
 * 제조 진행 화면 계산(screens/brewing/brewingView) — 제목·색·진행률·남은 시간·배너 문구가 v2.1 brewing.tsx 와 같은지
 * 화면 작업자가 만든 확인용 테스트를 tests/ 로 모음 (v3.0 통합). 순수 함수·대역만 — 실제 Gemini·기기 호출 없음
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as v from '../src/screens/brewing/brewingView';

const base = (p: Record<string, unknown> = {}) =>
  ({ id: 'r1', kind: 'make', status: 'running', totalMs: 10000, ackAt: 1000, pct: 0, pumps: [], ...p }) as any;

test('head titles (v2.1 wording)', () => {
  assert.equal(v.brewHead(base({ status: 'pending' })).title, '기기로 레시피를 보내는 중…');
  assert.equal(v.brewHead(base({ status: 'pending', uncertain: true })).title, '기기 응답을 확인하는 중…');
  assert.equal(v.brewHead(base()).title, '제조 중이에요');
  assert.equal(v.brewHead(base({ kind: 'run' })).title, '펌프 구동 중이에요');
  assert.equal(v.brewHead(base({ status: 'done' })).title, '완성! 맛있게 즐기세요');
  assert.equal(v.brewHead(base({ status: 'done' })).tone, 'success');
  assert.equal(v.brewHead(base({ status: 'done', kind: 'clean' })).title, '세척 완료');
  assert.equal(v.brewHead(base({ status: 'done', uncertain: true })).title, '연결이 끊긴 사이에 끝났어요');
  assert.equal(v.brewHead(base({ status: 'stopped', reason: 'user' })).title, '제조를 중단했어요');
  assert.equal(v.brewHead(base({ status: 'stopped', reason: 'user', kind: 'run' })).title, '펌프 구동을 중단했어요');
  assert.equal(v.brewHead(base({ status: 'stopped', reason: 'disconnected' })).title, '연결이 끊겼어요');
  assert.equal(v.brewHead(base({ status: 'error' })).title, '문제가 생겼어요');
  assert.equal(v.brewHead(base({ status: 'error' })).tone, 'danger');
  assert.equal(v.brewHead(base({ status: 'error', uncertain: true })).title, '제조 여부를 확인하지 못했어요');
});

test('progress: time-based up to 99%, done = 100, caption', () => {
  let p = v.brewProgress(base(), 1000 + 4000);
  assert.equal(p.pct, 40);
  assert.equal(p.remaining, 6000);
  assert.equal(v.progressCaption(base(), p), '남은 시간 약 6초');
  p = v.brewProgress(base(), 1000 + 20000);
  assert.equal(p.pct, 99);
  assert.equal(v.progressCaption(base(), p), '곧 끝나요');
  p = v.brewProgress(base({ pct: 70 }), 1000 + 1000);
  assert.equal(p.pct, 70, 'device pct wins when larger');
  const pend = base({ status: 'pending', ackAt: null });
  p = v.brewProgress(pend, 5000);
  assert.equal(p.indeterminate, true);
  assert.equal(v.progressCaption(pend, p), '응답 대기 중');
  const runNoAck = base({ ackAt: null, pct: 0 });
  assert.equal(v.progressCaption(runNoAck, v.brewProgress(runNoAck, 0)), '진행 중');
  const done = base({ status: 'done', pct: 50, dispensed: [{ p: 1, ml: 40 }, { p: 2, ml: 160.04 }] });
  p = v.brewProgress(done, 0);
  assert.equal(p.pct, 100);
  assert.equal(p.running, false);
  assert.equal(v.progressCaption(done, p), '총 200ml');
  const stopped = base({ status: 'stopped', pct: 33.4, reason: 'user' });
  assert.equal(v.brewProgress(stopped, 99999).pct, 33);
  assert.equal(v.progressCaption(stopped, v.brewProgress(stopped, 0)), '');
});

test('notices match v2.1 conditions', () => {
  const ctx = { linkLost: false, reconnecting: false, reconnectAttempt: 0 };
  assert.deepEqual(v.brewNotices(base(), ctx), []);
  let n = v.brewNotices(base(), { linkLost: true, reconnecting: true, reconnectAttempt: 2 });
  assert.equal(n[0].title, '블루투스 연결이 끊겼어요');
  assert.match(n[0].message, /\(2번째 시도\)/);
  n = v.brewNotices(base(), { linkLost: true, reconnecting: false, reconnectAttempt: 0 });
  assert.equal(n[0].tone, 'error');
  assert.equal(n[0].title, '연결이 끊겼어요');
  n = v.brewNotices(base({ status: 'stopped', reason: 'button', dispensed: [{ p: 1, ml: 12.5 }] }), ctx);
  assert.equal(n[0].message, '기기의 버튼으로 정지했어요. 지금까지 약 12.5ml 나왔어요.');
  n = v.brewNotices(base({ status: 'stopped', reason: 'user', dispensed: [] }), ctx);
  assert.equal(n[0].message, '앱에서 정지했어요. 지금까지 약 0ml 나왔어요.');
  n = v.brewNotices(base({ status: 'stopped', reason: 'error', dispensed: [{ p: 1, ml: 30 }] }), ctx);
  assert.equal(n[0].title, '기기 안전장치가 작동했어요');
  n = v.brewNotices(base({ status: 'stopped', reason: 'disconnected', uncertain: true, dispensed: [{ p: 1, ml: 30 }] }), ctx);
  assert.equal(n[0].title, '연결이 끊겨 결과를 확인하지 못했어요');
  assert.match(n[0].message, /확인된 양은 약 30ml이에요/);
  n = v.brewNotices(base({ status: 'stopped', reason: 'reboot' }), ctx);
  assert.equal(n[0].title, '연결이 끊긴 동안 기기가 멈췄어요');
  n = v.brewNotices(base({ status: 'error', error: 'BUSY' }), ctx);
  assert.deepEqual([n[0].tone, n[0].title, n[0].message], ['error', '제조를 시작하지 못했어요', 'BUSY']);
  n = v.brewNotices(base({ status: 'error', uncertain: true }), ctx);
  assert.deepEqual([n[0].tone, n[0].message], ['warning', '알 수 없는 오류']);
  n = v.brewNotices(base({ status: 'pending', uncertain: true }), ctx);
  assert.equal(n[0].title, '기기 응답 확인 중');
  n = v.brewNotices(base({ status: 'done', uncertain: true }), ctx);
  assert.equal(n[0].tone, 'info');
});

test('buttons & labels', () => {
  assert.equal(v.closeLabel(base({ status: 'done' })), '기록 저장하고 닫기');
  assert.equal(v.closeLabel(base({ status: 'done', kind: 'run' })), '닫기');
  assert.equal(v.closeLabel(base({ status: 'stopped' })), '닫기');
  assert.equal(v.showsResultCards(base({ status: 'stopped' })), true);
  assert.equal(v.showsResultCards(base({ status: 'error' })), false);
  assert.equal(v.showsResultCards(base({ status: 'done', kind: 'clean' })), false);
  const lost = base({ status: 'stopped', reason: 'disconnected' });
  assert.equal(v.needsReconnectButton(lost, 'disconnected', false), true);
  assert.equal(v.needsReconnectButton(lost, 'reconnecting', true), false);
  assert.equal(v.needsReconnectButton(lost, 'connected', false), false);
  assert.equal(v.needsReconnectButton(base({ status: 'error', uncertain: true }), 'idle', false), true);
  assert.equal(v.needsReconnectButton(base({ status: 'stopped', reason: 'user' }), 'disconnected', false), false);
  assert.match(v.feedbackCaption(base({ uncertain: true })), /정확하지 않을 수 있어요/);
  assert.equal(v.feedbackCaption(base()), '피드백은 다음 AI 추천에 반영돼요. 재료 잔량은 자동으로 차감했어요.');
  const slots = [{ pump: 1, name: '사이다' }, { pump: 2, name: '' }] as any;
  const recipe = { ingredients: [{ pump: 1, name: '레시피사이다', ml: 10 }] } as any;
  assert.equal(v.pumpName(1, recipe, slots), '레시피사이다');
  assert.equal(v.pumpName(1, null, slots), '사이다');
  assert.equal(v.pumpName(2, null, slots), '펌프 2');
  assert.equal(v.pumpName(3, null, slots), '펌프 3');
});
