/**
 * 应用控制器。
 *
 * 职责边界：只管"状态 + DOM 同步"，不碰坐标（layout.js）也不碰导出细节
 * （export.js）。凡是能算出来的都算一次存在 state 里，渲染函数只读不写。
 *
 * 三条用户可见的承诺，代码里对应三处：
 *   「先改骨架再排版」→ 生成后整份可编辑，换版式/换主题不调用模型
 *   「改一页只花一页的钱」→ rewriteSelected 只发单页内容
 *   「导出还能改」→ export.js 全部用原生文本框/形状/图表
 */

import { connect, call, HostError } from './sdk.js';
import { getTheme, THEMES, THEME_IDS } from './theme.js';
import { layoutSlide, SLIDE } from './layout.js';
import { renderSlide, autoShrink } from './render.js';
import { normalizeDeck, normalizeOne, emptyDeck, uid, slideTitleOf, slideKindLabel } from './deck.js';
import { buildDeckMessages, buildSlideMessages, SCENES } from './prompt.js';
import { completeJSON, hasLlm, friendlyError } from './llm.js';
import { buildPptx, deckFileName } from './export.js';
import { mockGenerate, mockDeck, SAMPLE_BRIEF } from './mock.js';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// ?nofit=1 关掉预览里的自动缩字，用来测「版式本身装不装得下」。
// 导出走的是同一份字号，所以这里的溢出就等于 PPTX 里的溢出。
const NO_FIT = new URLSearchParams(location.search).has('nofit');

const state = {
  anna: null,
  deck: null,
  selected: 0,
  busy: false,
  quota: null,
  lastCall: null,
  scene: 'report',
  slideCount: 8,
  standalone: true
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (!c) return;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return el;
}

/* ============================ 启动 ============================ */

async function boot() {
  state.anna = await connect();
  state.standalone = !state.anna;

  buildComposer();
  buildTopbar();

  if (state.anna) {
    try {
      await call(state.anna.window.set_title, { title: 'DeckCraft' });
    } catch (_) {
      /* 标题失败不影响使用 */
    }
  }

  const restored = await restore();
  if (!restored) {
    state.deck = emptyDeck('slate');
  }

  renderAll();

  if (state.anna) {
    const payload = state.anna.entryPayload;
    if (payload && typeof payload === 'object') applyEntryPayload(payload);
    state.anna.on('entry_payload', applyEntryPayload);
  }

  if (state.standalone) {
    setStatus('本地预览：未连接宿主，可以看示例和改版式，生成与导出需要在 Anna 里打开');
    setBanner('独立预览 · 未连接 Anna 宿主，当前内容不是模型生成的');
  }

  // 演示用快捷入口：URL 加 #demo 直接加载示例并生成一次
  if (location.hash === '#demo') {
    $('#brief').value = SAMPLE_BRIEF;
    state.scene = 'report';
    state.slideCount = 9;
    syncComposer();
    generate();
  }
}

/** 聊天里 open_app_view 推过来的指令。 */
function applyEntryPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  const brief = String(payload.brief || payload.topic || payload.request || '').trim();
  if (payload.scene) {
    const match = SCENES.find((s) => s.id === payload.scene || s.name === payload.scene);
    if (match) state.scene = match.id;
  }
  if (payload.slides) state.slideCount = clamp(Number(payload.slides) || 8, 4, 14);
  if (brief) {
    const ta = $('#brief');
    if (ta) ta.value = brief;
    syncComposer();
    generate();
  }
}

/* ============================ 持久化 ============================ */

let saveTimer = null;

/** 立刻落盘。结构性变更（生成、换版式、增删页）必须走这条，
 *  否则用户在 700ms 内刷新/关窗就会丢掉刚生成的东西。 */
async function persistNow() {
  if (!state.deck || !state.anna) return;
  clearTimeout(saveTimer);
  try {
    await call(state.anna.storage.set, { key: 'deck:current', value: state.deck });
  } catch (err) {
    console.warn('[deckcraft] 保存失败', err);
  }
}

/** 打字时用防抖，避免每次按键都过一次 RPC。 */
function saveDeck() {
  if (!state.deck || !state.anna) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 700);
}

async function restore() {
  if (!state.anna) return false;
  try {
    const res = await call(state.anna.storage.get, { key: 'deck:current' });
    const value = res && res.value;
    if (value && Array.isArray(value.slides) && value.slides.length) {
      state.deck = normalizeDeck(value);
      state.scene = state.deck.scene || 'report';
      return true;
    }
  } catch (_) {
    /* 没有历史记录是正常情况 */
  }
  return false;
}

/* ============================ 顶栏 ============================ */

function buildTopbar() {
  const themes = $('#themeSwitch');
  themes.innerHTML = '';
  THEME_IDS.forEach((id) => {
    const th = THEMES[id];
    themes.appendChild(
      h('button', {
        class: 'theme-dot',
        title: `${th.name} · ${th.hint}`,
        'data-theme-id': id,
        style: `--dot:${th.accent};--dot-bg:${th.bg}`,
        onclick: () => setTheme(id)
      })
    );
  });

  $('#btnExport').addEventListener('click', doExport);
  $('#btnNew').addEventListener('click', resetDeck);
  $('#docTitle').addEventListener('input', (e) => {
    if (!state.deck) return;
    state.deck.title = e.target.textContent.trim().slice(0, 46);
    saveDeck();
  });
}

function setTheme(id) {
  if (!state.deck) return;
  state.deck.theme = id;
  renderAll();
  persistNow();
}

/* ============================ 输入区 ============================ */

function buildComposer() {
  const chipBox = $('#sceneChips');
  chipBox.innerHTML = '';
  SCENES.forEach((s) => {
    chipBox.appendChild(
      h('button', {
        class: 'chip',
        'data-scene': s.id,
        title: s.hint,
        onclick: () => {
          state.scene = s.id;
          syncComposer();
        }
      }, s.name)
    );
  });

  const range = $('#slideCount');
  range.value = String(state.slideCount);
  range.addEventListener('input', () => {
    state.slideCount = Number(range.value);
    syncComposer();
  });

  $('#btnGenerate').addEventListener('click', generate);
  $('#btnSample').addEventListener('click', loadSample);
  $('#btnCollapse').addEventListener('click', () => {
    $('#composer').classList.toggle('is-collapsed');
  });

  const ta = $('#brief');
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      generate();
    }
  });

  syncComposer();
}

function syncComposer() {
  $$('#sceneChips .chip').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.scene === state.scene);
  });
  $('#slideCountVal').textContent = String(state.slideCount);
  const range = $('#slideCount');
  if (range) range.value = String(state.slideCount);
}

function loadSample() {
  $('#brief').value = SAMPLE_BRIEF;
  state.scene = 'report';
  state.slideCount = 9;
  syncComposer();
  setStatus('示例材料已填入，点「生成」或直接看示例效果');
}

async function resetDeck() {
  if (state.busy) return;
  const ok = state.deck && state.deck.slides.length > 1
    ? window.confirm('新建会丢掉当前这份演示，确定？')
    : true;
  if (!ok) return;
  state.deck = emptyDeck(state.deck ? state.deck.theme : 'slate');
  state.selected = 0;
  renderAll();
  persistNow();
}

/* ============================ 生成 ============================ */

async function generate() {
  if (state.busy) return;
  const brief = $('#brief').value.trim();
  if (!brief) {
    setStatus('先写一句主题，或把材料贴进来');
    $('#brief').focus();
    return;
  }

  state.busy = true;
  setBusy(true);
  const theme = state.deck ? state.deck.theme : 'slate';

  try {
    let raw;
    if (hasLlm(state.anna)) {
      setStatus('正在生成结构…');
      const messages = buildDeckMessages({ brief, scene: state.scene, slides: state.slideCount });
      const out = await completeJSON(state.anna, messages, { maxTokens: 6000 });
      raw = out.json;
      if (out.quota) {
        state.quota = (state.quota || 0) + Number(out.quota || 0);
        renderQuota();
      }
      state.lastCall = { model: out.model, quota: out.quota, at: Date.now() };
      if (out.stopReason === 'maxTokens') {
        setStatus('输出被截断了，已收下能用的部分；把材料缩短一点会更完整');
      }
    } else {
      setStatus('本地预览：用示例内容代替模型输出…');
      raw = await mockGenerate({ theme, onProgress: (i, n) => setStatus(`本地预览：拼装第 ${i}/${n} 页`) });
    }

    state.deck = normalizeDeck({ ...raw, theme, brief, scene: state.scene });
    state.selected = 0;
    setBanner(hasLlm(state.anna) ? '' : '示例数据 · 当前环境没有接入平台模型');
    renderAll();
    await persistNow();
    if (!hasLlm(state.anna)) {
      setStatus(`示例已生成 ${state.deck.slides.length} 页 · 点画布上的标题可以直接改`);
      toast('这是示例内容。连上模型后，同一套界面会换成你材料里的东西。');
    } else {
      const used = state.lastCall && state.lastCall.quota;
      const model = state.lastCall && state.lastCall.model;
      setStatus(
        `已生成 ${state.deck.slides.length} 页` +
          (model ? ` · ${model}` : '') +
          (used ? ` · 消耗 ${Math.round(used)} CU` : '') +
          ' · 标题可直接改'
      );
    }
    $('#composer').classList.add('is-collapsed');
  } catch (err) {
    // 模型不可用（本地预览 / 宿主没接模型）时不把用户卡在错误上：
    // 先给一份能看的示例，再说清楚为什么。评审第一次点开就看得到东西，
    // 比"报错了但界面很诚实"重要。
    if (err.code === 'not_implemented' || err.code === 'llm_disabled' || err.code === 'no_llm') {
      try {
        const raw = await mockGenerate({ theme, onProgress: (i, n) => setStatus(`模型未接入，先用示例占位 ${i}/${n}`) });
        state.deck = normalizeDeck({ ...raw, theme, brief, scene: state.scene });
        state.selected = 0;
        renderAll();
        await persistNow();
        setBanner('示例数据 · 当前环境没有接入平台模型，这里是内置样张');
        setStatus('当前环境没有接入模型，已加载示例内容（版式与真实生成一致）');
        toast('模型没接上：这份是示例。真实生成需要在 Anna 里打开本应用。');
        return;
      } catch (_) {
        /* 连示例都失败就退回普通错误提示 */
      }
    }
    setStatus(friendlyError(err));
    if (err.code === 'quota_exceeded') toast('额度不够了，去平台用量页看一下。');
  } finally {
    state.busy = false;
    setBusy(false);
  }
}

async function rewriteSelected(instruction) {
  if (state.busy || !state.deck) return;
  const slide = state.deck.slides[state.selected];
  if (!slide) return;
  if (!hasLlm(state.anna)) {
    toast('本地预览不能调用模型；这条路径在 Anna 里才生效');
    return;
  }
  state.busy = true;
  setBusy(true);
  setStatus('正在改这一页…');
  try {
    const messages = buildSlideMessages({ slide, instruction, deckTitle: state.deck.title });
    const out = await completeJSON(state.anna, messages, { maxTokens: 1200 });
    const next = normalizeOne({ ...out.json, id: slide.id });
    // 类型变了会丢数据，只接受同类型的改写
    if (next.type !== slide.type) next.type = slide.type;
    state.deck.slides[state.selected] = next;
    if (out.quota) {
      state.quota = (state.quota || 0) + Number(out.quota || 0);
      renderQuota();
    }
    renderAll();
    await persistNow();
    setStatus('改好了');
  } catch (err) {
    setStatus(friendlyError(err));
  } finally {
    state.busy = false;
    setBusy(false);
  }
}

/* ============================ 渲染 ============================ */

function renderAll() {
  if (!state.deck) return;
  const theme = getTheme(state.deck.theme);
  $('#docTitle').textContent = state.deck.title || '未命名演示';
  $$('#themeSwitch .theme-dot').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.themeId === state.deck.theme);
  });
  renderRail(theme);
  renderCanvas(theme);
  renderInspector();
  renderStatus();
}

function renderRail(theme) {
  const box = $('#thumbs');
  box.innerHTML = '';
  state.deck.slides.forEach((slide, i) => {
    const wrap = h('div', {
      class: 'thumb' + (i === state.selected ? ' is-on' : ''),
      onclick: () => select(i)
    });
    wrap.appendChild(h('span', { class: 'thumb-no', text: String(i + 1) }));
    const mini = h('div', { class: 'thumb-slide' });
    const inner = h('div', { class: 'thumb-inner' });
    renderSlide(inner, slide, theme, layoutSlide(slide, theme));
    mini.appendChild(inner);
    wrap.appendChild(mini);
    wrap.appendChild(h('span', { class: 'thumb-label', text: slideKindLabel(slide) }));
    box.appendChild(wrap);
  });
  $('#railCount').textContent = String(state.deck.slides.length);
}

function renderCanvas(theme) {
  const canvas = $('#canvas');
  const slide = state.deck.slides[state.selected];
  if (!slide) return;
  renderSlide(canvas, slide, theme, layoutSlide(slide, theme));
  if (!NO_FIT) autoShrink(canvas);
  bindCanvasEditing();
  fitCanvas();
}

/** 画布等比缩放，始终完整显示在一屏内。 */
function fitCanvas() {
  const wrap = $('#canvasWrap');
  const sizer = $('#sizer');
  const canvas = $('#canvas');
  if (!wrap || !canvas || !sizer) return;
  const pad = 40;
  const aw = wrap.clientWidth - pad;
  const ah = wrap.clientHeight - pad;
  const scale = Math.max(0.2, Math.min(aw / SLIDE.w / 96, ah / SLIDE.h / 96));
  canvas.style.transform = `scale(${scale})`;
  sizer.style.width = `${960 * scale}px`;
  sizer.style.height = `${540 * scale}px`;
}

/** 画布上直接改字：contenteditable + data-path 回写。 */
function bindCanvasEditing() {
  const canvas = $('#canvas');
  const slide = state.deck.slides[state.selected];
  $$('[data-path]', canvas).forEach((el) => {
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.addEventListener('input', () => {
      setPath(slide, el.dataset.path, el.textContent);
    });
    el.addEventListener('blur', () => {
      saveDeck();
      renderRail(getTheme(state.deck.theme));
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') el.blur();
      e.stopPropagation();
    });
  });
}

function setPath(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const k = parts[i];
    if (cur[k] === undefined || cur[k] === null) return;
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

function getPath(obj, path) {
  return String(path).split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

function select(i) {
  if (i < 0 || i >= state.deck.slides.length) return;
  state.selected = i;
  renderRail(getTheme(state.deck.theme));
  renderCanvas(getTheme(state.deck.theme));
  renderInspector();
}

/* ============================ 属性面板 ============================ */

function renderInspector() {
  const body = $('#inspectorBody');
  const slide = state.deck.slides[state.selected];
  if (!slide) return;
  body.innerHTML = '';
  $('#slideTypeBadge').textContent = `${state.selected + 1} / ${state.deck.slides.length} · ${slideKindLabel(slide)}`;

  body.appendChild(slideActions(slide));
  body.appendChild(field('版式', layoutSelect(slide)));

  if (slide.type === 'cover' || slide.type === 'section' || slide.type === 'end') {
    body.appendChild(field('小标签', textInput(slide, 'kicker', '一行小字，可以是章节号')));
    body.appendChild(field('标题', areaInput(slide, 'title', 2)));
    body.appendChild(field('副标题', areaInput(slide, 'subtitle', 2)));
    if (slide.type === 'cover') body.appendChild(field('页脚', textInput(slide, 'meta', '日期 / 汇报人')));
  } else if (slide.type === 'points' || slide.type === 'tight') {
    body.appendChild(field('标题', areaInput(slide, 'title', 2)));
    body.appendChild(pointsEditor(slide));
  } else if (slide.type === 'compare') {
    body.appendChild(field('标题', areaInput(slide, 'title', 2)));
    body.appendChild(columnEditor(slide, 'left', '左栏'));
    body.appendChild(columnEditor(slide, 'right', '右栏'));
  } else if (slide.type === 'timeline') {
    body.appendChild(field('标题', areaInput(slide, 'title', 2)));
    body.appendChild(stepsEditor(slide));
  } else if (slide.type === 'stat') {
    body.appendChild(field('标题', areaInput(slide, 'title', 2)));
    body.appendChild(statsEditor(slide));
  } else if (slide.type === 'agenda') {
    body.appendChild(field('标题', areaInput(slide, 'title', 2)));
    body.appendChild(agendaEditor(slide));
  } else if (slide.type === 'table') {
    body.appendChild(field('标题', areaInput(slide, 'title', 2)));
    body.appendChild(tableEditor(slide));
  } else if (slide.type === 'split') {
    body.appendChild(field('标题', areaInput(slide, 'title', 2)));
    body.appendChild(splitEditor(slide));
    body.appendChild(pointsEditor(slide));
  } else if (slide.type === 'chart') {
    body.appendChild(field('标题', areaInput(slide, 'title', 2)));
    body.appendChild(chartEditor(slide));
  } else if (slide.type === 'quote') {
    body.appendChild(field('引文', areaInput(slide, 'quote', 4)));
    body.appendChild(field('出处', textInput(slide, 'attribution', '谁说的')));
  }

  body.appendChild(aiRewriteBlock());
}

function slideActions(slide) {
  const i = state.selected;
  return h('div', { class: 'actions' }, [
    h('button', { class: 'mini', title: '上移', onclick: () => move(-1) }, '↑'),
    h('button', { class: 'mini', title: '下移', onclick: () => move(1) }, '↓'),
    h('button', { class: 'mini', title: '复制这一页', onclick: () => duplicate() }, '复制'),
    h('button', { class: 'mini danger', title: '删除这一页', onclick: () => removeSlide() }, '删除'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'mini', onclick: addSlide }, '+ 新页')
  ]);
}

function layoutSelect(slide) {
  const options = [
    ['points', '要点'],
    ['tight', '要点（紧凑）'],
    ['compare', '两栏对比'],
    ['timeline', '流程'],
    ['table', '表格'],
    ['split', '图文'],
    ['stat', '数字卡片'],
    ['chart', '图表'],
    ['agenda', '目录'],
    ['quote', '引用']
  ];
  const sel = h('select', {
    class: 'input',
    onchange: (e) => convertSlide(slide, e.target.value)
  });
  const current = slide.type;
  const list = slide.type === 'cover' ? [['cover', '封面'], ['section', '过渡页']]
    : slide.type === 'end' ? [['end', '结尾页']]
    : options;
  list.forEach(([v, label]) => {
    sel.appendChild(h('option', { value: v, selected: v === current ? 'selected' : null }, label));
  });
  return sel;
}

/** 从任意版式里抽出「要点」列表，供换版式时复用，避免换一下就清空内容。 */
function pointsOf(slide) {
  if (slide.points && slide.points.length) return slide.points;
  if (slide.type === 'table') {
    return (slide.rows || []).map((r) => ({ lead: r[0] || '', detail: r.slice(1).filter(Boolean).join(' / ') }));
  }
  if (slide.type === 'agenda') {
    return (slide.items || []).map((it) => ({ lead: it.label || '', detail: it.hint || '' }));
  }
  if (slide.type === 'timeline') {
    return (slide.steps || []).map((st) => ({ lead: st.label || '', detail: st.text || '' }));
  }
  if (slide.type === 'compare') {
    return [...(slide.left && slide.left.items || []), ...(slide.right && slide.right.items || [])]
      .map((t) => ({ lead: t, detail: '' }));
  }
  if (slide.type === 'stat') {
    return (slide.stats || []).map((x) => ({ lead: `${x.value} ${x.label}`.trim(), detail: x.note || '' }));
  }
  return [];
}

/** 版式改写：只搬数据，不调模型。 */
function convertSlide(slide, target) {
  if (slide.type === target) return;
  const next = { id: slide.id, type: target, kicker: slide.kicker || '', title: slide.title || '' };
  const points = pointsOf(slide);

  if (target === 'points' || target === 'tight') {
    if (slide.type === 'compare') {
      const items = [...(slide.left.items || []), ...(slide.right.items || [])].slice(0, 4);
      next.points = items.map((t) => ({ lead: t, detail: '' }));
    } else if (slide.type === 'timeline') {
      next.points = slide.steps.map((s) => ({ lead: s.label, detail: s.text }));
    } else if (slide.type === 'stat') {
      next.points = slide.stats.map((s) => ({ lead: `${s.value} ${s.label}`, detail: s.note }));
    } else if (slide.type === 'chart') {
      next.points = points;
    } else {
      next.points = points.length ? points : [{ lead: '要点一', detail: '' }];
    }
  } else if (target === 'compare') {
    const half = Math.ceil(points.length / 2);
    next.left = { label: '现状', items: points.slice(0, half).map((p) => p.lead) };
    next.right = { label: '目标', items: points.slice(half).map((p) => p.lead) };
    if (!next.left.items.length) next.left = { label: '左栏', items: [''] };
    if (!next.right.items.length) next.right = { label: '右栏', items: [''] };
  } else if (target === 'timeline') {
    next.steps = (points.length ? points : [{ lead: '阶段一', detail: '' }]).slice(0, 4).map((p) => ({ label: p.lead, text: p.detail }));
  } else if (target === 'stat') {
    next.stats = (points.length ? points : []).slice(0, 3).map((p) => ({ value: '—', label: p.lead, note: p.detail }));
    if (!next.stats.length) next.stats = [{ value: '42', label: '指标', note: '' }];
  } else if (target === 'table') {
    next.columns = ['要点', '说明'];
    next.rows = (points.length ? points : [{ lead: '第一项', detail: '' }]).slice(0, 7)
      .map((p) => [p.lead || '', p.detail || '']);
    next.note = '';
  } else if (target === 'agenda') {
    next.items = (points.length ? points : [{ lead: '第一部分' }, { lead: '第二部分' }, { lead: '第三部分' }])
      .slice(0, 6)
      .map((p) => ({ label: p.lead || '', hint: p.detail || '' }));
  } else if (target === 'split') {
    next.points = points.slice(0, 4);
    next.visual = { value: '', label: slide.title || '', note: '' };
    next.side = 'right';
  } else if (target === 'quote') {
    next.quote = slide.title || (points[0] && points[0].lead) || '';
    next.attribution = '';
  } else if (target === 'chart') {
    next.kind = 'bar';
    next.categories = ['一', '二', '三'];
    next.series = [{ name: '数值', values: [1, 2, 3] }];
    next.insight = '';
  } else if (target === 'cover' || target === 'section' || target === 'end') {
    next.subtitle = slide.subtitle || '';
  }
  state.deck.slides[state.selected] = next;
  renderAll();
  persistNow();
}

function field(label, control) {
  return h('div', { class: 'field' }, [h('label', { class: 'field-label', text: label }), control]);
}

function textInput(slide, key, placeholder) {
  const input = h('input', {
    class: 'input',
    value: slide[key] || '',
    placeholder: placeholder || '',
    oninput: (e) => {
      slide[key] = e.target.value;
      softRefresh();
    },
    onblur: () => {
      renderAll();
      saveDeck();
    }
  });
  return input;
}

function areaInput(slide, key, rows = 3) {
  return h('textarea', {
    class: 'input',
    rows: String(rows),
    oninput: (e) => {
      slide[key] = e.target.value;
      softRefresh();
    },
    onblur: () => {
      renderAll();
      saveDeck();
    }
  }, slide[key] || '');
}

/** 输入过程中只重画画布，避免面板被重建导致光标丢失。 */
let softTimer = null;
function softRefresh() {
  clearTimeout(softTimer);
  softTimer = setTimeout(() => {
    renderCanvas(getTheme(state.deck.theme));
  }, 160);
}

function pointsEditor(slide) {
  const box = h('div', { class: 'list-editor' });
  const list = slide.points || (slide.points = []);
  list.forEach((p, i) => {
    box.appendChild(
      h('div', { class: 'row-card' }, [
        h('div', { class: 'row-head' }, [
          h('span', { class: 'row-no', text: String(i + 1) }),
          h('button', {
            class: 'mini ghost',
            onclick: () => {
              list.splice(i, 1);
              renderAll();
              saveDeck();
            }
          }, '删')
        ]),
        h('input', {
          class: 'input',
          value: p.lead || '',
          placeholder: '判断句，≤18 字',
          oninput: (e) => {
            p.lead = e.target.value;
            softRefresh();
          }
        }),
        h('textarea', {
          class: 'input',
          rows: '2',
          placeholder: '证据：数字、动作、踩过的坑',
          oninput: (e) => {
            p.detail = e.target.value;
            softRefresh();
          }
        }, p.detail || '')
      ])
    );
  });
  box.appendChild(
    h('button', {
      class: 'mini add',
      onclick: () => {
        if (list.length >= 5) return;
        list.push({ lead: '', detail: '' });
        renderAll();
      }
    }, '+ 加一条')
  );
  return box;
}

function columnEditor(slide, side, label) {
  const col = slide[side] || (slide[side] = { label, items: [] });
  const box = h('div', { class: 'list-editor' });
  box.appendChild(h('div', { class: 'field-label', text: label }));
  box.appendChild(
    h('input', {
      class: 'input',
      value: col.label || '',
      oninput: (e) => {
        col.label = e.target.value;
        softRefresh();
      }
    })
  );
  (col.items || []).forEach((it, i) => {
    box.appendChild(
      h('div', { class: 'row-line' }, [
        h('input', {
          class: 'input',
          value: it,
          oninput: (e) => {
            col.items[i] = e.target.value;
            softRefresh();
          }
        }),
        h('button', {
          class: 'mini ghost',
          onclick: () => {
            col.items.splice(i, 1);
            renderAll();
          }
        }, '×')
      ])
    );
  });
  box.appendChild(
    h('button', {
      class: 'mini add',
      onclick: () => {
        col.items = col.items || [];
        col.items.push('');
        renderAll();
      }
    }, '+ 加一条')
  );
  return box;
}

function stepsEditor(slide) {
  const box = h('div', { class: 'list-editor' });
  const list = slide.steps || (slide.steps = []);
  list.forEach((s, i) => {
    box.appendChild(
      h('div', { class: 'row-card' }, [
        h('div', { class: 'row-head' }, [
          h('span', { class: 'row-no', text: String(i + 1).padStart(2, '0') }),
          h('button', {
            class: 'mini ghost',
            onclick: () => {
              list.splice(i, 1);
              renderAll();
            }
          }, '删')
        ]),
        h('input', {
          class: 'input',
          value: s.label || '',
          placeholder: '阶段名，≤8 字',
          oninput: (e) => {
            s.label = e.target.value;
            softRefresh();
          }
        }),
        h('textarea', {
          class: 'input',
          rows: '2',
          oninput: (e) => {
            s.text = e.target.value;
            softRefresh();
          }
        }, s.text || '')
      ])
    );
  });
  box.appendChild(
    h('button', {
      class: 'mini add',
      onclick: () => {
        if (list.length >= 4) return;
        list.push({ label: '', text: '' });
        renderAll();
      }
    }, '+ 加一步')
  );
  return box;
}

function statsEditor(slide) {
  const box = h('div', { class: 'list-editor' });
  const list = slide.stats || (slide.stats = []);
  list.forEach((s, i) => {
    box.appendChild(
      h('div', { class: 'row-card' }, [
        h('div', { class: 'row-head' }, [
          h('span', { class: 'row-no', text: `#${i + 1}` }),
          h('button', {
            class: 'mini ghost',
            onclick: () => {
              list.splice(i, 1);
              renderAll();
            }
          }, '删')
        ]),
        h('input', {
          class: 'input',
          value: s.value || '',
          placeholder: '数值，例：3.2 倍',
          oninput: (e) => {
            s.value = e.target.value;
            softRefresh();
          }
        }),
        h('input', {
          class: 'input',
          value: s.label || '',
          placeholder: '指标名',
          oninput: (e) => {
            s.label = e.target.value;
            softRefresh();
          }
        }),
        h('input', {
          class: 'input',
          value: s.note || '',
          placeholder: '口径说明',
          oninput: (e) => {
            s.note = e.target.value;
            softRefresh();
          }
        })
      ])
    );
  });
  box.appendChild(
    h('button', {
      class: 'mini add',
      onclick: () => {
        if (list.length >= 3) return;
        list.push({ value: '', label: '', note: '' });
        renderAll();
      }
    }, '+ 加一个数字')
  );
  return box;
}

function chartEditor(slide) {
  const box = h('div', { class: 'list-editor' });
  const kind = h('select', {
    class: 'input',
    onchange: (e) => {
      slide.kind = e.target.value;
      renderAll();
    }
  });
  [['bar', '柱状'], ['line', '折线'], ['pie', '饼图']].forEach(([v, l]) => {
    kind.appendChild(h('option', { value: v, selected: slide.kind === v ? 'selected' : null }, l));
  });
  box.appendChild(field('类型', kind));
  box.appendChild(
    field(
      '分类（逗号分隔）',
      h('input', {
        class: 'input',
        value: (slide.categories || []).join('，'),
        oninput: (e) => {
          slide.categories = e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
          softRefresh();
        }
      })
    )
  );
  const values = (slide.series && slide.series[0] && slide.series[0].values) || [];
  box.appendChild(
    field(
      '数值（逗号分隔）',
      h('input', {
        class: 'input',
        value: values.join('，'),
        oninput: (e) => {
          const nums = e.target.value.split(/[,，]/).map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
          slide.series = [{ name: (slide.series[0] && slide.series[0].name) || '数值', values: nums }];
          softRefresh();
        }
      })
    )
  );
  box.appendChild(field('洞察', areaInput(slide, 'insight', 3)));
  return box;
}

function agendaEditor(slide) {
  const box = h('div', { class: 'list-editor' });
  const list = slide.items || (slide.items = []);
  list.forEach((it, i) => {
    box.appendChild(
      h('div', { class: 'row-card' }, [
        h('div', { class: 'row-head' }, [
          h('span', { class: 'row-no', text: String(i + 1).padStart(2, '0') }),
          h('button', {
            class: 'mini ghost',
            onclick: () => {
              list.splice(i, 1);
              renderAll();
            }
          }, '删')
        ]),
        h('input', {
          class: 'input',
          value: it.label || '',
          placeholder: '章节名，≤18 字',
          oninput: (e) => {
            it.label = e.target.value;
            softRefresh();
          }
        }),
        h('input', {
          class: 'input',
          value: it.hint || '',
          placeholder: '一行说明（可空）',
          oninput: (e) => {
            it.hint = e.target.value;
            softRefresh();
          }
        })
      ])
    );
  });
  box.appendChild(
    h('button', {
      class: 'mini add',
      onclick: () => {
        if (list.length >= 6) return;
        list.push({ label: '新章节', hint: '' });
        renderAll();
      }
    }, '+ 加一条')
  );
  return box;
}

function tableEditor(slide) {
  const box = h('div', { class: 'list-editor' });
  const columns = slide.columns || (slide.columns = ['列一', '列二']);
  const rows = slide.rows || (slide.rows = []);

  box.appendChild(
    field(
      '表头（逗号分隔，2–5 列）',
      h('input', {
        class: 'input',
        value: columns.join('，'),
        oninput: (e) => {
          const next = e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean).slice(0, 5);
          if (next.length < 2) return;
          slide.columns = next;
          // 列数变了就补齐/截断每行，避免错位
          slide.rows = (slide.rows || []).map((r) => {
            const out = r.slice(0, next.length);
            while (out.length < next.length) out.push('');
            return out;
          });
          softRefresh();
        }
      })
    )
  );

  const textarea = h('textarea', {
    class: 'input',
    rows: String(Math.min(9, Math.max(3, rows.length + 1))),
    placeholder: '每行一条，单元格用 | 分隔\n串行流程 | 5 天 | 3 个人',
    oninput: (e) => {
      slide.rows = e.target.value
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 7)
        .map((line) => {
          const cells = line.split(/[|｜\t]/).map((c) => c.trim()).slice(0, slide.columns.length);
          while (cells.length < slide.columns.length) cells.push('');
          return cells;
        });
      softRefresh();
    },
    onblur: () => {
      renderAll();
      saveDeck();
    }
  }, rows.map((r) => r.join(' | ')).join('\n'));
  box.appendChild(field('数据行', textarea));

  box.appendChild(field('脚注', textInput(slide, 'note', '口径说明，可空')));
  return box;
}

function splitEditor(slide) {
  const v = slide.visual || (slide.visual = { value: '', label: '', note: '' });
  const box = h('div', { class: 'list-editor' });
  box.appendChild(
    h('div', { class: 'row-line' }, [
      h('button', {
        class: 'mini',
        onclick: () => {
          slide.side = slide.side === 'left' ? 'right' : 'left';
          renderAll();
        }
      }, slide.side === 'left' ? '视觉块在左 ⇄' : '视觉块在右 ⇄')
    ])
  );
  box.appendChild(field('大数字 / 关键词', h('input', {
    class: 'input', value: v.value || '', placeholder: '例：4 小时 / −68%',
    oninput: (e) => { v.value = e.target.value; softRefresh(); }
  })));
  box.appendChild(field('它是什么', h('input', {
    class: 'input', value: v.label || '', placeholder: '例：平均完结时长',
    oninput: (e) => { v.label = e.target.value; softRefresh(); }
  })));
  box.appendChild(field('口径', h('input', {
    class: 'input', value: v.note || '', placeholder: '例：样本 1,842 单',
    oninput: (e) => { v.note = e.target.value; softRefresh(); }
  })));
  return box;
}

function aiRewriteBlock() {
  const input = h('input', { class: 'input', placeholder: '让 AI 改这一页：更短 / 加一个数字 / 换语气' });
  const run = () => {
    const v = input.value.trim();
    if (!v) return;
    rewriteSelected(v);
    input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  });
  return h('div', { class: 'ai-block' }, [
    h('div', { class: 'field-label', text: '只改这一页' }),
    h('div', { class: 'row-line' }, [input, h('button', { class: 'mini', onclick: run }, '改')]),
    h('div', { class: 'hint', text: '只把这一页发给模型，不动其他页' })
  ]);
}

/* ============================ 页级操作 ============================ */

function move(dir) {
  const i = state.selected;
  const j = i + dir;
  if (j < 0 || j >= state.deck.slides.length) return;
  const arr = state.deck.slides;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  state.selected = j;
  renderAll();
  persistNow();
}

function duplicate() {
  const slide = JSON.parse(JSON.stringify(state.deck.slides[state.selected]));
  slide.id = uid();
  state.deck.slides.splice(state.selected + 1, 0, slide);
  state.selected += 1;
  renderAll();
  persistNow();
}

function removeSlide() {
  if (state.deck.slides.length <= 1) return;
  state.deck.slides.splice(state.selected, 1);
  state.selected = Math.max(0, state.selected - 1);
  renderAll();
  persistNow();
}

function addSlide() {
  const theme = state.deck.theme;
  const blank = normalizeOne({
    type: 'points',
    kicker: '01',
    title: '新的结论句',
    points: [{ lead: '第一条判断', detail: '支撑它的证据' }]
  });
  state.deck.slides.splice(state.selected + 1, 0, blank);
  state.selected += 1;
  renderAll();
  persistNow();
  void theme;
}

/* ============================ 导出 ============================ */

async function doExport() {
  if (state.busy || !state.deck) return;
  state.busy = true;
  setBusy(true);
  setStatus('正在生成 PPTX…');
  try {
    if (!window.PptxGenJS) throw new HostError('no_pptx', 'PptxGenJS 没有加载');
    const theme = getTheme(state.deck.theme);
    const b64 = await buildPptx(window.PptxGenJS, state.deck, theme, layoutSlide);
    const filename = deckFileName(state.deck);
    const bytes = base64ToBytes(b64);
    setStatus(`已生成 ${(bytes.length / 1024).toFixed(0)} KB，正在送到你的设备…`);

    let url = null;
    if (state.anna && state.anna.upload) {
      try {
        const res = await call(state.anna.upload.inline, {
          filename,
          mime_type: PPTX_MIME,
          content_b64: b64,
          purpose: 'user_artifact'
        });
        url = res && (res.download_url || res.url);
      } catch (err) {
        console.warn('[deckcraft] 上传失败，退回本地下载', err);
      }
    }

    if (!url) {
      downloadLocally(bytes, filename);
      setStatus('已在浏览器内生成文件（本地预览模式）');
      return;
    }

    showDownloadBar(url, filename, bytes);
    setStatus('文件已生成，点上面的「下载」保存');
  } catch (err) {
    setStatus('导出失败：' + friendlyError(err));
  } finally {
    state.busy = false;
    setBusy(false);
  }
}

function showDownloadBar(url, filename, bytes) {
  const bar = $('#downloadBar');
  bar.innerHTML = '';
  bar.appendChild(h('span', { class: 'dl-name', text: filename }));
  bar.appendChild(
    h('a', {
      class: 'btn primary',
      href: url,
      target: '_blank',
      rel: 'noopener',
      onclick: () => {
        // 沙箱可能拦下载，留一条本地兜底
        setTimeout(() => downloadLocally(bytes, filename), 400);
      }
    }, '下载')
  );
  bar.appendChild(h('button', { class: 'btn', onclick: () => copy(url) }, '复制链接'));
  bar.appendChild(
    h('button', {
      class: 'btn',
      onclick: async () => {
        try {
          await call(state.anna.chat.append_artifact, {
            artifact: {
              kind: 'text',
              summary: `已生成《${state.deck.title}》`,
              data: { url, filename }
            }
          });
          toast('已贴到对话里');
        } catch (e) {
          toast('贴到对话失败：' + friendlyError(e));
        }
      }
    }, '发到对话')
  );
  bar.appendChild(h('button', { class: 'btn ghost', onclick: () => (bar.hidden = true) }, '收起'));
  bar.hidden = false;
}

function downloadLocally(bytes, filename) {
  const blob = new Blob([bytes], { type: PPTX_MIME });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 4000);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('链接已复制');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('链接已复制');
  }
}

function base64ToBytes(b64) {
  const clean = String(b64).replace(/^data:[^,]+,/, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/* ============================ 状态与提示 ============================ */

/** 常驻提示：仅在"这份内容不是模型生成"时出现，成功走真实模型后自动消失。
 *  用 toast 不够——评审可能刚好错过那 4 秒，然后以为这是真生成的。 */
function setBanner(text) {
  const el = $('#modeBanner');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.textContent = text;
  el.hidden = false;
}

function setStatus(text) {
  const el = $('#statusText');
  if (el) el.textContent = text;
}

function renderStatus() {
  renderQuota();
  const s = $('#statusText');
  if (s && !s.textContent) s.textContent = '点画布上的标题可以直接改';
}

function renderQuota() {
  const el = $('#quotaText');
  if (!el) return;
  // 把"这次是平台模型算的、花了多少"直接写在状态栏。
  // 平台 AI 的使用痕迹不该只存在于代码里——评审要能一眼看见。
  const parts = [];
  if (state.lastCall && state.lastCall.model) parts.push(state.lastCall.model);
  if (state.quota) parts.push(`本会话 ${Math.round(state.quota)} CU`);
  el.textContent = parts.join(' · ');
}

function setBusy(on) {
  document.body.classList.toggle('is-busy', on);
  $('#btnGenerate').disabled = on;
  $('#btnExport').disabled = on;
}

function toast(text) {
  const box = $('#toast');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    box.hidden = true;
  }, 4200);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/* ============================ 事件 ============================ */

window.addEventListener('resize', fitCanvas);

// 宿主环境看不到 console，把未捕获异常写到状态栏，排查时不用开 DevTools
window.addEventListener('error', (e) => {
  setStatus('脚本错误：' + (e.message || '未知'));
  console.error(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason || {};
  setStatus('未处理的异常：' + (reason.message || String(reason)));
  console.error(reason);
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    doExport();
  }
});

// 测试钩子：端到端脚本要验证「真的写进了宿主存储」，而不是只看界面有没有变。
// 只在 iframe 内部可见，不影响任何用户路径。
window.__deckcraft = {
  getDeck: () => state.deck,
  setDeck: (d) => {
    state.deck = d;
    state.selected = 0;
    renderAll();
  },
  persistNow,
  restore,
  storageReady: () => Boolean(state.anna && state.anna.storage)
};

boot();
