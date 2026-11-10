# -*- coding: utf-8 -*-
"""납땜 기준 / 무납땜 기준 BOM 두 벌을 만든다 (xlsx + md).

사용: python make_boms.py bom_variants.json solder|nosolder
그다음(선택) Excel로 재계산해 캐시 값을 넣으려면 recalc_excel.ps1, 공개 전에는 반드시 scrub_xlsx.py(작성자·경로 지우기)
- 원본: hardware/research/canonical_bom.json (69항목) + hardware/research/BOM_원본_20261106.xlsx (VAT 별도 단가·선택_업그레이드·보유_미사용·1학기 예산 값)
- 공통 부분(데이터·서식·주문 링크 시트)은 bom_data.py, 두 기준을 한 표로 비교한 통합판 BOM.xlsx/BOM.md는 make_bom_master.py
- config.json: 공통 변경(출력 부품·지출 완료·용기)과 변형별 변경
"""
import json
import os
import sys

sys.dont_write_bytecode = True
import openpyxl
from openpyxl.styles import Alignment, Font

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bom_data import (HW, SRC_XLSX, SRC_MD_REL, DM, CAT_ORDER, FONT, load_cfg, build_items, vendor_group, order_sheet, copy_sheet,  # noqa: E402
                      ledger, orders, plan_diff, bought_in, purchase_total, line_amount, unit_inc,
                      f_title, f_sub, f_head, f_body, f_bold, f_grey, f_link, f_sec, fill_head, fill_row, fill_buy,
                      fill_done, fill_none, fill_total, fill_input, border, wrap, center, NUM, put, header, widths)

cfg = load_cfg(sys.argv[1])
VAR = sys.argv[2]
V = cfg["variants"][VAR]
OUT_BASE = os.path.join(HW, V["file"])
DATE = cfg["date"]
src = openpyxl.load_workbook(SRC_XLSX)
items = build_items(cfg, VAR, src)
LED = ledger(cfg)          # 지출 장부(부품 줄까지 펼침) — 지출_완료 시트·SUMIF
OD = orders(cfg)           # 주문 단위 요약 — 요약·예산·md 문장
byid_items = {x["id"]: x for x in items}
DM_SHIP, DM_FREE = 2700, 66000   # 디바이스마트 기본 배송비·무료배송 기준(2026-11 조사값)

wb = openpyxl.Workbook()
wb.remove(wb.active)

# ================================================================ BOM_전체
ws = wb.create_sheet("BOM_전체")
put(ws, 1, 1, f"AI 스마트 바텐더 — {V['title']} BOM (부품 전체 목록)", f_title, b=False, align=Alignment())
put(ws, 2, 1, f"팀 홍당무 · 작성 {DATE} (원본 BOM 2026-11-06 — research/BOM_원본_20261106.xlsx — 을 최신화) · 단가 = 디바이스마트 VAT 포함 판매가(빈칸 = 가격 확인 필요) · "
              "추가구매금액 = 추가구매수량 × 단가 · 지출 완료 = 이미 결제한 금액", f_sub, b=False, align=Alignment())
COLS = ["No", "ID", "분류", "부품명", "규격/모델", "필요수량", "보유수량", "추가구매수량", "단가(원)\nVAT 포함",
        "추가구매금액(원)\n=수량×단가", "상태", "지출 완료(원)", "구매처", "상품번호", "링크", "사용 위치\n(회로 기호/조립 STEP)", "비고"]
header(ws, 3, COLS)
ws.row_dimensions[3].height = 30
r0 = 4
S1 = 3 + len(LED)
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
put(ws, R_TOT, 11, "부품별 지출 합계 →", f_bold, fill_total)
R_DM = R_TOT + 1
put(ws, R_DM, 4, "  └ 디바이스마트 주문 합계 (VAT 포함)", f_bold)
put(ws, R_DM, 10, f'=SUMIF(M{r0}:M{rl},"{DM}",J{r0}:J{rl})', f_bold, None, NUM)
put(ws, R_DM, 11, f'=IF(J{R_DM}=0,"더 살 것 없음",IF(J{R_DM}>=66000,"무료배송 충족(≥66,000원)","배송비 2,700원 추가(<66,000원)"))', f_body)
R_ETC = R_DM + 1
put(ws, R_ETC, 4, "  └ 다이소·철물점 등 (가격 아는 품목만)", f_bold)
put(ws, R_ETC, 10, f'=SUMIF(M{r0}:M{rl},"<>{DM}",J{r0}:J{rl})', f_bold, None, NUM)
put(ws, R_ETC, 11, "전체 지출 (배송비·이 기준에 없는 부품 포함) →", f_bold, fill_total)
put(ws, R_ETC, 12, f"=지출_완료!F{S1 + 1}", f_bold, fill_total, NUM)
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
if not dm:
    r += 1
    wq.merge_cells(f"A{r}:F{r}")
    put(wq, r, 1, "더 살 디바이스마트 부품 없음 — 이미 산 내역은 '지출_완료' 시트(부품별 · 거래명세서 금액)", f_body, fill_done)
q1 = r
r += 1
R_Q_DM = r
put(wq, r, 2, "디바이스마트 소계 (VAT 별도)", f_bold, fill_total)
put(wq, r, 4, f"=SUMPRODUCT(D{q0}:D{q1},E{q0}:E{q1})" if dm else 0, f_bold, fill_total, NUM)
put(wq, r, 6, "참고: 실제 결제 예상액(VAT 포함)은 아래 줄", f_sub)
r += 1
put(wq, r, 2, "  └ 참고: 디바이스마트 결제 예상액 (VAT 포함, BOM_전체 연동)", f_body)
put(wq, r, 4, f"=BOM_전체!J{R_DM}", f_body, None, NUM)
put(wq, r, 6, f'=IF(D{r}=0,"",IF(D{r}>=66000,"무료배송 기준 66,000원 충족","66,000원 미만 → 배송비 2,700원"))', f_body)
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
if not etc:
    r += 1
    wq.merge_cells(f"A{r}:F{r}")
    put(wq, r, 1, "더 살 다이소·기타 물건 없음 — 이미 산 내역은 '지출_완료' 시트", f_body, fill_done)
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
put(we, 2, 1, "금액은 VAT 포함 결제액. 디바이스마트는 거래명세서(VAT 별도 단가 × 1.1), 나머지는 알려 준 금액입니다. 영수증·거래명세서를 보관해 결과보고서 정산서에 씁니다.", f_sub, b=False, align=Alignment())
header(we, 3, ["No", "날짜", "품목", "구매처", "수량", "금액(원)", "상태", "BOM ID", "비고"])
sp = LED
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
copy_sheet(src["선택_업그레이드"], wu)

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
put(wbud, r, 5, " · ".join(f"{s['name']} {s['amount']:,}원" for s in OD))
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
R_CS = r
put(wbud, r, 1, "  └ 디바이스마트 배송비 (주문액 66,000원 미만일 때)")
put(wbud, r, 2, f"=IF(AND(B{R_C1}>0,B{R_C1}<{DM_FREE}),{DM_SHIP},0)", f_body, None, NUM)
put(wbud, r, 5, f"{DM_SHIP:,}원(조사값, VAT 포함) — 11-11 주문은 무료배송이었고 CG0731만 따로 3,000원이 붙었음")
r += 1
R_C2 = r
put(wbud, r, 1, f"② 다이소·철물점·기타 ({len(etc)}품목, 가격 아는 것만)")
put(wbud, r, 2, f"=BOM_전체!J{R_ETC}", f_body, None, NUM)
put(wbud, r, 3, f"=추가구매_의뢰서용!D{R_Q_ETC}", f_body, None, NUM)
put(wbud, r, 5, "다이소 등은 VAT 포함가 그대로(C열에도). 작성 시점 가격 미확인: " + (" · ".join(x["id"] for x in etc if not isinstance(x["unitPriceKRW"], (int, float))) or "없음"))
r += 1
R_C = r
put(wbud, r, 1, "앞으로 살 것 합계 (① + 배송비 + ②)", f_bold, fill_total)
put(wbud, r, 2, f"=B{R_C1}+B{R_CS}+B{R_C2}", f_bold, fill_total, NUM)
put(wbud, r, 3, f"=C{R_C1}+C{R_C2}", f_bold, fill_total, NUM)
put(wbud, r, 5, "VAT 별도(C열)는 학교 의뢰서 기준이라 배송비를 넣지 않음")
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

# ================================================================ 주문_링크 (요약 다음)
def _memo(x):
    t = x.get("reqNote") if x.get("vendor") == DM else (x.get("note") or x.get("reqNote"))
    return " ".join((t or x.get("usedIn") or "").split())


buy = [x for x in items if x["qtyToBuy"] > 0]
grp = []
for gname in (DM + " (devicemart.co.kr — 학교 인터넷 구매신청)", "다이소 (daisomall.co.kr — 매장 픽업 또는 택배)", "기타 (편의점 등)"):
    key = gname.split(" ")[0]
    rows = [(x, {"price": f"=BOM_전체!I{rid[x['id']]}", "q": f"=BOM_전체!H{rid[x['id']]}", "memo": _memo(x)})
            for x in buy if vendor_group(x) == key]
    grp.append((gname, rows))
done = []
for p in cfg.get("purchases", []):
    rows = [(x, {"check": f"☑ {p['date']}", "price": bought_in(x, p["title"])["unitInc"], "q": bought_in(x, p["title"])["qty"], "memo": plan_diff(x, p["title"])})
            for x in items if bought_in(x, p["title"])]
    other_n = sum(1 for ln in p["lines"] if ln["id"] not in byid_items)
    done.append((f"☑ 이미 산 것 — {p['title']} · {p['status']}" + (f" · 이 기준에 없는 {other_n}품목은 지출_완료 시트에만" if other_n else ""), rows))
order_sheet(wb, f"주문 링크 — {V['title']} (앞으로 살 것 {len(buy)}품목)",
            "링크를 누르면 상품 페이지가 열립니다. 수량·단가는 BOM_전체 시트와 연동됩니다. 주문하면 '주문함' 칸의 ☐를 ✔ 또는 날짜로 바꾸세요. "
            "디바이스마트 링크·가격은 2026-11-06~10 조사 기준이라 주문 전에 품절·가격을 다시 확인하세요. 학교 의뢰서는 '추가구매_의뢰서용' 시트. "
            "아래 '이미 산 것'은 실제 구매 수량·단가(VAT 포함)와 BOM 계획 대비 차이입니다. 디바이스마트 주문액이 66,000원 미만이면 배송비 2,700원(조사값)이 따로 붙습니다(예산 시트에 포함).",
            grp, [("수량", "q", "금액(원)")], index=0, done=done,
            empty_note="앞으로 살 부품이 없습니다 — 이 기준의 부품은 모두 샀습니다(아래 '이미 산 것' · 부품별 결제액은 지출_완료 시트).")

# ================================================================ 요약 (맨 앞)
wsum = wb.create_sheet("요약", 0)
put(wsum, 1, 1, f"BOM — {V['title']} · 사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커", f_title, b=False, align=Alignment())
put(wsum, 2, 1, f"팀 홍당무 · 작성 {DATE} · 원본 BOM(2026-11-06, research 폴더 보관)을 최신화. 두 기준을 한 표로 비교한 통합판은 BOM.xlsx. 다른 기준은 `{cfg['variants'][[k for k in cfg['variants'] if k != VAR][0]]['file']}.xlsx`", f_sub, b=False, align=Alignment())
r = 4
put(wsum, r, 1, "이 BOM은", f_sec, b=False)
for line in V["desc"] + ["**주문할 때는 '주문_링크' 시트**를 보세요 — 앞으로 살 부품을 구매처별로 모았고(이미 산 것은 아래 '☑ 이미 산 것' 구획), 링크를 누르면 상품 페이지가 열립니다."]:
    r += 1
    put(wsum, r, 1, "• " + line, f_body, b=False)
r += 2
put(wsum, r, 1, "한눈에 보기", f_sec, b=False)
r += 1
header(wsum, r, ["항목", "금액(원)", "비고"])
summary_rows = [
    ("앞으로 살 것 ① 디바이스마트 (VAT 포함)", f"=BOM_전체!J{R_DM}", f"=BOM_전체!K{R_DM}"),
    ("  └ 학교 의뢰서 금액 (VAT 별도)", f"=추가구매_의뢰서용!D{R_Q_DM}", "의뢰서에는 VAT 별도 단가를 적음"),
    ("  └ 디바이스마트 배송비 (66,000원 미만일 때)", f"=예산!B{R_CS}", "2,700원(조사값, VAT 포함)"),
    ("앞으로 살 것 ② 다이소·철물점·기타 (가격 아는 것만)", f"=BOM_전체!J{R_ETC}", "작성 시점 가격 미확인: " + (" · ".join(x["id"] for x in etc if not isinstance(x["unitPriceKRW"], (int, float))) or "없음")),
    ("앞으로 살 것 합계 (① + 배송비 + ②)", f"=예산!B{R_C}", "디바이스마트 주문액이 66,000원 미만이면 배송비 2,700원 포함"),
    ("이미 결제한 것 (지출_완료 시트)", f"=지출_완료!F{R_SP}", " · ".join(f"{s['name']}" for s in OD)),
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
spent_sum = sum(s["amount"] for s in OD)
dm_ship = DM_SHIP if 0 < dm_inc < DM_FREE else 0
future = dm_inc + dm_ship + etc_known
assert spent_sum == sum(s["amount"] for s in LED), "주문 요약과 지출 장부 합계가 다름"
L = []
A = L.append
other = cfg["variants"][[k for k in cfg["variants"] if k != VAR][0]]["file"]
A(f"# BOM — {V['title']} · 사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커")
A("")
A(f"> 팀 홍당무 · 작성 {DATE} · 원본 [`{SRC_MD_REL}`]({SRC_MD_REL})(2026-11-06)를 최신화한 판입니다. 다른 기준은 [`{other}.md`]({other}.md), 두 기준을 한 표로 비교한 통합판은 [`BOM.md`](BOM.md).")
A(f"> 엑셀: `{V['file']}.xlsx` (시트: 요약 / 주문_링크 / BOM_전체 / 추가구매_의뢰서용 / 지출_완료 / 보유_미사용 / 선택_업그레이드 / 예산). 이 문서와 엑셀은 같은 스크립트로 만들어 숫자가 같습니다.")
A("")
A("## 0. 한눈에 보기")
A("")
for line in V["desc"]:
    A(f"- {line}")
if dm:
    A(f"- **앞으로 살 것 ① 디바이스마트 {len(dm)}품목: {dm_inc:,}원 (VAT 포함)** / 학교 의뢰서 금액 {dm_ex:,}원 (VAT 별도). "
      + ("무료배송 기준(66,000원)을 넘습니다." if dm_inc >= DM_FREE else f"무료배송 기준(66,000원)에 못 미쳐 배송비 {DM_SHIP:,}원이 붙습니다(아래 합계에 포함)."))
else:
    A("- **앞으로 살 것 ① 디바이스마트: 없음** (이 기준의 디바이스마트 부품은 모두 샀습니다 — 아래 '이미 결제한 것')")
unk_ids = [x["id"] for x in etc if not isinstance(x["unitPriceKRW"], (int, float))]
if etc:
    A(f"- **앞으로 살 것 ② 다이소·철물점·기타 {len(etc)}품목: {etc_known:,}원** (가격 아는 것만" + (f", 가격 미확인 {', '.join(unk_ids)}" if unk_ids else "") + ")")
else:
    A("- **앞으로 살 것 ② 다이소·철물점·기타: 없음**")
A(f"- **이미 결제한 것: {spent_sum:,}원** — " + " · ".join(f"{s['name']} {s['amount']:,}원" for s in OD))
if rf:
    A("- 환불 예정(합계 미포함): " + " · ".join(f"{s['name']} {s['amount']:,}원 ({s['status']})" for s in rf))
A(f"- 2학기 전체(이미 결제 + 앞으로 살 것" + (" + 배송비" if dm_ship else "") + f"): **{spent_sum + future:,}원** (선택 구매·공구 구매·가격 미확인 품목 제외)")
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
A("주문할 때는 엑셀 `주문_링크` 시트(링크를 누르면 상품 페이지)나 아래 표의 상품 번호·링크를 씁니다." if (dm or etc) else "더 살 부품이 없습니다. 이미 산 부품의 링크는 엑셀 `주문_링크` 시트의 '☑ 이미 산 것' 구획에 있습니다.")
A("")
A(f"### {sec}.1 디바이스마트: {len(dm)}품목, 합계 {dm_inc:,}원 (VAT 포함) / {dm_ex:,}원 (VAT 별도)")
A("")
if dm:
    A("학교 물품구매의뢰서에는 **VAT 별도 단가**를 적습니다. 엑셀 `추가구매_의뢰서용` 시트를 그대로 옮겨 쓰면 됩니다.")
    A("")
if dm:
    A("| 순번 | ID | 물품 이름 | 상품 번호 | 수량 | 단가 VAT 별도 | 소계 VAT 별도 | 단가 VAT 포함 | 소계 VAT 포함 | 비고 |")
    A("|---:|---|---|---|---:|---:|---:|---:|---:|---|")
    for i, x in enumerate(dm, 1):
        A(f"| {i} | {x['id']} | {x['name']} | [{x['productNo']}]({x['url']}) | {x['qtyToBuy']} | {won(x.get('vatEx'))} | {won(x['qtyToBuy'] * x['vatEx'])} | "
          f"{won(x['unitPriceKRW'])} | {won(x['qtyToBuy'] * x['unitPriceKRW'])} | {x.get('reqNote') or x.get('usedIn') or ''} |")
    A(f"| | | **합계** | | | | **{dm_ex:,}** | | **{dm_inc:,}** | |")
else:
    A("더 살 디바이스마트 부품이 없습니다. 이미 산 내역(거래명세서 대조)은 아래 '이미 결제한 것'에 있습니다.")
A("")
A(f"### {sec}.2 다이소 · 철물점 · 기타: {len(etc)}품목")
A("")
if etc:
    A("| 순번 | ID | 물품 | 수량 | 단가(원) | 구매처 | 고르는 기준 · 메모 |")
    A("|---:|---|---|---:|---:|---|---|")
    for i, x in enumerate(etc, len(dm) + 1):
        link = f" ([링크]({x['url']}))" if x.get("url") else ""
        A(f"| {i} | {x['id']} | {x['name']} | {x['qtyToBuy']} | {won(x['unitPriceKRW']) or '확인 필요'} | {x.get('vendor') or ''}{link} | {(x.get('reqNote') or x.get('note') or '').replace(chr(10), ' ')} |")
else:
    A("더 살 물건이 없습니다.")
A("")
sec += 1
A(f"## {sec}. 이미 결제한 것 (2학기)")
A("")
A("| 날짜 | 품목 | 구매처 | 수량 | 금액(원) | 상태 | 비고 |")
A("|---|---|---|---|---:|---|---|")
for s in OD:
    A(f"| {s['date']} | {s['name']} | {s['vendor']} | {s['qty']} | {s['amount']:,} | {s['status']} | {(s.get('note') or '').replace('|', '/')} |")
A(f"| | **합계** | | | **{spent_sum:,}** | | |")
for s in rf:
    A(f"| {s['date']} | ~~{s['name']}~~ | {s['vendor']} | {s['qty']} | ({s['amount']:,}) | {s['status']} | {s.get('note') or ''} (합계 미포함) |")
A("")
for p in cfg.get("purchases", []):
    ex = p["vat"] == "ex"
    A(f"### {p['title']} ({p['date']}) — 부품별 내역 · BOM 계획 대비")
    A("")
    A(("거래명세서의 품명·수량·단가(VAT 별도) 그대로입니다. " if ex else "") + (p.get("note") or ""))
    A("")
    A("| No | ID | 품명 | 수량 | 단가(원) " + ("VAT 별도" if ex else "VAT 포함") + " | 금액(원) VAT 포함 | BOM 계획 대비 |")
    A("|---:|---|---|---:|---:|---:|---|")
    for i, ln in enumerate(p["lines"], 1):
        x = byid_items.get(ln["id"])
        diff = plan_diff(x, p["title"]) if x else "(이 기준에는 없는 부품 — 다른 기준 전용)"
        A(f"| {i} | {ln['id']} | {ln['name'].replace('|', '/')} | {ln['qty']} | {ln['unit']:,} | {line_amount(ln, p):,} | {diff} |")
    if p.get("shipping"):
        A(f"| | | 배송비 | | | {p['shipping']:,} | {p.get('shippingNote') or ''} |")
    A(f"| | | **합계** | | | **{purchase_total(p):,}** | " + (f"공급가액 {p['supplyKRW']:,} + 부가세 {p['vatKRW']:,}" if p.get("supplyKRW") else "") + " |")
    A("")
sec += 1
A(f"## {sec}. 예산 요약")
A("")
A("| 구분 | 금액(원) | 비고 |")
A("|---|---:|---|")
A("| 1학기 실습비 지원 / 집행 / 잔액 | 200,000 / 161,400 / 38,600 | 결과보고서 정산서 기준. 잔액 이월 여부 확인 필요 |")
A("| 경진대회 예선 참가 지원금 | 50,000 | 받았는지·사용 기한 확인 필요 |")
A("| 캡스톤디자인Ⅱ 실습비 | 확인 필요 | 1학기는 200,000원 |")
A(f"| 2학기 이미 결제 | {spent_sum:,} | " + " · ".join(s["name"] for s in OD) + " |")
A(f"| 2학기 앞으로 ① 디바이스마트 | {dm_inc:,} | VAT 포함 (VAT 별도 {dm_ex:,}) |")
if dm_ship:
    A(f"| └ 디바이스마트 배송비 | {dm_ship:,} | 주문액 66,000원 미만(조사값) |")
A(f"| 2학기 앞으로 ② 다이소·철물점·기타 | {etc_known:,} | 가격 미확인 품목 제외 |")
A(f"| **2학기 전체** | **{spent_sum + future:,}** | 선택 구매·공구 구매 제외" + (" · 배송비 포함" if dm_ship else "") + " |")
for extra in V.get("budget_extra", []):
    A(f"| {extra['label']} | {won(extra['amount'])} | {extra['note']} |")
A("")
A("엑셀 `예산` 시트의 노란 칸(재원)을 확인한 값으로 고치면 판단이 자동으로 다시 계산됩니다. 선택 업그레이드(로드셀·연동펌프 등)는 원본 `" + SRC_MD_REL + "` 4장과 같고 엑셀 `선택_업그레이드` 시트에 그대로 있습니다.")
A("")
sec += 1
A(f"## {sec}. 확인할 것")
A("")
for line in cfg["common"]["todo"] + V.get("todo", []):
    A(f"- {line}")
A("")
A("---")
A(f"*이 문서와 `{V['file']}.xlsx`는 `research/canonical_bom.json`과 `research/BOM_원본_20261106.xlsx`(2026-11-06)를 원본으로 `research/make_boms.py`(설정 `research/bom_variants.json`)가 만들었습니다. 엑셀에서 수량이나 단가 칸만 고쳐도 금액·합계·예산이 자동으로 다시 계산됩니다.*")
open(OUT_BASE + ".md", "w", encoding="utf-8", newline="\n").write("\n".join(L) + "\n")
print("saved", OUT_BASE, "items", len(items), "dm", len(dm), dm_inc, dm_ex, "etc", len(etc), etc_known, "spent", spent_sum)
