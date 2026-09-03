# -*- coding: utf-8 -*-
"""验证 custom-tab-bar wxss 中 base64 SVG 可解码、编码合规"""
import base64, re

path = r"D:\极空间双向\#个人\我的代码\Ncard\miniprogram\custom-tab-bar\index.wxss"
css = open(path, encoding="utf-8").read()
uris = re.findall(r'base64,([A-Za-z0-9+/=]+)"', css)
print("data URI 总数:", len(uris))
assert len(uris) == 8, "应为 8 个（4 图标 x 2 色）"
last = base64.b64decode(uris[-1]).decode("utf-8")
print("user-active SVG:", last[:120], "...")
for u in uris:
    assert "#" not in u, "裸 # 泄漏"
    base64.b64decode(u)
print("OK: 8 个 base64 全部可解码，无裸 # 字符")
