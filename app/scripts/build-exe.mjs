#!/usr/bin/env node
/**
 * Windows portable EXE 만들기 (electron-builder) — scripts/build-exe.ps1 이 ASCII 경로 사본에서 부름
 *  1) .electron-stage/ 에 실행에 필요한 것만 모음: package.json(의존성 없음) + electron/{main,preload,updater}.cjs + 아이콘 + dist/
 *     → 앱 묶음(app.asar)에 node_modules 가 들어가지 않음 (웹 코드는 Vite 가 이미 dist 에 묶음)
 *     서비스 워커 파일(sw.js·workbox-*.js)은 EXE 에서 쓰지 않으므로 뺌
 *  2) electron-builder: win portable x64 → release/SmartBartender-<version>-portable.exe (+ release/win-unpacked)
 * 코드 서명 없음 → 처음 실행 때 SmartScreen "Windows의 PC 보호" 경고 (추가 정보 → 실행)
 * 사용: node scripts/build-exe.mjs   (먼저 vite build 로 dist 를 만들어 두세요)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import builder from 'electron-builder';

const { build, Platform, Arch } = builder;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, '.electron-stage');
const OUT = join(ROOT, 'release');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const electronVersion = String(pkg.devDependencies?.electron ?? '').replace(/^[^\d]*/, '');

if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('[build-exe] dist/index.html 이 없어요. 먼저 vite build 를 실행하세요.');
  process.exit(1);
}
if (!electronVersion) {
  console.error('[build-exe] package.json devDependencies.electron 버전을 찾지 못했어요.');
  process.exit(1);
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
cpSync(join(ROOT, 'dist'), join(STAGE, 'dist'), {
  recursive: true,
  filter: (src) => !/[\\/](sw\.js|workbox-[^\\/]*\.js|registerSW\.js)(\.map)?$/.test(src),
});
mkdirSync(join(STAGE, 'electron', 'icons'), { recursive: true });
for (const f of ['main.cjs', 'preload.cjs', 'updater.cjs']) cpSync(join(ROOT, 'electron', f), join(STAGE, 'electron', f));
for (const f of readdirSync(join(ROOT, 'electron', 'icons'))) cpSync(join(ROOT, 'electron', 'icons', f), join(STAGE, 'electron', 'icons', f));
writeFileSync(
  join(STAGE, 'package.json'),
  JSON.stringify(
    {
      name: 'smart-bartender',
      productName: 'AI 스마트 바텐더',
      version: pkg.version,
      description: 'AI 스마트 바텐더 — 기분과 취향을 고르면 AI 가 레시피를 만들고 칵테일 메이커가 만들어 줘요 (팀 홍당무)',
      author: { name: '팀 홍당무 (안양대학교 정보전기전자공학과)' },
      license: 'UNLICENSED',
      private: true,
      main: 'electron/main.cjs',
    },
    null,
    2,
  ) + '\n',
);

const started = Date.now();
const artifacts = await build({
  projectDir: STAGE,
  targets: Platform.WINDOWS.createTarget(['portable'], Arch.x64),
  publish: 'never',
  config: {
    appId: 'kr.ac.anyang.hongdangmu.bartender',
    productName: 'AI 스마트 바텐더',
    executableName: 'SmartBartender',
    copyright: 'Copyright (C) 2026 Team Hongdangmu, Anyang University',
    electronVersion,
    asar: true,
    npmRebuild: false,
    nodeGypRebuild: false,
    buildDependenciesFromSource: false,
    directories: { output: OUT, buildResources: join(STAGE, 'electron', 'icons') },
    files: ['package.json', 'electron/main.cjs', 'electron/preload.cjs', 'electron/updater.cjs', 'electron/icons/**/*', 'dist/**/*'],
    win: {
      target: [{ target: 'portable', arch: ['x64'] }],
      icon: join(STAGE, 'electron', 'icons', 'icon.ico'),
      requestedExecutionLevel: 'asInvoker',
      signAndEditExecutable: true,
    },
    portable: {
      artifactName: 'SmartBartender-${version}-portable.exe',
      requestExecutionLevel: 'user',
      unicode: true,
    },
  },
});
console.log(`[build-exe] 완료 (${Math.round((Date.now() - started) / 1000)}초)`);
for (const a of artifacts) console.log('  ' + a);
