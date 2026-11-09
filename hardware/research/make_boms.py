# -*- coding: utf-8 -*-
"""납땜 기준 / 무납땜 기준 BOM 두 벌을 만든다 (xlsx + md).

사용: python make_boms.py bom_variants.json solder|nosolder
그다음(선택) Excel로 재계산해 캐시 값을 넣으려면 recalc_excel.ps1, 공개 전에는 반드시 scrub_xlsx.py(작성자·경로 지우기)
- 원본: hardware/research/canonical_bom.json (69항목) + hardware/BOM.xlsx (VAT 별도 단가·선택_업그레이드·보유_미사용·1학기 예산 값)
- config.json: 공통 변경(출력 부품·지출 완료·용기)과 변형별 변경
"""
import copy
from decimal import Decimal, ROUND_HALF_UP
import json
import os
import sys

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

HW = os.environ.get("BOM_HW") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_JSON = os.path.join(HW, "research", "canonical_bom.json")
SRC_XLSX = os.path.join(HW, "BOM.xlsx")

cfg = json.load(open(sys.argv[1], encoding="utf-8"))
VAR = sys.argv[2]
V = cfg["variants"][VAR]
OUT_BASE = os.path.join(HW, V["file"])
DATE = cfg["date"]
DM = "디바이스마트"

# ---------------------------------------------------------------- 데이터
items = json.load(open(SRC_JSON, encoding="utf-8"))
src = openpyxl.load_workbook(SRC_XLSX)

# VAT 별도 단가: 원본 의뢰서 시트 F열 'Pxx · ...' → D열
vat_ex = {}
ws = src["추가구매_의뢰서용"]
for r in range(10, 39):
    f = ws.cell(r, 6).value
    d = ws.cell(r, 4).value
    if isinstance(f, str) and f.startswith("P") and isinstance(d, (int, float)):
        vat_ex[f.split(" ")[0]] = d


def apply(item_list, changes, adds):
    byid = {x["id"]: x for x in item_list}
    for pid, ch in changes.items():
        if pid not in byid:
            raise SystemExit(f"변경 대상 없음: {pid}")
        byid[pid].update(ch)
    for a in adds:
        if a["id"] in byid:
            raise SystemExit(f"중복 ID: {a['id']}")
        base = {"qtyOwned": 0, "qtyToBuy": 0, "productNo": None, "url": None, "note": "", "usedIn": "", "unitPriceKRW": None}
        base.update(a)
        item_list.append(base)
        byid[a["id"]] = base


apply(items, cfg["common"]["changes"], cfg["common"]["add"])
apply(items, V.get("changes", {}), V.get("add", []))

CAT_ORDER = ["제어", "구동", "전원", "배선", "배관", "외형", "3D 프린팅", "공구", "선택", "미사용"]
items.sort(key=lambda x: (CAT_ORDER.index(x["category"]), int(x["id"][1:]) if x["id"][1:].isdigit() else 999))


def status(x):
    if x.get("status"):
        return x["status"]
    if x["category"] == "미사용":
        return "미사용"
    if x["category"] == "선택":
        return "선택(구매 안 함)"
    if x["qtyToBuy"] > 0:
        return "구매 필요"
    if x["category"] == "공구":
        return "학교 대여"
    if x["qtyNeeded"] == 0:
        return "불필요"
    if x["qtyOwned"] >= x["qtyNeeded"]:
        return "보유"
    return "확인 필요"


for x in items:
    x["_status"] = status(x)
    x.setdefault("spent", 0)
    if x.get("vendor") == DM and x["qtyToBuy"] > 0:
        calc = int((Decimal(x["unitPriceKRW"]) / Decimal("1.1")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if x["id"] in vat_ex and vat_ex[x["id"]] != calc:
            print("경고: VAT 별도 단가가 원본 의뢰서와 다름", x["id"], vat_ex[x["id"]], calc)
        x["vatEx"] = calc

# ---------------------------------------------------------------- 스타일
FONT = "맑은 고딕"
f_title = Font(name=FONT, size=14, bold=True)
f_sub = Font(name=FONT, size=9, color="FF595959")
f_head = Font(name=FONT, size=10, bold=True, color="FFFFFFFF")
f_body = Font(name=FONT, size=10)
f_bold = Font(name=FONT, size=10, bold=True)
f_grey = Font(name=FONT, size=10, color="FF808080")
f_link = Font(name=FONT, size=10, color="FF0563C1", underline="single")
f_sec = Font(name=FONT, size=11, bold=True, color="FFB34700")
fill_head = PatternFill("solid", fgColor="FFFF7A1A")
fill_row = PatternFill("solid", fgColor="FFFFF6EF")
fill_buy = PatternFill("solid", fgColor="FFFFE3CC")
fill_done = PatternFill("solid", fgColor="FFE2EFDA")
fill_none = PatternFill("solid", fgColor="FFF2F2F2")
fill_total = PatternFill("solid", fgColor="FFFFD9B3")
fill_input = PatternFill("solid", fgColor="FFFFFF00")
thin = Side(style="thin", color="FFD9D9D9")
border = Border(left=thin, right=thin, top=thin, bottom=thin)
wrap = Alignment(wrap_text=True, vertical="top")
center = Alignment(horizontal="center", vertical="top", wrap_text=True)
NUM = "#,##0"


def plain(v):
    if isinstance(v, str) and not v.startswith("="):
        return v.replace("**", "").replace("`", "")
    return v


def put(ws, r, c, v, font=f_body, fill=None, fmt=None, align=wrap, b=True):
    cell = ws.cell(r, c, plain(v))
    cell.font = font
    if fill:
        cell.fill = fill
    if fmt:
        cell.number_format = fmt
    cell.alignment = align
    if b:
        cell.border = border
    return cell


def header(ws, r, names):
    for i, n in enumerate(names, 1):
        put(ws, r, i, n, f_head, fill_head, align=center)


def widths(ws, ws_list):
    for i, w in enumerate(ws_list, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


wb = openpyxl.Workbook()
wb.remove(wb.active)

# ================================================================ BOM_전체
ws = wb.create_sheet("BOM_전체")
put(ws, 1, 1, f"AI 스마트 바텐더 — {V['title']} BOM (부품 전체 목록)", f_title, b=False, align=Alignment())
put(ws, 2, 1, f"팀 홍당무 · 작성 {DATE} (원본 BOM.xlsx 2026-11-06을 최신화) · 단가 = 디바이스마트 VAT 포함 판매가(빈칸 = 가격 확인 필요) · "
              "추가구매금액 = 추가구매수량 × 단가 · 지출 완료 = 이미 결제한 금액", f_sub, b=False, align=Alignment())
COLS = ["No", "ID", "분류", "부품명", "규격/모델", "필요수량", "보유수량", "추가구매수량", "단가(원)\nVAT 포함",
        "추가구매금액(원)\n=수량×단가", "상태", "지출 완료(원)", "구매처", "상품번호", "링크", "사용 위치\n(회로 기호/조립 STEP)", "비고"]
header(ws, 3, COLS)
ws.row_dimensions[3].height = 30
r0 = 4
S1 = 3 + len(cfg["spent"])
rid = {}
for i, x in enumerate(items):
    r = r0 + i
    rid[x["id"]] = r
    st = x["_status"]
    if st == "구매 필요":
        fl = fill_buy
    elif st.startswith(("주문 완료", "구매 완료")):
        fl = fill_done
    elif st.startswith(("불필요", "미사용")):
        fl = fill_none
    else:
        fl = fill_row
    fb = f_grey if st.startswith("불필요") else f_body
    vals = [i + 1, x["id"], x["category"], x["name"], x["spec"], x["qtyNeeded"], x["qtyOwned"], x["qtyToBuy"],
            x["unitPriceKRW"], f'=IF(ISNUMBER(I{r}),H{r}*I{r},"")', st,
            f'=IF(SUMIF(지출_완료!$H$4:$H${S1},B{r},지출_완료!$F$4:$F${S1})=0,"",SUMIF(지출_완료!$H$4:$H${S1},B{r},지출_완료!$F$4:$F${S1}))',
            x.get("vendor"), x.get("productNo"), "상품 페이지" if x.get("url") else None, x.get("usedIn"), x.get("note")]
    for c, v in enumerate(vals, 1):
        fmt = NUM if c in (9, 10, 12) else None
        font = f_link if c == 15 and v else (f_bold if c == 10 and x["qtyToBuy"] > 0 else fb)
        cell = put(ws, r, c, v, font, fl, fmt, center if c in (1, 2, 3, 6, 7, 8, 11) else wrap)
        if c == 15 and x.get("url"):
            cell.hyperlink = x["url"]
rl = r0 + len(items) - 1
R_TOT = rl + 1
put(ws, R_TOT, 4, "합계 (추가 구매, VAT 포함 · 가격 미확인 품목 제외)", f_bold, fill_total)
put(ws, R_TOT, 10, f"=SUM(J{r0}:J{rl})", f_bold, fill_total, NUM)
put(ws, R_TOT, 12, f"=SUM(L{r0}:L{rl})", f_bold, fill_total, NUM)
put(ws, R_TOT, 11, "지출 완료 합계 →", f_bold, fill_total)
R_DM = R_TOT + 1
put(ws, R_DM, 4, "  └ 디바이스마트 주문 합계 (VAT 포함)", f_bold)
put(ws, R_DM, 10, f'=SUMIF(M{r0}:M{rl},"{DM}",J{r0}:J{rl})', f_bold, None, NUM)
put(ws, R_DM, 11, f'=IF(J{R_DM}>=66000,"무료배송 충족(≥66,000원)","배송비 2,700원 추가(<66,000원)")', f_body)
R_ETC = R_DM + 1
put(ws, R_ETC, 4, "  └ 다이소·철물점 등 (가격 아는 품목만)", f_bold)
put(ws, R_ETC, 10, f'=SUMIF(M{r0}:M{rl},"<>{DM}",J{r0}:J{rl})', f_bold, None, NUM)
R_UNK = R_ETC + 1
put(ws, R_UNK, 4, "  └ 가격 미확인(빈칸) 추가 구매 품목 수", f_bold)
put(ws, R_UNK, 10, f'=COUNTIFS(H{r0}:H{rl},">0",I{r0}:I{rl},"")', f_bold)
unk = [x["id"] for x in items if x["qtyToBuy"] > 0 and not isinstance(x["unitPriceKRW"], (int, float))]
put(ws, R_UNK, 17, "작성 시점 목록: " + (" · ".join(unk) or "없음"), f_body)
widths(ws, [5, 6, 8, 40, 44, 8, 8, 9, 11, 14, 16, 12, 18, 11, 9, 26, 62])
ws.freeze_panes = "E4"
ws.auto_filter.ref = f"A3:Q{rl}"

# ================================================================ 추가구매_의뢰서용
wq = wb.create_sheet("추가구매_의뢰서용")
wq.merge_cells("B2:E3")
put(wq, 2, 2, "<캡스톤 물품 구매 신청>", Font(name=FONT, size=16, bold=True), align=Alignment(horizontal="center", vertical="center"), b=False)
for r, (k, v, note) in enumerate([("분반", 51, f"캡스톤디자인Ⅱ(2026/2학기) 추가분 · {V['title']} · 작성 {DATE}"),
                                   ("팀명", "홍당무", "금액 = 단가(VAT 별도). 1학기 의뢰서·정산서와 같은 기준 (디바이스마트 VAT 포함가 ÷ 1.1)"),
                                   ("팀장", "(제출 전 직접 기입)", "팀장 이름·연락처는 제출 전에 직접 기입 (공개 저장소라 비워 둠)")], start=4):
    put(wq, r, 1, k, f_bold)
    put(wq, r, 2, v)
    put(wq, r, 6, note, f_sub, b=False)
put(wq, 6, 3, "연락처", f_bold)
wq.merge_cells("D6:E6")
header(wq, 8, ["순번", "물품 이름", "상품 번호", "금액", "세부내역(수량)", "비고"])
dm = [x for x in items if x.get("vendor") == DM and x["qtyToBuy"] > 0]
etc = [x for x in items if x.get("vendor") != DM and x["qtyToBuy"] > 0]
r = 9
wq.merge_cells(f"A{r}:F{r}")
put(wq, r, 1, "【1】 디바이스마트 (devicemart.co.kr) — 학교 인터넷 구매신청", f_sec)
n = 0
q0 = r + 1
for x in dm:
    r += 1
    n += 1
    for c, v in enumerate([n, x["name"], x.get("productNo"), f"=ROUND(BOM_전체!I{rid[x['id']]}/1.1,0)", f"=BOM_전체!H{rid[x['id']]}",
                           f"{x['id']} · {x.get('reqNote') or x.get('usedIn') or ''}"], 1):
        put(wq, r, c, v, f_body, fill_row, NUM if c == 4 else None, center if c in (1, 3, 5) else wrap)
q1 = r
r += 1
R_Q_DM = r
put(wq, r, 2, "디바이스마트 소계 (VAT 별도)", f_bold, fill_total)
put(wq, r, 4, f"=SUMPRODUCT(D{q0}:D{q1},E{q0}:E{q1})", f_bold, fill_total, NUM)
put(wq, r, 6, "참고: 실제 결제 예상액(VAT 포함)은 아래 줄", f_sub)
r += 1
put(wq, r, 2, "  └ 참고: 디바이스마트 결제 예상액 (VAT 포함, BOM_전체 연동)", f_body)
put(wq, r, 4, f"=BOM_전체!J{R_DM}", f_body, None, NUM)
put(wq, r, 6, f'=IF(D{r}>=66000,"무료배송 기준 66,000원 충족","66,000원 미만 → 배송비 2,700원")', f_body)
r += 1
wq.merge_cells(f"A{r}:F{r}")
put(wq, r, 1, "【2】 다이소 · 철물점 · 기타 (다이소 품번은 참고용 · VAT 포함가 그대로 — 법인카드 또는 개인 결제 후 정산)", f_sec)
e0 = r + 1
for x in etc:
    r += 1
    n += 1
    for c, v in enumerate([n, x["name"], x.get("productNo"), f'=IF(ISNUMBER(BOM_전체!I{rid[x["id"]]}),BOM_전체!I{rid[x["id"]]},"")', f"=BOM_전체!H{rid[x['id']]}",
                           f"{x['id']} · 구매처: {x.get('vendor') or ''} · {x.get('reqNote') or x.get('usedIn') or ''}"], 1):
        put(wq, r, c, v, f_body, fill_row, NUM if c == 4 else None, center if c in (1, 3, 5) else wrap)
e1 = r
r += 1
R_Q_ETC = r
put(wq, r, 2, "다이소·철물점·기타 소계", f_bold, fill_total)
put(wq, r, 4, f"=SUMPRODUCT(D{e0}:D{e1},E{e0}:E{e1})" if etc else 0, f_bold, fill_total, NUM)
put(wq, r, 6, "가격을 알면 BOM_전체 시트의 단가 칸에 입력 → 여기와 예산이 자동으로 다시 계산 (다이소 등은 VAT 포함가 그대로)", f_sub)
r += 1
R_Q_SUM = r
wq.merge_cells(f"B{r}:C{r}")
put(wq, r, 2, "합계 (디바이스마트 VAT 별도 + 기타 VAT 포함)", f_bold, fill_total)
put(wq, r, 4, f"=D{R_Q_DM}+D{R_Q_ETC}", f_bold, fill_total, NUM)
n_unk_etc = sum(1 for x in etc if not isinstance(x["unitPriceKRW"], (int, float)))
put(wq, r, 6, f"총 {len(dm) + len(etc)}품목 (가격 미확인 {n_unk_etc}품목은 금액 미포함)", f_body)
widths(wq, [6, 52, 12, 10, 12, 60])
wq.freeze_panes = "A9"

# ================================================================ 지출_완료
we = wb.create_sheet("지출_완료")
put(we, 1, 1, "이미 결제한 것 (2학기) — 앞으로 살 금액과 따로 셉니다", f_title, b=False, align=Alignment())
put(we, 2, 1, "사용자가 알려 준 금액 그대로입니다. 영수증·거래명세서를 보관해 결과보고서 정산서에 씁니다.", f_sub, b=False, align=Alignment())
header(we, 3, ["No", "날짜", "품목", "구매처", "수량", "금액(원)", "상태", "BOM ID", "비고"])
sp = cfg["spent"]
for i, s in enumerate(sp, 1):
    r = 3 + i
    for c, v in enumerate([i, s["date"], s["name"], s["vendor"], s["qty"], s["amount"], s["status"], s.get("bomId"), s.get("note")], 1):
        put(we, r, c, v, f_body, fill_done, NUM if c == 6 else None, center if c in (1, 2, 5, 8) else wrap)
s1 = 3 + len(sp)
R_SP = s1 + 1
put(we, R_SP, 3, "지출 완료 합계", f_bold, fill_total)
put(we, R_SP, 6, f"=SUM(F4:F{s1})", f_bold, fill_total, NUM)
rf = cfg.get("refund", [])
r = R_SP + 2
put(we, r, 1, "환불 예정 (합계에 넣지 않음)", f_sec, b=False)
header(we, r + 1, ["No", "날짜", "품목", "구매처", "수량", "금액(원)", "상태", "", "비고"])
for i, s in enumerate(rf, 1):
    rr = r + 1 + i
    for c, v in enumerate([i, s["date"], s["name"], s["vendor"], s["qty"], s["amount"], s["status"], None, s.get("note")], 1):
        put(we, rr, c, v, f_body, fill_none, NUM if c == 6 else None, center if c in (1, 2, 5) else wrap)
widths(we, [5, 11, 44, 16, 10, 11, 22, 9, 60])

# ================================================================ 보유_미사용 (원본 행 + 변형 조정)
wo = wb.create_sheet("보유_미사용")
s_o = src["보유_미사용"]
put(wo, 1, 1, "보유했지만 이번 설계에서 쓰지 않거나 남는 부품", f_title, b=False, align=Alignment())
put(wo, 2, 1, "1학기 구매 단가는 물품구매의뢰서 기준(VAT 별도). 남는 수량 = 보유 − 이번 설계 사용.", f_sub, b=False, align=Alignment())
header(wo, 3, [s_o.cell(3, c).value for c in range(1, 11)])
ov = V.get("leftover", {})
rows = []
for rr in range(4, 16):
    pid = s_o.cell(rr, 2).value
    row = {"id": pid, "name": s_o.cell(rr, 3).value, "own": s_o.cell(rr, 4).value, "use": s_o.cell(rr, 5).value,
           "kind": s_o.cell(rr, 7).value, "unit": s_o.cell(rr, 8).value, "memo": s_o.cell(rr, 10).value}
    row.update(ov.get(pid, {}))
    rows.append(row)
for i, row in enumerate(rows, 1):
    rr = 3 + i
    for c, v in enumerate([i, row["id"], row["name"], row["own"], row["use"], f"=D{rr}-E{rr}", row["kind"], row["unit"], f"=F{rr}*H{rr}", row["memo"]], 1):
        put(wo, rr, c, v, f_body, fill_row, NUM if c in (8, 9) else None, center if c in (1, 2, 4, 5, 6) else wrap)
put(wo, 4 + len(rows), 3, "합계 (남는 부품의 1학기 구매 금액)", f_bold, fill_total)
put(wo, 4 + len(rows), 9, f"=SUM(I4:I{3 + len(rows)})", f_bold, fill_total, NUM)
widths(wo, [5, 6, 40, 9, 11, 9, 16, 12, 13, 70])

# ================================================================ 선택_업그레이드 (원본 그대로 복사)
wu = wb.create_sheet("선택_업그레이드")
s_u = src["선택_업그레이드"]
for row in s_u.iter_rows():
    for c in row:
        n_ = wu.cell(c.row, c.column, c.value)
        if c.has_style:
            n_.font = copy.copy(c.font)
            n_.fill = copy.copy(c.fill)
            n_.border = copy.copy(c.border)
            n_.alignment = copy.copy(c.alignment)
            n_.number_format = c.number_format
        if c.hyperlink:
            n_.hyperlink = c.hyperlink.target
for k, d in s_u.column_dimensions.items():
    wu.column_dimensions[k].width = d.width
for k, d in s_u.row_dimensions.items():
    if d.height:
        wu.row_dimensions[k].height = d.height
for m in s_u.merged_cells.ranges:
    wu.merge_cells(str(m))
wu.freeze_panes = s_u.freeze_panes

# ================================================================ 예산
wbud = wb.create_sheet("예산")
put(wbud, 1, 1, f"예산 — 1학기 집행 · 2학기 지출 완료 · 앞으로 살 것 · 재원 대비 ({V['title']})", f_title, b=False, align=Alignment())
put(wbud, 2, 1, f"작성 {DATE}. 노란 칸은 확인한 값으로 고치는 칸입니다(고치면 아래 판단이 자동으로 다시 계산됨). "
                "2학기 금액은 VAT 포함(보수적).", f_sub, b=False, align=Alignment())
s_b = src["예산"]
r = 4
put(wbud, r, 1, "A. 1학기(캡스톤디자인Ⅰ) 실습비 집행 — 결과보고서 정산서 기준", f_sec, b=False)
r += 1
header(wbud, r, ["항목", "금액(원)", "", "", "비고"])
for k in range(6, 11):
    r += 1
    a, bv, e = s_b.cell(k, 1).value, s_b.cell(k, 2).value, s_b.cell(k, 5).value
    put(wbud, r, 1, a)
    put(wbud, r, 2, bv, f_bold if k >= 9 else f_body, None, NUM)
    put(wbud, r, 5, e)
# 원본 수식이 B7:B8, B6-B9를 가리키므로 행 번호를 맞춰 다시 쓴다
put(wbud, 9, 2, "=SUM(B7:B8)", f_bold, None, NUM)
put(wbud, 10, 2, "=B6-B9", f_bold, None, NUM)
r = 12
put(wbud, r, 1, "B. 2학기 — 이미 결제한 것", f_sec, b=False)
r += 1
header(wbud, r, ["항목", "VAT 포함(원)", "", "", "비고"])
r += 1
R_B_SP = r
put(wbud, r, 1, "지출 완료 합계 (지출_완료 시트)")
put(wbud, r, 2, f"=지출_완료!F{R_SP}", f_bold, None, NUM)
put(wbud, r, 5, " · ".join(f"{s['name']} {s['amount']:,}원" for s in sp))
r += 2
put(wbud, r, 1, "C. 2학기 — 앞으로 살 것 (이 BOM)", f_sec, b=False)
r += 1
header(wbud, r, ["항목", "VAT 포함(원)", "VAT 별도(원)", "", "비고"])
r += 1
R_C1 = r
put(wbud, r, 1, f"① 디바이스마트 ({len(dm)}품목)")
put(wbud, r, 2, f"=BOM_전체!J{R_DM}", f_body, None, NUM)
put(wbud, r, 3, f"=추가구매_의뢰서용!D{R_Q_DM}", f_body, None, NUM)
put(wbud, r, 5, "무료배송 기준 66,000원(VAT 포함)")
r += 1
R_C2 = r
put(wbud, r, 1, f"② 다이소·철물점·기타 ({len(etc)}품목, 가격 아는 것만)")
put(wbud, r, 2, f"=BOM_전체!J{R_ETC}", f_body, None, NUM)
put(wbud, r, 3, f"=추가구매_의뢰서용!D{R_Q_ETC}", f_body, None, NUM)
put(wbud, r, 5, "다이소 등은 VAT 포함가 그대로(C열에도). 작성 시점 가격 미확인: " + (" · ".join(x["id"] for x in etc if not isinstance(x["unitPriceKRW"], (int, float))) or "없음"))
r += 1
R_C = r
put(wbud, r, 1, "앞으로 살 것 합계 (①+②)", f_bold, fill_total)
put(wbud, r, 2, f"=B{R_C1}+B{R_C2}", f_bold, fill_total, NUM)
put(wbud, r, 3, f"=C{R_C1}+C{R_C2}", f_bold, fill_total, NUM)
r += 1
R_ALL = r
put(wbud, r, 1, "2학기 전체 (B 지출 완료 + C 앞으로 살 것)", f_bold, fill_total)
put(wbud, r, 2, f"=B{R_B_SP}+B{R_C}", f_bold, fill_total, NUM)
put(wbud, r, 5, "선택 구매(③④⑤)와 공구 구매는 넣지 않음")
r += 1
put(wbud, r, 1, "③ 선택 업그레이드 (선택_업그레이드 시트)")
put(wbud, r, 2, "=선택_업그레이드!H11", f_body, None, NUM)
put(wbud, r, 5, "로드셀+HX711·연동펌프×4·MOSFET 보드 등. 5V 10A SMPS 가격 미포함")
r += 1
put(wbud, r, 1, "④ 선택: 시음 전 교체용 (식품용 튜브·체크밸브)")
put(wbud, r, 2, "=선택_업그레이드!H20", f_body, None, NUM)
put(wbud, r, 5, "팀원 시음(조립가이드 1.3 조건)을 할 때만 구매. 가격 확인 필요")
r += 1
put(wbud, r, 1, "⑤ 선택: 조립 방식 선택 (M3×15 볼트·자석 캐치 추가)")
put(wbud, r, 2, "=선택_업그레이드!H21", f_body, None, NUM)
put(wbud, r, 5, "기본(벨크로 P64·상판 캡티브 너트)이면 0원")
for extra in V.get("budget_extra", []):
    r += 1
    put(wbud, r, 1, extra["label"])
    put(wbud, r, 2, extra["amount"], f_body, None, NUM)
    put(wbud, r, 5, extra["note"])
r += 2
put(wbud, r, 1, "D. 재원 대비 — 2학기 부품비로 쓸 수 있는 돈 (모두 확인 필요)", f_sec, b=False)
r += 1
header(wbud, r, ["재원", "금액(원)", "상태", "", "비고"])
r += 1
R_F0 = r
put(wbud, r, 1, "1학기 실습비 잔액 (2학기로 이월될 때만)")
put(wbud, r, 2, "=B10", f_body, fill_input, NUM)
put(wbud, r, 3, "이월 여부 확인 필요")
put(wbud, r, 5, "위 A의 집행 잔액. 2학기로 넘어오지 않으면 0으로 바꾸세요.")
r += 1
put(wbud, r, 1, "경진대회 예선 참가 지원금 (팀당)")
put(wbud, r, 2, 50000, f_body, fill_input, NUM)
put(wbud, r, 3, "수령 여부·사용 기한 확인 필요")
put(wbud, r, 5, s_b.cell(24, 5).value)
r += 1
R_F2 = r
put(wbud, r, 1, "캡스톤디자인Ⅱ 실습비 (2학기)")
put(wbud, r, 2, None, f_body, fill_input, NUM)
put(wbud, r, 3, "금액 확인 필요")
put(wbud, r, 5, "1학기(캡스톤디자인Ⅰ)는 200,000원이었음. 금액을 알면 B칸에 입력")
r += 1
R_F = r
put(wbud, r, 1, "재원 합계 (입력된 금액만)", f_bold, fill_total)
put(wbud, r, 2, f"=SUM(B{R_F0}:B{R_F2})", f_bold, fill_total, NUM)
put(wbud, r, 3, f'=IF(B{R_F2}="","실습비 미입력","실습비 포함")', f_body)
r += 2
header(wbud, r, ["판단", "금액(원)", "재원 합계 − 금액", "", "판단 (음수 = 부족)"])
r += 1
put(wbud, r, 1, "2학기 전체 (지출 완료 + 앞으로 살 것)")
put(wbud, r, 2, f"=B{R_ALL}", f_body, None, NUM)
put(wbud, r, 3, f"=B{R_F}-B{r}", f_body, None, NUM)
put(wbud, r, 5, f'=IF(C{r}>=0,"재원 합계 안에서 가능","재원 합계 초과 → 실습비 확인 필요")')
r += 1
put(wbud, r, 1, "앞으로 살 것만 (이미 결제한 돈은 개인·다른 재원으로 냈을 때)")
put(wbud, r, 2, f"=B{R_C}", f_body, None, NUM)
put(wbud, r, 3, f"=B{R_F}-B{r}", f_body, None, NUM)
put(wbud, r, 5, f'=IF(C{r}>=0,"재원 합계 안에서 가능","재원 합계 초과")')
widths(wbud, [52, 14, 18, 4, 90])

# ================================================================ 요약 (맨 앞)
wsum = wb.create_sheet("요약", 0)
put(wsum, 1, 1, f"BOM — {V['title']} · 사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커", f_title, b=False, align=Alignment())
put(wsum, 2, 1, f"팀 홍당무 · 작성 {DATE} · 원본 BOM.xlsx(2026-11-06)를 최신화. 다른 기준은 `{cfg['variants'][[k for k in cfg['variants'] if k != VAR][0]]['file']}.xlsx`", f_sub, b=False, align=Alignment())
r = 4
put(wsum, r, 1, "이 BOM은", f_sec, b=False)
for line in V["desc"]:
    r += 1
    put(wsum, r, 1, "• " + line, f_body, b=False)
r += 2
put(wsum, r, 1, "한눈에 보기", f_sec, b=False)
r += 1
header(wsum, r, ["항목", "금액(원)", "비고"])
summary_rows = [
    ("앞으로 살 것 ① 디바이스마트 (VAT 포함)", f"=BOM_전체!J{R_DM}", f"=BOM_전체!K{R_DM}"),
    ("  └ 학교 의뢰서 금액 (VAT 별도)", f"=추가구매_의뢰서용!D{R_Q_DM}", "의뢰서에는 VAT 별도 단가를 적음"),
    ("앞으로 살 것 ② 다이소·철물점·기타 (가격 아는 것만)", f"=BOM_전체!J{R_ETC}", "작성 시점 가격 미확인: " + (" · ".join(x["id"] for x in etc if not isinstance(x["unitPriceKRW"], (int, float))) or "없음")),
    ("앞으로 살 것 합계 (①+②)", f"=예산!B{R_C}", ""),
    ("이미 결제한 것 (지출_완료 시트)", f"=지출_완료!F{R_SP}", " · ".join(f"{s['name']}" for s in sp) + " (3D 프린팅은 견적 금액)"),
    ("2학기 전체 (이미 결제 + 앞으로)", f"=예산!B{R_ALL}", "선택 구매·공구 구매 제외"),
    ("환불 예정 (합계 미포함)", f"=SUM(지출_완료!F{R_SP + 4}:F{R_SP + 3 + max(1, len(rf))})", " · ".join(s["name"] for s in rf)),
]
for lab, val, note in summary_rows:
    r += 1
    put(wsum, r, 1, lab, f_bold if "합계" in lab or "전체" in lab else f_body)
    put(wsum, r, 2, val, f_bold, None, NUM)
    put(wsum, r, 3, note)
r += 2
put(wsum, r, 1, "원본 BOM(2026-11-06)에서 바뀐 점", f_sec, b=False)
for line in cfg["common"]["changelog"] + V.get("changelog", []):
    r += 1
    put(wsum, r, 1, "• " + line, f_body, b=False)
if V.get("joints"):
    r += 2
    put(wsum, r, 1, V["joints_title"], f_sec, b=False)
    r += 1
    header(wsum, r, ["접속·작업", "쓰는 부품 · 공구", "방법"])
    for j in V["joints"]:
        r += 1
        put(wsum, r, 1, j[0])
        put(wsum, r, 2, j[2])
        put(wsum, r, 3, j[1])
r += 2
put(wsum, r, 1, "확인할 것", f_sec, b=False)
for line in cfg["common"]["todo"] + V.get("todo", []):
    r += 1
    put(wsum, r, 1, "• " + line, f_body, b=False)
widths(wsum, [46, 34, 100])
for row in wsum.iter_rows(min_row=4, max_row=r):
    for c in row:
        if c.column == 1 and isinstance(c.value, str) and c.value.startswith("• "):
            wsum.merge_cells(start_row=c.row, start_column=1, end_row=c.row, end_column=3)
            c.alignment = Alignment(wrap_text=True, vertical="top")
            wsum.row_dimensions[c.row].height = 15 * max(1, (len(c.value) // 95) + 1)

wb.save(OUT_BASE + ".xlsx")

# ================================================================ md
def won(v):
    return f"{v:,}" if isinstance(v, (int, float)) else ""


dm_inc = sum(x["qtyToBuy"] * x["unitPriceKRW"] for x in dm if isinstance(x["unitPriceKRW"], (int, float)))
dm_ex = sum(x["qtyToBuy"] * x["vatEx"] for x in dm if isinstance(x.get("vatEx"), (int, float)))
etc_known = sum(x["qtyToBuy"] * x["unitPriceKRW"] for x in etc if isinstance(x["unitPriceKRW"], (int, float)))
spent_sum = sum(s["amount"] for s in sp)
L = []
A = L.append
other = cfg["variants"][[k for k in cfg["variants"] if k != VAR][0]]["file"]
A(f"# BOM — {V['title']} · 사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커")
A("")
A(f"> 팀 홍당무 · 작성 {DATE} · 원본 [`BOM.md`](BOM.md)(2026-11-06)를 최신화한 판입니다. 다른 기준은 [`{other}.md`]({other}.md).")
A(f"> 엑셀: `{V['file']}.xlsx` (시트: 요약 / BOM_전체 / 추가구매_의뢰서용 / 지출_완료 / 보유_미사용 / 선택_업그레이드 / 예산). 이 문서와 엑셀은 같은 스크립트로 만들어 숫자가 같습니다.")
A("")
A("## 0. 한눈에 보기")
A("")
for line in V["desc"]:
    A(f"- {line}")
A(f"- **앞으로 살 것 ① 디바이스마트 {len(dm)}품목: {dm_inc:,}원 (VAT 포함)** / 학교 의뢰서 금액 {dm_ex:,}원 (VAT 별도). "
  + ("무료배송 기준(66,000원)을 넘습니다." if dm_inc >= 66000 else "무료배송 기준(66,000원)에 못 미쳐 배송비 2,700원이 붙습니다."))
unk_ids = [x["id"] for x in etc if not isinstance(x["unitPriceKRW"], (int, float))]
A(f"- **앞으로 살 것 ② 다이소·철물점·기타 {len(etc)}품목: {etc_known:,}원** (가격 아는 것만" + (f", 가격 미확인 {', '.join(unk_ids)}" if unk_ids else "") + ")")
A(f"- **이미 결제한 것: {spent_sum:,}원** — " + " · ".join(f"{s['name']} {s['amount']:,}원" for s in sp) + " (3D 프린팅은 견적 금액, 최종 결제액 확인 필요)")
if rf:
    A("- 환불 예정(합계 미포함): " + " · ".join(f"{s['name']} {s['amount']:,}원 ({s['status']})" for s in rf))
A(f"- 2학기 전체(이미 결제 + 앞으로 살 것): **{spent_sum + dm_inc + etc_known:,}원** (선택 구매·공구 구매·가격 미확인 품목 제외)")
A("")
A("## 1. 원본 BOM에서 바뀐 점")
A("")
for line in cfg["common"]["changelog"] + V.get("changelog", []):
    A(f"- {line}")
A("")
if V.get("joints"):
    A(f"## 2. {V['joints_title']}")
    A("")
    A("| 접속·작업 | 방법 | 쓰는 부품 · 공구 |")
    A("|---|---|---|")
    for j in V["joints"]:
        A(f"| {j[0]} | {j[1]} | {j[2]} |")
    A("")
sec = 3 if V.get("joints") else 2
A(f"## {sec}. 전체 BOM ({len(items)}개 항목, 분류별)")
A("")
A("구매 = 추가로 사야 할 수량, 금액 = 구매 × 단가(VAT 포함). 상태: 구매 필요 · 보유 · 주문 완료 · 구매 완료 · 학교 대여 · 불필요 · 선택 · 미사용.")
A("")
for cat in CAT_ORDER:
    g = [x for x in items if x["category"] == cat]
    if not g:
        continue
    sub = sum(x["qtyToBuy"] * x["unitPriceKRW"] for x in g if isinstance(x["unitPriceKRW"], (int, float)))
    A(f"### {cat} ({len(g)}개 · 추가 구매 {sub:,}원)")
    A("")
    A("| ID | 부품명 | 규격/모델 | 필요 | 보유 | 구매 | 단가(원) | 금액(원) | 상태 | 구매처 · 상품번호 | 사용 위치 | 비고 |")
    A("|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|")
    for x in g:
        amt = x["qtyToBuy"] * x["unitPriceKRW"] if isinstance(x["unitPriceKRW"], (int, float)) else ""
        link = f"[{x['productNo']}]({x['url']})" if x.get("productNo") and x.get("url") else (f"[상품 페이지]({x['url']})" if x.get("url") else "")
        st = x["_status"] + (f" · 지출 {x['spent']:,}원" if x.get("spent") else "")
        cells = [x["id"], x["name"], x["spec"], x["qtyNeeded"], x["qtyOwned"], x["qtyToBuy"], won(x["unitPriceKRW"]), won(amt),
                 st, f"{x.get('vendor') or ''} · {link}".strip(" ·"), x.get("usedIn") or "", (x.get("note") or "").replace("\n", " ")]
        A("| " + " | ".join(str(c).replace("|", "\\|") for c in cells) + " |")
    A("")
sec += 1
A(f"## {sec}. 추가 구매 목록 (구매처별)")
A("")
A(f"### {sec}.1 디바이스마트: {len(dm)}품목, 합계 {dm_inc:,}원 (VAT 포함) / {dm_ex:,}원 (VAT 별도)")
A("")
A("학교 물품구매의뢰서에는 **VAT 별도 단가**를 적습니다. 엑셀 `추가구매_의뢰서용` 시트를 그대로 옮겨 쓰면 됩니다.")
A("")
A("| 순번 | ID | 물품 이름 | 상품 번호 | 수량 | 단가 VAT 별도 | 소계 VAT 별도 | 단가 VAT 포함 | 소계 VAT 포함 | 비고 |")
A("|---:|---|---|---|---:|---:|---:|---:|---:|---|")
for i, x in enumerate(dm, 1):
    A(f"| {i} | {x['id']} | {x['name']} | [{x['productNo']}]({x['url']}) | {x['qtyToBuy']} | {won(x.get('vatEx'))} | {won(x['qtyToBuy'] * x['vatEx'])} | "
      f"{won(x['unitPriceKRW'])} | {won(x['qtyToBuy'] * x['unitPriceKRW'])} | {x.get('reqNote') or x.get('usedIn') or ''} |")
A(f"| | | **합계** | | | | **{dm_ex:,}** | | **{dm_inc:,}** | |")
A("")
A(f"### {sec}.2 다이소 · 철물점 · 기타: {len(etc)}품목")
A("")
A("| 순번 | ID | 물품 | 수량 | 단가(원) | 구매처 | 고르는 기준 · 메모 |")
A("|---:|---|---|---:|---:|---|---|")
for i, x in enumerate(etc, len(dm) + 1):
    link = f" ([링크]({x['url']}))" if x.get("url") else ""
    A(f"| {i} | {x['id']} | {x['name']} | {x['qtyToBuy']} | {won(x['unitPriceKRW']) or '확인 필요'} | {x.get('vendor') or ''}{link} | {(x.get('reqNote') or x.get('note') or '').replace(chr(10), ' ')} |")
A("")
sec += 1
A(f"## {sec}. 이미 결제한 것 (2학기)")
A("")
A("| 날짜 | 품목 | 구매처 | 수량 | 금액(원) | 상태 | 비고 |")
A("|---|---|---|---|---:|---|---|")
for s in sp:
    A(f"| {s['date']} | {s['name']} | {s['vendor']} | {s['qty']} | {s['amount']:,} | {s['status']} | {s.get('note') or ''} |")
A(f"| | **합계** | | | **{spent_sum:,}** | | |")
for s in rf:
    A(f"| {s['date']} | ~~{s['name']}~~ | {s['vendor']} | {s['qty']} | ({s['amount']:,}) | {s['status']} | {s.get('note') or ''} (합계 미포함) |")
A("")
sec += 1
A(f"## {sec}. 예산 요약")
A("")
A("| 구분 | 금액(원) | 비고 |")
A("|---|---:|---|")
A("| 1학기 실습비 지원 / 집행 / 잔액 | 200,000 / 161,400 / 38,600 | 결과보고서 정산서 기준. 잔액 이월 여부 확인 필요 |")
A("| 경진대회 예선 참가 지원금 | 50,000 | 받았는지·사용 기한 확인 필요 |")
A("| 캡스톤디자인Ⅱ 실습비 | 확인 필요 | 1학기는 200,000원 |")
A(f"| 2학기 이미 결제 | {spent_sum:,} | " + " · ".join(s["name"] for s in sp) + " |")
A(f"| 2학기 앞으로 ① 디바이스마트 | {dm_inc:,} | VAT 포함 (VAT 별도 {dm_ex:,}) |")
A(f"| 2학기 앞으로 ② 다이소·철물점·기타 | {etc_known:,} | 가격 미확인 품목 제외 |")
A(f"| **2학기 전체** | **{spent_sum + dm_inc + etc_known:,}** | 선택 구매·공구 구매 제외 |")
for extra in V.get("budget_extra", []):
    A(f"| {extra['label']} | {won(extra['amount'])} | {extra['note']} |")
A("")
A("엑셀 `예산` 시트의 노란 칸(재원)을 확인한 값으로 고치면 판단이 자동으로 다시 계산됩니다. 선택 업그레이드(로드셀·연동펌프 등)는 원본 `BOM.md` 4장과 같고 엑셀 `선택_업그레이드` 시트에 그대로 있습니다.")
A("")
sec += 1
A(f"## {sec}. 확인할 것")
A("")
for line in cfg["common"]["todo"] + V.get("todo", []):
    A(f"- {line}")
A("")
A("---")
A(f"*이 문서와 `{V['file']}.xlsx`는 `research/canonical_bom.json`과 `BOM.xlsx`(2026-11-06)를 원본으로 `research/make_boms.py`(설정 `research/bom_variants.json`)가 만들었습니다. 엑셀에서 수량이나 단가 칸만 고쳐도 금액·합계·예산이 자동으로 다시 계산됩니다.*")
open(OUT_BASE + ".md", "w", encoding="utf-8", newline="\n").write("\n".join(L) + "\n")
print("saved", OUT_BASE, "items", len(items), "dm", len(dm), dm_inc, dm_ex, "etc", len(etc), etc_known, "spent", spent_sum)
