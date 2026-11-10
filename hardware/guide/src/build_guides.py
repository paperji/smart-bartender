# -*- coding: utf-8 -*-
"""제작가이드 두 벌(납땜 기준 / 무납땜 기준)을 한 원본에서 만든다.

사용: python build_guides.py
- 원본: src/제작가이드.src.md
- 결과: 제작가이드_납땜기준.md/.html, 제작가이드_무납땜기준.md/.html (hardware/guide/)

원본 표기
- 줄 하나에 <!--S--> … <!--/S-->  : 납땜 기준에만 들어가는 줄
- 줄 하나에 <!--N--> … <!--/N-->  : 무납땜 기준에만 들어가는 줄
- 줄 안에서 ⟦납땜 기준 글¦무납땜 기준 글⟧ : 기준마다 다른 글 (한쪽은 비워도 됨)
"""
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
GUIDE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import md2html  # noqa: E402

SRC = os.path.join(HERE, '제작가이드.src.md')
VARIANTS = {
    'S': ('제작가이드_납땜기준', 'smartbartender-guide-solder-v1'),
    'N': ('제작가이드_무납땜기준', 'smartbartender-guide-nosolder-v1'),
}
INLINE = re.compile(r'⟦([^⟦⟧¦]*)¦([^⟦⟧¦]*)⟧')


def render_variant(text, var):
    out, mode = [], None
    for no, line in enumerate(text.split('\n'), 1):
        st = line.strip()
        if st in ('<!--S-->', '<!--N-->'):
            if mode:
                raise SystemExit(f'{no}행: 블록 안에 블록 ({st})')
            mode = st[4]
            continue
        if st in ('<!--/S-->', '<!--/N-->'):
            if mode != st[5]:
                raise SystemExit(f'{no}행: 짝이 맞지 않는 닫기 ({st})')
            mode = None
            continue
        if mode and mode != var:
            continue
        line = INLINE.sub(lambda m: m.group(1) if var == 'S' else m.group(2), line)
        if any(c in line for c in '⟦⟧¦'):
            raise SystemExit(f'{no}행: 처리되지 않은 ⟦…¦…⟧ 표기: {line[:80]}')
        out.append(line)
    if mode:
        raise SystemExit('닫히지 않은 블록')
    md = '\n'.join(out)
    md = re.sub(r'\n{3,}', '\n\n', md)
    return md


def check_md(md, name):
    ids = set(re.findall(r'\{#([\w\-]+)\}', md))
    bad = [a for a in re.findall(r'\]\(#([\w\-]+)\)', md) if a not in ids]
    figs = [f for f in re.findall(r'!\[[^\]]*\]\((figures/[^)]+)\)', md) if not os.path.exists(os.path.join(GUIDE, f))]
    files = []
    for f in re.findall(r'\]\((?!#|https?:)([^)#\s]+)', md):
        if not os.path.exists(os.path.normpath(os.path.join(GUIDE, f))):
            files.append(f)
    for label, lst in (('없는 앵커', bad), ('없는 그림', figs), ('없는 파일 링크', files)):
        if lst:
            raise SystemExit(f'{name}: {label} {sorted(set(lst))}')
    if '<!--' in md.replace('<!-- pagebreak -->', ''):
        raise SystemExit(f'{name}: 남은 주석 표기')


def main():
    text = open(SRC, encoding='utf-8').read()
    done = []
    for var, (base, key) in VARIANTS.items():
        md = render_variant(text, var)
        p_md = os.path.join(GUIDE, base + '.md')
        with open(p_md, 'w', encoding='utf-8', newline='\n') as f:
            f.write(md)
        done.append((md, base, key, p_md))
    for md, base, key, p_md in done:  # 두 파일을 다 쓴 뒤 서로의 링크까지 검사
        check_md(md, base)
        md2html.render(p_md, os.path.join(GUIDE, base + '.html'), key)


if __name__ == '__main__':
    main()
