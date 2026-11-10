/**
 * 把任意 deck JSON 渲染成截图。
 *
 * 用途：验证"版式引擎是否与题材无关"——换一份完全不同类型的稿子（产品发布、
 * 论文答辩、竞品分析），看版式是否还站得住；也用来给设计评审出图。
 * 走的是应用内真实的 layout + render 路径，不是另写一套。
 *
 * 用法：node tools/render-deck.mjs tools/fixtures/product-launch.json launch
 */

import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDeck } from '../bundle/js/deck.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../out');
mkdirSync(outDir, { recursive: true });

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const file = process.argv[2];
const prefix = process.argv[3] || 'deck';
if (!file) {
  console.error('用法: node tools/render-deck.mjs <deck.json> [前缀]');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(file, 'utf8'));
const deck = normalizeDeck(raw, raw.theme || 'slate');

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
// ?nofit=1：不接受预览的自动缩字，量到的就是导出用的字号
await page.goto('http://127.0.0.1:5180/anna-apps/deckcraft/dev/index.html?nofit=1#demo', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 3800));

await page.evaluate((d) => window.__deckcraft.setDeck(d), deck);
await new Promise((r) => setTimeout(r, 700));

const total = await page.$$eval('#thumbs .thumb', (els) => els.length);
const issues = [];
for (let i = 1; i <= total; i += 1) {
  await page.evaluate((n) => document.querySelector(`#thumbs .thumb:nth-child(${n})`).click(), i);
  await new Promise((r) => setTimeout(r, 260));
  const box = await page.$eval('#canvas', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.screenshot({ path: resolve(outDir, `${prefix}-p${i}.png`), clip: box });

  const over = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#canvas [data-text="1"]').forEach((el) => {
      if (el.scrollHeight - el.clientHeight > 2) out.push(el.dataset.path || '?');
    });
    return out;
  });
  if (over.length) issues.push(`第 ${i} 页溢出: ${over.join(', ')}`);
}

await browser.close();
console.log(`${deck.title} · ${total} 页 · 主题 ${deck.theme}`);
console.log(issues.length ? issues.join('\n') : '所有文本在框内');
