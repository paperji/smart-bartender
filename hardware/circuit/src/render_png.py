# -*- coding: utf-8 -*-
"""SVG → PNG (Microsoft Edge 헤드리스 스크린샷).

사용법: python render_png.py schematic.svg schematic.png [scale]
- SVG viewBox(1800x1200) 크기 창에 SVG를 꽉 채워 띄운 뒤 device-scale-factor 배율로 캡처
- Edge 프로필은 임시 폴더를 사용(사용자 프로필을 건드리지 않음)
"""
import os
import re
import subprocess
import sys
import tempfile

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def render(svg_path, png_path, scale=2.0):
    svg_path = os.path.abspath(svg_path)
    png_path = os.path.abspath(png_path)
    svg = open(svg_path, encoding="utf-8").read()
    m = re.search(r'viewBox="0 0 (\d+) (\d+)"', svg)
    w, h = int(m.group(1)), int(m.group(2))
    tmp = tempfile.mkdtemp(prefix="svgshot_")
    html = os.path.join(tmp, "page.html")
    with open(html, "w", encoding="utf-8") as f:
        f.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}'
                f'svg{{display:block;width:{w}px;height:{h}px}}</style></head><body>' + svg + "</body></html>")
    cmd = [EDGE, "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
           f"--user-data-dir={os.path.join(tmp, 'profile')}", f"--window-size={w},{h}",
           f"--force-device-scale-factor={scale}", f"--screenshot={png_path}", "file:///" + html.replace("\\", "/")]
    subprocess.run(cmd, check=True, capture_output=True, timeout=120)
    return png_path


if __name__ == "__main__":
    sc = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
    print(render(sys.argv[1], sys.argv[2], sc))
