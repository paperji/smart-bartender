# -*- coding: utf-8 -*-
"""가이드 .md → .html (오프라인 단일 페이지, 인라인 SVG, A4 인쇄용).
이 가이드에서 쓰는 마크다운 문법만 지원하는 작은 변환기입니다.

사용: python md2html.py 원본.md 결과.html [체크 저장 키]
(그림 경로는 hardware/guide 기준 — figures/…)"""
import html
import os
import re
import sys

GUIDE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

fig_count = [0]
heading_ids = []


# ------------------------------------------------------------------ inline
def inline(s):
    codes = []

    def keep_code(m):
        codes.append('<code>' + html.escape(m.group(1)) + '</code>')
        return f'\x00{len(codes) - 1}\x00'

    s = re.sub(r'`([^`]+)`', keep_code, s)
    s = html.escape(s, quote=False)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<em>\1</em>', s)
    s = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', lambda m: f'<a href="{m.group(2)}">{m.group(1)}</a>', s)
    s = s.replace('[ ]', '<input type="checkbox" class="ck">')
    s = re.sub(r'\x00(\d+)\x00', lambda m: codes[int(m.group(1))], s)
    return s


# ------------------------------------------------------------------ figures
def svg_inline(path, prefix):
    with open(path, encoding='utf-8') as f:
        svg = f.read()
    svg = re.sub(r'<\?xml[^>]*\?>', '', svg)
    svg = re.sub(r'id="([^"]+)"', lambda m: f'id="{prefix}-{m.group(1)}"', svg)
    svg = svg.replace('url(#', f'url(#{prefix}-')
    svg = re.sub(r'(<svg[^>]*?)\s+width="[\d.]+"\s+height="[\d.]+"', r'\1', svg, count=1)
    svg = svg.replace('<svg ', '<svg role="img" preserveAspectRatio="xMidYMid meet" ', 1)
    return svg


def figure(alt, src):
    fig_count[0] += 1
    p = os.path.normpath(os.path.join(GUIDE, src))
    cap = html.escape(alt)
    if src.lower().endswith('.svg') and os.path.exists(p):
        body = svg_inline(p, f'fig{fig_count[0]}')
    else:
        body = f'<img src="{html.escape(src)}" alt="{cap}">'
    return f'<figure>{body}<figcaption>{cap} <span class="src">({html.escape(src)})</span></figcaption></figure>'


# ------------------------------------------------------------------ blocks
LIST_RE = re.compile(r'^( *)([-*]|\d+\.)\s+(.*)$')


def indent_of(line):
    return len(line) - len(line.lstrip(' '))


def parse(lines, quote=False):
    out = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        st = line.strip()
        if not st:
            i += 1
            continue
        if st == '<!-- pagebreak -->':
            out.append('<div class="pb"></div>')
            i += 1
            continue
        if st.startswith('```'):
            j = i + 1
            buf = []
            while j < n and not lines[j].strip().startswith('```'):
                buf.append(lines[j])
                j += 1
            out.append('<pre><code>' + html.escape('\n'.join(buf)) + '</code></pre>')
            i = j + 1
            continue
        m = re.match(r'^(#{1,6})\s+(.*?)\s*(\{#([\w\-]+)\})?\s*$', st)
        if m and not line.startswith(' '):
            lvl = len(m.group(1))
            text = m.group(2)
            hid = m.group(4) or f'h{len(heading_ids) + 1}'
            heading_ids.append((lvl, hid, text))
            cls = ' class="step"' if (lvl == 3 and text.startswith('STEP')) else ''
            out.append(f'<h{lvl} id="{hid}"{cls}>{inline(text)}</h{lvl}>')
            i += 1
            continue
        if re.match(r'^-{3,}$', st):
            out.append('<hr>')
            i += 1
            continue
        mi = re.match(r'^!\[([^\]]*)\]\(([^)]+)\)$', st)
        if mi:
            out.append(figure(mi.group(1), mi.group(2)))
            i += 1
            continue
        if st.startswith('>'):
            buf = []
            while i < n and lines[i].strip().startswith('>'):
                buf.append(re.sub(r'^\s*> ?', '', lines[i]))
                i += 1
            inner = parse(buf, quote=True)
            first = buf[0].strip() if buf else ''
            cls = 'warn' if first.startswith('⚠') else ('goal' if first.startswith('**목표**') else 'note')
            out.append(f'<blockquote class="{cls}">{inner}</blockquote>')
            continue
        if st.startswith('|'):
            rows = []
            while i < n and lines[i].strip().startswith('|'):
                rows.append(lines[i].strip())
                i += 1
            out.append(table(rows))
            continue
        lm = LIST_RE.match(line)
        if lm:
            i, h = parse_list(lines, i)
            out.append(h)
            continue
        # paragraph
        buf = [st]
        i += 1
        while i < n:
            nx = lines[i]
            ns = nx.strip()
            if (not ns or ns.startswith(('#', '|', '>', '```', '![', '<!--')) or LIST_RE.match(nx)
                    or re.match(r'^-{3,}$', ns)):
                break
            buf.append(ns)
            i += 1
        joiner = '<br>' if quote else ' '
        out.append('<p>' + joiner.join(inline(b) for b in buf) + '</p>')
    return '\n'.join(out)


def parse_list(lines, i):
    first = LIST_RE.match(lines[i])
    base = len(first.group(1))
    ordered = first.group(2)[0].isdigit()
    start = int(first.group(2)[:-1]) if ordered else 1
    items = []
    n = len(lines)
    while i < n:
        m = LIST_RE.match(lines[i])
        if not m or len(m.group(1)) != base or m.group(2)[0].isdigit() != ordered:
            break
        content_indent = len(m.group(1)) + len(m.group(2)) + 1
        buf = [m.group(3)]
        i += 1
        while i < n:
            ln = lines[i]
            if not ln.strip():
                # 빈 줄 다음이 같은 목록의 들여쓴 내용이면 계속
                j = i + 1
                if j < n and lines[j].strip() and indent_of(lines[j]) > base:
                    buf.append('')
                    i += 1
                    continue
                break
            ind = indent_of(ln)
            mm = LIST_RE.match(ln)
            if mm and len(mm.group(1)) == base:
                break
            if ind <= base and not mm:
                break
            if ind <= base:
                break
            buf.append(ln[min(ind, content_indent):] if ind >= content_indent else ln.strip())
            i += 1
        items.append(buf)
    tag = 'ol' if ordered else 'ul'
    st = f' start="{start}"' if ordered and start != 1 else ''
    parts = []
    for buf in items:
        task = done = False
        if buf[0].startswith('[ ] '):
            task = True
            buf[0] = buf[0][4:]
        elif buf[0].startswith('[x] '):          # 이미 끝낸 항목: 체크된 채로, 글자는 지우지 않음
            task = done = True
            buf[0] = buf[0][4:]
        if len(buf) == 1:
            inner = inline(buf[0])
        else:
            head = [buf[0]]
            k = 1
            while k < len(buf) and buf[k].strip() and not LIST_RE.match(buf[k]) and not buf[k].startswith(' '):
                head.append(buf[k])
                k += 1
            inner = ' '.join(inline(h) for h in head)
            rest = buf[k:]
            if rest:
                inner += parse(rest)
        if task:
            parts.append(f'<li class="task{" done" if done else ""}"><label><input type="checkbox" class="ck"{" checked" if done else ""}> <span>{inner}</span></label></li>')
        else:
            parts.append(f'<li>{inner}</li>')
    cls = ' class="tasks"' if all(p.startswith('<li class="task') for p in parts) else ''
    return i, f'<{tag}{st}{cls}>' + ''.join(parts) + f'</{tag}>'


def table(rows):
    def cells(r):
        r = r.strip()
        if r.startswith('|'):
            r = r[1:]
        if r.endswith('|'):
            r = r[:-1]
        return [c.strip() for c in r.split('|')]

    head = cells(rows[0])
    aligns = []
    body_rows = rows[1:]
    if body_rows and re.match(r'^\|?\s*:?-+:?\s*\|', body_rows[0]):
        for c in cells(body_rows[0]):
            if c.startswith(':') and c.endswith(':'):
                aligns.append('center')
            elif c.endswith(':'):
                aligns.append('right')
            else:
                aligns.append('')
        body_rows = body_rows[1:]
    al = lambda k: f' style="text-align:{aligns[k]}"' if k < len(aligns) and aligns[k] else ''
    h = ['<div class="tw"><table><thead><tr>']
    h += [f'<th{al(k)}>{inline(c)}</th>' for k, c in enumerate(head)]
    h.append('</tr></thead><tbody>')
    for r in body_rows:
        h.append('<tr>' + ''.join(f'<td{al(k)}>{inline(c)}</td>' for k, c in enumerate(cells(r))) + '</tr>')
    h.append('</tbody></table></div>')
    return ''.join(h)


CSS = r'''
:root{--ink:#1f2933;--sub:#52606d;--line:#d9e2ec;--acc:#e8590c;--blue:#1c7ed6;--bg:#f8fafc}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:'Malgun Gothic','맑은 고딕','Noto Sans KR','NanumGothic',sans-serif;color:var(--ink);
 font-size:15px;line-height:1.65;background:#eef2f6}
main{max-width:980px;margin:0 auto;background:#fff;padding:36px 48px 80px;box-shadow:0 0 0 1px var(--line)}
h1{font-size:28px;line-height:1.3;margin:0 0 12px;color:#102a43}
h2{font-size:22px;margin:40px 0 14px;padding:6px 0 6px 12px;border-left:6px solid var(--acc);background:linear-gradient(90deg,#fff4e6,#fff)}
h3{font-size:18px;margin:28px 0 10px;color:#243b53}
h3.step{background:#102a43;color:#fff;padding:10px 14px;border-radius:8px;margin-top:8px}
h4{font-size:16px;margin:22px 0 8px;color:#334e68;border-bottom:1px solid var(--line);padding-bottom:3px}
p{margin:8px 0}
a{color:var(--blue);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:Consolas,'D2Coding','Courier New',monospace;font-size:.9em;background:#f1f3f5;border:1px solid #e9ecef;
 border-radius:4px;padding:0 4px;word-break:break-all}
pre{background:#f1f3f5;border-radius:6px;padding:10px 12px;white-space:pre-wrap;word-break:break-all}
pre code{border:0;background:none;padding:0}
blockquote{margin:12px 0;padding:10px 14px;border-radius:8px;background:var(--bg);border:1px solid var(--line)}
blockquote.goal{background:#e7f5ff;border-color:#a5d8ff}
blockquote.warn{background:#fff5f5;border-color:#ffc9c9}
blockquote p{margin:2px 0}
blockquote ul{margin:4px 0}
ul,ol{padding-left:26px;margin:6px 0}
li{margin:3px 0}
ul.tasks{list-style:none;padding-left:4px}
li.task label{display:flex;gap:8px;align-items:flex-start;cursor:pointer}
li.task input{margin-top:5px}
input.ck{width:15px;height:15px;accent-color:#2b8a3e;flex:0 0 auto;vertical-align:-2px}
li.task input:checked + span{color:#7b8794;text-decoration:line-through}
li.task.done input:checked + span{color:inherit;text-decoration:none}
.tw{overflow-x:auto;margin:10px 0}
table{border-collapse:collapse;width:100%;font-size:13.5px;line-height:1.45}
th,td{border:1px solid #cbd2d9;padding:5px 7px;vertical-align:top}
th{background:#f0f4f8;text-align:left;font-weight:bold}
tbody tr:nth-child(even){background:#fbfcfd}
figure{margin:16px 0;padding:8px;border:1px solid var(--line);border-radius:8px;background:#fff}
figure svg,figure img{display:block;width:100%;height:auto}
figcaption{font-size:13px;font-weight:bold;color:#334e68;margin-top:6px;text-align:center}
figcaption .src{font-weight:normal;color:#9aa5b1;font-size:11px}
hr{border:0;border-top:1px solid var(--line);margin:28px 0}
h2#toc + ul{columns:2;column-gap:28px}
h2#toc + ul > li{break-inside:avoid}
.pb{height:0}
#toolbar{position:sticky;top:0;z-index:5;display:flex;gap:8px;justify-content:flex-end;padding:8px 0;background:#fff}
#toolbar button{font:inherit;font-size:13px;padding:6px 12px;border:1px solid #bcccdc;border-radius:6px;background:#fff;cursor:pointer}
#toolbar button:hover{background:#f0f4f8}
#side{position:fixed;top:0;left:0;width:250px;height:100vh;overflow-y:auto;padding:18px 14px;font-size:13px;background:#fff;
 border-right:1px solid var(--line);display:none}
#side b{display:block;margin-bottom:8px;font-size:14px}
#side a{display:block;color:var(--ink);padding:2px 4px;border-radius:4px}
#side a.l3{padding-left:16px;color:var(--sub);font-size:12.5px}
#side a:hover{background:#f0f4f8;text-decoration:none}
@media (min-width:1500px){#side{display:block} main{margin-left:calc(250px + (100vw - 250px - 980px)/2)}}
@media print{
 @page{size:A4;margin:12mm 11mm 13mm}
 body{background:#fff;font-size:10.2pt;line-height:1.5}
 main{max-width:none;margin:0;padding:0;box-shadow:none}
 #side,#toolbar{display:none !important}
 a{color:inherit}
 h2{margin-top:0;break-after:avoid}
 h3,h4{break-after:avoid}
 h3.step{-webkit-print-color-adjust:exact;print-color-adjust:exact}
 .pb{break-after:page}
 figure{break-inside:avoid;padding:4px;margin:8px 0}
 figure svg{max-height:225mm}
 table{font-size:8.6pt}
 tr,li,blockquote{break-inside:avoid}
 blockquote,th,tbody tr:nth-child(even),h2{-webkit-print-color-adjust:exact;print-color-adjust:exact}
 input.ck{width:11px;height:11px;accent-color:auto}
 li.task input:checked + span{text-decoration:none;color:inherit}
}
'''

JS = r'''
(function(){
  var KEY='__KEY__';
  var boxes=[].slice.call(document.querySelectorAll('input.ck'));
  var saved={};
  try{saved=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
  boxes.forEach(function(b,i){ if(i in saved) b.checked=!!saved[i];
    b.addEventListener('change',function(){saved[i]=b.checked; try{localStorage.setItem(KEY,JSON.stringify(saved))}catch(e){} upd();});});
  var cnt=document.getElementById('cnt');
  function upd(){ if(!cnt) return; var c=boxes.filter(function(b){return b.checked}).length; cnt.textContent='체크 '+c+' / '+boxes.length; }
  upd();
  document.getElementById('bprint').onclick=function(){window.print()};
  document.getElementById('breset').onclick=function(){ if(confirm('체크 표시를 모두 지울까요?')){ saved={}; boxes.forEach(function(b,i){b.checked=false; saved[i]=false}); try{localStorage.setItem(KEY,JSON.stringify(saved))}catch(e){} upd(); } };
})();
'''


def render(src, dst, key='smartbartender-guide-checks-v2'):
    fig_count[0] = 0
    heading_ids.clear()
    with open(src, encoding='utf-8') as f:
        md = f.read()
    lines = md.split('\n')
    title = re.sub(r'^#\s+', '', lines[0]).strip()
    body = parse(lines)
    side = ['<nav id="side"><b>목차</b>']
    for lvl, hid, text in heading_ids:
        if lvl == 2 or (lvl == 3 and text.startswith('STEP')):
            t = re.sub(r'[*`]', '', text)
            side.append(f'<a class="l{lvl}" href="#{hid}">{html.escape(t)}</a>')
    side.append('</nav>')
    doc = f'''<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>{CSS}</style>
</head>
<body>
{''.join(side)}
<main>
<div id="toolbar"><span id="cnt" style="margin-right:auto;font-size:13px;color:#52606d;align-self:center"></span>
<button id="breset" type="button">체크 초기화</button><button id="bprint" type="button">인쇄 / PDF 저장 (A4)</button></div>
{body}
</main>
<script>{JS.replace('__KEY__', key)}</script>
</body>
</html>
'''
    with open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(doc)
    print(os.path.basename(dst), '— figures inlined:', fig_count[0], 'headings:', len(heading_ids), 'bytes:', len(doc.encode('utf-8')))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    render(sys.argv[1], sys.argv[2], *(sys.argv[3:4]))
