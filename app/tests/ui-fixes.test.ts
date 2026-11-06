/**
 * UI 키트 접근성·배치 회귀 테스트 (리뷰 UI-1·2·3·4·6·7)
 *  - UI-3 글자 대비: theme.css 토큰을 읽어 WCAG 대비를 계산 (보통 글자 4.5:1, 초점 표시 3:1)
 *  - UI-2 초점 표시: outline 으로 그려 컴포넌트 box-shadow 에 가려지지 않는지
 *  - UI-1 360px 상단바, UI-4 제조 화면 토스트 위치, UI-6 터치 영역 44px — CSS 규칙 검사 (실제 모양은 브라우저에서 확인)
 *  - UI-7 확인창·성인 확인 창의 aria-labelledby / aria-describedby
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { modalAria } from '../src/ui/modalAria';

const SRC = path.join(import.meta.dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(path.join(SRC, ...p), 'utf8');

// ───────────────────────── 작은 CSS 읽개 ─────────────────────────

interface CssRule {
  media: string | null;
  selectors: string[];
  decls: Record<string, string>;
}

/** 주석 제거 후 규칙 목록 (@media 안 규칙은 media 에 조건, @keyframes 는 건너뜀) */
function parseCss(src: string): CssRule[] {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const walk = (text: string, media: string | null) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const prelude = text.slice(i, open).trim();
      // 짝 맞는 } 찾기
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith('@media')) walk(body, prelude.replace(/^@media\s*/, ''));
      else if (!prelude.startsWith('@')) {
        const decls: Record<string, string> = {};
        for (const part of body.split(';')) {
          const k = part.indexOf(':');
          if (k < 0) continue;
          decls[part.slice(0, k).trim()] = part.slice(k + 1).trim();
        }
        rules.push({ media, selectors: prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls });
      }
      i = j;
    }
  };
  walk(css, null);
  return rules;
}

const THEME = parseCss(read('ui', 'theme.css'));
const KIT = parseCss(read('ui', 'components.css'));
const APP = parseCss(read('app.css'));

/** 선택자 하나에 걸린 선언 (같은 media 조건의 규칙을 순서대로 합침) */
function declsOf(rules: CssRule[], selector: string, media: string | null = null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rules) if (r.media === media && r.selectors.includes(selector)) Object.assign(out, r.decls);
  return out;
}

// ───────────────────────── 색·대비 ─────────────────────────

const ROOT = declsOf(THEME, ':root');
const token = (name: string): string => {
  const v = ROOT[`--${name}`];
  assert.ok(v, `theme.css 에 --${name} 이 있어야 해요`);
  const m = /^var\(--([\w-]+)\)$/.exec(v);
  return m ? token(m[1]) : v;
};
/** 'white' · '#hex' · 토큰 이름 · 'var(--x)' → #rrggbb */
const color = (c: string): string => {
  if (c === 'white' || c === '#fff') return '#ffffff';
  if (c.startsWith('#')) return c;
  const m = /^var\(--([\w-]+)\)$/.exec(c);
  return token(m ? m[1] : c);
};
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  assert.equal(h.length, 6, `#rrggbb 색이어야 해요: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(color(a)), luminance(color(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const SEG_BG = '#efece7'; // .sb-seg 바탕
const AA = 4.5;

test('UI-3 글자 색 토큰: 흰색·--bg·--surface-2·자기 -soft 바탕 위 모두 4.5:1 이상', () => {
  const pairs: [string, string[]][] = [
    ['text', ['white', 'bg', 'surface-2', SEG_BG]],
    ['text-2', ['white', 'bg', 'surface-2', SEG_BG]],
    // 탭바 이름·안전 안내('잔이 넘칠 것 같거나…')·힌트·자리 표시 글자가 쓰는 가장 옅은 정보 글자
    ['text-3', ['white', 'bg', 'surface-2', SEG_BG]],
    ['accent-strong', ['white', 'bg', 'surface-2', 'accent-soft']],
    ['green', ['white', 'bg', 'green-soft']],
    ['red', ['white', 'bg', 'red-soft']],
    ['blue', ['white', 'bg', 'blue-soft']],
    ['yellow-strong', ['white', 'bg', 'yellow-soft']],
  ];
  for (const [fg, bgs] of pairs) {
    for (const bg of bgs) {
      const r = contrast(fg, bg);
      assert.ok(r >= AA, `--${fg} on ${bg} = ${r.toFixed(2)}:1 (4.5 이상이어야 해요)`);
    }
  }
});

test('UI-3 채움 위 글자: 주 버튼(당근색) 진한 글자 · 빨강/초록/파랑 위 흰 글자 · 노랑 위 진한 글자 4.5:1 이상 (당근색은 밝은 그대로)', () => {
  assert.equal(token('accent').toLowerCase(), '#ff7a2f', '밝은 당근색 채움은 그대로');
  const pairs: [string, string][] = [
    ['on-accent', 'accent'],
    ['on-accent', 'accent-hover'],
    ['white', 'red'],
    ['white', 'red-hover'],
    ['white', 'green'],
    ['white', 'blue'],
    ['text', 'yellow'],
    ['white', 'text-2'], // 진한 회색 배지
  ];
  for (const [fg, bg] of pairs) {
    const r = contrast(fg, bg);
    assert.ok(r >= AA, `${fg} on ${bg} = ${r.toFixed(2)}:1`);
  }
  // 흰 글자를 당근색 위에 올리면 2.6:1 — 그래서 --on-accent 는 흰색이면 안 됨
  assert.ok(contrast('white', 'accent') < AA);
});

test('UI-3 키트 CSS: 채움 위 글자 색이 대비 짝과 맞음 (주 버튼·배지·탭 이름·맛 단계 칸)', () => {
  const primary = declsOf(KIT, '.sb-btn--primary');
  assert.equal(primary.background, 'var(--accent)');
  assert.equal(primary.color, 'var(--on-accent)');
  assert.equal(declsOf(KIT, '.sb-btn--primary:hover:not(:disabled)').background, 'var(--accent-hover)');
  assert.equal(declsOf(KIT, '.sb-btn--danger:hover:not(:disabled)').background, 'var(--red-hover)');
  assert.equal(declsOf(KIT, '.sb-badge--solid.sb-badge--accent').color, 'var(--on-accent)');
  assert.equal(declsOf(KIT, '.sb-badge--solid.sb-badge--warning').color, 'var(--text)');
  assert.equal(declsOf(APP, '.sb-nav__item').color, 'var(--text-2)', '탭바 이름은 정보 글자');
  assert.equal(declsOf(APP, '.sb-nav__item.is-active').color, 'var(--accent-strong)');
  assert.equal(declsOf(APP, '.sb-nav__badge--warning').color, 'var(--text)');
  assert.equal(declsOf(KIT, '.sb-scale__cell.is-on').color, 'var(--text)');

  // 흰 글자를 쓰는 규칙은 모두 글자와 4.5:1 이상인 바탕 (바탕이 변형 클래스 `기본--색` 에 있으면 그 규칙들로 검사)
  const all = [...KIT, ...APP];
  let checked = 0;
  for (const r of all) {
    if (!/^#fff(fff)?$/i.test(r.decls.color ?? '')) continue;
    const bg = r.decls.background ?? r.decls['background-color'];
    if (bg) {
      const ratio = contrast('white', bg);
      assert.ok(ratio >= AA, `${r.selectors.join(', ')}: 흰 글자 / ${bg} = ${ratio.toFixed(2)}:1`);
      checked++;
      continue;
    }
    for (const base of r.selectors) {
      const variants = all.filter((v) => v.selectors.some((s) => s.startsWith(`${base}--`)) && (v.decls.background ?? v.decls['background-color']));
      assert.ok(variants.length > 0, `${base}: 흰 글자인데 바탕 색이 없어요`);
      for (const v of variants) {
        const fg = v.decls.color ?? '#ffffff';
        const vbg = v.decls.background ?? v.decls['background-color'];
        const ratio = contrast(fg, vbg);
        assert.ok(ratio >= AA, `${v.selectors.join(', ')}: ${fg} / ${vbg} = ${ratio.toFixed(2)}:1`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 6, `흰 글자 규칙 ${checked}개 검사`);
});

test('UI-3 맛 단계 채운 칸: 맛 색(FlavorBars)과 당근색 위 진한 숫자 4.5:1 이상', () => {
  const src = read('components', 'FlavorBars.tsx');
  const hexes = [...src.matchAll(/color: '(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1]);
  assert.ok(hexes.length >= 4, '맛 색을 읽었어요');
  for (const c of [...hexes, 'accent']) {
    const r = contrast('text', c);
    assert.ok(r >= AA, `--text on ${c} = ${r.toFixed(2)}:1`);
  }
});

// ───────────────────────── 초점 표시 ─────────────────────────

test('UI-2 초점 표시: 전역 :focus-visible 은 outline(진한 오렌지, 3:1 이상) — 버튼·카드·세그먼트의 box-shadow 와 겹치지 않음', () => {
  const fv = declsOf(THEME, ':focus-visible');
  assert.match(fv.outline ?? '', /^2px solid var\(--focus-color\)$/);
  assert.equal(fv['box-shadow'], undefined, 'box-shadow 로 그리면 주 버튼·선택된 세그먼트·카드 그림자에 덮여요');
  for (const bg of ['white', 'bg', 'surface-2', 'accent-soft']) {
    const r = contrast('focus-color', bg);
    assert.ok(r >= 3, `--focus-color on ${bg} = ${r.toFixed(2)}:1 (3 이상)`);
  }
  // 링(감싸는 칸용)도 불투명한 진한 색
  assert.match(ROOT['--focus-ring'], /var\(--focus-color\)/);
  assert.doesNotMatch(ROOT['--focus-ring'], /rgba/);
});

test('UI-2 초점 표시를 끄는 규칙은 대신 링을 그리는 곳뿐 (본문·입력칸 안쪽·슬라이더·글상자)', () => {
  const allowed = new Set([
    ':focus', // 마우스 초점 (바로 뒤 :focus-visible 이 다시 켬)
    '.sb-main',
    '.sb-main:focus-visible', // 프로그램 초점(본문으로 건너뛰기)
    '.sb-input__control', // 감싸는 .sb-input:focus-within 이 링
    '.sb-input__control:focus-visible',
    '.sb-slider__input:focus-visible', // 손잡이에 링
    '.sb-textarea:focus', // 같은 규칙에 링
  ]);
  for (const r of [...THEME, ...KIT, ...APP]) {
    if (!/^(none|0)$/.test(r.decls.outline ?? '')) continue;
    for (const s of r.selectors) assert.ok(allowed.has(s), `${s} 가 outline 을 꺼요 — 초점 표시가 사라짐`);
  }
  assert.match(declsOf(KIT, '.sb-input:focus-within')['box-shadow'], /var\(--focus-ring\)/);
  assert.match(declsOf(KIT, '.sb-textarea:focus')['box-shadow'], /var\(--focus-ring\)/);
  assert.match(declsOf(KIT, '.sb-slider__input:focus-visible::-webkit-slider-thumb')['box-shadow'], /var\(--focus-ring\)/);
  // 초점을 받는 키트 요소가 outline 을 덮어쓰지 않음
  for (const s of ['.sb-btn--primary', '.sb-seg__item.is-selected', '.sb-card', '.sb-card--interactive']) {
    assert.equal(declsOf(KIT, s).outline, undefined, s);
  }
});

// ───────────────────────── 360px 상단바 ─────────────────────────

test('UI-1 360px 상단바: 기기 칩이 줄어들 수 있고(min-width 0) 설정 버튼은 그대로 — 좁은 폰에서 기기 이름을 더 줄임', () => {
  assert.equal(declsOf(KIT, '.sb-devchip')['min-width'], '0');
  assert.equal(declsOf(KIT, '.sb-devchip__text').overflow, 'hidden');
  assert.equal(declsOf(KIT, '.sb-devchip__text')['text-overflow'], 'ellipsis');
  assert.equal(declsOf(APP, '.sb-topbar__settings').flex, 'none');
  assert.equal(declsOf(APP, '.sb-topbar__right')['min-width'], '0');
  const narrow = declsOf(KIT, '.sb-devchip--compact .sb-devchip__text', '(max-width: 399px)')['max-width'];
  assert.ok(narrow && parseInt(narrow, 10) <= 64, `360~399px 기기 이름 최대 폭 ${narrow}`);
});

// ───────────────────────── 제조 화면 토스트 ─────────────────────────

test('UI-4 모바일 제조 화면(sb-no-rail): 토스트는 화면 위 — 아래 버튼(좋아요·기록 저장하고 닫기)을 덮지 않음', () => {
  const d = declsOf(KIT, ':root.sb-no-rail .sb-toast-region', '(max-width: 899.98px)');
  assert.match(d.top ?? '', /var\(--safe-top\)/);
  assert.equal(d.bottom, 'auto');
  // 기본(다른 화면)은 그대로 아래
  assert.match(declsOf(KIT, '.sb-toast-region').bottom, /var\(--tabbar-offset\)/);
  // sb-no-rail 은 제조 화면 틀(BareShell)만 붙임
  const app = read('App.tsx');
  const bare = app.slice(app.indexOf('function BareShell'));
  assert.match(bare.slice(0, bare.indexOf('return')), /useNoRailFlag\(\)/);
  assert.equal((app.match(/useNoRailFlag\(\);/g) ?? []).length, 1, 'sb-no-rail 은 제조 화면에서만');
});

// ───────────────────────── 터치 영역 ─────────────────────────

/** 높이 + ::after 위아래 확장 */
function touchHeight(selector: string, afterSelectors: string[]): number {
  const h = parseFloat(declsOf(KIT, selector)['min-height']);
  let extra = 0;
  for (const s of afterSelectors) {
    const inset = declsOf(KIT, s).inset;
    if (inset) extra = -parseFloat(inset.split(/\s+/)[0]) * 2;
  }
  return h + extra;
}

test('UI-6 터치 영역 44px 이상: 세그먼트(md·sm)·작은 칩·맛 단계 0칸', () => {
  assert.equal(declsOf(KIT, '.sb-seg__item').position, 'relative');
  assert.ok(touchHeight('.sb-seg--md .sb-seg__item', ['.sb-seg__item::after']) >= 44);
  assert.ok(touchHeight('.sb-seg--sm .sb-seg__item', ['.sb-seg__item::after']) >= 44);
  // ::after 확장(4px)은 묶음 안쪽 여백(4px) 안 — 묶음 밖으로 나가지 않음
  assert.equal(declsOf(KIT, '.sb-seg').padding, '4px');
  assert.ok(touchHeight('.sb-chip--sm', ['.sb-chip::after', '.sb-chip--sm::after']) >= 44);
  assert.ok(touchHeight('.sb-chip--md', ['.sb-chip::after']) >= 44);
  // 칩 묶음 줄 간격(8px) 안에서만 넓힘 — 위아래 칩의 누름 영역이 겹치면 실제로는 44px 이 안 됨
  assert.equal(declsOf(KIT, '.sb-chipgroup').gap, 'var(--space-2)');
  assert.ok(-parseFloat(declsOf(KIT, '.sb-chip::after').inset) <= 4);
  assert.equal(declsOf(KIT, '.sb-chip--sm::after').inset, undefined);
  assert.match(declsOf(KIT, '.sb-scale__row')['grid-template-columns'], /^minmax\(44px, /);
  assert.equal(declsOf(KIT, '.sb-scale__cell')['min-height'], 'var(--touch)');
});

// ───────────────────────── 창 이름·설명 ─────────────────────────

test('UI-7 modalAria: 본문 제목·설명 id 를 aria-labelledby·describedby 로, 그때는 aria-label 을 쓰지 않음', () => {
  assert.deepEqual(modalAria({ id: 'r1', hasTitle: false, hasDescription: false, labelledBy: 't', describedBy: 'm w' }), {
    labelledBy: 't',
    describedBy: 'm w',
    label: undefined,
  });
  // Modal 자체 title·description 과 합침
  assert.deepEqual(modalAria({ id: 'r1', hasTitle: true, hasDescription: true, describedBy: 'x' }), {
    labelledBy: 'r1-t',
    describedBy: 'r1-d x',
    label: undefined,
  });
  // 아무것도 없으면 aria-label
  assert.deepEqual(modalAria({ id: 'r1', hasTitle: false, hasDescription: false, ariaLabel: '창' }), {
    labelledBy: undefined,
    describedBy: undefined,
    label: '창',
  });
  assert.equal(modalAria({ id: 'r1', hasTitle: false, hasDescription: false, describedBy: '  ' }).describedBy, undefined);
});

test('UI-7 확인창·성인 확인: 질문·경고 문구를 aria-describedby 로 이어 줌 (코드 모양 검사)', () => {
  const modal = read('ui', 'Modal.tsx');
  assert.match(modal, /role=\{role\}/);
  assert.match(modal, /aria-describedby=\{aria\.describedBy\}/);

  const dlg = read('ui', 'dialog', 'DialogHost.tsx');
  assert.match(dlg, /labelledBy=\{titleId\}/);
  assert.match(dlg, /describedBy=\{req\.message \? msgId : undefined\}/);
  assert.match(dlg, /<h2 id=\{titleId\} className="sb-dialog__title">/);
  assert.match(dlg, /<p id=\{msgId\} className="sb-dialog__msg">/);
  assert.match(dlg, /role=\{req\.kind === 'confirm' \? 'alertdialog' : 'dialog'\}/);
  assert.ok(dlg.indexOf('useId()') < dlg.indexOf('if (!req) return null'), 'useId 는 조건부 return 앞 (훅 순서)');

  const adult = read('ui', 'AdultGate.tsx');
  assert.match(adult, /describedBy=\{`\$\{msgId\} \$\{warnId\}`\}/);
  assert.match(adult, /<h2 id=\{titleId\} className="sb-adult__title">/);
  assert.match(adult, /<p id=\{msgId\} className="sb-adult__msg">/);
  assert.match(adult, /<ul id=\{warnId\} className="sb-adult__warn">/);
});
