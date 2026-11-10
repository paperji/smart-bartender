# -*- coding: utf-8 -*-
"""BOM 생성기 공통 부분 — 데이터 읽기 · 기준별 품목 계산 · 엑셀 서식 · 주문 링크 시트.

make_boms.py(기준별 BOM 두 벌)와 make_bom_master.py(통합판 BOM.xlsx/BOM.md)가 함께 씁니다.
- 원본 데이터: research/canonical_bom.json (부품 69항목)
- 원본 엑셀: research/BOM_원본_20261106.xlsx (VAT 별도 단가·보유_미사용·선택_업그레이드·1학기 예산 값을 읽음)
- 설정: research/bom_variants.json (공통 변경 + 기준별 변경)
"""
import copy
from decimal import Decimal, ROUND_HALF_UP
import json
import os
import re

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
HW = os.environ.get("BOM_HW") or os.path.dirname(HERE)
SRC_JSON = os.path.join(HW, "research", "canonical_bom.json")
SRC_XLSX = os.path.join(HW, "research", "BOM_원본_20261106.xlsx")
SRC_MD_REL = "research/BOM_원본_20261106.md"      # hardware/ 기준 상대 경로
DM = "디바이스마트"
CAT_ORDER = ["제어", "구동", "전원", "배선", "배관", "외형", "3D 프린팅", "공구", "선택", "미사용"]


def load_cfg(path):
    return json.load(open(path, encoding="utf-8"))


def _apply(item_list, changes, adds):
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


def vat_ex_map(src):
    """원본 의뢰서 시트의 VAT 별도 단가 (비교·경고용)."""
    out = {}
    ws = src["추가구매_의뢰서용"]
    for r in range(10, 39):
        f = ws.cell(r, 6).value
        d = ws.cell(r, 4).value
        if isinstance(f, str) and f.startswith("P") and isinstance(d, (int, float)):
            out[f.split(" ")[0]] = d
    return out


# ---------------------------------------------------------------- 구매 기록 (cfg["purchases"])
# 한 번의 주문(거래명세서·영수증) = purchases 한 항목. lines의 unit은 vat가 "ex"면 VAT 별도 단가(디바이스마트 거래명세서),
# "inc"면 VAT 포함 단가(다이소 등). 생성기가 부품별 보유·구매 수량·상태와 지출 장부를 자동으로 고친다.
def _won_round(v):
    return int(Decimal(v).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def unit_inc(ln, p):
    return _won_round(Decimal(ln["unit"]) * Decimal("1.1")) if p["vat"] == "ex" else ln["unit"]


def line_amount(ln, p):
    """한 줄의 결제 금액(VAT 포함)."""
    return _won_round(Decimal(ln["qty"]) * Decimal(ln["unit"]) * Decimal("1.1")) if p["vat"] == "ex" else ln["qty"] * ln["unit"]


def purchase_total(p):
    return sum(line_amount(ln, p) for ln in p["lines"]) + p.get("shipping", 0)


def all_ids(cfg):
    ids = {x["id"] for x in json.load(open(SRC_JSON, encoding="utf-8"))}
    ids |= {a["id"] for a in cfg["common"]["add"]}
    for V in cfg["variants"].values():
        ids |= {a["id"] for a in V.get("add", [])}
    return ids


def check_purchases(cfg):
    """기록한 결제 합계(total)와 줄별 계산 합계가 같은지 확인."""
    known = all_ids(cfg)
    for p in cfg.get("purchases", []):
        for ln in p["lines"]:
            if ln["id"] not in known:
                raise SystemExit(f"구매 기록의 ID 없음: {ln['id']} ({p['title']})")
        t = purchase_total(p)
        if p.get("total") is not None and t != p["total"]:
            raise SystemExit(f"구매 합계 불일치 — {p['title']}: 줄 합계 {t:,} ≠ 기록 {p['total']:,}")


def _apply_purchases(cfg, items):
    byid = {x["id"]: x for x in items}
    for p in cfg.get("purchases", []):
        for ln in p["lines"]:
            x = byid.get(ln["id"])
            if x is None:          # 다른 기준 전용 부품 — 이 기준 BOM에는 없고 지출 장부에만 남는다
                continue
            q = ln["qty"]
            if "_plan" not in x:       # 첫 구매 전 계획만 기록 (같은 부품을 여러 번 사도 계획은 하나)
                x["_plan"] = {"qtyToBuy": x["qtyToBuy"], "unitPriceKRW": x["unitPriceKRW"]}
                # 구매 전 지시문 '[가격: …]'은 지움 — 뒤따르는 마침표까지 지워 '않음..'이 생기지 않게
                x["note"] = re.sub(r"\s*\[가격:[^\]]*\]\.?", "", x.get("note") or "").strip()
            x["qtyOwned"] = (x.get("qtyOwned") or 0) + q
            x["qtyToBuy"] = max(0, min(x["qtyToBuy"] - q, x["qtyNeeded"] - x["qtyOwned"]))
            x["unitPriceKRW"] = unit_inc(ln, p)
            x["spent"] = x.get("spent", 0) + line_amount(ln, p)
            if x["qtyToBuy"] == 0:
                x["status"] = p["status"]
            vat = "VAT 별도 " if p["vat"] == "ex" else ""
            x["note"] = f"✔ {p['date']} {p['vendor']}에서 {q}개 구매({vat}단가 {ln['unit']:,}원). " + x["note"]
            x.setdefault("_boughts", []).append({"date": p["date"], "vendor": p["vendor"], "title": p["title"], "qty": q, "unit": ln["unit"],
                                                 "vat": p["vat"], "unitInc": unit_inc(ln, p), "name": ln["name"]})


def bought_in(x, title):
    """그 구매 기록(title)에서 이 부품을 산 줄 — 없으면 None."""
    for b in (x or {}).get("_boughts", []):
        if b["title"] == title:
            return b
    return None


def plan_diff(x, title=None):
    """BOM 계획(첫 구매 전) 대비 실제 구매 차이 — 없으면 'BOM 계획과 같음'. 수량은 모든 구매를 더해 비교."""
    bs, pl = (x or {}).get("_boughts"), (x or {}).get("_plan")
    if not bs or not pl:
        return ""
    b = bought_in(x, title) if title else bs[-1]
    total = sum(v["qty"] for v in bs)
    d = []
    if pl["qtyToBuy"] != total:
        d.append(f"수량 계획 {pl['qtyToBuy']} → 실제 {total}" + (f"({len(bs)}번에 나눠 삼)" if len(bs) > 1 else ""))
    if b and isinstance(pl["unitPriceKRW"], (int, float)) and pl["unitPriceKRW"] != b["unitInc"]:
        d.append(f"단가 계획 {pl['unitPriceKRW']:,} → 실제 {b['unitInc']:,}원(VAT 포함)")
    return " · ".join(d) or "BOM 계획과 같음"


def ledger(cfg):
    """지출 장부 — 직접 적은 지출(cfg['spent']) + 구매 기록을 부품 줄·배송비 줄로 펼친 것."""
    rows = [dict(s) for s in cfg["spent"]]
    for p in cfg.get("purchases", []):
        for ln in p["lines"]:
            unit_txt = f"단가 {ln['unit']:,}원(VAT {'별도' if p['vat'] == 'ex' else '포함'})"
            rows.append({"date": p["date"], "name": ln["name"], "vendor": p["vendor"], "qty": str(ln["qty"]), "amount": line_amount(ln, p),
                         "status": p["status"], "bomId": ln["id"], "note": " · ".join(t for t in (unit_txt, ln.get("note"), p.get("lineNote")) if t)})
        if p.get("shipping"):
            rows.append({"date": p["date"], "name": "배송비", "vendor": p["vendor"], "qty": "", "amount": p["shipping"],
                         "status": p["status"], "bomId": None, "note": p.get("shippingNote")})
    return rows


def orders(cfg):
    """주문 단위 요약 — 직접 적은 지출 한 줄씩 + 구매 기록 한 건씩."""
    out = [{"date": s["date"], "name": s["name"], "vendor": s["vendor"], "qty": s["qty"], "amount": s["amount"],
            "status": s["status"], "note": s.get("note")} for s in cfg["spent"]]
    for p in cfg.get("purchases", []):
        out.append({"date": p["date"], "name": p["title"], "vendor": p["vendor"], "qty": f"{len(p['lines'])}품목",
                    "amount": purchase_total(p), "status": p["status"], "note": p.get("note")})
    return out


def build_items(cfg, var, src, warn=True):
    """기준(var: solder|nosolder)을 적용한 품목 목록 — 분류·ID 순, _status·vatEx 포함 (구매 기록 반영)."""
    items = json.load(open(SRC_JSON, encoding="utf-8"))
    _apply(items, cfg["common"]["changes"], cfg["common"]["add"])
    V = cfg["variants"][var]
    _apply(items, V.get("changes", {}), V.get("add", []))
    check_purchases(cfg)
    _apply_purchases(cfg, items)
    items.sort(key=lambda x: (CAT_ORDER.index(x["category"]), int(x["id"][1:]) if x["id"][1:].isdigit() else 999))
    vx = vat_ex_map(src)
    for x in items:
        x["_status"] = status(x)
        x.setdefault("spent", 0)
        if x.get("vendor") == DM and x["qtyToBuy"] > 0:
            calc = int((Decimal(x["unitPriceKRW"]) / Decimal("1.1")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            if warn and x["id"] in vx and vx[x["id"]] != calc:
                print("경고: VAT 별도 단가가 원본 의뢰서와 다름", x["id"], vx[x["id"]], calc)
            x["vatEx"] = calc
    return items


def vendor_group(x):
    v = x.get("vendor") or ""
    if v == DM:
        return DM
    if "다이소" in v:
        return "다이소"
    return "기타"


# ---------------------------------------------------------------- 서식
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
fill_check = PatternFill("solid", fgColor="FFFFFFFF")
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


def copy_sheet(src_ws, dst_ws):
    """값·서식·링크·병합·열 너비를 그대로 복사 (다른 통합 문서 사이)."""
    for row in src_ws.iter_rows():
        for c in row:
            n_ = dst_ws.cell(c.row, c.column, c.value)
            if c.has_style:
                n_.font = copy.copy(c.font)
                n_.fill = copy.copy(c.fill)
                n_.border = copy.copy(c.border)
                n_.alignment = copy.copy(c.alignment)
                n_.number_format = c.number_format
            if c.hyperlink:
                n_.hyperlink = c.hyperlink.target
    for k, d in src_ws.column_dimensions.items():
        dst_ws.column_dimensions[k].width = d.width
    for k, d in src_ws.row_dimensions.items():
        if d.height:
            dst_ws.row_dimensions[k].height = d.height
    for m in src_ws.merged_cells.ranges:
        dst_ws.merge_cells(str(m))
    dst_ws.freeze_panes = src_ws.freeze_panes


def order_sheet(wb, title, sub, groups, qty_cols, index=None, done=None, empty_note=None):
    """주문 링크 시트.

    groups: [(구획 이름, [(item, {열이름: 수식 또는 값}), ...]), ...]  — 앞으로 살 것 (합계에 들어감)
    done:   같은 모양 — 이미 산 것 (☑ 날짜 표시, 합계에 넣지 않고 참고 소계만). 행 dict에 "check" 키로 표시 글자를 줌
    qty_cols: [(열 머리, 수량 키, 금액 머리)]  — 예) [("수량", "q", "금액")] 또는 납땜·무납땜 두 쌍
    각 행: 주문함 □ · ID · 부품명 · 구매처 · 상품번호 · 단가 · (수량·금액)… · 링크 · 고르는 기준·메모
    """
    ws = wb.create_sheet("주문_링크", index) if index is not None else wb.create_sheet("주문_링크")
    put(ws, 1, 1, title, f_title, b=False, align=Alignment())
    put(ws, 2, 1, sub, f_sub, b=False, align=Alignment())
    heads = ["주문함", "ID", "부품명", "구매처", "상품번호", "단가(원)\nVAT 포함"]
    for h, _, a in qty_cols:
        heads += [h, a]
    heads += ["링크 (누르면 상품 페이지)", "고르는 기준 · 메모"]
    header(ws, 4, heads)
    ws.row_dimensions[4].height = 30
    ncol = len(heads)
    c_price = 6
    r = 4

    def write_group(gname, rows, total_label, fill):
        nonlocal r
        r += 1
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=ncol)
        put(ws, r, 1, gname, f_sec)
        g0 = r + 1
        for x, f in rows:
            r += 1
            vals = [f.get("check", "☐"), x["id"], x["name"], x.get("vendor"), x.get("productNo"), f["price"]]
            for _, key, _a in qty_cols:
                vals += [f.get(key), None]
            vals += ["상품 페이지 열기" if x.get("url") else "(링크 없음 — 매장 구매)", f.get("memo")]
            for c, v in enumerate(vals, 1):
                font = f_link if (c == ncol - 1 and x.get("url")) else f_body
                cell = put(ws, r, c, v, font, fill if c > 1 else fill_check, NUM if c >= c_price and c < ncol - 1 else None,
                           center if c in (1, 2, 5) or (c >= c_price and c < ncol - 1) else wrap)
                if c == ncol - 1 and x.get("url"):
                    cell.hyperlink = x["url"]
            # 금액 = 수량 × 단가
            col = c_price + 1
            for _ in qty_cols:
                ql = get_column_letter(col)
                pl = get_column_letter(c_price)
                put(ws, r, col + 1, f'=IF(AND(ISNUMBER({ql}{r}),ISNUMBER({pl}{r})),{ql}{r}*{pl}{r},"")', f_body, fill, NUM, center)
                col += 2
        g1 = r
        r += 1
        put(ws, r, 3, total_label, f_bold, fill_total)
        col = c_price + 1
        for _ in qty_cols:
            al = get_column_letter(col + 1)
            put(ws, r, col + 1, f"=SUM({al}{g0}:{al}{g1})", f_bold, fill_total, NUM, center)
            col += 2
        return r

    totals = []
    for gname, rows in groups:
        if rows:
            totals.append(write_group(gname, rows, f"{gname.split(' ')[0]} 소계 (VAT 포함, 가격 아는 것만)", fill_row))
    if not totals and empty_note:
        r += 1
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=ncol)
        put(ws, r, 1, empty_note, f_bold, fill_done)
        ws.row_dimensions[r].height = 30
    r += 1
    put(ws, r, 3, "앞으로 살 것 합계 (VAT 포함, 가격 미확인·배송비 제외 — 배송비는 예산 시트)", f_bold, fill_total)
    col = c_price + 1
    for _ in qty_cols:
        al = get_column_letter(col + 1)
        put(ws, r, col + 1, "=" + "+".join(f"{al}{t}" for t in totals) if totals else 0, f_bold, fill_total, NUM, center)
        col += 2
    for gname, rows in (done or []):
        if rows:
            r += 1
            write_group(gname, rows, "(참고) 이미 산 것 — 위 '앞으로 살 것 합계'에 넣지 않음, 배송비 제외", fill_done)
    w = [9, 6, 44, 14, 11, 10] + [8, 11] * len(qty_cols) + [20, 60]
    widths(ws, w)
    ws.freeze_panes = "D5"
    return ws, r
