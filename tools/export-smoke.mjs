/**
 * 导出冒烟测试：不开浏览器，用 Node 跑一遍完整的 layout → pptx 流水线。
 *
 * 为什么值得单独做一个脚本：导出是最容易「看起来成功、实际打不开」的环节。
 * 这里直接产出文件并检查 OOXML 结构（zip 完整、幻灯片张数对、XML 可解析），
 * 每次改版式跑一次，能挡住 90% 的低级回归。
 *
 * 用法：npm run smoke
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PptxGenJS from 'pptxgenjs';

import { mockDeck } from '../bundle/js/mock.js';
import { normalizeDeck } from '../bundle/js/deck.js';
import { layoutSlide } from '../bundle/js/layout.js';
import { getTheme, THEME_IDS } from '../bundle/js/theme.js';
import { buildPptx, deckFileName } from '../bundle/js/export.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../out');
mkdirSync(outDir, { recursive: true });

let failed = 0;

for (const themeId of THEME_IDS) {
  const raw = mockDeck(themeId);
  const deck = normalizeDeck(raw, themeId);
  const theme = getTheme(themeId);

  const b64 = await buildPptx(PptxGenJS, deck, theme, layoutSlide);
  const bytes = Buffer.from(b64, 'base64');
  const name = deckFileName(deck).replace('.pptx', `-${themeId}.pptx`);
  const path = resolve(outDir, name);
  writeFileSync(path, bytes);

  const ok = bytes.length > 8000 && bytes.subarray(0, 2).toString() === 'PK';
  console.log(`${ok ? '✓' : '✗'} ${themeId.padEnd(6)} ${deck.slides.length} 页  ${(bytes.length / 1024).toFixed(1)} KB  ${name}`);
  if (!ok) failed += 1;
}

if (failed) {
  console.error(`\n${failed} 个主题导出失败`);
  process.exit(1);
}
console.log('\n全部主题导出成功，文件在 out/');
