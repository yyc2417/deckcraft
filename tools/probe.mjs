/**
 * 布局探针：打印关键容器的实际盒子，用来定位"看起来偏了"的问题。
 * 比对着截图猜坐标可靠，改完 CSS 跑一次就知道有没有真的修好。
 *
 * 用法：node tools/probe.mjs [url]
 */

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];
const exe = candidates.find((p) => existsSync(p));
const url = process.argv[2] || 'http://127.0.0.1:5180/anna-apps/deckcraft/dev/index.html#demo';

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto(url, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 3000));

const metrics = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    viewport: { w: innerWidth, h: innerHeight },
    docScroll: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    bodyScrollW: document.body.scrollWidth,
    app: box('.app'),
    rail: box('.rail'),
    stage: box('.stage'),
    inspector: box('.inspector'),
    composer: box('#composer'),
    inspectorPanel: box('#inspector'),
    canvasWrap: box('#canvasWrap'),
    sizer: box('#sizer'),
    canvas: box('#canvas'),
    statusbar: box('.statusbar'),
    anyOverflow: Array.from(document.querySelectorAll('.panel-body, .inspector, .stage, .app'))
      .map((el) => ({ cls: el.className, sw: el.scrollWidth, cw: el.clientWidth }))
      .filter((x) => x.sw > x.cw + 1)
  };
});

console.log(JSON.stringify(metrics, null, 2));
await browser.close();
