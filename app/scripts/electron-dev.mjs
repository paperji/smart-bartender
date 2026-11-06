#!/usr/bin/env node
/**
 * Windows 앱(Electron) 창으로 개발하기
 *  npm run electron:dev          Vite 개발 서버를 띄우고 Electron 창으로 엶 (코드를 고치면 바로 반영)
 *  npm run electron:dev -- --dist  빌드 결과(dist/)를 app:// 로 엶 (EXE 와 같은 방식, 먼저 npm run build)
 *  npm run electron:dev -- --port=5180  개발 서버 포트 고정 (나머지 인자는 Electron 에 그대로 — 예: --smoke-test)
 * Electron 창을 닫으면 개발 서버도 같이 꺼져요.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** electron 패키지는 실행 파일 경로를 돌려줌 — npm 이 설치 스크립트를 건너뛰어 실행 파일이 없으면 캐시(ELECTRON_CACHE)에서 풀어 옴 */
function electronPath() {
  try {
    return require('electron');
  } catch {
    const r = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'electron', 'install.js')], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('Electron 실행 파일을 준비하지 못했어요 (npm ci 를 다시 해 보세요)');
    return require('electron');
  }
}
const electronExe = electronPath();

const useDist = process.argv.includes('--dist');
const portArg = process.argv.find((a) => a.startsWith('--port='));
const port = portArg ? Number(portArg.slice(7)) : undefined;
const extra = process.argv.slice(2).filter((a) => a !== '--dist' && a !== portArg);

let server = null;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (useDist) {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.error('[electron-dev] dist/ 가 없어요. 먼저 npm run build (또는 npx vite build) 를 실행하세요.');
    process.exit(1);
  }
} else {
  const { createServer } = await import('vite');
  server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: port ? { port, strictPort: true } : { strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) {
    console.error('[electron-dev] 개발 서버 주소를 알 수 없어요.');
    await server.close();
    process.exit(1);
  }
  env.SB_DEV_URL = url;
  console.log(`[electron-dev] 개발 서버 ${url} → Electron 창`);
}

const child = spawn(electronExe, [ROOT, ...extra], { stdio: 'inherit', env, windowsHide: false });
const stop = async (code) => {
  if (server) await server.close().catch(() => undefined);
  process.exit(code ?? 0);
};
child.on('exit', (code) => void stop(code));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
