/**
 * Windows 앱(EXE) 메인 프로세스 — 같은 웹 빌드(dist/)를 Electron 창으로 엽니다 (WEBAPP_DESIGN §1·§7)
 *
 *  - app://bartender/ 전용 주소(표준·보안 스킴으로 등록)로 dist 를 엶 → ES 모듈·localStorage·Web Bluetooth(보안 컨텍스트 필요)가
 *    https 와 똑같이 동작. 서비스 워커는 쓰지 않음(웹에서만 등록 — src/platform/detect.ts)
 *  - Web Bluetooth: Electron 에는 기기 선택 창이 없어서 select-bluetooth-device 의 목록을 IPC 로 화면에 보내고
 *    앱 안 선택 창(src/platform/electron/BlePickerHost.tsx)에서 고른 기기로 callback(id), 취소면 callback('')
 *  - 바깥 링크(https:, mailto:)는 기본 브라우저로 (예: Google AI Studio 키 발급)
 *  - 창 1200×820 (최소 380×640), 메뉴 막대 없음. 단축키: F5·Ctrl+R 새로고침, Ctrl+±·0 확대/축소, F12·Ctrl+Shift+I 개발자 도구
 *
 * 실행 옵션
 *  --dev-url=http://localhost:5173  (또는 환경 변수 SB_DEV_URL) 개발 서버를 엶 (npm run electron:dev).
 *                                   설치·배포용 EXE(app.isPackaged)에서는 무시 — 바로가기·환경 변수로 다른 사이트를 앱 창에 열 수 없게
 *  --smoke-test [--smoke-out=파일] [--smoke-ble]  창을 띄우지 않고 앱이 그려지는지·navigator.bluetooth 등을 확인해 JSON 으로 남기고 종료
 */
'use strict';

const { app, BrowserWindow, Menu, Notification, ipcMain, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCHEME = 'app';
const HOST = 'bartender';
const APP_URL = `${SCHEME}://${HOST}/index.html`;
const DIST = path.resolve(__dirname, '..', 'dist');
const ICON = path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const TITLE = 'AI 스마트 바텐더';

const argv = process.argv.slice(1);
const argValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const SMOKE = argv.includes('--smoke-test');
const SMOKE_BLE = argv.includes('--smoke-ble');
const SMOKE_OUT = argValue('smoke-out');
// 개발 서버 주소는 개발 실행(electron . — 패키지 안 됨)에서만. 배포 EXE 는 늘 app://bartender (PKG-8)
const DEV_URL = app.isPackaged ? null : process.env.SB_DEV_URL || argValue('dev-url');

/**
 * 앱 화면(app://bartender 의 HTML)에 붙이는 콘텐츠 보안 정책 — 앱 파일·Gemini·Open-Meteo 만 (PKG-8)
 *  - 스크립트: 앱 파일만 (인라인·eval 없음). 스타일: 앱 파일 + 인라인 style 속성(React)
 *  - 연결: 앱 파일 + Gemini(generativelanguage.googleapis.com) + 날씨(api.open-meteo.com). Web Bluetooth 는 CSP 대상 아님
 *  - 다른 사이트를 틀 안에 넣거나(frame-ancestors) 다른 곳으로 양식을 보내지 못하게
 * 개발 서버(DEV_URL)는 Vite 가 인라인 스크립트를 쓰므로 붙이지 않음
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://generativelanguage.googleapis.com https://api.open-meteo.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// 표준·보안 스킴: 상대 경로·ES 모듈·fetch·localStorage·보안 컨텍스트(Web Bluetooth, Wake Lock) 가 https 처럼 동작
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
]);

// Windows 위치(날씨 자동 채우기): Windows 위치 서비스 사용 시도 (안 되면 앱이 "직접 선택" 으로 안내)
app.commandLine.appendSwitch('enable-features', 'WinrtGeolocationImplementation');

if (SMOKE) {
  // 점검 실행은 사용자 데이터(저장된 설정·키)를 건드리지 않게 임시 폴더 사용
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sb-smoke-')));
}
if (process.platform === 'win32') app.setAppUserModelId('kr.ac.anyang.hongdangmu.bartender');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (url.host !== HOST) return new Response('Not found', { status: 404 });
    let rel = decodeURIComponent(url.pathname || '/');
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.resolve(DIST, '.' + rel);
    if (file !== DIST && !file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      const ext = path.extname(file).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const headers = { 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
      if (ext === '.html') headers['content-security-policy'] = CSP;
      return new Response(data, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function isAppUrl(u) {
  if (DEV_URL) {
    try {
      return new URL(u).origin === new URL(DEV_URL).origin;
    } catch {
      return false;
    }
  }
  return typeof u === 'string' && u.startsWith(`${SCHEME}://${HOST}/`);
}

function openExternalSafe(u) {
  if (/^(https:|mailto:)/i.test(u)) shell.openExternal(u).catch(() => undefined);
}

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** select-bluetooth-device 의 대기 중 callback (requestDevice 1건당 1개) */
let bleCallback = null;

function finishBle(deviceId) {
  const cb = bleCallback;
  bleCallback = null;
  if (cb) {
    try {
      cb(deviceId || '');
    } catch {
      /* 이미 끝난 요청 */
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sb:ble-end');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 380,
    minHeight: 640,
    title: TITLE,
    icon: ICON,
    backgroundColor: '#F7F6F3',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWindow = win;
  win.setMenuBarVisibility(false);

  win.once('ready-to-show', () => {
    if (!SMOKE) win.show();
  });

  // 바깥 링크는 기본 브라우저로, 앱 창 안에서는 앱 주소만
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    openExternalSafe(url);
  });

  // Web Bluetooth 기기 선택 (목록은 찾을 때마다 다시 옴 → 화면의 선택 창이 갱신)
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    bleCallback = callback;
    const list = (devices || []).map((d) => ({ deviceId: String(d.deviceId), deviceName: String(d.deviceName || '') }));
    if (SMOKE) smoke.bleEvents++;
    if (!win.isDestroyed()) win.webContents.send('sb:ble-devices', list);
  });
  // 새로고침·화면 오류로 선택 창이 사라지면 대기 중인 요청을 취소
  win.webContents.on('did-start-navigation', (details) => {
    const d = details && typeof details === 'object' && 'isMainFrame' in details ? details : { isMainFrame: true, isSameDocument: false };
    // 화면 이동(#/device 등 해시 변경)은 같은 문서라 무시, 새로고침·다른 문서만
    if (d.isMainFrame && !d.isSameDocument && bleCallback) finishBle('');
  });
  win.webContents.on('render-process-gone', () => finishBle(''));

  // 메뉴 막대가 없으니 자주 쓰는 단축키만 직접 처리
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const key = String(input.key || '').toLowerCase();
    if (key === 'f5' || (ctrl && key === 'r')) {
      event.preventDefault();
      win.webContents.reload();
    } else if (key === 'f12' || (ctrl && input.shift && key === 'i')) {
      event.preventDefault();
      win.webContents.toggleDevTools();
    } else if (ctrl && (key === '=' || key === '+')) {
      event.preventDefault();
      win.webContents.setZoomLevel(Math.min(win.webContents.getZoomLevel() + 0.5, 3));
    } else if (ctrl && key === '-') {
      event.preventDefault();
      win.webContents.setZoomLevel(Math.max(win.webContents.getZoomLevel() - 0.5, -3));
    } else if (ctrl && key === '0') {
      event.preventDefault();
      win.webContents.setZoomLevel(0);
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    finishBle('');
  });

  if (SMOKE) attachSmoke(win);
  win.loadURL(DEV_URL || APP_URL);
  return win;
}

// ───────────────────────── IPC (preload.cjs) ─────────────────────────

const fromMain = (e) => mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents;

ipcMain.on('sb:get-version', (e) => {
  e.returnValue = app.getVersion();
});
ipcMain.on('sb:ble-choose', (e, id) => {
  if (fromMain(e)) finishBle(typeof id === 'string' ? id : '');
});
ipcMain.on('sb:ble-cancel', (e) => {
  if (fromMain(e)) finishBle('');
});
ipcMain.handle('sb:notify', (e, title, body) => {
  if (!fromMain(e)) return false;
  const win = mainWindow;
  // 창이 가려져 있으면 작업 표시줄 아이콘을 깜빡여 알림 (Windows 알림이 꺼져 있어도 보이게)
  if (win && !win.isFocused()) win.flashFrame(true);
  if (!Notification.isSupported()) return false;
  try {
    const n = new Notification({ title: String(title || TITLE), body: String(body || ''), icon: ICON, silent: false });
    n.on('click', () => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });
    n.show();
    return true;
  } catch {
    return false;
  }
});

// ───────────────────────── 점검 실행 (--smoke-test) ─────────────────────────

const smoke = { bleEvents: 0, consoleErrors: [], loadError: null };

function writeSmoke(result) {
  const text = JSON.stringify(result);
  console.log('SB-SMOKE ' + text);
  if (SMOKE_OUT) {
    try {
      fs.writeFileSync(SMOKE_OUT, text, 'utf8');
    } catch {
      /* ignore */
    }
  }
}

function attachSmoke(win) {
  const hardTimeout = setTimeout(() => {
    writeSmoke({ ok: false, error: 'timeout', ...smoke });
    app.exit(3);
  }, 45000);
  win.webContents.on('console-message', (...a) => {
    const d = a[0] && typeof a[0] === 'object' && 'message' in a[0] ? a[0] : { level: a[1], message: a[2] };
    const lvl = d.level;
    if (lvl === 'error' || lvl === 3) smoke.consoleErrors.push(String(d.message).slice(0, 300));
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    smoke.loadError = `${code} ${desc} ${url}`;
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      await new Promise((r) => setTimeout(r, 3000));
      const result = await win.webContents.executeJavaScript(
        `(async () => {
          const root = document.getElementById('root');
          let regs = [];
          try { regs = navigator.serviceWorker && navigator.serviceWorker.getRegistrations ? await navigator.serviceWorker.getRegistrations() : []; } catch (e) { regs = []; }
          let ls = false;
          try { localStorage.setItem('sb.smoke', '1'); ls = localStorage.getItem('sb.smoke') === '1'; localStorage.removeItem('sb.smoke'); } catch (e) {}
          let btAvailable = null;
          try { btAvailable = navigator.bluetooth && navigator.bluetooth.getAvailability ? await navigator.bluetooth.getAvailability() : null; } catch (e) { btAvailable = 'error: ' + e; }
          return {
            href: location.href,
            title: document.title,
            rootChildren: root ? root.childElementCount : 0,
            textSample: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
            secureContext: window.isSecureContext,
            bluetooth: typeof navigator.bluetooth,
            requestDevice: typeof (navigator.bluetooth && navigator.bluetooth.requestDevice),
            btAvailable,
            sbElectron: !!window.sbElectron,
            sbVersion: window.sbElectron ? window.sbElectron.version : null,
            serviceWorkers: regs.length,
            swControlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
            localStorage: ls,
            wakeLock: typeof navigator.wakeLock,
          };
        })()`,
      );
      if (SMOKE_BLE) {
        // 사용자 동작으로 requestDevice → 메인의 select-bluetooth-device → 화면의 선택 창이 뜨는지 → 취소
        result.ble = await win.webContents.executeJavaScript(
          `(async () => {
            const out = {};
            const p = navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'SmartBartender' }, { services: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] }], optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] })
              .then((d) => ({ picked: d && d.name }), (e) => ({ error: e && (e.name + ': ' + e.message) }));
            await new Promise((r) => setTimeout(r, 4000));
            const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).map((x) => (x.innerText || '').replace(/\\s+/g, ' ').slice(0, 120));
            out.dialogs = dlg;
            window.sbElectron && window.sbElectron.cancelBle && window.sbElectron.cancelBle();
            out.result = await Promise.race([p, new Promise((r) => setTimeout(() => r({ error: 'no result after cancel' }), 4000))]);
            return out;
          })()`,
          true,
        );
        result.ble.mainEvents = smoke.bleEvents;
      }
      const ok = !smoke.loadError && result.rootChildren > 0 && result.bluetooth === 'object' && result.sbElectron && result.secureContext;
      clearTimeout(hardTimeout);
      writeSmoke({ ok, electron: process.versions.electron, chrome: process.versions.chrome, version: app.getVersion(), ...result, ...smoke });
      app.exit(ok ? 0 : 2);
    } catch (e) {
      clearTimeout(hardTimeout);
      writeSmoke({ ok: false, error: e && (e.stack || e.message) ? String(e.stack || e.message) : JSON.stringify(e), ...smoke });
      app.exit(4);
    }
  });
}

// ───────────────────────── 시작 ─────────────────────────

const gotLock = SMOKE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    if (!DEV_URL) registerAppProtocol();
    // 권한 요청(알림·위치·화면 꺼짐 방지 등)은 앱 화면에서 온 것만 허락 (기본값은 모두 허락)
    session.defaultSession.setPermissionRequestHandler((wc, _permission, callback, details) => {
      const from = (details && details.requestingUrl) || (wc && !wc.isDestroyed() ? wc.getURL() : '');
      callback(isAppUrl(from));
    });
    // Windows 에서 기기가 페어링 확인을 요구하면 "확인"만 자동 수락 (PIN 입력이 필요한 기기는 지원 안 함 — SmartBartender 는 페어링 없음)
    if (typeof session.defaultSession.setBluetoothPairingHandler === 'function') {
      session.defaultSession.setBluetoothPairingHandler((details, callback) => {
        callback({ confirmed: details && details.pairingKind === 'confirm' });
      });
    }
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
