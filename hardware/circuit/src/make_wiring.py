# -*- coding: utf-8 -*-
"""초보자용 실물형 배선도 wiring.svg 생성.

- ESP32 DevKitC V4: 실제 38핀 배열(J2 왼쪽 19핀, J3 오른쪽 19핀, 안테나 위) / 1mm = 7px
- 4채널 릴레이 SZH-RLBG-012: 제조사 치수도(relay 도면)와 같은 방향(단자대 왼쪽, K4 위, 입력 헤더 오른쪽 위) / 1mm = 7px
- 레버 커넥터 PCT-418 ×3 (TB1 5V, TB2 GND, TB3 3V3)
- 전선 번호는 회로도.html 연결표의 번호와 같음 (CONNECTIONS 목록이 두 곳의 공통 원본)
실행: python make_wiring.py → ../wiring.svg (+ connections.json)
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from svgkit import Svg, find_crossings, overlaps  # noqa: E402

W, H = 1800, 1200
S = 7.0  # px per mm

# ---- 색 (전선)
RED, BLK, ORG = "#e53935", "#212121", "#fb8c00"
BLU, GRN, YEL, PUR = "#1e88e5", "#43a047", "#fdd835", "#8e24aa"
PNK, CYN, BRN = "#ec407a", "#00acc1", "#8d6e63"
OUT = {YEL: "#9e7c00", RED: "#9b1c1c", BLK: "#000", ORG: "#b35c00", BLU: "#0d47a1", GRN: "#1b5e20",
       PUR: "#4a148c", PNK: "#880e4f", CYN: "#006064", BRN: "#4e342e"}
W20, W22, WDP = 4.6, 3.8, 3.2  # 선 굵기 표현 (AWG20 / AWG22 / 듀폰)

s = Svg(W, H, title="AI 스마트 바텐더 배선도 v3 (실물 연결도)",
        desc="ESP32 DevKitC V4, 4채널 릴레이, 레버 커넥터 TB1~TB3, DC잭, 스위치, 퓨즈, 펌프 4개, 다이오드, 커패시터의 실제 연결")
s.rect(0, 0, W, H, fill="#ffffff", stroke="none", layer="bg")
s.rect(6, 6, W - 12, H - 12, fill="none", stroke="#555", sw=1.2, layer="bg")

CONN = []  # 연결표 원본: (번호, 출발, 도착, 색이름, 굵기, 비고)


def wire(n, pts, color, sw, frm, to, cname, gauge, note="", badge=None, br=10, dash=None):
    s.wire(pts, color=color, sw=sw, outline=OUT.get(color), wid=f"w{n}", dash=dash)
    if badge:
        s.badge(badge[0], badge[1], n, color=OUT.get(color, color), r=br, size=12 if br >= 10 else 11)
    CONN.append(dict(no=n, frm=frm, to=to, color=cname, gauge=gauge, note=note))


# =====================================================================================
# 1) 부품 그림
# =====================================================================================
def lever_connector(x, y, label, sub, color, nports=8, pitch=35):
    """레버형 8구 커넥터(PCT-418) 윗면. 구멍은 아래쪽(y+60)."""
    w = pitch * nports + 0
    s.rect(x, y, w, 60, fill="#cfd2d6", stroke="#6b6f75", sw=1.6, rx=8)
    for i in range(nports):
        cx = x + pitch / 2 + i * pitch
        s.rect(cx - 11, y + 6, 22, 40, fill="#ff8f00", stroke="#c56000", sw=1.2, rx=5)
        s.line(cx - 6, y + 14, cx + 6, y + 14, stroke="#c56000", sw=1)
        s.circle(cx, y + 54, 4.2, fill="#3a3a3a", stroke="#222", sw=1)
        s.text(cx, y + 74 if False else y - 4, str(i + 1), size=9.5, anchor="middle", fill="#666", halo=False)
    s.text(x, y - 18, label, size=14, weight="bold", fill=color)
    s.text(x + w, y - 18, sub, size=11, fill="#555", anchor="end")
    return [x + pitch / 2 + i * pitch for i in range(nports)]


# ---------------- 레버 커넥터
TB2 = lever_connector(330, 220, "TB2  GND 분배", "PCT-418 · 8구 내부 공통", BLK)
TB1 = lever_connector(640, 220, "TB1  +5V 분배", "PCT-418 · 8구 내부 공통", RED)
TB3 = lever_connector(1080, 220, "TB3  3V3 분배", "PCT-418 (예비분 사용)", ORG)
TBY = 280

# ---------------- 어댑터 · J1 · SW1 · F1 (뒤판 G 전원 패널)
s.rect(330, 72, 310, 100, fill="#f7f7f7", stroke="#bbb", sw=1, rx=8, dash="6 4", layer="bg")
s.text(634, 88, "뒤판 G (전원 패널)에 고정", size=11, fill="#888", halo=False, anchor="end")
# 어댑터
s.rect(40, 74, 100, 92, fill="#2b2b2b", stroke="#111", sw=1.5, rx=10)
s.rect(66, 56, 8, 20, fill="#bdbdbd", stroke="#777", sw=1)
s.rect(106, 56, 8, 20, fill="#bdbdbd", stroke="#777", sw=1)
s.lines_text(90, 108, [("5V 4A", {"weight": "bold", "size": 15}), "어댑터", "(P11)"], size=12, fill="#fff",
             anchor="middle", halo=False)
# DC 케이블 + 플러그
s.path("M140,120 C150,120 150,120 158,120", stroke="#111", sw=6)
s.rect(156, 112, 26, 16, fill="#444", stroke="#111", sw=1, rx=3)
# J1 (DC2.1 FEMALE → 터미널블럭)
s.rect(182, 100, 70, 40, fill="#1e1e1e", stroke="#000", sw=1.4, rx=6)
s.circle(190, 120, 7, fill="#555", stroke="#000", sw=1)
s.rect(252, 92, 48, 56, fill="#2e9d4f", stroke="#1b5e20", sw=1.4, rx=3)
for yy, sign, col in ((106, "−", BLK), (134, "+", RED)):
    s.circle(272, yy, 8, fill="#cfd8dc", stroke="#555", sw=1.2)
    s.line(267, yy, 277, yy, stroke="#555", sw=1.4)
    s.text(258, yy + 5, sign, size=15, weight="bold", fill="#fff", anchor="middle", halo=False)
s.text(217, 160, "J1 DC잭 단자 (P12)", size=11.5, anchor="middle", weight="bold")
# SW1 로커 스위치 (KCD1-101A)
s.rect(362, 104, 58, 60, fill="#111", stroke="#000", sw=1.4, rx=4)
s.rect(370, 110, 42, 48, fill="#c62828", stroke="#7f0000", sw=1.2, rx=3)
s.text(391, 128, "I", size=13, anchor="middle", fill="#fff", weight="bold", halo=False)
s.text(391, 152, "O", size=12, anchor="middle", fill="#fff", weight="bold", halo=False)
s.rect(352, 128, 10, 12, fill="#cfd8dc", stroke="#555", sw=1)
s.rect(420, 128, 10, 12, fill="#cfd8dc", stroke="#555", sw=1)
s.text(391, 98, "SW1 전원 스위치 (P13)", size=11.5, anchor="middle", weight="bold")
# F1 퓨즈홀더 (FH-303) + 3A 퓨즈
s.rect(470, 120, 132, 28, fill="#212121", stroke="#000", sw=1.4, rx=12)
s.rect(486, 125, 82, 18, fill="#e0f2f1", stroke="#90a4ae", sw=1, rx=6)
s.line(490, 134, 564, 134, stroke="#78909c", sw=1.5)
s.rect(602, 124, 16, 20, fill="#424242", stroke="#000", sw=1, rx=2)
s.rect(460, 128, 10, 12, fill="#cfd8dc", stroke="#555", sw=1)
s.rect(618, 128, 10, 12, fill="#cfd8dc", stroke="#555", sw=1)
s.text(540, 168, "F1 퓨즈홀더+3A 퓨즈 (P14·P15)", size=11.5, anchor="middle", weight="bold")

# ---------------- C1 1000uF (TB2 8번 ↔ TB1 1번에 다리를 바로 꽂음)
CX, CY = 625, 296
s.path(f"M{TB2[7]},{TBY} L{CX-9},{CY}", stroke="#9e9e9e", sw=2.2)
s.path(f"M{TB1[0]},{TBY} L{CX+9},{CY}", stroke="#9e9e9e", sw=2.2)
s.rect(CX - 17, CY, 34, 54, fill="#1565c0", stroke="#0d3c78", sw=1.4, rx=6)
s.rect(CX - 17, CY, 11, 54, fill="#cfd8dc", stroke="none", rx=4)
s.text(CX - 11.5, CY + 22, "−", size=12, anchor="middle", weight="bold", fill="#333", halo=False)
s.text(CX - 11.5, CY + 40, "−", size=12, anchor="middle", weight="bold", fill="#333", halo=False)
s.text(CX + 6, CY + 32, "+", size=13, anchor="middle", weight="bold", fill="#fff", halo=False)
s.lines_text(CX - 24, CY + 56, [("C1 1000µF 16V (P16)", {"weight": "bold"}), "띠(−)→TB2 · 긴 다리(+)→TB1"],
             size=11, anchor="end")

# ---------------- 릴레이 모듈 (제조사 치수도와 같은 방향: 단자대 왼쪽)
RX, RY = 480.0, 380.0


def rx(mm):
    return RX + mm * S


def ry(mm):
    return RY + mm * S


s.rect(RX, RY, 56 * S, 76 * S, fill="#1d5fb4", stroke="#0b3a75", sw=2, rx=10, layer="board")
for hx, hy in ((3.3, 3.2), (52.7, 3.2), (3.3, 72.8), (52.7, 72.8)):
    s.circle(rx(hx), ry(hy), 11, fill="#fff", stroke="#c9d6e8", sw=2, layer="board")
KC = {4: 13.5, 3: 29.5, 2: 46.5, 1: 62.5}
TERM = {}
for k, c in KC.items():
    # 단자대(파랑) + 나사 3개
    s.rect(rx(1), ry(c - 7.5), 10 * S, 15 * S, fill="#2f7be0", stroke="#0b3a75", sw=1.4, rx=3, layer="board")
    s.rect(rx(12), ry(c - 7.5), 21 * S, 15 * S, fill="#3d8bfd", stroke="#0b3a75", sw=1.2, rx=4, layer="board")
    s.text(rx(22.5), ry(c - 1.8), "TONGLING  5VDC", size=9.5, anchor="middle", fill="#e3f2fd", halo=False, layer="board")
    s.text(rx(22.5), ry(c + 1.4), "JQC-3FF-S-Z", size=9.5, anchor="middle", fill="#e3f2fd", halo=False, layer="board")
    s.text(rx(22.5), ry(c + 5.2), f"K{k}", size=15, anchor="middle", fill="#fff", weight="bold", halo=False, layer="board")
    s.rect(rx(40), ry(c - 3), 6 * S, 6 * S, fill="#111", stroke="#000", sw=1, rx=2, layer="board")  # 옵토커플러
    for name, dy in (("NO", -5), ("COM", 0), ("NC", 5)):
        TERM[(k, name)] = (rx(6), ry(c + dy))
        s.text(rx(1) - 5, ry(c + dy) + (4 if name != "NO" else -7), f"{name}{k}", size=10.5, anchor="end",
               fill="#333" if name != "NC" else "#999", weight="bold", halo=True)
# 단자 나사(전선 위에 그려서 '끼워져 있는' 느낌)
for (k, name), (x, y) in TERM.items():
    s.circle(x, y, 9.5, fill="#d9dee3", stroke="#6b7580", sw=1.4)
    s.line(x - 5.5, y - 5.5, x + 5.5, y + 5.5, stroke="#6b7580", sw=1.6)
# 입력 헤더 (위→아래: VCC, IN4, IN3, IN2, IN1, GND)
HDR = {}
for i, name in enumerate(["VCC", "IN4", "IN3", "IN2", "IN1", "GND"]):
    HDR[name] = (rx(51), ry(9.5 + i * 2.54))
s.rect(rx(51) - 9, ry(9.5) - 9, 18, 2.54 * S * 5 + 18, fill="#111", stroke="#000", sw=1, rx=2, layer="board")
for name, (x, y) in HDR.items():
    s.text(808, y + 4, name, size=10, anchor="end", fill="#fff", weight="bold", halo=True, halo_color="#1d5fb4")
# IN 표시 LED
for i, k in enumerate((4, 3, 2, 1)):
    yy = ry(33 + i * 6)
    s.rect(rx(52) - 5, yy - 3, 10, 6, fill="#ef9a9a", stroke="#b71c1c", sw=0.8, rx=1, layer="board")
    s.text(rx(52) - 9, yy + 4, f"IN{k}", size=8.5, anchor="end", fill="#cfe3ff", halo=False, layer="board")
# JD-VCC 점퍼 헤더 (점퍼 캡 없음!)
JD = (rx(41), ry(3))
JV = (rx(41) + 2.54 * S, ry(3))
s.rect(JD[0] - 9, JD[1] - 8, 2.54 * S + 18, 16, fill="#111", stroke="#000", sw=1, rx=2, layer="board")
s.text((JD[0] + JV[0]) / 2, JD[1] + 30, "JD-VCC│VCC", size=9.5, anchor="middle", fill="#fff", weight="bold",
       halo=True, halo_color="#1d5fb4")
s.circle((JD[0] + JV[0]) / 2, JD[1], 18, fill="none", stroke="#ff1744", sw=2.4, dash="5 3", layer="top")
s.text(rx(8), ry(73.2), "4채널 릴레이 모듈 SZH-RLBG-012 (P08)", size=13, fill="#fff", weight="bold", halo=False, layer="board")

# ---------------- ESP32 DevKitC V4 (안테나 위, USB 아래)
XE, YE = 1072.0, 350.3


def J2(n):
    return (XE + 1.2 * S, YE + (7.4 + (n - 1) * 2.54) * S)


def J3(n):
    return (XE + 26.7 * S, YE + (7.4 + (n - 1) * 2.54) * S)


s.rect(XE, YE, 28 * S, 54.4 * S, fill="#1f1f1f", stroke="#000", sw=2, rx=6, layer="board")
s.rect(XE + 5 * S, YE, 18 * S, 6.1 * S, fill="#263238", stroke="#455a64", sw=1, layer="board")
s.path(" ".join([f"M{XE+7*S},{YE+4.5*S}", f"L{XE+7*S},{YE+1.2*S}", f"L{XE+10*S},{YE+1.2*S}",
                 f"L{XE+10*S},{YE+4*S}", f"L{XE+13*S},{YE+4*S}", f"L{XE+13*S},{YE+1.2*S}",
                 f"L{XE+16*S},{YE+1.2*S}", f"L{XE+16*S},{YE+4*S}", f"L{XE+19*S},{YE+4*S}", f"L{XE+19*S},{YE+1.2*S}"]),
       stroke="#c9a227", sw=2.2, layer="board")
s.rect(XE + 5 * S, YE + 6.1 * S, 18 * S, 18.8 * S, fill="#b0bec5", stroke="#78909c", sw=1.2, rx=2, layer="board")
s.lines_text(XE + 14 * S, YE + 14 * S, [("ESPRESSIF", {"weight": "bold"}), "ESP32-WROOM-32D"], size=10,
             anchor="middle", fill="#37474f", halo=False, layer="board")
s.rect(XE + 10.2 * S, YE + 49 * S, 7.8 * S, 6.2 * S, fill="#cfd8dc", stroke="#78909c", sw=1.2, rx=2, layer="board")
s.text(XE + 14.1 * S, YE + 53.6 * S, "USB", size=9, anchor="middle", fill="#37474f", halo=False, layer="board")
for bx, bl in ((6.1, "EN"), (21.9, "BOOT")):
    s.rect(XE + bx * S - 10, YE + 49.5 * S, 20, 16, fill="#555", stroke="#222", sw=1, rx=2, layer="board")
    s.text(XE + bx * S, YE + 48.6 * S, bl, size=8.5, anchor="middle", fill="#ddd", halo=False, layer="board")
s.lines_text(XE + 14 * S, YE + 31 * S, [("ESP32", {"weight": "bold", "size": 15}), "DevKitC V4", "(U1 · P01)"],
             size=11.5, anchor="middle", fill="#fff", halo=False, layer="board")
s.text(XE + 14 * S, YE - 6, "▲ 안테나", size=10, anchor="middle", fill="#666", halo=False)
J2N = ["3V3", "EN", "VP", "VN", "34", "35", "32", "33", "25", "26", "27", "14", "12", "GND", "13", "D2", "D3", "CMD", "5V"]
J3N = ["GND", "23", "22", "TX", "RX", "21", "GND", "19", "18", "5", "17", "16", "4", "0", "2", "15", "D1", "D0", "CLK"]
USED2 = {1: ORG, 7: YEL, 8: PUR, 10: BLU, 11: GRN, 14: BLK, 19: RED}
USED3 = {1: BLK, 2: PNK, 7: BLK, 13: CYN, 15: BRN}
for n in range(1, 20):
    for side, names, used, fn in (("L", J2N, USED2, J2), ("R", J3N, USED3, J3)):
        x, y = fn(n)
        col = used.get(n)
        s.rect(x - 5, y - 5, 10, 10, fill="#d4a017" if col else "#8d7a3a", stroke="#5d4a00", sw=0.8, rx=1)
        if col:
            s.circle(x, y, 8.5, fill="none", stroke=col if col != YEL else "#c9a000", sw=2.2)
        tx = x + 10 if side == "L" else x - 10
        s.text(tx, y + 3.5, names[n - 1], size=8.8 if not col else 9.5, anchor="start" if side == "L" else "end",
               fill="#ffffff" if col else "#bdbdbd", weight="bold" if col else "normal", halo=False)
s.text(J2(1)[0], YE - 6, "J2", size=10, anchor="middle", fill="#555", weight="bold", halo=False)
s.text(J3(1)[0], YE - 6, "J3", size=10, anchor="middle", fill="#555", weight="bold", halo=False)

# ---------------- 펌프 4개 (용기 안) + 펌프 쪽 다이오드
NOY = {k: TERM[(k, "NO")][1] for k in KC}
XR, XB = 104, 80          # 이음부에서 빨강/검정 위치
for k in (4, 3, 2, 1):
    y0 = NOY[k]
    # 용기 + 물
    s.rect(66, y0 + 52, 184, 48, fill="#e3f2fd", stroke="#64b5f6", sw=1.4, rx=4, layer="board")
    s.line(62, y0 + 52, 254, y0 + 52, stroke="#90a4ae", sw=3, layer="board")
    s.text(244, y0 + 95, f"용기 {k}", size=10, anchor="end", fill="#1e88e5", halo=False, layer="board")
    # 펌프 몸체
    s.rect(120, y0 + 64, 96, 28, fill="#f5f1e6", stroke="#8d8d8d", sw=1.4, rx=8, layer="board")
    s.rect(200, y0 + 54, 12, 12, fill="#f5f1e6", stroke="#8d8d8d", sw=1.2, rx=2, layer="board")
    s.text(168, y0 + 82, f"펌프 {k}", size=11.5, anchor="middle", weight="bold", fill="#333", halo=False, layer="board")
    # 펌프 케이블(회색 피복) → 뚜껑 → 이음부
    s.path(f"M120,{y0+78} C96,{y0+78} 92,{y0+70} 92,{y0+52} L92,{y0+44}", stroke="#616161", sw=7, layer="board")
    # 이음부(뚜껑 위, 열수축튜브) 속 빨강/검정 + 다이오드
    s.wire([(92, y0 + 44), (XR, y0 + 36), (XR, y0 + 8)], color=RED, sw=2.6, halo=0, register=False)
    s.wire([(92, y0 + 44), (XB, y0 + 36), (XB, y0 + 12)], color=BLK, sw=2.6, halo=0, register=False)
    s.line(XB, y0 + 24, XR, y0 + 24, stroke="#9e9e9e", sw=1.6)                                 # 다이오드 다리
    s.rect(XB + 8, y0 + 19, XR - XB - 16, 10, fill="#212121", stroke="#000", sw=1, rx=2)       # 몸체
    s.rect(XR - 13, y0 + 19, 5, 10, fill="#e0e0e0", stroke="none")                             # 띠(캐소드)=빨강 쪽
    s.rect(XB - 7, y0 + 13, XR - XB + 14, 22, fill="none", stroke="#616161", sw=1.2, rx=6, dash="3 2")
    s.lines_text(124, y0 + 24, [(f"M{k} ← K{k} NO", {"weight": "bold", "fill": "#333"}),
                                (f"D{k} (띠→빨강)", {"fill": "#555", "size": 10.5})], size=11.5, gap=16)

# 확대 그림(펌프 4 기준, 4개 모두 같음)
IX, IY = 266, NOY[4] + 7
s.rect(IX, IY, 176, 94, fill="#ffffff", stroke="#616161", sw=1.3, rx=8)
s.text(IX + 8, IY + 15, "확대: 펌프 쪽 이음부 (4개 모두 같음)", size=10, weight="bold", fill="#333", halo=False)
s.line(IX + 14, IY + 36, IX + 164, IY + 36, stroke=RED, sw=4)
s.line(IX + 14, IY + 72, IX + 164, IY + 72, stroke=BLK, sw=4)
s.text(IX + 12, IY + 32, "+", size=12, weight="bold", fill=RED, halo=False)
s.text(IX + 12, IY + 68, "−", size=13, weight="bold", fill=BLK, halo=False)
s.text(IX + 22, IY + 52, "← 펌프", size=9.5, fill="#777", halo=False)
s.text(IX + 164, IY + 89, "연장선 → 릴레이·TB2", size=9.5, fill="#777", anchor="end", halo=False)
s.line(IX + 70, IY + 36, IX + 70, IY + 72, stroke="#9e9e9e", sw=2)
s.rect(IX + 63, IY + 43, 14, 22, fill="#212121", stroke="#000", sw=1, rx=2)
s.rect(IX + 63, IY + 43, 14, 6, fill="#e0e0e0", stroke="none")
s.rect(IX + 56, IY + 30, 28, 48, fill="none", stroke="#616161", sw=1.2, rx=6, dash="3 2")
s.lines_text(IX + 90, IY + 52, [("띠(은색) = 빨강(+) 쪽", {"weight": "bold", "fill": "#b71c1c"}), "1N4007 · 수축튜브"],
             size=9.5, halo=True, gap=13)

# 듀폰(암) 하우징: 릴레이 입력 헤더 6핀 + JD-VCC 핀 (전선 위에 그림)
DUP = []
for name, (x, y) in HDR.items():
    DUP.append((x + 4, y - 6.5, 16, 13))
DUP.append((JD[0] - 6, JD[1] - 8, 12, 16))

# =====================================================================================
# 2) 전선 (번호 순서 = 조립 순서)
# =====================================================================================
# --- 전원부
s.badge(162, 100, 1, color="#333")
CONN.append(dict(no=1, frm="어댑터 DC 플러그", to="J1 DC잭(2.1×5.5 암)", color="—", gauge="(꽂기)",
                 note="어댑터 콘센트는 마지막 점검 후 꽂기"))
wire(2, [(300, 134), (352, 134)], RED, W20, "J1 (+) 나사", "SW1 단자 1", "빨강", "AWG20", "", badge=(326, 134))
wire(3, [(430, 134), (460, 134)], RED, W20, "SW1 단자 2", "F1 퓨즈홀더 단자 1", "빨강", "AWG20", "납땜+수축튜브", badge=(445, 134), br=9)
wire(4, [(628, 134), (930, 134), (930, 305), (TB1[7], 305), (TB1[7], TBY)], RED, W20,
     "F1 퓨즈홀더 단자 2", "TB1 (+5V) 8번", "빨강", "AWG20", "", badge=(800, 134))
wire(5, [(300, 102), (312, 102), (312, 40), (12, 40), (12, 290), (TB2[0], 290), (TB2[0], TBY)], BLK, W20,
     "J1 (−) 나사", "TB2 (GND) 1번", "검정", "AWG20", "J1(−) 나사에 ⑤·⑦ 두 가닥을 함께 조임", badge=(160, 40))
CONN.append(dict(no=6, frm="C1 띠(−) 다리", to="TB2 8번 / 긴 다리(+) → TB1 1번", color="—", gauge="(부품 다리)",
                 note="TB1·TB2를 나란히 붙여 다리를 바로 꽂음. 극성 반대 금지"))
s.badge(CX + 30, CY + 26, 6, color="#1565c0")
wire(7, [(300, 110), (322, 110), (322, 50), (1390, 50), (1390, J3(1)[1]), (J3(1)[0], J3(1)[1])], BLK, W22,
     "J1 (−) 나사", "ESP32 GND (J3-1, 오른쪽 줄 1번)", "검정", "AWG22 UL1007 (P62)", "ESP32·릴레이 쪽 GND (별형 접지)", badge=(1000, 50))
wire(8, [(TB1[6], TBY), (TB1[6], 370), (815, 370), (815, J2(19)[1]), (J2(19)[0], J2(19)[1])], RED, W22,
     "TB1 (+5V) 7번", "ESP32 5V (J2-19, 왼쪽 줄 맨 아래)", "빨강", "AWG22 UL1007 (P63)", "USB 업로드 때는 이 선을 뽑기!", badge=(950, J2(19)[1]))

# --- 릴레이 전원 · 제어
wire(9, [(TB1[5], TBY), (TB1[5], 360), (JD[0], 360), (JD[0], JD[1])], RED, WDP,
     "TB1 (+5V) 6번", "A안: 릴레이 JD-VCC 핀 (점퍼 헤더 왼쪽) / B안: 입력 헤더 VCC 핀 (⑪을 뺀 자리)", "빨강", "듀폰 F (≈AWG26)",
     "A안: 점퍼 캡은 빼서 보관 / B안: ⑪을 뽑고 ⑨를 입력 헤더 VCC 핀으로 옮긴 뒤 캡 끼움 — 캡과 듀폰 소켓은 한 핀에 같이 꽂을 수 없음(JD-VCC 핀에는 캡만)",
     badge=(TB1[5], 340), br=9)
wire(10, [J2(1), (1065, J2(1)[1]), (1065, 320), (TB3[1], 320), (TB3[1], TBY)], ORG, WDP,
     "ESP32 3V3 (J2-1, 왼쪽 줄 맨 위)", "TB3 (3V3) 2번", "주황", "듀폰 (≈AWG26)",
     "듀폰 양 끝을 잘라 씀. UL1007로 하면 노랑(P24) + 양 끝 번호 테이프 ⑩", badge=(1100, 320), br=9)
wire(11, [HDR["VCC"], (960, HDR["VCC"][1]), (960, 295), (TB3[0], 295), (TB3[0], TBY)], ORG, WDP,
     "릴레이 VCC (입력 헤더 맨 위)", "TB3 (3V3) 1번", "주황", "듀폰 F (≈AWG26)", "B안이면 연결하지 않음 — 이 VCC 핀에는 ⑨(+5V)가 들어감(B안에서 VCC를 3V3에 연결 금지)", badge=(960, 380), br=9)
wire(15, [HDR["IN4"], (1010, HDR["IN4"][1]), (1010, J2(8)[1]), J2(8)], PUR, WDP,
     "ESP32 GPIO33 (J2-8)", "릴레이 IN4", "보라", "듀폰 (≈AWG26)", "펌프4", badge=(868, HDR["IN4"][1]), br=9)
wire(14, [HDR["IN3"], (1035, HDR["IN3"][1]), (1035, J2(7)[1]), J2(7)], YEL, WDP,
     "ESP32 GPIO32 (J2-7)", "릴레이 IN3", "노랑", "듀폰 (≈AWG26)", "펌프3", badge=(898, HDR["IN3"][1]), br=9)
wire(13, [HDR["IN2"], (945, HDR["IN2"][1]), (945, J2(11)[1]), J2(11)], GRN, WDP,
     "ESP32 GPIO27 (J2-11)", "릴레이 IN2", "초록", "듀폰 (≈AWG26)", "펌프2", badge=(926, HDR["IN2"][1]), br=9)
wire(12, [HDR["IN1"], (970, HDR["IN1"][1]), (970, J2(10)[1]), J2(10)], BLU, WDP,
     "ESP32 GPIO26 (J2-10)", "릴레이 IN1", "파랑", "듀폰 (≈AWG26)", "펌프1", badge=(868, HDR["IN1"][1]), br=9)
wire(16, [HDR["GND"], (900, HDR["GND"][1]), (900, J2(14)[1]), J2(14)], BLK, WDP,
     "릴레이 GND (입력 헤더 맨 아래)", "ESP32 GND (J2-14)", "검정", "듀폰 F (≈AWG26)", "릴레이 코일 전류(최대 약 0.3A)도 이 선으로 돌아옴", badge=(990, J2(14)[1]), br=9)

# --- 펌프 전원 (COM ← +5V)
COMLANE = {4: 670, 3: 692, 2: 714, 1: 736}
JOG = {4: (TB1[1], 300), 3: (TB1[2], 310), 2: (TB1[3], 320), 1: (TB1[4], 330)}
BADGE_COM = {4: 400, 3: 520, 2: 640, 1: 760}
for n, k in ((17, 1), (18, 2), (19, 3), (20, 4)):
    px, jy = JOG[k]
    cx, cy = TERM[(k, "COM")]
    wire(n, [(px, TBY), (px, jy), (COMLANE[k], jy), (COMLANE[k], cy), (cx, cy)], RED, W20,
         f"TB1 (+5V) {2 + 4 - k}번", f"릴레이 K{k} COM (가운데 단자)", "빨강", "AWG20", "",
         badge=(COMLANE[k], BADGE_COM[k]), br=9)

# --- 펌프 배선 (NO → 펌프+, 펌프− → TB2)
LANE = {1: 24, 2: 36, 3: 48, 4: 60}
TURN = {1: 300, 2: 310, 3: 320, 4: 330}
PORT = {1: TB2[1], 2: TB2[2], 3: TB2[3], 4: TB2[4]}
BADGE_BK = {1: 292, 2: 297, 3: 302, 4: 307}
num = 21
for k in (1, 2, 3, 4):
    y0 = NOY[k]
    nx, ny = TERM[(k, "NO")]
    wire(num, [(XR, y0 + 8), (XR, y0), (nx, ny)], RED, W20,
         f"릴레이 K{k} NO (위 단자)", f"펌프{k} 빨간선(+)", "빨강", "AWG20 2P", "펌프 선은 뚜껑 위 이음부에서 연장",
         badge=(300, y0), br=10)
    wire(num + 1, [(XB, y0 + 12), (XB, y0 + 6), (LANE[k], y0 + 6), (LANE[k], TURN[k]), (PORT[k], TURN[k]), (PORT[k], TBY)],
         BLK, W20, f"펌프{k} 검은선(−)", f"TB2 (GND) {k + 1}번", "검정", "AWG20 2P", "",
         badge=(PORT[k], BADGE_BK[k]), br=9)
    num += 2

# --- 선택 부품 (앞판 F)
PX0, PY0, PX1, PY1 = 1446, 352, 1792, 736
s.rect(PX0, PY0, PX1 - PX0, PY1 - PY0, fill="#f5f5f5", stroke="#9e9e9e", sw=1.4, rx=12, layer="bg")
s.text(PX0 + 10, PY0 + 20, "앞판 F — 조작 패널 (안쪽에서 본 모습) · LED 필수", size=12, weight="bold", fill="#555")
# BZ1
BZ = (1460, 395)
s.rect(BZ[0], BZ[1], 118, 72, fill="#0d47a1", stroke="#062a63", sw=1.4, rx=4, layer="board")
s.circle(BZ[0] + 72, BZ[1] + 36, 24, fill="#111", stroke="#000", sw=1, layer="board")
s.circle(BZ[0] + 72, BZ[1] + 36, 5, fill="#444", stroke="none", layer="board")
BZP = {"VCC": (BZ[0], 410), "I/O": (BZ[0], 430), "GND": (BZ[0], 450)}
for nm, (x, y) in BZP.items():
    s.text(x + 6, y + 3.5, nm, size=8.5, fill="#fff", weight="bold", halo=False)
s.lines_text(1588, 412, [("BZ1 능동 부저 (P04)", {"weight": "bold"}), "HIGH = 울림", "앞판 안쪽에 접착"], size=11)
# SW2 버튼
SWC = (1630, J3(13)[1])
s.circle(SWC[0], SWC[1], 24, fill="#9e9e9e", stroke="#555", sw=1.6, layer="board")
s.circle(SWC[0], SWC[1], 15, fill="#cfd8dc", stroke="#777", sw=1.2, layer="board")
s.rect(1596, SWC[1] - 5, 12, 10, fill="#d4a017", stroke="#5d4a00", sw=1)
s.rect(1652, SWC[1] - 5, 12, 10, fill="#d4a017", stroke="#5d4a00", sw=1)
s.text(SWC[0], SWC[1] - 32, "SW2 시작/정지 버튼 (P03)", size=11, anchor="middle", weight="bold")
# R1 + LED1
YLED = 692
s.rect(1482, YLED - 7, 56, 14, fill="#e8d5b0", stroke="#8d6e63", sw=1.2, rx=6)
for i, c in enumerate(("#d32f2f", "#d32f2f", "#5d4037", "#c9a227")):
    s.rect(1492 + i * 10, YLED - 7, 4, 14, fill=c, stroke="none")
s.circle(1640, YLED, 11, fill="#ef5350", stroke="#b71c1c", sw=1.4)
s.line(1651, YLED - 8, 1651, YLED + 8, stroke="#b71c1c", sw=2)   # 평평한 쪽(캐소드)
s.text(1510, YLED + 26, "R1 220Ω (P06)", size=10.5, anchor="middle", weight="bold")
s.text(1640, YLED + 26, "LED1 (P05)", size=10.5, anchor="middle", weight="bold")
s.text(1598, YLED - 13, "긴 다리(+)", size=9.5, anchor="end", fill="#b71c1c")
s.text(1664, YLED - 13, "짧은 다리(−)", size=9.5, anchor="start", fill="#333")
GB = 1752  # 앞판 GND 공통선 x
wire(29, [(TB3[2], TBY), (TB3[2], 300), (1430, 300), (1430, BZP["VCC"][1]), BZP["VCC"]], YEL, WDP,
     "TB3 (3V3) 3번", "BZ1 VCC", "노랑", "AWG22 UL1007 (P24) + 듀폰 F",
     "부저를 달 때만. 3V3선 — 노랑 신호선과 같은 색이라 양 끝 번호 테이프 ㉙ (듀폰 주황으로 이어도 됨)", badge=(1300, 300), br=9)
wire(30, [J3(2), (1440, J3(2)[1]), (1440, BZP["I/O"][1]), BZP["I/O"]], YEL, WDP,
     "ESP32 GPIO23 (J3-2)", "BZ1 I/O", "노랑", "AWG22 UL1007 (P24) + 듀폰 F", "양 끝 번호 테이프 ㉚", badge=(1318, J3(2)[1]), br=9)
wire(31, [J3(7), (GB, J3(7)[1])], BLK, W22, "ESP32 GND (J3-7)", "앞판 GND 공통선", "검정", "AWG22 UL1007 (P62)", "",
     badge=(1330, J3(7)[1]), br=9)
wire(32, [BZP["GND"], (1452, BZP["GND"][1]), (1452, 490), (GB, 490)], BLK, WDP, "BZ1 GND", "앞판 GND 공통선",
     "검정", "듀폰 F + AWG22 UL1007 (P62)", "", badge=(1640, 490), br=9)
wire(33, [J3(13), (1602, J3(13)[1])], YEL, WDP, "ESP32 GPIO4 (J3-13)", "SW2 단자 1", "노랑", "AWG22 UL1007 (P24)",
     "납땜 · 양 끝 번호 테이프 ㉝",
     badge=(1330, J3(13)[1]), br=9)
wire(34, [(1658, SWC[1]), (GB, SWC[1])], BLK, WDP, "SW2 단자 2", "앞판 GND 공통선", "검정", "AWG22 UL1007 (P62)", "납땜",
     badge=(1706, SWC[1]), br=9)
wire(35, [J3(15), (1420, J3(15)[1]), (1420, YLED), (1482, YLED)], YEL, WDP, "ESP32 GPIO2 (J3-15)",
     "R1 → LED1 긴 다리(+)", "노랑", "AWG22 UL1007 (P24)", "R1은 LED 다리에 납땜 · 양 끝 번호 테이프 ㉟",
     badge=(1330, J3(15)[1]), br=9)
s.wire([(1538, YLED), (1629, YLED)], color="#9e9e9e", sw=2, halo=0, register=False)
wire(36, [(1651, YLED), (GB, YLED)], BLK, WDP, "LED1 짧은 다리(−)", "앞판 GND 공통선", "검정", "AWG22 UL1007 (P62)", "",
     badge=(1708, YLED), br=9)
s.wire([(GB, 490), (GB, YLED)], color=BLK, sw=W22, outline="#000", wid="gbus")
for yy in (490, J3(7)[1], SWC[1], YLED):
    s.dot(GB, yy, r=5)
s.text(GB + 10, 600, "앞판 GND 공통선 (납땜)", size=10.5, weight="bold", rotate=90, anchor="middle")

# ---------------- 설명 말풍선
s.rect(874, 334, 80, 92, fill="#fff1f0", stroke="#ff1744", sw=1.6, rx=8)
s.lines_text(914, 354, [("JD-VCC", {"weight": "bold", "fill": "#d50000"}), ("점퍼 제거!", {"weight": "bold", "fill": "#d50000"}),
                         ("캡을 빼서", {"fill": "#333"}), ("보관 (A안)", {"fill": "#333"})], size=11, anchor="middle", halo=False, gap=18)
s.path("M874,392 L832,400", stroke="#ff1744", sw=1.8)
s.polygon([(826, 401), (836, 394), (836, 405)], fill="#ff1744")

s.rect(1000, 746, 430, 74, fill="#fffde7", stroke="#d4b106", sw=1.2, rx=8)
s.lines_text(1012, 766, [("ESP32 핀 세는 법: 안테나를 위로, 위에서부터 1, 2, 3 …", {"weight": "bold"}),
                          "왼쪽 줄 J2: 3V3=1 · 32=7 · 33=8 · 26=10 · 27=11 · GND=14 · 5V=19",
                          "오른쪽 줄 J3: GND=1 · 23=2 · GND=7 · 4=13 · 2=15  (확장보드: 같은 이름 단자)"],
             size=11.5, halo=False, gap=18)

# ---------------- 제목 (오른쪽 위)
s.text(1430, 92, "AI 스마트 바텐더", size=26, weight="bold", halo=False)
s.text(1430, 126, "배선도 (실물 연결도) v3", size=22, weight="bold", halo=False)
s.lines_text(1430, 156, ["팀 홍당무 · 2026-11-06 · SPEC v2.1 기준", "도면 SB-SCH-03 · 시트 2/2 (1/2 = 회로도)",
                         "번호 ①~㊱ = 연결 순서 (회로도.html 연결표)"], size=12, fill="#444", halo=False, gap=18)
s.rect(1418, 60, 368, 160, fill="none", stroke="#333", sw=1.4, rx=6, layer="bg")

# =====================================================================================
# 3) 아래 범례
# =====================================================================================
LY = 934
s.rect(14, LY, 760, 254, fill="#fafafa", stroke="#bbb", sw=1.2, rx=8, layer="bg")
s.text(28, LY + 24, "전선 색 · 굵기", size=15, weight="bold", halo=False)
# UL1007(P24 노랑·P62 검정·P63 빨강) 세 색만 구매 → 앞판 신호선 ㉙㉚㉝㉟는 모두 노랑, 양 끝 번호 테이프로 구분
leg = [(RED, "빨강 = +5V · 펌프(+)"), (BLK, "검정 = GND · 펌프(−)"), (ORG, "주황 = 3V3 (5V 닿으면 ESP32 고장)"),
       (BLU, "파랑 = IN1 ← GPIO26 (펌프1)"), (GRN, "초록 = IN2 ← GPIO27 (펌프2)"),
       (YEL, "노랑 = IN3 ← GPIO32 (펌프3)"), (PUR, "보라 = IN4 ← GPIO33 (펌프4)"),
       (YEL, "노랑 = 앞판 ㉙ ㉚ ㉝ ㉟ (UL1007)"), (None, "같은 노랑 → 양 끝 번호 테이프"),
       (None, "⑦㉛~㊱ 검정 · ⑧ 빨강 UL1007")]
for i, (col, txt) in enumerate(leg):
    cx = 30 if i < 5 else 290
    cy = LY + 50 + (i % 5) * 24
    if col:
        s.line(cx, cy, cx + 34, cy, stroke=OUT[col], sw=6)
        s.line(cx, cy, cx + 34, cy, stroke=col, sw=4.2)
    s.text(cx + 42, cy + 4.5, txt, size=11.5, halo=False, fill="#111" if col else "#555")
s.text(530, LY + 24, "권장 굵기", size=13, weight="bold", halo=False)
for i, (wd, txt) in enumerate(((W20, "AWG20 (보유 2P 빨/검): ②~⑤ ⑰~㉘"), (W22, "AWG22 (UL1007 3색): ⑦ ⑧ ㉙~㊱"),
                              (WDP, "듀폰 점퍼 (P20~22): ⑨~⑯"))):
    cy = LY + 50 + i * 24
    s.line(530, cy, 560, cy, stroke="#333", sw=wd)
    s.text(568, cy + 4.5, txt, size=11, halo=False)
s.lines_text(530, LY + 132, ["큰 전류(펌프·전원)는 굵은 선,", "신호선은 가는 선이면 충분."], size=11, fill="#555", halo=False)
s.path("M30,1120 L52,1120 A7,7 0 0 1 66,1120 L88,1120", stroke="#333", sw=3)
s.line(59, 1104, 59, 1136, stroke="#777", sw=3)
s.text(96, 1125, "반원 점프 = 그냥 위로 지나감 (연결 안 됨)", size=11.5, halo=False)
s.dot(400, 1120, r=5)
s.text(412, 1125, "점 = 연결(납땜/단자)", size=11.5, halo=False)
s.badge(570, 1120, 7, color="#333")
s.text(586, 1125, "= 연결 번호(표 참고)", size=11.5, halo=False)
s.lines_text(30, 1152, ["굵기: AWG20 = 펌프·전원 큰 전류선(보유 2P 빨강/검정), AWG22 = UL1007 노랑 P24·검정 P62·빨강 P63, 듀폰 = 점퍼선(P20~P22).",
                        "릴레이 헤더처럼 수(male) 핀에는 듀폰 암(F) 끝을, 레버 커넥터·나사 단자에는 피복을 8~10mm 벗긴 끝을 꽂습니다."],
             size=11, fill="#444", halo=False, gap=17)

s.rect(788, LY, 998, 254, fill="#fff8f6", stroke="#e0a89a", sw=1.2, rx=8, layer="bg")
s.text(802, LY + 24, "전원 넣기 전 5가지 확인 (자세한 내용: 회로도.html)", size=15, weight="bold", fill="#b00020", halo=False)
s.lines_text(802, LY + 50, [
    "1) (A안) 릴레이 JD-VCC 점퍼 캡을 뺐는가?  (빨강 ⑨ = JD-VCC 핀, 주황 ⑪ = VCC 핀 — 두 핀을 바꿔 꽂으면 3V3 쪽에 5V가 들어가 ESP32 고장)",
    "2) 다이오드 D1~D4 띠(은색 줄)가 빨간선(+) 쪽인가?  반대로 달면 릴레이가 켜질 때 단락 → ESP32 재부팅·어댑터 꺼짐·다이오드 과열(퓨즈는 멀쩡할 수 있음).",
    "3) C1 띠(−)가 TB2(GND), 긴 다리(+)가 TB1(+5V)에 꽂혔는가?  반대로 꽂으면 커패시터가 부풀거나 터질 수 있음.",
    "4) ESP32에 USB를 꽂을 때는 ⑧(TB1→ESP32 5V) 선을 먼저 뽑고, 뽑은 끝을 테이프로 감쌌는가?  (이중 전원 금지, GND ⑦은 그대로)",
    "5) 어댑터를 꽂기 전에 멀티미터 도통(삐) 모드로 TB1–TB2 사이를 재서 '삐' 소리가 안 나는가?  (나면 단락 → 배선 다시 확인)",
    "※ 릴레이 단자 NO/NC는 보드 인쇄를 확인: 전원 없이 멀티미터 도통 모드에서 COM–NC는 '삐', COM–NO는 무음이 정상.",
    "※ 3.3V로 안 켜지면 B안: USB·어댑터를 모두 뺀 뒤 ⑪ 먼저 뽑기 → ⑨를 JD-VCC 핀에서 빈 VCC 핀으로 → 점퍼 캡 끼우기(VCC=5V). 3V3 연결 금지.",
    "※ 다이오드 위치: 이 그림은 뚜껑 위 이음부. 연장선의 박스 쪽 끝(조립 가이드 STEP3)에 달아도 전기적으로 동일 — 펌프와 병렬, 띠 = 빨강(+).",
], size=11.6, halo=False, gap=25)

for (x, y, w_, h_) in DUP:
    s.rect(x, y, w_, h_, fill="#202020", stroke="#000", sw=1, rx=2, layer="top")
# =====================================================================================
out_dir = os.path.join(os.path.dirname(__file__), "..")
with open(os.path.join(out_dir, "wiring.svg"), "w", encoding="utf-8") as f:
    f.write(s.render())
CONN.sort(key=lambda c: c["no"])
with open(os.path.join(os.path.dirname(__file__), "connections.json"), "w", encoding="utf-8") as f:
    json.dump(CONN, f, ensure_ascii=False, indent=1)
cr = find_crossings(s.segments)
ov = overlaps(s.segments)
print("written wiring.svg ; connections:", len(CONN), "numbers:", sorted(c["no"] for c in CONN) == list(range(1, 37)))
print("unmarked crossings (drawn with hop):", len(cr))
for c in cr:
    print("   ", c)
print("collinear overlaps:", ov)
