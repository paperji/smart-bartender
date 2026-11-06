#!/usr/bin/env node
/**
 * 배포물에 비밀값이 들어가지 않았는지 검사 (WEBAPP_DESIGN §4) — `npm run build` 마지막 단계
 *  검사 대상: dist/ 전체 + 인자로 준 파일·폴더 (예: release/SmartBartender-3.0.0.apk, release/…-portable.exe)
 *  찾는 것:
 *   1) app/.env.development.local 의 VITE_DEV_GEMINI_KEY 값 그대로 (이 스크립트 안에서만 읽고 절대 출력하지 않음)
 *   2) Google API 키 모양: /AQ\.[A-Za-z0-9_-]{20,}/ , /AIza[0-9A-Za-z_-]{30,}/
 *   3) 개발용 키 변수 이름 'VITE_DEV_GEMINI_KEY' (배포 빌드에서는 dead code 로 지워져야 함)
 *  발견하면 파일 이름(과 어떤 규칙인지)만 출력하고 exit 1. 일치한 값은 출력하지 않음.
 *  APK·AAB·ZIP 은 바이트 그대로 + 안의 파일을 하나씩 풀어서도 검사(파일 이름은 "apk!/assets/public/..." 처럼 표시).
 *  app.asar(EXE 안의 앱 묶음)는 압축하지 않은 묶음이라 바이트 그대로 검사하면 충분. portable .exe 는 LZMA 로 압축돼 안을 못 보므로
 *  release/win-unpacked/resources/app.asar 와 dist 를 함께 검사하세요 (scripts/build-exe.ps1 이 그렇게 함).
 * 사용: node scripts/check-no-secrets.mjs [--no-dist] [추가 경로 ...]   (--no-dist: 기본 대상 dist/ 를 빼고 인자로 준 것만)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** .env.development.local 에서 VITE_DEV_GEMINI_KEY 값 읽기 (없으면 null) — 값은 이 함수 밖으로 출력하지 않음 */
function readDevKey() {
  const file = join(ROOT, '.env.development.local');
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?VITE_DEV_GEMINI_KEY\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    v = v.trim();
    return v.length >= 8 ? v : null;
  }
  return null;
}

const RULES = [
  { name: 'Google API 키 모양 (AQ.)', re: /AQ\.[A-Za-z0-9_-]{20,}/ },
  { name: 'Google API 키 모양 (AIza)', re: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: '개발용 키 변수 이름', re: /VITE_DEV_GEMINI_KEY/ },
];

function* walk(p) {
  let st;
  try {
    st = statSync(p);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) yield* walk(join(p, name));
  } else if (st.isFile()) {
    yield p;
  }
}

const devKey = readDevKey();
const devKeyBuf = devKey ? Buffer.from(devKey, 'utf8') : null;

const cliArgs = process.argv.slice(2);
const noDist = cliArgs.includes('--no-dist');
const targets = [...(noDist ? [] : [join(ROOT, 'dist')]), ...cliArgs.filter((a) => a !== '--no-dist').map((a) => resolve(process.cwd(), a))];
const missing = targets.filter((t) => !existsSync(t));
const problems = [];
let scanned = 0;

/** 버퍼 하나 검사 → 문제 목록에 추가 */
function scanBuffer(label, buf) {
  scanned++;
  const hits = [];
  if (devKeyBuf && buf.indexOf(devKeyBuf) !== -1) hits.push('.env.development.local 의 개발용 키 값');
  // 텍스트로 보고 규칙 검사 (바이너리도 latin1 로 읽으면 ASCII 문자열은 그대로 보임)
  const text = buf.toString('latin1');
  for (const r of RULES) if (r.re.test(text)) hits.push(r.name);
  if (hits.length) problems.push({ file: label, hits });
}

/** ZIP(APK·AAB) 안의 파일들 [{ name, data }] — 저장(0)·deflate(8)만, ZIP64 미지원(4GB 미만) */
function* zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP 끝 표시를 찾지 못함');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 목록이 올바르지 않음');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('ZIP 항목 머리가 올바르지 않음: ' + name);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    if (method === 0) yield { name, data: raw };
    else if (method === 8) yield { name, data: inflateRawSync(raw) };
    else yield { name, data: raw };
  }
}

const ZIP_EXT = new Set(['.apk', '.aab', '.zip', '.jar']);
const zipErrors = [];

for (const target of targets) {
  if (!existsSync(target)) continue;
  for (const file of walk(target)) {
    const label = relative(ROOT, file) || file;
    const buf = readFileSync(file);
    scanBuffer(label, buf);
    if (ZIP_EXT.has(extname(file).toLowerCase())) {
      try {
        for (const e of zipEntries(buf)) scanBuffer(label + '!/' + e.name, e.data);
      } catch (err) {
        zipErrors.push(label + ': ' + (err && err.message ? err.message : String(err)));
      }
    }
  }
}

for (const z of zipErrors) console.warn('[check-no-secrets] 압축을 풀지 못해 바이트 그대로만 검사: ' + z);

for (const m of missing) {
  if (m === join(ROOT, 'dist')) console.warn('[check-no-secrets] dist/ 가 없어요 (빌드 전?)');
  else console.warn(`[check-no-secrets] 경로가 없어요: ${relative(ROOT, m) || m}`);
}

if (problems.length) {
  console.error(`[check-no-secrets] 실패: 비밀값으로 보이는 내용이 ${problems.length}개 파일에 있어요 (값은 출력하지 않음)`);
  for (const p of problems) console.error(`  - ${p.file}: ${p.hits.join(', ')}`);
  process.exit(1);
}
if (missing.length && missing.length === targets.length) {
  console.error('[check-no-secrets] 검사할 파일이 없어요.');
  process.exit(1);
}
console.log(`[check-no-secrets] 통과: 파일 ${scanned}개 검사, 개발용 키 값 비교 ${devKeyBuf ? '함' : '안 함(키 없음)'}`);
