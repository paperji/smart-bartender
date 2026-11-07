/// <reference types="node" />
/**
 * 앱 업데이트 (src/lib/update.ts · platform/capacitor/updater.ts · platform/electron/updater.ts · electron/updater.cjs · main.cjs)
 *  - GitHub 최신 릴리스 → 이 플랫폼 파일·SHA-256 이 있고 지금보다 높을 때만 추천 (주소는 이 저장소 릴리스만)
 *  - 확인 간격·"나중에"·"이 버전 건너뛰기", 기기 작업 중에는 추천·업데이트 안 함
 *  - 내려받기 → 설치 순서, (APK) 설치 허용이 꺼져 있으면 멈춤, 실패 안내
 *  - EXE 메인: 주소·이름·SHA-256 검사, SHA-256 이 다르면 파일을 남기지 않음, 내려받은 그 파일만 실행
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { installFakeDocument } from './stubs/document';

installFakeDocument();
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

async function mods() {
  const u = await import('../src/lib/update');
  const { APP_VERSION } = await import('../src/lib/appInfo');
  const { useDevice } = await import('../src/store/device');
  const [a, b, c] = APP_VERSION.split('.').map(Number);
  return { u, APP_VERSION, next: `${a}.${b}.${c + 1}`, useDevice };
}

const SHA = 'ab'.repeat(32);
function release(version: string, opts: { draft?: boolean; prerelease?: boolean; digest?: string | null; url?: string; name?: string } = {}) {
  const tag = `v${version}`;
  const apk = opts.name ?? `SmartBartender-${version}.apk`;
  return {
    tag_name: tag,
    name: `${tag} — 시험`,
    draft: !!opts.draft,
    prerelease: !!opts.prerelease,
    html_url: `https://github.com/paperji/smart-bartender/releases/tag/${tag}`,
    body: '설명\n\n## 바뀐 점\n- **연결 재시도**: 133 이면 다시\n- 업데이트 창 [자세히](https://x)\n- 셋째\n- 넷째\n\n## 받을 것\n- 아님',
    assets: [
      {
        name: apk,
        size: 6_385_000,
        digest: opts.digest === undefined ? `sha256:${SHA}` : opts.digest,
        browser_download_url: opts.url ?? `https://github.com/paperji/smart-bartender/releases/download/${tag}/${apk}`,
      },
      {
        name: `SmartBartender-${version}-portable.exe`,
        size: 113_000_000,
        digest: `sha256:${'cd'.repeat(32)}`,
        browser_download_url: `https://github.com/paperji/smart-bartender/releases/download/${tag}/SmartBartender-${version}-portable.exe`,
      },
    ],
  };
}
const okFetch = (json: unknown) => (async () => ({ ok: true, status: 200, json: async () => json })) as unknown as typeof fetch;

/** 업데이트 구현 대역 */
function fakeBackend(o: { canInstall?: boolean; failDownload?: string; target?: 'apk' | 'exe' } = {}) {
  const calls: string[] = [];
  const b = {
    target: o.target ?? ('apk' as const),
    calls,
    async download(asset: any, onProgress: (l: number, t: number) => void) {
      calls.push('download:' + asset.name);
      onProgress(1000, 4000);
      onProgress(4000, 4000);
      if (o.failDownload) throw new Error(o.failDownload);
      return '/cache/updates/' + asset.name;
    },
    async canInstall() {
      calls.push('canInstall');
      return o.canInstall !== false;
    },
    async openInstallSettings() {
      calls.push('openSettings');
    },
    async install(p: string) {
      calls.push('install:' + p);
    },
  };
  return b;
}

test('버전 비교·릴리스 노트 요약', async () => {
  const { u } = await mods();
  assert.deepEqual(u.parseVersion('v3.0.10'), [3, 0, 10]);
  assert.equal(u.parseVersion('3.0'), null);
  assert.equal(u.parseVersion('v3.0.1-beta'), null);
  assert.equal(u.isNewerVersion('3.0.10', '3.0.9'), true, '숫자로 비교 (문자열 비교면 틀림)');
  assert.equal(u.isNewerVersion('v3.1.0', '3.0.99'), true);
  assert.equal(u.isNewerVersion('3.0.2', '3.0.2'), false);
  assert.equal(u.isNewerVersion('3.0.1', '3.0.2'), false);
  assert.equal(u.isNewerVersion('x', '3.0.2'), false);
  assert.deepEqual(u.releaseHighlights(release('9.9.9').body), ['연결 재시도: 133 이면 다시', '업데이트 창 자세히', '셋째']);
  assert.deepEqual(u.releaseHighlights('바뀐 점 없음'), []);
});

test('릴리스 → 이 플랫폼 파일: APK·EXE 를 고르고, SHA-256·주소·이름·초안·시험판을 검사', async () => {
  const { u } = await mods();
  const apk = u.parseRelease(release('9.9.9'), 'apk')!;
  assert.equal(apk.version, '9.9.9');
  assert.equal(apk.asset.name, 'SmartBartender-9.9.9.apk');
  assert.equal(apk.asset.sha256, SHA);
  assert.equal(apk.asset.url, 'https://github.com/paperji/smart-bartender/releases/download/v9.9.9/SmartBartender-9.9.9.apk');
  assert.equal(u.parseRelease(release('9.9.9'), 'exe')!.asset.name, 'SmartBartender-9.9.9-portable.exe');
  assert.equal(u.parseRelease(release('9.9.9', { digest: null }), 'apk'), null, 'SHA-256 없으면 추천 안 함');
  assert.equal(u.parseRelease(release('9.9.9', { url: 'https://evil.example/SmartBartender-9.9.9.apk' }), 'apk'), null, '이 저장소 밖 주소');
  assert.equal(
    u.parseRelease(release('9.9.9', { url: 'https://github.com/someone/fork/releases/download/v9.9.9/SmartBartender-9.9.9.apk' }), 'apk'),
    null,
  );
  assert.equal(u.parseRelease(release('9.9.9', { name: 'SmartBartender-9.9.8.apk' }), 'apk'), null, '파일 이름 버전이 태그와 다름');
  assert.equal(u.parseRelease(release('9.9.9', { draft: true }), 'apk'), null);
  assert.equal(u.parseRelease(release('9.9.9', { prerelease: true }), 'apk'), null);
  assert.equal(u.parseRelease({ tag_name: 'latest' }, 'apk'), null);
});

test('자동 확인 간격: 6시간에 1번, "나중에"는 하루, 시계를 거꾸로 돌려도 다시 확인', async () => {
  const { u } = await mods();
  const H = 3600_000;
  const now = 1_000_000_000_000;
  assert.equal(u.shouldAutoCheck({ lastCheckAt: 0, snoozeUntil: 0, skipVersion: null, pendingPermission: null }, now), true);
  assert.equal(u.shouldAutoCheck({ lastCheckAt: now - 5 * H, snoozeUntil: 0, skipVersion: null, pendingPermission: null }, now), false);
  assert.equal(u.shouldAutoCheck({ lastCheckAt: now - 7 * H, snoozeUntil: 0, skipVersion: null, pendingPermission: null }, now), true);
  assert.equal(u.shouldAutoCheck({ lastCheckAt: 0, snoozeUntil: now + 2 * H, skipVersion: null, pendingPermission: null }, now), false, '나중에 → 그 동안 안 물음');
  assert.equal(u.shouldAutoCheck({ lastCheckAt: now + 10 * H, snoozeUntil: 0, skipVersion: null, pendingPermission: null }, now), true, '미래 시각(시계 되돌림)이면 확인');
  assert.equal(u.shouldAutoCheck({ lastCheckAt: 0, snoozeUntil: now + 30 * 24 * H, skipVersion: null, pendingPermission: null }, now), true, '이상하게 먼 미래의 "나중에"는 무시');
});

test('새 버전 확인: 높은 버전이면 추천 창, 같으면 조용히, 수동 확인은 "최신"·"이 기기용 파일 없음"·"실패"를 설정 줄에 알려 줌', async () => {
  const { u, APP_VERSION, next } = await mods();
  u.resetUpdateForTest();
  u.registerUpdater(fakeBackend());
  const info = await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  assert.equal(info?.version, next);
  assert.equal(u.useUpdate.getState().status, 'available');
  assert.equal(u.useUpdate.getState().open, true);
  u.resetUpdateForTest();
  assert.equal(await u.checkForUpdate({ fetchFn: okFetch(release(APP_VERSION)) }), null);
  assert.equal(u.useUpdate.getState().status, 'idle', '자동 확인은 조용히');
  assert.equal(u.useUpdate.getState().checkNote, null);
  const p = u.checkForUpdate({ manual: true, fetchFn: okFetch(release(APP_VERSION)) });
  assert.equal(u.useUpdate.getState().checking, true, '확인 중 표시');
  await p;
  assert.equal(u.useUpdate.getState().checking, false);
  assert.equal(u.useUpdate.getState().checkNote, u.latestNote());
  await u.checkForUpdate({ fetchFn: (async () => ({ ok: false, status: 403 })) as any });
  assert.equal(u.useUpdate.getState().checkNote, u.latestNote(), '자동 확인 실패는 아무것도 바꾸지 않음');
  await u.checkForUpdate({ manual: true, fetchFn: (async () => { throw new Error('offline'); }) as any });
  assert.equal(u.useUpdate.getState().status, 'idle', '확인 실패는 추천 창(오류 창)을 띄우지 않음');
  assert.equal(u.useUpdate.getState().checkNote, u.UPDATE_CHECK_FAILED_TEXT);
  const noApk = release(next);
  noApk.assets = noApk.assets.filter((a) => !a.name.endsWith('.apk'));
  await u.checkForUpdate({ manual: true, fetchFn: okFetch(noApk) });
  assert.equal(u.useUpdate.getState().checkNote, u.noFileNote(next), '새 버전인데 이 기기용 파일이 없으면 "최신"이라고 하지 않음');
  u.registerUpdater(null);
  u.resetUpdateForTest();
  assert.equal(await u.checkForUpdate({ manual: true, fetchFn: okFetch(release(next)) }), null, '웹(구현 없음)은 확인하지 않음');
});

test('"이 버전 건너뛰기"는 자동 확인에서만 빠지고, "나중에"는 하루 동안 자동 확인을 멈춤', async () => {
  const { u, next } = await mods();
  u.resetUpdateForTest();
  u.registerUpdater(fakeBackend());
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  u.skipUpdateVersion();
  assert.equal(u.useUpdate.getState().open, false);
  assert.equal(await u.checkForUpdate({ fetchFn: okFetch(release(next)) }), null, '건너뛴 버전은 자동으로 다시 안 물음');
  assert.equal((await u.checkForUpdate({ manual: true, fetchFn: okFetch(release(next)) }))?.version, next, '설정의 "업데이트 확인"은 알려 줌');
  u.resetUpdateForTest();
  u.registerUpdater(fakeBackend());
  const now = Date.now();
  await u.checkForUpdate({ fetchFn: okFetch(release(next)), now: now - 7 * 3600_000 });
  u.snoozeUpdate(now);
  assert.equal(await u.autoCheckForUpdate(now + 1000, okFetch(release(next))), null, '나중에 → 하루 동안 자동 확인 안 함');
  assert.equal((await u.autoCheckForUpdate(now + 25 * 3600_000, okFetch(release(next))))?.version, next);
  u.registerUpdater(null);
});

test('업데이트: 내려받기(진행률) → 설치, 설치 창을 닫았으면 다시 내려받지 않고 다시 설치', async () => {
  const { u, next } = await mods();
  u.resetUpdateForTest();
  const b = fakeBackend();
  u.registerUpdater(b);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  const progress: (number | null)[] = [];
  const off = u.useUpdate.subscribe((s) => progress.push(s.progress));
  await u.startUpdate();
  off();
  assert.deepEqual(b.calls, ['canInstall', `download:SmartBartender-${next}.apk`, `install:/cache/updates/SmartBartender-${next}.apk`]);
  assert.ok(progress.includes(0.25) && progress.includes(1), JSON.stringify(progress));
  assert.equal(u.useUpdate.getState().status, 'installing');
  await u.startUpdate(); // "설치 창 다시 열기"
  assert.equal(b.calls.filter((c) => c.startsWith('download')).length, 1, '다시 내려받지 않음');
  assert.equal(b.calls.filter((c) => c.startsWith('install')).length, 2);
  u.registerUpdater(null);
});

test('업데이트: (APK) 설치 허용이 꺼져 있으면 멈추고 설정 열기, 내려받기 실패·기기 작업 중은 안내', async () => {
  const { u, next, useDevice } = await mods();
  u.resetUpdateForTest();
  const b = fakeBackend({ canInstall: false });
  u.registerUpdater(b);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  assert.equal(u.useUpdate.getState().status, 'needs-permission');
  assert.deepEqual(b.calls, ['canInstall'], '허용 전에는 내려받지 않음');
  await u.openInstallPermission();
  assert.ok(b.calls.includes('openSettings'));

  u.resetUpdateForTest();
  u.registerUpdater(fakeBackend({ failDownload: '내려받은 파일이 원본과 달라요(SHA-256 불일치). 다시 시도해 주세요.' }));
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  assert.equal(u.useUpdate.getState().status, 'error');
  assert.match(String(u.useUpdate.getState().error), /SHA-256/);

  u.resetUpdateForTest();
  u.registerUpdater(fakeBackend({ failDownload: 'socket hang up' }));
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  assert.equal(u.useUpdate.getState().error, '업데이트하지 못했어요. 잠시 뒤 다시 시도해 주세요.', '영어 오류는 쉬운 안내로');

  u.resetUpdateForTest();
  const b2 = fakeBackend();
  u.registerUpdater(b2);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  useDevice.setState({ job: { id: 'r1', kind: 'make', status: 'running', totalMs: 5000, ackAt: Date.now(), pct: 10, pumps: [] } as any });
  try {
    const { useToast } = await import('../src/store/toast');
    await u.startUpdate();
    assert.equal(useToast.getState().message, u.UPDATE_BUSY_TEXT, '제조 중이면 토스트로 안내');
    assert.equal(u.useUpdate.getState().status, 'available', '추천 상태는 그대로');
    assert.deepEqual(b2.calls, [], '제조 중에는 내려받지도 않음');
    const { shouldShowUpdatePrompt } = u;
    const info = u.useUpdate.getState().info;
    for (const status of ['available', 'ready', 'needs-permission', 'downloading', 'installing', 'error'] as const) {
      assert.equal(shouldShowUpdatePrompt({ open: true, status, info }, true), false, `제조 중에는 어떤 업데이트 창도 안 보임 (${status}) — 비상 정지 버튼을 가리지 않게`);
      assert.equal(shouldShowUpdatePrompt({ open: true, status, info }, false), true, status);
    }
    assert.equal(shouldShowUpdatePrompt({ open: true, status: 'available', info }, false, true), false, '다른 창이 열려 있으면 새 버전 추천은 미룸');
    assert.equal(shouldShowUpdatePrompt({ open: true, status: 'ready', info }, false, true), false);
    assert.equal(shouldShowUpdatePrompt({ open: true, status: 'downloading', info }, false, true), false, '진행 중 창도 다른 창이 닫힌 뒤에 (내려받기는 계속)');
    assert.equal(shouldShowUpdatePrompt({ open: true, status: 'error', info }, false, true), false, '오류 창도 — Esc·뒤로 한 번에 두 창이 닫히지 않게');
    assert.equal(shouldShowUpdatePrompt({ open: false, status: 'available', info }, false), false);
  } finally {
    useDevice.setState({ job: null });
    u.registerUpdater(null);
  }
});

test('APK 구현: 플러그인에 주소·SHA-256·파일 이름을 넘기고 진행률을 전달, 끝나면 듣기를 해제', async () => {
  const { capacitorUpdater, setAppUpdaterForTest } = await import('../src/platform/capacitor/updater');
  const seen: any[] = [];
  let removed = false;
  let listener: ((e: any) => void) | null = null;
  setAppUpdaterForTest({
    async addListener(_ev: string, cb: (e: any) => void) {
      listener = cb;
      return { remove: async () => void (removed = true) } as any;
    },
    async download(o: any) {
      seen.push(o);
      listener?.({ loaded: 50, total: 100 });
      return { path: '/data/cache/updates/' + o.fileName };
    },
    async canInstall() {
      return { value: false };
    },
    async openInstallSettings() {},
    async install(o: any) {
      seen.push(o);
    },
  } as any);
  try {
    const prog: number[][] = [];
    const p = await capacitorUpdater.download(
      { name: 'SmartBartender-9.9.9.apk', url: 'https://github.com/paperji/smart-bartender/releases/download/v9.9.9/SmartBartender-9.9.9.apk', size: 100, sha256: SHA },
      (l, t) => prog.push([l, t]),
    );
    assert.equal(p, '/data/cache/updates/SmartBartender-9.9.9.apk');
    assert.deepEqual(seen[0], { url: 'https://github.com/paperji/smart-bartender/releases/download/v9.9.9/SmartBartender-9.9.9.apk', sha256: SHA, fileName: 'SmartBartender-9.9.9.apk' });
    assert.deepEqual(prog, [[50, 100]]);
    assert.equal(removed, true);
    assert.equal(await capacitorUpdater.canInstall!(), false);
    await capacitorUpdater.install(p);
    assert.deepEqual(seen[1], { path: p });
  } finally {
    setAppUpdaterForTest(null);
  }
});

test('EXE 구현: IPC 오류의 영어 앞부분을 떼고 한국어 안내만', async () => {
  const { ipcErrorText, createElectronUpdater } = await import('../src/platform/electron/updater');
  assert.equal(ipcErrorText(new Error("Error invoking remote method 'sb:update-download': Error: 잘못된 업데이트 파일 정보예요")), '잘못된 업데이트 파일 정보예요');
  assert.equal(createElectronUpdater(undefined), null, '브리지가 없으면(웹·옛 EXE) 업데이트 구현 없음');
  const u = createElectronUpdater({
    isElectron: true,
    updateDownload: async () => {
      throw new Error("Error invoking remote method 'sb:update-download': Error: 새 버전을 내려받지 못했어요. 인터넷 연결을 확인해 주세요.");
    },
    updateInstall: async () => true,
  } as any)!;
  await assert.rejects(u.download({ name: 'a', url: 'b', size: 0, sha256: SHA }, () => undefined), /^Error: 새 버전을 내려받지 못했어요/);
});

/** 조절 가능한 업데이트 구현 대역 — 내려받기를 원하는 때 끝낼 수 있음 */
function gatedBackend(o: { canInstall?: () => boolean; failInstallTimes?: number } = {}) {
  const calls: string[] = [];
  let release: ((p: string) => void) | null = null;
  let failInstall = o.failInstallTimes ?? 0;
  const b = {
    target: 'apk' as const,
    calls,
    finish(p?: string) {
      release?.(p ?? '/cache/updates/x.apk');
    },
    download(asset: any, onProgress: (l: number, t: number) => void) {
      calls.push('download:' + asset.name);
      onProgress(10, 100);
      return new Promise<string>((r) => (release = r));
    },
    async canInstall() {
      calls.push('canInstall');
      return o.canInstall ? o.canInstall() : true;
    },
    async openInstallSettings() {
      calls.push('openSettings');
    },
    async install(p: string) {
      calls.push('install:' + p);
      if (failInstall > 0) {
        failInstall--;
        throw new Error('설치 창을 열지 못했어요.');
      }
    },
  };
  return b;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(cond: () => boolean, n = 50) {
  for (let i = 0; i < n && !cond(); i++) await tick();
  assert.ok(cond(), 'waitFor 시간 초과');
}

test('업데이트: 두 번 눌러도 한 번만 내려받음, 내려받는 중 새 버전 확인은 상태를 덮어쓰지 않음', async () => {
  const { u, next } = await mods();
  u.resetUpdateForTest();
  const b = gatedBackend();
  u.registerUpdater(b);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  const p1 = u.startUpdate();
  const p2 = u.startUpdate();
  assert.equal(p1, p2, '같은 진행을 돌려줌');
  await tick();
  assert.equal(u.useUpdate.getState().status, 'downloading');
  const r = await u.checkForUpdate({ manual: true, fetchFn: okFetch(release(next)) });
  assert.equal(r?.version, next);
  assert.equal(u.useUpdate.getState().status, 'downloading', '확인이 내려받는 중 상태를 지우지 않음');
  assert.equal(u.useUpdate.getState().progress, 0.1);
  b.finish('/cache/updates/a.apk');
  await p1;
  assert.equal(b.calls.filter((c) => c.startsWith('download')).length, 1);
  assert.equal(u.useUpdate.getState().status, 'installing');
  u.registerUpdater(null);
});

test('업데이트: 창을 닫아 둔 채 다 받았거나 그사이 제조를 시작하면 바로 설치하지 않고 "받아 둠"으로 물어봄', async () => {
  const { u, next, useDevice } = await mods();
  u.resetUpdateForTest();
  const b = gatedBackend();
  u.registerUpdater(b);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  const p = u.startUpdate();
  await tick();
  u.hideUpdatePrompt();
  b.finish('/cache/updates/a.apk');
  await p;
  assert.equal(u.useUpdate.getState().status, 'ready');
  assert.equal(u.useUpdate.getState().open, true, '다 받으면 다시 물어봄');
  assert.ok(!b.calls.some((c) => c.startsWith('install')), '닫아 둔 채로는 설치 창을 띄우지 않음');
  await u.startUpdate(); // "지금 설치"
  assert.deepEqual(b.calls.filter((c) => c.startsWith('install') || c.startsWith('download')), [`download:SmartBartender-${next}.apk`, 'install:/cache/updates/a.apk']);

  u.resetUpdateForTest();
  const b2 = gatedBackend();
  u.registerUpdater(b2);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  const p2 = u.startUpdate();
  await tick();
  useDevice.setState({ job: { id: 'r1', kind: 'make', status: 'running', totalMs: 5000, ackAt: Date.now(), pct: 10, pumps: [] } as any });
  try {
    b2.finish('/cache/updates/b.apk');
    await p2;
    assert.equal(u.useUpdate.getState().status, 'ready', '제조 중에 다 받으면 설치하지 않음');
    assert.ok(!b2.calls.some((c) => c.startsWith('install')));
  } finally {
    useDevice.setState({ job: null });
    u.registerUpdater(null);
  }
});

test('업데이트: 설치 실패 → 다시 시도는 새로 내려받음, 같은 릴리스를 다시 확인해도 받아 둔 파일은 유지', async () => {
  const { u, next } = await mods();
  u.resetUpdateForTest();
  const b = gatedBackend({ failInstallTimes: 1 });
  u.registerUpdater(b);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  let p = u.startUpdate();
  await tick();
  b.finish('/cache/updates/a.apk');
  await p;
  assert.equal(u.useUpdate.getState().status, 'error');
  assert.equal(u.useUpdate.getState().path, null, '설치에 실패한 파일은 다시 쓰지 않음');
  p = u.startUpdate(); // "다시 시도"
  await tick();
  assert.equal(u.useUpdate.getState().status, 'downloading');
  b.finish('/cache/updates/b.apk');
  await p;
  assert.equal(u.useUpdate.getState().status, 'installing');
  assert.equal(b.calls.filter((c) => c.startsWith('download')).length, 2);

  // 받아 둔 상태(ready)에서 "나중에" → 같은 릴리스를 직접 확인하면 받아 둔 파일로 다시 물어봄
  u.resetUpdateForTest();
  const b2 = gatedBackend();
  u.registerUpdater(b2);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  p = u.startUpdate();
  await tick();
  u.hideUpdatePrompt();
  b2.finish('/cache/updates/c.apk');
  await p;
  u.snoozeUpdate();
  assert.equal(u.useUpdate.getState().open, false);
  assert.equal(u.useUpdate.getState().status, 'ready');
  await u.checkForUpdate({ manual: true, fetchFn: okFetch(release(next)) });
  assert.equal(u.useUpdate.getState().status, 'ready');
  assert.equal(u.useUpdate.getState().open, true, '직접 확인하면 받아 둔 업데이트를 다시 보여 줌');
  assert.equal(u.useUpdate.getState().path, '/cache/updates/c.apk');
  u.registerUpdater(null);
});

test('업데이트: 내려받기 실패 → 다시 시도 때 릴리스 정보(SHA-256)를 새로 읽음', async () => {
  const { u, next } = await mods();
  u.resetUpdateForTest();
  const shas: string[] = [];
  let fail = true;
  u.registerUpdater({
    target: 'apk',
    async download(asset) {
      shas.push(asset.sha256);
      if (fail) throw new Error('내려받은 파일이 원본과 달라요(SHA-256 불일치). 다시 시도해 주세요.');
      return '/cache/updates/' + asset.name;
    },
    async install() {},
  });
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  assert.equal(u.useUpdate.getState().status, 'error');
  const fixed = release(next, { digest: `sha256:${'ef'.repeat(32)}` });
  const prevFetch = globalThis.fetch;
  globalThis.fetch = okFetch(fixed);
  try {
    fail = false;
    await u.startUpdate();
  } finally {
    globalThis.fetch = prevFetch;
  }
  assert.deepEqual(shas, [SHA, 'ef'.repeat(32)], '바뀐 SHA-256 으로 다시 받음');
  assert.equal(u.useUpdate.getState().status, 'installing');
  u.registerUpdater(null);
});

test('수동 확인: 자동 확인이 도는 중에 눌러도 결과를 설정 줄에 알려 줌', async () => {
  const { u, APP_VERSION } = await mods();
  u.resetUpdateForTest();
  u.registerUpdater(fakeBackend());
  let resolve: (v: any) => void = () => undefined;
  const slow = (() => new Promise((r) => (resolve = r))) as unknown as typeof fetch;
  const auto = u.checkForUpdate({ fetchFn: slow });
  const manual = u.checkForUpdate({ manual: true, fetchFn: okFetch(release(APP_VERSION)) });
  assert.equal(u.useUpdate.getState().checking, true);
  resolve({ ok: true, status: 200, json: async () => release(APP_VERSION) });
  await Promise.all([auto, manual]);
  assert.equal(u.useUpdate.getState().checkNote, u.latestNote(), '자동 확인 결과를 수동 확인처럼 알려 줌');
  assert.equal(u.useUpdate.getState().checking, false);
  u.registerUpdater(null);
});

test('(APK) 설치 허용: 설정에 다녀오는 사이 앱이 다시 켜져도 허용됐으면 이어서 업데이트, "나중에"면 잊음', async () => {
  const { u, next } = await mods();
  u.resetUpdateForTest();
  let allowed = false;
  const b = gatedBackend({ canInstall: () => allowed });
  u.registerUpdater(b);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  assert.equal(u.useUpdate.getState().status, 'needs-permission');
  assert.equal(u.loadUpdatePrefs().pendingPermission?.version, next, '기다리는 표시를 저장');
  // 앱이 다시 켜짐 (화면 상태는 사라지고 저장한 표시만 남음)
  u.useUpdate.setState({ status: 'idle', info: null, open: false, path: null });
  assert.equal(await u.resumeAfterPermission(Date.now(), okFetch(release(next))), false, '아직 허용 안 함 → 그대로');
  allowed = true;
  const p = u.resumeAfterPermission(Date.now(), okFetch(release(next)));
  await waitFor(() => u.useUpdate.getState().status === 'downloading'); // 허용됐으면 바로 이어서 내려받음
  b.finish('/cache/updates/a.apk');
  assert.equal(await p, true);
  assert.equal(u.useUpdate.getState().status, 'installing');
  assert.equal(u.loadUpdatePrefs().pendingPermission, null);
  assert.equal(await u.resumeAfterPermission(Date.now(), okFetch(release(next))), false, '한 번만');

  u.resetUpdateForTest();
  allowed = false;
  u.registerUpdater(gatedBackend({ canInstall: () => allowed }));
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  u.snoozeUpdate();
  assert.equal(u.loadUpdatePrefs().pendingPermission, null, '"나중에"면 이어서 하지 않음');
  allowed = true;
  assert.equal(await u.resumeAfterPermission(Date.now(), okFetch(release(next))), false);
  u.registerUpdater(null);
});

test('(APK) 설치 허용 설정 화면을 열지 못하면 안내', async () => {
  const { u, next } = await mods();
  u.resetUpdateForTest();
  u.registerUpdater({
    target: 'apk',
    async download() {
      return 'x';
    },
    async canInstall() {
      return false;
    },
    async openInstallSettings() {
      throw new Error('ActivityNotFound');
    },
    async install() {},
  });
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  await u.openInstallPermission();
  assert.equal(u.useUpdate.getState().status, 'error');
  assert.match(String(u.useUpdate.getState().error), /출처를 알 수 없는 앱 설치/);
  u.registerUpdater(null);
});

// ───────────────────────── electron/updater.cjs ─────────────────────────

test('EXE 메인 updater.cjs: 이 저장소 릴리스 EXE 만, SHA-256 이 맞을 때만 저장(틀리면 파일을 남기지 않음)', async () => {
  const up = require(path.join(APP, 'electron', 'updater.cjs'));
  const url = 'https://github.com/paperji/smart-bartender/releases/download/v9.9.9/SmartBartender-9.9.9-portable.exe';
  const body = Buffer.from('fake exe bytes '.repeat(1000));
  const sha = createHash('sha256').update(body).digest('hex');
  assert.equal(up.validateUpdateRequest(url, sha, 'SmartBartender-9.9.9-portable.exe'), null);
  for (const [u2, s2, n2] of [
    ['https://evil.example/SmartBartender-9.9.9-portable.exe', sha, 'SmartBartender-9.9.9-portable.exe'],
    [url, sha, 'evil.exe'],
    [url, 'nothex', 'SmartBartender-9.9.9-portable.exe'],
    [url.replace('9.9.9-portable', '9.9.8-portable'), sha, 'SmartBartender-9.9.9-portable.exe'],
    [url + '?x=1', sha, 'SmartBartender-9.9.9-portable.exe'],
    [url, sha.toUpperCase(), 'SmartBartender-9.9.9-portable.exe'],
    [url + '#x', sha, 'SmartBartender-9.9.9-portable.exe'],
    ['https://github.com/paperji/smart-bartender/releases/download/v9.9.9/../v9.9.9/SmartBartender-9.9.9-portable.exe', sha, 'SmartBartender-9.9.9-portable.exe'],
    ['https://github.com/paperji/smart-bartender/releases/download/v9.9.9/%2e%2e/SmartBartender-9.9.9-portable.exe', sha, 'SmartBartender-9.9.9-portable.exe'],
    ['https://github.com/paperji/smart-bartender/releases/download/%2e%2e%2fv9.9.9/SmartBartender-9.9.9-portable.exe', sha, 'SmartBartender-9.9.9-portable.exe'],
    ['https://github.com/paperji/smart-bartender/releases/download/v9.9.9%2FSmartBartender-9.9.9-portable.exe', sha, 'SmartBartender-9.9.9-portable.exe'],
    ['https://github.com/paperji/smart-bartender/releases/download/x/v9.9.9/SmartBartender-9.9.9-portable.exe', sha, 'SmartBartender-9.9.9-portable.exe'],
    ['https://github.com/paperji/smart-bartender/releases/download/v9.9.8/SmartBartender-9.9.9-portable.exe', sha, 'SmartBartender-9.9.9-portable.exe'],
    ['https://GITHUB.com/paperji/smart-bartender/releases/download/v9.9.9/SmartBartender-9.9.9-portable.exe', sha, 'SmartBartender-9.9.9-portable.exe'],
    ['https://github.com:443/paperji/smart-bartender/releases/download/v9.9.9/SmartBartender-9.9.9-portable.exe', sha, 'SmartBartender-9.9.9-portable.exe'],
    ['https://user@github.com/paperji/smart-bartender/releases/download/v9.9.9/SmartBartender-9.9.9-portable.exe', sha, 'SmartBartender-9.9.9-portable.exe'],
  ])
    assert.ok(up.validateUpdateRequest(u2, s2, n2), `거절해야 함: ${u2} ${n2}`);
  assert.equal(up.validateUpdateRequest(url, sha, 'SmartBartender-9.9.9-portable.exe', '3.0.3'), null, '지금보다 높은 버전');
  assert.match(up.validateUpdateRequest(url, sha, 'SmartBartender-9.9.9-portable.exe', '9.9.9'), /새 버전이 아니에요/, '같은 버전 거절');
  assert.match(up.validateUpdateRequest(url, sha, 'SmartBartender-9.9.9-portable.exe', '10.0.0'), /새 버전이 아니에요/, '예전 버전으로 되돌리기 거절');

  const dir = mkdtempSync(path.join(tmpdir(), 'sb-upd-'));
  try {
    const dest = path.join(dir, 'SmartBartender-9.9.9-portable.exe');
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h === 'content-length' ? String(body.length) : null) },
      body: (async function* () {
        for (let i = 0; i < body.length; i += 4096) yield body.subarray(i, i + 4096);
      })(),
    });
    const prog: number[][] = [];
    let t = 0;
    const out = await up.downloadVerified({ url, sha256: sha, dest, fetchImpl: fakeFetch, onProgress: (l: number, tot: number) => prog.push([l, tot]), now: () => (t += 200) });
    assert.equal(out, dest);
    assert.ok(readFileSync(dest).equals(body));
    assert.ok(prog.length > 1 && prog.at(-1)![0] === body.length, '마지막 진행률 = 전체');
    assert.equal(existsSync(dest + '.download'), false);

    const dest2 = path.join(dir, 'SmartBartender-9.9.8-portable.exe');
    await assert.rejects(up.downloadVerified({ url, sha256: 'ee'.repeat(32), dest: dest2, fetchImpl: fakeFetch }), /SHA-256 불일치/);
    assert.equal(existsSync(dest2) || existsSync(dest2 + '.download'), false, '틀린 파일은 남기지 않음');
    await assert.rejects(up.downloadVerified({ url, sha256: sha, dest: dest2, fetchImpl: async () => ({ ok: false, status: 404 }) }), /찾지 못했어요\(HTTP 404\)/);
    await assert.rejects(up.downloadVerified({ url, sha256: sha, dest: dest2, fetchImpl: async () => ({ ok: false, status: 503 }) }), /받지 못했어요\(HTTP 503\)/);
    assert.equal(up.chooseUpdateDir(dir, 'C:/Downloads'), dir);
    assert.equal(up.chooseUpdateDir(path.join(dir, 'nope'), 'C:/Downloads'), 'C:/Downloads');
    assert.equal(up.chooseUpdateDir(undefined, 'C:/Downloads'), 'C:/Downloads');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EXE 메인 main.cjs: 다른 화면의 요청·잘못된 주소는 거절, 내려받은 그 파일이 아니면 실행하지 않음, CSP 에 api.github.com', async () => {
  const mainPath = path.join(APP, 'electron', 'main.cjs');
  const noop = () => undefined;
  const handles: Record<string, (...a: any[]) => any> = {};
  let webContents: any = null;
  class FakeWindow {
    webContents = { setWindowOpenHandler: noop, on: noop, once: noop, send: noop, isDestroyed: () => false, getURL: () => '' };
    once = noop;
    on = noop;
    setMenuBarVisibility = noop;
    isDestroyed = () => false;
    loadURL = noop;
    constructor() {
      webContents = this.webContents;
    }
  }
  let netCalls = 0;
  let cspHandler: any = null;
  const fake = {
    app: {
      isPackaged: true,
      commandLine: { appendSwitch: noop },
      setPath: noop,
      getPath: () => tmpdir(),
      setAppUserModelId: noop,
      requestSingleInstanceLock: () => true,
      releaseSingleInstanceLock: noop,
      on: noop,
      whenReady: () => Promise.resolve(),
      getVersion: () => '3.0.0',
      quit: noop,
      exit: noop,
    },
    BrowserWindow: FakeWindow,
    Menu: { setApplicationMenu: noop },
    Notification: class {},
    ipcMain: { on: noop, handle: (ch: string, fn: any) => (handles[ch] = fn) },
    net: { fetch: async () => { netCalls++; return { ok: false, status: 500 }; } },
    protocol: { registerSchemesAsPrivileged: noop, handle: (_s: string, fn: any) => (cspHandler = fn) },
    session: { defaultSession: { setPermissionRequestHandler: noop, setBluetoothPairingHandler: noop } },
    shell: { openExternal: async () => undefined },
  };
  const electronId = require.resolve('electron');
  const prev = require.cache[electronId];
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: fake } as any;
  delete require.cache[mainPath];
  try {
    require(mainPath);
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    delete require.cache[mainPath];
    if (prev) require.cache[electronId] = prev;
    else delete require.cache[electronId];
  }
  const fromApp = { sender: webContents };
  const good = ['https://github.com/paperji/smart-bartender/releases/download/v9.9.9/SmartBartender-9.9.9-portable.exe', SHA, 'SmartBartender-9.9.9-portable.exe'];
  await assert.rejects(handles['sb:update-download']({ sender: {} }, ...good), /forbidden/);
  await assert.rejects(handles['sb:update-download'](fromApp, 'https://evil.example/x.exe', SHA, 'SmartBartender-9.9.9-portable.exe'), /잘못된 업데이트/);
  assert.equal(netCalls, 0, '검사에 걸리면 내려받지 않음');
  await assert.rejects(handles['sb:update-download'](fromApp, ...good), /받지 못했어요\(HTTP 500\)/);
  assert.equal(netCalls, 1);
  await assert.rejects(handles['sb:update-install'](fromApp, 'C:/Windows/notepad.exe'), /찾지 못했어요/, '내려받은 파일이 아니면 실행 안 함');
  await assert.rejects(handles['sb:update-install']({ sender: {} }, 'x'), /forbidden/);
  if (existsSync(path.join(APP, 'dist', 'index.html')) && cspHandler) {
    const res = await cspHandler({ url: 'app://bartender/index.html' });
    assert.match(res.headers.get('content-security-policy') ?? '', /connect-src [^;]*https:\/\/api\.github\.com/);
  } else {
    assert.match(readFileSync(mainPath, 'utf8'), /connect-src 'self' [^"]*https:\/\/api\.github\.com/);
  }
});

test('EXE 메인 IPC 본체: 내려받기 → (같은 파일이면 다시 받지 않음) → 실행되면 0.3초 뒤 종료, 못 켜면 잠금을 되돌림, 폴더 권한 오류면 다운로드 폴더로', async () => {
  const up = require(path.join(APP, 'electron', 'updater.cjs'));
  const nodeFs = require('node:fs');
  const { EventEmitter } = require('node:events');
  const name = 'SmartBartender-9.9.9-portable.exe';
  const url = `https://github.com/paperji/smart-bartender/releases/download/v9.9.9/${name}`;
  const body = Buffer.from('new exe '.repeat(500));
  const sha = createHash('sha256').update(body).digest('hex');
  const root = mkdtempSync(path.join(tmpdir(), 'sb-ipc-'));
  const portable = path.join(root, 'portable');
  const downloads = path.join(root, 'dl');
  require('node:fs').mkdirSync(portable);
  require('node:fs').mkdirSync(downloads);
  let fetches = 0;
  const fetchImpl = async () => {
    fetches++;
    return { ok: true, status: 200, headers: { get: () => String(body.length) }, body: (async function* () { yield body; })() };
  };
  const log: string[] = [];
  let spawnMode: 'ok' | 'fail' = 'ok';
  const spawnImpl = (file: string, _a: string[], o: any) => {
    log.push(`spawn:${path.basename(file)}:${o.detached}`);
    const child = new EventEmitter();
    (child as any).unref = () => log.push('unref');
    setTimeout(() => (spawnMode === 'ok' ? child.emit('spawn') : child.emit('error', new Error('ENOENT'))), 1);
    return child;
  };
  const deps = {
    appVersion: () => '3.0.3',
    downloadsDir: () => downloads,
    portableDir: portable,
    portableFile: path.join(portable, 'SmartBartender-3.0.3-portable.exe'),
    fetchImpl,
    spawnImpl,
    send: () => undefined,
    releaseLock: () => log.push('release'),
    relock: () => log.push('relock'),
    quit: () => log.push('quit'),
  };
  const origOpen = nodeFs.promises.open;
  try {
    const ipc = up.createUpdateIpc(deps);
    await assert.rejects(ipc.download(url, sha, name.replace('9.9.9', '3.0.2')), /잘못된|새 버전이 아니에요/);
    const f = await ipc.download(url, sha, name);
    assert.equal(f, path.join(portable, name), 'portable EXE 옆에 저장');
    assert.equal(fetches, 1);
    assert.equal(await up.createUpdateIpc(deps).download(url, sha, name), f, '같은 파일(SHA-256 같음)이 이미 있으면');
    assert.equal(fetches, 1, '다시 받지 않음');
    await assert.rejects(ipc.install(path.join(portable, 'other.exe')), /찾지 못했어요/);
    spawnMode = 'fail';
    await assert.rejects(ipc.install(f), /실행하지 못했어요/);
    assert.deepEqual(log.splice(0), ['release', `spawn:${name}:true`, 'relock'], '못 켜면 단일 실행 잠금을 되돌리고 앱은 그대로');
    spawnMode = 'ok';
    assert.equal(await ipc.install(f), true);
    await new Promise((r) => setTimeout(r, 350));
    assert.deepEqual(log.splice(0), ['release', `spawn:${name}:true`, 'unref', 'quit'], '실행된 뒤에만 종료');

    // portable 폴더에 쓰다가 권한 오류 → 다운로드 폴더로 다시
    rmSync(f, { force: true });
    nodeFs.promises.open = async (p: string, ...rest: any[]) => {
      if (String(p).startsWith(portable) && String(p).endsWith('.download')) throw Object.assign(new Error('denied'), { code: 'EPERM' });
      return origOpen.call(nodeFs.promises, p, ...rest);
    };
    const f2 = await up.createUpdateIpc(deps).download(url, sha, name);
    assert.equal(f2, path.join(downloads, name));
    assert.ok(readFileSync(f2).equals(body));
  } finally {
    nodeFs.promises.open = origOpen;
    rmSync(root, { recursive: true, force: true });
  }
});

// ───────────────────────── 2차 검토 회귀 ─────────────────────────

test('버전 세 곳이 같음: package.json · APP_VERSION · build.gradle(versionName·versionCode) — 어긋나면 업데이트가 같은 버전을 계속 권함', async () => {
  const { APP_VERSION } = await mods();
  const pkg = JSON.parse(readFileSync(path.join(APP, 'package.json'), 'utf8'));
  const gradle = readFileSync(path.join(APP, 'android', 'app', 'build.gradle'), 'utf8');
  const name = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];
  const code = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1]);
  assert.equal(pkg.version, APP_VERSION);
  assert.equal(name, APP_VERSION);
  const [a, b, c] = APP_VERSION.split('.').map(Number);
  assert.equal(code, a * 10000 + b * 100 + c, 'versionCode = 주·부·수 (3.0.3 → 30003)');
});

test('릴리스 태그는 vX.Y.Z 만 (APK·EXE 내려받기 검사와 같은 규칙) — "v" 없는·앞자리 0 태그는 추천하지 않음', async () => {
  const { u, next } = await mods();
  const noV = release(next);
  noV.tag_name = next;
  for (const a of noV.assets) a.browser_download_url = a.browser_download_url.replace(`/v${next}/`, `/${next}/`);
  assert.equal(u.parseRelease(noV, 'apk'), null);
  assert.equal(u.parseRelease(noV, 'exe'), null);
  const [x, y, z] = next.split('.');
  const zero = release(next);
  zero.tag_name = `v${x}.${y}.0${z}`;
  for (const a of zero.assets) a.browser_download_url = a.browser_download_url.replace(`/v${next}/`, `/${zero.tag_name}/`);
  assert.equal(u.parseRelease(zero, 'apk'), null);
  u.resetUpdateForTest();
  u.registerUpdater(fakeBackend());
  await u.checkForUpdate({ manual: true, fetchFn: okFetch(noV) });
  assert.equal(u.useUpdate.getState().status, 'idle', '추천 창을 띄우지 않음');
  assert.equal(u.useUpdate.getState().checkNote, u.latestNote());
  u.registerUpdater(null);
});

test('(APK) 설치 허용: 창을 띄워 둔 채 30분이 지나도 허용하고 돌아오면 이어서, "설정 열기"는 기다림 시작 시각을 새로', async () => {
  const { u, next } = await mods();
  u.resetUpdateForTest();
  let allowed = false;
  const b = gatedBackend({ canInstall: () => allowed });
  u.registerUpdater(b);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  const at0 = u.loadUpdatePrefs().pendingPermission!.at;
  await new Promise((r) => setTimeout(r, 5));
  await u.openInstallPermission();
  assert.ok(u.loadUpdatePrefs().pendingPermission!.at > at0, '설정을 연 때부터 셈');
  allowed = true;
  const p = u.resumeAfterPermission(Date.now() + 40 * 60_000);
  await waitFor(() => u.useUpdate.getState().status === 'downloading');
  b.finish('/cache/updates/a.apk');
  assert.equal(await p, true, '같은 실행에서 창이 떠 있으면 시간 제한 없이 이어서');
  assert.equal(u.useUpdate.getState().status, 'installing');
  u.registerUpdater(null);
});

test('(APK) 설치 허용: 돌아온 순간 기기 작업 중이면 표시를 남기고, 끝난 뒤 "허용했어요, 계속"으로 이어서', async () => {
  const { u, next, useDevice } = await mods();
  u.resetUpdateForTest();
  let allowed = false;
  const b = gatedBackend({ canInstall: () => allowed });
  u.registerUpdater(b);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  allowed = true;
  useDevice.setState({ job: { id: 'r1', kind: 'clean', status: 'running', totalMs: 5000, ackAt: Date.now(), pct: 10, pumps: [] } as any });
  try {
    assert.equal(await u.resumeAfterPermission(), false, '작업 중이면 시작하지 않음');
    assert.equal(u.useUpdate.getState().status, 'needs-permission');
    assert.ok(u.loadUpdatePrefs().pendingPermission, '표시는 남김');
  } finally {
    useDevice.setState({ job: null });
  }
  const p = u.startUpdate(); // "허용했어요, 계속"
  await waitFor(() => u.useUpdate.getState().status === 'downloading');
  b.finish('/cache/updates/a.apk');
  await p;
  assert.equal(u.useUpdate.getState().status, 'installing');
  assert.equal(u.loadUpdatePrefs().pendingPermission, null);
  u.registerUpdater(null);
});

test('(APK) 앱이 다시 켜진 뒤: 고른 업데이트를 저장해 두어 인터넷 확인 없이 이어서(건너뛴 버전이어도), 옛 표시면 확인 실패 때 남겨 다음에', async () => {
  const { u, next } = await mods();
  const { kv } = await import('../src/platform/storage');
  const offline = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;

  // ① 저장한 정보로 이어서 (확인은 실패해도 됨)
  u.resetUpdateForTest();
  let allowed = false;
  const b = gatedBackend({ canInstall: () => allowed });
  u.registerUpdater(b);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  u.skipUpdateVersion();
  await u.checkForUpdate({ manual: true, fetchFn: okFetch(release(next)) }); // 건너뛴 버전을 직접 다시 띄움
  await u.startUpdate();
  assert.equal(u.useUpdate.getState().status, 'needs-permission');
  assert.equal(u.loadUpdatePrefs().pendingPermission?.info?.asset.sha256, SHA, '고른 업데이트 정보를 저장');
  u.useUpdate.setState({ status: 'idle', info: null, open: false, path: null }); // 앱이 다시 켜짐
  allowed = true;
  const p = u.resumeAfterPermission(Date.now(), offline);
  await waitFor(() => u.useUpdate.getState().status === 'downloading');
  b.finish('/cache/updates/a.apk');
  assert.equal(await p, true, '인터넷 확인 없이 이어서');
  assert.equal(u.useUpdate.getState().status, 'installing');
  assert.equal(u.loadUpdatePrefs().skipVersion, null, '진행하면 건너뛰기 표시는 지움');

  // ② 저장한 정보가 없는(또는 이상한) 표시: 확인 실패면 표시를 남겨 다음에, 확인되면 건너뛴 버전이어도 이어서
  u.resetUpdateForTest();
  const b2 = gatedBackend({ canInstall: () => true });
  u.registerUpdater(b2);
  kv.setItem('sb3.update', JSON.stringify({ skipVersion: next, pendingPermission: { version: next, at: Date.now(), info: { version: next, asset: { name: 'evil.apk' } } } }));
  assert.equal(u.loadUpdatePrefs().pendingPermission?.info, undefined, '규칙에 안 맞는 저장 정보는 버림');
  assert.equal(await u.resumeAfterPermission(Date.now(), offline), false);
  assert.ok(u.loadUpdatePrefs().pendingPermission, '확인 실패 → 표시를 남겨 다음에 다시');
  const p2 = u.resumeAfterPermission(Date.now(), okFetch(release(next)));
  await waitFor(() => u.useUpdate.getState().status === 'downloading');
  b2.finish('/cache/updates/b.apk');
  assert.equal(await p2, true);
  u.registerUpdater(null);
});

test('EXE: 새 EXE 가 확인한 뒤에 예전 EXE(바탕화면 바로 가기)를 다시 열면 6시간을 기다리지 않고 바로 확인', async () => {
  const { u, APP_VERSION, next } = await mods();
  const now = 1_000_000_000_000;
  const base = { lastCheckAt: now - 3600_000, snoozeUntil: 0, skipVersion: null, pendingPermission: null };
  assert.equal(u.shouldAutoCheck({ ...base, lastCheckVersion: APP_VERSION }, now), false, '같은 버전이 1시간 전에 확인 → 안 함');
  assert.equal(u.shouldAutoCheck({ ...base, lastCheckVersion: next }, now), true, '새 버전 EXE 가 확인한 시각 → 예전 EXE 는 바로 확인');
  assert.equal(u.shouldAutoCheck({ ...base, lastCheckVersion: null }, now), false, '예전 형식(버전 없음)은 그대로 간격 지킴');
  u.resetUpdateForTest();
  u.registerUpdater(fakeBackend({ target: 'exe' }));
  await u.checkForUpdate({ fetchFn: okFetch(release(APP_VERSION)) });
  assert.equal(u.loadUpdatePrefs().lastCheckVersion, APP_VERSION, '확인한 버전을 같이 저장');
  u.registerUpdater(null);
});

test('업데이트: 다시 시도 중 릴리스를 읽는 사이 창을 닫으면 다시 열지 않고 다 받은 뒤 "받아 둠"으로 물어봄, 기다리는 사이 건너뛰면 내려받지 않음', async () => {
  const { u, next } = await mods();
  u.resetUpdateForTest();
  let fail = true;
  const calls: string[] = [];
  u.registerUpdater({
    target: 'apk',
    async download(asset) {
      calls.push('download');
      if (fail) throw new Error('새 버전을 내려받지 못했어요. 인터넷 연결을 확인해 주세요.');
      return '/cache/updates/' + asset.name;
    },
    async install() {
      calls.push('install');
    },
  });
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  assert.equal(u.useUpdate.getState().status, 'error');
  fail = false;
  let resolveFetch: (v: any) => void = () => undefined;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise((r) => (resolveFetch = r))) as any;
  try {
    const p = u.startUpdate(); // "다시 시도" → 릴리스 다시 읽는 중
    assert.equal(u.useUpdate.getState().status, 'downloading', '누르자마자 진행 중으로 (같은 버튼을 또 누를 수 없음)');
    u.hideUpdatePrompt(); // "닫기"
    resolveFetch({ ok: true, status: 200, json: async () => release(next) });
    await p;
  } finally {
    globalThis.fetch = prevFetch;
  }
  assert.equal(u.useUpdate.getState().status, 'ready');
  assert.ok(!calls.includes('install'), '닫은 채로는 설치하지 않음');

  u.resetUpdateForTest();
  let resolveCan: (v: boolean) => void = () => undefined;
  const b2 = { target: 'apk' as const, calls: [] as string[], canInstall: () => new Promise<boolean>((r) => (resolveCan = r)), async download() { b2.calls.push('download'); return 'x'; }, async install() { b2.calls.push('install'); } };
  u.registerUpdater(b2);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  const p2 = u.startUpdate();
  u.skipUpdateVersion();
  resolveCan(true);
  await p2;
  assert.deepEqual(b2.calls, [], '건너뛰기를 누르면 내려받지 않음');
  assert.equal(u.useUpdate.getState().status, 'idle');
  u.registerUpdater(null);
});

test('업데이트: 다시 시도 때 그사이 더 새 버전이 나왔으면 그 버전을 받음 (지워진 예전 파일을 계속 받지 않음), 오류 상태에서도 "업데이트 확인" 가능', async () => {
  const { u, next } = await mods();
  const [a, b, c] = next.split('.').map(Number);
  const newer = `${a}.${b}.${c + 1}`;
  u.resetUpdateForTest();
  const names: string[] = [];
  let fail = true;
  u.registerUpdater({
    target: 'apk',
    async download(asset) {
      names.push(asset.name);
      if (fail) throw new Error('업데이트 파일을 찾지 못했어요(HTTP 404). 잠시 뒤 다시 확인해 주세요.');
      return '/cache/updates/' + asset.name;
    },
    async install() {},
  });
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  assert.match(String(u.useUpdate.getState().error), /HTTP 404/);
  fail = false;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = okFetch(release(newer));
  try {
    await u.startUpdate();
  } finally {
    globalThis.fetch = prevFetch;
  }
  assert.deepEqual(names, [`SmartBartender-${next}.apk`, `SmartBartender-${newer}.apk`]);
  assert.equal(u.useUpdate.getState().info?.version, newer);
  u.registerUpdater(null);
});

test('설정의 "새 버전 업데이트" 버튼: 기기 작업 중이면 끝난 뒤에 보인다고 안내', async () => {
  const { u, next, useDevice } = await mods();
  const { useToast } = await import('../src/store/toast');
  u.resetUpdateForTest();
  u.registerUpdater(fakeBackend());
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  u.hideUpdatePrompt();
  useToast.setState({ message: null });
  useDevice.setState({ job: { id: 'c1', kind: 'clean', status: 'running', totalMs: 5000, ackAt: Date.now(), pct: 10, pumps: [] } as any });
  try {
    u.openUpdatePrompt();
    assert.equal(useToast.getState().message, u.UPDATE_BUSY_TEXT);
    assert.equal(u.useUpdate.getState().open, true, '끝나면 보임');
  } finally {
    useDevice.setState({ job: null });
    u.registerUpdater(null);
  }
});

test('업데이트: 다 받았을 때 앱이 화면 뒤에 있거나 다른 창이 열려 있으면 설치 창을 바로 띄우지 않고 "받아 둠"', async () => {
  const { u, next } = await mods();
  const fake = installFakeDocument();
  for (const mode of ['background', 'dialog'] as const) {
    u.resetUpdateForTest();
    const b = gatedBackend();
    u.registerUpdater(b);
    await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
    const p = u.startUpdate();
    await tick();
    const doc = globalThis.document as any;
    if (mode === 'background') fake.emit('background');
    else doc.querySelector = (sel: string) => (sel === u.OTHER_DIALOG_SELECTOR ? {} : null);
    try {
      b.finish('/cache/updates/a.apk');
      await p;
      assert.equal(u.useUpdate.getState().status, 'ready', mode);
      assert.ok(!b.calls.some((c) => c.startsWith('install')), `${mode}: 설치 창을 띄우지 않음`);
    } finally {
      if (mode === 'background') fake.emit('active');
      else delete doc.querySelector;
    }
    await u.startUpdate(); // 돌아와서 "지금 설치"
    assert.equal(u.useUpdate.getState().status, 'installing', mode);
  }
  u.registerUpdater(null);
});

test('APK 구현: 진행이 멈추면 시간 초과(느려도 받는 중이면 계속)', async () => {
  const { capacitorUpdater, setAppUpdaterForTest, setDownloadTimeoutsForTest } = await import('../src/platform/capacitor/updater');
  let listener = null as ((e: any) => void) | null;
  let resolveDl: (v: any) => void = () => undefined;
  setAppUpdaterForTest({
    async addListener(_ev: string, cb: (e: any) => void) {
      listener = cb;
      return { remove: async () => undefined } as any;
    },
    download: () => new Promise((r) => (resolveDl = r)),
    async canInstall() {
      return { value: true };
    },
    async openInstallSettings() {},
    async install() {},
  } as any);
  setDownloadTimeoutsForTest(60, 10_000);
  try {
    const asset = { name: 'SmartBartender-9.9.9.apk', url: 'u', size: 100, sha256: SHA };
    await assert.rejects(capacitorUpdater.download(asset, () => undefined), /시간 초과/, '진행이 없으면 실패');
    const p = capacitorUpdater.download(asset, () => undefined);
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 40));
      listener?.({ loaded: i * 10, total: 100 });
    }
    resolveDl({ path: '/cache/updates/SmartBartender-9.9.9.apk' });
    assert.equal(await p, '/cache/updates/SmartBartender-9.9.9.apk', '조금씩이라도 받는 중이면 계속');
  } finally {
    setDownloadTimeoutsForTest();
    setAppUpdaterForTest(null);
  }
});

test('EXE 메인: 같은 파일을 두 번 받으라 해도 한 번만 받고 같은 경로, 멈춘 연결은 시간 초과, 파일 잠금은 잠시 뒤 다시', async () => {
  const up = require(path.join(APP, 'electron', 'updater.cjs'));
  const name = 'SmartBartender-9.9.9-portable.exe';
  const url = `https://github.com/paperji/smart-bartender/releases/download/v9.9.9/${name}`;
  const body = Buffer.from('exe '.repeat(4000));
  const sha = createHash('sha256').update(body).digest('hex');
  const root = mkdtempSync(path.join(tmpdir(), 'sb-ipc2-'));
  try {
    let fetches = 0;
    const slowFetch = async () => {
      fetches++;
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        body: (async function* () {
          for (let i = 0; i < body.length; i += 2000) {
            await new Promise((r) => setTimeout(r, 5));
            yield body.subarray(i, i + 2000);
          }
        })(),
      };
    };
    const deps = {
      appVersion: () => '3.0.3',
      downloadsDir: () => root,
      portableDir: undefined,
      portableFile: undefined,
      fetchImpl: slowFetch,
      spawnImpl: () => null,
      send: () => undefined,
      releaseLock: () => undefined,
      relock: () => undefined,
      quit: () => undefined,
    };
    const ipc = up.createUpdateIpc(deps);
    const [a, b] = await Promise.all([ipc.download(url, sha, name), ipc.download(url, sha, name)]);
    assert.equal(a, b);
    assert.equal(fetches, 1, '한 번만 받음');
    assert.ok(readFileSync(a).equals(body));
    assert.deepEqual(
      require('node:fs').readdirSync(root).filter((f: string) => f.endsWith('.download')),
      [],
      '임시 파일이 남지 않음',
    );

    // 멈춘 연결: 첫 조각 뒤 아무것도 오지 않음
    const stalled = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => '1000' },
      body: (async function* () {
        yield Buffer.from('x');
        await new Promise(() => undefined);
      })(),
    });
    const dest2 = path.join(root, 'SmartBartender-9.9.8-portable.exe');
    await assert.rejects(up.downloadVerified({ url, sha256: sha, dest: dest2, fetchImpl: stalled, idleMs: 50 }), /시간 초과/);
    assert.deepEqual(
      require('node:fs').readdirSync(root).filter((f: string) => f.endsWith('.download')),
      [],
      '시간 초과 뒤에도 임시 파일이 남지 않음',
    );
    await assert.rejects(up.downloadVerified({ url, sha256: sha, dest: dest2, fetchImpl: () => new Promise(() => undefined), idleMs: 50 }), /시간 초과/, '응답이 아예 안 와도');
    await assert.rejects(up.downloadVerified({ url, sha256: sha, dest: dest2, fetchImpl: async () => ({ ok: false, status: 404 }) }), /찾지 못했어요\(HTTP 404\)/);

    // 파일 잠금(EBUSY): Windows 에서는 잠시 뒤 다시
    let n = 0;
    const r = await up.retryFs(
      () => {
        if (++n < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        return 'ok';
      },
      { platform: 'win32' },
    );
    assert.equal(r, 'ok');
    assert.equal(n, 3);
    await assert.rejects(
      up.retryFs(
        () => {
          throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        },
        { platform: 'linux' },
      ),
      /busy/,
      'Windows 가 아니면 바로 실패',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('EXE 메인: 원인별 안내(HTTP 403·저장 실패·파일 사용 중), 예전 시도가 남긴 임시 파일 정리', async () => {
  const up = require(path.join(APP, 'electron', 'updater.cjs'));
  const nodeFs = require('node:fs');
  const name = 'SmartBartender-9.9.9-portable.exe';
  const url = `https://github.com/paperji/smart-bartender/releases/download/v9.9.9/${name}`;
  const body = Buffer.from('exe!'.repeat(3000));
  const sha = createHash('sha256').update(body).digest('hex');
  const okFetch2 = async () => ({ ok: true, status: 200, headers: { get: () => String(body.length) }, body: (async function* () { yield body; })() });
  const root = mkdtempSync(path.join(tmpdir(), 'sb-ipc3-'));
  const dest = path.join(root, name);
  try {
    await assert.rejects(up.downloadVerified({ url, sha256: sha, dest, fetchImpl: async () => ({ ok: false, status: 403 }) }), /받지 못했어요\(HTTP 403\)/);
    // 이름 바꾸기가 계속 EBUSY(백신이 잡고 있음) → "다른 프로그램이 쓰고 있어요", 임시 파일은 남기지 않음
    const origRename = nodeFs.renameSync;
    nodeFs.renameSync = () => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    };
    try {
      await assert.rejects(up.downloadVerified({ url, sha256: sha, dest, fetchImpl: okFetch2, platform: 'linux' }), /다른 프로그램\(백신 등\)이 쓰고 있어요/);
    } finally {
      nodeFs.renameSync = origRename;
    }
    assert.deepEqual(nodeFs.readdirSync(root).filter((f: string) => f.endsWith('.download')), []);
    // 예전 시도가 남긴 임시 파일(앱을 닫아 끊긴 것 등)은 다음 시도 때 정리
    nodeFs.writeFileSync(path.join(root, `${name}.1234-abcdef12.download`), 'old');
    nodeFs.writeFileSync(path.join(root, `${name}.download`), 'older');
    nodeFs.writeFileSync(path.join(root, 'keep.download'), 'other');
    assert.equal(await up.downloadVerified({ url, sha256: sha, dest, fetchImpl: okFetch2 }), dest);
    assert.deepEqual(nodeFs.readdirSync(root).sort(), [name, 'keep.download'].sort(), '다른 파일은 건드리지 않음');
    // 웹 ReadableStream 본문(net.fetch 와 같은 형식)도 받음
    const streamFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < body.length; i += 1000) c.enqueue(new Uint8Array(body.subarray(i, i + 1000)));
          c.close();
        },
      }),
    });
    const dest2 = path.join(root, 'SmartBartender-9.9.8-portable.exe');
    assert.equal(await up.downloadVerified({ url, sha256: sha, dest: dest2, fetchImpl: streamFetch }), dest2);
    assert.ok(readFileSync(dest2).equals(body));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(APK) 허용 뒤 앱이 다시 켜졌는데 기기 작업 중이면: 고른 업데이트 창을 되살려 두고(작업 중엔 숨김) 끝난 뒤 바로 진행', async () => {
  const { u, next, useDevice } = await mods();
  u.resetUpdateForTest();
  let allowed = false;
  const b = gatedBackend({ canInstall: () => allowed });
  u.registerUpdater(b);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  u.useUpdate.setState({ status: 'idle', info: null, open: false, path: null }); // 앱이 다시 켜짐
  allowed = true;
  useDevice.setState({ job: { id: 'r9', kind: 'make', status: 'running', totalMs: 5000, ackAt: Date.now(), pct: 10, pumps: [] } as any });
  try {
    assert.equal(await u.resumeAfterPermission(), false);
    const st = u.useUpdate.getState();
    assert.equal(st.status, 'available');
    assert.equal(st.info?.version, next, '저장한 업데이트를 되살림');
    assert.equal(u.shouldShowUpdatePrompt(st, true), false, '작업 중에는 숨김');
  } finally {
    useDevice.setState({ job: null });
  }
  assert.equal(u.shouldShowUpdatePrompt(u.useUpdate.getState(), false), true, '작업이 끝나면 보임');
  const p = u.startUpdate();
  await waitFor(() => u.useUpdate.getState().status === 'downloading');
  b.finish('/cache/updates/a.apk');
  await p;
  assert.equal(u.useUpdate.getState().status, 'installing');
  u.registerUpdater(null);
});

test('기다리는 사이 "나중에"를 누르면 그만(내려받지 않고 창도 다시 열지 않음), 직접 업데이트하면 "나중에"를 지움, EXE 설치 직전 확인 시각을 비움', async () => {
  const { u, next } = await mods();
  // ① canInstall 을 기다리는 사이 "나중에"
  u.resetUpdateForTest();
  let resolveCan: (v: boolean) => void = () => undefined;
  const calls: string[] = [];
  u.registerUpdater({
    target: 'apk',
    canInstall: () => new Promise<boolean>((r) => (resolveCan = r)),
    async download() {
      calls.push('download');
      return 'x';
    },
    async install() {
      calls.push('install');
    },
  });
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  const p = u.startUpdate();
  u.snoozeUpdate();
  resolveCan(true);
  await p;
  assert.deepEqual(calls, []);
  assert.equal(u.useUpdate.getState().open, false);
  assert.equal(u.useUpdate.getState().status, 'available');

  // ② "나중에" 뒤 같은 날 직접 업데이트(EXE) → "나중에" 지움, 설치 직전 lastCheckAt=0
  u.resetUpdateForTest();
  const exe = fakeBackend({ target: 'exe' });
  u.registerUpdater(exe);
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  u.snoozeUpdate();
  assert.ok(u.loadUpdatePrefs().snoozeUntil > 0);
  u.openUpdatePrompt();
  await u.startUpdate();
  assert.ok(exe.calls.some((c) => c.startsWith('install')));
  const prefs = u.loadUpdatePrefs();
  assert.equal(prefs.snoozeUntil, 0, '직접 업데이트하면 "나중에"는 끝');
  assert.equal(prefs.lastCheckAt, 0, '예전 EXE 를 다시 열면 곧바로 확인');
  assert.equal(u.shouldAutoCheck(prefs, Date.now()), true);
  u.registerUpdater(null);
});

test('EXE 메인: 쓰는 사이 시간 초과가 나도 처리 안 된 거절이 없음, 다른 버전의 남은 임시 파일도 정리', async () => {
  const up = require(path.join(APP, 'electron', 'updater.cjs'));
  const nodeFs = require('node:fs');
  const name = 'SmartBartender-9.9.9-portable.exe';
  const url = `https://github.com/paperji/smart-bartender/releases/download/v9.9.9/${name}`;
  const root = mkdtempSync(path.join(tmpdir(), 'sb-ipc4-'));
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  const origOpen = nodeFs.promises.open;
  try {
    // 쓰기가 느려(40ms) 그사이 시간 초과(20ms) → 본문 스트림은 중단 오류로 바뀜
    nodeFs.promises.open = async (...a: any[]) => {
      const fh = await origOpen.apply(nodeFs.promises, a);
      const w = fh.write.bind(fh);
      (fh as any).write = async (...b: any[]) => {
        await new Promise((r) => setTimeout(r, 40));
        return w(...b);
      };
      return fh;
    };
    const fetchImpl = async (_u: string, o: any) => {
      let ctl: any;
      const body = new ReadableStream({
        start(c) {
          ctl = c;
        },
        pull(c) {
          c.enqueue(new Uint8Array(1000));
        },
      });
      o?.signal?.addEventListener('abort', () => ctl.error(new DOMException('aborted', 'AbortError')));
      return { ok: true, status: 200, headers: { get: () => '100000' }, body };
    };
    await assert.rejects(up.downloadVerified({ url, sha256: 'ab'.repeat(32), dest: path.join(root, name), fetchImpl, idleMs: 20 }), /시간 초과/);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(unhandled, [], '처리 안 된 거절 없음');
  } finally {
    nodeFs.promises.open = origOpen;
    process.off('unhandledRejection', onUnhandled);
  }
  try {
    nodeFs.writeFileSync(path.join(root, 'SmartBartender-9.9.8-portable.exe.4321-0badc0de.download'), 'other version');
    nodeFs.writeFileSync(path.join(root, 'SmartBartender-9.9.8-portable.exe'), 'final exe of another version');
    up.removeStaleTemps(path.join(root, name), null);
    assert.deepEqual(nodeFs.readdirSync(root).sort(), ['SmartBartender-9.9.8-portable.exe'], '다른 버전의 임시 파일도 지우고 EXE 는 그대로');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(APK) 허용하고 돌아와 확인을 기다리는 사이 "나중에"를 누르면 그만 (내려받지 않고 "나중에"도 그대로)', async () => {
  const { u, next } = await mods();
  u.resetUpdateForTest();
  let allowed = false;
  let resolveCan: ((v: boolean) => void) | null = null;
  const calls: string[] = [];
  u.registerUpdater({
    target: 'apk',
    canInstall: () => (resolveCan === null && !allowed ? Promise.resolve(false) : new Promise<boolean>((r) => (resolveCan = r))),
    async download() {
      calls.push('download');
      return 'x';
    },
    async install() {
      calls.push('install');
    },
  });
  await u.checkForUpdate({ fetchFn: okFetch(release(next)) });
  await u.startUpdate();
  assert.equal(u.useUpdate.getState().status, 'needs-permission');
  allowed = true;
  const r = u.resumeAfterPermission();
  await tick();
  u.snoozeUpdate();
  resolveCan!(true);
  assert.equal(await r, false);
  assert.deepEqual(calls, []);
  assert.equal(u.useUpdate.getState().open, false);
  assert.ok(u.loadUpdatePrefs().snoozeUntil > Date.now(), '"나중에"는 그대로');
  u.registerUpdater(null);
});
