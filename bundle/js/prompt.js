/**
 * 提示词构造。
 *
 * 设计取舍：
 * 1. 只做一次调用产出整份 deck，不做「先大纲再逐页」。多轮调用在额度上贵 2-3 倍，
 *    而且每轮都会丢上下文；一份 10 页 deck 的输出约 2000 token，单次完全放得下。
 * 2. schema 放在 user 消息末尾（离生成位置最近），system 只放角色与硬约束。
 * 3. 用「坏例子 / 好例子」对照约束标题写法——比形容词更有效。
 */

export const SCENES = [
  { id: 'report', name: '组会汇报', hint: '给导师和同门讲进展' },
  { id: 'class', name: '课程 pre', hint: '课堂展示，重结构' },
  { id: 'review', name: '方案评审', hint: '要结论和取舍' },
  { id: 'competitor', name: '竞品分析', hint: '对比与差异' },
  { id: 'retro', name: '项目复盘', hint: '数据与归因' }
];

const SCHEMA_BLOCK = `只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。结构：

{
  "title": "整份演示的标题（≤20 字）",
  "subtitle": "一句话说明给谁看、要解决什么（≤40 字）",
  "slides": [ ... ]
}

slides 里每页从下面 12 种里选一种，字段严格按此命名：

1 {"type":"cover","kicker":"场景标签","title":"","subtitle":"","meta":"日期或汇报人"}
2 {"type":"section","kicker":"01","title":"章节结论句","subtitle":""}
3 {"type":"points","kicker":"","title":"结论句","points":[{"lead":"≤18 字判断","detail":"≤45 字证据或做法"}]}
4 {"type":"compare","title":"结论句","left":{"label":"对照项 A","items":["≤20 字",""]},"right":{"label":"对照项 B","items":[""]}}
5 {"type":"timeline","title":"结论句","steps":[{"label":"≤8 字阶段","text":"≤40 字发生了什么"}]}
6 {"type":"stat","title":"结论句","stats":[{"value":"12 倍","label":"≤10 字指标","note":"≤30 字口径说明"}]}
7 {"type":"chart","title":"结论句","kind":"bar|line|pie","categories":[""],"series":[{"name":"","values":[0]}],"insight":"≤40 字，这组数字说明什么"}
8 {"type":"quote","quote":"≤60 字原话或结论","attribution":"出处"}
9  {"type":"agenda","kicker":"目录","title":"","items":[{"label":"≤18 字章节名","hint":"≤26 字一句话"}]}
10 {"type":"table","title":"结论句","columns":["≤8 字",""],"rows":[["≤16 字",""]],"note":"口径说明"}
11 {"type":"split","title":"结论句","value":"≤10 字的大数字或关键词","label":"≤18 字它是什么","note":"口径","side":"right","points":[{"lead":"","detail":""}]}
12 {"type":"end","title":"下一步的一句话","subtitle":"≤40 字"}`;

const RULES = `写作要求（按重要性排序）：

1. 每页 title 必须是一句可以被反驳的判断句，不是名词标签。
   坏：「项目背景」「现状分析」「解决方案」「技术架构」
   好：「真正的瓶颈不在模型，在检索召回」「四周把首屏时间从 3.2 秒压到 0.9 秒」
   标题 ≤22 字，不要句号。

2. points 页 3-4 条。lead 是判断（≤18 字），detail 是证据（≤45 字）：
   具体的人、数字、动作、失败过什么。禁止「提升效率」「优化体验」「赋能业务」这类空话。

3. 材料里出现的数字必须原样使用，不许改写、不许估算。材料里没有数字时，
   不要生成 chart 或 stat 页，改用 points 或 compare。

4. 结构按材料本身走，默认顺序：结论 → 为什么 → 怎么做 → 证据 → 下一步。
   section 过渡页最多 1 张，能不用就不用。

5. 最后一页 end 不要写「谢谢聆听」，写具体的下一步动作或待讨论的问题。

6. 全文语言与材料一致（中文材料用中文），专有名词保留英文原文，不要翻译。

7. 页数必须正好等于用户要求的数字（含封面和结尾页）。

8. chart 页的多个系列必须同量纲。把"小时"和"百分比"画在同一张图上，
   后者会被压成一条贴底的直线，读者什么也看不出来——请拆成两页，或只留一条。

9. 不要出现"本文将""接下来我们"这类元叙述，直接说内容。

10. 选版式的判断：
   - 三个以上的横向对比（方案 / 版本 / 竞品 / 前后差异），用 table，不要用 points 硬凑；
     最多 5 列 7 行，单元格 ≤16 字，第一列是被比较的对象。
   - 有一个能概括全场的数字或关键词（时长、倍数、占比），用 split 把它放大，
     右边配 2-3 条支撑；不要把它塞进 points 的第一条。
   - 页数 ≥8 时，第 2 页放 agenda，章节名用判断句，不要写"第一部分"；
     页数 <8 不要放目录。`;

function sceneLine(scene) {
  const found = SCENES.find((s) => s.id === scene || s.name === scene);
  if (!found) return '场景：通用汇报';
  return `场景：${found.name}（${found.hint}）`;
}

/** 生成整份 deck 的消息。 */
export function buildDeckMessages({ brief, scene, slides = 8, extra = '' }) {
  const material = String(brief || '').trim();
  const system = [
    '你是一位给技术团队写汇报的叙事顾问。你写的每一页都要能被追问，而不是好看。',
    '你的输出会被程序直接解析成幻灯片，任何多余字符都会导致解析失败。'
  ].join('\n');

  const user = [
    `请为下面这份材料做一份 ${slides} 页的演示文稿。`,
    sceneLine(scene),
    extra ? `额外要求：${extra}` : '',
    '',
    material ? '=== 材料开始 ===\n' + material + '\n=== 材料结束 ===' : '材料为空。请按场景给出一份结构完整、内容克制的通用骨架，并在每页 detail 里保留待填占位（用「待补：」开头）。',
    '',
    RULES,
    '',
    SCHEMA_BLOCK
  ]
    .filter((l) => l !== '')
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

/** 单页改写：只回一页，省额度，也避免整份重生成把用户改过的地方冲掉。 */
export function buildSlideMessages({ slide, instruction, deckTitle }) {
  const system = '你是一位演示文稿编辑。你只改一页，其余内容一概不碰。只输出 JSON。';
  const user = [
    `这是《${deckTitle || '演示'}》里的一页，当前内容：`,
    JSON.stringify(slide, null, 2),
    '',
    `修改要求：${instruction || '表达更紧凑，去掉套话'}`,
    '',
    '要求：保持 type 不变，标题仍是判断句，字数不增加 20% 以上。',
    '只输出修改后的这一个 slide 对象（顶层是 {"type":...}），不要外层包装，不要解释。',
    '',
    SCHEMA_BLOCK
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

/** 骨架重排：只调整顺序与标题，不重写正文。 */
export function buildOutlineMessages({ deck }) {
  const outline = (deck.slides || []).map((s, i) => `${i + 1}. [${s.type}] ${s.title || ''}`);
  const system = '你是一位演示文稿结构编辑。只输出 JSON。';
  const user = [
    '这是当前演示的骨架：',
    outline.join('\n'),
    '',
    '请只做两件事：调整页顺序使叙事更顺，改写标题让它更像判断句。',
    '不要新增或删除页，不要改正文。',
    '输出 JSON：{"slides":[{"index":原页码,"title":"新标题"}]}'
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}
