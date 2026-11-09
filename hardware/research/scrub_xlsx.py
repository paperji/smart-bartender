# -*- coding: utf-8 -*-
"""엑셀이 저장하며 넣은 개인 정보(작성자·마지막 수정자·회사·로컬 경로)를 xlsx에서 지운다.

사용: python scrub_xlsx.py 파일.xlsx [...]
공개 저장소에 올리기 전에 실행한다. 셀 값·수식·서식·캐시 값은 그대로 둔다.
"""
import re
import shutil
import sys
import tempfile
import zipfile

PATTERNS = {
    "docProps/core.xml": [
        (re.compile(r"<dc:creator>.*?</dc:creator>", re.S), "<dc:creator></dc:creator>"),
        (re.compile(r"<cp:lastModifiedBy>.*?</cp:lastModifiedBy>", re.S), "<cp:lastModifiedBy></cp:lastModifiedBy>"),
    ],
    "docProps/app.xml": [
        (re.compile(r"<Company>.*?</Company>", re.S), "<Company></Company>"),
        (re.compile(r"<Manager>.*?</Manager>", re.S), "<Manager></Manager>"),
    ],
    "xl/workbook.xml": [
        (re.compile(r"<mc:AlternateContent[^>]*>\s*<mc:Choice Requires=\"x15ac\">\s*<x15ac:absPath[^>]*/>\s*</mc:Choice>\s*</mc:AlternateContent>", re.S), ""),
        (re.compile(r"<x15ac:absPath[^>]*/>"), ""),
    ],
}


def scrub(path):
    tmp = tempfile.mktemp(suffix=".xlsx")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename in PATTERNS:
                text = data.decode("utf-8")
                for pat, rep in PATTERNS[info.filename]:
                    text = pat.sub(rep, text)
                data = text.encode("utf-8")
            zout.writestr(info, data)
    shutil.move(tmp, path)
    with zipfile.ZipFile(path) as z:
        core = z.read("docProps/core.xml").decode("utf-8")
        wbx = z.read("xl/workbook.xml").decode("utf-8")
    left = re.findall(r"<(?:dc:creator|cp:lastModifiedBy)>([^<]+)<", core)
    if left or "absPath" in wbx or "Users\\" in wbx:
        raise SystemExit(f"지우지 못함: {path}")
    print("scrubbed", path)


if __name__ == "__main__":
    for f in sys.argv[1:]:
        scrub(f)
