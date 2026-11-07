/**
 * 앱 업데이트 (APK·EXE) — 새 버전이 나오면 추천하고, 내려받아 설치까지 이어 줌
 *  - 새 버전 확인: GitHub Releases 의 최신 릴리스(https://api.github.com/repos/paperji/smart-bartender/releases/latest)
 *    · 태그(v3.0.3)가 지금 버전(APP_VERSION)보다 높고, 이 플랫폼 파일(APK 또는 portable EXE)과 SHA-256 이 있을 때만 "새 버전"
 *    · 앱을 켠 뒤·다시 앞으로 왔을 때 6시간에 1번까지만 (GitHub API 는 로그인 없이 시간당 60번)
 *    · "나중에" = 하루 동안 묻지 않음, "이 버전 건너뛰기" = 그 버전은 다시 묻지 않음(설정 › 앱 정보의 "업데이트 확인"은 언제나 확인)
 *  - 내려받기·설치는 플랫폼 구현(UpdaterBackend)이 함 — 이 저장소의 릴리스 파일 주소만, SHA-256 이 맞을 때만 설치
 *    · APK: 네이티브 플러그인(AppUpdaterPlugin.java)이 내려받고 안드로이드 설치 창을 띄움 → 사용자가 "업데이트"(또는 "설치")를 누름
 *      (안드로이드는 Play 스토어 밖 앱을 사용자 확인 없이 설치할 수 없음. 처음 1번은 설정에서 이 앱의 "이 출처 허용"을 켜야 함)
 *    · EXE: 메인 프로세스(electron/main.cjs)가 새 EXE 를 지금 EXE 옆(또는 다운로드 폴더)에 받고, 새 EXE 를 켠 뒤 이 창을 닫음
 *    · 웹·PWA: 등록된 구현 없음 — 서비스 워커가 새 버전을 자동으로 적용(platform/swUpdate.ts)
 *  - 제조·세척·구동 중에는 어떤 업데이트 창도 띄우지 않고(끝난 뒤), 업데이트도 시작·설치하지 않음 (설치하면 앱이 꺼져 결과를 놓침)
 */
import { create } from 'zustand';

import { APP_VERSION } from '@/lib/appInfo';
import { isAppActive, onAppStateChange } from '@/platform/appState';
import { kv } from '@/platform/storage';
import { isBusy, useDevice } from '@/store/device';
import { toast } from '@/store/toast';

export const UPDATE_REPO = 'paperji/smart-bartender';
export const LATEST_RELEASE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
/** 내려받을 수 있는 파일 주소 (이 저장소의 릴리스 파일만) */
export const UPDATE_DOWNLOAD_PREFIX = `https://github.com/${UPDATE_REPO}/releases/download/`;

export type UpdateTarget = 'apk' | 'exe';

export const ASSET_NAME: Record<UpdateTarget, RegExp> = {
  apk: /^SmartBartender-(\d+\.\d+\.\d+)\.apk$/,
  exe: /^SmartBartender-(\d+\.\d+\.\d+)-portable\.exe$/,
};

export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
  /** 소문자 16진수 64자 */
  sha256: string;
}

export interface UpdateInfo {
  version: string;
  tag: string;
  title: string;
  /** 릴리스 노트 "바뀐 점" 요약 (최대 3줄) */
  highlights: string[];
  pageUrl: string;
  asset: UpdateAsset;
}

/** 'v3.0.10' · '3.0.10' → [3,0,10]. 형식이 아니면 null */
export function parseVersion(v: unknown): number[] | null {
  if (typeof v !== 'string') return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** latest 가 current 보다 높은 버전인지 (형식이 틀리면 false) */
export function isNewerVersion(latest: unknown, current: unknown): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** 릴리스 노트에서 "바뀐 점" 아래 글머리표 줄을 짧게 (굵게 표시 등 마크다운 기호 제거) */
export function releaseHighlights(body: unknown, max = 3): string[] {
  if (typeof body !== 'string') return [];
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,3}\s*바뀐\s*점/.test(l.trim()));
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && out.length < max; i++) {
    const l = lines[i].trim();
    if (/^#{1,6}\s/.test(l)) break;
    const m = /^[-*]\s+(.*)$/.exec(l);
    if (!m) continue;
    let t = m[1].replace(/\*\*|__|`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
    if (t.length > 120) t = t.slice(0, 117) + '…';
    if (t) out.push(t);
  }
  return out;
}

/** 릴리스 태그 규칙: 'v' + 버전, 앞자리 0 없이 (APK·EXE 내려받기 검사 — AppUpdaterPlugin.java·electron/updater.cjs 와 같은 규칙) */
export const TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * GitHub 릴리스 JSON → 이 플랫폼용 업데이트 정보.
 * 초안·시험판·태그가 vX.Y.Z 가 아님·파일 없음·SHA-256 없음·주소가 이 저장소 밖이면 null (내려받기 검사에서 거절될 릴리스는 추천하지 않음)
 */
export function parseRelease(json: any, target: UpdateTarget): UpdateInfo | null {
  if (!json || typeof json !== 'object' || json.draft || json.prerelease) return null;
  if (typeof json.tag_name !== 'string' || !TAG_RE.test(json.tag_name)) return null;
  const v = parseVersion(json.tag_name);
  if (!v) return null;
  const version = v.join('.');
  const assets: any[] = Array.isArray(json.assets) ? json.assets : [];
  for (const a of assets) {
    const name = typeof a?.name === 'string' ? a.name : '';
    const m = ASSET_NAME[target].exec(name);
    if (!m || m[1] !== version) continue;
    const url = typeof a.browser_download_url === 'string' ? a.browser_download_url : '';
    if (url !== `${UPDATE_DOWNLOAD_PREFIX}${encodeURIComponent(json.tag_name)}/${name}`) continue;
    const dm = /^sha256:([0-9a-f]{64})$/i.exec(typeof a.digest === 'string' ? a.digest : '');
    if (!dm) continue;
    const size = Number(a.size);
    return {
      version,
      tag: json.tag_name,
      title: typeof json.name === 'string' && json.name.trim() ? json.name.trim() : `v${version}`,
      highlights: releaseHighlights(json.body),
      pageUrl: typeof json.html_url === 'string' && json.html_url.startsWith(`https://github.com/${UPDATE_REPO}/`) ? json.html_url : `https://github.com/${UPDATE_REPO}/releases/latest`,
      asset: { name, url, size: Number.isFinite(size) && size > 0 ? size : 0, sha256: dm[1].toLowerCase() },
    };
  }
  return null;
}

// ───────────────────────── 플랫폼 구현 ─────────────────────────

export interface UpdaterBackend {
  target: UpdateTarget;
  /** 내려받아 SHA-256 을 확인하고 저장한 경로를 돌려줌 (틀리면 오류) */
  download(asset: UpdateAsset, onProgress: (loaded: number, total: number) => void): Promise<string>;
  /** (APK) 이 앱이 다른 앱을 설치해도 되는지 — "이 출처의 앱 설치 허용" */
  canInstall?(): Promise<boolean>;
  /** (APK) 그 허용 설정 화면 열기 */
  openInstallSettings?(): Promise<void>;
  /** 설치 시작 (APK: 안드로이드 설치 창, EXE: 새 EXE 를 켜고 이 창을 닫음) */
  install(path: string): Promise<void>;
}

let backend: UpdaterBackend | null = null;

/** platform/boot.ts 가 APK·EXE 에서 등록 (웹은 등록하지 않음 — 서비스 워커가 자동 적용) */
export function registerUpdater(b: UpdaterBackend | null): void {
  backend = b;
}

export function updaterAvailable(): boolean {
  return !!backend;
}

// ───────────────────────── 확인 주기 ─────────────────────────

/** 자동 확인 간격 */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** "나중에" — 이만큼 다시 묻지 않음 */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;
const PREFS_KEY = 'sb3.update';

export interface UpdatePrefs {
  lastCheckAt: number;
  /** lastCheckAt 을 쓴 앱 버전 — 다른 버전이 쓴 시각이면 간격을 지키지 않고 확인 (EXE: 새 EXE 가 확인한 뒤 예전 EXE 를 다시 열어도 바로 알려 줌) */
  lastCheckVersion: string | null;
  snoozeUntil: number;
  skipVersion: string | null;
  /**
   * (APK) "이 출처 허용"을 켜러 설정 화면에 간 동안 — 돌아올 때 앱이 다시 켜져도 이어서 하려고 남김.
   * info = 그때 고른 업데이트(검사한 릴리스 정보) — 다시 켜진 뒤 인터넷 확인 없이 이어서
   */
  pendingPermission: { version: string; at: number; info?: UpdateInfo } | null;
}

/** 저장해 둔 업데이트 정보가 parseRelease 가 만든 것과 같은 규칙인지 (저장소가 바뀌었을 수도 있으니 다시 확인) */
function storedInfoOk(o: any): o is UpdateInfo {
  if (!o || typeof o !== 'object' || typeof o.version !== 'string' || !parseVersion(o.version)) return false;
  const a = o.asset;
  if (!a || typeof a.name !== 'string' || typeof a.url !== 'string' || typeof a.sha256 !== 'string') return false;
  const m = ASSET_NAME.apk.exec(a.name) ?? ASSET_NAME.exe.exec(a.name);
  if (!m || m[1] !== o.version) return false;
  if (a.url !== `${UPDATE_DOWNLOAD_PREFIX}v${o.version}/${a.name}`) return false;
  if (!/^[0-9a-f]{64}$/.test(a.sha256) || !Number.isFinite(a.size)) return false;
  return Array.isArray(o.highlights) && typeof o.title === 'string' && typeof o.tag === 'string' && typeof o.pageUrl === 'string';
}

export function loadUpdatePrefs(): UpdatePrefs {
  try {
    const o = JSON.parse(kv.getItem(PREFS_KEY) ?? '{}');
    const pp = o?.pendingPermission;
    return {
      lastCheckAt: Number.isFinite(o?.lastCheckAt) ? o.lastCheckAt : 0,
      lastCheckVersion: typeof o?.lastCheckVersion === 'string' ? o.lastCheckVersion : null,
      snoozeUntil: Number.isFinite(o?.snoozeUntil) ? o.snoozeUntil : 0,
      skipVersion: typeof o?.skipVersion === 'string' ? o.skipVersion : null,
      pendingPermission:
        pp && typeof pp.version === 'string' && Number.isFinite(pp.at)
          ? { version: pp.version, at: pp.at, ...(storedInfoOk(pp.info) && pp.info.version === pp.version ? { info: pp.info } : {}) }
          : null,
    };
  } catch {
    return { lastCheckAt: 0, lastCheckVersion: null, snoozeUntil: 0, skipVersion: null, pendingPermission: null };
  }
}

function saveUpdatePrefs(p: Partial<UpdatePrefs>): void {
  kv.setItem(PREFS_KEY, JSON.stringify({ ...loadUpdatePrefs(), ...p }));
}

/** 자동 확인을 할 때인지 (시계를 거꾸로 돌린 경우도 확인). 다른 버전의 앱이 확인한 시각이면 간격과 상관없이 확인 */
export function shouldAutoCheck(p: Omit<UpdatePrefs, 'lastCheckVersion'> & { lastCheckVersion?: string | null }, now: number, version = APP_VERSION): boolean {
  if (p.snoozeUntil > now && p.snoozeUntil - now <= SNOOZE_MS) return false;
  if (p.lastCheckVersion && p.lastCheckVersion !== version) return true;
  return !(p.lastCheckAt > 0 && now - p.lastCheckAt >= 0 && now - p.lastCheckAt < CHECK_INTERVAL_MS);
}

// ───────────────────────── 상태 ─────────────────────────

export type UpdateStatus =
  | 'idle'
  | 'available'
  | 'needs-permission'
  | 'downloading'
  /** 다 받아 두었고 설치만 남음 (창을 닫아 둔 채 다 받았거나, 그사이 제조를 시작함) */
  | 'ready'
  | 'installing'
  | 'error';

export interface UpdateState {
  /** 추천 창의 단계 */
  status: UpdateStatus;
  info: UpdateInfo | null;
  /** 내려받은 비율 0~1 (크기를 모르면 null) */
  progress: number | null;
  /** 추천 창에 보일 오류 */
  error: string | null;
  /** 추천 창을 보여 줄지 (닫으면 false) */
  open: boolean;
  /** 내려받아 SHA-256 을 확인한 파일 경로 (설치 창을 닫았을 때 다시 설치용) */
  path: string | null;
  /** 설정 › 앱 정보 "업데이트 확인" 중 */
  checking: boolean;
  /** 설정 › 앱 정보 "업데이트 확인" 결과 문구 (최신·이 기기용 파일 없음·확인 실패). 새 버전이면 null(추천 창이 열림) */
  checkNote: string | null;
}

const initial: UpdateState = {
  status: 'idle',
  info: null,
  progress: null,
  error: null,
  open: false,
  path: null,
  checking: false,
  checkNote: null,
};
export const useUpdate = create<UpdateState>(() => ({ ...initial }));
const set = (p: Partial<UpdateState>) => useUpdate.setState(p);

/** 테스트용 */
export function resetUpdateForTest(): void {
  useUpdate.setState({ ...initial });
  checking = null;
  manualWaiting = false;
  updating = null;
  lastFailure = null;
  kv.removeItem(PREFS_KEY);
}

export const UPDATE_BUSY_TEXT = '제조·세척이 끝난 뒤에 업데이트할 수 있어요.';
export const UPDATE_CHECK_FAILED_TEXT = '새 버전을 확인하지 못했어요. 인터넷 연결을 확인해 주세요.';
export const UPDATE_GENERIC_FAILED_TEXT = '업데이트하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
export const latestNote = (v = APP_VERSION) => `최신 버전이에요 (v${v}).`;
export const noFileNote = (v: string) => `새 버전 v${v} 이 공개됐지만 이 기기용 파일이 아직 없어요. 잠시 뒤 다시 확인해 주세요.`;

const deviceBusy = () => isBusy(useDevice.getState().job);
const IN_FLIGHT: UpdateStatus[] = ['downloading', 'ready', 'installing'];
/** 업데이트 창(.update-prompt) 말고 다른 모달 창이 열려 있는지 (components/UpdatePrompt.tsx 와 같은 기준) */
export const OTHER_DIALOG_SELECTOR = '[aria-modal="true"]:not(.update-prompt)';
function otherDialogOpen(): boolean {
  return typeof document !== 'undefined' && typeof document.querySelector === 'function' && !!document.querySelector(OTHER_DIALOG_SELECTOR);
}

let checking: Promise<UpdateInfo | null> | null = null;
/** 자동 확인이 도는 중에 "업데이트 확인"을 누름 → 그 결과를 수동 확인처럼 알려 줌 */
let manualWaiting = false;
let updating: Promise<void> | null = null;
/** 마지막 실패 단계 — 설치 실패면 다시 시도 때 새로 내려받음, 내려받기 실패면 릴리스 정보(SHA-256)를 새로 읽음 */
let lastFailure: 'download' | 'install' | null = null;

async function fetchRelease(fetchFn: typeof fetch): Promise<any> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = setTimeout(() => ctrl?.abort(), 10000);
  try {
    const res = await fetchFn(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl?.signal } as RequestInit);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const defaultFetch = (): typeof fetch | null => (typeof fetch === 'function' ? fetch.bind(globalThis) : null);

/**
 * 새 버전 확인. manual=true(설정의 "업데이트 확인")면 건너뛴 버전도 다시 알려 주고, 결과(최신·이 기기용 파일 없음·실패)를 checkNote 로 남김.
 * resume=true(설치 허용 뒤 이어서)는 사용자가 이미 고른 업데이트라 건너뛴 버전도 보고, 설정 줄 문구는 남기지 않음.
 * 자동 확인은 조용히(실패해도 아무것도 안 보임). 내려받는 중·받아 둔 뒤·설치 중에는 그 상태를 덮어쓰지 않음
 */
export function checkForUpdate(opts: { manual?: boolean; resume?: boolean; fetchFn?: typeof fetch; now?: number } = {}): Promise<UpdateInfo | null> {
  if (!backend) return Promise.resolve(null);
  const manual = !!opts.manual;
  if (manual) {
    manualWaiting = true;
    set({ checking: true, checkNote: null });
  }
  if (checking) return checking;
  const target = backend.target;
  const fetchFn = opts.fetchFn ?? defaultFetch();
  const run = (async (): Promise<UpdateInfo | null> => {
    let json: any;
    try {
      if (!fetchFn) throw new Error('no fetch');
      json = await fetchRelease(fetchFn);
    } catch {
      if (manualWaiting) set({ checkNote: UPDATE_CHECK_FAILED_TEXT });
      return null;
    }
    const wasManual = manualWaiting;
    saveUpdatePrefs({ lastCheckAt: opts.now ?? Date.now(), lastCheckVersion: APP_VERSION });
    const st = useUpdate.getState();
    const info = parseRelease(json, target);
    const newer = !!info && isNewerVersion(info.version, APP_VERSION);
    const sameRelease = !!info && st.info?.version === info.version && st.info.asset.sha256 === info.asset.sha256;
    if (IN_FLIGHT.includes(st.status) || (st.status === 'needs-permission' && st.open && (!info || sameRelease))) {
      // 이미 업데이트를 진행 중 — 상태는 그대로 (다른 버전이 새로 나왔어도 지금 것을 마침).
      // 받아 둔 채 닫혀 있으면(직접 확인했거나, "나중에"가 지나 자동 확인) 다시 물어봄
      if (wasManual || (st.status === 'ready' && !st.open)) {
        set({ open: true, checkNote: null });
        if (wasManual && deviceBusy()) toast(UPDATE_BUSY_TEXT, 'warning');
      }
      return st.info;
    }
    if (info && newer && (wasManual || opts.resume || loadUpdatePrefs().skipVersion !== info.version)) {
      const keepPath = sameRelease ? st.path : null;
      if (!sameRelease) lastFailure = null;
      set({ status: keepPath ? 'ready' : 'available', info, error: null, open: true, progress: keepPath ? 1 : null, path: keepPath, checkNote: null });
      // 직접 확인했는데 기기 작업 중이면 창은 끝난 뒤에 보임 → 지금은 안내만
      if (wasManual && deviceBusy()) toast(UPDATE_BUSY_TEXT, 'warning');
      return info;
    }
    if (wasManual) {
      // 태그 규칙(vX.Y.Z)은 parseRelease 와 같게 — 규칙에 안 맞는 릴리스는 "최신"으로
      const tag = typeof json?.tag_name === 'string' ? json.tag_name : '';
      const tagV = TAG_RE.test(tag) ? parseVersion(tag) : null;
      const tagNewer = !!tagV && isNewerVersion(tagV.join('.'), APP_VERSION) && !json?.draft && !json?.prerelease;
      set({ checkNote: !info && tagNewer ? noFileNote(tagV!.join('.')) : latestNote() });
    }
    if (st.status === 'available' || st.status === 'error' || st.status === 'needs-permission') set({ status: 'idle', open: false });
    return null;
  })().finally(() => {
    checking = null;
    manualWaiting = false;
    set({ checking: false });
  });
  checking = run;
  return run;
}

/** 앱 시작·다시 앞으로 왔을 때: 정해진 간격이 지났으면 조용히 확인 */
export function autoCheckForUpdate(now = Date.now(), fetchFn?: typeof fetch): Promise<UpdateInfo | null> {
  if (!backend) return Promise.resolve(null);
  if (!shouldAutoCheck(loadUpdatePrefs(), now)) return Promise.resolve(null);
  return checkForUpdate({ fetchFn, now });
}

/** 창을 닫거나 미루면 늘어남 — 기다리던 단계(릴리스 다시 읽기·설치 허용 확인)가 끝난 뒤 창을 억지로 다시 열지 않게 */
let gen = 0;
/** "나중에"·"건너뛰기"만 늘어남 — 기다리는 사이 이걸 눌렀으면 업데이트를 그만둠("닫기"는 받기를 계속) */
let dismissGen = 0;

/** "나중에" — 하루 동안 자동으로 묻지 않음 (받아 둔 파일은 그대로) */
export function snoozeUpdate(now = Date.now()): void {
  gen++;
  dismissGen++;
  saveUpdatePrefs({ snoozeUntil: now + SNOOZE_MS, pendingPermission: null });
  const st = useUpdate.getState();
  set({ open: false, ...(st.status === 'error' || st.status === 'needs-permission' ? { status: st.path ? ('ready' as const) : ('available' as const) } : {}) });
}

/** "이 버전 건너뛰기" */
export function skipUpdateVersion(): void {
  gen++;
  dismissGen++;
  const v = useUpdate.getState().info?.version;
  saveUpdatePrefs({ ...(v ? { skipVersion: v } : {}), pendingPermission: null });
  set({ open: false, status: 'idle', path: null });
}

/** 추천 창 다시 열기 (설정 화면). 기기 작업 중이면 끝난 뒤에 보인다고 안내 */
export function openUpdatePrompt(): void {
  if (!useUpdate.getState().info) return;
  set({ open: true });
  if (deviceBusy()) toast(UPDATE_BUSY_TEXT, 'warning');
}

/** 추천 창 닫기만 (내려받기는 계속 — 다 받으면 "받아 둠"으로 다시 물어봄) */
export function hideUpdatePrompt(): void {
  gen++;
  set({ open: false });
}

/**
 * 추천 창을 보여 줄지 (components/UpdatePrompt.tsx)
 *  - 기기 작업(제조·세척·구동) 중에는 어떤 업데이트 창도 띄우지 않음 — 비상 정지 버튼을 가리지 않게. 끝나면 다시 보임
 *  - 다른 창(확인 창·성인 확인·기기 찾기 등)이 열려 있으면 그 창이 닫힌 뒤에 — 한 화면에 창이 겹치지 않게 (내려받기는 그대로 계속)
 */
export function shouldShowUpdatePrompt(
  st: Pick<UpdateState, 'open' | 'status' | 'info'>,
  deviceBusyNow: boolean,
  otherDialogOpenNow = false,
): boolean {
  if (!st.open || !st.info || deviceBusyNow || otherDialogOpenNow) return false;
  return (
    st.status === 'available' ||
    st.status === 'ready' ||
    st.status === 'needs-permission' ||
    st.status === 'downloading' ||
    st.status === 'installing' ||
    st.status === 'error'
  );
}

/**
 * 내려받기 실패 뒤 다시 시도: 릴리스 정보를 조용히 새로 읽음 (실패하면 그대로)
 *  - 같은 버전이면 SHA-256 등만 바꿈, 그사이 더 새 버전이 나왔으면 그 버전으로 (지워진 예전 파일을 계속 받지 않게)
 */
async function refreshInfo(): Promise<void> {
  const b = backend;
  const fetchFn = defaultFetch();
  const cur = useUpdate.getState().info;
  if (!b || !fetchFn || !cur) return;
  try {
    const info = parseRelease(await fetchRelease(fetchFn), b.target);
    saveUpdatePrefs({ lastCheckAt: Date.now(), lastCheckVersion: APP_VERSION });
    if (!info) return;
    if (info.version === cur.version) set({ info });
    else if (isNewerVersion(info.version, APP_VERSION)) set({ info, path: null, progress: null });
  } catch {
    /* 그대로 */
  }
}

/**
 * "업데이트"·"지금 설치"·"다시 시도"·"계속" — 내려받기 → (SHA-256 확인) → 설치. 한 번에 하나만 (두 번 눌러도 한 번)
 *  - 기기 작업 중이면 시작하지 않음(토스트 안내)
 *  - (APK) "이 출처 허용"이 꺼져 있으면 needs-permission 으로 멈춤 → 설정에서 켜고 돌아오면 이어서 (앱이 꺼졌다 켜져도)
 *  - 다 받았을 때 창을 닫아 두었거나, 그사이 제조를 시작했거나, 다른 창이 열려 있거나, 앱이 화면 뒤에 있으면
 *    바로 설치하지 않고 'ready' (사용자가 "지금 설치"를 눌러야 — 안드로이드는 화면 뒤에서 설치 창을 띄울 수 없음)
 */
export function startUpdate(): Promise<void> {
  if (updating) return updating;
  updating = runUpdate().finally(() => {
    updating = null;
  });
  return updating;
}

/** 지금 바로 설치 창을 띄워도 되는지 */
const canInstallNow = () => !deviceBusy() && useUpdate.getState().open && !otherDialogOpen() && isAppActive();

async function runUpdate(): Promise<void> {
  const b = backend;
  if (!b || !useUpdate.getState().info) return;
  if (deviceBusy()) {
    toast(UPDATE_BUSY_TEXT, 'warning');
    return;
  }
  const d = dismissGen;
  const before = useUpdate.getState().status;
  if (lastFailure === 'install') set({ path: null });
  if (lastFailure === 'download') {
    // 릴리스를 다시 읽는 동안(최대 10초) 같은 버튼을 또 누르거나 "건너뛰기"를 누르지 못하게 바로 진행 중으로
    set({ status: 'downloading', progress: null, error: null });
    await refreshInfo();
    if (dismissGen !== d) {
      // 기다리는 사이 "나중에"·"건너뛰기" → 그만 (다시 시도할 수 있게 실패 표시는 남김)
      if (useUpdate.getState().status === 'downloading') set({ status: 'error' });
      return;
    }
  }
  lastFailure = null;
  const info = useUpdate.getState().info!;
  try {
    const allowed = b.canInstall ? await b.canInstall() : true;
    // 기다리는 사이 "나중에"·"건너뛰기"를 눌렀으면 그만 (창을 다시 열지 않음)
    if (dismissGen !== d) return;
    if (!allowed) {
      // 설정 화면에서 돌아올 때 앱이 다시 켜져도 이어서 하도록 표시를 남김 (startUpdateChecks)
      saveUpdatePrefs({ pendingPermission: { version: info.version, at: Date.now(), info } });
      set({ status: 'needs-permission', error: null, open: true });
      // "허용했어요, 계속"을 눌렀는데 아직 꺼져 있음
      if (before === 'needs-permission') toast('아직 "이 출처 허용"이 꺼져 있어요. 설정에서 켠 뒤 다시 눌러 주세요.', 'warning');
      return;
    }
    // 사용자가 이 버전을 골랐으므로 예전에 건너뛴 표시·허용 대기 표시·"나중에"는 지움
    // ("나중에"가 남으면 새 EXE 의 첫 확인과 예전 EXE 의 재알림을 하루 동안 막음)
    const prefs = loadUpdatePrefs();
    saveUpdatePrefs({ pendingPermission: null, snoozeUntil: 0, ...(prefs.skipVersion === info.version ? { skipVersion: null } : {}) });
    let path = useUpdate.getState().path;
    if (!path) {
      set({ status: 'downloading', progress: info.asset.size > 0 ? 0 : null, error: null });
      try {
        path = await b.download(info.asset, (loaded, total) => {
          const t = total > 0 ? total : info.asset.size;
          if (t > 0) set({ progress: Math.max(0, Math.min(1, loaded / t)) });
        });
      } catch (e) {
        lastFailure = 'download';
        throw e;
      }
      set({ path, progress: 1 });
      if (dismissGen !== d) {
        // 받는 사이 "나중에" → 받아 둔 채로 조용히 (나중에 설정 › 앱 정보 또는 다음 확인 때 물어봄)
        set({ status: 'ready' });
        return;
      }
      if (!canInstallNow()) {
        // 다 받았지만 지금 설치하면 방해가 됨 — 받아 두고 물어봄 (제조 중·다른 창이 열려 있으면 그게 끝난 뒤에 창이 보임)
        set({ status: 'ready', open: true });
        return;
      }
    }
    if (!canInstallNow()) {
      // 기다리는 사이 창을 닫았거나 제조를 시작함 → 설치하지 않고 받아 둔 채로
      if (deviceBusy()) toast(UPDATE_BUSY_TEXT, 'warning');
      set({ status: 'ready' });
      return;
    }
    set({ status: 'installing', error: null, open: true });
    if (b.target === 'exe') {
      // 새 EXE 가 첫 확인을 못 하고 닫혀도(오프라인 등) 예전 EXE(바탕화면 바로 가기)를 다시 열면 곧바로 확인하게.
      // 새 EXE 가 확인하면 lastCheckVersion 이 새 버전이 되어 그때도 예전 EXE 는 곧바로 확인함
      saveUpdatePrefs({ lastCheckAt: 0 });
    }
    try {
      await b.install(path);
    } catch (e) {
      lastFailure = 'install';
      throw e;
    }
  } catch (e: any) {
    const msg = typeof e?.message === 'string' && /[가-힣]/.test(e.message) ? e.message : UPDATE_GENERIC_FAILED_TEXT;
    set({ status: 'error', error: msg, open: true, progress: null, ...(lastFailure === 'install' ? { path: null } : {}) });
  }
}

/** (APK) "이 출처 허용" 설정 화면 열기 — 돌아오면 이어서(앱이 다시 켜져도 30분 안이면). 열지 못하면 안내 */
export async function openInstallPermission(): Promise<void> {
  const b = backend;
  if (!b?.openInstallSettings) return;
  const info = useUpdate.getState().info;
  // 기다리는 시간은 설정 화면을 연 때부터 셈
  if (info) saveUpdatePrefs({ pendingPermission: { version: info.version, at: Date.now(), info } });
  try {
    await b.openInstallSettings();
  } catch (e: any) {
    const msg =
      typeof e?.message === 'string' && /[가-힣]/.test(e.message)
        ? e.message
        : '설정 화면을 열지 못했어요. 휴대폰 설정 › 애플리케이션 › AI 스마트 바텐더 › "출처를 알 수 없는 앱 설치"에서 허용해 주세요.';
    set({ status: 'error', error: msg, open: true });
  }
}

/** 설치 허용을 기다리는 표시가 유효한 시간 (앱이 다시 켜진 경우만 — 창이 떠 있는 동안은 시간 제한 없음) */
export const PENDING_PERMISSION_MS = 30 * 60 * 1000;

/**
 * 설치 허용을 기다리던 중이면 허용됐는지 보고 이어서 업데이트 → 이어서 진행했으면 true
 *  - 지금 'needs-permission' 창이 떠 있으면(같은 실행) 시간 제한 없이 확인
 *  - 앱이 다시 켜졌으면 저장해 둔 표시(30분 안)로 확인 → 릴리스를 다시 읽고(건너뛴 버전이어도) 이어서
 *  - 확인 실패·기기 작업 중이면 표시를 남겨 두고 다음에 다시 (앞으로 올 때·부팅 때·"계속" 버튼)
 */
export async function resumeAfterPermission(now = Date.now(), fetchFn?: typeof fetch): Promise<boolean> {
  const b = backend;
  if (!b?.canInstall) return false;
  // 확인을 기다리는 사이 "나중에"·"건너뛰기"를 누르면 그만
  const d = dismissGen;
  const st = useUpdate.getState();
  const live = st.status === 'needs-permission' && !!st.info;
  const p = loadUpdatePrefs().pendingPermission;
  if (!live && (!p || now - p.at > PENDING_PERMISSION_MS || now < p.at)) return false;
  let ok = false;
  try {
    ok = await b.canInstall();
  } catch {
    ok = false;
  }
  if (!ok || dismissGen !== d) return false;
  // 앱이 다시 켜짐: 고른 업데이트 정보가 저장돼 있으면 인터넷 확인 없이 먼저 창 상태로 되돌림
  // (기기 작업 중이면 창은 작업이 끝난 뒤에 보이고, 그때 "업데이트"를 누르면 바로 진행)
  const saved = p?.info;
  const restored =
    !useUpdate.getState().info && !!saved && isNewerVersion(saved.version, APP_VERSION) && ASSET_NAME[b.target].test(saved.asset.name);
  if (restored) set({ status: 'available', info: saved, error: null, open: true, progress: null, path: null });
  // 기기 작업 중이면 조용히 다음에 (앞으로 올 때마다 토스트가 뜨지 않게)
  if (deviceBusy()) return false;
  if (!useUpdate.getState().info) {
    // 저장한 정보가 없으면 다시 확인(건너뛴 버전이어도)
    const info = await checkForUpdate({ fetchFn, resume: true });
    if (!info || dismissGen !== d) return false;
  }
  await startUpdate();
  const s = useUpdate.getState().status;
  return s !== 'needs-permission' && s !== 'available';
}

let started = false;
/** 앱 시작 때 1번 (platform/boot.ts): 설치 허용 뒤 이어서 → 아니면 잠시 뒤 확인, 앱이 다시 앞으로 오면 같은 순서(간격 지켜서) */
export function startUpdateChecks(delayMs = 4000): void {
  if (started || !backend) return;
  started = true;
  const tick = () => {
    resumeAfterPermission()
      .then((resumed) => (resumed ? null : autoCheckForUpdate()))
      .catch(() => undefined);
  };
  setTimeout(tick, delayMs);
  onAppStateChange((s) => {
    if (s === 'active') tick();
  });
}
