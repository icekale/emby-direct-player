#!/usr/bin/env python3
"""生成 app.ico（窗口/任务栏图标）。只在没有 app.ico 时跑一次，改图标就用它重生成。

样式：Emby 绿圆角方块 + 白色播放三角（四个尺寸分别画，小图标才不糊）。
"""
from PIL import Image, ImageDraw

GREEN = (82, 181, 75, 255)
OUT = "app.ico"


def draw(size):
    # 4x 超采样再缩，边缘干净
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=GREEN)
    # 播放三角
    cx, cy = s * 0.54, s * 0.5
    w, h = s * 0.30, s * 0.34
    d.polygon([(cx - w, cy - h), (cx - w, cy + h), (cx + w * 0.9, cy)], fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    sizes = [16, 32, 48, 64, 128, 256]
    imgs = [draw(s) for s in sizes]
    imgs[-1].save(OUT, sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
    print("wrote", OUT)
