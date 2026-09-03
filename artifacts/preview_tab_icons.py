# -*- coding: utf-8 -*-
"""把 8 张图标拼到白底预览图供人工验收"""
from PIL import Image
import os
OUT = r"D:/极空间双向/#个人/我的代码/Ncard/miniprogram/assets/tabbar"
names = ["card", "stack", "team", "user"]
sheet = Image.new("RGB", (96*4, 96*2), "white")
for row, suffix in enumerate(["", "-active"]):
    for col, n in enumerate(names):
        im = Image.open(os.path.join(OUT, f"{n}{suffix}.png")).convert("RGBA")
        sheet.paste(im, (col*96, row*96), im)
p = r"D:/极空间双向/#个人/我的代码/Ncard/artifacts/tab_icons_preview.png"
sheet.save(p)
print(p)
