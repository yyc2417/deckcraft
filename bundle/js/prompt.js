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
12 {"type":"end","title":"下一步的一句话","subtitle":"≤40 字"}

除上面各类型的字段外，**每一页都要带 "notes"**：
"notes": "≤60 字的口播提示——讲这页时嘴里说的第一句话，或者是需要提醒自己别忘的那个点。
不要复述标题，不要写'大家好''接下来我们看'这类过场语。"`;

const RULES = `0. **每一页的 JSON 都必须带 "notes" 字段**（≤60 字的讲稿口播），缺了就是不合格输出。
   notes 写"讲这页时嘴里说的第一句话"，不是复述页面上的字，也不要写"大家好""接下来我们看"。
   封面和目录页同样要有 notes（封面：开场第一句；目录：告诉他们后面还有多久）。

写作要求（按重要性排序）：

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

6. **语言完全跟随材料**：材料是英文，全部输出英文（标题、要点、图表分类、结尾都一样），
   不要翻译成中文；材料是中文就用中文；中英混排时按正文主体语言走。
   字数上限（≤N 字）对英文按"词"宽松理解，宁可短也不要为了凑字数拆句。
   专有名词保留原文，不要翻译。

7. 页数必须正好等于用户要求的数字（含封面和结尾页）。少一页都算不合格：
   如果写完发现只有 N-2 页，说明每页塞得太满，把信息拆开补足，不要少给。

8. chart 页的多个系列必须同量纲。把"小时"和"百分比"画在同一张图上，
   后者会被压成一条贴底的直线，读者什么也看不出来——请拆成两页，或只留一条。

9. 不要出现"本文将""接下来我们"这类元叙述，直接说内容。

9b. 每页的 notes 写"怎么讲"，不是"页面上写了什么"：
   好的例子「这里停一下，问他上一次遇到这种情况是什么时候」；
   坏的例子「本页介绍了三个改造步骤」。

10. 选版式的判断（这一条决定成品像不像"人做的"，务必执行）：
   - 材料里出现 **2 个以上可比数字**（时长、占比、倍数、样本量），
     必须至少用一页 stat 或 chart 把它们摆出来；只写进 detail 等于浪费了最硬的证据。
   - chart 页只能放**同量纲**的数：材料里既有"天"又有"小时"，先统一成同一个单位再画，
     单位写进 categories（例：["改造前 124.8h", "改造后 4h"]），绝不把 5.2 和 4 并排比。
   - insight 只写"这组数字说明了什么"，**不要写你是怎么换算、怎么处理的**——
     读者不关心口径推导，写进去会像工作笔记。
   - 三个以上的横向对比（方案 / 版本 / 竞品 / 前后差异），用 table，不要用 points 硬凑；
     最多 5 列 7 行，单元格 ≤16 字，第一列是被比较的对象。
   - 有一个能概括全场的数字或关键词（时长、倍数、占比），用 split 把它放大，
     右边配 2-3 条支撑；不要把它塞进 points 的第一条。
   - 页数 ≥8 时，第 2 页放 agenda，章节名用判断句，不要写"第一部分"；
     页数 <8 不要放目录。
   - 一页里只讲一件事。如果两个要点各自还要展开，就拆成两页，不要挤在一页的 detail 里。
   - **不要有两页讲同一件事**。写完通读一遍标题：如果两页的结论句意思重叠
     （比如都在说"退回率没降，卡在字段错"），删掉一页，把省下的位置给别的内容——
     缺内容就补"代价是什么""谁受影响""怎么验证"，而不是换个说法重复一遍。`;

function sceneLine(scene) {
  const found = SCENES.find((s) => s.id === scene || s.name === scene);
  if (!found) return '场景：通用汇报';
  return `场景：${found.name}（${found.hint}）`;
}

/** 生成整份 deck 的消息。 */
/**
 * 判断材料主体语言。
 *
 * 为什么要在 JS 里判定、而不是只写一句"跟随材料"：实测把规则写进 system 后，
 * 英文材料仍然输出中文——中文 system + 中文 schema 的惯性太强。改成由代码判定，
 * 再把结论作为硬指令放在最前面，模型就没有选择余地。
 */
export function detectLang(text) {
  const s = String(text || '');
  const cjk = (s.match(/[\u3000-\u9fff\uff00-\uffef]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  if (!cjk && !latin) return 'zh';
  return cjk >= latin * 0.2 ? 'zh' : 'en';
}

export function buildDeckMessages({ brief, scene, slides = 8, extra = '' }) {
  const material = String(brief || '').trim();
  const lang = detectLang(material);
  const langRule = lang === 'en'
    ? 'OUTPUT LANGUAGE: English. Write every user-visible string in English — slide titles, body text, category labels, series names, notes, the deck title and subtitle. Do not translate to Chinese. Keep product and paper names as-is.'
    : 'OUTPUT LANGUAGE: 中文。所有面向读者的文字（标题、正文、图表分类、系列名、备注）都用中文。';
  const system = [
    '你是一位给技术团队写汇报的叙事顾问。你写的每一页都要能被追问，而不是好看。',
    '你的输出会被程序直接解析成幻灯片，任何多余字符都会导致解析失败。',
    langRule
  ].join('\n');

  const user = [
    langRule,
    `请为下面这份材料做一份 ${slides} 页的演示文稿，每一页都要带 notes 字段。`,
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
