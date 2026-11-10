/**
 * 导出器：把同一份 frame 数组画成 PPTX。
 *
 * 这里刻意不 import 'pptxgenjs'：浏览器里它是全局 UMD（window.PptxGenJS），
 * Node 里是 npm 模块。构造函数由调用方注入，同一份导出逻辑两边都能跑，
 * 所以可以用 Node 脚本对导出结果做回归，不必每次都开浏览器。
 *
 * 目标不是"把内容塞进文件"，而是"打开还能改"：
 * 所有文字是文本框，所有色块是形状，图表是 PowerPoint 原生图表（数据可编辑）。
 */

import { SLIDE } from './layout.js';
import { hex } from './theme.js';

export async function buildPptx(PptxGenJS, deck, theme, framesForSlide) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'DECK_16x9', width: SLIDE.w, height: SLIDE.h });
  pptx.layout = 'DECK_16x9';
  pptx.title = deck.title || 'DeckCraft';
  pptx.author = 'DeckCraft';
  pptx.subject = deck.scene || '';

  for (const slide of deck.slides) {
    const s = pptx.addSlide();
    s.background = { color: hex(theme.bg) };
    const frames = framesForSlide(slide, theme);
    for (const f of frames) {
      if (f.t === 'rect') addRect(s, pptx, f);
      else if (f.t === 'text') addText(s, f, theme);
      else if (f.t === 'line') addLine(s, pptx, f);
      else if (f.t === 'chart') addChart(s, pptx, f, theme);
    }
  }

  const out = await pptx.write({ outputType: 'base64' });
  return out;
}

function addRect(s, pptx, f) {
  const shape = f.rx ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
  const opts = {
    x: f.x, y: f.y, w: f.w, h: f.h,
    fill: { color: hex(f.fill || '#000000') },
    line: f.line ? { color: hex(f.line), width: f.lw || 1 } : { color: hex(f.fill || '#FFFFFF'), width: 0 }
  };
  if (f.rx) opts.rectRadius = f.rx;
  s.addShape(shape, opts);
}

function addText(s, f, theme) {
  s.addText(f.text || '', {
    x: f.x, y: f.y, w: f.w, h: f.h,
    fontFace: theme.font,
    fontSize: f.size,
    color: hex(f.color || theme.ink),
    bold: Boolean(f.bold),
    align: f.align || 'left',
    valign: f.valign === 'top' ? 'top' : f.valign === 'bottom' ? 'bottom' : 'middle',
    lineSpacingMultiple: f.lh || 1.25,
    charSpacing: f.spacing || 0,
    margin: 0,
    isTextBox: true,
    fit: 'shrink',
    wrap: true
  });
}

function addLine(s, pptx, f) {
  s.addShape(pptx.ShapeType.line, {
    x: f.x1, y: f.y1,
    w: f.x2 - f.x1, h: f.y2 - f.y1,
    line: { color: hex(f.color), width: f.width || 1, dashType: f.dash || 'solid' }
  });
}

function addChart(s, pptx, f, theme) {
  const type = f.kind === 'line' ? pptx.ChartType.line : f.kind === 'pie' ? pptx.ChartType.pie : pptx.ChartType.bar;
  const data = (f.series || []).map((se) => ({
    name: se.name || '数值',
    labels: f.categories || [],
    values: se.values || []
  }));
  if (!data.length) return;

  const opts = {
    x: f.x, y: f.y, w: f.w, h: f.h,
    chartColors: (f.colors || [theme.accent]).map(hex),
    showLegend: Boolean(f.legend) && data.length > 1,
    legendPos: 't',
    legendColor: hex(theme.muted),
    legendFontSize: 10,
    showValue: Boolean(f.valueLabels) && f.kind !== 'line',
    dataLabelColor: hex(theme.ink),
    dataLabelFontSize: 10,
    dataLabelFontFace: theme.font,
    catAxisLabelColor: hex(theme.muted),
    catAxisLabelFontSize: 12,
    catAxisLabelFontFace: theme.font,
    valAxisLabelColor: hex(theme.muted),
    valAxisLabelFontSize: 9,
    valAxisLabelFontFace: theme.font,
    catAxisLineColor: hex(theme.rule),
    valAxisLineShow: false,
    valGridLine: { style: 'none' },
    catGridLine: { style: 'none' },
    barDir: 'col',
    barGapWidthPct: 60,
    border: { pt: 0, color: hex(theme.bg) }
  };
  if (f.kind === 'pie') {
    opts.showPercent = true;
    opts.showValue = false;
  }
  s.addChart(type, data, opts);
}

/** 文件名：标题 + 日期，去掉 Windows 不允许的字符。 */
export function deckFileName(deck) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const safe = String(deck.title || 'deck')
    .replace(/[\\/:*?"<>|\n\r\t]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 40);
  return `${safe || 'deck'}-${stamp}.pptx`;
}
