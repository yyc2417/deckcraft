/**
 * Deck 数据模型与规范化。
 *
 * AI 的输出不能直接进渲染器：字段可能缺失、类型可能错、长度可能爆。
 * normalizeDeck() 是唯一入口，负责把任意形状的 JSON 收敛成可信的内部结构，
 * 这样下游（渲染、编辑、导出）不需要到处写防御代码。
 */

export const SLIDE_TYPES = [
  'cover', 'section', 'agenda', 'points', 'compare', 'timeline',
  'table', 'chart', 'stat', 'split', 'quote', 'end'
];

let seq = 0;
export function uid(prefix = 's') {
  seq += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${seq.toString(36)}`;
}

const LIMITS = {
  title: 46,
  kicker: 24,
  subtitle: 110,
  lead: 30,
  detail: 110,
  item: 60,
  label: 18,
  text: 110,
  value: 14,
  note: 70,
  quote: 150,
  insight: 90,
  meta: 60
};

function str(v, max) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function normPoints(list) {
  return arr(list)
    .map((p) => ({
      lead: str(p && (p.lead || p.text || p.title), LIMITS.lead),
      detail: str(p && (p.detail || p.desc || p.note), LIMITS.detail)
    }))
    .filter((p) => p.lead)
    .slice(0, 5);
}

function normColumn(col) {
  if (!col) return null;
  const items = arr(col.items)
    .map((it) => (typeof it === 'string' ? str(it, LIMITS.item) : str(it && (it.text || it.lead), LIMITS.item)))
    .filter(Boolean)
    .slice(0, 5);
  const label = str(col.label || col.title, LIMITS.label);
  if (!label && !items.length) return null;
  return { label, items };
}

function normSlide(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const type = SLIDE_TYPES.includes(s.type) ? s.type : 'points';
  const base = { id: s.id || uid(), type, kicker: str(s.kicker, LIMITS.kicker), title: str(s.title, LIMITS.title) };

  if (type === 'cover') {
    return { ...base, subtitle: str(s.subtitle, LIMITS.subtitle), meta: str(s.meta, LIMITS.meta) };
  }
  if (type === 'section') {
    return { ...base, subtitle: str(s.subtitle, LIMITS.subtitle) };
  }
  if (type === 'agenda') {
    const items = arr(s.items || s.sections)
      .map((it) => (typeof it === 'string'
        ? { label: str(it, LIMITS.label), hint: '' }
        : { label: str(it && (it.label || it.title), LIMITS.label), hint: str(it && (it.hint || it.desc), 26) }))
      .filter((it) => it.label)
      .slice(0, 6);
    if (!items.length) return { ...base, type: 'points', points: [] };
    return { ...base, items };
  }
  if (type === 'table') {
    const columns = arr(s.columns)
      .map((c) => (typeof c === 'string' ? str(c, 16) : str(c && (c.label || c.title), 16)))
      .filter(Boolean)
      .slice(0, 5);
    let rows = arr(s.rows)
      .map((r) => arr(r).slice(0, columns.length).map((c) => str(c, 34)))
      .filter((r) => r.some((c) => c))
      .slice(0, 7);
    if (columns.length < 2 || !rows.length) return { ...base, type: 'points', points: normPoints(s.points) };
    // 补全每行长度，避免渲染时缺列导致错位
    rows = rows.map((r) => {
      const full = r.slice();
      while (full.length < columns.length) full.push('');
      return full;
    });
    return { ...base, columns, rows, note: str(s.note, 60) };
  }
  if (type === 'split') {
    const points = normPoints(s.points || s.body);
    const visual = {
      value: str(s.value || s.big, 12),
      label: str(s.label || s.caption, LIMITS.label),
      note: str(s.note, 60)
    };
    if (!points.length && !visual.value) return { ...base, type: 'points', points: [] };
    return { ...base, points, visual, side: s.side === 'left' ? 'left' : 'right' };
  }
  if (type === 'quote') {
    return {
      id: base.id,
      type,
      kicker: base.kicker,
      title: base.title,
      quote: str(s.quote || s.text || s.title, LIMITS.quote),
      attribution: str(s.attribution || s.source, LIMITS.label)
    };
  }
  if (type === 'compare') {
    const left = normColumn(s.left);
    const right = normColumn(s.right);
    if (!left || !right) {
      // 只有一列时不硬凑两栏，退回要点页
      const items = (left || right);
      return {
        ...base,
        type: 'points',
        points: items ? items.items.map((t) => ({ lead: t, detail: '' })) : []
      };
    }
    return { ...base, left, right };
  }
  if (type === 'timeline') {
    return {
      ...base,
      steps: arr(s.steps)
        .map((st) => ({ label: str(st && (st.label || st.title), LIMITS.label), text: str(st && (st.text || st.detail), LIMITS.text) }))
        .filter((st) => st.label)
        .slice(0, 4)
    };
  }
  if (type === 'stat') {
    return {
      ...base,
      stats: arr(s.stats)
        .map((st) => ({
          value: str(st && (st.value || st.number), LIMITS.value),
          label: str(st && (st.label || st.title), LIMITS.label),
          note: str(st && st.note, LIMITS.note)
        }))
        .filter((st) => st.value)
        .slice(0, 3)
    };
  }
  if (type === 'chart') {
    const categories = arr(s.categories).map((c) => str(c, 12)).filter(Boolean).slice(0, 8);
    const series = arr(s.series)
      .map((se) => ({
        name: str(se && se.name, LIMITS.label) || '数值',
        values: arr(se && se.values).map((v) => Number(v)).filter((v) => Number.isFinite(v)).slice(0, 8)
      }))
      .filter((se) => se.values.length)
      .slice(0, 3);
    const kind = ['bar', 'line', 'pie'].includes(s.kind) ? s.kind : 'bar';
    if (!categories.length || !series.length) {
      return { ...base, type: 'points', points: normPoints(s.points) };
    }
    return { ...base, kind, categories, series, insight: str(s.insight, LIMITS.insight) };
  }
  if (type === 'end') {
    return { ...base, subtitle: str(s.subtitle, LIMITS.subtitle) };
  }
  return { ...base, points: normPoints(s.points || s.items) };
}

/**
 * 规范化整份 deck：保证有封面和结尾页，页数收敛到 3..16。
 * 封面/结尾缺失时补一张，而不是报错——用户拿到能用的东西比拿到错误信息重要。
 */
export function normalizeDeck(raw, fallbackTheme = 'slate') {
  const src = raw && typeof raw === 'object' ? raw : {};
  let slides = arr(src.slides).map(normSlide).filter((s) => {
    if (s.type === 'points') return s.points.length > 0;
    if (s.type === 'timeline') return s.steps.length > 0;
    if (s.type === 'stat') return s.stats.length > 0;
    if (s.type === 'agenda') return s.items.length > 0;
    if (s.type === 'table') return s.rows.length > 0;
    if (s.type === 'split') return s.points.length > 0 || Boolean(s.visual.value);
    return true;
  });

  if (!slides.length) slides = [{ id: uid(), type: 'cover', kicker: 'DECKCRAFT', title: src.title || '未命名演示', subtitle: '', meta: '' }];
  if (slides[0].type !== 'cover') {
    slides.unshift({ id: uid(), type: 'cover', kicker: 'DECKCRAFT', title: str(src.title, LIMITS.title) || '未命名演示', subtitle: '', meta: '' });
  }
  if (slides[slides.length - 1].type !== 'end') {
    slides.push({ id: uid(), type: 'end', kicker: '', title: '讨论', subtitle: '' });
  }
  slides = slides.slice(0, 16);

  return {
    id: src.id || uid('d'),
    title: str(src.title, LIMITS.title) || slides[0].title || '未命名演示',
    theme: src.theme && typeof src.theme === 'string' ? src.theme : fallbackTheme,
    brief: str(src.brief, 4000),
    scene: str(src.scene, 20),
    createdAt: src.createdAt || new Date().toISOString(),
    slides
  };
}

export function emptyDeck(theme = 'slate') {
  return normalizeDeck(
    {
      title: '未命名演示',
      theme,
      slides: [
        { type: 'cover', kicker: 'DECKCRAFT', title: '未命名演示', subtitle: '在左侧输入材料后生成', meta: '' },
        {
          type: 'points',
          kicker: '',
          title: '每一步都可以改',
          points: [
            { lead: '结论句当标题', detail: '每页标题是一句可以被反驳的判断，不是「背景」「现状」这类标签。' },
            { lead: '先改骨架再排版', detail: '生成后先看整份的叙事顺序，改完标题再决定版式，重排不消耗额度。' },
            { lead: '导出真 PPTX', detail: '文本框、形状、图表都是 PowerPoint 原生对象，拿到文件还能继续改。' }
          ]
        },
        { type: 'end', title: '开始', subtitle: '把材料贴进左侧输入框' }
      ]
    },
    theme
  );
}

/** 单页规范化：AI 只改一页时用，不补封面/结尾。 */
export function normalizeOne(raw) {
  return normSlide(raw);
}

export function slideTitleOf(slide) {
  if (!slide) return '';
  if (slide.type === 'quote') return slide.quote || '引用';
  return slide.title || '（无标题）';
}

export function slideKindLabel(slide) {
  const map = {
    cover: '封面',
    section: '过渡',
    points: '要点',
    tight: '要点',
    compare: '对比',
    timeline: '流程',
    table: '表格',
    agenda: '目录',
    split: '图文',
    stat: '数字',
    chart: '图表',
    quote: '引用',
    end: '结尾'
  };
  return map[slide.type] || '要点';
}
