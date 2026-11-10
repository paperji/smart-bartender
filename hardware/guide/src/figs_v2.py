# -*- coding: utf-8 -*-
"""제작가이드(납땜/무납땜) 새 그림을 만든다 — figures/ 에 SVG 저장.

사용: python figs_v2.py
- f08s_lid_970.svg / f08n_lid_970.svg : 970ml 용기 뚜껑 가공 (납땜 / 무납땜)
- f09n_lever.svg                      : 레버 커넥터로 펌프 리드·다이오드 잇기 (무납땜)
- f10n_power.svg                      : 전원부 결선도 (무납땜)
- f14s_front.svg / f14n_front.svg     : 앞판 F 안쪽 배선 (납땜 / 무납땜)
기존 그림(f01~f17)과 같은 색·글꼴을 씁니다.
"""
import html
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(os.path.dirname(HERE), 'figures')
FONT = "'Malgun Gothic','맑은 고딕','Noto Sans KR','NanumGothic',sans-serif"
INK, SUB, GREY = '#1f2933', '#52606d', '#6b7785'
ORANGE, BLUE, RED, GREEN, DRED = '#e8590c', '#2f80c9', '#d64545', '#2f9e44', '#c92a2a'
BLACKW, YEL, YEL_D, COPPER = '#222222', '#f2b705', '#8a6d00', '#b87333'
PANEL, LIGHT, WATER = '#eef1f4', '#f8fafc', '#cfe8fb'
CONN, CONN_S, LEVER = '#e3edf7', '#5b7da3', '#f08c00'


class SVG:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.o = []

    def add(self, s):
        self.o.append(s)

    def text(self, x, y, s, size=12, anchor='start', bold=False, color=INK, halo=True):
        h = ' stroke="#ffffff" stroke-width="4" paint-order="stroke" stroke-linejoin="round"' if halo else ''
        self.add(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" text-anchor="{anchor}" '
                 f'font-weight="{"bold" if bold else "normal"}" fill="{color}"{h}>{html.escape(s)}</text>')

    def lines(self, x, y, rows, size=12, gap=None, **kw):
        gap = gap or size + 6
        for k, r in enumerate(rows):
            self.text(x, y + k * gap, r, size=size, **kw)

    def line(self, x1, y1, x2, y2, color=INK, w=1.5, dash=None, marker=None, cap='round'):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        m = f' marker-end="url(#{marker})"' if marker else ''
        self.add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" '
                 f'stroke-width="{w}" stroke-linecap="{cap}"{d}{m}/>')

    def pl(self, pts, color=INK, w=1.5, dash=None, marker=None, fill='none'):
        p = ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts)
        d = f' stroke-dasharray="{dash}"' if dash else ''
        m = f' marker-end="url(#{marker})"' if marker else ''
        self.add(f'<polyline points="{p}" fill="{fill}" stroke="{color}" stroke-width="{w}" '
                 f'stroke-linejoin="round" stroke-linecap="round"{d}{m}/>')

    def wire(self, pts, kind, w=3.2, marker=None):
        """kind: red / black / yellow / grey — 노랑은 진한 테두리를 깔아 흰 바탕에서도 보이게."""
        if kind == 'yellow':
            self.pl(pts, YEL_D, w + 1.6)
            self.pl(pts, YEL, w, marker=marker)
        else:
            c = {'red': RED, 'black': BLACKW, 'grey': '#8a96a3', 'blue': BLUE}[kind]
            self.pl(pts, c, w, marker=marker)

    def rect(self, x, y, w, h, fill='none', stroke=INK, sw=1.5, rx=0, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        self.add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" '
                 f'stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def circle(self, cx, cy, r, fill='none', stroke=INK, sw=1.5, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        self.add(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def path(self, d, fill='none', stroke=INK, sw=1.5, marker=None, dash=None):
        m = f' marker-end="url(#{marker})"' if marker else ''
        ds = f' stroke-dasharray="{dash}"' if dash else ''
        self.add(f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round"{m}{ds}/>')

    def leader(self, x1, y1, x2, y2, label, size=12, anchor='start', **kw):
        self.line(x1, y1, x2, y2, SUB, 1)
        self.circle(x1, y1, 2.4, fill=SUB, stroke='none')
        dx = 4 if anchor == 'start' else -4
        self.text(x2 + dx, y2 + size * 0.36, label, size=size, anchor=anchor, **kw)

    def badge(self, x, y, s, color=INK, size=13):
        """동그라미 번호(①…)를 흰 원 위에."""
        self.circle(x, y, size * 0.78, fill='#ffffff', stroke=color, sw=1.3)
        self.text(x, y + size * 0.36, s, size=size, anchor='middle', bold=True, color=color, halo=False)

    def note_box(self, x, y, w, h, title, rows, size=12, fill=LIGHT, stroke='#cbd2d9', title_color=INK):
        self.rect(x, y, w, h, fill=fill, stroke=stroke, sw=1.2, rx=8)
        self.text(x + 12, y + 22, title, size=size + 1, bold=True, color=title_color, halo=False)
        self.lines(x + 12, y + 44, rows, size=size, halo=False, gap=size + 7)

    def save(self, name):
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}" height="{self.h}" '
                f'font-family="{FONT}">\n<defs>\n')
        mk = ''
        for mid, col in (('arrK', INK), ('arrS', SUB), ('arrR', RED), ('arrB', BLUE), ('arrO', ORANGE),
                         ('arrY', YEL_D), ('arrG', GREEN), ('arrW', DRED)):
            mk += (f'<marker id="{mid}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" '
                   f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{col}"/></marker>\n')
        body = '\n'.join(self.o)
        svg = head + mk + '</defs>\n' + f'<rect x="0" y="0" width="{self.w}" height="{self.h}" fill="#ffffff"/>\n' + body + '\n</svg>\n'
        with open(os.path.join(FIG, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(svg)
        print('saved', name, len(svg))


def lever_conn(s, x, y, w, h, label, n_holes=3, lever_up=False, label_pos='above'):
    """레버 커넥터(투명 몸통 + 주황 레버) 한 개."""
    s.rect(x, y, w, h, fill=CONN, stroke=CONN_S, sw=1.6, rx=6)
    lw = w / n_holes
    for k in range(n_holes):
        lx = x + k * lw + lw * 0.2
        if lever_up:
            s.rect(lx + lw * 0.2, y - h * 0.75, lw * 0.2, h * 0.75, fill=LEVER, stroke='#b35c00', sw=1, rx=2)
        else:
            s.rect(lx, y - 6, lw * 0.6, 6, fill=LEVER, stroke='#b35c00', sw=1, rx=2)
    if label:
        if label_pos == 'above':
            s.text(x + w / 2, y - 12, label, size=12, anchor='middle', bold=True)
        else:
            s.text(x + w / 2, y + h + 16, label, size=12, anchor='middle', bold=True)


# ====================================================================== 1. 뚜껑 (970ml)
def fig_lid(var):
    s = SVG(1140, 640)
    vname = '납땜 기준' if var == 'S' else '무납땜 기준'
    s.text(24, 34, f'용기 뚜껑 가공 상세 — 다이소 직사각 저장 용기 970ml ({vname}, 용기 1~4 모두 같음)', 20, bold=True, halo=False)
    s.text(24, 56, '뚜껑 + 펌프 + 튜브 + 전선이 한 덩어리("펌프 모듈")가 됩니다. 돌림 뚜껑이라 뚜껑을 손으로 잡고 용기 몸통을 돌려 여닫습니다.',
           13, color=SUB, halo=False)

    # (가) 위에서 본 뚜껑 — 3px/mm, 뚜껑 약 Ø70
    s.text(40, 92, '(가) 뚜껑 위에서 본 모습 (예: 약 Ø70 — 실제 뚜껑에 맞춰 구멍 간격만 지킴)', 14, bold=True, halo=False)
    cx, cy, R = 190, 290, 105
    s.circle(cx, cy, R, fill=PANEL, stroke=INK, sw=1.8)
    import math
    for k in range(0, 360, 6):
        a = math.radians(k)
        s.line(cx + (R - 7) * math.cos(a), cy + (R - 7) * math.sin(a), cx + R * math.cos(a), cy + R * math.sin(a), '#8a96a3', 1)
    s.circle(cx, cy, 86, stroke='#8a96a3', sw=1, dash='5 3')
    tx, wx = cx - 30, cx + 30
    s.circle(tx, cy, 10.5, fill='#ffffff', stroke=INK, sw=1.6)
    s.circle(tx, cy, 7.5, fill='#5aa9e6', stroke='none')
    s.circle(wx, cy, 7.5, fill='#ffffff', stroke=INK, sw=1.6)
    s.circle(wx - 2, cy, 1.8, fill=RED, stroke='none')
    s.circle(wx + 2, cy, 1.8, fill=BLACKW, stroke='none')
    ax, ay = cx - 53, cy - 53
    s.circle(ax, ay, 4.5, fill='#ffffff', stroke=INK, sw=1.4)
    # 치수 20
    s.line(tx, cy - 26, wx, cy - 26, GREY, 0.9)
    s.line(tx, cy - 14, tx, cy - 32, GREY, 0.8)
    s.line(wx, cy - 14, wx, cy - 32, GREY, 0.8)
    s.text(cx, cy - 31, '20', 12, anchor='middle', color=GREY)
    # 치수 10 (가장자리→공기 구멍)
    s.line(cx - 74, cy - 74, ax - 3, ay - 3, GREY, 0.9)
    s.text(cx - 86, cy - 76, '10', 12, anchor='middle', color=GREY)
    s.rect(cx - 12, cy + 50, 24, 20, fill='#fff3bf', stroke='#c9a227', sw=1, rx=3)
    s.text(cx, cy + 65, '1', 13, anchor='middle', bold=True, halo=False)
    s.leader(tx - 8, cy + 6, 330, 350, 'Ø7 튜브 구멍 (펌프 출수구 쪽)')
    s.leader(wx + 6, cy + 4, 330, 300, 'Ø5 전선 구멍 (펌프 리드 빨강·검정)')
    s.leader(ax + 3, ay - 3, 330, 170, 'Ø3 공기 구멍 (진공 방지 — 막지 않음)')
    s.leader(cx + 60, cy - 60, 330, 215, '점선 = 평평한 부분 (구멍은 이 안에)')
    s.leader(cx + 12, cy + 62, 330, 395, '← 번호 스티커 (몸통과 같은 번호)')

    # (다) 돌림 뚜껑
    s.note_box(40, 440, 520, 180, '돌림 뚜껑 여닫기',
               ['• 뚜껑은 손으로 잡고 가만히, 용기 몸통을 돌립니다.',
                '  (뚜껑을 돌리면 위의 전선·튜브가 꼬이고 이음이 당겨짐)',
                '• 몸통(PET)은 60℃까지만 — 뜨거운 물·솔·연마분 금지',
                '• 재료를 채울 때는 몸통을 돌려 열고 펌프 모듈째 들어 올림',
                '• 좁은 80mm 쪽이 좌우가 되게 본체에 넣음'], size=13)

    # (나) 옆에서 자른 모습 — 약 1.7px/mm
    s.text(600, 92, '(나) 옆에서 자른 모습 (비례 예시)', 14, bold=True, halo=False)
    bx0, bx1, top, bot = 630, 766, 302, 552
    s.rect(bx0, top + 12, bx1 - bx0, bot - top - 12, fill='#ffffff', stroke=INK, sw=1.8, rx=12)
    lvl = 420
    s.rect(bx0 + 1, lvl, bx1 - bx0 - 2, bot - lvl - 1, fill=WATER, stroke='none', rx=10)
    s.line(bx0, lvl, bx1, lvl, BLUE, 1.2, dash='6 3')
    s.text(bx0 + 6, lvl - 6, '액면', 12, color=BLUE)
    s.line(bx0, bot - 52, bx1, bot - 52, GREY, 1, dash='3 3')
    s.text(bx1 - 6, bot - 58, '최소 30mm', 11, anchor='end', color=GREY)
    s.rect(640, top, 116, 14, fill='#ffffff', stroke=INK, sw=1.6)          # 목
    s.rect(634, top - 20, 128, 22, fill=PANEL, stroke=INK, sw=1.8, rx=3)  # 뚜껑
    s.text(626, top - 26, '돌림 뚜껑(PP)', 12, anchor='end', color=SUB)
    tube_x, w_r, w_k, air_x = 668, 707, 713, 750
    for xh in (tube_x, (w_r + w_k) / 2, air_x):
        s.rect(xh - 4, top - 21, 8, 24, fill='#ffffff', stroke='none')
    # 펌프 (43×23mm)
    s.rect(652, bot - 44, 74, 38, fill='#9aa5b1', stroke=INK, sw=1.4, rx=8)
    s.text(689, bot - 20, '펌프', 12, anchor='middle', bold=True, color='#ffffff', halo=False)
    s.rect(662, bot - 56, 12, 14, fill='#9aa5b1', stroke=INK, sw=1.2)     # 출수구
    # 튜브 → 체크밸브
    s.pl([(tube_x, bot - 56), (tube_x, 168), (684, 150), (800, 150)], '#5aa9e6', 7)
    s.text(806, 154, '→ 체크밸브로 (내경5 튜브)', 12, color=BLUE)
    # 펌프 리드 → Ø5
    s.wire([(726, bot - 30), (740, bot - 30), (740, 380), (w_r, 330), (w_r, top - 26)], 'red', 2.4)
    s.wire([(726, bot - 18), (748, bot - 18), (748, 380), (w_k, 332), (w_k, top - 26)], 'black', 2.4)
    s.leader(w_k + 3, top - 8, 800, 334, 'Ø5 구멍: 다 끼운 뒤 글루건으로 막기', size=12)
    s.leader(air_x, top - 12, 800, 300, '공기 구멍 Ø3 (막지 않음)', size=12)
    if var == 'S':
        s.wire([(w_r, top - 26), (w_r, 186), (1000, 186)], 'red', 3.2)
        s.wire([(w_k, top - 26), (w_k, 194), (1000, 194)], 'black', 3.2)
        s.rect(w_r - 6, 236, 12, 26, fill='#f1f3f5', stroke=DRED, sw=1.2, rx=3)
        s.rect(w_k - 6, 210, 12, 26, fill='#f1f3f5', stroke=DRED, sw=1.2, rx=3)
        s.text(806, 178, '→ 전장 박스로 (AWG20 연장선 약 70cm)', 12)
        s.text(806, 214, '다이오드 하네스는 박스 쪽 끝 (STEP3 절차 4)', 12, color=SUB)
        s.leader(w_k + 8, 236, 800, 256, '솔더 슬리브 이음 2개 (2cm 엇갈림, 뚜껑 위)', size=12)
    else:
        s.wire([(w_r, top - 26), (w_r, 244)], 'red', 2.4)
        s.wire([(w_k, top - 26), (w_k, 244)], 'black', 2.4)
        s.rect(684, 198, 62, 46, fill='#3b3b3b', stroke=INK, sw=1.2, rx=8)
        s.text(715, 216, 'PCT-413 ×2', 11, anchor='middle', color='#ffffff', halo=False, bold=True)
        s.text(715, 233, '+ 다이오드', 11, anchor='middle', color='#ffffff', halo=False)
        s.rect(752, 206, 9, 24, fill='#ffffff', stroke=INK, sw=1, rx=2)  # 케이블타이
        s.wire([(746, 214), (1000, 214)], 'red', 3.2)
        s.wire([(746, 222), (1000, 222)], 'black', 3.2)
        s.line(676, 246, 676, top - 22, GREY, 0.8)
        s.text(672, 266, '1~2cm', 11, anchor='end', color=GREY)
        s.text(806, 206, '→ 전장 박스로 (AWG20 연장선 약 70cm)', 12)
        s.leader(686, 200, 800, 116, '레버 커넥터 덩어리: 절연테이프로 감고', size=12)
        s.text(804, 134, '케이블타이로 연장선에 묶음 (그림 9)', 12)
        s.text(804, 250, '⚠ 방수 아님 — 뚜껑 안쪽에 두지 않고,', 12, color=DRED, bold=True)
        s.text(804, 268, '   위로 액체를 붓지 않음', 12, color=DRED, bold=True)
    # 치수
    s.line(596, top - 20, 596, bot, GREY, 0.9)
    s.line(590, top - 20, 602, top - 20, GREY, 0.9)
    s.line(590, bot, 602, bot, GREY, 0.9)
    s.text(590, 440, '약 150', 12, anchor='end', color=GREY)
    s.text(590, 456, '(뚜껑 포함)', 11, anchor='end', color=GREY)
    s.line(bx0, bot + 14, bx1, bot + 14, GREY, 0.9)
    s.text((bx0 + bx1) / 2, bot + 30, '80 (좌우)', 12, anchor='middle', color=GREY)

    rows = ['1) 펌프를 바닥에 눕히고 출수구 위치를 뚜껑에 표시',
            '2) Ø7 · Ø5(20mm 옆) · Ø3(가장자리 10mm 안) 연필 표시',
            '3) Ø7·Ø5 송곳 → 스텝드릴, Ø3은 Ø3 드릴 날 (천천히)',
            '4) 거스러미 정리, 튜브·전선을 넣어 맞춤 확인',
            '5) 펌프 리드를 안쪽 → 바깥으로 Ø5 통과 (위로 3cm 이상)',
            '6) ' + ('솔더 슬리브로 이음 (STEP3 절차 5, 학교)' if var == 'S' else '레버 커넥터로 이음 (STEP3 절차 4~9, 그림 9)'),
            '7) Ø5 둘레 글루건 — Ø3 공기 구멍은 막지 않음']
    s.note_box(820, 400, 300, 196, '가공 순서', rows, size=11)
    s.save(f'f08{var.lower()}_lid_970.svg')


# ====================================================================== 2. 레버 커넥터 (무납땜 STEP3)
def fig_lever():
    s = SVG(1140, 660)
    s.text(24, 34, '레버 커넥터로 펌프 리드 · 다이오드 잇기 (무납땜, STEP3)', 20, bold=True, halo=False)
    s.text(24, 56, '펌프마다 3구 레버 커넥터 PCT-413 2개("+"와 "−")를 씁니다. 한 구멍에 한 가닥, 피복은 9~10mm. 커넥터 안의 3구멍은 모두 이어져 있습니다.',
           13, color=SUB, halo=False)

    # A. 쓰는 법
    s.text(40, 94, 'A. 레버 커넥터 쓰는 법', 15, bold=True, halo=False)
    steps = [('① 레버를 끝까지 올림', True, False), ('② 9~10mm 벗긴 선을 끝까지', True, True), ('③ 레버를 내리고 살짝 당겨 봄', False, True)]
    for k, (lab, up, wire_in) in enumerate(steps):
        y = 150 + k * 110
        lever_conn(s, 140, y, 120, 46, '', n_holes=3, lever_up=up)
        s.text(40, y - 26, lab, 13, bold=True)
        if wire_in:
            s.wire([(30, y + 23), (120, y + 23)], 'red', 6, )
            s.line(120, y + 23, 152, y + 23, COPPER, 4)
        else:
            s.line(152, y + 23, 152, y + 23, COPPER, 4)
    s.text(40, 470, '• 투명 몸통으로 심선 끝이 안쪽 벽에 닿았는지 봄', 12)
    s.text(40, 490, '• 피복이 안에 물리면(짧게 벗김) 접촉 불량,', 12)
    s.text(40, 508, '  심선이 밖에 보이면(길게 벗김) 단락 위험', 12)
    s.text(40, 528, '• 헐거우면 피복을 두 배(약 20mm) 벗겨', 12)
    s.text(40, 546, '  반으로 접어 꼬아 넣음(들어가는 길이는 같음)', 12)
    s.text(40, 566, '• 레버를 다시 올리면 빼고 고쳐 꽂을 수 있음', 12)

    # B. 결선
    s.text(400, 94, 'B. 펌프 하나의 결선 (뚜껑 위)', 15, bold=True, halo=False)
    px, py = 540, 150      # "+" 커넥터
    mx, my = 540, 330      # "−" 커넥터
    lever_conn(s, px, py, 150, 56, '"+" 커넥터 (PCT-413)', n_holes=3)
    lever_conn(s, mx, my, 150, 56, '"−" 커넥터 (PCT-413)', n_holes=3, label_pos='below')
    # 다이오드 (띠가 + 쪽)
    dx = px + 75
    s.line(dx, py + 56, dx, 232, '#9aa5b1', 2.4)
    s.rect(dx - 9, 232, 18, 62, fill='#2b2b2b', stroke=INK, sw=1, rx=4)
    s.rect(dx - 9, 234, 18, 10, fill='#c8ced6', stroke='none')
    s.line(dx, 294, dx, my, '#9aa5b1', 2.4)
    s.leader(dx + 10, 240, 760, 236, '다이오드 1N4007 — 띠(캐소드) 쪽 다리 → "+" 커넥터', size=12)
    s.leader(dx + 10, 290, 760, 262, '(띠 옆 몸통에 빨간 점을 찍어 두면 헷갈리지 않음)', size=12, color=SUB)
    # 연장선 (오른쪽)
    s.wire([(px + 150, py + 28), (1000, py + 28)], 'red', 4)
    s.wire([(mx + 150, my + 28), (1000, my + 28)], 'black', 4)
    s.text(870, py + 18, '연장선 빨강 → 박스: 릴레이 K NO', 12, bold=True, color=RED)
    s.text(870, my + 18, '연장선 검정 → 박스: TB2', 12, bold=True)
    s.text(1000, my + 52, 'AWG20 2심 약 70cm', 12, anchor='end', color=SUB)
    # 펌프 리드 (왼쪽 아래 → 뚜껑 → 커넥터)
    lid_y = 440
    s.rect(400, lid_y, 330, 14, fill=PANEL, stroke=INK, sw=1.4, rx=3)
    s.text(410, lid_y + 32, '뚜껑 윗면 (Ø5 구멍)', 12, color=SUB)
    s.rect(455, lid_y, 10, 14, fill='#ffffff', stroke='none')
    s.wire([(458, lid_y + 46), (458, lid_y - 10), (458, py + 28), (px, py + 28)], 'red', 2.4)
    s.wire([(462, lid_y + 46), (462, lid_y - 10), (500, my + 28), (mx, my + 28)], 'black', 2.4)
    s.rect(430, lid_y + 46, 70, 30, fill='#9aa5b1', stroke=INK, sw=1.2, rx=6)
    s.text(465, lid_y + 66, '펌프', 12, anchor='middle', bold=True, color='#ffffff', halo=False)
    s.text(470, py + 18, '펌프 빨강', 12, color=RED, bold=True)
    s.text(470, my + 46 + 22, '펌프 검정', 12, bold=True)
    # 덩어리 표시
    s.rect(520, py - 34, 200, my - py + 112, fill='none', stroke=GREEN, sw=1.6, rx=12, dash='6 4')
    s.text(732, my + 74, '절연테이프로 한 덩어리 →', 12, color=GREEN, bold=True)
    s.text(732, my + 92, '연장선에 케이블타이 (뚜껑에서 1~2cm 위)', 12, color=GREEN, bold=True)

    # C. 순서
    s.text(400, 546, 'C. 순서 (펌프 4개 모두)', 15, bold=True, halo=False)
    boxes = [('①', ['연장선 빨강·검정과', '다이오드를 먼저 꽂음']),
             ('②', ['박스 쪽 끝에서 ▶| 확인', '검정→빨강 선: 0.5~0.7', '반대로 대면: OL']),
             ('③', ['펌프 빨강 → "+" 빈 구멍', '펌프 검정 → "−" 빈 구멍']),
             ('④', ['당김 테스트', '→ 절연테이프로 감기', '→ 케이블타이 고정'])]
    for k, (n, rows) in enumerate(boxes):
        x = 400 + k * 182
        s.rect(x, 560, 174, 84, fill=LIGHT, stroke='#cbd2d9', sw=1.2, rx=8)
        s.text(x + 10, 584, n, 15, bold=True, color=ORANGE, halo=False)
        for j, r in enumerate(rows):
            s.text(x + 32, 584 + j * 19, r, 12, halo=False, color=INK if j == 0 else SUB)
    s.text(40, 600, '⚠ 펌프를 꽂은 뒤에는 다이오드 방향을', 12, color=DRED, bold=True)
    s.text(40, 618, '   잴 수 없음 — 꼭 ②를 ③보다 먼저', 12, color=DRED, bold=True)
    s.text(40, 640, '⚠ 레버 커넥터는 방수가 아님', 12, color=DRED, bold=True)
    s.save('f09n_lever.svg')


# ====================================================================== 3. 전원부 (무납땜 STEP4)
def fig_power():
    s = SVG(1140, 640)
    s.text(24, 34, '전원부 결선도 (무납땜, STEP4) — 어댑터 → 스위치 → 퓨즈 → 5V 분배', 20, bold=True, halo=False)
    s.text(24, 56, '동그라미 번호 = 회로도.html ③ 연결표·배선도의 번호. 빨강 = +5V, 검정 = GND. G1·G2·G3 = 2구 레버 커넥터 PCT-412, TB = 8구 PCT-418.',
           13, color=SUB, halo=False)
    # G 쪽 영역
    s.rect(30, 80, 420, 400, fill='#fffdf5', stroke='#c9a227', sw=1.4, rx=10, dash='7 4')
    s.text(44, 102, '뒤판 G 안쪽 (박스 밖) — 상판 C를 열면 손이 닿는 곳', 13, bold=True, color='#8a6d00', halo=False)
    s.rect(46, 120, 18, 340, fill=PANEL, stroke=INK, sw=1.4)
    s.text(55, 478, 'G', 13, anchor='middle', bold=True)
    # SW1
    s.rect(30, 170, 50, 44, fill='#3b3b3b', stroke=INK, sw=1.2, rx=4)
    s.text(55, 198, 'I/O', 12, anchor='middle', bold=True, color='#ffffff', halo=False)
    s.text(90, 150, 'SW1 하네스 로커 스위치 (P73)', 12, bold=True)
    s.text(90, 166, '바깥에서 사각 구멍에 끼움 · 리드 약 10cm', 11, color=SUB)
    # PCT-412 ⓐ ⓑ ⓒ + 인라인 퓨즈홀더
    lever_conn(s, 180, 200, 70, 34, 'G1', n_holes=2)
    lever_conn(s, 180, 290, 70, 34, 'G2 (③ 대신)', n_holes=2)
    lever_conn(s, 385, 290, 60, 34, 'G3', n_holes=2)
    s.wire([(80, 184), (140, 184), (140, 217), (180, 217)], 'red', 2.6)
    s.text(92, 232, 'SW-a', 11, color=RED)
    s.wire([(80, 202), (120, 202), (120, 307), (180, 307)], 'red', 2.6)
    s.text(124, 330, 'SW-b', 11, color=RED)
    s.wire([(250, 307), (270, 307)], 'red', 2.6)
    s.rect(270, 294, 100, 26, fill=RED, stroke=DRED, sw=1.4, rx=12)
    s.text(320, 312, 'F1 3A', 12, anchor='middle', bold=True, color='#ffffff', halo=False)
    s.wire([(370, 307), (385, 307)], 'red', 2.6)
    s.text(258, 290, 'F-a', 10, color=RED)
    s.text(372, 290, 'F-b', 10, color=RED)
    s.text(320, 340, '인라인 퓨즈홀더 FH-201 (P74)', 11, anchor='middle', color=SUB)
    s.text(320, 356, '돌려 열어 퓨즈 교체 — G 구멍 없음', 11, anchor='middle', color=SUB)
    s.text(90, 386, 'G1·G2·G3와 퓨즈홀더는 G 안쪽 접착 마운트(P28)에', 11, color=SUB)
    s.text(90, 402, '케이블타이로 함께 묶음 (레버가 위를 보게)', 11, color=SUB)
    # 어댑터 ①
    s.text(36, 520, '어댑터 5V 4A (P11) — 벽 콘센트', 12, bold=True)
    s.wire([(20, 500), (20, 430), (46, 430)], 'grey', 5)
    s.rect(44, 420, 22, 20, fill='#dee2e6', stroke=INK, sw=1, rx=4)
    s.text(70, 452, 'Ø12 그로밋 05', 11, color=SUB)
    s.wire([(66, 430), (440, 430), (440, 350), (500, 350), (500, 300), (520, 300)], 'grey', 5)
    s.badge(300, 430, '①')

    # 박스
    s.rect(470, 80, 650, 450, fill='none', stroke=BLUE, sw=1.4, rx=10, dash='7 4')
    s.text(484, 102, '전장 박스 P35 안', 13, bold=True, color=BLUE, halo=False)
    s.rect(470, 180, 10, 160, fill='#ffffff', stroke='none')
    s.text(486, 196, '뒤 벽 Ø16 구멍 (①·②·④ 통과)', 11, color=SUB)
    # J1
    s.rect(520, 270, 90, 64, fill='#dee2e6', stroke=INK, sw=1.4, rx=4)
    s.text(565, 292, 'J1 DC 단자', 12, anchor='middle', bold=True, halo=False)
    s.text(538, 322, '+', 15, anchor='middle', bold=True, color=RED, halo=False)
    s.text(592, 322, '−', 15, anchor='middle', bold=True, halo=False)
    # ② : ⓐ → J1 +
    s.wire([(250, 217), (500, 217), (500, 250), (538, 250), (538, 308)], 'red', 3.2)
    s.badge(380, 217, '②', RED)
    # ④ : ⓒ → TB1-8
    s.wire([(445, 307), (458, 307), (458, 140), (997, 140), (997, 168)], 'red', 3.2)
    s.badge(458, 230, '④', RED)
    # TB1 / TB2
    def tb(x, y, title, nums, color):
        s.rect(x, y, 360, 40, fill=CONN, stroke=CONN_S, sw=1.6, rx=6)
        for k, n in enumerate(nums):
            cx = x + 22 + k * 45
            s.circle(cx, y + 20, 9, fill='#ffffff', stroke=CONN_S, sw=1.2)
            s.text(cx, y + 25, str(n), 11, anchor='middle', bold=True, halo=False)
        s.text(x, y - 8, title, 12, bold=True, color=color)
    tb(660, 168, 'TB1 — +5V 분배 (PCT-418)', range(1, 9), RED)
    tb(660, 300, 'TB2 — GND 분배 (PCT-418, 번호 반대 방향)', range(8, 0, -1), INK)
    # ⑤ J1− → TB2-1 (오른쪽 끝)
    s.wire([(592, 334), (592, 380), (997, 380), (997, 340)], 'black', 3.2)
    s.badge(800, 380, '⑤')
    # ⑦ J1− → ESP32 GND
    s.wire([(600, 334), (600, 470), (700, 470)], 'black', 2.4, marker='arrK')
    s.badge(640, 470, '⑦')
    s.text(712, 474, 'ESP32 GND (J3-1) · UL1007 검정 — 별형 접지', 12)
    # C1
    s.rect(670, 226, 26, 50, fill='#1c3d6e', stroke=INK, sw=1, rx=6)
    s.line(683, 208, 683, 226, '#9aa5b1', 2)
    s.line(683, 276, 683, 300, '#9aa5b1', 2)
    s.text(704, 244, 'C1 1000µF: 긴 다리(+) → TB1-1, 띠 쪽(−) → TB2-8', 11)
    s.text(704, 260, '다리는 절연테이프로 감고 끝 10mm만', 11, color=SUB)
    s.badge(683, 252, '⑥')
    # 나머지 구멍
    s.text(660, 412, 'TB1: 1 C1+ · 2 K4 COM⑳ · 3 K3⑲ · 4 K2⑱ · 5 K1⑰ · 6 JD-VCC⑨ · 7 ESP32 5V⑧ · 8 ④', 11, color=SUB)
    s.text(660, 430, 'TB2: 1 ⑤ · 2~5 펌프 1~4 검정(㉒㉔㉖㉘) · 8 C1−    TB3(3V3)는 STEP5', 11, color=SUB)
    # 아래 메모
    s.note_box(470, 548, 650, 84, '알아 둘 것',
               ['• STEP9에서 G를 붙일 때: G1·G3에서 ②·④ 쪽 레버만 올려 빼고 → STEP10에서 다시 꽂음',
                '• 퓨즈 교체: 어댑터 뽑기 → 상판 C 열기 → 인라인 홀더를 돌려 열기 (3A만, 원인부터 찾기)'], size=12)
    s.note_box(30, 560, 420, 72, '레버 커넥터 피복 길이',
               ['PCT-412: 9~10mm · PCT-418(TB): 10~11mm · J1 나사 단자: 6~7mm'], size=12)
    s.save('f10n_power.svg')


# ====================================================================== 4. 앞판 F 안쪽 (납땜 / 무납땜)
def fig_front(var):
    s = SVG(1140, 620)
    vname = '납땜 기준' if var == 'S' else '무납땜 기준'
    s.text(24, 34, f'앞판 F 안쪽 배선 ({vname}, STEP9 절차 다 8)', 20, bold=True, halo=False)
    s.text(24, 56, '앞판 F를 안쪽(뒤)에서 본 모습 — 앞에서 볼 때와 좌우가 바뀝니다. 노랑 4가닥은 색이 같으므로 양 끝 번호 테이프로 구분합니다.',
           13, color=SUB, halo=False)
    # 판 (일부만 — 왼쪽이 앞에서 볼 때 오른쪽 끝)
    s.rect(40, 90, 640, 300, fill=PANEL, stroke=INK, sw=1.6, rx=4)
    s.text(48, 110, 'F 앞판 상부 (안쪽 면) — 왼쪽 끝 = 앞에서 볼 때 오른쪽 끝', 12, color=SUB, halo=False)
    s.line(680, 90, 700, 90, GREY, 1, dash='4 3')
    s.line(680, 390, 700, 390, GREY, 1, dash='4 3')
    s.text(690, 410, '… (판은 오른쪽으로 계속)', 11, color=GREY)
    exit_x = 760
    # 버튼 (왼쪽 끝에서 70mm), LED (110mm) — 2px/mm
    bxc, byc = 180, 230
    lxc, lyc = 260, 230
    s.circle(bxc, byc, 32, fill='#c8ced6', stroke=INK, sw=1.6)
    s.circle(bxc, byc, 18, fill='#adb5bd', stroke=INK, sw=1)
    s.text(bxc, byc - 40, '버튼 SW2 (Ø16)', 12, anchor='middle', bold=True)
    t1, t2 = (bxc - 10, byc + 30), (bxc + 10, byc + 30)
    for (x, y), n in ((t1, '1'), (t2, '2')):
        s.rect(x - 3, y, 6, 16, fill='#c0a060', stroke=INK, sw=0.8)
        s.text(x + (-7 if n == '1' else 7), y + 12, n, 11, anchor='end' if n == '1' else 'start', bold=True)
    s.circle(lxc, lyc, 10, fill='#ffb3b3', stroke=DRED, sw=1.4)
    s.text(lxc, lyc - 18, 'LED', 12, anchor='middle', bold=True)
    ln, lp = (lxc - 4, lyc + 10), (lxc + 4, lyc + 10)   # 짧은 다리(−) 왼쪽, 긴 다리(+) 오른쪽
    # 부저 (오른쪽, 핀은 아래: GND · I/O · VCC — 예시 순서)
    s.rect(540, 150, 64, 44, fill='#2b2b2b', stroke=INK, sw=1.2, rx=4)
    s.text(572, 170, '부저', 12, anchor='middle', bold=True, color='#ffffff', halo=False)
    s.text(572, 186, '(선택)', 10, anchor='middle', color='#dee2e6', halo=False)
    pins = {'GND': (552, 194), 'I/O': (572, 194), 'VCC': (592, 194)}
    for k, (x, y) in pins.items():
        s.line(x, y, x, y + 8, '#c0a060', 2)
    s.text(610, 168, '← 핀: GND · I/O · VCC (모듈 인쇄 확인)', 10, color=SUB)
    rows = {}
    if var == 'S':
        # R1: 긴 다리에 납땜, 아래로
        s.line(lp[0], lp[1], lp[0], lp[1] + 22, '#9aa5b1', 2)
        s.rect(lp[0] - 6, lp[1] + 22, 12, 34, fill='#e9c46a', stroke=INK, sw=1, rx=4)
        s.text(306, 304, '← R1 220Ω', 11)
        r1_end = (lp[0], lp[1] + 74)
        s.line(lp[0], lp[1] + 56, r1_end[0], r1_end[1], '#9aa5b1', 2)
        s.circle(lp[0], lp[1] + 4, 4, fill=ORANGE, stroke='#b35c00', sw=1)
        # GND 이음점 J
        J = (220, 350)
        s.wire([(pins['GND'][0], pins['GND'][1] + 8), (pins['GND'][0], J[1]), (J[0] + 8, J[1])], 'black', 2.4)
        s.wire([(t2[0], t2[1] + 16), (t2[0], J[1]), (J[0] - 8, J[1])], 'black', 2.4)
        s.wire([ln, (ln[0] - 6, ln[1] + 30), (J[0] + 4, J[1] - 8)], 'black', 2.2)
        s.wire([J, (J[0], 372), (exit_x, 372)], 'black', 3.2, marker='arrK')
        s.circle(J[0], J[1], 7, fill=ORANGE, stroke='#b35c00', sw=1.2)
        for x, y in ((pins['GND'][0], pins['GND'][1] + 8), (t2[0], t2[1] + 16), ln):
            s.circle(x, y, 4, fill=ORANGE, stroke='#b35c00', sw=1)
        s.text(560, 340, '㉜ (약 20cm, 끝에 듀폰 F)', 11, bold=True)
        s.text(196, 330, '㉞', 12, bold=True)
        s.text(236, 300, '㊱', 12, bold=True)
        s.text(200, 410, '↑ GND 이음점: ㉛ + 짧은 검정 3가닥을 꼬아 한 점 납땜 (수축튜브는 ㉛에 먼저)', 11, bold=True)
        rows = {'㉝': 120, '㉟': 140, '㉙': 212, '㉚': 232, '㉛': 372}
        s.wire([(t1[0], t1[1] + 16), (t1[0], 300), (130, 300), (130, rows['㉝']), (exit_x, rows['㉝'])], 'yellow', 3, marker='arrY')
        s.wire([r1_end, (300, r1_end[1]), (300, rows['㉟']), (exit_x, rows['㉟'])], 'yellow', 3, marker='arrY')
        s.wire([(pins['VCC'][0], pins['VCC'][1] + 8), (pins['VCC'][0], rows['㉙']), (exit_x, rows['㉙'])], 'yellow', 3, marker='arrY')
        s.wire([(pins['I/O'][0], pins['I/O'][1] + 8), (pins['I/O'][0], rows['㉚']), (exit_x, rows['㉚'])], 'yellow', 3, marker='arrY')
        for x, y in ((t1[0], t1[1] + 16), r1_end, (pins['VCC'][0], pins['VCC'][1] + 8), (pins['I/O'][0], pins['I/O'][1] + 8)):
            s.circle(x, y, 4, fill=ORANGE, stroke='#b35c00', sw=1)
        s.text(330, 240, '주황 점 = 납땜 + 수축튜브', 11, color=SUB)
        s.text(330, 256, '부저 핀 쪽은 노랑 끝에 듀폰 F를 납땜해 꽂음', 11, color=SUB)
    else:
        def small(x, y, lab, below=True):
            lever_conn(s, x, y, 40, 20, '', n_holes=2)
            s.text(x + 20, y + 34 if below else y - 10, lab, 11, anchor='middle', bold=True)
        # 긴 다리 → ⓐ(바로 오른쪽) → R1 → ⓑ → ㉟
        small(276, 220, 'ⓐ', below=False)
        s.line(lp[0], lp[1], lp[0] + 6, 230, '#9aa5b1', 2)
        s.line(lp[0] + 6, 230, 276, 230, '#9aa5b1', 2)
        s.line(316, 230, 326, 230, '#9aa5b1', 2)
        s.rect(326, 224, 34, 12, fill='#e9c46a', stroke=INK, sw=1, rx=4)
        s.text(343, 216, 'R1', 11, anchor='middle')
        s.line(360, 230, 370, 230, '#9aa5b1', 2)
        small(370, 220, 'ⓑ', below=False)
        rows = {'㉝': 118, '㉟': 136, '㉙': 212, '㉚': 240, '㉛': 276}
        s.wire([(410, 230), (430, 230), (430, rows['㉟']), (exit_x, rows['㉟'])], 'yellow', 3, marker='arrY')
        # 짧은 다리 → 바로 아래 GND 모음(PCT-415)
        hx, hy = 200, 262
        lever_conn(s, hx, hy, 120, 26, '', n_holes=5)
        s.line(ln[0], ln[1], ln[0], hy, '#9aa5b1', 2)
        s.text(ln[0] - 4, hy - 6, '㊱', 11, anchor='end', bold=True)
        s.text(hx + 60, 340, 'GND 모음 PCT-415 — LED 바로 아래', 11, anchor='middle', bold=True)
        # 버튼: CG0731 (약 10cm로 자름)
        for (x, y) in (t1, t2):
            s.rect(x - 5, y + 8, 10, 12, fill='#495057', stroke=INK, sw=0.8, rx=2)
        small(96, 300, 'ⓔ')
        s.wire([(t1[0], t1[1] + 20), (t1[0], 310), (136, 310)], 'black', 2.2)
        s.rect(t1[0] - 26, 290, 16, 9, fill='#fff3bf', stroke='#c9a227', sw=0.8)
        s.text(t1[0] - 30, 298, '㉝', 10, anchor='end', bold=True)
        s.wire([(96, 310), (76, 310), (76, rows['㉝']), (exit_x, rows['㉝'])], 'yellow', 3, marker='arrY')
        s.wire([(t2[0], t2[1] + 20), (t2[0], 302), (216, 302), (216, hy + 26)], 'black', 2.2)
        s.text(222, 320, '㉞ CG0731', 11, bold=True)
        # 부저: VCC → ⓒ, I/O → ⓓ (듀폰 F/F), GND → 허브
        small(640, 202, 'ⓒ', below=False)
        small(640, 230, 'ⓓ')
        s.wire([(pins['VCC'][0], pins['VCC'][1] + 8), (pins['VCC'][0], 212), (640, 212)], 'grey', 2)
        s.wire([(pins['I/O'][0], pins['I/O'][1] + 8), (pins['I/O'][0], 240), (640, 240)], 'grey', 2)
        s.wire([(680, 212), (exit_x, 212)], 'yellow', 3, marker='arrY')
        s.wire([(680, 240), (exit_x, 240)], 'yellow', 3, marker='arrY')
        s.wire([(pins['GND'][0], pins['GND'][1] + 8), (pins['GND'][0], 252), (300, 252), (300, hy)], 'grey', 2)
        s.text(470, 248, '㉜ 듀폰', 11, bold=True)
        s.text(600, 266, '듀폰 F/F', 10, color=SUB)
        s.wire([(hx + 120, 275), (exit_x, 275)], 'black', 3.2, marker='arrK')
        s.text(480, 292, '㉛ 검정 40cm', 11, bold=True)
        s.text(48, 372, '⚠ ㉙(3V3) 이음은 피복 9~10mm만 — 남은 심선이 LED·R1 다리나 버튼 단자에 닿으면 단락', 12, color=DRED, bold=True)
        s.text(48, 358, 'ⓐ는 LED 바로 옆, 커넥터는 F 면에 납작하게 붙임', 11, color=SUB)
    for n, y in rows.items():
        s.text(exit_x + 10, y + 4, n, 13, bold=True)
    summary = ['㉙ 부저 VCC ← TB3-3 (3V3) · 노랑',
               '㉚ 부저 I/O ← GPIO23 (J3-2) · 노랑',
               '㉝ 버튼 단자 1 ← GPIO4 (J3-13) · 노랑',
               '㉟ R1 → LED 긴 다리 ← GPIO2 (J3-15) · 노랑',
               '㉛ GND → ESP32 GND (J3-7) · 검정',
               ('㉜·㉞·㊱ 부저·버튼 2·LED 짧은 다리 → GND 이음점' if var == 'S' else '㉜·㉞·㊱ 부저·버튼 2·LED 짧은 다리 → PCT-415'),
               '',
               '박스 쪽 끝은 STEP10 절차 4에서 앞 벽 Ø10 구멍으로']
    s.note_box(800, 90, 320, 260, '→ 전장 박스로 (STEP10)', summary, size=11)
    if var == 'S':
        foot = ['학교 실습실(2차 방문)에서 납땜 · 납땜 전에 수축튜브부터 끼우기 · 버튼 단자 1·2는 납땜 전에 고르기',
                '점검: ㉝–㉛은 버튼을 누를 때만 "삐", ㉙–㉛·㉟–㉛은 계속 "삐"면 단락']
    else:
        foot = ['버튼 단자 1·2: CG0731을 약 10cm로 잘라 단자를 꽂고 절연테이프 (단자 1 쪽 선은 양 끝 ㉝ 테이프)',
                'LED 다리는 뒤로 약 2cm뿐(추정) — ⓐ와 PCT-415를 LED에서 1cm 안에 붙임',
                '점검: ㉝–㉛은 버튼을 누를 때만 "삐", ㉙–㉛·㉟–㉛은 계속 "삐"면 단락']
    s.note_box(40, 450, 1080, 140, '알아 둘 것', foot + ['F와 전장 박스 사이는 약 35mm — 부품·커넥터가 튀어나오지 않게'], size=12)
    s.save(f'f14{var.lower()}_front.svg')


if __name__ == '__main__':
    fig_lid('S')
    fig_lid('N')
    fig_lever()
    fig_power()
    fig_front('S')
    fig_front('N')
