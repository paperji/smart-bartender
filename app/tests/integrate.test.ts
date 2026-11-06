/**
 * 통합 회귀 테스트 — 여러 작업자가 고친 것을 한데 모은 뒤 빠지기 쉬운 곳
 *  - 화면 CSS(src/screens, src/components)가 예전 팔레트 색을 직접 쓰지 않는지 (토큰을 바꾸면 따라오지 않음)
 *  - 화면 CSS 가 초점 표시(outline)를 끄면 같은 규칙에서 불투명한 링(box-shadow)을 대신 그리는지
 *  - 글자 hover 를 채움 전용 당근색(--accent, 흰 바탕 2.6:1)으로 바꾸지 않는지
 *  - App.tsx 배선: 앱 전체 오류 경계 · 라우트 오류 경계 · 이동 기록(noteLocation) · 다른 창 키 변경 구독
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const SRC = path.join(import.meta.dirname, '..', 'src');

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

/** 화면·도메인 컴포넌트 CSS (UI 키트 src/ui 와 app.css 는 tests/ui-fixes.test.ts 가 봄) */
const SCREEN_CSS = [...cssFiles(path.join(SRC, 'screens')), ...cssFiles(path.join(SRC, 'components'))];

interface Rule {
  file: string;
  selectors: string[];
  decls: Record<string, string>;
}

function parse(file: string): Rule[] {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith('@media') || prelude.startsWith('@supports')) walk(body);
      else if (!prelude.startsWith('@')) {
        const decls: Record<string, string> = {};
        for (const part of body.split(';')) {
          const k = part.indexOf(':');
          if (k < 0) continue;
          decls[part.slice(0, k).trim()] = part.slice(k + 1).trim();
        }
        rules.push({ file: path.relative(SRC, file), selectors: prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls });
      }
      i = j;
    }
  };
  walk(css);
  return rules;
}

const RULES = SCREEN_CSS.flatMap(parse);

test('화면 CSS 를 찾음 (경로가 바뀌면 이 테스트가 빈 목록을 검사하지 않게)', () => {
  assert.ok(SCREEN_CSS.length >= 8, `화면 CSS ${SCREEN_CSS.length}개`);
  assert.ok(RULES.length > 100);
});

test('화면 CSS 는 예전 팔레트 색을 직접 쓰지 않음 (theme.css 토큰을 써야 대비 수정이 따라옴)', () => {
  // UI-3 이전 값: 빨강 #e5484d(hover #cf3a3f·눌림 #b8323a)·당근 글자 #e8611a·초록 #1e9e6a·파랑 #2f6feb·노랑 글자 #a86f00/#9a6700·보조 글자 #5f6670
  const retired = [/#e5484d/i, /#cf3a3f/i, /#b8323a/i, /#e8611a/i, /#1e9e6a/i, /#2f6feb/i, /#a86f00/i, /#9a6700/i, /#5f6670/i, /rgba\(\s*229\s*,\s*72\s*,\s*77/];
  for (const f of SCREEN_CSS) {
    const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const re of retired) assert.doesNotMatch(css, re, `${path.relative(SRC, f)} 에 예전 색 ${re}`);
  }
});

test('화면 CSS 가 outline 을 끄면 같은 규칙에서 불투명한 초점 링을 그림', () => {
  const off = RULES.filter((r) => /^(none|0)$/.test(r.decls.outline ?? ''));
  assert.ok(off.length > 0);
  for (const r of off) {
    const label = `${r.file} ${r.selectors.join(', ')}`;
    for (const s of r.selectors) assert.match(s, /:focus(-visible)?\b/, `${label}: 초점 상태가 아닌데 outline 을 끔`);
    const ring = r.decls['box-shadow'] ?? '';
    assert.ok(ring, `${label}: outline 을 끄고 링이 없음`);
    assert.match(ring, /var\(--focus-color\)|var\(--focus-ring\)|var\(--red\)/, `${label}: 링 색은 --focus-color(또는 비상 정지의 --red)`);
    assert.doesNotMatch(ring, /rgba\(/, `${label}: 반투명 링은 대비가 모자람`);
  }
});

test(':focus-visible 링은 바깥 틈(--surface)과 링이 겹쳐 1px 만 보이지 않게 — --focus-ring 앞에 다른 그림자를 두지 않음', () => {
  for (const r of RULES) {
    if (!r.selectors.some((s) => s.includes(':focus-visible'))) continue;
    const ring = r.decls['box-shadow'];
    if (!ring) continue;
    // 반투명 링(예: rgba(255,122,47,.45) ≈ 1.5:1)은 초점 표시 3:1 을 못 넘음
    assert.doesNotMatch(ring, /rgba\(/, `${r.file} ${r.selectors.join(', ')}: 반투명 초점 링`);
    if (!ring.includes('var(--focus-ring)')) continue;
    assert.equal(ring.trim(), 'var(--focus-ring)', `${r.file} ${r.selectors.join(', ')}: ${ring}`);
  }
});

test('글자 hover 를 채움 전용 --accent 로 바꾸지 않음 (흰 바탕 2.6:1)', () => {
  for (const r of RULES) {
    if (!r.selectors.some((s) => s.includes(':hover'))) continue;
    assert.notEqual(r.decls.color, 'var(--accent)', `${r.file} ${r.selectors.join(', ')}`);
  }
});

test('비상 정지 hover·눌림 색은 토큰(--red-hover) — 흰 글자 대비가 기본 빨강보다 낮아지지 않게', () => {
  const pick = (sel: string) => RULES.find((r) => r.selectors.includes(sel))?.decls ?? {};
  assert.equal(pick('.brew-stop:hover:not(:disabled)').background, 'var(--red-hover)');
  assert.equal(pick('.brew-stop:active:not(:disabled)').background, 'var(--red-hover)');
});

test('App.tsx 배선: 앱 전체·라우트 오류 경계, 이동 기록, 다른 창 키 변경 구독', () => {
  const app = readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
  // 앱 전체 오류 경계가 Root 를 감쌈 (화면 틀·전역 창이 깨져도 하얀 화면 X)
  assert.match(app, /<AppErrorBoundary[^>]*\bfull\b[^>]*>\s*<Root>/);
  // 라우트 Outlet 도 감쌈 (설정·기기·캘리브레이션 화면이 깨져도 내비는 남음)
  assert.match(app, /<ScreenBoundary name="route">\s*<Outlet \/>\s*<\/ScreenBoundary>/);
  // 주소가 바뀔 때마다 이동 기록 (lib/nav.dismissTo)
  assert.match(app, /useEffect\(\(\) => noteLocation\(\), \[location\]\)/);
  // 다른 창에서 키 저장·삭제 → 힌트 다시 맞추기 (설정 화면이 닫혀 있어도)
  assert.match(app, /onGeminiKeyChange\(\(\) => \{\s*syncGeminiKeyHint\(\)/);
});
