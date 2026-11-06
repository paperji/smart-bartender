# -*- coding: utf-8 -*-
"""회로도/배선도 SVG 생성용 작은 도우미 (외부 라이브러리 없음).

- Svg: 요소를 모아 문자열로 출력
- wire(): 직교 폴리라인 전선. 먼저 그린 전선과 '점 없이' 교차하면 자동으로 점프(반원) 표시
- 좌표 단위는 viewBox 픽셀
"""
from __future__ import annotations

from xml.sax.saxutils import escape

FONT = "'Malgun Gothic', '맑은 고딕', sans-serif"


def esc(s: str) -> str:
    return escape(str(s), {'"': "&quot;"})


class Svg:
    def __init__(self, w: int, h: int, title: str = "", desc: str = ""):
        self.w, self.h = w, h
        self.title, self.desc = title, desc
        self.defs: list[str] = []
        self.layers: dict[str, list[str]] = {k: [] for k in ("bg", "board", "wire", "part", "dot", "label", "top")}
        self.segments: list[tuple] = []  # (x1, y1, x2, y2, wire_id) 교차 검사용

    # ---- 기본 출력 -------------------------------------------------
    def add(self, s: str, layer: str = "part"):
        self.layers[layer].append(s)

    def render(self) -> str:
        out = [
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
            f'width="{self.w}" height="{self.h}" font-family="{FONT}" role="img" aria-labelledby="t d">',
            f'<title id="t">{esc(self.title)}</title><desc id="d">{esc(self.desc)}</desc>',
        ]
        if self.defs:
            out.append("<defs>" + "".join(self.defs) + "</defs>")
        for k in ("bg", "board", "wire", "part", "dot", "label", "top"):
            if self.layers[k]:
                out.append(f'<g id="layer-{k}">')
                out.extend(self.layers[k])
                out.append("</g>")
        out.append("</svg>")
        return "\n".join(out)

    # ---- 도형 -----------------------------------------------------
    def rect(self, x, y, w, h, fill="none", stroke="#000", sw=1.5, rx=0, layer="part", dash=None, extra=""):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" '
                 f'stroke="{stroke}" stroke-width="{sw}"{d} {extra}/>', layer)

    def circle(self, cx, cy, r, fill="none", stroke="#000", sw=1.5, layer="part", dash=None, extra=""):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d} {extra}/>', layer)

    def line(self, x1, y1, x2, y2, stroke="#000", sw=1.5, layer="part", dash=None, cap="round", extra=""):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke}" '
                 f'stroke-width="{sw}" stroke-linecap="{cap}"{d} {extra}/>', layer)

    def path(self, d, fill="none", stroke="#000", sw=1.5, layer="part", dash=None, extra=""):
        dd = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" '
                 f'stroke-linecap="round"{dd} {extra}/>', layer)

    def polygon(self, pts, fill="#000", stroke="none", sw=1, layer="part", extra=""):
        p = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        self.add(f'<polygon points="{p}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" {extra}/>', layer)

    def text(self, x, y, s, size=14, fill="#111", anchor="start", weight="normal", layer="label",
             halo=True, halo_color="#fff", italic=False, rotate=None, extra=""):
        h = (f' paint-order="stroke" stroke="{halo_color}" stroke-width="{max(2.5, size*0.28):.1f}" '
             f'stroke-linejoin="round"') if halo else ""
        st = ' font-style="italic"' if italic else ""
        rot = f' transform="rotate({rotate} {x:.1f} {y:.1f})"' if rotate is not None else ""
        self.add(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" '
                 f'font-weight="{weight}"{st}{h}{rot} {extra}>{esc(s)}</text>', layer)

    def lines_text(self, x, y, rows, size=13, gap=None, **kw):
        gap = gap or size * 1.35
        for i, r in enumerate(rows):
            if isinstance(r, tuple):
                s, opts = r
                o = dict(kw)
                o.update(opts)
                self.text(x, y + i * gap, s, size=o.pop("size", size), **o)
            else:
                self.text(x, y + i * gap, r, size=size, **kw)

    def dot(self, x, y, r=4.5, fill="#000"):
        self.add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{fill}" stroke="#fff" stroke-width="1.2"/>', "dot")

    def badge(self, x, y, n, color="#333", r=12, size=13):
        self.add(
            f'<g class="badge"><circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="#fff" stroke="{color}" stroke-width="2.4"/>'
            f'<text x="{x:.1f}" y="{y + size*0.36:.1f}" font-size="{size}" font-weight="bold" text-anchor="middle" '
            f'fill="#111">{n}</text></g>', "top")

    # ---- 전선 ------------------------------------------------------
    def wire(self, pts, color="#000", sw=2.5, dash=None, layer="wire", hop_r=7, halo=3.0, outline=None,
             wid=None, hop=True, register=True, end_dots=()):
        """pts: [(x,y), ...] 직교 폴리라인. 앞서 그린 전선과의 '연결 아닌 교차'에 점프 표시."""
        pts = [(float(x), float(y)) for x, y in pts]
        segs = list(zip(pts[:-1], pts[1:]))
        d = [f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"]
        for (x1, y1), (x2, y2) in segs:
            hops = []
            if hop:
                for (a1, b1, a2, b2, w2) in self.segments:
                    if wid is not None and w2 == wid:
                        continue
                    p = _cross(x1, y1, x2, y2, a1, b1, a2, b2, margin=hop_r + 2)
                    if p is not None:
                        hops.append(p)
            if hops:
                horiz = abs(y1 - y2) < 0.01
                if horiz:
                    forward = x2 > x1
                    hops.sort(key=lambda p: p[0], reverse=not forward)
                    for hx, hy in hops:
                        a = hx - hop_r if forward else hx + hop_r
                        b = hx + hop_r if forward else hx - hop_r
                        sweep = 1 if forward else 0
                        d.append(f"L{a:.1f},{y1:.1f} A{hop_r},{hop_r} 0 0 {sweep} {b:.1f},{y1:.1f}")
                else:
                    forward = y2 > y1
                    hops.sort(key=lambda p: p[1], reverse=not forward)
                    for hx, hy in hops:
                        a = hy - hop_r if forward else hy + hop_r
                        b = hy + hop_r if forward else hy - hop_r
                        sweep = 1 if forward else 0
                        d.append(f"L{x1:.1f},{a:.1f} A{hop_r},{hop_r} 0 0 {sweep} {x1:.1f},{b:.1f}")
            d.append(f"L{x2:.1f},{y2:.1f}")
        dstr = " ".join(d)
        dd = f' stroke-dasharray="{dash}"' if dash else ""
        g = ['<g class="wire">']
        if halo:
            g.append(f'<path d="{dstr}" fill="none" stroke="#fff" stroke-width="{sw + 2*halo:.1f}" '
                     f'stroke-linejoin="round" stroke-linecap="round"/>')
        if outline:
            g.append(f'<path d="{dstr}" fill="none" stroke="{outline}" stroke-width="{sw + 1.6:.1f}" '
                     f'stroke-linejoin="round" stroke-linecap="round"{dd}/>')
        g.append(f'<path d="{dstr}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linejoin="round" '
                 f'stroke-linecap="round"{dd}/>')
        g.append("</g>")
        self.add("".join(g), layer)
        if register:
            for (x1, y1), (x2, y2) in segs:
                self.segments.append((x1, y1, x2, y2, wid))
        for p in end_dots:
            self.dot(*p)
        return pts


def _cross(x1, y1, x2, y2, a1, b1, a2, b2, margin=8):
    """수평/수직 선분 두 개가 서로의 '내부'에서 교차하면 교차점 반환."""
    h1 = abs(y1 - y2) < 0.01
    v1 = abs(x1 - x2) < 0.01
    h2 = abs(b1 - b2) < 0.01
    v2 = abs(a1 - a2) < 0.01
    if h1 and v2:
        hx0, hx1 = sorted((x1, x2))
        vy0, vy1 = sorted((b1, b2))
        X, Y = a1, y1
        if hx0 + margin < X < hx1 - margin and vy0 + 1 < Y < vy1 - 1:
            return (X, Y)
    if v1 and h2:
        vy0, vy1 = sorted((y1, y2))
        hx0, hx1 = sorted((a1, a2))
        X, Y = x1, b1
        if vy0 + margin < Y < vy1 - margin and hx0 + 1 < X < hx1 - 1:
            return (X, Y)
    return None


def find_crossings(segments):
    """검증용: 등록된 모든 선분 쌍의 '점 없는' 교차 목록."""
    res = []
    for i in range(len(segments)):
        for j in range(i + 1, len(segments)):
            s, t = segments[i], segments[j]
            if s[4] is not None and s[4] == t[4]:
                continue
            p = _cross(*s[:4], *t[:4], margin=0.5)
            if p:
                res.append((p, s[4], t[4]))
    return res


def overlaps(segments, tol=2.5):
    """검증용: 서로 다른 전선이 같은 직선 위에서 겹치는 구간(구분 불가) 검출."""
    res = []
    for i in range(len(segments)):
        for j in range(i + 1, len(segments)):
            s, t = segments[i], segments[j]
            if s[4] is not None and s[4] == t[4]:
                continue
            (x1, y1, x2, y2), (a1, b1, a2, b2) = s[:4], t[:4]
            if abs(y1 - y2) < .01 and abs(b1 - b2) < .01 and abs(y1 - b1) < tol:
                lo, hi = max(min(x1, x2), min(a1, a2)), min(max(x1, x2), max(a1, a2))
                if hi - lo > 1:
                    res.append(("H", y1, lo, hi, s[4], t[4]))
            if abs(x1 - x2) < .01 and abs(a1 - a2) < .01 and abs(x1 - a1) < tol:
                lo, hi = max(min(y1, y2), min(b1, b2)), min(max(y1, y2), max(b1, b2))
                if hi - lo > 1:
                    res.append(("V", x1, lo, hi, s[4], t[4]))
    return res
