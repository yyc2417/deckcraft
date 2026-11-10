/**
 * 用本机 Chrome/Edge 的 headless 模式给应用截图，同时收集 console 报错。
 *
 * 为什么不用现成的截图工具：宿主 iframe 里没有 DevTools，而导出的版式对不对
 * 只能靠看。这个脚本固定 1280×800 视口（接近 Anna 窗口的默认尺寸），
 * 生成两张图：整页 + 单页画布，改样式后跑一次就能肉眼比对。
 *
 * 用法：node tools/shot.mjs [url] [outName]
 */

import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../out');
mkdirSync(outDir, { recursive: true });

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const exe = candidates.find((p) => existsSync(p));
if (!exe) throw new Error('本机没有找到 Chrome 或 Edge');

const url = process.argv[2] || 'http://127.0.0.1:5180/anna-apps/deckcraft/dev/index.html#demo';
const name = process.argv[3] || 'shot';
const thumb = Number(process.argv[4] || 0);

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none']
});

const page = await browser.newPage();
await page.setViewport({ width: Number(process.env.VW || 1280), height: Number(process.env.VH || 800), deviceScaleFactor: 1 });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') errors.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));

await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise((r) => setTimeout(r, Number(process.env.WAIT || 3200)));

if (thumb > 0) {
  await page.evaluate((i) => {
    const el = document.querySelector(`#thumbs .thumb:nth-child(${i})`);
    if (el) el.click();
  }, thumb);
  await new Promise((r) => setTimeout(r, 700));
}

const full = resolve(outDir, `${name}.png`);
await page.screenshot({ path: full });

const canvas = await page.$('#canvas');
if (canvas) {
  const box = await canvas.boundingBox();
  if (box && box.width > 10) {
    await page.screenshot({
      path: resolve(outDir, `${name}-slide.png`),
      clip: { x: box.x, y: box.y, width: box.width, height: box.height }
    });
  }
}

const status = await page.$eval('#statusText', (el) => el.textContent).catch(() => '');
const slides = await page.$$eval('#thumbs .thumb', (els) => els.length).catch(() => 0);

console.log(JSON.stringify({ url, slides, status, errors, shot: full }, null, 2));
await browser.close();
