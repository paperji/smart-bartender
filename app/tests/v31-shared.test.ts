/// <reference types="node" />
/**
 * v3.1 모두의 레시피(공유) — 가짜 fetch 만 씀(실제 공유 서버에 쓰지 않음)
 *  - api: 주소·공개용 키 헤더·본문, 서버 오류 코드 → 안내, 연결 실패·시간 초과·HTML·쉬는 서버, 행 정리
 *  - convert: 올릴 내용(추천 이유·기분 빼기, 재료 종류·도수 채우기), 연락처 거르기, 같은 레시피 키, 공유 레시피 → 레시피, 장착 여부
 *  - device: 무작위 번호 한 번 만들어 계속 씀
 *  - store/shared: 사용 횟수는 기기에서 한 번만, 인터넷이 안 되면 나중에 다시
 *  - 기록: provider·sharedId·meta 를 남기고 불러옴
 *  - 배선: 공유 탭·라우트, 실제 기기에서 만들 때만 사용 횟수, 설정 화면 톱니바퀴(같은 화면 중복 이동), 업데이트 창 갤럭시 안내
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { TABS } from '../src/appTabs';
import { defaultSlots } from '../src/lib/presets';
import {
  browseShared,
  deleteShared,
  recordUse,
  rpc,
  SHARE_API_KEY,
  SHARE_API_URL,
  shareErrorFor,
  ShareError,
  shareRecipe,
  toSharedRecipe,
  type SharedRecipe,
} from '../src/lib/share/api';
import { availability, buildSharePayload, findContact, shareKeyOf, sharedIngredientsOf, sharedToRecipe } from '../src/lib/share/convert';
import { newUuid, SHARE_DEVICE_KEY, shareDeviceId } from '../src/lib/share/device';
import type { Recipe } from '../src/lib/types';
import { kv } from '../src/platform/storage';
import { sanitizeHistory } from '../src/store/history';
import { flushSharedUses, recordSharedUse, sanitizeShared, useShared } from '../src/store/shared';

const ROOT = path.resolve(import.meta.dirname, '..');
const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

interface Call {
  url: string;
  headers: Record<string, string>;
  body: any;
}
async function withFetch<T>(handler: (c: Call, n: number) => Response | Promise<Response>, fn: (calls: Call[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const c = { url: String(url), headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
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

const ROW = {
  id: '69ad18e3-9289-403f-99c8-cd8d2c534ffc',
  created_at: '2026-11-07T14:27:16.610695+00:00',
  name: '선셋 에이드',
  name_en: 'Sunset Ade',
  description: '상큼한 한 잔',
  comment: '달콤해요',
  nickname: '',
  ingredients: [
    { name: '오렌지주스', ml: 120, abv: 0, category: 'juice' },
    { name: '사이다', ml: 60, abv: 0, category: 'soda' },
  ],
  total_ml: '180.0',
  estimated_abv: '0.0',
  strength: 'none',
  flavor: { sweet: 4, sour: 2, bitter: 0, fizzy: 3, strength: 0 },
  garnish: '오렌지',
  tips: '',
  source: 'direct',
  ai_label: 'ChatGPT',
  use_count: 3,
  hidden: false,
  mine: false,
  used: true,
  total_count: 7,
};

// ───────────────────────── api ─────────────────────────

test('rpc·browseShared: Supabase RPC 주소·공개용 키 헤더·본문, 행 정리(숫자 글자→숫자), 전체 개수', async () => {
  assert.match(SHARE_API_URL, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
  assert.match(SHARE_API_KEY, /^sb_publishable_/, '비밀 키가 아니라 공개용 키');
  const r = await withFetch(
    () => json([ROW, { id: 'bad' }]),
    async (calls) => {
      const res = await browseShared('dev-1', { query: '  오렌지  ', limit: 5, alcohol: false });
      assert.equal(calls[0].url, `${SHARE_API_URL}/rest/v1/rpc/browse_shared_recipes`);
      assert.equal(calls[0].headers.apikey, SHARE_API_KEY);
      assert.deepEqual(calls[0].body, { p_device: 'dev-1', p_query: '오렌지', p_limit: 5, p_offset: 0, p_alcohol: false, p_mine: false });
      return res;
    },
  );
  assert.equal(r.items.length, 1, '모양이 틀린 행은 버림');
  assert.equal(r.total, 7);
  const s = r.items[0];
  assert.equal(s.totalMl, 180);
  assert.equal(s.estimatedAbv, 0);
  assert.equal(s.useCount, 3);
  assert.equal(s.aiLabel, 'ChatGPT');
  assert.equal(s.used, true);
  assert.equal(s.createdAt, Date.parse(ROW.created_at));
  const empty = await withFetch(() => json([]), () => browseShared(null, {}));
  assert.deepEqual(empty, { items: [], total: 0 });
});

test('서버 오류 → 코드·안내: 함수 오류 문구, 잘못된 값, 쉬는 서버(540), 연결 실패, HTML, 시간 초과', async () => {
  assert.equal(shareErrorFor(400, { code: 'P0001', message: 'DUPLICATE' }), 'DUPLICATE');
  assert.equal(shareErrorFor(400, { code: 'P0001', message: 'CONTACT' }), 'CONTACT');
  assert.equal(shareErrorFor(400, { code: '22P02', message: 'invalid input syntax for type uuid' }), 'INVALID');
  assert.equal(shareErrorFor(540, null), 'UNAVAILABLE');
  assert.equal(shareErrorFor(503, null), 'UNAVAILABLE');
  assert.equal(shareErrorFor(500, { message: 'boom' }), 'SERVER');
  await withFetch(
    () => json({ code: 'P0001', message: 'RATE_LIMIT' }, 400),
    () => assert.rejects(shareRecipe('d', {} as any), (e: any) => e instanceof ShareError && e.code === 'RATE_LIMIT' && /내일 다시/.test(e.message)),
  );
  await withFetch(
    () => {
      throw new TypeError('Failed to fetch');
    },
    () => assert.rejects(recordUse('d', 'x'), (e: any) => e.code === 'NETWORK'),
  );
  await withFetch(
    () => new Response('<html>wifi login</html>', { status: 200 }),
    () => assert.rejects(deleteShared('d', 'x'), (e: any) => e.code === 'NETWORK'),
  );
  await withFetch(
    (c) => new Promise<Response>(() => undefined),
    () => assert.rejects(rpc('browse_shared_recipes', {}, { timeoutMs: 20 }), (e: any) => e.code === 'TIMEOUT'),
  );
});

test('shareRecipe·recordUse·deleteShared: 본문과 돌려받는 값', async () => {
  await withFetch(
    (c) => {
      if (c.url.endsWith('/share_recipe')) return json({ id: 'new-id', estimatedAbv: 6.7, strength: 'medium' });
      if (c.url.endsWith('/use_shared_recipe')) return json(4);
      return json(true);
    },
    async (calls) => {
      assert.deepEqual(await shareRecipe('dev', { name: 'x' } as any), { id: 'new-id', estimatedAbv: 6.7, existing: false });
      assert.deepEqual(calls[0].body, { p_device: 'dev', p_recipe: { name: 'x' } });
      assert.equal(await recordUse('dev', 'rid'), 4);
      assert.deepEqual(calls[1].body, { p_device: 'dev', p_id: 'rid' });
      assert.equal(await deleteShared('dev', 'rid'), true);
    },
  );
});

// ───────────────────────── convert ─────────────────────────

const RECIPE: Recipe = {
  name: '  하이볼\n스페셜 ',
  nameEn: 'Highball',
  description: '시원한 한 잔',
  reason: '오늘 피곤하시다니 상큼하게 준비했어요 (개인 입력)',
  ingredients: [
    { pump: 3, name: '위스키', ml: 30 },
    { pump: 1, name: '사이다', ml: 150 },
  ],
  totalMl: 180,
  estimatedAbv: 6.7,
  flavor: { sweet: 2, sour: 1, bitter: 1, fizzy: 4, strength: 2 },
  garnish: '레몬',
  tips: '천천히 즐기세요',
  suggestions: [{ type: 'info', message: '펌프 3 잔량 부족' }],
};

test('buildSharePayload: 추천 이유·제안은 빼고, 글 정리, 별명·한마디, 만든 AI (예전 기록은 Gemini)', () => {
  const p = buildSharePayload({ recipe: RECIPE, source: 'direct' }, defaultSlots(), { nickname: '  홍당무 ', comment: '여름에 딱\n좋아요' });
  assert.equal(p.name, '하이볼 스페셜');
  assert.equal(p.comment, '여름에 딱 좋아요');
  assert.equal(p.nickname, '홍당무');
  assert.equal(p.aiLabel, 'Gemini', 'v3.1 이전 AI 기록은 Gemini');
  assert.ok(!('reason' in p) && !('suggestions' in p), '개인 입력(추천 이유)·제안은 올리지 않음');
  assert.ok(!JSON.stringify(p).includes('피곤'), '기분 문구 없음');
  assert.equal(buildSharePayload({ recipe: RECIPE, source: 'offline', aiLabel: 'ChatGPT' }, []).aiLabel, '', '오프라인 추천은 AI 이름 없음');
  assert.equal(buildSharePayload({ recipe: RECIPE, source: 'direct', aiLabel: 'Claude' }, []).aiLabel, 'Claude');
});

test('sharedIngredientsOf: 재료 종류·도수 — 만들 때 남긴 값 → 지금 장착된 같은 이름 → 모르면 완성 도수에 맞게 계산', () => {
  const slots = defaultSlots();
  // 남긴 값 우선
  const a = sharedIngredientsOf(RECIPE, slots, [{ name: '위스키', category: 'spirit', abv: 40 }]);
  assert.deepEqual(a[0], { name: '위스키', ml: 30, abv: 40, category: 'spirit' });
  assert.equal(a[1].category, 'soda', '사이다는 장착된 슬롯에서');
  assert.equal(a[1].abv, 0);
  // 위스키를 모르면: 6.7% × 180 = 1206 → 1206 / 30 = 40.2%
  const b = sharedIngredientsOf(RECIPE, slots);
  assert.equal(b[0].category, 'other');
  assert.equal(b[0].abv, 40.2);
  const total = b.reduce((s, i) => s + i.ml, 0);
  assert.ok(Math.abs(b.reduce((s, i) => s + i.ml * i.abv, 0) / total - 6.7) < 0.05, '완성 도수가 그대로');
  // 무알콜 레시피에 모르는 재료 → 0%
  assert.equal(sharedIngredientsOf({ ...RECIPE, estimatedAbv: 0 }, [])[0].abv, 0);
});

test('findContact·shareKeyOf: 링크·이메일·휴대폰 번호, 재료 순서가 달라도 같은 레시피', () => {
  assert.equal(findContact('맛있어요', '010-1234-5678 연락'), '010-1234-5678');
  assert.equal(findContact('www.example.com'), 'www.');
  assert.ok(findContact('메일 a.b@c.kr'));
  assert.equal(findContact('레몬 1/2 개, 2024년'), null);
  assert.equal(
    shareKeyOf({ name: '하이볼', ingredients: [{ pump: 1, name: '사이다', ml: 1 }, { pump: 2, name: '위스키', ml: 1 }] }),
    shareKeyOf({ name: ' 하이볼 ', ingredients: [{ pump: 4, name: '위스키', ml: 9 }, { pump: 3, name: '사이다', ml: 9 }] }),
  );
});

test('sharedToRecipe·availability: 펌프는 비워 두고(이름으로 찾음), 장착됨·없음·잔량 부족', () => {
  const s = toSharedRecipe(ROW) as SharedRecipe;
  const r = sharedToRecipe(s);
  assert.ok(r.ingredients.every((i) => i.pump === 0));
  assert.match(r.reason, /익명 바텐더님의 한마디: 달콤해요/);
  assert.deepEqual(r.suggestions, []);
  const slots = defaultSlots();
  const av = availability(s, slots);
  assert.equal(av.ready, true, '기본 재료(사이다·오렌지주스)는 장착돼 있음');
  const low = availability(s, slots.map((x) => (x.name === '사이다' ? { ...x, remainingMl: 10 } : x)));
  assert.equal(low.items.find((i) => i.ingredient.name === '사이다')!.low, true);
  const miss = availability(s, slots.filter((x) => x.name !== '오렌지주스'));
  assert.deepEqual(miss.missing, ['오렌지주스']);
  assert.equal(miss.ready, false);
});

// ───────────────────────── device · store ─────────────────────────

test('shareDeviceId: UUID v4 를 한 번 만들어 저장하고 계속 씀 (망가진 값이면 새로)', () => {
  kv.removeItem(SHARE_DEVICE_KEY);
  const a = shareDeviceId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(shareDeviceId(), a);
  kv.setItem(SHARE_DEVICE_KEY, 'junk');
  assert.notEqual(shareDeviceId(), 'junk');
  assert.notEqual(newUuid(), newUuid());
});

test('recordSharedUse: 기기에서 한 번만 보냄, 인터넷이 안 되면 기다렸다가 flush 로 다시, 지워진 레시피는 포기', async () => {
  useShared.setState({ counted: [], pendingUses: [] });
  let mode: 'ok' | 'down' | 'gone' = 'down';
  await withFetch(
    () => {
      if (mode === 'down') throw new TypeError('offline');
      if (mode === 'gone') return json({ code: 'P0001', message: 'NOT_FOUND' }, 400);
      return json(1);
    },
    async (calls) => {
      await recordSharedUse('r1');
      assert.deepEqual(useShared.getState().pendingUses, ['r1'], '못 보내면 기다림');
      assert.deepEqual(useShared.getState().counted, []);
      mode = 'ok';
      await flushSharedUses();
      assert.deepEqual(useShared.getState().pendingUses, []);
      assert.deepEqual(useShared.getState().counted, ['r1']);
      const n = calls.length;
      await recordSharedUse('r1');
      assert.equal(calls.length, n, '이미 센 레시피는 다시 보내지 않음');
      mode = 'gone';
      await recordSharedUse('r2');
      assert.ok(useShared.getState().counted.includes('r2'), '지워진 레시피는 다시 보내지 않음');
      assert.ok(!useShared.getState().pendingUses.includes('r2'));
    },
  );
  useShared.setState({ counted: [], pendingUses: [] });
});

test('sanitizeShared: 망가진 저장값 정리', () => {
  const s = sanitizeShared({ nickname: 'x'.repeat(40), mine: { k: { id: 'a', at: 'no' }, bad: { id: 3 } }, counted: ['a', 5, ''], reported: 'x' });
  assert.equal(s.nickname.length, 16);
  assert.deepEqual(s.mine, { k: { id: 'a', at: 0, name: '' } });
  assert.deepEqual(s.counted, ['a']);
  assert.deepEqual(s.reported, []);
});

test('기록: provider·sharedId·meta 를 남기고 불러옴 (모양이 틀린 값은 버림)', () => {
  const h = sanitizeHistory({
    entries: [
      {
        id: 'h1',
        createdAt: 1,
        recipe: RECIPE,
        source: 'direct',
        status: 'done',
        dispensed: [],
        provider: 'anthropic',
        sharedId: 'sid',
        meta: [{ name: '위스키', category: 'spirit', abv: 40 }, { name: 3 }, { name: '사이다', category: 'weird', abv: 0 }],
      },
      { id: 'h2', createdAt: 1, recipe: RECIPE, source: 'direct', status: 'done', dispensed: [], provider: 'skynet' },
    ],
  });
  assert.equal(h.entries[0].provider, 'anthropic');
  assert.equal(h.entries[0].sharedId, 'sid');
  assert.deepEqual(h.entries[0].meta, [
    { name: '위스키', category: 'spirit', abv: 40 },
    { name: '사이다', category: 'other', abv: 0 },
  ]);
  assert.equal(h.entries[1].provider, undefined);
});

// ───────────────────────── 배선 ─────────────────────────

test('배선: 공유 탭·라우트·탭 첫 화면, 실제 기기에서 만들 때만 사용 횟수(데모 제외), 기록에 공유 버튼', () => {
  assert.ok(TABS.some((t) => t.to === '/shared' && t.label === '공유'));
  const app = src('src/App.tsx');
  assert.match(app, /<Route path="shared" element={<SharedScreen \/>} \/>/);
  assert.match(app, /flushSharedUses\(\)/, '앱을 켤 때 못 보낸 사용 기록을 다시 보냄');
  assert.match(src('src/lib/nav.ts'), /ROOT_PATHS = new Set\(\['\/', '\/shared',/);
  const brew = src('src/lib/brew.ts');
  assert.match(brew, /if \(cur\.sharedId && useDevice\.getState\(\)\.transportKind !== 'demo'\) recordSharedUse\(cur\.sharedId\)/);
  const hist = src('src/screens/history/HistoryScreen.tsx');
  assert.match(hist, /onShare=\{e\.status === 'done' && !e\.sharedId \?/, '다 만든 잔만, 공유 레시피로 만든 잔은 다시 공유하지 않음');
});

test('설정 화면 톱니바퀴: 설정 화면에서는 숨기고, 같은 화면으로 가는 이동은 기록에 쌓지 않음(go)', () => {
  const app = src('src/App.tsx');
  assert.match(app, /pathname === '\/settings' \? null : \(/);
  assert.match(app, /onClick=\{\(\) => go\('\/settings'\)\}/);
  assert.ok(!/navigate\('\/settings'\)/.test(app), '바로 navigate 하지 않음');
  assert.match(src('src/lib/nav.ts'), /if \(!opts\?\.replace && isCurrent\(path\)\) return;/);
});

test('업데이트 창: 갤럭시는 "출처를 알 수 없는 앱 설치" 목록에서 AI 스마트 바텐더를 눌러 켜라고 안내', () => {
  const ui = src('src/components/UpdatePrompt.tsx');
  assert.match(ui, /"출처를 알 수 없는 앱 설치"<\/b> 목록이 열리면 목록에서 <b>AI 스마트 바텐더<\/b>를 눌러 켜요/);
  assert.match(src('src/lib/update.ts'), /목록이 열리면 AI 스마트 바텐더를 눌러 켜기/);
});

test('화면 문구: 사용자에게 보이는 글에 "Gemini 키"·"Gemini AI 추천" 같은 Gemini 전용 문구가 남지 않음', () => {
  for (const f of [
    'src/screens/home/HomeCards.tsx',
    'src/screens/recipe/RecipeParts.tsx',
    'src/screens/recipe/recipeLogic.ts',
    'src/screens/explore/exploreNotices.ts',
    'src/lib/flow.ts',
    'src/lib/ai/mode.ts',
    'src/screens/settings/AiSection.tsx',
  ]) {
    const code = src(f)
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n');
    assert.ok(!/Gemini (AI 추천|키|API 키|를 쓰지|에 연결|가 레시피|가 골라)/.test(code), `${f} 에 Gemini 전용 문구`);
  }
});
