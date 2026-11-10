#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成 App 图标。

平台会把上传的图中心裁成正方形并压到 256×256 WebP，所以这里直接按正方形构图，
用 4 倍超采样再缩，保证边缘不毛。

图形含义：三张叠起来的"页"，最上面一张是强调色，代表"从一堆材料里抽出结论"。
"""

import os
from PIL import Image, ImageDraw

SCALE = 4
SIZE = 256 * SCALE
BG = (15, 27, 45, 255)          # #0F1B2D
CARD_BACK = (28, 46, 70, 255)   # #1C2E46
CARD_MID = (34, 56, 84, 255)    # #223854
CARD_FRONT = (79, 209, 197, 255)  # #4FD1C5
INK = (15, 27, 45, 255)


def rounded(size, radius, fill):
    img = Image.new('RGBA', size, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=fill)
    return img


def main():
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))

    # 背景圆角方块（约 22% 圆角，接近 iOS 视觉）
    bg = rounded((SIZE, SIZE), int(SIZE * 0.22), BG)
    canvas.alpha_composite(bg)

    u = SIZE / 256.0  # 以 256 为设计单位换算

    def card(x, y, w, h, color, radius):
        layer = rounded((int(w * u), int(h * u)), int(radius * u), color)
        canvas.alpha_composite(layer, (int(x * u), int(y * u)))

    # 三张叠放的页，从后往前
    card(56, 72, 116, 76, CARD_BACK, 8)
    card(68, 86, 116, 76, CARD_MID, 8)
    card(80, 100, 116, 76, CARD_FRONT, 8)

    # 最上面那张里的三行"文字"
    d = ImageDraw.Draw(canvas)
    lines = [(96, 118, 44), (96, 132, 60), (96, 146, 34)]
    for lx, ly, lw in lines:
        d.rounded_rectangle(
            [int(lx * u), int(ly * u), int((lx + lw) * u), int((ly + 7) * u)],
            radius=int(3.5 * u),
            fill=INK,
        )

    out_dir = os.path.join(os.path.dirname(__file__), '..', 'assets')
    os.makedirs(out_dir, exist_ok=True)
    big = os.path.join(out_dir, 'logo-1024.png')
    small = os.path.join(out_dir, 'logo-256.png')
    canvas.resize((1024, 1024), Image.LANCZOS).save(big)
    canvas.resize((256, 256), Image.LANCZOS).save(small)
    print('wrote', big)
    print('wrote', small)


if __name__ == '__main__':
    main()
