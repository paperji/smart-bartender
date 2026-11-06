#!/usr/bin/env node
/**
 * 안드로이드 릴리스 서명 키 만들기 (한 번만) — android/keystore/release.keystore + keystore.properties
 *  - 비밀번호는 무작위로 만들어 keystore.properties 에만 적어요. 화면·로그에 출력하지 않아요.
 *  - keytool 에는 환경 변수로 넘겨서(-storepass:env) 명령줄·프로세스 목록에도 남지 않아요.
 *  - 두 파일 모두 android/.gitignore 의 keystore/ 로 커밋되지 않아요. 잃어버리면 같은 앱으로 업데이트 설치가 안 되니
 *    팀 드라이브 등 안전한 곳에 따로 보관하세요.
 *  - 이미 있으면 아무것도 하지 않아요(덮어쓰기 방지). 다시 만들려면 두 파일을 직접 지운 뒤 실행.
 * 필요: JDK 의 keytool (JAVA_HOME 또는 PATH) — sb-tools/env.ps1 · env.sh 가 설정
 * 사용: node scripts/make-keystore.mjs
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'android', 'keystore');
const STORE = join(DIR, 'release.keystore');
const PROPS = join(DIR, 'keystore.properties');
const ALIAS = 'smartbartender';

if (existsSync(STORE) || existsSync(PROPS)) {
  console.log('[make-keystore] 이미 있어요: android/keystore/ (그대로 사용)');
  process.exit(0);
}

const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool') : 'keytool';
// 영문·숫자만 (properties 파일·keytool 모두에서 이스케이프 걱정 없게), 32자
const password = randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32).padEnd(32, '7');

mkdirSync(DIR, { recursive: true });
const r = spawnSync(
  keytool,
  [
    '-genkeypair',
    '-noprompt',
    '-keystore', STORE,
    '-storetype', 'PKCS12',
    '-alias', ALIAS,
    '-keyalg', 'RSA',
    '-keysize', '3072',
    '-validity', '10000',
    '-dname', 'CN=AI Smart Bartender, OU=Team Hongdangmu, O=Anyang University, L=Anyang, ST=Gyeonggi, C=KR',
    '-storepass:env', 'SB_KS_PASS',
    '-keypass:env', 'SB_KS_PASS',
  ],
  { env: { ...process.env, SB_KS_PASS: password }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
);
if (r.status !== 0) {
  console.error('[make-keystore] keytool 실패 (JAVA_HOME 확인):', (r.stderr || r.stdout || String(r.error ?? '')).replace(password, '***'));
  process.exit(1);
}
writeFileSync(
  PROPS,
  [
    '# Android release signing (scripts/make-keystore.mjs). SECRET: do not print, share in chat or commit.',
    'storeFile=release.keystore',
    `storePassword=${password}`,
    `keyAlias=${ALIAS}`,
    `keyPassword=${password}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
);
console.log('[make-keystore] 만들었어요: android/keystore/release.keystore, keystore.properties (비밀번호는 파일에만 있어요)');
