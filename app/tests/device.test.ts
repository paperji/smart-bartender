/// <reference types="node" />
/**
 * 프로토콜(프레이밍·UTF-8·검증 순서) + 데모 가상 기기(v2.1 펌웨어 시뮬레이션) 테스트 (SPEC §2)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  chunkBytes,
  deviceLimits,
  estimateMakeMs,
  frameLine,
  LIMITS,
  LineAssembler,
  normalizeJobId,
  parseCalSet,
  parseEvent,
  parseMaxPumpMs,
  uncalibratedPumps,
  validateClean,
  validateMake,
  validateRun,
  type DeviceEvent,
} from '../src/lib/protocol';
import { DEMO_DEVICES, DemoTransport, type DemoCalRecord } from '../src/lib/transport/demo';
import { DEMO_FW_VERSION, VirtualBartender } from '../src/lib/transport/virtual-device';
import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from '../src/lib/utf8';

test('UTF-8 인코딩/디코딩 (한글, 이모지)', () => {
  const s = '오렌지주스 🍊 abc';
  const b = utf8Encode(s);
  assert.equal(b.length, Buffer.byteLength(s, 'utf8'));
  assert.deepEqual(Array.from(b), Array.from(Buffer.from(s, 'utf8')));
  assert.equal(utf8Decode(b), s);
  assert.equal(bytesToBase64(b), Buffer.from(s, 'utf8').toString('base64'));
  assert.deepEqual(Array.from(base64ToBytes(bytesToBase64(b))), Array.from(b));
});

test('LineAssembler: 한글이 패킷 경계에서 잘려도 줄 단위로 정확히 복원', () => {
  const lines = ['{"ev":"error","code":"BUSY","msg":"이미 제조 중입니다"}', '{"ev":"pong","up":1}'];
  const bytes = utf8Encode(lines.join('\n') + '\n');
  for (const size of [1, 3, 7, 20, 244]) {
    const asm = new LineAssembler();
    const out: string[] = [];
    for (const c of chunkBytes(bytes, size)) out.push(...asm.push(c));
    assert.deepEqual(out, lines, `chunk=${size}`);
  }
});

test('frameLine: 180바이트 단위 분할 + 줄바꿈 추가', () => {
  const big = JSON.stringify({ cmd: 'make', id: 'r1', mode: 'seq', steps: new Array(8).fill({ p: 1, ml: 12.5 }), memo: '가'.repeat(100) });
  const chunks = frameLine(big);
  assert.ok(chunks.every((c) => c.length <= 180));
  const joined = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  assert.equal(joined.toString('utf8'), big + '\n');
});

// ───────────────────────── make 검증 순서 (SPEC §2.3 v2.1) ─────────────────────────

const CAL = [20, 20, 20, 20];

test('검증 1단계: mode → BAD_JSON, steps 누락/빈 배열 → BAD_AMOUNT, 9개 이상 → LIMIT', () => {
  assert.equal(validateMake([{ p: 1, ml: 10 }], 4, CAL, 'fast').code, 'BAD_JSON');
  assert.equal(validateMake([{ p: 1, ml: 10 }], 4, CAL, 1).code, 'BAD_JSON');
  assert.ok(validateMake([{ p: 1, ml: 10 }], 4, CAL, undefined).ok, 'mode 생략 = seq');
  assert.ok(validateMake([{ p: 1, ml: 10 }], 4, CAL, null).ok, 'mode null = seq');
  assert.equal(validateMake(undefined, 4, CAL).code, 'BAD_AMOUNT');
  assert.equal(validateMake([], 4, CAL).code, 'BAD_AMOUNT');
  assert.equal(validateMake(new Array(9).fill({ p: 1, ml: 1 }), 4, CAL).code, 'LIMIT');
  assert.ok(validateMake(new Array(8).fill({ p: 1, ml: 1 }), 4, CAL).ok);
  // 순서: mode 오류가 steps 오류보다 먼저
  assert.equal(validateMake([], 4, CAL, 'x').code, 'BAD_JSON');
  // 순서: 9개 이상이면 그 안의 펌프 오류보다 LIMIT 먼저
  assert.equal(validateMake(new Array(9).fill({ p: 99, ml: 1 }), 4, CAL).code, 'LIMIT');
});

test('검증 2단계: 각 step — BAD_PUMP / BAD_AMOUNT / 1개 300ml 초과 LIMIT (위에서부터)', () => {
  assert.equal(validateMake([{ p: 5, ml: 10 }], 4, CAL).code, 'BAD_PUMP');
  assert.equal(validateMake([{ p: 0, ml: 10 }], 4, CAL).code, 'BAD_PUMP');
  assert.equal(validateMake([{ p: 1.5, ml: 10 }], 4, CAL).code, 'BAD_PUMP');
  assert.equal(validateMake([{ p: '1', ml: 10 }], 4, CAL).code, 'BAD_PUMP');
  assert.equal(validateMake([{ p: 1, ml: 0 }], 4, CAL).code, 'BAD_AMOUNT');
  assert.equal(validateMake([{ p: 1, ml: -3 }], 4, CAL).code, 'BAD_AMOUNT');
  assert.equal(validateMake([{ p: 1, ml: '45' }], 4, CAL).code, 'BAD_AMOUNT');
  assert.equal(validateMake([{ p: 1 }], 4, CAL).code, 'BAD_AMOUNT');
  assert.equal(validateMake([{ p: 1, ml: 301 }], 4, CAL).code, 'LIMIT');
  assert.ok(validateMake([{ p: 1, ml: 300 }], 4, CAL).ok);
  // 앞 step 의 LIMIT 이 뒤 step 의 BAD_PUMP 보다 먼저
  assert.equal(validateMake([{ p: 1, ml: 301 }, { p: 9, ml: 1 }], 4, CAL).code, 'LIMIT');
  // 앞 step 의 BAD_PUMP 가 뒤 step 의 LIMIT 보다 먼저
  assert.equal(validateMake([{ p: 9, ml: 1 }, { p: 1, ml: 301 }], 4, CAL).code, 'BAD_PUMP');
});

test('검증 3단계: 합산 후 펌프별 ≤300ml, 총 ≤500ml, 펌프별 ≤120초', () => {
  // 같은 펌프 합산 200+150=350 > 300
  const r1 = validateMake([{ p: 1, ml: 200 }, { p: 1, ml: 150 }], 4, CAL);
  assert.equal(r1.code, 'LIMIT');
  assert.match(r1.msg!, /펌프 1/);
  // 총량 300+201 > 500
  assert.equal(validateMake([{ p: 1, ml: 300 }, { p: 2, ml: 201 }], 4, CAL).code, 'LIMIT');
  assert.ok(validateMake([{ p: 1, ml: 300 }, { p: 2, ml: 200 }], 4, CAL).ok);
  // v2.1: 120초까지 허용 (예전 60초)
  assert.ok(validateMake([{ p: 1, ml: 100 }], 4, [1, 20, 20, 20]).ok, '100초 OK');
  assert.ok(validateMake([{ p: 1, ml: 120 }], 4, [1, 20, 20, 20]).ok, '정확히 120초 OK');
  const r2 = validateMake([{ p: 1, ml: 121 }], 4, [1, 20, 20, 20]);
  assert.equal(r2.code, 'LIMIT');
  assert.match(r2.msg!, /120초/);
  // 체크밸브 유량(3ml/s)에서 300ml = 100초 → OK
  assert.ok(validateMake([{ p: 2, ml: 300 }], 4, [20, 3, 20, 20]).ok);
  // v2.0 기기(maxPumpMs 없음) 호환: 60초 한도
  assert.equal(validateMake([{ p: 1, ml: 100 }], 4, [1, 20, 20, 20], 'seq', { maxPumpMs: 60000 }).code, 'LIMIT');
  // 합산 300ml 한도가 총 500ml 한도보다 먼저
  assert.match(validateMake([{ p: 1, ml: 250 }, { p: 1, ml: 100 }, { p: 2, ml: 200 }], 4, CAL).msg!, /펌프 1/);
});

test('검증 결과: 합산(처음 나온 순서) + 예상 시간 (순차 300ms 휴지, 병렬 0.1초 간격)', () => {
  const ok = validateMake([{ p: 1, ml: 45 }, { p: 3, ml: 30.5 }, { p: 1, ml: 5 }], 4, CAL);
  assert.ok(ok.ok);
  assert.deepEqual(ok.merged, [{ p: 1, ml: 50 }, { p: 3, ml: 30.5 }]);
  assert.deepEqual(ok.durations, [2500, 1525]);
  assert.equal(ok.totalMs, 2500 + 300 + 1525);
  // 병렬: max(0×100 + 2000, 1×100 + 1000) = 2000 / max(0+1000, 100+2000) = 2100
  assert.equal(validateMake([{ p: 1, ml: 40 }, { p: 2, ml: 20 }], 4, CAL, 'par').totalMs, 2000);
  assert.equal(validateMake([{ p: 1, ml: 20 }, { p: 2, ml: 40 }], 4, CAL, 'par').totalMs, 2100);
  assert.equal(estimateMakeMs([{ p: 1, ml: 20 }, { p: 2, ml: 40 }], CAL, 'par'), 2100);
  assert.equal(estimateMakeMs([{ p: 1, ml: 20 }, { p: 1, ml: 20 }], CAL, 'seq'), 2000, '같은 펌프 합산');
});

test('run / clean 검증 (SPEC §2.3)', () => {
  assert.equal(validateRun(5, 1000, 4).code, 'BAD_PUMP');
  assert.equal(validateRun(1, 0, 4).code, 'BAD_AMOUNT');
  assert.equal(validateRun(1, 'x', 4).code, 'BAD_AMOUNT');
  assert.equal(validateRun(1, 60001, 4).code, 'LIMIT');
  assert.ok(validateRun(1, 60000, 4).ok);
  assert.equal(validateClean(0).code, 'BAD_AMOUNT');
  assert.equal(validateClean(30001).code, 'LIMIT');
  assert.ok(validateClean(30000).ok);
});

test('make id: 최대 40바이트, 없으면 "make" (한글이 잘리지 않게)', () => {
  assert.equal(normalizeJobId(undefined), 'make');
  assert.equal(normalizeJobId(''), 'make');
  assert.equal(normalizeJobId(123), 'make');
  assert.equal(normalizeJobId('r1730000000'), 'r1730000000');
  assert.equal(normalizeJobId('a'.repeat(50)), 'a'.repeat(40));
  const ko = normalizeJobId('가'.repeat(20)); // 60바이트 → 13글자(39바이트)
  assert.equal(ko, '가'.repeat(13));
  assert.ok(Buffer.byteLength(ko, 'utf8') <= 40);
  // 펌웨어 copyUtf8 과 같게: 제어문자(U+0001~U+001F)는 '?' 로, NUL 뒤는 버림, NUL 로 시작하면 "make" (FW-2 — parity s4_ids)
  assert.equal(normalizeJobId('a\tb\nc\u0001\u001f'), 'a?b?c??');
  assert.equal(normalizeJobId('ab\u0000cd'), 'ab');
  assert.equal(normalizeJobId('\u0000x'), 'make');
  assert.equal(normalizeJobId('\u007f\u0080z'), '\u007f\u0080z');
  const mixed = normalizeJobId('가'.repeat(13) + '\n\n\n'); // 39 + 3 = 42바이트 → 40바이트(가×13 + '?')
  assert.equal(mixed, '가'.repeat(13) + '?');
});

test('info.calSet / maxPumpMs / cal.calSet 파싱 (없으면 null = 알 수 없음)', () => {
  assert.deepEqual(parseCalSet([0, 1, 0, 0]), [0, 1, 0, 0]);
  assert.deepEqual(parseCalSet([true, false]), [1, 0]);
  assert.deepEqual(parseCalSet([1, 1, 1, 1, 0], 4), [1, 1, 1, 1]);
  assert.equal(parseCalSet(undefined), null);
  assert.equal(parseCalSet([]), null);
  assert.equal(parseCalSet(['a']), null);
  assert.equal(parseMaxPumpMs(120000), 120000);
  assert.equal(parseMaxPumpMs(undefined), null);
  assert.equal(parseMaxPumpMs(-1), null);
  assert.deepEqual(uncalibratedPumps([0, 1, 0, 1]), [1, 3]);
  assert.deepEqual(uncalibratedPumps(null), []);
  // 기기 한도: info 없음 → SPEC v2.1, v2.0 info(maxPumpMs 없음) → 60초, v2.1 info → 그 값
  assert.equal(deviceLimits(null).maxPumpMs, 120000);
  assert.equal(deviceLimits({ maxMl: 500, maxStepMl: 300 }).maxPumpMs, LIMITS.legacyMaxPumpMs);
  assert.equal(deviceLimits({ maxMl: 400, maxStepMl: 250, maxPumpMs: 90000 }).maxPumpMs, 90000);
  assert.equal(deviceLimits({ maxMl: 400, maxStepMl: 250 }).maxTotalMl, 400);
});

// ───────────────────────── 가상 기기 (v2.1 펌웨어처럼) ─────────────────────────

function collect(timeScale = 0.1, opts: ConstructorParameters<typeof VirtualBartender>[1] = {}) {
  const events: DeviceEvent[] = [];
  const dev = new VirtualBartender(
    (line) => {
      const e = parseEvent(line);
      if (e) events.push(e);
    },
    { timeScale, latencyMs: 0, ...opts },
  );
  return { dev, events };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('가상 기기: hello → info(v2.1: fw 2.1.0-demo, calSet, maxPumpMs 120000), setcal → calSet=1', async () => {
  const saved: { cal: number[]; calSet: number[] }[] = [];
  const { dev, events } = collect(0.1, { onCalChange: (cal, calSet) => saved.push({ cal, calSet }) });
  dev.receive('{"cmd":"hello"}\n{"cmd":"ping"}\n{"cmd":"setcal","p":2,"mlps":18.5}\n{"cmd":"setcal","p":2,"mlps":0.1}\n{"cmd":"getcal"}\n');
  await wait(20);
  const info = events[0] as any;
  assert.equal(info.ev, 'info');
  assert.equal(info.fw, DEMO_FW_VERSION);
  assert.equal(info.fw, '2.1.0-demo');
  assert.equal(info.pumps, 4);
  assert.deepEqual(info.calSet, [0, 0, 0, 0]);
  assert.equal(info.maxPumpMs, 120000);
  assert.equal(info.maxMl, 500);
  assert.equal(info.maxStepMl, 300);
  assert.equal(events[1].ev, 'pong');
  assert.deepEqual((events[2] as any).cal, [20, 18.5, 20, 20]);
  assert.deepEqual((events[2] as any).calSet, [0, 1, 0, 0]);
  assert.equal((events[3] as any).code, 'BAD_AMOUNT');
  assert.deepEqual((events[4] as any).calSet, [0, 1, 0, 0]);
  assert.equal(saved.length, 1, '유효한 setcal 1번만 저장');
  assert.deepEqual(saved[0].calSet, [0, 1, 0, 0]);
  dev.destroy();
});

test('가상 기기: 저장된 유량표(cal/calSet)로 시작 → info 에 그대로', async () => {
  const { dev, events } = collect(0.1, { cal: [4.6, 3.9, 20, 20], calSet: [1, 1, 0, 0] });
  dev.receive('{"cmd":"hello"}\n');
  await wait(10);
  assert.deepEqual((events[0] as any).cal, [4.6, 3.9, 20, 20]);
  assert.deepEqual((events[0] as any).calSet, [1, 1, 0, 0]);
  dev.destroy();
});

test('가상 기기: 오류 코드 BAD_JSON / UNKNOWN_CMD / TOO_LONG / BUSY', async () => {
  const { dev, events } = collect();
  dev.receive('not json\n{"cmd":"dance"}\n');
  dev.receive('{"cmd":"x","pad":"' + 'a'.repeat(1100) + '"}\n');
  dev.receive('{"cmd":"run","p":1,"ms":1000}\n{"cmd":"make","id":"r1","steps":[{"p":1,"ml":10}]}\n');
  await wait(20);
  const codes = events.filter((e) => e.ev === 'error').map((e: any) => e.code);
  assert.deepEqual(codes, ['BAD_JSON', 'UNKNOWN_CMD', 'TOO_LONG', 'BUSY']);
  dev.destroy();
});

test('가상 기기: make 검증 순서가 앱과 같음 (mode → steps → step → 합산)', async () => {
  const { dev, events } = collect();
  const send = (o: unknown) => dev.receive(JSON.stringify(o) + '\n');
  send({ cmd: 'make', mode: 'fast', steps: [] });
  send({ cmd: 'make', steps: [] });
  send({ cmd: 'make', steps: new Array(9).fill({ p: 1, ml: 1 }) });
  send({ cmd: 'make', steps: [{ p: 7, ml: 1 }] });
  send({ cmd: 'make', steps: [{ p: 1, ml: 0 }] });
  send({ cmd: 'make', steps: [{ p: 1, ml: 301 }] });
  send({ cmd: 'make', steps: [{ p: 1, ml: 200 }, { p: 1, ml: 101 }] });
  send({ cmd: 'make', steps: [{ p: 1, ml: 300 }, { p: 2, ml: 201 }] });
  await wait(20);
  const codes = events.filter((e) => e.ev === 'error').map((e: any) => e.code);
  assert.deepEqual(codes, ['BAD_JSON', 'BAD_AMOUNT', 'LIMIT', 'BAD_PUMP', 'BAD_AMOUNT', 'LIMIT', 'LIMIT', 'LIMIT']);
  assert.ok(!events.some((e) => e.ev === 'ack'), '검증 실패 시 실행 안 함');
  dev.destroy();
});

test('가상 기기: 120초 한도 — 유량 1ml/s 에서 120ml OK, 121ml LIMIT', async () => {
  const { dev, events } = collect(0.001, { cal: [1, 20, 20, 20], calSet: [1, 0, 0, 0] });
  dev.receive('{"cmd":"make","steps":[{"p":1,"ml":121}]}\n');
  dev.receive('{"cmd":"make","steps":[{"p":1,"ml":120}]}\n');
  await wait(20);
  assert.equal((events[0] as any).code, 'LIMIT');
  assert.equal(events[1].ev, 'ack');
  assert.equal((events[1] as any).totalMs, 120000);
  assert.equal((events[1] as any).id, 'make', 'id 가 없으면 "make"');
  dev.destroy();
});

test('가상 기기: make 순차 모드 — ack → progress → step → done, pct 는 완료 전 최대 99', async () => {
  const { dev, events } = collect(0.1); // 10배속
  dev.receive(JSON.stringify({ cmd: 'make', id: 'r1', mode: 'seq', steps: [{ p: 1, ml: 20 }, { p: 3, ml: 10 }] }) + '\n');
  await wait(280); // 기기시간 2.8초 > 1000 + 300 + 500 ms
  const kinds = events.map((e) => e.ev);
  assert.equal(kinds[0], 'ack');
  assert.equal((events[0] as any).totalMs, 1000 + 300 + 500);
  assert.ok(kinds.includes('progress'));
  const steps = events.filter((e) => e.ev === 'step').map((e: any) => e.p);
  assert.deepEqual(steps, [1, 3]);
  const done = events.find((e) => e.ev === 'done') as any;
  assert.ok(done, 'done 이벤트 없음');
  assert.deepEqual(done.dispensed, [{ p: 1, ml: 20 }, { p: 3, ml: 10 }]);
  assert.equal(kinds[kinds.length - 1], 'done');
  const pcts = events.filter((e) => e.ev === 'progress').map((e: any) => e.pct);
  assert.deepEqual([...pcts].sort((a, b) => a - b), pcts, 'pct 단조 증가');
  assert.ok(pcts.every((p) => p <= 99), 'done 전에는 99 이하');
  dev.destroy();
});

test('가상 기기: 병렬 모드 — 0.1초 간격 기동, totalMs = max(i×100 + 구동)', async () => {
  const { dev, events } = collect(0.1);
  dev.receive('{"cmd":"make","id":"p1","mode":"par","steps":[{"p":1,"ml":10},{"p":2,"ml":20}]}\n');
  await wait(300);
  const ack = events.find((e) => e.ev === 'ack') as any;
  // 10ml/20 = 500ms, 20ml/20 = 1000ms → max(0×100 + 500, 1×100 + 1000) = 1100
  assert.equal(ack.totalMs, 1100);
  const done = events.find((e) => e.ev === 'done') as any;
  assert.ok(done);
  assert.deepEqual(done.dispensed, [{ p: 1, ml: 10 }, { p: 2, ml: 20 }]);
  dev.destroy();
});

test('가상 기기: 제조 중 stop → stopped(user, 추정량), 이후 idle', async () => {
  const { dev, events } = collect(0.1);
  dev.receive('{"cmd":"make","id":"r2","steps":[{"p":2,"ml":100}]}\n'); // 5초
  await wait(150); // 기기시간 1.5초
  dev.receive('{"cmd":"stop"}\n{"cmd":"status"}\n');
  await wait(20);
  const stopped = events.find((e) => e.ev === 'stopped') as any;
  assert.ok(stopped);
  assert.equal(stopped.reason, 'user');
  assert.ok(stopped.dispensed[0].ml > 10 && stopped.dispensed[0].ml < 60, `dispensed=${stopped.dispensed[0].ml}`);
  const status = events.filter((e) => e.ev === 'status').pop() as any;
  assert.equal(status.state, 'idle');
  dev.destroy();
});

test('가상 기기: 안전장치 → stopped(reason "error") + error/LIMIT', async () => {
  const { dev, events } = collect(0.1);
  dev.receive('{"cmd":"make","id":"r3","steps":[{"p":1,"ml":100}]}\n');
  await wait(60);
  dev.triggerSafetyStop();
  await wait(10);
  const stopped = events.find((e) => e.ev === 'stopped') as any;
  assert.equal(stopped.reason, 'error');
  const err = events.find((e) => e.ev === 'error') as any;
  assert.equal(err.code, 'LIMIT');
  assert.equal(dev.state, 'idle');
  dev.destroy();
});

test('가상 기기: 물리 버튼 → stopped(button)', async () => {
  const { dev, events } = collect(0.1);
  dev.receive('{"cmd":"make","steps":[{"p":1,"ml":100}]}\n');
  await wait(40);
  dev.pressButton();
  await wait(10);
  assert.equal((events.find((e) => e.ev === 'stopped') as any).reason, 'button');
  dev.destroy();
});

test('가상 기기: run / clean 은 id·kind 가 "run"/"clean", 범위 오류 코드', async () => {
  const { dev, events } = collect(0.05);
  dev.receive('{"cmd":"run","p":2,"ms":60001}\n{"cmd":"run","p":9,"ms":1000}\n{"cmd":"clean","ms":0}\n{"cmd":"clean","ms":30001}\n');
  dev.receive('{"cmd":"run","p":2,"ms":1000}\n');
  await wait(100);
  dev.receive('{"cmd":"clean","ms":500}\n');
  await wait(220);
  const codes = events.filter((e) => e.ev === 'error').map((e: any) => e.code);
  assert.deepEqual(codes, ['LIMIT', 'BAD_PUMP', 'BAD_AMOUNT', 'LIMIT']);
  const acks = events.filter((e) => e.ev === 'ack') as any[];
  assert.deepEqual(acks.map((a) => [a.id, a.kind]), [['run', 'run'], ['clean', 'clean']]);
  assert.equal(acks[1].totalMs, 4 * 500 + 3 * 300);
  const dones = events.filter((e) => e.ev === 'done') as any[];
  assert.deepEqual(dones.map((d) => d.kind), ['run', 'clean']);
  assert.ok(typeof dones[0].sim?.actualMl === 'number');
  dev.destroy();
});

test('가상 기기: "{" 로 시작한 객체는 괄호가 닫히면 줄바꿈 없이도 처리 (문자열 안 괄호 무시)', async () => {
  const { dev, events } = collect();
  dev.receive('{"cmd":"ping"}');
  await wait(5);
  assert.equal(events.length, 1);
  assert.equal(events[0].ev, 'pong');
  dev.receive('{"cmd":"make","id":"a}b{","steps":[{"p":1,"ml":5}]}');
  await wait(5);
  const ack = events.find((e) => e.ev === 'ack') as any;
  assert.equal(ack.id, 'a}b{');
  dev.destroy();
});

test('가상 기기: make id 40바이트로 자름', async () => {
  const { dev, events } = collect();
  dev.receive(JSON.stringify({ cmd: 'make', id: 'x'.repeat(60), steps: [{ p: 1, ml: 5 }] }) + '\n');
  await wait(5);
  assert.equal((events[0] as any).id, 'x'.repeat(40));
  dev.destroy();
});

test('DemoTransport: 가상 기기 2대 스캔(이름·신호세기) → 선택 연결 → 쓰기(180B) → 20B 조각 재조립', async () => {
  const t = new DemoTransport({ timeScale: 0.1, connectDelayMs: 10, scanDelayMs: 5 });
  const found: { name: string; rssi?: number }[] = [];
  await t.scan((d) => found.push(d), { timeoutMs: 20 });
  assert.deepEqual(
    found.map((f) => f.name),
    DEMO_DEVICES.map((d) => d.name),
  );
  assert.ok(found.every((f) => typeof f.rssi === 'number'));
  await t.connect('demo-device-2');
  const lines: string[] = [];
  t.onLine((l) => lines.push(l));
  await t.write('{"cmd":"hello"}');
  await t.write('{"cmd":"setcal","p":1,"mlps":12.5}');
  await wait(80);
  const evs = lines.map(parseEvent);
  assert.equal(evs[0]?.ev, 'info');
  assert.equal((evs[0] as any).name, 'SmartBartender-DEMO2');
  assert.deepEqual((evs[1] as any).cal, [12.5, 20, 20, 20]);
  await assert.rejects(t.connect('nope'), /찾을 수 없어요/);
  t.destroy();
});

test('DemoTransport: 데모 유량값 저장 → 새로 만든 Transport(새로고침)에서도 유지', async () => {
  const store: Record<string, DemoCalRecord> = {};
  const t1 = new DemoTransport({ connectDelayMs: 1, scanDelayMs: 1, onCalChange: (id, rec) => (store[id] = rec) });
  await t1.connect('demo-device');
  await t1.write('{"cmd":"setcal","p":3,"mlps":4.4}');
  await wait(60);
  t1.destroy();
  assert.deepEqual(store['demo-device'].calSet, [0, 0, 1, 0]);

  // "새로고침": 저장된 값으로 새 Transport
  const t2 = new DemoTransport({ connectDelayMs: 1, savedCal: store, onCalChange: (id, rec) => (store[id] = rec) });
  const lines: string[] = [];
  t2.onLine((l) => lines.push(l));
  await t2.connect('demo-device');
  await t2.write('{"cmd":"hello"}');
  await wait(60);
  const info = parseEvent(lines[0]) as any;
  assert.deepEqual(info.cal, [20, 20, 4.4, 20]);
  assert.deepEqual(info.calSet, [0, 0, 1, 0]);
  // 유량 초기화
  t2.virtual!.resetCalibration();
  await wait(60);
  assert.deepEqual(store['demo-device'].calSet, [0, 0, 0, 0]);
  t2.destroy();
});

test('DemoTransport: 연결을 끊어도 가상 기기 작업은 계속 → 다시 연결 후 status 로 확인', async () => {
  const t = new DemoTransport({ timeScale: 0.05, connectDelayMs: 1 });
  const lines: string[] = [];
  t.onLine((l) => lines.push(l));
  await t.connect('demo-device');
  await t.write('{"cmd":"make","id":"bg","steps":[{"p":1,"ml":40}]}'); // 2초 → 100ms
  await wait(30);
  await t.disconnect();
  await wait(150);
  await t.connect('demo-device');
  await t.write('{"cmd":"status"}');
  await wait(40);
  const last = parseEvent(lines[lines.length - 1]) as any;
  assert.equal(last.ev, 'status');
  assert.equal(last.state, 'idle', '끊긴 사이에 끝남');
  t.destroy();
});

test('가상 기기 = 펌웨어(parity): 대기 중 버튼 → status, 끝난 직후(틱 전) 명령은 끝난 상태로, 중단 추정량은 반올림 전 목표량 기준', () => {
  // 펌웨어 BartenderCore.h 를 같은 명령 순서로 돌린 결과와 같아야 함 (교차검증 하네스로 찾은 경우를 고정)
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  const out: any[] = [];
  const vd = new VirtualBartender((l) => out.push(JSON.parse(l)), { latencyMs: 0, timeScale: 1 });
  try {
    // 대기 중 버튼(짧게) = 상태 출력 (펌웨어 SmartBartender.ino updateButton 과 같음)
    vd.pressButton();
    assert.deepEqual(out.pop(), { ev: 'status', state: 'idle', job: null, last: null });
    // 12.16ml @ 20ml/s = 608ms, 602ms 에 정지 → 602/608 × 12.16 = 12.04 → 12 (반올림한 12.2 로 계산하면 12.1 이 됐음)
    vd.receive('{"cmd":"make","id":"t1","steps":[{"p":1,"ml":12.16}]}\n');
    now += 602;
    vd.receive('{"cmd":"stop"}\n');
    assert.deepEqual(out.pop(), { ev: 'stopped', id: 't1', reason: 'user', dispensed: [{ p: 1, ml: 12 }] });
    // 끝난 직후(다음 250ms 틱 전)에 온 status → 펌웨어처럼 이미 끝난 상태: step·done 먼저, done.ms = 예상 소요시간
    vd.receive('{"cmd":"make","id":"t2","steps":[{"p":2,"ml":10}]}\n'); // 500ms
    now += 510;
    vd.receive('{"cmd":"status"}\n');
    const st = out.pop();
    const done = out.pop();
    assert.deepEqual(done, { ev: 'done', id: 't2', kind: 'make', ms: 500, dispensed: [{ p: 2, ml: 10 }] });
    assert.deepEqual(st, { ev: 'status', state: 'idle', job: null, last: { id: 't2', kind: 'make', result: 'done', dispensed: [{ p: 2, ml: 10 }] } });
    // 이어서 보낸 명령은 BUSY 가 아니라 ack
    vd.receive('{"cmd":"run","p":1,"ms":100}\n');
    assert.equal(out.pop().ev, 'ack');
  } finally {
    vd.destroy();
    Date.now = realNow;
  }
});
