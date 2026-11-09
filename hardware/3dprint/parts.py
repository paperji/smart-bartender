# -*- coding: utf-8 -*-
"""칵테일 배합 메이커 — 3D 프린팅 부품(포맥스 5T 본체용) STL 생성 (v2, 독립 검토 반영)
사용: python -I parts.py <out_dir>
단위 mm. 모든 부품은 출력 방향(바닥면 = z 0)으로 놓아 저장한다. 서포트 없이 출력되도록 설계.
설계 근거: 조립가이드 STEP8~10·부록 B(포맥스 5T, W420×D260×H380), BOM(P03 버튼 HX16-B1 패널 홀 16mm·머리 18mm,
          P05 LED 5mm, P37/P38 M3×10·M3 너트, P30 튜브 내경4/외경6, P44 그로밋 Ø20×2·Ø12×1),
          노즐 판 M1(60×60, 구멍 한 줄 12mm 간격, 앞에서 30) + M2(60×20×2), 칸막이 E Ø25.
v2 변경: 너트 홈 맞변 5.9·깊이 3.0, 수평 볼트 구멍 Ø3.5 눈물방울, 브래킷 보강대 한 장(서포트 없음),
        노즐 튜브 구멍 Ø6.2·날개 볼트 구멍 없앰(접착)·받침 45°·칸막이 2.0·펌프 번호 점,
        베젤 버튼 구멍 Ø18.8(버튼은 F 판에 직접)·LED 뒤 홈, 그로밋 걸림 +0.8·트임 3.5,
        상판 캡 옆 다리 10mm·C 아래 1mm 띄움, 칸막이 E 튜브 부싱 추가, 업로드용 묶음 파일
"""
import json
import math
import os
import struct
import sys

import manifold3d as m3
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
os.makedirs(OUT, exist_ok=True)
SEG = 72
M = m3.Manifold
CS = m3.CrossSection

PANEL = 5.0          # 포맥스 두께
NUT_AF = 5.9         # M3 너트(맞변 5.5) + 출력 오차·처짐 여유
NUT_H = 3.0          # 너트 높이 2.4 + 0.6 (M3×10 이 너트 위로 약 0.6mm 나옴)
BOLT_H = 3.5         # 수평 볼트 구멍(눈물방울)
BOLT_V = 3.4         # 수직 볼트 구멍


def box(x0, y0, z0, x1, y1, z1):
    return M.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0])


def cyl(h, r, x=0.0, y=0.0, z=0.0, r2=None, seg=SEG):
    return M.cylinder(h, r, r if r2 is None else r2, seg).translate([x, y, z])


def hexprism(af, h):
    """맞변 af, 높이 h 인 육각기둥(z 0~h, 축 = z, 꼭짓점이 ±x 방향 → 맞변이 ±y)"""
    r = af / math.sqrt(3)
    pts = [(r * math.cos(math.radians(60 * i)), r * math.sin(math.radians(60 * i))) for i in range(6)]
    return CS([pts]).extrude(h)


def teardrop(d, h):
    """지름 d 눈물방울 기둥(z 0~h), 꼭짓점이 +y(출력할 때 위쪽)로 45°"""
    c = CS.circle(d / 2, SEG)
    tip = CS.square([0.02, 0.02]).translate([-0.01, d / 2 * math.sqrt(2) - 0.01])
    return CS.batch_hull([c, tip]).extrude(h)


def rounded_rect(w, h, r):
    return CS.square([w - 2 * r, h - 2 * r]).translate([r, r]).offset(r, m3.JoinType.Round, 2, SEG)


def xz_prism(pts, y0, y1):
    """XZ 평면 다각형(pts = (x, z), 반시계)을 y0~y1 로 민 것"""
    return CS([pts]).extrude(y1 - y0).rotate([90, 0, 0]).translate([0, y1, 0])


def dots(n, cx, cy, z_top, pitch=2.4, d=1.6, depth=0.6):
    """윗면(z_top)에 새길 점 n 개(가로 한 줄) — 빼기용"""
    out = None
    for i in range(n):
        x = cx + (i - (n - 1) / 2) * pitch
        c = cyl(depth + 1, d / 2, x, cy, z_top - depth, seg=24)
        out = c if out is None else out + c
    return out


# ------------------------------------------------------------------ 1. 모서리 브래킷 (L자 꺾쇠 대체, 너트 홈 일체형)
def bracket():
    W, LEG, T = 16.0, 26.0, PANEL
    hc = T + 11.0                                  # 구멍 중심: 바깥 모서리에서 16
    body = box(0, 0, 0, LEG, W, T) + box(0, 0, 0, T, W, LEG)
    body = body + xz_prism([(T, T), (T + 7.0, T), (T, T + 7.0)], 0, W)      # 폭 전체 보강대(출력 시 수직 벽)
    # 가로 다리(아래 z0 가 판에 닿음): 볼트 구멍(축 z) + 위쪽 너트 홈
    body = body - teardrop(BOLT_H, T + 2).translate([hc, W / 2, -1])
    body = body - hexprism(NUT_AF, NUT_H + 0.01).translate([hc, W / 2, T - NUT_H])
    # 세로 다리(바깥 x0 이 판에 닿음): 볼트 구멍(축 x) + 안쪽 너트 홈
    td = teardrop(BOLT_H, T + 2).rotate([0, 90, 0]).translate([-1, W / 2, hc])   # (x,y,z)→(z,y,-x): 꼭짓점 +y 유지
    nx = hexprism(NUT_AF, NUT_H + 0.01).rotate([0, 90, 0]).translate([T - NUT_H, W / 2, hc])
    body = body - td - nx
    body = body - xz_prism([(-0.01, -0.01), (2.0, -0.01), (-0.01, 2.0)], -1, W + 1)   # 바깥 모서리 모따기
    return body.rotate([90, 0, 0])                 # 출력: 옆면(y0)이 바닥 → L 단면이 바닥, 모델 +y = 출력 위


# ------------------------------------------------------------------ 2. 노즐 블록 (M1+M2 일체형)
def nozzle(H=25.0):
    P, T = 60.0, PANEL
    body = box(0, 0, 0, P, P, T) + box(0, 0, T, T, P, H) + box(P - T, 0, T, P, P, H)
    for x in (18.0, 30.0, 42.0):                   # 튜브 칸막이(구멍 뒤 ~ 뒤 끝)
        body = body + box(x - 1.0, 37.0, T, x + 1.0, P, T + 8.0)
    for x0, x1 in ((-10.0, 0.0), (P, P + 10.0)):  # 접착 날개(윗면 = 벽 윗면)
        body = body + box(x0, 15.0, H - 3.0, x1, 45.0, H)
    body = body + xz_prism([(0.0, H - 13.0), (0.0, H - 3.0), (-10.0, H - 3.0)], 15.0, 45.0)      # 45° 받침(왼쪽)
    body = body + xz_prism([(P, H - 13.0), (P + 10.0, H - 3.0), (P, H - 3.0)], 15.0, 45.0)       # 45° 받침(오른쪽)
    for i, x in enumerate((12.0, 24.0, 36.0, 48.0), start=1):
        body = body - cyl(T + 2, 6.2 / 2, x, 30.0, -1)                        # 튜브(외경 6) 꽉 끼움
        body = body - cyl(1.2, 6.2 / 2, x, 30.0, T - 1.2 + 0.001, r2=6.2 / 2 + 1.0)   # 위쪽 모따기
        body = body - dots(i, x, 9.0, T)                                     # 펌프 번호 점 1~4
    arrow = CS([[(30.0, 14.0), (33.5, 19.0), (26.5, 19.0)]]).extrude(1.6).translate([0, 0, T - 0.6])   # '앞' 화살표(▼, 앞=y0)
    body = body - arrow
    return body                                    # 출력: 바닥판(출구 면)이 바닥


# ------------------------------------------------------------------ 3. 앞면 조작부 베젤
def bezel():
    W, Hh, T, TOP = 100.0, 40.0, 2.4, 0.6
    body = rounded_rect(W, Hh, 5.0).extrude(T)
    body = body + rounded_rect(W - 1.6, Hh - 1.6, 4.2).extrude(TOP).translate([0.8, 0.8, T])
    bx, lx, cy = 70.0, 30.0, 20.0                  # 앞에서 볼 때 LED 왼쪽, 버튼 오른쪽(간격 40)
    top = T + TOP
    body = body - cyl(10, 18.8 / 2, bx, cy, -1)                                   # 버튼 머리(Ø18) 통과 → 버튼은 F 판에 고정
    body = body - (cyl(1, 11.6, bx, cy, top - 0.4) - cyl(1.2, 10.8, bx, cy, top - 0.5))   # 버튼 둘레 장식 홈
    body = body - cyl(10, 5.25 / 2, lx, cy, -1)                                   # LED 몸통
    body = body - cyl(1.2, 6.4 / 2, lx, cy, -0.01)                                # 뒤쪽: LED 테(Ø5.8) 자리
    body = body - cyl(1.0, 5.25 / 2, lx, cy, top - 1.0, r2=7.5 / 2)              # 앞쪽 모따기(옆에서도 보이게)
    body = body - (cyl(1, 4.6, lx, cy, top - 0.4) - cyl(1.2, 3.95, lx, cy, top - 0.5))    # LED 둘레 장식 홈
    for x in (lx, bx):                                                           # 라벨 스티커 자리
        body = body - box(x - 13, 2.6, top - 0.4, x + 13, 6.6, top + 1)
    return body                                    # 출력: 뒷면(F 판에 닿는 면)이 바닥


# ------------------------------------------------------------------ 4. 그로밋 (5mm 판, 옆 트임)
def grommet(hole, inner, flange_extra=4.0, slit=3.5):
    br = (hole - 0.4) / 2                          # 몸통 반지름
    lr = (hole + 0.8) / 2                          # 걸림 반지름(구멍보다 0.4 큼)
    z_fl, z_lip = 1.6, 1.6 + PANEL + 0.3
    body = cyl(z_fl, hole / 2 + flange_extra)
    body = body + cyl(z_lip - z_fl + 0.001, br, 0, 0, z_fl - 0.0005)
    body = body + cyl(0.6, br, 0, 0, z_lip, r2=lr)                              # 45° 넓어짐(턱 오버행 없음)
    body = body + cyl(1.5, lr, 0, 0, z_lip + 0.6 - 0.0005, r2=br - 0.2)         # 끼우는 쪽 경사
    body = body - cyl(20, inner / 2, 0, 0, -1)
    body = body - box(-slit / 2, 0, -1, slit / 2, hole, 20)
    return body                                    # 출력: 테가 바닥


# ------------------------------------------------------------------ 5. 상판 모서리 캡 (상판 C 에만 접착)
def lid_cap():
    L, T, DOWN, FIT = 22.0, 3.0, 10.0, PANEL      # 윗면 22×22, 옆 다리 10mm(C 두께 5 + 5)
    # 좌표: 상자 모서리 = 원점, 상자는 x≥0, y≥0, z≤0 (z=0 이 상판 윗면)
    pts = [[x, y, z] for x in (0, L) for y in (0, L) for z in (-DOWN, 0)]
    outer = M.batch_hull([M.sphere(T, 48).translate(p) for p in pts])
    outer = outer ^ box(-T - 1, -T - 1, -DOWN, L, L, T + 1)
    cap = outer - box(0, 0, -DOWN - 1, L + 10, L + 10, 0)
    # C 아랫면(z=-5)보다 아래는 안쪽 면을 1mm 띄움(재단 오차로 B·F·G 에 걸리지 않게)
    cap = cap - box(-1.0, -T - 1, -DOWN - 1, 0, L + 1, -FIT) - box(-T - 1, -1.0, -DOWN - 1, L + 1, 0, -FIT)
    return cap.mirror([0, 0, 1])                   # 출력: 윗면 판이 바닥, 옆 다리는 위로


# ------------------------------------------------------------------ 6. 칸막이 E 튜브 부싱 (Ø25 구멍, 튜브 4가닥 2×2)
def bushing():
    hole, T = 25.0, PANEL
    body = cyl(1.6, 16.0) + cyl(T + 0.3 + 0.001, (hole - 0.4) / 2, 0, 0, 1.6 - 0.0005)
    for x, y in ((-4.0, 4.0), (4.0, 4.0), (-4.0, -4.0), (4.0, -4.0)):
        body = body - cyl(20, 6.6 / 2, x, y, -1)                 # 튜브(외경 6) 통과
    return body


def bushing_marked():
    """번호 점: 테의 바깥 면(출력 바닥 z0, 판에 닿지 않는 면)에 구멍마다 점 1~4개 — 튜브 n 은 점 n개 옆 구멍으로"""
    body = bushing()
    pos = {1: (-4.0, 4.0), 2: (4.0, 4.0), 3: (-4.0, -4.0), 4: (4.0, -4.0)}
    for n, (x, y) in pos.items():
        a = math.atan2(y, x)
        cx, cy = 13.5 * math.cos(a), 13.5 * math.sin(a)
        for i in range(n):                         # 반지름 방향과 수직으로 점 n 개
            t = (i - (n - 1) / 2) * 2.2
            px, py = cx - t * math.sin(a), cy + t * math.cos(a)
            body = body - cyl(1.6, 0.7, px, py, -1.0, seg=24)   # 바닥(z0)에서 0.6mm 깊이 → 테의 보이는 면
    return body


# ------------------------------------------------------------------ 저장·배치
def write_stl(man, path):
    mesh = man.to_mesh()
    v = np.asarray(mesh.vert_properties)[:, :3].astype(np.float64)
    t = np.asarray(mesh.tri_verts).astype(np.int64)
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    n = np.cross(b - a, c - a)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    ln[ln == 0] = 1
    n = n / ln
    rec = np.zeros(len(t), dtype=np.dtype([("n", "<3f4"), ("a", "<3f4"), ("b", "<3f4"), ("c", "<3f4"), ("x", "<u2")]))
    rec["n"], rec["a"], rec["b"], rec["c"] = n, a, b, c
    with open(path, "wb") as f:
        f.write(b"cocktail-maker part, unit mm".ljust(80, b" "))
        f.write(struct.pack("<I", len(t)))
        f.write(rec.tobytes())


def place_on_bed(man):
    bb = man.bounding_box()
    return man.translate([-bb[0], -bb[1], -bb[2]])


def arrange(items, bed=(250.0, 250.0), gap=6.0):
    """간단한 줄 배치(왼쪽 아래부터) — 업로드용 묶음 파일"""
    placed, x, y, row_h = [], 0.0, 0.0, 0.0
    for man in items:
        bb = man.bounding_box()
        w, d = bb[3] - bb[0], bb[4] - bb[1]
        if x + w > bed[0]:
            x, y, row_h = 0.0, y + row_h + gap, 0.0
        placed.append(man.translate([x - bb[0], y - bb[1], -bb[2]]))
        x += w + gap
        row_h = max(row_h, d)
    assert y + row_h <= bed[1], "판에 다 안 들어감"
    return M.compose(placed)


PARTS = [
    # (파일 이름, 함수, 수량, 설명)
    ("01_corner_bracket", bracket, 14, "모서리 브래킷(L자 꺾쇠 대체, M3 너트 홈 2개) — 필요 12 + 예비 2"),
    ("02_nozzle_block", nozzle, 1, "노즐 블록(노즐 판 M1 + 걸이 M2 일체형, 튜브 칸막이·펌프 번호 점·접착 날개)"),
    ("03_front_bezel", bezel, 1, "앞면 조작부 베젤(버튼·LED 둘레, 앞판 상부 F 바깥에 붙임)"),
    ("04_grommet_20", lambda: grommet(20.0, 13.0), 2, "그로밋(선반 D 의 Ø20 구멍, 5mm 판, 옆 트임)"),
    ("05_grommet_12", lambda: grommet(12.0, 7.0, 3.0), 1, "그로밋(뒤판 G 의 Ø12 구멍, 어댑터 선, 옆 트임)"),
    ("06_lid_corner_cap", lid_cap, 4, "상판 모서리 캡(상판 C 네 모서리, C 에만 접착)"),
    ("07_divider_bushing", bushing_marked, 1, "칸막이 E 튜브 부싱(Ø25 구멍, 튜브 4가닥 2×2, 번호 점)"),
]

if __name__ == "__main__":
    info, mans = [], {}
    for name, fn, qty, desc in PARTS:
        man = place_on_bed(fn())
        assert man.status() == m3.Error.NoError, (name, man.status())
        bb = man.bounding_box()
        size = [round(bb[3] - bb[0], 1), round(bb[4] - bb[1], 1), round(bb[5] - bb[2], 1)]
        vol = man.volume() / 1000.0
        write_stl(man, os.path.join(OUT, name + ".stl"))
        mans[name] = man
        info.append({"file": name + ".stl", "qty": qty, "desc": desc, "size_mm": size, "volume_cm3": round(vol, 2),
                     "genus": man.genus(), "tris": man.num_tri()})
        print(f"{name:22s} x{qty:<2d} size {size} vol {vol:6.2f} cm3  tris {man.num_tri():6d} genus {man.genus()}")
    # 업로드용 묶음: 브래킷 14개 한 판 / 나머지 부품 한 판
    plate_a = arrange([mans["01_corner_bracket"]] * 14, bed=(160.0, 160.0))
    others = [mans["02_nozzle_block"], mans["03_front_bezel"], mans["04_grommet_20"], mans["04_grommet_20"],
              mans["05_grommet_12"], mans["07_divider_bushing"]] + [mans["06_lid_corner_cap"]] * 4
    plate_b = arrange(others, bed=(250.0, 250.0))
    for nm, pl in (("plate_A_brackets_x14", plate_a), ("plate_B_others_x10", plate_b)):
        write_stl(pl, os.path.join(OUT, nm + ".stl"))
        bb = pl.bounding_box()
        print(f"{nm:22s} size {[round(bb[3]-bb[0],1), round(bb[4]-bb[1],1), round(bb[5]-bb[2],1)]} vol {pl.volume()/1000:6.2f} cm3")
    json.dump(info, open(os.path.join(OUT, "parts.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
