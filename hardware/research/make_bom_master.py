# -*- coding: utf-8 -*-
"""통합판 BOM (hardware/BOM.xlsx · BOM.md) — 납땜 기준과 무납땜 기준을 한 표로 비교한다.

사용: python make_bom_master.py bom_variants.json
- 두 기준의 품목은 bom_data.build_items()로 계산 (기준별 BOM과 같은 데이터)
- 시트: 요약 / 주문_링크 / BOM_전체 / 지출_완료 / 보유_미사용 / 선택_업그레이드 / 예산
- 학교 물품구매의뢰서 양식은 기준별 BOM(BOM_납땜기준.xlsx / BOM_무납땜기준.xlsx)의 '추가구매_의뢰서용' 시트
- 그다음 Excel 재계산(recalc_excel.ps1) → 공개 전 scrub_xlsx.py
"""
import os
import sys

sys.dont_write_bytecode = True
import openpyxl
from openpyxl.styles import Alignment

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bom_data import (HW, SRC_XLSX, SRC_MD_REL, DM, CAT_ORDER, load_cfg, build_items, vendor_group, order_sheet, copy_sheet,  # noqa: E402
                      f_title, f_sub, f_body, f_bold, f_grey, f_link, f_sec, fill_row, fill_buy, fill_done, fill_none,
                      fill_total, fill_input, wrap, center, NUM, put, header, widths)

cfg = load_cfg(sys.argv[1])
DATE = cfg["date"]
src = openpyxl.load_workbook(SRC_XLSX)
S = build_items(cfg, "solder", src, warn=False)
N = build_items(cfg, "nosolder", src, warn=False)
VS, VN = cfg["variants"]["solder"], cfg["variants"]["nosolder"]
sm, nm = {x["id"]: x for x in S}, {x["id"]: x for x in N}
ids = sorted(set(sm) | set(nm), key=lambda p: (CAT_ORDER.index((sm.get(p) or nm.get(p))["category"]), int(p[1:])))


def need(x):
    return x["qtyNeeded"] if x else 0


def tobuy(x):
    return x["qtyToBuy"] if x else 0


def scope(p):
    s, n = sm.get(p), nm.get(p)
    base = s or n
    if base["category"] in ("선택", "미사용"):
        return base["category"]
    ns, nn = need(s), need(n)
    if ns and nn:
        return "공통"
    if ns and not nn:
        return "납땜 기준만"
    if nn and not ns:
        return "무납땜 기준만"
    return "둘 다 불필요"


def merged(p, key):
    s, n = sm.get(p), nm.get(p)
    a = (s or {}).get(key) or ""
    b = (n or {}).get(key) or ""
    if not s:
        return b
    if not n:
        return a
    if a == b:
        return a
    return f"[납땜] {a} / [무납땜] {b}"


rows = []
for p in ids:
    s, n = sm.get(p), nm.get(p)
    base = s or n
    rows.append({"id": p, "x": base, "s": s, "n": n, "scope": scope(p)})

wb = openpyxl.Workbook()
wb.remove(wb.active)

# ================================================================ BOM_전체 (통합)
ws = wb.create_sheet("BOM_전체")
put(ws, 1, 1, "AI 스마트 바텐더 — 통합 BOM (납땜 기준 · 무납땜 기준 비교, 부품 전체)", f_title, b=False, align=Alignment())
put(ws, 2, 1, f"팀 홍당무 · 작성 {DATE} · 원본 BOM(2026-11-06, research/BOM_원본_20261106.xlsx)을 최신화한 통합판 · 단가 = VAT 포함 판매가(빈칸 = 가격 확인 필요) · "
              "금액 = 구매 수량 × 단가 · '적용' = 그 부품이 어느 기준에 필요한지", f_sub, b=False, align=Alignment())
COLS = ["No", "ID", "분류", "부품명", "규격/모델", "적용", "필요\n납땜", "필요\n무납땜", "보유", "구매\n납땜", "구매\n무납땜", "단가(원)\nVAT 포함",
        "금액(원)\n납땜", "금액(원)\n무납땜", "상태 (납땜 / 무납땜)", "지출 완료(원)", "구매처", "상품번호", "링크", "사용 위치", "비고"]
header(ws, 3, COLS)
ws.row_dimensions[3].height = 32
r0 = 4
S1 = 3 + len(cfg["spent"])
rid = {}
for i, row in enumerate(rows):
    r = r0 + i
    x, s, n = row["x"], row["s"], row["n"]
    rid[row["id"]] = r
    st_s = s["_status"] if s else "해당 없음"
    st_n = n["_status"] if n else "해당 없음"
    st = st_s if st_s == st_n else f"{st_s} / {st_n}"
    if tobuy(s) or tobuy(n):
        fl = fill_buy
    elif any(t.startswith(("주문 완료", "구매 완료")) for t in (st_s, st_n)):
        fl = fill_done
    elif row["scope"] in ("미사용", "둘 다 불필요"):
        fl = fill_none
    else:
        fl = fill_row
    vals = [i + 1, row["id"], x["category"], x["name"] if (not n or not s or s["name"] == n["name"]) else f"{s['name']} / {n['name']}",
            merged(row["id"], "spec"), row["scope"], need(s) if s else 0, need(n) if n else 0, x["qtyOwned"], tobuy(s), tobuy(n),
            x["unitPriceKRW"], f'=IF(ISNUMBER(L{r}),J{r}*L{r},"")', f'=IF(ISNUMBER(L{r}),K{r}*L{r},"")', st,
            f'=IF(SUMIF(지출_완료!$H$4:$H${S1},B{r},지출_완료!$F$4:$F${S1})=0,"",SUMIF(지출_완료!$H$4:$H${S1},B{r},지출_완료!$F$4:$F${S1}))',
            x.get("vendor"), x.get("productNo"), "상품 페이지" if x.get("url") else None, merged(row["id"], "usedIn"), merged(row["id"], "note")]
    for c, v in enumerate(vals, 1):
        fmt = NUM if c in (12, 13, 14, 16) else None
        font = f_link if c == 19 and v else (f_grey if row["scope"] in ("둘 다 불필요",) else f_body)
        cell = put(ws, r, c, v, font, fl, fmt, center if c in (1, 2, 3, 6, 7, 8, 9, 10, 11) else wrap)
        if c == 19 and x.get("url"):
            cell.hyperlink = x["url"]
rl = r0 + len(rows) - 1
R_TOT = rl + 1
put(ws, R_TOT, 4, "합계 (추가 구매, VAT 포함 · 가격 미확인 품목 제외)", f_bold, fill_total)
put(ws, R_TOT, 13, f"=SUM(M{r0}:M{rl})", f_bold, fill_total, NUM)
put(ws, R_TOT, 14, f"=SUM(N{r0}:N{rl})", f_bold, fill_total, NUM)
put(ws, R_TOT, 16, f"=SUM(P{r0}:P{rl})", f_bold, fill_total, NUM)
put(ws, R_TOT, 15, "지출 완료 합계 →", f_bold, fill_total)
R_DM = R_TOT + 1
put(ws, R_DM, 4, "  └ 디바이스마트 주문 합계 (VAT 포함)", f_bold)
put(ws, R_DM, 13, f'=SUMIF(Q{r0}:Q{rl},"{DM}",M{r0}:M{rl})', f_bold, None, NUM)
put(ws, R_DM, 14, f'=SUMIF(Q{r0}:Q{rl},"{DM}",N{r0}:N{rl})', f_bold, None, NUM)
R_ETC = R_DM + 1
put(ws, R_ETC, 4, "  └ 다이소·편의점 등 (가격 아는 품목만)", f_bold)
put(ws, R_ETC, 13, f'=SUMIF(Q{r0}:Q{rl},"<>{DM}",M{r0}:M{rl})', f_bold, None, NUM)
put(ws, R_ETC, 14, f'=SUMIF(Q{r0}:Q{rl},"<>{DM}",N{r0}:N{rl})', f_bold, None, NUM)
widths(ws, [5, 6, 8, 40, 40, 12, 7, 7, 6, 7, 7, 10, 12, 12, 22, 12, 16, 11, 9, 28, 62])
ws.freeze_panes = "E4"
ws.auto_filter.ref = f"A3:U{rl}"

# ================================================================ 지출_완료
we = wb.create_sheet("지출_완료")
put(we, 1, 1, "이미 결제한 것 (2학기) — 두 기준 공통", f_title, b=False, align=Alignment())
put(we, 2, 1, "사용자가 알려 준 금액 그대로입니다. 영수증·거래명세서를 보관해 결과보고서 정산서에 씁니다.", f_sub, b=False, align=Alignment())
header(we, 3, ["No", "날짜", "품목", "구매처", "수량", "금액(원)", "상태", "BOM ID", "비고"])
sp = cfg["spent"]
for i, s_ in enumerate(sp, 1):
    r = 3 + i
    for c, v in enumerate([i, s_["date"], s_["name"], s_["vendor"], s_["qty"], s_["amount"], s_["status"], s_.get("bomId"), s_.get("note")], 1):
        put(we, r, c, v, f_body, fill_done, NUM if c == 6 else None, center if c in (1, 2, 5, 8) else wrap)
R_SP = S1 + 1
put(we, R_SP, 3, "지출 완료 합계", f_bold, fill_total)
put(we, R_SP, 6, f"=SUM(F4:F{S1})", f_bold, fill_total, NUM)
rf = cfg.get("refund", [])
r = R_SP + 2
put(we, r, 1, "환불 예정 (합계에 넣지 않음)", f_sec, b=False)
header(we, r + 1, ["No", "날짜", "품목", "구매처", "수량", "금액(원)", "상태", "", "비고"])
for i, s_ in enumerate(rf, 1):
    rr = r + 1 + i
    for c, v in enumerate([i, s_["date"], s_["name"], s_["vendor"], s_["qty"], s_["amount"], s_["status"], None, s_.get("note")], 1):
        put(we, rr, c, v, f_body, fill_none, NUM if c == 6 else None, center if c in (1, 2, 5) else wrap)
widths(we, [5, 11, 44, 16, 10, 11, 22, 9, 60])

# ================================================================ 보유_미사용 · 선택_업그레이드 (원본 복사 + 메모)
wo = wb.create_sheet("보유_미사용")
copy_sheet(src["보유_미사용"], wo)
put(wo, 18, 1, "무납땜 기준에서는 P25 열수축 솔더 슬리브 1.0SQ 10개도 모두 남습니다(펌프 리드 이음을 레버 커넥터로 하므로). "
               "이 시트는 원본(2026-11-06)과 같고, 기준별 수량은 BOM_납땜기준.xlsx / BOM_무납땜기준.xlsx의 같은 시트에 있습니다.", f_sub, b=False, align=Alignment(wrap_text=False))
wu = wb.create_sheet("선택_업그레이드")
copy_sheet(src["선택_업그레이드"], wu)

# ================================================================ 예산 (두 기준 비교)
wbud = wb.create_sheet("예산")
put(wbud, 1, 1, "예산 — 두 기준 비교 (2학기 금액은 VAT 포함)", f_title, b=False, align=Alignment())
put(wbud, 2, 1, f"작성 {DATE}. 노란 칸은 확인한 값으로 고치는 칸입니다. 기준별 자세한 예산은 각 기준 BOM의 '예산' 시트.", f_sub, b=False, align=Alignment())
s_b = src["예산"]
r = 4
put(wbud, r, 1, "A. 1학기(캡스톤디자인Ⅰ) 실습비 집행 — 결과보고서 정산서 기준", f_sec, b=False)
r += 1
header(wbud, r, ["항목", "금액(원)", "", "비고"])
for k in range(6, 11):
    r += 1
    put(wbud, r, 1, s_b.cell(k, 1).value)
    put(wbud, r, 2, s_b.cell(k, 2).value, f_bold if k >= 9 else f_body, None, NUM)
    put(wbud, r, 4, s_b.cell(k, 5).value)
put(wbud, 9, 2, "=SUM(B7:B8)", f_bold, None, NUM)
put(wbud, 10, 2, "=B6-B9", f_bold, None, NUM)
r = 12
put(wbud, r, 1, "B. 2학기 — 기준별 비교", f_sec, b=False)
r += 1
header(wbud, r, ["항목", "납땜 기준(원)", "무납땜 기준(원)", "비고"])
r += 1
R_B1 = r
put(wbud, r, 1, "이미 결제한 것 (지출_완료)")
put(wbud, r, 2, f"=지출_완료!F{R_SP}", f_body, None, NUM)
put(wbud, r, 3, f"=지출_완료!F{R_SP}", f_body, None, NUM)
put(wbud, r, 4, " · ".join(f"{s_['name']} {s_['amount']:,}원" for s_ in sp) + " (3D 프린팅은 견적 금액)")
r += 1
R_B2 = r
put(wbud, r, 1, "앞으로 ① 디바이스마트 (VAT 포함)")
put(wbud, r, 2, f"=BOM_전체!M{R_DM}", f_body, None, NUM)
put(wbud, r, 3, f"=BOM_전체!N{R_DM}", f_body, None, NUM)
put(wbud, r, 4, "무료배송 기준 66,000원. 학교 의뢰서(VAT 별도)는 기준별 BOM의 '추가구매_의뢰서용' 시트")
r += 1
R_B3 = r
put(wbud, r, 1, "앞으로 ② 다이소·편의점 등 (가격 아는 것만)")
put(wbud, r, 2, f"=BOM_전체!M{R_ETC}", f_body, None, NUM)
put(wbud, r, 3, f"=BOM_전체!N{R_ETC}", f_body, None, NUM)
r += 1
R_BALL = r
put(wbud, r, 1, "2학기 전체 (이미 결제 + 앞으로)", f_bold, fill_total)
put(wbud, r, 2, f"=B{R_B1}+B{R_B2}+B{R_B3}", f_bold, fill_total, NUM)
put(wbud, r, 3, f"=C{R_B1}+C{R_B2}+C{R_B3}", f_bold, fill_total, NUM)
put(wbud, r, 4, "선택 구매·공구 구매·가격 미확인 품목 제외")
for ex in VS.get("budget_extra", []):
    r += 1
    same = any(e["label"] == ex["label"] for e in VN.get("budget_extra", []))
    put(wbud, r, 1, ex["label"])
    put(wbud, r, 2, ex["amount"], f_body, None, NUM)
    put(wbud, r, 3, ex["amount"] if same else None, f_body, None, NUM)
    put(wbud, r, 4, ex["note"] + ("" if same else " (납땜 기준만)"))
r += 2
put(wbud, r, 1, "C. 재원 (모두 확인 필요)", f_sec, b=False)
r += 1
header(wbud, r, ["재원", "금액(원)", "상태", "비고"])
r += 1
R_F0 = r
put(wbud, r, 1, "1학기 실습비 잔액 (2학기로 이월될 때만)")
put(wbud, r, 2, "=B10", f_body, fill_input, NUM)
put(wbud, r, 3, "이월 여부 확인 필요")
r += 1
put(wbud, r, 1, "경진대회 예선 참가 지원금 (팀당)")
put(wbud, r, 2, 50000, f_body, fill_input, NUM)
put(wbud, r, 3, "수령 여부·사용 기한 확인 필요")
r += 1
R_F2 = r
put(wbud, r, 1, "캡스톤디자인Ⅱ 실습비 (2학기)")
put(wbud, r, 2, None, f_body, fill_input, NUM)
put(wbud, r, 3, "금액 확인 필요")
put(wbud, r, 4, "1학기는 200,000원")
r += 1
R_F = r
put(wbud, r, 1, "재원 합계 (입력된 금액만)", f_bold, fill_total)
put(wbud, r, 2, f"=SUM(B{R_F0}:B{R_F2})", f_bold, fill_total, NUM)
r += 2
header(wbud, r, ["판단 (재원 합계 − 2학기 전체)", "납땜 기준", "무납땜 기준", "음수 = 부족"])
r += 1
put(wbud, r, 1, "남는 돈")
put(wbud, r, 2, f"=B{R_F}-B{R_BALL}", f_bold, None, NUM)
put(wbud, r, 3, f"=B{R_F}-C{R_BALL}", f_bold, None, NUM)
put(wbud, r, 4, f'=IF(B{R_F2}="","실습비가 아직 입력되지 않음","")')
widths(wbud, [50, 16, 16, 90])

# ================================================================ 주문_링크 (두 기준 수량)
buy = [row for row in rows if tobuy(row["s"]) or tobuy(row["n"])]


def memo(row):
    x = row["x"]
    t = x.get("reqNote") if x.get("vendor") == DM else (x.get("note") or x.get("reqNote"))
    pre = "" if row["scope"] in ("공통",) else f"[{row['scope']}] "
    return pre + " ".join((t or x.get("usedIn") or "").split())


grp = []
for gname in (DM + " (devicemart.co.kr — 학교 인터넷 구매신청)", "다이소 (daisomall.co.kr — 매장 픽업 또는 택배)", "기타 (편의점 등)"):
    key = gname.split(" ")[0]
    rs = [(row["x"], {"price": f"=BOM_전체!L{rid[row['id']]}", "qs": f"=BOM_전체!J{rid[row['id']]}", "qn": f"=BOM_전체!K{rid[row['id']]}", "memo": memo(row)})
          for row in buy if vendor_group(row["x"]) == key]
    grp.append((gname, rs))
order_sheet(wb, f"주문 링크 — 두 기준 비교 (앞으로 살 것 {len(buy)}품목, 수량 0 = 그 기준에서는 사지 않음)",
            "링크를 누르면 상품 페이지가 열립니다. 고른 기준의 수량 열만 보고 주문하세요. 수량·단가는 BOM_전체 시트와 연동됩니다. "
            "디바이스마트 링크·가격은 2026-11-06~10 조사 기준 — 주문 전에 품절·가격을 다시 확인. 학교 의뢰서는 기준별 BOM의 '추가구매_의뢰서용' 시트.",
            grp, [("수량\n납땜", "qs", "금액\n납땜"), ("수량\n무납땜", "qn", "금액\n무납땜")], index=0)

# ================================================================ 요약
wsum = wb.create_sheet("요약", 0)
put(wsum, 1, 1, "통합 BOM — 납땜 기준 · 무납땜 기준 비교 · 사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커", f_title, b=False, align=Alignment())
put(wsum, 2, 1, f"팀 홍당무 · 작성 {DATE} · 원본 BOM(2026-11-06)은 research/BOM_원본_20261106.xlsx 로 보관. 기준별 자세한 BOM: BOM_납땜기준.xlsx · BOM_무납땜기준.xlsx", f_sub, b=False, align=Alignment())
r = 4
put(wsum, r, 1, "이 파일은", f_sec, b=False)
intro = ["두 기준(납땜 = 인두기로 원래 설계대로, 무납땜 = 레버 커넥터·선 달린 부품)을 한 표로 비교한 통합판입니다. 부품마다 '적용'(공통 / 납땜 기준만 / 무납땜 기준만)과 기준별 필요·구매 수량이 있습니다.",
         "주문할 때는 '주문_링크' 시트를 보세요 — 앞으로 살 부품만 구매처별로 모았고, 링크를 누르면 상품 페이지가 열립니다.",
         "학교 물품구매의뢰서 양식(VAT 별도)은 기준별 BOM의 '추가구매_의뢰서용' 시트에 있습니다.",
         "제작 방법은 guide/제작가이드_납땜기준.md · guide/제작가이드_무납땜기준.md."]
for line in intro:
    r += 1
    put(wsum, r, 1, "• " + line, f_body, b=False)
r += 2
put(wsum, r, 1, "한눈에 보기", f_sec, b=False)
r += 1
header(wsum, r, ["항목", "납땜 기준(원)", "무납땜 기준(원)", "비고"])
for lab, a, b_, note in [
    ("앞으로 ① 디바이스마트 (VAT 포함)", f"=BOM_전체!M{R_DM}", f"=BOM_전체!N{R_DM}",
     f"품목 수: 납땜 {sum(1 for x in S if x.get('vendor') == DM and x['qtyToBuy'] > 0)} · 무납땜 {sum(1 for x in N if x.get('vendor') == DM and x['qtyToBuy'] > 0)}"),
    ("앞으로 ② 다이소·편의점 등 (가격 아는 것만)", f"=BOM_전체!M{R_ETC}", f"=BOM_전체!N{R_ETC}", "가격 미확인: " + (" · ".join(sorted({row['id'] for row in buy if vendor_group(row['x']) != DM and not isinstance(row['x']['unitPriceKRW'], (int, float))})) or "없음")),
    ("이미 결제한 것", f"=지출_완료!F{R_SP}", f"=지출_완료!F{R_SP}", "3D 프린팅(견적) · 포맥스 — 두 기준 공통"),
    ("2학기 전체", f"=예산!B{R_BALL}", f"=예산!C{R_BALL}", "선택 구매·공구 구매 제외"),
]:
    r += 1
    put(wsum, r, 1, lab, f_bold if "전체" in lab else f_body)
    put(wsum, r, 2, a, f_bold, None, NUM)
    put(wsum, r, 3, b_, f_bold, None, NUM)
    put(wsum, r, 4, note)
r += 2
put(wsum, r, 1, "두 기준에서 달라지는 부품", f_sec, b=False)
r += 1
header(wsum, r, ["ID", "부품", "적용", "메모"])
for row in rows:
    if row["scope"] in ("납땜 기준만", "무납땜 기준만") or (row["s"] and row["n"] and row["s"]["_status"] != row["n"]["_status"] and row["scope"] not in ("선택", "미사용")):
        r += 1
        st = f"{row['s']['_status'] if row['s'] else '해당 없음'} / {row['n']['_status'] if row['n'] else '해당 없음'}"
        put(wsum, r, 1, row["id"], f_body, None, None, center)
        put(wsum, r, 2, row["x"]["name"])
        put(wsum, r, 3, row["scope"], f_body, None, None, center)
        put(wsum, r, 4, "상태 (납땜 / 무납땜): " + st)
r += 2
put(wsum, r, 1, "원본 BOM(2026-11-06)에서 바뀐 점 (공통)", f_sec, b=False)
for line in cfg["common"]["changelog"]:
    r += 1
    put(wsum, r, 1, "• " + line, f_body, b=False)
r += 2
put(wsum, r, 1, "확인할 것 (공통)", f_sec, b=False)
for line in cfg["common"]["todo"]:
    r += 1
    put(wsum, r, 1, "• " + line, f_body, b=False)
widths(wsum, [40, 44, 16, 80])
for row_ in wsum.iter_rows(min_row=4, max_row=r):
    for c in row_:
        if c.column == 1 and isinstance(c.value, str) and c.value.startswith("• "):
            wsum.merge_cells(start_row=c.row, start_column=1, end_row=c.row, end_column=4)
            c.alignment = Alignment(wrap_text=True, vertical="top")
            wsum.row_dimensions[c.row].height = 15 * max(1, (len(c.value) // 110) + 1)
wb.save(os.path.join(HW, "BOM.xlsx"))

# ================================================================ md
def won(v):
    return f"{v:,}" if isinstance(v, (int, float)) else ""


def amt(x):
    return x["qtyToBuy"] * x["unitPriceKRW"] if x and isinstance(x.get("unitPriceKRW"), (int, float)) else 0


def sums(items):
    dm = sum(amt(x) for x in items if x.get("vendor") == DM and x["qtyToBuy"] > 0)
    dmx = sum(x["qtyToBuy"] * x["vatEx"] for x in items if x.get("vendor") == DM and x["qtyToBuy"] > 0 and isinstance(x.get("vatEx"), (int, float)))
    etc = sum(amt(x) for x in items if x.get("vendor") != DM and x["qtyToBuy"] > 0)
    n_dm = sum(1 for x in items if x.get("vendor") == DM and x["qtyToBuy"] > 0)
    n_etc = sum(1 for x in items if x.get("vendor") != DM and x["qtyToBuy"] > 0)
    return dm, dmx, etc, n_dm, n_etc


spent = sum(s_["amount"] for s_ in sp)
ds, dsx, es, nds, nes = sums(S)
dn, dnx, en, ndn, nen = sums(N)


def cell(v):
    return str(v).replace("|", "\\|").replace("\n", " ")


def link(x):
    if x.get("url"):
        return f"[{x.get('productNo') or '상품 페이지'}]({x['url']})"
    return x.get("productNo") or ""


L = []
A = L.append
A("# BOM (부품 목록) — 통합판: 납땜 기준 · 무납땜 기준 비교")
A("")
A(f"> 팀 홍당무 · 작성 {DATE} · 사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커")
A(f"> 엑셀: `BOM.xlsx` (시트: 요약 / 주문_링크 / BOM_전체 / 지출_완료 / 보유_미사용 / 선택_업그레이드 / 예산). 이 문서와 엑셀은 같은 스크립트(`research/make_bom_master.py`)로 만들어 숫자가 같습니다.")
A(f"> 기준별 자세한 BOM(학교 의뢰서 양식 포함): [`BOM_납땜기준.md`](BOM_납땜기준.md) · [`BOM_무납땜기준.md`](BOM_무납땜기준.md). 원본(2026-11-06): [`{SRC_MD_REL}`]({SRC_MD_REL}).")
A("")
A("## 0. 한눈에 보기")
A("")
A("| 항목 | 납땜 기준 | 무납땜 기준 | 비고 |")
A("|---|---:|---:|---|")
A(f"| 앞으로 ① 디바이스마트 (VAT 포함) | {ds:,}원 ({nds}품목) | {dn:,}원 ({ndn}품목) | 학교 의뢰서(VAT 별도): 납땜 {dsx:,} · 무납땜 {dnx:,} |")
A(f"| 앞으로 ② 다이소·편의점 등 | {es:,}원 ({nes}품목) | {en:,}원 ({nen}품목) | 가격 아는 것만 |")
A(f"| 이미 결제한 것 | {spent:,}원 | {spent:,}원 | " + " · ".join(f"{s_['name']} {s_['amount']:,}원" for s_ in sp) + " |")
A(f"| **2학기 전체** | **{spent + ds + es:,}원** | **{spent + dn + en:,}원** | 선택 구매·공구 구매 제외 |")
if rf:
    A("")
    A("환불 예정(합계 미포함): " + " · ".join(f"{s_['name']} {s_['amount']:,}원" for s_ in rf))
A("")
A("- **납땜 기준**: 원래 설계 그대로 인두기로 납땜(학교 실습실 공구 대여). 제작: [`guide/제작가이드_납땜기준.md`](guide/제작가이드_납땜기준.md)")
A("- **무납땜 기준**: 레버 커넥터·선 달린 스위치·인라인 퓨즈로 집에서 조립. 제작: [`guide/제작가이드_무납땜기준.md`](guide/제작가이드_무납땜기준.md)")
A("")
A("## 1. 두 기준에서 달라지는 부품")
A("")
A("| ID | 부품 | 적용 | 상태 (납땜 / 무납땜) | 구매 (납땜 / 무납땜) |")
A("|---|---|---|---|---|")
for row in rows:
    s, n = row["s"], row["n"]
    if row["scope"] in ("납땜 기준만", "무납땜 기준만") or (s and n and s["_status"] != n["_status"] and row["scope"] not in ("선택", "미사용")):
        A(f"| {row['id']} | {cell(row['x']['name'])} | {row['scope']} | {s['_status'] if s else '해당 없음'} / {n['_status'] if n else '해당 없음'} | {tobuy(s)} / {tobuy(n)} |")
A("")
A("## 2. 주문 링크 (앞으로 살 것, 구매처별)")
A("")
A("링크를 누르면 상품 페이지가 열립니다. 고른 기준의 수량만 보고 주문하세요(0 = 그 기준에서는 사지 않음). 디바이스마트 링크·가격은 2026-11-06~10 조사 기준이라 주문 전에 품절·가격을 다시 확인합니다.")
for gname in (DM, "다이소", "기타"):
    g = [row for row in buy if vendor_group(row["x"]) == gname]
    if not g:
        continue
    A("")
    A(f"### {gname}")
    A("")
    A("| ID | 부품 | 상품 페이지 | 단가(원) | 수량 납땜 | 수량 무납땜 | 메모 |")
    A("|---|---|---|---:|---:|---:|---|")
    for row in g:
        x = row["x"]
        A(f"| {row['id']} | {cell(x['name'])} | {link(x) or '매장 구매'} | {won(x['unitPriceKRW']) or '확인 필요'} | {tobuy(row['s'])} | {tobuy(row['n'])} | {cell(memo(row))[:160]} |")
A("")
A(f"## 3. 전체 BOM ({len(rows)}개 항목, 분류별)")
A("")
A("필요·구매 = 납땜 기준 / 무납땜 기준. 단가는 VAT 포함. 상태가 두 기준에서 같으면 하나만 적었습니다.")
for cat in CAT_ORDER:
    g = [row for row in rows if row["x"]["category"] == cat]
    if not g:
        continue
    A("")
    A(f"### {cat} ({len(g)}개)")
    A("")
    A("| ID | 부품명 | 적용 | 필요 | 보유 | 구매 | 단가(원) | 상태 | 구매처 · 상품 페이지 |")
    A("|---|---|---|---:|---:|---:|---:|---|---|")
    for row in g:
        x, s, n = row["x"], row["s"], row["n"]
        st_s = s["_status"] if s else "해당 없음"
        st_n = n["_status"] if n else "해당 없음"
        st = st_s if st_s == st_n else f"{st_s} / {st_n}"
        A(f"| {row['id']} | {cell(x['name'])} | {row['scope']} | {need(s) if s else 0} / {need(n) if n else 0} | {x['qtyOwned']} | {tobuy(s)} / {tobuy(n)} | "
          f"{won(x['unitPriceKRW'])} | {cell(st)} | {cell((x.get('vendor') or '') + (' · ' + link(x) if link(x) else ''))} |")
A("")
A("## 4. 이미 결제한 것 (2학기, 두 기준 공통)")
A("")
A("| 날짜 | 품목 | 구매처 | 금액(원) | 상태 |")
A("|---|---|---|---:|---|")
for s_ in sp:
    A(f"| {s_['date']} | {s_['name']} | {s_['vendor']} | {s_['amount']:,} | {s_['status']} |")
A(f"| | **합계** | | **{spent:,}** | |")
A("")
A("## 5. 확인할 것 (공통)")
A("")
for line in cfg["common"]["todo"]:
    A(f"- {line}")
A("")
A("---")
A("*이 문서와 `BOM.xlsx`는 `research/canonical_bom.json`·`research/BOM_원본_20261106.xlsx`(2026-11-06)를 원본으로 `research/make_bom_master.py`(설정 `research/bom_variants.json`)가 만들었습니다. 기준별 BOM은 `research/make_boms.py`.*")
open(os.path.join(HW, "BOM.md"), "w", encoding="utf-8", newline="\n").write("\n".join(L) + "\n")
print("saved BOM.xlsx/BOM.md rows", len(rows), "buy", len(buy), "solder", ds, es, "nosolder", dn, en)
