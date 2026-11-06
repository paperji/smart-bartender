'use strict';
/**
 * 로컬 개발 서버 (외부 패키지 없음) — Vercel 에 배포하기 전에 PC 에서 바로 시험해 볼 때 사용.
 *   npm run dev            → http://localhost:3000/api
 *   PORT=4000 npm run dev  → 포트 변경
 * backend/.env.local (또는 .env) 의 GEMINI_API_KEY / GEMINI_MODEL 을 읽습니다. 키가 없으면 규칙기반 추천으로 응답합니다.
 * 같은 Wi-Fi 의 스마트폰 앱에서 시험하려면 앱의 AI 서버 주소를 http://<PC의 IP>:3000/api 로 설정하세요
 * (주소 끝 /api 까지 입력 — 앱은 넣은 주소를 그대로 호출하고, 이 서버는 /api 외에는 404).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}

const root = path.join(__dirname, '..');
const loaded = ['.env.local', '.env'].filter((f) => loadEnvFile(path.join(root, f)));

const handler = require('../api/index.js');
const port = Number(process.env.PORT) || 3000;

http
  .createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/api' || url === '/api/' || url === '/api/index') return handler(req, res);
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found. Use /api');
    return undefined;
  })
  .listen(port, () => {
    const keyState = String(process.env.GEMINI_API_KEY || '').trim() ? '설정됨' : '없음(규칙기반 추천으로 응답)';
    process.stdout.write(
      `[dev] http://localhost:${port}/api  | env 파일: ${loaded.join(', ') || '없음'} | GEMINI_API_KEY: ${keyState}\n`
    );
  });
