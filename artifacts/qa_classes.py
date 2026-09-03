import re, os
BASE = r"D:\极空间双向\#个人\我的代码\Ncard\miniprogram"

app_classes = set()
with open(os.path.join(BASE, "app.wxss"), encoding="utf-8") as f:
    app_classes |= set(re.findall(r'\.([A-Za-z_][\w-]*)', f.read()))

missing_all = {}
for root, dirs, files in os.walk(BASE):
    for fn in files:
        if not fn.endswith(".wxml"):
            continue
        wxml = os.path.join(root, fn)
        wxss = wxml[:-5] + ".wxss"
        page_classes = set()
        if os.path.exists(wxss):
            with open(wxss, encoding="utf-8") as f:
                page_classes = set(re.findall(r'\.([A-Za-z_][\w-]*)', f.read()))
        with open(wxml, encoding="utf-8") as f:
            content = f.read()
        used = set()
        for m in re.finditer(r'\bclass="([^"]+)"', content):
            expr = m.group(1)
            if "{{" in expr:
                continue  # 动态表达式跳过（人工核对）
            for c in expr.split():
                used.add(c)
        miss = sorted(used - page_classes - app_classes)
        if miss:
            missing_all[os.path.relpath(wxml, BASE)] = miss

if missing_all:
    for f, miss in missing_all.items():
        print(f, "->", ", ".join(miss))
else:
    print("ALL CLASSES DEFINED")
