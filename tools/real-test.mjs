/**
 * 真实模型冒烟：在本地 harness 里走一次**平台真实模型**（不是 mock），
 * 记录平台回传的模型名与 CU 消耗。
 *
 * 这是「在该平台完成真实测试」的证据之一：调用走 nexus、计进用户额度，
 * 数字来自 response._meta，不是本地估算。
 *
 * 前置：anna-app dev 不带 --no-llm，且本机有可用 PAT。
 * 用法：node tools/real-test.mjs
 */

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const root = process.argv[2] || 'http://127.0.0.1:5180/';

const brief = `上周把审批流程从串行改成并行，平均完结时长从 5.2 天降到 4 小时，样本 1842 单。
主要改动：业务和财务同时收单；法务只审金额阈值以上的单；超时自动升级。
代价是退回率没降（17%），其中 63% 是同一类字段填错。
下一步准备把表单必填项砍掉一半，下周一给字段清单。`;

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: Number(process.env.VW || 1400), height: Number(process.env.VH || 900) });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
});

await page.goto(root, { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise((r) => setTimeout(r, 2500));

const frame = page.frames().find((f) => f.url().includes('/anna-apps/'));
if (!frame) {
  console.error('没有找到 app iframe');
  process.exit(1);
}

const before = await frame.$eval('#quotaText', (el) => el.textContent).catch(() => '');

await frame.evaluate((text) => {
  const ta = document.getElementById('brief');
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('btnGenerate').click();
}, brief);

let slides = 0;
let status = '';
const started = Date.now();
for (let i = 0; i < 120; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  slides = await frame.$$eval('#thumbs .thumb', (els) => els.length).catch(() => 0);
  status = await frame.$eval('#statusText', (el) => el.textContent).catch(() => '');
  if (slides >= 6 && !/生成中|正在生成/.test(status)) break;
  if (Date.now() - started > 180000) break;
}

const titles = await frame.evaluate(() => window.__deckcraft.getDeck().slides.map((s) => `${s.type}: ${s.title || s.quote || ''}`));

const result = await frame.evaluate(() => ({
  title: document.getElementById('docTitle').textContent.trim(),
  status: document.getElementById('statusText').textContent.trim(),
  quota: document.getElementById('quotaText').textContent.trim(),
  bannerHidden: document.getElementById('modeBanner').hidden,
  slideTypes: Array.from(document.querySelectorAll('#thumbs .thumb')).length
}));

// THUMBS=4,7 → 同一次生成里截多页，保证商店图内容前后一致
const wanted = String(process.env.THUMBS || process.env.THUMB || '').split(',').map((x) => Number(x)).filter(Boolean);
for (const n of wanted) {
  await frame.evaluate((i) => document.querySelector(`#thumbs .thumb:nth-child(${i})`).click(), n);
  await new Promise((r) => setTimeout(r, 600));
  const el = await page.$('iframe');
  if (el) await el.screenshot({ path: `out/listing-${n}.png` });
}
if (wanted.length) {
  await frame.evaluate(() => document.querySelector('#thumbs .thumb:nth-child(1)').click());
  await new Promise((r) => setTimeout(r, 500));
}

await page.screenshot({ path: 'out/real-test.png' });
// 只截 iframe：商店图不要 mock dashboard 的外壳
const frameEl = await page.$('iframe');
if (frameEl) {
  await frameEl.screenshot({ path: 'out/listing-real.png' });
}
await browser.close();

console.log(JSON.stringify({ ...result, seconds: Math.round((Date.now() - started) / 1000), before, errors: errors.slice(0, 3) }, null, 2));
if (process.env.TITLES) console.log('\n' + titles.join('\n'));
