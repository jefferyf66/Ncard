# -*- coding: utf-8 -*-
"""重新生成 tab 图标：SVG 加显式 width/height（避免 background-size 失效时按无界尺寸渲染），并重写 index.wxss 图标段"""
import base64, re

GRAY = "#64748B"
BLUE = "#3B82F6"

def svg(body, color):
    # 显式 width/height：即便 background-size 被解析失败也有内定尺寸兜底
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" '
            f'stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{body}</svg>')

ICONS = {
    "card": '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="M6.5 9.5h7M6.5 13.5h4.5"/>',
    "stack": '<path d="M12 3.5L3 8l9 4.5L21 8l-9-4.5z"/><path d="M3.5 13l8.5 4.5L20.5 13"/>',
    "team": '<circle cx="9" cy="8" r="3.25"/><path d="M3.5 19.5c0-3 2.4-5 5.5-5s5.5 2 5.5 5"/><path d="M15.5 5.3a3.25 3.25 0 010 5.4"/><path d="M17.5 14.8c2 .6 3.2 2.2 3.2 4.7"/>',
    "user": '<circle cx="12" cy="8" r="3.75"/><path d="M4.5 20c0-3.6 3.2-6 7.5-6s7.5 2.4 7.5 6"/>',
}
TITLES = {"card": "名片", "stack": "名片夹", "team": "团队", "user": "我的"}

def b64(s):
    return base64.b64encode(s.encode("utf-8")).decode("ascii")

lines = ["/* ===== SVG 图标（未选中 #64748B / 选中 #3B82F6），由 artifacts/regen_tab_icons.py 生成 ===== */"]
for name, body in ICONS.items():
    lines.append(f"/* {name} {TITLES[name]} */")
    lines.append(f'.icon-{name} {{ background-image: url("data:image/svg+xml;base64,{b64(svg(body, GRAY))}"); }}')
    lines.append(f'.tab-item.active .icon-{name} {{ background-image: url("data:image/svg+xml;base64,{b64(svg(body, BLUE))}"); }}')
    lines.append("")
block = "\n".join(lines).rstrip() + "\n"

path = r"D:/极空间双向/#个人/我的代码/Ncard/miniprogram/custom-tab-bar/index.wxss"
css = open(path, encoding="utf-8").read()
new_css, n = re.subn(r'/\* ===== SVG 图标.*$', block, css, flags=re.S)
assert n == 1, "icon block not found"
open(path, "w", encoding="utf-8", newline="\n").write(new_css)
print("icon block rewritten")

# 验证
css2 = open(path, encoding="utf-8").read()
uris = re.findall(r'base64,([A-Za-z0-9+/=]+?)"\)', css2)
print("data URI count:", len(uris))
for u in uris:
    s = base64.b64decode(u).decode("utf-8")
    assert 'width="24" height="24"' in s
print("OK: 8 URIs decoded, all carry explicit width/height")
