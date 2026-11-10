#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
PPTX 几何检查：把每页的 shape 边界换算成 EMU，校验是否越界、是否有空页。

本机没有 PowerPoint，看不到渲染结果，但"元素跑出画布"这类错误不需要眼睛——
它一定表现为坐标越界。这个脚本用比 PNG 截图更便宜的代价挡住最常见的一类导出事故。

用法：python tools/check-pptx.py out/xxx.pptx
"""

import re
import sys
import zipfile

EMU_PER_IN = 914400
CANVAS_W = 10 * EMU_PER_IN
CANVAS_H = int(5.625 * EMU_PER_IN)
TOL = 20000  # 约 0.02 英寸，容纳四舍五入

OFF = re.compile(r'<a:off x="(-?\d+)" y="(-?\d+)"/>')
EXT = re.compile(r'<a:ext cx="(-?\d+)" cy="(-?\d+)"/>')


def check(path):
    z = zipfile.ZipFile(path)
    slides = sorted(
        [n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)],
        key=lambda n: int(re.search(r'(\d+)', n.split('/')[-1]).group(1)),
    )
    problems = []
    shapes_total = 0
    for name in slides:
        xml = z.read(name).decode('utf-8')
        offs = [(int(x), int(y)) for x, y in OFF.findall(xml)]
        exts = [(int(cx), int(cy)) for cx, cy in EXT.findall(xml)]
        shapes_total += len(exts)
        n = int(re.search(r'slide(\d+)', name).group(1))
        if not exts:
            problems.append(f'slide{n}: 没有任何图形')
        for i, ((x, y), (cx, cy)) in enumerate(zip(offs, exts)):
            if x < -TOL or y < -TOL:
                problems.append(f'slide{n} shape{i}: 起点为负 ({x},{y})')
            if x + cx > CANVAS_W + TOL:
                problems.append(f'slide{n} shape{i}: 右越界 {(x + cx) / EMU_PER_IN:.2f}in > 10in')
            if y + cy > CANVAS_H + TOL:
                problems.append(f'slide{n} shape{i}: 下越界 {(y + cy) / EMU_PER_IN:.2f}in > 5.625in')
    return slides, shapes_total, problems


def main():
    if len(sys.argv) < 2:
        print('用法: python tools/check-pptx.py <file.pptx> [...]')
        return 2
    failed = 0
    for path in sys.argv[1:]:
        slides, shapes, problems = check(path)
        name = path.split('/')[-1].split('\\')[-1]
        head = f'{name}: {len(slides)} 页 / {shapes} 个图形'
        if problems:
            failed += 1
            print(f'✗ {head}')
            for p in problems[:12]:
                print('   ', p)
            if len(problems) > 12:
                print(f'    …还有 {len(problems) - 12} 条')
        else:
            print(f'✓ {head}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
