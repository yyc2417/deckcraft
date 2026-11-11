# DeckCraft

把一段材料变成一份**能讲的**演示文稿，导出真 `.pptx`。

Anna App · 在 [Anna staging](https://staging.anna.partners) 里搜 DeckCraft，或在对话里 `#deckcraft` 直接叫出来。

![DeckCraft 编辑器](assets/listing/shot-1-editor.png)

---

## 它解决什么问题

用 AI 做 PPT 的工具已经很多，但大多卡在同一个地方：**生成完就结束了**。

- 给的是一堆排好版的文字，不是一条能讲下来的线索；
- 想改一个字只能整份重生成，前面的调整白费；
- 导出的是图片，或者一堆散落的文本框，在 PowerPoint 里动一下就乱。

DeckCraft 的判断是：**做 PPT 的难点在「讲什么」，不在「怎么排」**。所以它先给结论再给版式；排版可以反复换而不花钱；导出的每一页都是 PowerPoint 原生对象，拿到文件还能继续改。

## 它做什么

| 能力 | 说明 |
|---|---|
| 材料 → 骨架 | 贴周报、会议纪要、论文摘要，或只写一句主题。生成整份的叙事顺序，每页标题是一句**可以被反驳的判断**，不是「背景」「现状」这类标签 |
| 改骨架 | 生成后先看到整份的标题序列，直接在画布上改文字，再决定版式 |
| 换版式 / 换主题 | 10 种版式、3 套主题，纯前端重算，**不调用模型、不消耗额度** |
| 改单页 | 「更短」「加一个数字」「换语气」——只把这一页发给模型，不动其他页 |
| 导出 .pptx | 16:9，文本框 / 形状 / 表格 / 图表都是原生对象；图表是 PowerPoint 原生图表，双击能改数据 |
| 聊天触发 | 在 Anna 对话里 `#deckcraft 把这份周报做成 10 页`，窗口自动打开并开始生成 |

## 架构

```
Anna 对话 ──#mention──▶ 模型调 open_app_view(payload={brief})
                              │
                              ▼
                    ┌──────────────────────┐
                    │  iframe（本 bundle） │
                    │  js/layout.js        │  一份坐标规格
                    │     ├─▶ js/render.js  → DOM 预览
                    │     └─▶ js/export.js  → PptxGenJS
                    └──────────────────────┘
                              │ anna.llm.complete
                              ▼
                        平台代付模型
```

**纯 UI App**：manifest `schema: 4`，不打包任何 Executa。所有能力走 Host API（`llm` / `storage` / `upload` / `chat`），没有自己的服务端、没有 API key、没有数据库。

代价是不能在聊天里直接甩一个文件（必须开窗）；换来的是安装时零权限声明、没有进程冷启动、编辑与预览都在浏览器里即时完成。

### 平台 AI 能力的用法

产品里所有"智能"都来自平台，App 自身不持有任何模型凭据。平台对外有三个层次，这里只用了第一层：

| 平台能力 | 形态 | 本项目 |
|---|---|---|
| `llm.complete` / `llm.stream` | 单次补全，平台选模型、平台计费 | **使用**：一次调用产出整份骨架 |
| `agent.session` | 多轮、可调工具的会话 | 不用——工具循环的 token 开销是单次补全的 3 倍以上，而这里只要一次结构化输出 |
| `sampling`（Executa 侧） | 插件向宿主借模型 | 不适用——没有 Executa |

为什么坚持单次调用：一份 10 页 deck 的输入约 1.5k token、输出 2–3k token，单次就能装下。拆成"先大纲再逐页"会变成 5–10 次调用，额度翻几倍，而且每次都要重传上下文。**额度是这道题的硬约束（1000 CU），省额度不是省成本，是产品设计的一部分。**

模型的选择、provider 路由、计费都在平台侧，App 只描述"要什么"；一次生成实际花了多少额度由 `_meta.quotaConsumed` 回传，界面右下角有累计显示——这个数字是真实消耗，不是估算。

### 一份坐标，两个渲染器

`layout.js` 把每页编译成与渲染器无关的图元（矩形 / 文本 / 线 / 图表，单位英寸），DOM 预览和 PPTX 导出消费同一份数据。所见即所得不是靠人工对齐，而是**结构上只存在一份**。

### 导出为什么"还能改"

`export.js` 里没有一处把内容画成图片：

| 预览里的东西 | 导出的东西 |
|---|---|
| 标题、正文 | `addText` 文本框（16:9，`fit: shrink`） |
| 色块、分隔线 | `addShape` 矩形 / 直线 |
| 柱状图、折线、饼图 | `addChart` 原生图表，数据可编辑 |

## 本地跑

不需要注册账号，也不需要额度：

```bash
npm i -g @anna-ai/cli                          # 需要 Node 22+
uvx anna-app-runtime-local@0.2.0a33 --help     # 预热运行时（原因见 PLATFORM-NOTES #2）
cd deckcraft
anna-app dev --no-llm                          # http://localhost:5180
```

要直接看一份完整示例（跳过模型、用内置数据）：

```
http://localhost:5180/anna-apps/deckcraft/dev/index.html#demo
```

```bash
anna-app validate --strict               # manifest + bundle 静态检查
npm run smoke                            # 不开浏览器，跑 layout → pptx 并检查结构
python tools/check-pptx.py out/*.pptx    # 逐页校验图元有没有跑出画布
node tools/overflow-check.mjs            # 逐页量文本溢出（正常内容 + 压力内容两轮）
node tools/shot.mjs <url> <name> [页码]   # headless 截图，同时抓 console 报错
```

## 验过什么

| 检查 | 命令 | 结果 |
|---|---|---|
| manifest + bundle 静态检查 | `anna-app validate --strict` | 通过 |
| 三主题导出 | `npm run smoke` | 各 12 页 / 226 KB / 157 个图形 |
| 图元是否跑出画布 | `python tools/check-pptx.py out/*.pptx` | 0 处越界 |
| 文本是否溢出文本框 | `node tools/overflow-check.mjs` | 正常 + 压力两轮，0 处 |
| 端到端（宿主 / 生成 / 存储 / 导出） | `node tools/flow-test.mjs` | 6 项全过 |
| 版式互转是否丢内容 | 手测 5 条路径 | 内容保留，无报错 |

真实模型调用与上架流程见 [docs/RELEASE.md](docs/RELEASE.md)。

## 目录

```
manifest.json          App 清单：视图、提示词追加、能力声明
app.json               商店文案
bundle/
  index.html           三栏外壳
  css/app.css          编辑器 UI（与幻灯片主题无关）
  js/layout.js         ★ 版式引擎：一份坐标，两个渲染器
  js/render.js         DOM 渲染（预览、缩略图、自动缩字）
  js/export.js         PPTX 导出（PptxGenJS 由外部注入，浏览器/Node 同源）
  js/deck.js           数据模型与规范化（把 AI 输出收敛成可信结构）
  js/prompt.js         提示词（整份生成 / 单页改写）
  js/llm.js            宿主模型调用 + JSON 容错解析
  js/app.js            控制器
  js/theme.js          主题令牌
  js/mock.js           离线示例数据
  vendor/              PptxGenJS 4.0.1（MIT）
tools/                 冒烟、几何检查、溢出检查、截图、图标生成、任意 deck 渲染
  fixtures/            两份非汇报题材的验证稿（产品发布 / 论文答辩）
docs/                  DESIGN.md（产品取舍）· PLATFORM-NOTES.md（平台踩坑）· RELEASE.md（发布 runbook）
```

## 已知限制

- **字体**：导出用 `Microsoft YaHei`，Windows 版 Office 与 macOS 自带；Linux 上会被替换，建议导出后在本机确认一次。
- **图表预览**：预览用 SVG 近似，导出是 PowerPoint 原生图表，数值与分类一致，细节不完全等价。
- **字号是算出来的，不是自动缩的**：`layout.js` 按字数预估行数决定字号，PNG 预览和 PPTX 用同一个值。代价是估算偏差（约 3% 余量）要靠 `overflow-check` 兜住，而不是靠 PowerPoint 的 autofit。
- **单页改写依赖模型**：额度耗尽时该按钮不可用，其余编辑不受影响。
- **没有 AI 配图**：一张图几十 CU，而这类内容用色块和图表讲更清楚。这是取舍，不是没做完。
- **「图文」版式里的视觉块是文字，不是图片**：放的是大数字或关键词，用来扛住"一页一句"的场景。真图片需要上传管线（`upload.inline` + `addImage`），排在 v1.1。

## 许可

MIT。PptxGenJS 4.0.1 同样是 MIT，见 `bundle/vendor/pptxgenjs-LICENSE`。
