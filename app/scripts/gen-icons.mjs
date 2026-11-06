#!/usr/bin/env node
/**
 * 앱 아이콘·스플래시 만들기 — 한 그림(당근 장식을 꽂은 칵테일 잔, src/ui/BrandMark.tsx 와 같은 좌표)에서
 * 웹(PWA)·안드로이드(APK)·Windows(EXE)에 필요한 모든 아이콘을 외부 라이브러리 없이 만듭니다.
 *
 *  웹(PWA)   public/favicon.svg
 *            public/icons/icon-192.png, icon-512.png            (둥근 사각형, purpose any)
 *            public/icons/icon-maskable-192.png, -512.png        (꽉 찬 배경 + 안전 영역 안 그림, purpose maskable)
 *            public/icons/apple-touch-icon.png                   (180px, 꽉 찬 배경)
 *  안드로이드 android/app/src/main/res/ (android 폴더가 있을 때만)
 *            mipmap-*dpi/ic_launcher.png · ic_launcher_round.png (안드로이드 7 이하용 그림 아이콘)
 *            drawable/ic_launcher_foreground.xml · ic_launcher_monochrome.xml (적응형 아이콘 — 벡터라 어떤 크기에서도 선명)
 *            values/ic_launcher_background.xml                  (적응형 아이콘 배경색 = 당근색)
 *            drawable/ic_brand_mark.xml · splash_icon.xml · splash.xml (시작 화면: 밝은 바탕 + 마크)
 *            drawable-*dpi/ic_stat_notify.png                   (알림 작은 아이콘: 흰 실루엣)
 *  Windows   electron/icons/icon.png (512) · icon.ico (16~256 여러 크기)
 *
 * 실행: npm run icons   (그림을 바꾸면 src/ui/BrandMark.tsx 도 같이 바꿔 주세요)
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const HEX = {
  orange: '#FF7A2F',
  white: '#FFFFFF',
  liquid: '#FFD2B5',
  carrot: '#E8611A',
  leaf: '#1E9E6A',
  bg: '#F7F6F3',
};
const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/**
 * 마크 그림 (64×64 좌표, BrandMark 와 같음) — 순서대로 칠함
 *  poly: 채운 다각형(+선택 테두리), line: 둥근 끝 선
 *  mono: 흰 실루엣(알림·단색 아이콘)에서의 처리 — 'fill' 흰색, 'clear' 지움(테두리로 당근과 잔 사이 틈 만들기)
 */
const SHAPES = [
  { kind: 'poly', pts: [[15, 20], [49, 20], [35, 37], [29, 37]], fill: HEX.white },
  { kind: 'poly', pts: [[19.5, 25], [44.5, 25], [35, 36], [29, 36]], fill: HEX.liquid },
  { kind: 'line', segs: [[[32, 37], [32, 48]], [[24.5, 50], [39.5, 50]]], w: 3.4, color: HEX.white },
  { kind: 'poly', pts: [[43, 11], [50, 21], [40.5, 19]], fill: HEX.carrot, stroke: HEX.white, sw: 1.6, monoStroke: 'clear' },
  { kind: 'line', segs: [[[43, 11], [41, 6.5]], [[43, 11], [45.5, 6]], [[43, 11], [48, 8.5]]], w: 2.2, color: HEX.leaf },
];

/** 마크가 시각적으로 가운데 오도록 잡은 중심 (잎 끝 ~ 받침 아래) */
const MARK_CENTER = [32, 29];

// ───────────────────────── SVG / 안드로이드 벡터 ─────────────────────────

const ptsPath = (pts) => 'M' + pts.map(([x, y]) => `${x} ${y}`).join(' L') + ' Z';
const segsPath = (segs) => segs.map(([a, b]) => `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`).join(' ');

function svgMark() {
  return SHAPES.map((s) => {
    if (s.kind === 'poly') {
      const stroke = s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.sw}" stroke-linejoin="round"` : '';
      return `  <path d="${ptsPath(s.pts)}" fill="${s.fill}"${stroke}/>`;
    }
    return `  <path d="${segsPath(s.segs)}" stroke="${s.color}" stroke-width="${s.w}" stroke-linecap="round"/>`;
  }).join('\n');
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="${HEX.orange}"/>
${svgMark()}
</svg>
`;

/** 안드로이드 VectorDrawable 경로들 (mono 면 모두 흰색 채움, 당근 테두리는 생략) */
function vdPaths(mono) {
  return SHAPES.map((s) => {
    if (s.kind === 'poly') {
      const fill = mono ? '#FFFFFFFF' : s.fill;
      const stroke = s.stroke && !mono ? ` android:strokeColor="${s.stroke}" android:strokeWidth="${s.sw}" android:strokeLineJoin="round"` : '';
      return `    <path android:fillColor="${fill}"${stroke} android:pathData="${ptsPath(s.pts)}" />`;
    }
    const color = mono ? '#FFFFFFFF' : s.color;
    return `    <path android:strokeColor="${color}" android:strokeWidth="${s.w}" android:strokeLineCap="round" android:pathData="${segsPath(s.segs)}" />`;
  }).join('\n');
}

/** 108 크기 캔버스 가운데에 마크를 scale 배로 (적응형 아이콘·시작 화면 아이콘) */
function vectorXml({ size = 108, scale, mono = false, comment }) {
  const [cx, cy] = MARK_CENTER;
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${comment} — scripts/gen-icons.mjs 가 만든 파일이에요(직접 고치지 말고 npm run icons) -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${size}dp"
    android:height="${size}dp"
    android:viewportWidth="${size}"
    android:viewportHeight="${size}">
  <group
      android:pivotX="${cx}"
      android:pivotY="${cy}"
      android:scaleX="${scale}"
      android:scaleY="${scale}"
      android:translateX="${size / 2 - cx}"
      android:translateY="${size / 2 - cy}">
${vdPaths(mono)}
  </group>
</vector>
`;
}

/** 둥근 당근색 사각형 + 마크 (안드로이드 11 이하 시작 화면 가운데 그림) */
function brandMarkXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- 앱 마크(둥근 사각형) — scripts/gen-icons.mjs 가 만든 파일이에요 -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="64dp"
    android:height="64dp"
    android:viewportWidth="64"
    android:viewportHeight="64">
    <path android:fillColor="${HEX.orange}" android:pathData="M16 0 H48 A16 16 0 0 1 64 16 V48 A16 16 0 0 1 48 64 H16 A16 16 0 0 1 0 48 V16 A16 16 0 0 1 16 0 Z" />
${vdPaths(false)}
</vector>
`;
}

// ───────────────────────── PNG 그리기 (4×4 표본으로 가장자리 부드럽게) ─────────────────────────

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distSeg(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx - x;
  const py = ay + t * dy - y;
  return Math.sqrt(px * px + py * py);
}

function inRoundRect(x, y, size, r) {
  const cx = Math.max(r, Math.min(size - r, x));
  const cy = Math.max(r, Math.min(size - r, y));
  return x >= 0 && y >= 0 && x <= size && y <= size && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const CLEAR = 'clear';

/**
 * (x,y) — 64 좌표계 한 점의 색 (null = 투명)
 *  bg: 'rounded' | 'square' | 'circle' | null(투명) — 배경 모양 (당근색)
 *  scale: 마크 크기 배율 (MARK_CENTER 기준, 결과는 캔버스 가운데)
 *  mono: 흰 실루엣
 */
function colorAt(x, y, { bg, scale, mono }) {
  let col = null;
  if (bg === 'rounded' && inRoundRect(x, y, 64, 16)) col = HEX.orange;
  else if (bg === 'square') col = HEX.orange;
  else if (bg === 'circle' && (x - 32) ** 2 + (y - 32) ** 2 <= 32 * 32) col = HEX.orange;
  if (bg && !col) return null;
  const gx = (x - 32) / scale + MARK_CENTER[0];
  const gy = (y - 32) / scale + MARK_CENTER[1];
  for (const s of SHAPES) {
    if (s.kind === 'poly') {
      if (inPoly(gx, gy, s.pts)) col = mono ? HEX.white : s.fill;
      if (s.stroke) {
        for (let i = 0; i < s.pts.length; i++) {
          if (distSeg(gx, gy, s.pts[i], s.pts[(i + 1) % s.pts.length]) <= s.sw / 2) {
            col = mono ? (s.monoStroke === 'clear' ? CLEAR : HEX.white) : s.stroke;
            break;
          }
        }
      }
    } else if (s.segs.some(([a, b]) => distSeg(gx, gy, a, b) <= s.w / 2)) {
      col = mono ? HEX.white : s.color;
    }
  }
  return col === CLEAR ? null : col;
}

function render(size, opts) {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((pxi + (sx + 0.5) / SS) / size) * 64;
          const y = ((py + (sy + 0.5) / SS) / size) * 64;
          const c = colorAt(x, y, opts);
          if (c) {
            const [cr, cg, cb] = rgb(c);
            r += cr;
            g += cg;
            b += cb;
            a += 1;
          }
        }
      }
      const i = (py * size + pxi) * 4;
      if (a) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
        px[i + 3] = Math.round((a / (SS * SS)) * 255);
      }
    }
  }
  return px;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** PNG 여러 장을 담은 .ico (Windows Vista 이상은 ICO 안 PNG 를 읽음) */
function ico(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([head, dir, ...entries.map((e) => e.data)]);
}

// ───────────────────────── 저장 ─────────────────────────

const made = [];
function save(rel, data) {
  const file = join(ROOT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  made.push(rel);
}

const ICON = { bg: 'rounded', scale: 1, mono: false };
const FULL = (scale) => ({ bg: 'square', scale, mono: false });

// 웹(PWA)
save('public/favicon.svg', FAVICON_SVG);
save('public/icons/icon-192.png', png(192, render(192, ICON)));
save('public/icons/icon-512.png', png(512, render(512, ICON)));
// maskable: 안전 영역(가운데 지름 80% 원) 안에 마크 전체가 들어가게
save('public/icons/icon-maskable-192.png', png(192, render(192, FULL(0.8))));
save('public/icons/icon-maskable-512.png', png(512, render(512, FULL(0.8))));
save('public/icons/apple-touch-icon.png', png(180, render(180, FULL(0.86))));

// Windows (Electron)
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
save('electron/icons/icon.ico', ico(icoSizes.map((s) => ({ size: s, data: png(s, render(s, ICON)) }))));
save('electron/icons/icon.png', png(512, render(512, ICON)));

// 안드로이드 (android 폴더가 있을 때만)
const RES = 'android/app/src/main/res';
if (existsSync(join(ROOT, RES))) {
  const DPI = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [name, f] of Object.entries(DPI)) {
    const s = Math.round(48 * f);
    save(`${RES}/mipmap-${name}/ic_launcher.png`, png(s, render(s, { bg: 'rounded', scale: 0.92, mono: false })));
    save(`${RES}/mipmap-${name}/ic_launcher_round.png`, png(s, render(s, { bg: 'circle', scale: 0.86, mono: false })));
    const n = Math.round(24 * f);
    save(`${RES}/drawable-${name}/ic_stat_notify.png`, png(n, render(n, { bg: null, scale: 1.12, mono: true })));
    // 예전 템플릿의 비트맵 전경(적응형 아이콘은 이제 벡터 drawable/ic_launcher_foreground.xml 사용)
    rmSync(join(ROOT, `${RES}/mipmap-${name}/ic_launcher_foreground.png`), { force: true });
  }
  // 적응형 아이콘(안드로이드 8+): 108dp 캔버스, 안전 영역 지름 66dp 안에 마크 → scale 1.1 (마크 반지름 약 27.5 → 30)
  save(`${RES}/drawable/ic_launcher_foreground.xml`, vectorXml({ scale: 1.1, comment: '적응형 아이콘 전경(당근 장식 칵테일 잔)' }));
  save(`${RES}/drawable/ic_launcher_monochrome.xml`, vectorXml({ scale: 1.1, mono: true, comment: '테마 아이콘(안드로이드 13+)용 단색 전경' }));
  rmSync(join(ROOT, `${RES}/drawable-v24/ic_launcher_foreground.xml`), { force: true });
  rmSync(join(ROOT, `${RES}/drawable/ic_launcher_background.xml`), { force: true });
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>
</adaptive-icon>
`;
  save(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`, adaptive);
  save(`${RES}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive);
  save(
    `${RES}/values/ic_launcher_background.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- 적응형 아이콘 배경 = 당근색 (테마 accent) -->
    <color name="ic_launcher_background">${HEX.orange}</color>
    <!-- 시작 화면 바탕 = 앱 바탕색 (테마 bg) -->
    <color name="splash_background">${HEX.bg}</color>
</resources>
`,
  );
  // 시작 화면: 안드로이드 12+ 는 시스템 스플래시(아이콘 + 당근색 원 배경), 11 이하는 splash.xml(밝은 바탕 + 가운데 마크)
  save(`${RES}/drawable/splash_icon.xml`, vectorXml({ scale: 1.1, comment: '안드로이드 12+ 시작 화면 아이콘' }));
  save(`${RES}/drawable/ic_brand_mark.xml`, brandMarkXml());
  save(
    `${RES}/drawable/splash.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<!-- 시작 화면(안드로이드 11 이하): 밝은 바탕 + 가운데 앱 마크 — scripts/gen-icons.mjs 가 만든 파일이에요 -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splash_background" />
    <item
        android:width="112dp"
        android:height="112dp"
        android:drawable="@drawable/ic_brand_mark"
        android:gravity="center" />
</layer-list>
`,
  );
  // 템플릿의 큰 splash.png 들은 지움 (splash.xml 하나로 대신)
  for (const dir of readdirSync(join(ROOT, RES))) {
    if (/^drawable(-(land|port))?(-[a-z]+dpi)?$/.test(dir)) rmSync(join(ROOT, RES, dir, 'splash.png'), { force: true });
  }
  for (const dir of readdirSync(join(ROOT, RES))) {
    const p = join(ROOT, RES, dir);
    if (/^drawable-(land|port)-/.test(dir) && readdirSync(p).length === 0) rmSync(p, { recursive: true, force: true });
  }
} else {
  console.log('(android 폴더가 없어 안드로이드 아이콘은 건너뜀 — npx cap add android 뒤 다시 실행)');
}

for (const m of made) console.log('만듦: ' + m);
