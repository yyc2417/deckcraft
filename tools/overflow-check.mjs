/**
 * 文本框溢出检查：逐页量「文字实际高度」与「文本框高度」。
 *
 * 为什么需要它：导出时字号是 layout 算死的，PowerPoint 不保证执行 autofit。
 * 只要框装不下，第二行就会压到下一个元素上——这类 bug 只在打开 PPT 时肉眼发现，
 * 太晚。这里把预览的字号当成导出的字号来验（?nofit=1 关掉预览的自动缩字）。
 *
 * 跑两轮：
 *   1. 正常内容
 *   2. 压力内容：把每处文案都拉长，模拟"模型话说多了"和"用户自己改长了"
 *
 * 用法：node tools/overflow-check.mjs [baseUrl]
 */

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const base = process.argv[2] || 'http://127.0.0.1:5180/anna-apps/deckcraft/dev/index.html';

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(base + '?nofit=1#demo', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 4200));

async function measure(label) {
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
          out.push({
            path: el.dataset.path || '(装饰)',
            over,
            text: (el.textContent || '').slice(0, 24)
          });
        }
      });
      return out;
    });
    if (issues.length) rows.push({ page: i, issues });
  }
  return { label, total, rows };
}

const normal = await measure('正常内容');

// 压力内容：每处文案都变长，检查换行后有没有撞到下一个元素
const stressedTotal = await page.evaluate(() => {
  const d = JSON.parse(JSON.stringify(window.__deckcraft.getDeck()));
  for (const s of d.slides) {
    if (s.title) s.title = `${s.title}，并且说清楚下一步要谁在什么时候给到第一版数据`;
    if (s.subtitle) s.subtitle = `${s.subtitle}，另外补充一句说明这次的范围与不做什么。`;
    (s.points || []).forEach((p) => {
      if (p.lead) p.lead = `${p.lead}，先做一个能跑通的最小验证再说`;
      if (p.detail) p.detail = `${p.detail}，这一步需要产品一起确认优先级，否则会返工。`;
    });
    (s.steps || []).forEach((st) => {
      if (st.text) st.text = `${st.text}，并且要留出复核时间，避免上线前才发现问题。`;
    });
    (s.stats || []).forEach((x) => {
      if (x.note) x.note = `${x.note}，样本量 12 次，仅作参考，不作为结论。`;
    });
    if (s.insight) s.insight = `${s.insight}，这一点还需要再用一轮数据确认。`;
    (s.items || []).forEach((it) => {
      if (it.label) it.label = `${it.label}，以及它为什么重要`;
      if (it.hint) it.hint = `${it.hint}，这一条要在会上讲清楚。`;
    });
    if (s.rows) s.rows = s.rows.map((r) => r.map((c) => (c ? `${c}（含人工复核）` : c)));
    if (s.columns) s.columns = s.columns.map((c) => `${c}与口径`);
    if (s.visual && s.visual.value) s.visual.value = `${s.visual.value}`;
    if (s.visual && s.visual.note) s.visual.note = `${s.visual.note}，样本量偏小，仅作方向参考。`;
    if (s.quote) s.quote = `${s.quote}，这句话后来被反复引用，成了团队的共识。`;
  }
  window.__deckcraft.setDeck(d);
  return d.slides.length;
});
await new Promise((r) => setTimeout(r, 600));
const stress = await measure('压力内容');
await page.screenshot({ path: 'out/overflow-stress.png' });
await browser.close();

let failed = 0;
for (const r of [normal, stress]) {
  if (!r.rows.length) {
    console.log(`✓ ${r.label}：${r.total} 页，所有文本框都在框内`);
    continue;
  }
  failed += 1;
  console.log(`✗ ${r.label}：${r.rows.length}/${r.total} 页溢出`);
  for (const row of r.rows) {
    console.log(`  第 ${row.page} 页`);
    for (const it of row.issues) console.log(`    ${it.path} 溢出 ${it.over}px  「${it.text}」`);
  }
}
console.log(`\n压力轮共 ${stressedTotal} 页`);
process.exit(failed ? 1 : 0);
