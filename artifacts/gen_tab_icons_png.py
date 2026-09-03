# -*- coding: utf-8 -*-
"""生成 tab bar PNG 图标：4 图标 x 灰/蓝双色，96x96（4x 超采样绘制后缩小抗锯齿）"""
from PIL import Image, ImageDraw
import os

GRAY = "#64748B"
BLUE = "#3B82F6"
OUT = r"D:/极空间双向/#个人/我的代码/Ncard/miniprogram/assets/tabbar"
S = 384  # 超采样画布
W = 32   # 描边宽度（对应 24 viewBox stroke=2 缩放到 96px 后的 4x）

def new_img():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)

def draw_card(d):
    d.rounded_rectangle([24, 48, 360, 336], radius=48, outline=1, width=W)
    d.line([104, 152, 264, 152], fill=1, width=W)
    d.line([104, 232, 216, 232], fill=1, width=W)

def draw_stack(d):
    # 上层菱形
    d.line([192, 48, 344, 128, 192, 208, 40, 128, 192, 48], fill=1, width=W, joint="curve")
    # 下层 chevron
    d.line([56, 216, 192, 288, 328, 216], fill=1, width=W, joint="curve")

def draw_team(d):
    # 主人：头+肩
    d.ellipse([104, 64, 248, 208], outline=1, width=W)
    d.arc([32, 232, 320, 520], start=180, end=360, fill=1, width=W)
    # 副人：半头+半肩
    d.arc([248, 88, 352, 192], start=270, end=90, fill=1, width=W)
    d.arc([264, 248, 416, 400], start=250, end=340, fill=1, width=W)

def draw_user(d):
    d.ellipse([104, 48, 280, 224], outline=1, width=W)
    d.arc([32, 264, 352, 584], start=180, end=360, fill=1, width=W)

ICONS = {"card": draw_card, "stack": draw_stack, "team": draw_team, "user": draw_user}

os.makedirs(OUT, exist_ok=True)
for name, fn in ICONS.items():
    for suffix, color in [("", GRAY), ("-active", BLUE)]:
        img, d = new_img()
        # 把当前画笔颜色设为 1 再替换：直接用 color 画
        img, d = new_img()
        # 重新以颜色绘制
        def fn_color(dd):
            pass
        # 逐条指令以 color 重画：简单做法是画时 fill/outline 传 color
        fn_draw = fn
        # wrap: 调 fn 但把 fill=1/outline=1 映射为 color —— 直接画两遍代价低，改用 monkeypatch
        class D2:
            def __init__(self, d, c): self.d, self.c = d, c
            def rounded_rectangle(self, *a, **k): k["outline"] = self.c; self.d.rounded_rectangle(*a, **k)
            def line(self, *a, **k): k["fill"] = self.c; self.d.line(*a, **k)
            def ellipse(self, *a, **k): k["outline"] = self.c; self.d.ellipse(*a, **k)
            def arc(self, *a, **k): k["fill"] = self.c; self.d.arc(*a, **k)
        fn_draw(D2(d, color))
        img = img.resize((96, 96), Image.LANCZOS)
        img.save(os.path.join(OUT, f"{name}{suffix}.png"))
        print(f"{name}{suffix}.png  saved")

# 校验
for f in sorted(os.listdir(OUT)):
    p = os.path.join(OUT, f)
    im = Image.open(p)
    print(f, im.size, im.mode, os.path.getsize(p), "bytes")
