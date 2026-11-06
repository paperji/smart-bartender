# -*- coding: utf-8 -*-
"""회로도.html 생성: 인라인 SVG 2개 + 연결표 + 주의사항 + 동작 원리 (오프라인, 외부 CDN 없음).
실행 순서: make_schematic.py → make_wiring.py → make_html.py
"""
import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..")


def inline_svg(name, prefix):
    svg = open(os.path.join(OUT, name), encoding="utf-8").read()
    svg = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{prefix}-{m.group(1)}"', svg)
    svg = svg.replace('aria-labelledby="t d"', f'aria-labelledby="{prefix}-t {prefix}-d"')
    svg = re.sub(r'(<svg[^>]*?) width="\d+" height="\d+"', r'\1', svg, count=1)
    return svg


conn = json.load(open(os.path.join(HERE, "connections.json"), encoding="utf-8"))
CHIP = {"빨강": "#e53935", "검정": "#212121", "주황": "#fb8c00", "파랑": "#1e88e5", "초록": "#43a047",
        "노랑": "#fdd835", "보라": "#8e24aa", "분홍": "#ec407a", "하늘": "#00acc1", "갈색": "#8d6e63"}
GROUPS = [(1, "A. 전원부 (어댑터 → 스위치 → 퓨즈 → 분배 커넥터, ESP32 전원)"),
          (9, "B. 릴레이 전원 · 제어 신호 (ESP32 ↔ 릴레이 입력 헤더)"),
          (17, "C. 펌프 전원 (TB1 → 릴레이 COM, 릴레이 NO → 펌프 → TB2)"),
          (29, "D. 앞판 F — 상태 LED(필수) · 시작/정지 버튼 · 부저(선택)")]


def table_rows():
    rows = []
    gi = 0
    for c in conn:
        if gi < len(GROUPS) and c["no"] == GROUPS[gi][0]:
            rows.append(f'<tr class="grp"><td colspan="6">{html.escape(GROUPS[gi][1])}</td></tr>')
            gi += 1
        col = c["color"]
        chip = (f'<span class="chip" style="background:{CHIP[col]}"></span>{col}' if col in CHIP else html.escape(col))
        rows.append(f'<tr><td class="no"><span class="badge">{c["no"]}</span></td><td>{html.escape(c["frm"])}</td>'
                    f'<td>{html.escape(c["to"])}</td><td class="nowrap">{chip}</td><td class="nowrap">{html.escape(c["gauge"])}</td>'
                    f'<td>{html.escape(c["note"])}</td></tr>')
        if c["no"] == 28:
            rows.append('<tr class="part"><td class="no">D1~D4</td><td>다이오드 1N4007 띠(캐소드) 다리 → 펌프 빨간선(+)</td>'
                        '<td>반대쪽(애노드) 다리 → 펌프 검은선(−)</td><td class="nowrap">—</td><td class="nowrap">(부품 다리)</td>'
                        '<td>위치는 ① 펌프 리드선 이음부(뚜껑 위, 배선도 그림) 또는 ② 연장선의 박스 쪽 끝(조립 가이드 STEP3) — '
                        '<b>전기적으로 동일</b>(SPEC §1). 어느 쪽이든 펌프와 병렬, 납땜 후 수축튜브</td></tr>')
    return "\n".join(rows)


B_PLAN_SVG = """
<svg viewBox="0 0 760 300" style="max-width:760px" role="img" aria-label="A안과 B안 연결 비교" font-family="'Malgun Gothic', sans-serif">
 <rect x="0" y="0" width="760" height="300" fill="#fff"/>
 <g font-size="15" font-weight="bold"><text x="20" y="26">A안 (기본, SPEC) — 점퍼 제거</text><text x="400" y="26">B안 (3.3V로 안 켜질 때) — 점퍼 끼움</text></g>
 <g id="pa">
  <rect x="150" y="50" width="90" height="180" rx="6" fill="#1d5fb4"/>
  <text x="195" y="70" font-size="12" fill="#fff" text-anchor="middle">릴레이 헤더</text>
  <g font-size="12" fill="#fff" font-weight="bold">
   <text x="230" y="98" text-anchor="end">JD-VCC</text><text x="230" y="128" text-anchor="end">VCC(점퍼)</text>
   <text x="230" y="168" text-anchor="end">VCC</text><text x="230" y="198" text-anchor="end">IN1~4</text><text x="230" y="222" text-anchor="end">GND</text></g>
 </g>
 <!-- A안 -->
 <rect x="236" y="88" width="14" height="44" rx="3" fill="none" stroke="#ff1744" stroke-width="2" stroke-dasharray="4 3"/>
 <line x1="234" y1="92" x2="254" y2="128" stroke="#ff1744" stroke-width="3"/><line x1="254" y1="92" x2="234" y2="128" stroke="#ff1744" stroke-width="3"/>
 <path d="M150,94 L40,94" stroke="#e53935" stroke-width="5"/><text x="40" y="86" font-size="13" fill="#e53935" font-weight="bold">+5V (⑨)</text>
 <path d="M150,164 L40,164" stroke="#fb8c00" stroke-width="5"/><text x="40" y="156" font-size="13" fill="#b35c00" font-weight="bold">3V3 (⑪)</text>
 <path d="M150,194 L40,194" stroke="#1e88e5" stroke-width="5"/><text x="40" y="186" font-size="13" fill="#0d47a1" font-weight="bold">GPIO (⑫~⑮)</text>
 <path d="M150,218 L40,218" stroke="#212121" stroke-width="5"/><text x="40" y="242" font-size="13" font-weight="bold">GND (⑯)</text>
 <text x="262" y="112" font-size="12" fill="#d50000" font-weight="bold">점퍼 캡 없음</text>
 <text x="20" y="270" font-size="12.5" fill="#333">⑨ = JD-VCC 핀, ⑪ = 입력 헤더 VCC 핀</text>
 <!-- B안 -->
 <g transform="translate(380,0)">
  <rect x="150" y="50" width="90" height="180" rx="6" fill="#1d5fb4"/>
  <text x="195" y="70" font-size="12" fill="#fff" text-anchor="middle">릴레이 헤더</text>
  <g font-size="12" fill="#fff" font-weight="bold">
   <text x="230" y="98" text-anchor="end">JD-VCC</text><text x="230" y="128" text-anchor="end">VCC(점퍼)</text>
   <text x="230" y="168" text-anchor="end">VCC</text><text x="230" y="198" text-anchor="end">IN1~4</text><text x="230" y="222" text-anchor="end">GND</text></g>
  <rect x="236" y="88" width="14" height="44" rx="3" fill="#ffca28" stroke="#c79100" stroke-width="2"/>
  <text x="262" y="108" font-size="12" fill="#2e7d32" font-weight="bold">점퍼 캡 끼움</text>
  <text x="262" y="124" font-size="11" fill="#2e7d32">(JD-VCC엔 캡만)</text>
  <path d="M150,94 L60,94" stroke="#e53935" stroke-width="3" stroke-dasharray="6 5" opacity="0.45"/>
  <text x="20" y="86" font-size="12.5" fill="#c62828" font-weight="bold">② ⑨를 여기서 빼서</text>
  <path d="M130,100 L130,146" stroke="#c62828" stroke-width="2.5"/><polygon points="123,144 137,144 130,156" fill="#c62828"/>
  <path d="M150,164 L40,164" stroke="#e53935" stroke-width="5"/><text x="20" y="156" font-size="13" fill="#e53935" font-weight="bold">+5V ⑨ → VCC</text>
  <path d="M150,194 L40,194" stroke="#1e88e5" stroke-width="5"/><text x="40" y="186" font-size="13" fill="#0d47a1" font-weight="bold">GPIO (⑫~⑮)</text>
  <path d="M150,218 L40,218" stroke="#212121" stroke-width="5"/><text x="40" y="242" font-size="13" font-weight="bold">GND (⑯)</text>
  <text x="20" y="270" font-size="12.5" fill="#d50000" font-weight="bold">① ⑪(3V3)은 먼저 뽑아 치움 → ② ⑨ 옮김 → ③ 캡</text>
  <text x="20" y="290" font-size="12" fill="#333">TB1 ↔ VCC·JD-VCC 둘 다 '삐', TB1 ↔ TB3 무음</text>
 </g>
</svg>"""

PAGE = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI 스마트 바텐더 회로도 v3 · 팀 홍당무</title>
<style>
@page { size: A4 landscape; margin: 9mm; }
:root { --ink:#1b1b1b; --muted:#555; --line:#d0d0d0; --warn:#b00020; --bg:#fafafa; }
* { box-sizing: border-box; }
body { margin:0; font-family:'Malgun Gothic','맑은 고딕',sans-serif; color:var(--ink); background:#eef0f2; line-height:1.55; font-size:14.5px; }
header.top { background:#1d5fb4; color:#fff; padding:18px 28px; }
header.top h1 { margin:0 0 4px; font-size:24px; }
header.top p { margin:0; opacity:.92; font-size:13.5px; }
nav { position:sticky; top:0; z-index:5; background:#fff; border-bottom:1px solid var(--line); padding:8px 28px; font-size:13.5px; }
nav a { color:#1d5fb4; text-decoration:none; margin-right:14px; white-space:nowrap; }
main { max-width:1400px; margin:0 auto; padding:18px 22px 40px; }
section { background:#fff; border:1px solid var(--line); border-radius:10px; padding:18px 22px; margin:0 0 18px; }
h2 { margin:0 0 10px; font-size:20px; border-left:6px solid #1d5fb4; padding-left:10px; }
h3 { margin:16px 0 6px; font-size:16px; }
figure { margin:0; }
figure svg { width:100%; height:auto; display:block; border:1px solid #ddd; border-radius:6px; background:#fff; }
figcaption { font-size:12.5px; color:var(--muted); margin-top:6px; }
table { border-collapse:collapse; width:100%; font-size:13px; }
th, td { border:1px solid #cfcfcf; padding:5px 7px; vertical-align:top; text-align:left; }
th { background:#f1f4f8; white-space:nowrap; }
tr.grp td { background:#e8eef8; font-weight:bold; color:#143f78; }
tr.part td { background:#fffbea; }
td.no { text-align:center; width:52px; white-space:nowrap; }
td.nowrap { white-space:nowrap; }
.badge { display:inline-block; min-width:26px; height:26px; line-height:22px; border:2px solid #333; border-radius:13px; font-weight:bold; text-align:center; font-size:12.5px; background:#fff; }
.chip { display:inline-block; width:22px; height:10px; border-radius:3px; margin-right:6px; vertical-align:middle; border:1px solid rgba(0,0,0,.35); }
.warn { border:2px solid #f3b6ae; background:#fff8f6; }
.warn ol > li { margin-bottom:9px; }
.warn b.r { color:var(--warn); }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.note { font-size:12.5px; color:var(--muted); }
.kbd { font-family:Consolas, monospace; background:#f3f3f3; border:1px solid #ddd; border-radius:4px; padding:0 5px; font-size:12.5px; }
.eq { font-family:Consolas,'Malgun Gothic',monospace; background:#f6f8fb; border:1px solid #dde4ee; border-radius:6px; padding:8px 12px; margin:6px 0; white-space:pre-wrap; font-size:13px; }
.est { color:#8a5a00; font-size:12px; }
.files a { color:#1d5fb4; }
@media (max-width: 900px) { .grid2 { grid-template-columns:1fr; } }
@media print {
  body { background:#fff; font-size:11pt; }
  header.top { background:#fff; color:#000; border-bottom:2px solid #000; padding:0 0 4mm; }
  nav { display:none; }
  main { max-width:none; padding:0; }
  section { border:none; padding:0; margin:0 0 6mm; page-break-inside:auto; }
  section.sheet { page-break-before:always; page-break-after:always; }
  section.sheet figure svg { border:none; max-height:180mm; width:auto; max-width:100%; margin:0 auto; }
  section.sheet h2, section.sheet figcaption { display:none; }
  tr, .eq, li { page-break-inside:avoid; }
  h2 { page-break-after:avoid; }
  a { color:#000; text-decoration:none; }
}
</style>
</head>
<body>
<header class="top">
  <h1>AI 스마트 바텐더 회로도 v3 — 회로도 · 배선도 · 연결표</h1>
  <p>팀 홍당무 · 캡스톤디자인Ⅱ (안양대학교 정보전기전자공학과) · 2026-11-06 · SPEC v2.1 기준 (smart-bartender/docs/SPEC.md §1 핀맵) · 인터넷 없이 열리는 단일 파일</p>
</header>
<nav>
  <a href="#sch">① 회로도</a><a href="#wir">② 배선도</a><a href="#tbl">③ 연결표</a><a href="#warn">④ 꼭 지킬 5가지</a>
  <a href="#bplan">⑤ 릴레이 3.3V 시험·B안</a><a href="#theory">⑥ 동작 원리(논문용)</a><a href="#first">⑦ 처음 전원 넣기</a><a href="#parts">⑧ 기호↔부품</a>
</nav>
<main>

<section>
  <h2>한눈에 보기</h2>
  <div class="grid2">
  <div>
  <p>앱(스마트폰)이 블루투스(BLE)로 레시피를 보내면 <b>ESP32</b>가 각 펌프를 계산된 시간만큼 켭니다.
  ESP32 핀은 3.3V 신호만 낼 수 있어 펌프를 직접 돌리지 못하므로, <b>릴레이</b>(전기로 움직이는 스위치)가 5V 전원을 펌프에 연결/차단합니다.</p>
  <ul>
   <li>전원: <b>5V 4A 어댑터</b> → J1 DC잭 → SW1 전원 스위치 → F1 3A 퓨즈 → <b>TB1(+5V 분배)</b>. TB2 = GND 분배, TB3 = 3V3 분배. GND는 J1(−) 나사에서 ⑤(→ TB2, 펌프 귀환)와 ⑦(→ ESP32 GND, ESP32·릴레이 귀환)로 따로 나누는 <b>별형 접지</b>이며, 전기적으로는 모두 공통입니다.</li>
   <li>제어: GPIO26·27·32·33 → 릴레이 IN1~IN4 → 펌프 1~4. 릴레이는 <b>LOW = 켜짐</b>(Active-LOW).</li>
   <li>보호: 펌프마다 <b>1N4007 다이오드</b>(역기전력 흡수), 5V에 <b>1000µF 커패시터</b>(전압 순간 강하 완화).</li>
  </ul>
  </div>
  <div>
  <table>
   <tr><th>기능</th><th>ESP32 핀 (헤더 위치)</th><th>연결 대상</th></tr>
   <tr><td>펌프 1 / 2 / 3 / 4</td><td>GPIO26 (J2-10) / GPIO27 (J2-11) / GPIO32 (J2-7) / GPIO33 (J2-8)</td><td>릴레이 IN1 / IN2 / IN3 / IN4</td></tr>
   <tr><td>시작/정지 버튼 (선택)</td><td>GPIO4 (J3-13)</td><td>버튼 → GND (내부 풀업, 눌림 = LOW)</td></tr>
   <tr><td>상태 LED (필수)</td><td>GPIO2 (J3-15)</td><td>220Ω → LED → GND (DevKitC V4에는 GPIO2 사용자 LED가 없어 외부 LED 필수)</td></tr>
   <tr><td>부저 (선택)</td><td>GPIO23 (J3-2)</td><td>능동 부저 I/O (HIGH = 울림)</td></tr>
   <tr><td>릴레이 로직 전원</td><td>3V3 (J2-1) → TB3</td><td>릴레이 VCC — A안(기본): JD-VCC 점퍼 제거. B안(USB·어댑터 분리 후): ⑪ 먼저 제거 → ⑨(+5V)를 이 VCC 핀으로 옮김 → 점퍼 캡 끼움 · VCC=5V (<b>3V3 연결 금지</b>)</td></tr>
   <tr><td>릴레이 코일 전원</td><td>— (TB1 +5V)</td><td>릴레이 JD-VCC (B안: ⑨ → 입력 헤더 VCC 핀 → 점퍼 캡 → JD-VCC)</td></tr>
   <tr><td>ESP32 전원</td><td>5V (J2-19)</td><td>TB1 +5V (USB 업로드 시 분리)</td></tr>
   <tr><td>(확장) 펌프 5~8</td><td>GPIO25 · 13 · 18 · 19</td><td>2번째 릴레이 IN1~4 (같은 방식)</td></tr>
  </table>
  <p class="note">J2 = ESP32 왼쪽 핀줄, J3 = 오른쪽 핀줄. 안테나(금속 덮개 쪽)를 위로 두고 위에서부터 1, 2, 3 … 으로 셉니다.</p>
  </div>
  </div>
  <p class="files">파일: <a href="schematic.svg">schematic.svg</a> · <a href="schematic.png">schematic.png</a> · <a href="wiring.svg">wiring.svg</a> · <a href="wiring.png">wiring.png</a> · <a href="검증노트.md">검증노트.md</a> (전류 예산·정격 검토)</p>
</section>

<section class="sheet" id="sch">
  <h2>① 회로도 (전기적 연결 관계)</h2>
  <figure>__SCH__<figcaption>위쪽 빨간 선 = +5V 버스, 아래 검은 선 = GND 버스. 점(●)이 있는 곳만 연결되고, 점 없이 교차하는 선은 연결되지 않습니다. 점선 = 선택 부품(버튼·부저). 상태 LED는 필수입니다.</figcaption></figure>
</section>

<section class="sheet" id="wir">
  <h2>② 배선도 (실물 그대로 선 잇기)</h2>
  <figure>__WIR__<figcaption>동그라미 번호 = 아래 연결표의 번호(조립 순서). 반원 모양으로 튀어 오른 곳은 '그냥 위로 지나가는' 곳(연결 아님)입니다.
  ESP32 확장보드(P02 터미널쉴드)를 쓰면 같은 이름의 단자에 꽂으면 됩니다.</figcaption></figure>
</section>

<section id="tbl">
  <h2>③ 연결표 (번호 = 배선도의 동그라미 번호 = 권장 작업 순서)</h2>
  <p class="note">굵기: AWG20 = 보유한 빨강/검정 2P 선(P19, 펌프·전원), AWG22 = UL1007 22AWG, 듀폰 = 점퍼 케이블(P20~P22, 약 AWG26).
  <b>UL1007은 노랑(P24)·검정(P62)·빨강(P63) 세 색만 삽니다</b>: GND선 ⑦·㉛~㊱ = 검정, ESP32 5V선 ⑧ = 빨강, 앞판 신호선 ㉙·㉚·㉝·㉟ = 노랑(같은 색이라 <b>선 양 끝에 번호 테이프</b>로 구분).
  릴레이 헤더처럼 튀어나온 핀(수)에는 듀폰 <b>암(F)</b> 끝을, 레버 커넥터·나사 단자·확장보드 단자에는 <b>피복을 8~10mm 벗긴</b> 끝을 꽂습니다(듀폰은 반을 잘라 사용).
  레버 커넥터는 <b>레버를 올리고 → 끝까지 밀어 넣고 → 레버를 내린 뒤</b> 살짝 당겨 빠지지 않는지 확인합니다.</p>
  <table>
   <thead><tr><th>번호</th><th>출발 단자</th><th>도착 단자</th><th>선 색</th><th>권장 굵기</th><th>비고</th></tr></thead>
   <tbody>
__ROWS__
   </tbody>
  </table>
</section>

<section class="warn" id="warn">
  <h2>④ 꼭 지킬 주의사항 5가지</h2>
  <ol>
   <li><b class="r">(A안) 릴레이 JD-VCC 점퍼 캡을 뺀다.</b> 보드 모서리의 작은 플라스틱 점퍼 캡(JD-VCC│VCC 두 핀을 이어 줌, 색은 제품마다 다름)을 뽑아 보관합니다.
       그다음 <b>JD-VCC 핀(보드 인쇄 확인)에는 +5V(⑨ 빨강)</b>, 입력 헤더의 <b>VCC에는 3V3(⑪ 주황)</b>을 꽂습니다.
       캡을 낀 채 VCC에 3V3을 연결하면 5V가 ESP32의 3.3V 쪽으로 거꾸로 흘러 ESP32가 고장 날 수 있습니다.
       3.3V로 안 켜질 때는 ⑤ <b>B안</b>(USB·어댑터를 모두 뺀 뒤 ⑪을 먼저 뽑고 → ⑨를 JD-VCC 핀에서 빈 VCC 핀으로 옮긴 뒤 → 캡을 다시 끼움. 점퍼 캡과 듀폰 소켓은 한 핀에 같이 꽂을 수 없어 B안에서 JD-VCC 핀에는 캡만 끼웁니다. B안에서는 VCC를 3V3에 절대 연결하지 않음).</li>
   <li><b class="r">다이오드 방향: 띠(은색 줄, 캐소드) = 펌프 빨간선(+) 쪽.</b> 다이오드는 평소엔 전류가 흐르지 않다가, 펌프가 꺼지는 순간 생기는 역방향 고전압만 흡수합니다.
       반대로 달면 릴레이가 켜질 때마다 +5V와 GND가 다이오드로 바로 이어집니다(단락). 펌프를 켜는 순간 ESP32가 재부팅되거나 어댑터가 꺼지고, 다이오드가 뜨거워집니다(ESP32를 USB로 켠 디버깅 상태에서는 단락이 계속돼 더 위험).
       5V 4A 어댑터는 단락이 나면 약 4~6A(추정)에서 스스로 출력을 끊기 때문에 <b>3A 퓨즈는 끊어지지 않을 수 있습니다</b> — "퓨즈가 멀쩡하다 = 다이오드 방향이 맞다"가 아닙니다. 수축튜브가 변색됐거나 냄새가 난 다이오드는 교체합니다.</li>
   <li><b class="r">커패시터 극성: 띠(−)가 있는 다리 = GND(TB2), 긴 다리(+) = +5V(TB1).</b> 전해 커패시터는 거꾸로 꽂으면 부풀거나 터질 수 있습니다.
       16V 이상 제품(보유 계획 16V)만 사용합니다.</li>
   <li><b class="r">USB로 펌웨어를 올릴 때는 ⑧(TB1 → ESP32 5V) 선을 먼저 뽑는다.</b> Espressif는 USB·5V핀·3V3핀 중 <b>한 곳으로만</b> 전원을 넣으라고 경고합니다.
       ⑧을 꽂은 채 USB를 연결하면 PC의 USB 전원과 어댑터 전원이 서로 부딪히거나, 어댑터가 꺼져 있을 때 USB가 릴레이·펌프까지 먹여 PC 포트에 무리가 갑니다.
       GND(⑦)는 그대로 둬도 됩니다. <b>뽑은 ⑧의 끝(ESP32 5V에 연결된 맨 심선)에는 USB를 꽂으면 전기가 흐르므로</b> 수축튜브 캡(P26)이나 절연·마스킹테이프로 감싸고, 릴레이 나사 단자·J1 나사에서 먼 박스 벽에 붙여 둡니다(GND·+5V에 닿으면 USB 단락이나 이중 전원).
       업로드가 끝나면 USB를 빼고 테이프를 벗긴 뒤 ⑧을 다시 꽂습니다.</li>
   <li><b class="r">어댑터를 꽂기 전에 멀티미터로 단락 검사.</b> 멀티미터를 도통(삐 소리, 다이오드 기호) 모드로 두고 <b>TB1(+5V) – TB2(GND)</b>, <b>TB3(3V3) – TB2</b>, <b>TB1 – TB3</b> 사이를 각각 잽니다.
       '삐' 소리가 계속 나면 어딘가 붙어 있는 것(단락)이니 전원을 넣지 말고 배선을 다시 확인합니다. (C1·ESP32 보드의 커패시터가 충전되느라 처음에 잠깐 '삐'하고 곧 멈추는 것은 정상)</li>
  </ol>
  <p class="note">추가: 릴레이 단자 NO/COM/NC 위치는 보드 인쇄를 확인하세요. 전원 없이 멀티미터 도통 모드에서 <b>COM–NC는 '삐'</b>, <b>COM–NO는 무음</b>이 정상입니다(이 배선도는 제조사 치수도 방향 기준 '위 단자 = NO'로 그렸습니다).
  전원을 넣자마자 펌프가 계속 돌면 NO/NC를 바꿔 꽂은 것이니 즉시 SW1을 끄세요.</p>
</section>

<section id="bplan">
  <h2>⑤ 릴레이 3.3V 동작 시험과 B안</h2>
  <p>이 릴레이 보드는 입력이 <b>표시 LED + 옵토커플러 LED 직렬</b> 구조로 추정됩니다(보드 회로도 원본 미확인). 그래서 3.3V로 구동(A안)하면 입력 전류가 약 0.3~0.7mA로 작아
  <b>켜지지 않을 수도</b> 있습니다. 조립 전에 브레드보드에서 먼저 시험하세요.</p>
  <ol>
   <li>A안대로 연결(⑨ ⑪ ⑫~⑯) → 앱 또는 nRF Connect에서 <span class="kbd">{"cmd":"run","p":1,"ms":2000}</span> 전송.</li>
   <li>IN1 표시 LED가 켜지고 '딸깍' 소리가 나면 성공. 채널 2~4도 <span class="kbd">"p":2</span> ~ <span class="kbd">"p":4</span>로 확인.</li>
   <li>안 켜지면 <b>B안</b>: USB와 어댑터를 모두 뺀 상태에서 ① ⑪(3V3 → 릴레이 VCC) 선을 <b>먼저 뽑아</b> 치우고 → ② +5V 선 ⑨(빨강)를 JD-VCC 핀에서 빼서 <b>입력 헤더의 VCC 핀(⑪이 있던 자리)</b>에 꽂고 → ③ 점퍼 캡을 끼웁니다.
       이제 +5V가 VCC 핀으로 들어가 점퍼 캡을 거쳐 JD-VCC(코일)에도 들어갑니다(VCC = JD-VCC = 5V). <b>JD-VCC 핀에는 캡만</b> 있고 다른 선은 없습니다(2.54mm 점퍼 캡은 두 핀을 모두 덮으므로 듀폰 소켓을 꽂은 핀에는 들어가지 않음).
       신호선(⑫~⑮)·GND(⑯)는 그대로(IN은 GPIO 직결). ⑨가 VCC 핀을 차지하므로 3V3(⑪)을 다시 꽂을 자리도 없어집니다.
       확인(전원 없이, 멀티미터 도통 모드): TB1(+5V) ↔ 릴레이 VCC 핀·JD-VCC 핀 모두 '삐', TB1 ↔ TB3(3V3)은 무음.</li>
   <li>B안으로 1~2를 다시 시험합니다. 꺼질 때(신호 HIGH)도 확실히 꺼지는지 봅니다. 두 안 모두 Active-LOW라 <b>펌웨어는 바꾸지 않습니다</b>. 정한 방식을 릴레이에 테이프로 적어 둡니다.</li>
  </ol>
  <figure>__BPLAN__<figcaption>B안에서 신호가 HIGH(3.3V)일 때 5 − 3.3 = 1.7V만 걸리는데, 직렬 LED 2개를 켜려면 약 2.6~3V가 필요해 확실히 꺼집니다(추정). 신호가 LOW(0V)이면 약 2~2.4mA가 흘러 확실히 켜집니다.
  <b>B안에서는 릴레이 VCC를 절대 3V3에 연결하지 마세요.</b></figcaption></figure>
</section>

<section id="theory">
  <h2>⑥ 동작 원리 (논문·보고서용 설명)</h2>
  <h3>1) 제어 흐름</h3>
  <p>앱이 BLE(Nordic UART)로 <span class="kbd">{"cmd":"make","steps":[{"p":1,"ml":45}, …]}</span>를 보내면, 펌웨어는 펌프별 유량 <i>Q</i>(ml/s, 캘리브레이션 값)를 이용해 구동 시간을 계산합니다.</p>
  <div class="eq">구동 시간 t [ms] = V [ml] ÷ Q [ml/s] × 1000      예) 45 ml, Q = 4.5 ml/s → t = 10,000 ms (10초)</div>
  <p>해당 GPIO를 LOW로 만들어 릴레이를 켜고, t가 지나면 HIGH로 되돌립니다. 기본은 펌프를 하나씩 차례로 켜는 <b>순차 구동</b>(펌프 사이 300ms 휴지)이며,
  밸브 없이 '펌프를 켜 둔 시간'으로만 양을 정하는 <b>펌프 단독 시간 제어</b> 방식입니다.
  안전을 위해 펌웨어는 한 번의 제조에서 <b>펌프 1개당 최대 120초</b>(재료 1개 최대 300ml, 총 500ml), 직접 구동(<span class="kbd">run</span>)은 최대 60초로 제한하고,
  어떤 펌프든 (최대 구동시간 + 1초) 이상 켜져 있으면 전체를 정지합니다(SPEC §2.3, v2.1).</p>

  <h3>2) 릴레이 Active-LOW와 옵토커플러 절연</h3>
  <p>릴레이 입력은 VCC → 저항(약 1kΩ) → 표시 LED → 옵토커플러 LED → IN 핀 구조입니다. IN이 LOW(0V)이면 전류가 흘러 옵토 LED가 켜지고, 옵토 출력 트랜지스터가
  JD-VCC(5V) 쪽 코일 구동 트랜지스터를 켜서 릴레이 접점(COM–NO)이 닫힙니다. 즉 <b>LOW = ON</b>입니다.</p>
  <div class="eq">A안 입력 전류  I_IN ≈ (V_VCC − V_LED − V_F,opto) ÷ R = (3.3 − 1.8 − 1.15) V ÷ 1 kΩ ≈ 0.35 mA   (추정)
B안 입력 전류  I_IN ≈ (5.0 − 1.8 − 1.15) V ÷ 1 kΩ ≈ 2.0 mA,  OFF 시 5.0 − 3.3 = 1.7 V &lt; 약 2.95 V → 전류 0</div>
  <p>JD-VCC 점퍼를 빼면 입력 쪽(VCC, ESP32 3.3V)과 코일 쪽(JD-VCC, 5V)의 전원이 분리되어, 신호 HIGH = VCC(3.3V)가 되어 확실히 꺼집니다.
  부팅 순간 GPIO가 출력 레지스터 기본값(0 = LOW)으로 잠깐 바뀌며 펌프가 튀는 것을 막기 위해, 펌웨어는 <span class="kbd">gpio_set_level(HIGH)</span>로 출력 레지스터를 먼저 HIGH로 써 두고 <span class="kbd">pinMode(OUTPUT)</span> → <span class="kbd">digitalWrite(HIGH)</span> 순서로 바꿉니다(SPEC §1 — ESP32 코어 3.x는 <span class="kbd">pinMode</span> 전에 부른 <span class="kbd">digitalWrite</span>를 무시하므로 <span class="kbd">gpio_set_level</span>을 씀).
  부팅 중 GPIO가 입력(High-Z) 상태일 때는 IN 핀으로 전류가 흐를 길이 없어 릴레이는 꺼진 상태를 유지합니다.</p>

  <h3>3) 플라이백(역기전력) 다이오드</h3>
  <p>모터 코일은 인덕턴스 L을 가져, 릴레이가 전류 I를 갑자기 끊으면 <i>V = L·di/dt</i>의 큰 역전압이 생깁니다. 이 전압은 릴레이 접점에 불꽃(아크)을 일으키고
  전기 잡음으로 ESP32 리셋·BLE 끊김을 유발할 수 있습니다. 펌프와 <b>반대 방향(띠 = +)</b>으로 병렬 연결한 다이오드가 이 전류에 순환 경로를 만들어 전압을 약 0.8V로 묶어 줍니다.</p>
  <div class="eq">예시(가정: L ≈ 1 mH, I = 0.2 A, 차단 1 µs):  V ≈ 1e-3 × 0.2 ÷ 1e-6 = 200 V,   에너지 E = ½ L I² ≈ 20 µJ
1N4007: 평균 1 A · 순간 30 A · 역내압 1000 V  →  펌프 전류(≈0.2 A, 기동 ≈0.6 A) · 전원 5 V에 충분</div>

  <h3>4) 순차 구동 전류 계산 (전원 용량 검토)</h3>
  <table>
   <tr><th>부하</th><th>전류</th><th>근거</th></tr>
   <tr><td>수중펌프 1개 (정상 운전)</td><td>약 0.20 A</td><td>판매처 표 4.5V 0.18A, 5V에서 약간 증가 <span class="est">(추정)</span></td></tr>
   <tr><td>수중펌프 1개 (기동 순간)</td><td>약 0.4~0.6 A</td><td>소형 DC 모터 일반값 2~3배 <span class="est">(추정, 멀티미터 실측 필요)</span></td></tr>
   <tr><td>릴레이 코일 1개</td><td>약 0.071 A</td><td>JQC-3FF 5V, 코일 약 70Ω <span class="est">(배포처 자료)</span></td></tr>
   <tr><td>ESP32 DevKitC (BLE 동작)</td><td>0.10~0.25 A</td><td>보수적으로 0.25 A 사용</td></tr>
   <tr><td>LED + 부저 + 옵토 입력</td><td>약 0.04 A</td><td>LED (3.3−2.0)/220Ω ≈ 6 mA, 부저 약 30 mA <span class="est">(추정)</span></td></tr>
  </table>
  <div class="eq">순차(seq) 정상:  0.25 + 0.071 + 0.20 + 0.04 ≈ 0.56 A      순간 최대: 0.25 + 0.071 + 0.6 + 0.04 ≈ 0.96 A
동시(par) 정상:  0.25 + 4×0.071 + 4×0.20 + 0.04 ≈ 1.37 A   (전력 약 6.9 W)
동시 기동(펌웨어가 0.1초 간격으로 차례 기동): 1.37 − 0.20 + 0.6 ≈ 1.77 A
→ 5V 4A 어댑터 여유: 순차 약 4.2배, 동시 약 2.3배.   3A 퓨즈는 정상 동작에서 끊어지지 않음.
단락 보호: 1차 = 어댑터(P11) 내장 과전류·단락 보호(정격의 약 110~150% = 약 4.4~6A에서 차단, 추정), F1 3A = 배선 백업 보호(어댑터 보호 고장·더 큰 어댑터 사용 대비).
            4A 어댑터의 단락 전류는 퓨즈 정격의 약 1.5~2배라 3A 퓨즈가 바로 끊어지지 않을 수 있음(속단형 가정, IEC 60127-2 F형: 1.5배 1시간 이상 견딤, 2.1배 ≤ 30분, 2.75배 10ms~2s).</div>
  <p>순차 구동을 기본으로 하는 이유: 한 번에 펌프 1개만 돌아 전류가 작고(전압 강하 최소) 유량이 일정해 정량성이 좋기 때문입니다.
  1000µF 커패시터는 펌프 기동 순간의 전류를 잠깐 대신 공급합니다. 예) 추가 0.4A가 0.5ms 동안 필요할 때 <i>ΔV = I·Δt / C</i> = 0.4 × 0.0005 ÷ 0.001 = 0.2V만 떨어집니다(추정).</p>
</section>

<section id="first">
  <h2>⑦ 처음 전원 넣기 (단계별 점검)</h2>
  <ol>
   <li>④의 5가지를 눈으로 다시 확인하고, 멀티미터 단락 검사를 합니다.</li>
   <li><b>펌프 선 ㉑ ㉓ ㉕ ㉗을 아직 꽂지 않은 상태</b>에서 SW1을 켭니다. ESP32 빨간 전원 LED가 켜지는지, TB1–TB2 사이 4.9~5.25V, TB3–TB2 사이 3.2~3.4V인지 측정합니다.</li>
   <li>앱(또는 nRF Connect)으로 연결해 <span class="kbd">run</span> 명령으로 릴레이 4개가 차례로 '딸깍'하는지 확인합니다. 안 되면 ⑤ B안.</li>
   <li>SW1을 끄고 펌프 선을 꽂습니다. 펌프를 <b>물을 담은 용기</b>에 넣고(공회전 금지) 다시 켠 뒤 펌프별로 2초씩 구동해 봅니다.</li>
   <li>앱의 캘리브레이션(10초 구동 → 실제 ml 입력)으로 펌프별 유량을 저장합니다. 용기를 절반쯤 채운 상태에서 하세요. 저장 전에는 앱에 "캘리브레이션 전 — 실제보다 적게 나올 수 있어요" 배너가 뜹니다(기본값 20ml/s가 실제 약 3~6ml/s보다 커서 덜 나오는 쪽).</li>
   <li>PC에서 시리얼 로그를 보며 시험할 때는 ⑧만 뽑고, <b>뽑은 ⑧ 끝을 수축튜브 캡이나 테이프로 감싸 박스 벽에 붙인 뒤</b> USB를 연결합니다(이 끝에는 USB 5V가 걸려, J1 − 나사에 닿으면 USB 단락, 릴레이 COM 나사에 닿으면 이중 전원). 이때 어댑터(SW1)를 켜 두면 릴레이·펌프는 어댑터로, ESP32는 USB로 동작합니다(GND ⑦은 연결 유지).</li>
  </ol>
</section>

<section id="parts">
  <h2>⑧ 그림 기호 ↔ 부품(BOM) 대응</h2>
  <table>
   <tr><th>기호</th><th>부품</th><th>BOM ID</th><th>기호</th><th>부품</th><th>BOM ID</th></tr>
   <tr><td>J1</td><td>터미널블럭 to DC 잭 (2.1mm 암)</td><td>P12</td><td>U1</td><td>ESP32 DevKitC V4 (+확장보드 선택)</td><td>P01 (+P02)</td></tr>
   <tr><td>SW1</td><td>로커 스위치 KCD1-101A</td><td>P13</td><td>K1~K4</td><td>4채널 릴레이 SZH-RLBG-012</td><td>P08</td></tr>
   <tr><td>F1</td><td>퓨즈홀더 FH-303 + 퓨즈 3A</td><td>P14 · P15</td><td>M1~M4</td><td>수중펌프 SZH-GNP155</td><td>P09</td></tr>
   <tr><td>TB1 · TB2 · TB3</td><td>레버 커넥터 PCT-418 (5V · GND · 3V3)</td><td>P18 (3개 + 예비 1)</td><td>D1~D4</td><td>다이오드 1N4007</td><td>P10</td></tr>
   <tr><td>C1</td><td>전해 커패시터 1000µF 16V</td><td>P16</td><td>BZ1 · SW2</td><td>능동 부저 ONE005 · 16mm 푸시 버튼</td><td>P04 · P03</td></tr>
   <tr><td>어댑터</td><td>5V 4A 어댑터</td><td>P11</td><td>LED1 · R1</td><td>5mm 빨강 LED · 220Ω</td><td>P05 · P06</td></tr>
   <tr><td>전선</td><td>AWG20 2P(빨/검) · UL1007 22AWG 노랑·검정·빨강 · 듀폰 점퍼</td><td>P19 · P24·P62·P63 · P20~P22</td><td>절연</td><td>열수축튜브 · 솔더 슬리브 · 케이블타이</td><td>P26 · P25 · P27</td></tr>
  </table>
  <p class="note">이 페이지와 그림은 <span class="kbd">hardware/circuit/src/</span>의 파이썬 스크립트(make_schematic.py → make_wiring.py → make_html.py, PNG: render_png.py)로 다시 만들 수 있습니다.
  핀이나 배선을 바꿀 때는 먼저 SPEC.md를 고치고 스크립트를 수정한 뒤 다시 실행하세요.</p>
</section>
</main>
</body>
</html>
"""

page = (PAGE.replace("__SCH__", inline_svg("schematic.svg", "sch"))
        .replace("__WIR__", inline_svg("wiring.svg", "wir"))
        .replace("__ROWS__", table_rows())
        .replace("__BPLAN__", B_PLAN_SVG))
with open(os.path.join(OUT, "회로도.html"), "w", encoding="utf-8") as f:
    f.write(page)
print("written 회로도.html", len(page))
