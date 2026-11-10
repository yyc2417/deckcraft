/**
 * 版式引擎：把一份 slide 数据编译成一组与渲染器无关的图元（frame）。
 *
 * 为什么要有这一层：
 * DOM 预览和 .pptx 导出如果各写一套坐标，两边必然越走越远，最后"预览好看、
 * 导出的文件错位"。这里把坐标、字号、颜色全部算一次，产出同一份 frame 数组，
 * 一个交给 DOM 渲染，一个交给 PptxGenJS，所见即所得就成了结构上的保证，
 * 而不是靠人工对齐。
 *
 * 单位约定：全部用英寸（in），和 PowerPoint 的画布单位一致。
 * 字号用 pt（PowerPoint 的磅值）。DOM 侧换算：px = pt * 96 / 72。
 *
 * path 字段：文本图元对应 deck 里的哪个字段（如 "points.2.lead"）。
 * 画布上直接改字靠它回写，没有 path 的文本是纯装饰，只读。
 */

export const SLIDE = { w: 10, h: 5.625 };
export const PX_PER_IN = 96;
export const PT_PER_IN = 72;

const M = 0.75;
const CONTENT_TOP = 1.75;
const CONTENT_BOTTOM = 4.95;

/** 标题区：kicker + 标题 + 一段短横线。所有内容页共用，保证节奏一致。 */
function titleBlock(slide, th) {
  const out = [];
  if (slide.kicker) {
    out.push({
      t: 'text',
      x: M, y: 0.34, w: 8.5, h: 0.26,
      text: slide.kicker, size: 10, bold: true, color: th.accent,
      spacing: 1.6, path: 'kicker'
    });
  }
  out.push({
    t: 'text',
    x: M, y: 0.62, w: 8.5, h: 0.74,
    text: slide.title || '', size: 26, bold: true, color: th.ink,
    valign: 'top', lh: 1.12, path: 'title'
  });
  out.push({ t: 'rect', x: M, y: 1.42, w: 0.72, h: 0.045, fill: th.accent });
  return out;
}

function bulletRows(items, th, opts = {}) {
  const out = [];
  const list = (items || []).filter((it) => it && (it.text || it.lead)).slice(0, opts.max || 4);
  if (!list.length) return out;
  const top = opts.top ?? CONTENT_TOP;
  const bottom = opts.bottom ?? CONTENT_BOTTOM;
  const gap = opts.gap ?? 0.12;
  const rowH = (bottom - top - gap * (list.length - 1)) / list.length;
  const leadSize = opts.leadSize ?? 15;
  const detailSize = opts.detailSize ?? 11.5;
  const leadH = opts.leadH ?? 0.36;

  list.forEach((it, i) => {
    const y = top + i * (rowH + gap);
    const hasDetail = Boolean(it.detail);
    const leadY = hasDetail ? y : y + Math.max(0, (rowH - leadH) / 2);
    out.push({ t: 'rect', x: M, y: leadY + 0.11, w: 0.075, h: 0.075, fill: th.accent });
    out.push({
      t: 'text',
      x: M + 0.26, y: leadY, w: 8.2, h: leadH,
      text: it.lead || it.text, size: leadSize, bold: true, color: th.ink,
      valign: 'top', lh: 1.2, path: `points.${i}.lead`
    });
    if (hasDetail) {
      out.push({
        t: 'text',
        x: M + 0.26, y: y + leadH, w: 8.2, h: Math.max(0.3, rowH - leadH),
        text: it.detail, size: detailSize, color: th.muted,
        valign: 'top', lh: 1.28, path: `points.${i}.detail`
      });
    }
  });
  return out;
}

const LAYOUTS = {
  cover(slide, th) {
    const out = [
      { t: 'rect', x: 0, y: 0, w: 0.14, h: SLIDE.h, fill: th.accent },
      {
        t: 'text', x: M, y: 1.3, w: 7.4, h: 0.28,
        text: slide.kicker || 'DECKCRAFT', size: 10, bold: true, color: th.muted, spacing: 2,
        path: 'kicker'
      },
      {
        t: 'text', x: M, y: 1.82, w: 7.9, h: 1.42,
        text: slide.title || '', size: 38, bold: true, color: th.ink, valign: 'top', lh: 1.16,
        path: 'title'
      }
    ];
    if (slide.subtitle) {
      out.push({
        t: 'text', x: M, y: 3.34, w: 7.4, h: 0.8,
        text: slide.subtitle, size: 14, color: th.muted, valign: 'top', lh: 1.3, path: 'subtitle'
      });
    }
    out.push({
      t: 'text', x: M, y: 4.94, w: 7.0, h: 0.28,
      text: slide.meta || '', size: 10, color: th.muted, path: 'meta'
    });
    return out;
  },

  section(slide, th) {
    const out = [
      { t: 'rect', x: 0, y: 0, w: 0.14, h: SLIDE.h, fill: th.accent },
      {
        t: 'text', x: M, y: 2.0, w: 7.4, h: 0.28,
        text: slide.kicker || '', size: 11, bold: true, color: th.accent, spacing: 1.8, path: 'kicker'
      },
      {
        t: 'text', x: M, y: 2.36, w: 8.2, h: 1.1,
        text: slide.title || '', size: 30, bold: true, color: th.ink, valign: 'top', lh: 1.15, path: 'title'
      }
    ];
    if (slide.subtitle) {
      out.push({
        t: 'text', x: M, y: 3.52, w: 7.4, h: 0.6,
        text: slide.subtitle, size: 12, color: th.muted, valign: 'top', path: 'subtitle'
      });
    }
    return out;
  },

  points(slide, th) {
    return [...titleBlock(slide, th), ...bulletRows(slide.points, th, { max: 4 })];
  },

  tight(slide, th) {
    return [...titleBlock(slide, th), ...bulletRows(slide.points, th, { max: 5, leadSize: 14, detailSize: 11, leadH: 0.32 })];
  },

  compare(slide, th) {
    const out = titleBlock(slide, th);
    const cols = [slide.left, slide.right].filter(Boolean);
    const n = cols.length || 1;
    const gap = 0.34;
    const colW = (8.5 - gap * (n - 1)) / n;
    const maxItems = Math.max(3, ...cols.map((c) => (c.items || []).length));
    const rowH = Math.min(0.62, (4.85 - 2.34) / maxItems);

    cols.forEach((col, ci) => {
      const x = M + ci * (colW + gap);
      const isRight = ci === 1;
      const side = isRight ? 'right' : 'left';
      out.push({
        t: 'rect', x, y: 1.72, w: colW, h: 0.46, rx: 0.06,
        fill: isRight ? th.accent : th.panel,
        line: isRight ? null : th.rule, lw: 0.75
      });
      out.push({
        t: 'text', x: x + 0.16, y: 1.72, w: colW - 0.32, h: 0.46,
        text: col.label || '', size: 12.5, bold: true,
        color: isRight ? th.bg : th.ink, valign: 'middle', path: `${side}.label`
      });
      (col.items || []).slice(0, 5).forEach((item, i) => {
        const y = 2.34 + i * rowH;
        out.push({
          t: 'text', x, y, w: 0.18, h: 0.32,
          text: '·', size: 14, bold: true, color: isRight ? th.accent : th.muted, valign: 'top'
        });
        out.push({
          t: 'text', x: x + 0.20, y, w: colW - 0.24, h: rowH,
          text: typeof item === 'string' ? item : item.text, size: 11.5,
          color: th.ink, valign: 'top', lh: 1.25, path: `${side}.items.${i}`
        });
      });
    });
    return out;
  },

  timeline(slide, th) {
    const out = titleBlock(slide, th);
    const steps = (slide.steps || []).slice(0, 4);
    if (!steps.length) return out;
    const gap = 0.3;
    const colW = (8.5 - gap * (steps.length - 1)) / steps.length;
    const lineY = 2.52;
    out.push({ t: 'line', x1: M, y1: lineY, x2: M + 8.5, y2: lineY, color: th.rule, width: 1.25 });

    steps.forEach((s, i) => {
      const x = M + i * (colW + gap);
      out.push({ t: 'rect', x, y: lineY - 0.07, w: 0.14, h: 0.14, rx: 0.07, fill: th.accent });
      out.push({
        t: 'text', x, y: 1.92, w: colW, h: 0.4,
        text: String(i + 1).padStart(2, '0'), size: 18, bold: true, color: th.accent, valign: 'top'
      });
      out.push({
        t: 'text', x, y: 2.68, w: colW, h: 0.4,
        text: s.label || '', size: 12.5, bold: true, color: th.ink, valign: 'top', path: `steps.${i}.label`
      });
      if (s.text) {
        out.push({
          t: 'text', x, y: 3.08, w: colW, h: 1.5,
          text: s.text, size: 10.5, color: th.muted, valign: 'top', lh: 1.35, path: `steps.${i}.text`
        });
      }
    });
    return out;
  },

  stat(slide, th) {
    const out = titleBlock(slide, th);
    const stats = (slide.stats || []).slice(0, 3);
    if (!stats.length) return out;
    const gap = 0.3;
    const cardW = (8.5 - gap * (stats.length - 1)) / stats.length;
    stats.forEach((s, i) => {
      const x = M + i * (cardW + gap);
      out.push({ t: 'rect', x, y: 2.3, w: cardW, h: 2.1, rx: 0.04, fill: th.panel, line: th.rule, lw: 0.75 });
      out.push({
        t: 'text', x: x + 0.26, y: 2.5, w: cardW - 0.52, h: 0.72,
        text: s.value || '', size: 32, bold: true, color: th.accent, valign: 'top', lh: 1.05, path: `stats.${i}.value`
      });
      out.push({
        t: 'text', x: x + 0.26, y: 3.3, w: cardW - 0.52, h: 0.34,
        text: s.label || '', size: 12.5, bold: true, color: th.ink, valign: 'top', path: `stats.${i}.label`
      });
      if (s.note) {
        out.push({
          t: 'text', x: x + 0.26, y: 3.64, w: cardW - 0.52, h: 0.55,
          text: s.note, size: 10, color: th.muted, valign: 'top', lh: 1.3, path: `stats.${i}.note`
        });
      }
    });
    return out;
  },

  quote(slide, th) {
    const out = [
      { t: 'rect', x: 1.15, y: 2.26, w: 0.86, h: 0.05, fill: th.accent },
      {
        t: 'text', x: 1.15, y: 2.52, w: 7.7, h: 1.2,
        text: slide.quote || slide.title || '', size: 24, color: th.ink, valign: 'top', lh: 1.34,
        path: 'quote'
      }
    ];
    if (slide.attribution) {
      out.push({
        t: 'text', x: 1.15, y: 3.96, w: 7.7, h: 0.34,
        text: '— ' + slide.attribution, size: 11, color: th.muted, path: 'attribution'
      });
    }
    return out;
  },

  chart(slide, th) {
    const out = titleBlock(slide, th);
    const series = (slide.series || []).slice(0, 3);
    const categories = (slide.categories || []).slice(0, 8);
    out.push({
      t: 'chart',
      x: 0.78, y: 1.8, w: 6.3, h: 3.0,
      kind: slide.kind || 'bar',
      categories,
      series,
      colors: [th.accent, th.accent2, th.muted],
      legend: series.length > 1,
      valueLabels: slide.kind !== 'line'
    });
    if (slide.insight) {
      out.push({ t: 'rect', x: 7.32, y: 1.8, w: 1.93, h: 3.0, rx: 0.04, fill: th.panel, line: th.rule, lw: 0.75 });
      out.push({
        t: 'text', x: 7.5, y: 1.96, w: 1.58, h: 0.24,
        text: '洞察', size: 9, bold: true, color: th.accent, spacing: 1.2
      });
      out.push({
        t: 'text', x: 7.5, y: 2.26, w: 1.58, h: 2.38,
        text: slide.insight, size: 9.5, color: th.ink, valign: 'top', lh: 1.42, path: 'insight'
      });
    }
    return out;
  },

  end(slide, th) {
    const out = [
      { t: 'rect', x: 4.5, y: 1.92, w: 1.0, h: 0.05, fill: th.accent },
      {
        t: 'text', x: 1.0, y: 2.3, w: 8.0, h: 0.95,
        text: slide.title || '谢谢', size: 30, bold: true, color: th.ink, align: 'center', valign: 'top',
        path: 'title'
      }
    ];
    if (slide.subtitle) {
      out.push({
        t: 'text', x: 1.0, y: 2.98, w: 8.0, h: 0.7,
        text: slide.subtitle, size: 12.5, color: th.muted, align: 'center', valign: 'top', lh: 1.35,
        path: 'subtitle'
      });
    }
    return out;
  }
};

export const LAYOUT_IDS = Object.keys(LAYOUTS);

/** 版式可选列表，供 UI 的"换版式"使用。 */
export function availableLayouts(slide) {
  if (slide && slide.type === 'cover') return ['cover', 'section'];
  if (slide && slide.type === 'end') return ['end'];
  return ['points', 'tight', 'compare', 'timeline', 'stat', 'quote', 'chart'];
}

/**
 * 编译一份 deck 里的某一页。
 * 未知类型一律退化到 points，避免 AI 输出奇怪的 type 时整页空白。
 */
export function layoutSlide(slide, theme) {
  let fn = LAYOUTS[slide.type] || LAYOUTS.points;
  if (slide.type === 'points' && (slide.points || []).length > 4) fn = LAYOUTS.tight;
  const frames = fn(slide, theme) || [];
  return frames.map((f) => ({
    ...f,
    x: f.x !== undefined ? round(f.x) : undefined,
    y: f.y !== undefined ? round(f.y) : undefined,
    w: f.w !== undefined ? round(f.w) : undefined,
    h: f.h !== undefined ? round(f.h) : undefined
  }));
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

export const GEOM = { M, CONTENT_TOP, CONTENT_BOTTOM };
