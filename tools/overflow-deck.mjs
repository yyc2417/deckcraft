/**
 * 用一份**真实生成的 deck** 复检文本溢出。
 *
 * overflow-check.mjs 跑的是内置示例 + 人为拉长；这个脚本跑的是模型实际吐出来的
 * 内容——英文材料、真实数字、真实长标题。两者覆盖不同风险：前者测版式上限，
 * 后者测「换个语言/换个题材会不会溢出」。
 *
 * 用法：node tools/overflow-deck.mjs out/last-deck.json [baseUrl]
 */

import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';

const file = process.argv[2];
const base = process.argv[3] || 'http://127.0.0.1:5180/anna-apps/deckcraft/dev/index.html';
if (!file || !existsSync(file)) {
  console.log('用法：node tools/overflow-deck.mjs <deck.json> [baseUrl]');
  process.exit(2);
}
const deck = JSON.parse(readFileSync(file, 'utf-8'));

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
// ?nofit：关掉预览自动缩字，量到的就是导出时用的字号
await page.goto(base + '?nofit=1#demo', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 4200));

await page.evaluate((d) => window.__deckcraft.setDeck(d), deck);
await new Promise((r) => setTimeout(r, 600));

const total = await page.$$eval('#thumbs .thumb', (els) => els.length);
const rows = [];
for (let i = 1; i <= total; i += 1) {
  await page.evaluate((n) => document.querySelector(`#thumbs .thumb:nth-child(${n})`).click(), i);
  await new Promise((r) => setTimeout(r, 240));
  const issues = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#canvas [data-text="1"]').forEach((el) => {
      const over = el.scrollHeight - el.clientHeight;
      if (over > 2) {
        out.push({ path: el.dataset.path || '(装饰)', over, text: (el.textContent || '').slice(0, 30) });
      }
    });
    return out;
  });
  if (issues.length) rows.push({ page: i, type: deck.slides[i - 1] && deck.slides[i - 1].type, issues });
}

await browser.close();

if (!rows.length) {
  console.log(`✓ ${total} 页真实内容，所有文本框都在框内（${file}）`);
  process.exit(0);
}
console.log(`✗ ${rows.length}/${total} 页有文本溢出（${file}）`);
for (const r of rows) {
  console.log(`  第 ${r.page} 页 [${r.type}]`);
  for (const it of r.issues) console.log(`    ${it.path} 溢出 ${it.over}px  「${it.text}」`);
}
process.exit(1);
