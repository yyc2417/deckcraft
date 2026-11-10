/**
 * DOM 渲染器：把 layout 产出的 frame 数组画成 DOM。
 *
 * 坐标换算只有一处：英寸 → 像素，固定 96 px/in（CSS 逻辑英寸）。
 * 字号 pt → px 用 96/72，所以预览和导出的物理比例一致。
 *
 * PptxGenJS 导出时文本框会启用 fit:'shrink'（内容超出自动缩字），
 * 这里用一个轻量的 autoShrink 做近似，避免预览溢出但导出正常这种错觉。
 */

import { PT_PER_IN, PX_PER_IN } from './layout.js';
import { hex } from './theme.js';

const PT2PX = PX_PER_IN / PT_PER_IN;

export function renderSlide(host, slide, theme, frames) {
  host.innerHTML = '';
  host.style.width = 960 + 'px';
  host.style.height = 540 + 'px';
  host.style.background = theme.bg;

  const frag = document.createDocumentFragment();
  for (const f of frames) {
    if (f.t === 'rect') frag.appendChild(rectNode(f));
    else if (f.t === 'text') frag.appendChild(textNode(f, theme));
    else if (f.t === 'line') frag.appendChild(lineNode(f));
    else if (f.t === 'chart') frag.appendChild(chartNode(f, theme));
  }
  host.appendChild(frag);
  return host;
}

function px(v) {
  return v * PX_PER_IN;
}

function base(f) {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.left = px(f.x) + 'px';
  el.style.top = px(f.y) + 'px';
  el.style.width = px(f.w) + 'px';
  el.style.height = px(f.h) + 'px';
  return el;
}

function rectNode(f) {
  const el = base(f);
  el.style.background = f.fill || 'transparent';
  if (f.line) {
    el.style.border = `${Math.max(1, (f.lw || 1) * PT2PX)}px solid ${f.line}`;
    el.style.boxSizing = 'border-box';
  }
  if (f.rx) el.style.borderRadius = px(f.rx) + 'px';
  return el;
}

function textNode(f, theme) {
  const el = base(f);
  el.style.fontFamily = `'${theme.font}', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
  el.style.fontSize = f.size * PT2PX + 'px';
  el.style.color = f.color || theme.ink;
  el.style.fontWeight = f.bold ? '700' : '400';
  el.style.letterSpacing = (f.spacing || 0) * PT2PX + 'px';
  el.style.lineHeight = String(f.lh || 1.25);
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.justifyContent = f.valign === 'middle' ? 'center' : f.valign === 'bottom' ? 'flex-end' : 'flex-start';
  el.style.textAlign = f.align || 'left';
  el.style.whiteSpace = 'pre-wrap';
  el.style.wordBreak = 'break-word';
  el.style.overflow = 'hidden';
  const span = document.createElement('span');
  span.textContent = f.text || '';
  el.appendChild(span);
  el.dataset.text = '1';
  if (f.path) el.dataset.path = f.path;
  return el;
}

function lineNode(f) {
  const x1 = px(f.x1);
  const y1 = px(f.y1);
  const x2 = px(f.x2);
  const y2 = px(f.y2);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.left = x1 + 'px';
  el.style.top = y1 + 'px';
  el.style.width = len + 'px';
  el.style.height = Math.max(1, (f.width || 1) * PT2PX) + 'px';
  el.style.background = f.color || 'currentColor';
  el.style.transformOrigin = '0 50%';
  el.style.transform = `rotate(${angle}rad)`;
  return el;
}

/* ---------- 图表：用最少的手写 SVG 近似原生图表 ---------- */

function chartNode(f, theme) {
  const el = base(f);
  const w = px(f.w);
  const h = px(f.h);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);

  const colors = f.colors || [theme.accent];
  const cats = f.categories || [];
  const series = f.series || [];
  const values = series[0] ? series[0].values : [];
  const max = Math.max(1, ...series.flatMap((s) => s.values));

  if (f.kind === 'pie') {
    drawPie(svg, values, colors, w, h, cats, theme);
  } else if (f.kind === 'line') {
    drawLine(svg, series, colors, w, h, cats, theme, max);
  } else {
    drawBars(svg, series, colors, w, h, cats, theme, max);
  }
  el.appendChild(svg);
  return el;
}

function axis(svg, w, h, theme, cats) {
  const padB = 26;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  g.setAttribute('x1', 0);
  g.setAttribute('y1', h - padB);
  g.setAttribute('x2', w);
  g.setAttribute('y2', h - padB);
  g.setAttribute('stroke', theme.rule);
  g.setAttribute('stroke-width', '1');
  svg.appendChild(g);

  const step = w / Math.max(1, cats.length);
  cats.forEach((c, i) => {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', step * (i + 0.5));
    t.setAttribute('y', h - 8);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', theme.muted);
    t.setAttribute('font-size', '12');
    t.textContent = c;
    svg.appendChild(t);
  });
  return { padB, step };
}

function drawBars(svg, series, colors, w, h, cats, theme, max) {
  const { padB, step } = axis(svg, w, h, theme, cats);
  const plotH = h - padB - 16;
  const groups = series.length;
  const barW = Math.min(46, (step * 0.62) / groups);

  series.forEach((s, si) => {
    s.values.forEach((v, i) => {
      const bh = Math.max(2, (v / max) * plotH);
      const x = step * (i + 0.5) - (barW * groups) / 2 + si * barW;
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', x);
      r.setAttribute('y', h - padB - bh);
      r.setAttribute('width', barW - 3);
      r.setAttribute('height', bh);
      r.setAttribute('fill', colors[si % colors.length]);
      r.setAttribute('rx', '2');
      svg.appendChild(r);
      if (series.length === 1) {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', x + (barW - 3) / 2);
        t.setAttribute('y', h - padB - bh - 7);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('fill', theme.ink);
        t.setAttribute('font-size', '11');
        t.textContent = String(v);
        svg.appendChild(t);
      }
    });
  });
}

function drawLine(svg, series, colors, w, h, cats, theme, max) {
  const { padB, step } = axis(svg, w, h, theme, cats);
  const plotH = h - padB - 16;
  series.forEach((s, si) => {
    const pts = s.values
      .map((v, i) => `${step * (i + 0.5)},${h - padB - (v / max) * plotH}`)
      .join(' ');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', colors[si % colors.length]);
    poly.setAttribute('stroke-width', '2.5');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);
    s.values.forEach((v, i) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', step * (i + 0.5));
      c.setAttribute('cy', h - padB - (v / max) * plotH);
      c.setAttribute('r', '3');
      c.setAttribute('fill', colors[si % colors.length]);
      svg.appendChild(c);
    });
  });
}

function drawPie(svg, values, colors, w, h, cats, theme) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = w * 0.36;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.36;
  let start = -Math.PI / 2;

  values.forEach((v, i) => {
    const ang = (v / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(start + ang);
    const y2 = cy + r * Math.sin(start + ang);
    const large = ang > Math.PI ? 1 : 0;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`);
    p.setAttribute('fill', colors[i % colors.length]);
    p.setAttribute('stroke', theme.bg);
    p.setAttribute('stroke-width', '1.5');
    svg.appendChild(p);

    const lx = cx + r * 1.18 * Math.cos(start + ang / 2);
    const ly = cy + r * 1.18 * Math.sin(start + ang / 2);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', lx);
    t.setAttribute('y', ly);
    t.setAttribute('fill', theme.muted);
    t.setAttribute('font-size', '11');
    t.setAttribute('text-anchor', lx > cx ? 'start' : 'end');
    t.textContent = cats[i] || '';
    svg.appendChild(t);
    start += ang;
  });
}

/* ---------- 预览适配 ---------- */

/**
 * 内容超出容器时逐级缩小字号，近似 PowerPoint 的 normAutofit。
 * 只处理文本节点，最多缩到 72%，再缩就说明内容真的太多，该改文案了。
 */
export function autoShrink(root) {
  const nodes = root.querySelectorAll('[data-text="1"]');
  nodes.forEach((el) => {
    const span = el.firstElementChild;
    if (!span) return;
    let size = parseFloat(el.style.fontSize);
    const min = size * 0.72;
    let guard = 0;
    while (span.scrollHeight > el.clientHeight + 1 && size > min && guard < 12) {
      size *= 0.94;
      el.style.fontSize = size + 'px';
      guard += 1;
    }
  });
}
