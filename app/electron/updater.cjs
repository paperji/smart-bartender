/**
 * Windows 앱(EXE) 업데이트 — 메인 프로세스 쪽 (main.cjs 가 IPC 로 연결, 화면 쪽 순서는 src/lib/update.ts)
 *  - 이 저장소의 GitHub 릴리스 portable EXE 만 내려받음 (주소 전체 형식·태그와 파일 버전 일치·지금보다 높은 버전·SHA-256 형식 검사)
 *  - 내려받으면서 SHA-256 을 계산해 릴리스 정보와 다르면 지움 (임시 이름 .download → 맞으면 진짜 이름으로)
 *    · 이미 같은 파일(SHA-256 이 같은)을 받아 두었으면 다시 받지 않음
 *  - 저장 위치: 지금 실행 중인 portable EXE 가 있는 폴더(PORTABLE_EXECUTABLE_DIR, 실제로 써 보고 되면) → 아니면 다운로드 폴더
 *    (폴더에 쓰다가 권한 오류가 나도 다운로드 폴더로 다시)
 *  - 새 EXE 실행: 따로(detached) 켜고 실행됐는지 확인한 뒤에만 이 앱을 닫음 (launchDetached)
 * Node 모듈만 사용 (electron 은 main.cjs 에서 넘겨받음) → Node 테스트에서 바로 불러올 수 있음
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UPDATE_PREFIX = 'https://github.com/paperji/smart-bartender/releases/download/';
const EXE_NAME = /^SmartBartender-(\d+\.\d+\.\d+)-portable\.exe$/;
/** 주소 전체: .../download/v<버전>/SmartBartender-<버전>-portable.exe (다른 경로·쿼리·인코딩 없이) */
const UPDATE_URL = /^https:\/\/github\.com\/paperji\/smart-bartender\/releases\/download\/v(\d+\.\d+\.\d+)\/(SmartBartender-(\d+\.\d+\.\d+)-portable\.exe)$/;
const SHA256 = /^[0-9a-f]{64}$/;
const BAD_REQUEST = '잘못된 업데이트 파일 정보예요';

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** a 가 b 보다 높은 버전인지 */
function isNewer(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/**
 * 화면이 보낸 내려받기 요청 검사 — 틀리면 이유(한국어), 맞으면 null
 * currentVersion(app.getVersion())을 주면 그보다 높은 버전만 (예전 버전으로 되돌리기 막음)
 */
function validateUpdateRequest(url, sha256, name, currentVersion) {
  if (typeof url !== 'string' || typeof sha256 !== 'string' || typeof name !== 'string') return BAD_REQUEST;
  if (!EXE_NAME.test(name) || !SHA256.test(sha256)) return BAD_REQUEST;
  const m = UPDATE_URL.exec(url);
  if (!m || m[2] !== name || m[1] !== m[3]) return BAD_REQUEST;
  let canonical = '';
  try {
    canonical = new URL(url).href;
  } catch {
    return BAD_REQUEST;
  }
  if (canonical !== url) return BAD_REQUEST;
  if (currentVersion != null && !isNewer(m[3], currentVersion)) return '지금 버전보다 새 버전이 아니에요';
  return null;
}

/** 폴더에 실제로 파일을 만들어 보고 지움 (Windows 는 access(W_OK) 가 읽기 전용 표시만 보고 권한(ACL)은 못 봄) */
function writable(dir) {
  if (!dir) return false;
  const probe = path.join(dir, `.sb-update-probe-${process.pid}-${Date.now()}`);
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    try {
      fs.rmSync(probe, { force: true });
    } catch {
      /* ignore */
    }
    return false;
  }
}

/** 새 EXE 를 둘 폴더 (앞에서부터 쓸 수 있는 곳 — 없으면 마지막 = 다운로드 폴더) */
function chooseUpdateDir(portableDir, downloadsDir) {
  if (portableDir && writable(portableDir)) return portableDir;
  return downloadsDir;
}

/**
 * 응답 본문(웹 ReadableStream 또는 async iterable)을 조각으로.
 * guard(p): 읽기 하나를 감싸 시간 초과 때 거절 — 읽기마다 새로 감싸서 받은 조각이 메모리에 쌓이지 않음
 * (오래 사는 약속 하나와 매번 Promise.race 를 하면 조각이 다운로드가 끝날 때까지 모두 남음)
 */
async function* chunks(body, guard) {
  const race = guard || ((p) => p);
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await race(reader.read());
        if (done) {
          finished = true;
          return;
        }
        if (value) yield value;
      }
    } finally {
      if (!finished) Promise.resolve(reader.cancel()).catch(() => undefined);
    }
  }
  const it = body[Symbol.asyncIterator]();
  for (;;) {
    const { done, value } = await race(it.next());
    if (done) return;
    yield value;
  }
}

/** 파일의 SHA-256 (없거나 못 읽으면 null) */
async function fileSha256(file) {
  let fh = null;
  try {
    fh = await fs.promises.open(file, 'r');
    const hash = crypto.createHash('sha256');
    const buf = Buffer.alloc(1 << 20);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (!bytesRead) break;
      hash.update(buf.subarray(0, bytesRead));
    }
    return hash.digest('hex');
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => undefined);
  }
}

const isPermissionError = (e) => !!e && (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'EROFS');
const isNoSpace = (e) => !!e && (e.code === 'ENOSPC' || e.code === 'EDQUOT');
const korean = (msg, extra) => Object.assign(new Error(msg), { korean: true }, extra || {});
const TEXT = {
  net: '새 버전을 내려받지 못했어요. 인터넷 연결을 확인해 주세요.',
  timeout: '새 버전을 내려받지 못했어요(시간 초과). 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
  notFound: (code) => `업데이트 파일을 찾지 못했어요(HTTP ${code}). 잠시 뒤 다시 확인해 주세요.`,
  http: (code) => `업데이트 파일을 받지 못했어요(HTTP ${code}). 잠시 뒤 다시 시도해 주세요.`,
  save: '새 버전 파일을 저장하지 못했어요. 다시 시도해 주세요.',
  noSpace: '저장 공간이 부족해요. 디스크 공간을 비운 뒤 다시 시도해 주세요.',
  folder: '이 폴더에 새 버전을 저장할 수 없어요.',
  inUse: '새 버전 파일을 다른 프로그램(백신 등)이 쓰고 있어요. 잠시 뒤 다시 시도해 주세요.',
  sha: '내려받은 파일이 원본과 달라요(SHA-256 불일치). 다시 시도해 주세요.',
};

/** 내려받기 시간 제한 — 데이터가 이만큼 안 오면 실패(느려도 오는 중이면 계속), 전체 상한 */
const DOWNLOAD_IDLE_MS = 60 * 1000;
const DOWNLOAD_TOTAL_MS = 60 * 60 * 1000;

/** Windows: 방금 닫은 EXE 를 백신·색인기가 잠깐 잡고 있으면 이름 바꾸기가 EBUSY/EPERM — 조금씩 기다렸다 다시 (약 12초) */
async function retryFs(fn, { tries = 16, platform = process.platform } = {}) {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (e) {
      const transient = !!e && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES');
      if (platform !== 'win32' || !transient || i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
}

/** 예전 시도가 남긴 업데이트 EXE 임시 파일(SmartBartender-<아무 버전>-portable.exe.<pid>-<8자리>.download, 예전 형식 ….exe.download) 정리 — 실패는 무시 */
const STALE_TEMP = /^SmartBartender-\d+\.\d+\.\d+-portable\.exe\.(\d+-[0-9a-f]{8}\.)?download$/;
function removeStaleTemps(dest, keep) {
  try {
    const dir = path.dirname(dest);
    const re = STALE_TEMP;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (re.test(f) && full !== keep) {
        try {
          fs.rmSync(full, { force: true });
        } catch {
          /* 다른 프로그램이 쓰는 중이면 다음에 */
        }
      }
    }
  } catch {
    /* 폴더를 못 읽으면 그만 */
  }
}

/**
 * url 을 내려받아 dest 에 저장 (SHA-256 이 같을 때만). fetchImpl = electron net.fetch (테스트는 대역)
 *  - onProgress(loaded, total) 는 150ms 에 1번 정도. dest 에 이미 같은 파일이 있으면 받지 않고 그대로 씀
 *  - 시도마다 다른 임시 파일(.<pid>-<무작위>.download) — 두 시도가 서로의 파일을 덮거나 지우지 않게
 *  - 데이터가 idleMs 동안 안 오거나 totalMs 를 넘으면 끊고 시간 초과 안내
 * 실패: 한국어 오류(원인별). 폴더 권한 문제면 e.permission = true (main 이 다운로드 폴더로 다시)
 */
async function downloadVerified({ url, sha256, dest, fetchImpl, onProgress, now = () => Date.now(), idleMs = DOWNLOAD_IDLE_MS, totalMs = DOWNLOAD_TOTAL_MS, platform }) {
  if ((await fileSha256(dest)) === sha256) {
    const size = fs.statSync(dest).size;
    if (onProgress) onProgress(size, size);
    return dest;
  }
  const tmp = `${dest}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.download`;
  removeStaleTemps(dest, tmp);
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timedOut = false;
  let idle = null;
  /** 지금 기다리는 것(응답 또는 조각 하나)을 시간 초과로 끝내는 함수 — 멈춘 연결에서도 빠져나옴 */
  let cancelWait = null;
  const guard = (p) => {
    if (timedOut) {
      // 이미 시작된 읽기의 (중단) 거절은 버림 — 처리 안 된 거절로 남지 않게
      Promise.resolve(p).catch(() => undefined);
      return Promise.reject(new Error('timeout'));
    }
    return new Promise((res, rej) => {
      cancelWait = rej;
      p.then(res, rej);
    }).finally(() => {
      cancelWait = null;
    });
  };
  const abort = () => {
    timedOut = true;
    if (ctrl) ctrl.abort();
    if (cancelWait) cancelWait(new Error('timeout'));
  };
  const arm = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(abort, idleMs);
  };
  const total = setTimeout(abort, totalMs);
  let fh = null;
  let phase = 'fetch';
  try {
    arm();
    const res = await guard(Promise.resolve(fetchImpl(url, { redirect: 'follow', ...(ctrl ? { signal: ctrl.signal } : {}) })));
    if (timedOut) throw new Error('timeout');
    if (res && (res.status === 404 || res.status === 410)) throw korean(TEXT.notFound(res.status));
    if (res && !res.ok && Number.isFinite(res.status) && res.status >= 400) throw korean(TEXT.http(res.status));
    if (!res || !res.ok || !res.body) throw new Error('HTTP ' + (res && res.status));
    const length = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : 0) || 0;
    const hash = crypto.createHash('sha256');
    phase = 'open';
    fh = await fs.promises.open(tmp, 'w');
    phase = 'fetch';
    let loaded = 0;
    let last = 0;
    for await (const chunk of chunks(res.body, guard)) {
      arm();
      phase = 'write';
      const buf = Buffer.from(chunk);
      hash.update(buf);
      let off = 0;
      while (off < buf.length) {
        const { bytesWritten } = await fh.write(buf, off, buf.length - off);
        off += bytesWritten;
      }
      phase = 'fetch';
      loaded += buf.length;
      const t = now();
      if (onProgress && t - last > 150) {
        last = t;
        onProgress(loaded, length);
      }
    }
    if (timedOut) throw new Error('timeout');
    phase = 'write';
    await fh.close();
    fh = null;
    if (hash.digest('hex') !== sha256) throw korean(TEXT.sha);
    phase = 'finalize';
    // rename 은 Windows 에서도 있던 파일을 바꿔 씀(MoveFileEx REPLACE_EXISTING) — 지우고 바꾸는 사이 빈틈이 없음
    await retryFs(() => fs.renameSync(tmp, dest), { platform });
    if (onProgress) onProgress(loaded, length || loaded);
    return dest;
  } catch (e) {
    if (fh) await fh.close().catch(() => undefined);
    // 백신이 잡고 있으면 지우기도 잠깐 실패할 수 있어 같은 방식으로 다시
    await retryFs(() => fs.rmSync(tmp, { force: true }), { platform }).catch(() => undefined);
    if (e && e.korean) throw e;
    if (timedOut) throw korean(TEXT.timeout);
    if (isNoSpace(e)) throw korean(TEXT.noSpace);
    // 임시 파일을 만들지 못함(권한·폴더 없음 등) → 다음 폴더(다운로드 폴더)로
    if (phase === 'open') throw korean(TEXT.folder, { permission: true });
    if (phase === 'write') throw korean(TEXT.save);
    if (phase === 'finalize') throw korean(isPermissionError(e) || (e && e.code === 'EBUSY') ? TEXT.inUse : TEXT.save);
    throw new Error(TEXT.net);
  } finally {
    if (idle) clearTimeout(idle);
    clearTimeout(total);
  }
}

/**
 * 폴더 후보(앞에서부터, 같은 폴더는 한 번만)에 차례로 받아 봄 — 권한 오류면 다음 폴더로 (portable 폴더 → 다운로드 폴더)
 * running(지금 실행 중인 EXE 경로)과 같은 파일에는 쓰지 않음
 */
async function downloadToFirstWritable({ dirs, name, running, ...rest }) {
  const seen = new Set();
  const list = dirs.filter(Boolean).filter((d) => {
    const k = path.resolve(d).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  let lastErr = null;
  for (let i = 0; i < list.length; i++) {
    const dest = path.join(list[i], name);
    if (running && path.resolve(running).toLowerCase() === path.resolve(dest).toLowerCase()) {
      lastErr = new Error('이미 이 버전을 쓰고 있어요');
      continue;
    }
    try {
      return await downloadVerified({ ...rest, dest });
    } catch (e) {
      lastErr = e;
      if (!(e && e.permission) || i === list.length - 1) throw e;
    }
  }
  throw lastErr || new Error('새 버전을 저장할 폴더가 없어요.');
}

/** 새 EXE 를 따로 켬 — 실제로 실행되면 resolve, 못 켜면 reject (spawnImpl = child_process.spawn) */
function launchDetached(file, spawnImpl) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(file, [], { detached: true, stdio: 'ignore', cwd: path.dirname(file) });
    } catch (e) {
      reject(e);
      return;
    }
    child.once('spawn', () => {
      child.unref();
      resolve(child);
    });
    child.once('error', reject);
  });
}

module.exports = {
  UPDATE_PREFIX,
  EXE_NAME,
  UPDATE_URL,
  isNewer,
  validateUpdateRequest,
  writable,
  chooseUpdateDir,
  fileSha256,
  retryFs,
  removeStaleTemps,
  DOWNLOAD_IDLE_MS,
  DOWNLOAD_TOTAL_MS,
  downloadVerified,
  downloadToFirstWritable,
  launchDetached,
};

/**
 * main.cjs 의 IPC 처리 본체 (electron 객체를 넘겨받아 테스트에서 대역으로 시험할 수 있게)
 *  deps: { appVersion(), downloadsDir(), portableDir, portableFile, fetchImpl, spawnImpl, send(progress), releaseLock(), relock(), quit() }
 *  - download(url, sha256, name): 검사 → (portable 폴더 → 다운로드 폴더) 내려받기 → 경로.
 *    같은 파일을 받는 중에 다시 부르면(화면 새로고침 뒤 다시 누름 등) 그 내려받기를 같이 기다림 — 한 번에 하나만
 *  - install(p): 이번에 받은 그 파일만, 단일 실행 잠금을 풀고 따로 켠 뒤 0.3초 뒤 종료 (못 켜면 잠금 되돌리고 오류)
 */
function createUpdateIpc(deps) {
  let updateFile = null;
  /** { key, promise } — 지금 내려받는 것 */
  let inflight = null;
  return {
    async download(url, sha256, name) {
      const bad = validateUpdateRequest(url, sha256, name, deps.appVersion());
      if (bad) throw new Error(bad);
      const key = `${url}|${sha256}|${name}`;
      if (inflight) {
        if (inflight.key === key) return inflight.promise;
        throw new Error('이미 다른 새 버전을 내려받는 중이에요. 잠시 뒤 다시 시도해 주세요.');
      }
      updateFile = null;
      const promise = downloadToFirstWritable({
        dirs: [deps.portableDir && writable(deps.portableDir) ? deps.portableDir : null, deps.downloadsDir()],
        name,
        running: deps.portableFile,
        url,
        sha256,
        fetchImpl: deps.fetchImpl,
        onProgress: (loaded, total) => deps.send({ loaded, total }),
        ...(deps.downloadOptions || {}),
      }).then((file) => {
        updateFile = file;
        return file;
      });
      const entry = { key, promise };
      inflight = entry;
      try {
        return await promise;
      } finally {
        if (inflight === entry) inflight = null;
      }
    },
    async install(p) {
      if (!updateFile || p !== updateFile || !fs.existsSync(p)) throw new Error('설치할 파일을 찾지 못했어요. 다시 내려받아 주세요.');
      // 새 EXE 가 단일 실행 잠금(requestSingleInstanceLock)에 막혀 바로 꺼지지 않게 먼저 풀고, 따로 실행한 뒤 이 앱을 닫음
      deps.releaseLock();
      try {
        await launchDetached(p, deps.spawnImpl);
      } catch {
        deps.relock();
        throw new Error('새 버전을 실행하지 못했어요. 저장한 파일을 직접 열어 주세요: ' + p);
      }
      setTimeout(() => deps.quit(), 300);
      return true;
    },
  };
}

module.exports.createUpdateIpc = createUpdateIpc;
