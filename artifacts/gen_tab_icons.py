# -*- coding: utf-8 -*-
"""生成 custom-tab-bar SVG base64 图标 wxss 片段"""
import base64

GRAY = "#64748B"   # 未选中（slate 统一）
BLUE = "#3B82F6"   # 选中（品牌蓝）

def svg(body, color):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
            f'stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{body}</svg>')

ICONS = {
    # 名片：卡片 + 两行信息
    "card": '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="M6.5 9.5h7M6.5 13.5h4.5"/>',
    # 名片夹：两层叠卡（layers）
    "stack": '<path d="M12 3.5L3 8l9 4.5L21 8l-9-4.5z"/><path d="M3.5 13l8.5 4.5L20.5 13"/>',
    # 团队：双人
    "team": '<circle cx="9" cy="8" r="3.25"/><path d="M3.5 19.5c0-3 2.4-5 5.5-5s5.5 2 5.5 5"/><path d="M15.5 5.3a3.25 3.25 0 010 5.4"/><path d="M17.5 14.8c2 .6 3.2 2.2 3.2 4.7"/>',
    # 我的：单人
    "user": '<circle cx="12" cy="8" r="3.75"/><path d="M4.5 20c0-3.6 3.2-6 7.5-6s7.5 2.4 7.5 6"/>',
}

def b64(s):
    return base64.b64encode(s.encode("utf-8")).decode("ascii")

for name, body in ICONS.items():
    normal = b64(svg(body, GRAY))
    active = b64(svg(body, BLUE))
    print(f'/* {name} */')
    print(f'.icon-{name} {{ background-image: url("data:image/svg+xml;base64,{normal}"); }}')
    print(f'.tab-item.active .icon-{name} {{ background-image: url("data:image/svg+xml;base64,{active}"); }}')
    print()
