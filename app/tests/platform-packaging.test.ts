/// <reference types="node" />
/**
 * 웹·PWA·EXE·APK 포장 고침 확인 (PKG-1·2·4·8)
 *  - PKG-1: 새 버전 서비스 워커가 자리를 잡아도 기기 작업·AI 추천·실제 기기 연결 중에는 새로고침하지 않고, 처음 한가해질 때 1번
 *  - PKG-4: 서비스 워커 알림을 누르면 열린 앱 창으로(없으면 새로 엶) — public/sw-notify.js 를 가짜 서비스 워커 환경에서 실행
 *  - PKG-8: 배포 EXE(app.isPackaged)는 --dev-url·SB_DEV_URL 을 무시, 앱 HTML 에 CSP, 다른 출처의 권한 요청 거절
 *           (electron 모듈 대역으로 electron/main.cjs 를 Node 에서 읽음 — 창·네이티브 없음)
 *  - PKG-2: 서명 키가 없으면 안드로이드 빌드가 새 키를 몰래 만들지 않고 멈춤 (-NewKeystore 일 때만 만듦) — Windows PowerShell 로 실제 스크립트 실행(빌드 단계는 대역)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

import { appBusyForReload, reloadWhenIdle, resetReloadWhenIdleForTest } from '../src/platform/swUpdate';
import { useAiBusy } from '../src/store/aiBusy';
import { useDevice } from '../src/store/device';

const APP = path.join(import.meta.dirname, '..');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── PKG-1 ─────────────────────────

test('PKG-1: 새로고침하면 안 되는 때 — 기기 작업 중 · AI 추천 중 · 실제 기기 연결 중 (데모 연결은 괜찮음)', () => {
  const job = (status: string) => ({ status }) as any;
  const dev = (o: any) => ({ job: null, conn: 'idle', transportKind: 'web', ...o });
  assert.equal(appBusyForReload(dev({}), false), false);
  assert.equal(appBusyForReload(dev({}), true), true, 'AI 추천 중');
  assert.equal(appBusyForReload(dev({ job: job('running') }), false), true, '제조 중');
  assert.equal(appBusyForReload(dev({ job: job('pending') }), false), true);
  assert.equal(appBusyForReload(dev({ job: job('done') }), false), false);
  assert.equal(appBusyForReload(dev({ conn: 'connected' }), false), true, '실제 기기 연결 중');
  assert.equal(appBusyForReload(dev({ conn: 'reconnecting', transportKind: 'native' }), false), true);
  assert.equal(appBusyForReload(dev({ conn: 'connected', transportKind: 'demo' }), false), false, '데모는 새로고침해도 다시 연결');
  assert.equal(appBusyForReload(dev({ conn: 'disconnected' }), false), false);
});

test('PKG-1: reloadWhenIdle — 한가하면 곧바로, 바쁘면 처음 한가해질 때 1번만 (실제 기기·AI 상태 저장소로)', async () => {
  const reloads: number[] = [];
  const deps = {
    busy: () => appBusyForReload(useDevice.getState(), useAiBusy.getState().busy),
    subscribe(cb: () => void) {
      const a = useDevice.subscribe(cb);
      const b = useAiBusy.subscribe(cb);
      return () => {
        a();
        b();
      };
    },
    reload: () => reloads.push(Date.now()),
  };
  // 한가함 → 곧바로
  resetReloadWhenIdleForTest();
  useDevice.setState({ job: null, conn: 'idle', transportKind: 'web' });
  useAiBusy.setState({ busy: false });
  reloadWhenIdle(deps);
  assert.equal(reloads.length, 1);
  // 제조 중 + AI 추천 중 → 기다림
  resetReloadWhenIdleForTest();
  reloads.length = 0;
  useDevice.setState({ job: { status: 'running' } as any, conn: 'connected', transportKind: 'web' });
  useAiBusy.setState({ busy: true });
  reloadWhenIdle(deps);
  reloadWhenIdle(deps); // 여러 번 와도 1번
  assert.equal(reloads.length, 0);
  useDevice.setState({ job: { status: 'done' } as any });
  assert.equal(reloads.length, 0, '아직 AI 추천·연결 중');
  useAiBusy.setState({ busy: false });
  assert.equal(reloads.length, 0, '아직 실제 기기 연결 중');
  useDevice.setState({ conn: 'idle' });
  assert.equal(reloads.length, 1, '모두 끝나면 새로고침');
  useDevice.setState({ conn: 'connected' });
  useDevice.setState({ conn: 'idle' });
  assert.equal(reloads.length, 1, '새로고침은 1번만');
  resetReloadWhenIdleForTest();
  useDevice.setState({ job: null, conn: 'idle', transportKind: 'demo' });
});

test('PKG-1: main.tsx 가 registerSW 에 onNeedReload(reloadWhenIdle) 를 넘김 (autoUpdate 기본 동작은 바로 location.reload)', () => {
  const main = readFileSync(path.join(APP, 'src', 'main.tsx'), 'utf8');
  assert.match(main, /registerSW\(\{[^}]*onNeedReload:\s*\(\)\s*=>\s*reloadWhenIdle\(\)/);
});

// ───────────────────────── PKG-4 ─────────────────────────

/** public/sw-notify.js 를 가짜 서비스 워커 전역(self)에서 실행하고 notificationclick 을 흉내 */
async function clickNotification(windows: { url: string; focused?: boolean }[]) {
  const code = readFileSync(path.join(APP, 'public', 'sw-notify.js'), 'utf8');
  const listeners: Record<string, (e: any) => void> = {};
  const opened: string[] = [];
  const scope = 'https://example.test/smart-bartender/';
  const clients = windows.map((w) => ({
    url: w.url,
    focus: async () => {
      w.focused = true;
      return w;
    },
  }));
  const self: any = {
    registration: { scope },
    clients: {
      matchAll: async (o: any) => {
        assert.equal(o.type, 'window');
        assert.equal(o.includeUncontrolled, true);
        return clients;
      },
      openWindow: async (u: string) => {
        opened.push(u);
        return null;
      },
    },
    addEventListener: (name: string, cb: (e: any) => void) => {
      listeners[name] = cb;
    },
  };
  vm.runInNewContext(code, { self });
  assert.ok(listeners.notificationclick, 'notificationclick 처리기 등록');
  let closed = false;
  let work: Promise<unknown> = Promise.resolve();
  listeners.notificationclick({
    notification: {
      close: () => {
        closed = true;
      },
    },
    waitUntil: (p: Promise<unknown>) => {
      work = p;
    },
  });
  await work;
  return { closed, opened, scope };
}

test('PKG-4: 제조 알림을 누르면 알림을 닫고 열린 앱 창으로, 창이 없으면 앱을 새로 엶 (public/sw-notify.js)', async () => {
  const wins = [{ url: 'https://other.test/' }, { url: 'https://example.test/smart-bartender/#/brewing' }];
  const a = await clickNotification(wins);
  assert.equal(a.closed, true);
  assert.equal((wins[1] as any).focused, true, '앱 창으로 이동');
  assert.equal((wins[0] as any).focused, undefined);
  assert.deepEqual(a.opened, []);
  const b = await clickNotification([]);
  assert.deepEqual(b.opened, [b.scope], '창이 없으면 새로 엶');
});

test('PKG-4: vite.config 의 workbox 가 sw-notify.js 를 importScripts 로 불러옴', () => {
  const cfg = readFileSync(path.join(APP, 'vite.config.ts'), 'utf8');
  assert.match(cfg, /importScripts:\s*\[\s*'sw-notify\.js'\s*\]/);
  assert.ok(existsSync(path.join(APP, 'public', 'sw-notify.js')));
});

// ───────────────────────── PKG-8 ─────────────────────────

/** electron 모듈 대역으로 electron/main.cjs 를 읽고 앱 준비(whenReady)까지 실행 */
async function loadMain(opts: { isPackaged: boolean; devUrl?: string }) {
  const require = createRequire(import.meta.url);
  const mainPath = path.join(APP, 'electron', 'main.cjs');
  const loaded: string[] = [];
  const handlers: Record<string, (req: { url: string }) => Promise<Response>> = {};
  let permission: ((wc: any, p: string, cb: (ok: boolean) => void, d: any) => void) | null = null;
  const noop = () => undefined;
  class FakeWindow {
    webContents = { setWindowOpenHandler: noop, on: noop, once: noop, send: noop, isDestroyed: () => false, getURL: () => '' };
    once = noop;
    on = noop;
    setMenuBarVisibility = noop;
    isDestroyed = () => false;
    loadURL(u: string) {
      loaded.push(u);
    }
  }
  const fake = {
    app: {
      isPackaged: opts.isPackaged,
      commandLine: { appendSwitch: noop },
      setPath: noop,
      setAppUserModelId: noop,
      requestSingleInstanceLock: () => true,
      on: noop,
      whenReady: () => Promise.resolve(),
      getVersion: () => '3.0.0',
      quit: noop,
      exit: noop,
    },
    BrowserWindow: FakeWindow,
    Menu: { setApplicationMenu: noop },
    Notification: class {},
    ipcMain: { on: noop, handle: noop },
    protocol: { registerSchemesAsPrivileged: noop, handle: (s: string, fn: any) => (handlers[s] = fn) },
    session: {
      defaultSession: {
        setPermissionRequestHandler: (fn: any) => (permission = fn),
        setBluetoothPairingHandler: noop,
      },
    },
    shell: { openExternal: async () => undefined },
  };
  const electronId = require.resolve('electron');
  const prevElectron = require.cache[electronId];
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: fake } as any;
  delete require.cache[mainPath];
  const prevEnv = process.env.SB_DEV_URL;
  if (opts.devUrl) process.env.SB_DEV_URL = opts.devUrl;
  else delete process.env.SB_DEV_URL;
  try {
    require(mainPath);
    await wait(20); // whenReady().then(...)
  } finally {
    if (prevEnv === undefined) delete process.env.SB_DEV_URL;
    else process.env.SB_DEV_URL = prevEnv;
    delete require.cache[mainPath];
    if (prevElectron) require.cache[electronId] = prevElectron;
    else delete require.cache[electronId];
  }
  return { loaded, handlers, permission: permission as any };
}

test('PKG-8: 배포 EXE 는 SB_DEV_URL 을 무시하고 app://bartender 를 엶, 개발 실행은 개발 서버를 엶', async () => {
  const packaged = await loadMain({ isPackaged: true, devUrl: 'https://evil.example/' });
  assert.deepEqual(packaged.loaded, ['app://bartender/index.html']);
  assert.ok(packaged.handlers.app, '앱 주소(app://) 처리기 등록');
  const dev = await loadMain({ isPackaged: false, devUrl: 'http://localhost:5173/' });
  assert.deepEqual(dev.loaded, ['http://localhost:5173/']);
});

test('PKG-8: 앱 HTML 응답에 CSP(스크립트는 앱 파일만, 연결은 Gemini·Open-Meteo·새 버전 확인(api.github.com) 만), 다른 출처의 권한 요청은 거절', async () => {
  const { handlers, permission } = await loadMain({ isPackaged: true });
  const asked = (url: string) => {
    let ok: boolean | null = null;
    permission({ isDestroyed: () => false, getURL: () => url }, 'notifications', (v: boolean) => (ok = v), { requestingUrl: url });
    return ok;
  };
  assert.equal(asked('app://bartender/index.html#/device'), true);
  assert.equal(asked('https://evil.example/'), false);
  if (!existsSync(path.join(APP, 'dist', 'index.html'))) return; // 웹 빌드 전이면 CSP 응답은 건너뜀
  const res = await handlers.app({ url: 'app://bartender/index.html' });
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /(^|; )connect-src 'self' https:\/\/generativelanguage\.googleapis\.com https:\/\/api\.open-meteo\.com https:\/\/api\.github\.com(;|$)/);
  assert.match(csp, /object-src 'none'/);
  const traversal = await handlers.app({ url: 'app://bartender/..%2F..%2Fpackage.json' });
  assert.ok(traversal.status === 403 || traversal.status === 404, `dist 밖 파일은 막음 (${traversal.status})`);
});

// ───────────────────────── PKG-2 ─────────────────────────

const STUB_LIB = `
function Initialize-SbTools { param([string]$ToolsDir) return $env:TEMP }
function Get-SbVersion { param([string]$Dir) return '0.0.0-test' }
function Write-Step { param([string]$Text) Write-Host "==> $Text" }
function Invoke-Native { param([string]$Name, [scriptblock]$Block) Write-Host "NATIVE:$Name" }
function Format-Size { param($n) return "$n" }
function Sync-SbMirror { param($AppDir, $Mirror) throw 'STOP-AFTER-KEYSTORE' }
function Install-SbDeps { }
function Build-SbWeb { }
`;

function runAndroidBuild(keystoreFiles: string[], args: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), 'sb-pkg2-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'android', 'keystore'), { recursive: true });
    copyFileSync(path.join(APP, 'scripts', 'build-android.ps1'), path.join(root, 'scripts', 'build-android.ps1'));
    writeFileSync(path.join(root, 'scripts', 'lib-build.ps1'), STUB_LIB);
    for (const f of keystoreFiles) writeFileSync(path.join(root, 'android', 'keystore', f), 'test');
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'build-android.ps1'), ...args], {
      encoding: 'utf8',
      timeout: 60000,
    });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const hasPowerShell = process.platform === 'win32' && spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0']).status === 0;

test('PKG-2: 서명 키가 없으면 빌드가 멈추고 새 키를 만들지 않음, -NewKeystore 일 때만 새로 만듦, 반쪽 키면 멈춤', { skip: !hasPowerShell, timeout: 120000 }, () => {
  const none = runAndroidBuild([], []);
  assert.notEqual(none.status, 0);
  assert.match(none.out, /Release signing key not found/);
  assert.doesNotMatch(none.out, /NATIVE:make-keystore/, '새 키를 몰래 만들지 않음');
  const create = runAndroidBuild([], ['-NewKeystore']);
  assert.match(create.out, /NATIVE:make-keystore/, '-NewKeystore 면 만듦');
  assert.match(create.out, /STOP-AFTER-KEYSTORE/);
  const half = runAndroidBuild(['keystore.properties'], ['-NewKeystore']);
  assert.notEqual(half.status, 0);
  assert.match(half.out, /incomplete/);
  assert.doesNotMatch(half.out, /NATIVE:make-keystore/);
  const both = runAndroidBuild(['keystore.properties', 'release.keystore'], []);
  assert.doesNotMatch(both.out, /NATIVE:make-keystore|not found|incomplete/);
  assert.match(both.out, /STOP-AFTER-KEYSTORE/, '키가 있으면 다음 단계로');
});
