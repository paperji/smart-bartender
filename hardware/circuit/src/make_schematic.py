# -*- coding: utf-8 -*-
"""정식 회로도 schematic.svg 생성 (SPEC §1 핀맵 기준).

실행:  python make_schematic.py  → ../schematic.svg
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from svgkit import Svg, find_crossings  # noqa: E402

W, H = 1800, 1200
Y5, YG = 160, 980            # +5V 레일, GND 레일
C5, CG, C33 = "#d32f2f", "#1a1a1a", "#ef6c00"
CP = ["#1e63d6", "#2e9e44", "#b8860b", "#8e3fbf"]   # P1~P4
CM = "#8b1a1a"                                     # 펌프(+) (릴레이 ON일 때만 5V)
C_LED, C_BTN, C_BZ = "#6d4c41", "#00838f", "#c2185b"
GRAY = "#777"
OPT = "6 5"                                        # 선택 부품 점선

s = Svg(W, H, title="AI 스마트 바텐더 회로도 v3 (정식 회로도)",
        desc="ESP32 DevKitC V4, 4채널 릴레이(SZH-RLBG-012), 수중펌프 4개, 1N4007 플라이백 다이오드, 1000uF 커패시터, 5V 4A 전원")

s.rect(0, 0, W, H, fill="#ffffff", stroke="none", layer="bg")
s.rect(8, 8, W - 16, H - 16, fill="none", stroke="#444", sw=1.2, layer="bg")

# ---------------------------------------------------------------- 제목
s.text(28, 50, "AI 스마트 바텐더 — 정식 회로도 (Schematic) v3", size=28, weight="bold", halo=False)
s.text(30, 80, "ESP32 DevKitC V4 → 4채널 릴레이(Active-LOW) → 수중펌프 4개 · 펌프 단독 시간 제어 · BLE 통신 · "
       "핀 번호는 docs/SPEC.md §1 핀맵과 동일", size=15, fill="#444", halo=False)


def sym_open(x, y, r=4.5, color="#000"):
    s.circle(x, y, r, fill="#fff", stroke=color, sw=1.8)


def frame(x, y, w, h, label, dash="10 6", color="#9e9e9e"):
    s.rect(x, y, w, h, fill="none", stroke=color, sw=1.3, rx=10, dash=dash, layer="bg")
    s.text(x + 12, y + 22, label, size=16, weight="bold", fill="#555")


# ================================================================ ① 전원 입력
frame(18, 100, 560, 340, "① 전원 입력")
# 어댑터
s.rect(40, 145, 110, 150, fill="#f3f3f3", stroke="#333", sw=1.6, rx=8, layer="board")
s.lines_text(95, 190, [("AC 어댑터", {"weight": "bold"}), "5V 4A", "(P11)"], size=15, anchor="middle", halo=False)
s.text(95, 272, "AC 100~240V", size=11, anchor="middle", fill="#666", halo=False)
s.text(158, 152, "+", size=14, fill=C5, weight="bold", halo=False)
s.text(158, 298, "−", size=16, fill=CG, weight="bold", halo=False)
# J1 DC잭 터미널
s.rect(190, 145, 60, 150, fill="#e8f5e9", stroke="#333", sw=1.6, rx=6, layer="board")
s.lines_text(220, 205, [("J1", {"weight": "bold", "size": 16}), "DC잭", "단자", "(P12)"], size=12, anchor="middle", halo=False)
s.wire([(150, Y5), (190, Y5)], color=C5, sw=2.6, wid="adp+")
s.wire([(150, 280), (190, 280)], color=CG, sw=2.6, wid="adp-")
s.text(170, 318, "플러그→잭", size=11, anchor="middle", fill="#666", halo=False)
sym_open(190, Y5, 3.5)
sym_open(190, 280, 3.5)
s.text(256, 152, "+", size=14, fill=C5, weight="bold", halo=False)
s.text(256, 298, "−", size=16, fill=CG, weight="bold", halo=False)

# SW1 (로커 스위치, SPST)
s.wire([(250, Y5), (285, Y5)], color=C5, sw=2.6, wid="sw1a")
sym_open(285, Y5)
sym_open(335, Y5)
s.line(288, Y5 - 2, 330, Y5 - 22, stroke="#000", sw=2.4)
s.lines_text(310, 188, [("SW1", {"weight": "bold"}), "전원 스위치", "(P13)"], size=12.5, anchor="middle")
# F1 퓨즈
s.wire([(335, Y5), (372, Y5)], color=C5, sw=2.6, wid="f1a")
s.rect(372, Y5 - 9, 60, 18, fill="#fff", stroke="#000", sw=1.8, rx=2)
s.line(372, Y5, 432, Y5, stroke="#000", sw=1.4)
s.lines_text(404, 188, [("F1", {"weight": "bold"}), "퓨즈 3A", "(P14·P15)"], size=12.5, anchor="middle")

# +5V 레일 / GND 레일
X_END = 1645
s.wire([(432, Y5), (X_END, Y5)], color=C5, sw=3.6, wid="rail5")
s.text(470, Y5 - 10, "+5V", size=15, fill=C5, weight="bold")
s.text(1030, Y5 - 10, "+5V 버스 (실물: TB1 레버 커넥터)", size=13, fill=C5, weight="bold")
s.wire([(300, YG), (X_END, YG)], color=CG, sw=3.6, wid="railG")
s.text(560, YG + 20, "GND — 모든 GND 공통 (실물: TB2 레버 커넥터 · J1(−) · ESP32 GND핀)", size=13, weight="bold")

# J1(−) → GND 레일
s.wire([(250, 280), (300, 280), (300, YG)], color=CG, sw=2.6, wid="j1-")
s.text(306, 420, "GND", size=12, weight="bold")

# C1 1000uF
XC = 455
s.wire([(XC, Y5), (XC, 248)], color=C5, sw=2.4, wid="c1+")
s.dot(XC, Y5)
s.line(XC - 18, 250, XC + 18, 250, stroke="#000", sw=3)                  # + 판(직선)
s.path(f"M{XC-18},266 Q{XC},256 {XC+18},266", stroke="#000", sw=3)    # − 판(곡선)
s.text(XC - 30, 247, "+", size=15, weight="bold", fill=C5)
s.wire([(XC, 262), (XC, 340), (300, 340)], color=CG, sw=2.4, wid="c1-")
s.dot(300, 340)
s.lines_text(XC + 26, 248, [("C1", {"weight": "bold", "size": 15}), "1000µF 16V", "전해 (P16)", "극성 주의"], size=12)

# ================================================================ ② ESP32
EX0, EY0, EX1, EY1 = 600, 330, 840, 780
s.rect(EX0, EY0, EX1 - EX0, EY1 - EY0, fill="#fbfbfd", stroke="#1b1b1b", sw=2.2, rx=8, layer="board")
s.text(612, 380, "② U1  ESP32 DevKitC V4", size=16, weight="bold", halo=False)
s.text(612, 400, "(ESP32-WROOM-32D · P01)", size=12, fill="#555", halo=False)

# 5V 핀 (위)
s.wire([(640, EY0), (640, Y5)], color=C5, sw=2.6, wid="esp5v")
s.dot(640, Y5)
s.text(646, 352, "5V (J2-19)", size=12, weight="bold", fill=C5, halo=False)
s.text(646, 250, "ESP32 5V 입력", size=12, fill=C5)
s.text(646, 266, "(USB 연결 시 이 선 분리!)", size=11.5, fill="#b00020", weight="bold")

# 오른쪽 핀: 3V3, GPIO26/27/32/33  →  릴레이 VCC, IN1~4
RIN = {"VCC": 410, "IN1": 470, "IN2": 530, "IN3": 590, "IN4": 650}
pins_r = [("3V3 (J2-1)", RIN["VCC"], C33, "3V3"), ("GPIO26 (J2-10)", RIN["IN1"], CP[0], "P1"),
          ("GPIO27 (J2-11)", RIN["IN2"], CP[1], "P2"), ("GPIO32 (J2-7)", RIN["IN3"], CP[2], "P3"),
          ("GPIO33 (J2-8)", RIN["IN4"], CP[3], "P4")]
RX0 = 960
for name, y, col, net in pins_r:
    s.text(EX1 - 8, y + 4, name, size=12.5, anchor="end", weight="bold", fill=col, halo=False)
    s.wire([(EX1, y), (RX0, y)], color=col, sw=2.6, wid="sig" + net)
    s.text(898, y - 7, net, size=13, anchor="middle", weight="bold", fill=col)

# 아래 핀: GND
s.text(EX1 - 8, EY1 - 10, "GND (J2-14)", size=12.5, anchor="end", weight="bold", halo=False)
s.wire([(790, EY1), (790, YG)], color=CG, sw=2.6, wid="espG")
s.dot(790, YG)

# 왼쪽 핀: GPIO2, GPIO4, GPIO23 (선택)
s.text(EX0 + 8, 524, "GPIO2 (J3-15)", size=12.5, weight="bold", fill=C_LED, halo=False)
s.text(EX0 + 8, 614, "GPIO4 (J3-13)", size=12.5, weight="bold", fill=C_BTN, halo=False)
s.text(EX0 + 8, 704, "GPIO23 (J3-2)", size=12.5, weight="bold", fill=C_BZ, halo=False)
s.lines_text(EX0 + 12, 728, ["BLE 이름: SmartBartender-XXXX", "펌웨어: firmware/SmartBartender"], size=11, fill="#666", halo=False)

# 확장 메모
s.rect(606, 800, 168, 150, fill="#fafafa", stroke=GRAY, sw=1.2, rx=6, dash="5 4", layer="board")
s.lines_text(616, 822, [("확장(선택) 펌프 5~8", {"weight": "bold"}), "GPIO25·13·18·19", "→ 2번째 릴레이 IN1~4",
                         "(위와 같은 회로 반복,", " 펌웨어 PUMP_COUNT=8)"], size=12, fill="#555", halo=False)

# ================================================================ ③ 릴레이 모듈
RX1, RY0, RY1 = 1700, 260, 690
s.rect(RX0, RY0, RX1 - RX0, RY1 - RY0, fill="#f4f8ff", stroke="#1b1b1b", sw=2.2, rx=8, layer="board")
s.text(972, 288, "③ 4채널 릴레이 모듈 (P08)", size=15, weight="bold", halo=False)

# JD-VCC 핀 → +5V
YJD = 316
s.wire([(RX0, YJD), (920, YJD), (920, Y5)], color=C5, sw=2.6, wid="jdvcc")
s.dot(920, Y5)
s.text(926, 232, "JD-VCC", size=12, fill=C5, weight="bold")
s.text(926, 247, "← +5V", size=12, fill=C5, weight="bold")
for name, y in [("JD-VCC", YJD), ("VCC", RIN["VCC"]), ("IN1", RIN["IN1"]), ("IN2", RIN["IN2"]),
                ("IN3", RIN["IN3"]), ("IN4", RIN["IN4"]), ("GND", 670)]:
    sym_open(RX0, y, 3.5)
    s.text(RX0 + 8, y - 6, name, size=12, weight="bold", fill="#222", halo=False)

# 내부: JD-VCC ─ 점퍼(제거) ─ VCC
s.line(RX0, YJD, 1045, YJD, stroke="#555", sw=1.4)
s.line(1045, YJD, 1045, 336, stroke="#555", sw=1.4)
s.circle(1045, 340, 4, fill="#fff", stroke="#000", sw=1.6)
s.circle(1045, 384, 4, fill="#fff", stroke="#000", sw=1.6)
s.line(1045, 388, 1045, RIN["VCC"], stroke="#555", sw=1.4)
s.line(RX0, RIN["VCC"], 1100, RIN["VCC"], stroke="#555", sw=1.4)
s.line(1100, RIN["VCC"], 1100, 440, stroke="#555", sw=1.4)
s.rect(1056, 332, 16, 60, fill="none", stroke="#d32f2f", sw=1.6, rx=4, dash="4 3")      # 빠진 점퍼 캡
s.line(1052, 344, 1076, 380, stroke="#d32f2f", sw=2.6)
s.line(1076, 344, 1052, 380, stroke="#d32f2f", sw=2.6)
s.lines_text(1084, 350, [("JD-VCC 점퍼 제거!", {"weight": "bold", "fill": "#d32f2f"}),
                          ("VCC=3.3V(입력부)", {"fill": "#444"}), ("JD-VCC=5V(코일)", {"fill": "#444"})],
             size=12, halo=False)

# 입력부(옵토커플러)
s.rect(1020, 440, 110, 220, fill="#fff", stroke="#333", sw=1.6, rx=6)
s.lines_text(1075, 480, [("입력부", {"weight": "bold"}), "옵토커플러", "×4 +", "트랜지스터", "", ("LOW = ON", {"weight": "bold", "fill": "#b00020"})],
             size=12.5, anchor="middle", halo=False)
for key in ("IN1", "IN2", "IN3", "IN4"):
    s.line(RX0, RIN[key], 1020, RIN[key], stroke="#555", sw=1.4)
s.line(RX0, 670, 1075, 670, stroke="#555", sw=1.4)
s.line(1075, 670, 1075, 660, stroke="#555", sw=1.4)

# 릴레이 GND → GND 레일
s.wire([(RX0, 670), (900, 670), (900, YG)], color=CG, sw=2.6, wid="relG")
s.dot(900, YG)

# 채널 K1~K4 + 펌프
XK = [1225, 1365, 1505, 1645]
for i, xk in enumerate(XK):
    n = i + 1
    # COM ↔ +5V
    s.wire([(xk, RY0), (xk, Y5)], color=C5, sw=2.6, wid=f"com{n}")
    if xk != X_END:
        s.dot(xk, Y5)
    sym_open(xk, RY0, 3.5)
    s.text(xk - 6, RY0 + 16, f"COM{n}", size=11, anchor="end", fill="#333", halo=False)
    # NC (미사용)
    s.line(xk + 35, RY0, xk + 35, 236, stroke=GRAY, sw=1.6)
    sym_open(xk + 35, 232, 4, color=GRAY)
    s.text(xk + 43, 228, f"NC{n}", size=11, fill=GRAY, halo=False)
    s.text(xk + 43, 242, "(비움)", size=10, fill=GRAY, halo=False)
    sym_open(xk + 35, RY0, 3.5, color=GRAY)
    # 접점 (그림은 코일에 전기가 없을 때 = OFF 상태)
    s.line(xk, RY0, xk, 300, stroke="#000", sw=2)
    s.circle(xk, 300, 3.2, fill="#000", stroke="#000", sw=1)
    s.line(xk, 300, xk + 27, 340, stroke="#000", sw=2.4)                 # 가동 접점(블레이드)
    s.line(xk + 35, RY0, xk + 35, 344, stroke=GRAY, sw=1.6)
    s.line(xk + 35, 344, xk + 24, 344, stroke=GRAY, sw=2.4)              # NC 고정접점
    s.line(xk, 362, xk + 16, 362, stroke="#000", sw=2.4)                 # NO 고정접점
    s.text(xk + 20, 376, "NO", size=10.5, fill="#333", halo=False)
    # 코일
    s.rect(xk - 64, 430, 28, 50, fill="#fff", stroke="#000", sw=1.8)
    s.line(xk - 64, 480, xk - 36, 430, stroke="#000", sw=1)
    s.text(xk - 50, 498, f"K{n}", size=14, anchor="middle", weight="bold", halo=False)
    s.text(xk - 50, 514, f"←IN{n}", size=11, anchor="middle", fill=CP[i], weight="bold", halo=False)
    s.line(xk - 36, 440, xk + 13, 321, stroke="#555", sw=1.3, dash="4 3")   # 기계적 연동
    # NO → 펌프(+)
    sym_open(xk, RY1, 3.5)
    s.text(xk + 6, RY1 - 8, f"NO{n}", size=11, fill="#333", halo=False)
    s.wire([(xk, 362), (xk, RY1)], color=CM, sw=2.2, wid=f"noint{n}", halo=0)
    s.wire([(xk, RY1), (xk, 784)], color=CM, sw=2.6, wid=f"m{n}+")
    s.text(xk + 6, 716, f"M{n}+", size=11.5, fill=CM, weight="bold")
    s.dot(xk, 730)
    # 모터
    s.circle(xk, 810, 26, fill="#fff", stroke="#000", sw=2.2)
    s.text(xk, 817, f"M{n}", size=17, anchor="middle", weight="bold", halo=False)
    s.text(xk - 18, 786, "+", size=14, fill=C5, weight="bold", anchor="middle")
    s.text(xk - 18, 848, "−", size=16, fill=CG, weight="bold", anchor="middle")
    s.wire([(xk, 836), (xk, YG)], color=CG, sw=2.6, wid=f"m{n}-")
    s.dot(xk, 890)
    if xk != X_END:
        s.dot(xk, YG)
    s.lines_text(xk + 8, 934, [(f"펌프{n}", {"weight": "bold"}), "(P09)"], size=12)
    # 플라이백 다이오드 (띠=캐소드 → 펌프+ 쪽)
    xd = xk + 44
    s.wire([(xk, 730), (xd, 730), (xd, 788)], color=CM, sw=2, wid=f"d{n}k")
    s.line(xd - 11, 790, xd + 11, 790, stroke="#000", sw=3)               # 캐소드 띠
    s.polygon([(xd, 790), (xd - 11, 818), (xd + 11, 818)], fill="#000")
    s.wire([(xd, 818), (xd, 890), (xk, 890)], color=CG, sw=2, wid=f"d{n}a")
    s.lines_text(xd + 10, 800, [(f"D{n}", {"weight": "bold"}), "1N4007"], size=11.5)

s.text(1150, 730, "④ 펌프 + 플라이백 다이오드", size=15, weight="bold", fill="#555", anchor="end")
s.lines_text(1150, 752, ["띠(캐소드) = 펌프(+) 쪽", "펌프 빨간선=+, 검은선=−", "위치: 뚜껑 위 이음부 또는", "연장선 박스 쪽 끝 (전기적으로 동일)", "그림 접점은 OFF 상태"],
             size=12, anchor="end", fill="#444")

# ================================================================ ⑤ 선택 부품
frame(315, 470, 270, 480, "⑤ 앞판 부품", dash="10 6")
# 상태 LED: GPIO2 → R1 → LED → GND
YL = 520
s.wire([(EX0, YL), (578, YL)], color=C_LED, sw=2.2, wid="led1")
zig = [(578, YL)]
for k in range(6):
    zig.append((573 - k * 10, YL - 7 if k % 2 == 0 else YL + 7))
zig.append((515, YL))
s.path("M" + " L".join(f"{x},{y}" for x, y in zig), stroke="#000", sw=2)
s.text(546, YL - 14, "R1 220Ω", size=12, anchor="middle", weight="bold")
s.wire([(515, YL), (482, YL)], color=C_LED, sw=2.2, wid="led2")
s.polygon([(482, YL - 11), (482, YL + 11), (458, YL)], fill="#fff", stroke="#000", sw=2)
s.line(456, YL - 12, 456, YL + 12, stroke="#000", sw=2.6)
for dx in (0, 10):
    s.line(470 + dx, YL - 14, 478 + dx, YL - 26, stroke="#000", sw=1.4)
    s.polygon([(478 + dx, YL - 26), (472 + dx, YL - 22), (477 + dx, YL - 19)], fill="#000")
s.wire([(456, YL), (345, YL), (345, YG)], color=CG, sw=2.2, wid="led3")
s.dot(345, YG)
s.lines_text(470, YL + 30, [("LED1 상태 LED (P05) · 필수", {"weight": "bold"}), "보드에 GPIO2 LED 없음 → 외부 LED"],
             size=11.5, anchor="middle")
# 버튼 SW2: GPIO4 → 버튼 → GND
YB = 625
s.wire([(EX0, 610), (560, 610), (560, YB), (548, YB)], color=C_BTN, sw=2.2, dash=OPT, wid="btn1")
sym_open(544, YB)
sym_open(494, YB)
s.line(540, YB - 14, 498, YB - 14, stroke="#000", sw=2.4)
s.line(519, YB - 14, 519, YB - 26, stroke="#000", sw=2)
s.line(510, YB - 26, 528, YB - 26, stroke="#000", sw=2)
s.wire([(490, YB), (440, YB), (440, YG)], color=CG, sw=2.2, dash=OPT, wid="btn2")
s.dot(440, YG)
s.lines_text(519, YB + 26, [("SW2 시작/정지 버튼", {"weight": "bold"}), "(P03 · 눌림=LOW)"], size=11.5, anchor="middle")
# 부저 BZ1: GPIO23 → I/O, VCC ← 3V3, GND
BZY = 760
s.wire([(EX0, 700), (580, 700), (580, BZY + 30), (560, BZY + 30)], color=C_BZ, sw=2.2, dash=OPT, wid="bz1")
s.rect(462, BZY, 98, 100, fill="#fff", stroke="#000", sw=1.8, rx=6, dash=OPT)
s.lines_text(511, BZY + 44, [("BZ1", {"weight": "bold", "size": 14}), "능동 부저", "(P04)"], size=11.5, anchor="middle", halo=False)
s.text(554, BZY + 26, "I/O", size=10.5, anchor="end", fill="#333", halo=False)
s.text(554, BZY + 94, "HIGH=울림", size=10, anchor="end", fill="#b00020", halo=False)
s.wire([(484, BZY), (484, BZY - 38)], color=C33, sw=2.2, dash=OPT, wid="bzv")
s.text(489, BZY + 14, "VCC", size=10.5, fill="#333", halo=False)
s.polygon([(472, BZY - 38), (496, BZY - 38), (496, BZY - 52), (484, BZY - 60), (472, BZY - 52)], fill="#fff3e0", stroke=C33, sw=1.6)
s.text(484, BZY - 64, "3V3", size=12, anchor="middle", weight="bold", fill=C33)
s.wire([(530, BZY + 100), (530, YG)], color=CG, sw=2.2, dash=OPT, wid="bzg")
s.text(536, BZY + 114, "GND", size=10.5, fill="#333")
s.dot(530, YG)

# ================================================================ 범례 · 메모 · 표제란
LY = 1012
s.rect(18, LY, 640, 174, fill="#fafafa", stroke="#bbb", sw=1.2, rx=8, layer="bg")
s.text(32, LY + 24, "범례", size=15, weight="bold", halo=False)
s.line(36, LY + 48, 96, LY + 48, stroke="#000", sw=2.6)
s.text(104, LY + 53, "필수 배선", size=12.5, halo=False)
s.line(196, LY + 48, 256, LY + 48, stroke="#000", sw=2.2, dash=OPT)
s.text(264, LY + 53, "선택 부품 (달면 그대로 연결)", size=12.5, halo=False)
s.line(470, LY + 48, 520, LY + 48, stroke="#000", sw=2.4)
s.line(495, LY + 30, 495, LY + 66, stroke="#000", sw=2.4)
s.dot(495, LY + 48)
s.text(528, LY + 53, "점 = 연결됨", size=12.5, halo=False)
s.line(36, LY + 88, 86, LY + 88, stroke="#000", sw=2.4)
s.line(61, LY + 70, 61, LY + 106, stroke="#000", sw=2.4)
s.text(94, LY + 93, "점 없는 교차 = 연결 안 됨", size=12.5, halo=False)
sym_open(290, LY + 88)
s.text(302, LY + 93, "부품/모듈 단자", size=12.5, halo=False)
legend_cols = [(C5, "+5V", 36), (CG, "GND", 106), (C33, "3V3", 176), (CP[0], "P1", 246), (CP[1], "P2", 306),
               (CP[2], "P3", 366), (CP[3], "P4", 426), (CM, "M1+~M4+ 펌프(+)", 486)]
for col, name, xx in legend_cols:
    s.line(xx, LY + 128, xx + 26, LY + 128, stroke=col, sw=4)
    s.text(xx + 31, LY + 133, name, size=12.5, weight="bold", fill=col, halo=False)
s.lines_text(36, LY + 154, ["P1~P4 = 펌프1~4 제어 신호 (GPIO26·27·32·33 → IN1~4).  J2 = ESP32 왼쪽 핀줄, J3 = 오른쪽 핀줄",
                            "(안테나를 위로 두고 위에서부터 1번).  그림의 릴레이 접점은 꺼진(OFF) 상태입니다."],
             size=11.5, fill="#444", halo=False)

s.rect(672, LY, 612, 174, fill="#fff8f6", stroke="#e0a89a", sw=1.2, rx=8, layer="bg")
s.text(686, LY + 24, "꼭 지킬 점", size=15, weight="bold", fill="#b00020", halo=False)
s.lines_text(686, LY + 48, [
    "1) 릴레이는 LOW = ON (Active-LOW). 펌웨어는 gpio_set_level로 HIGH를 먼저 쓰고 OUTPUT.",
    "2) A안(기본): JD-VCC 점퍼 제거, VCC ← 3V3, JD-VCC ← +5V.  3.3V로 안 켜지면 B안 —",
    "    전원(USB·어댑터) 뺀 뒤 ⑪ 먼저 뽑기 → ⑨(+5V)를 VCC 핀으로 → 캡(JD-VCC엔 캡만). VCC–3V3 금지!",
    "3) D1~D4 1N4007: 띠(캐소드) = 펌프(+).  4) C1: 긴 다리(+) → +5V, 띠(−) → GND.",
    "5) USB 업로드 시 ESP32 5V 선(⑧)을 분리하고 뽑은 끝은 테이프로 감쌈 (이중 전원 금지).",
    "6) 전원 넣기 전 멀티미터 도통 모드로 +5V–GND 단락(삐 소리) 없는지 확인.",
], size=12.3, halo=False)

# 표제란
TX = 1298
s.rect(TX, LY, 484, 174, fill="#fff", stroke="#222", sw=1.6, layer="bg")
rows = [("도면명", "AI 스마트 바텐더 회로도 v3 (정식 회로도)"), ("팀 / 과목", "팀 홍당무 · 캡스톤디자인Ⅱ (안양대 정보전기전자공학과)"),
        ("작성일", "2026-11-06"), ("기준", "SPEC v2.1 §1 핀맵 (smart-bartender/docs/SPEC.md)"), ("도면 번호", "SB-SCH-03 · 시트 1/2 (2/2 = 배선도)")]
for i, (k, v) in enumerate(rows):
    y = LY + i * 28
    if i:
        s.line(TX, y, TX + 484, y, stroke="#222", sw=1, layer="bg")
    s.text(TX + 10, y + 19, k, size=12.5, weight="bold", halo=False)
    s.text(TX + 96, y + 19, v, size=12.5, halo=False)
s.line(TX + 88, LY, TX + 88, LY + 140, stroke="#222", sw=1, layer="bg")
s.line(TX, LY + 140, TX + 484, LY + 140, stroke="#222", sw=1, layer="bg")
s.text(TX + 242, LY + 163, "AI 스마트 바텐더 회로도 v3 · 팀 홍당무 · 2026-11-06 · SPEC v2.1 기준",
       size=12.5, weight="bold", anchor="middle", halo=False)

out = os.path.join(os.path.dirname(__file__), "..", "schematic.svg")
with open(out, "w", encoding="utf-8") as f:
    f.write(s.render())
cr = find_crossings(s.segments)
print("written", os.path.abspath(out))
print("unmarked crossings (signal wires):", len(cr))
for c in cr:
    print("  ", c)
