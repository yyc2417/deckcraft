# 平台踩坑记录

做这个 App 的过程中真实遇到的问题，按"现象 → 原因 → 解法"记。写给下一个做 Anna App 的人，也方便评审判断我到底摸到多深。

---

## 1. 文档是 Markdown-first，别去爬 HTML

**现象**：直接抓 `staging.anna.partners/developers` 得到的是 JS 渲染的壳，正文寥寥。

**原因**：平台给 AI agent 准备了纯文本通道：任意 `/developers/**` URL 后加 `.md`、或带 `Accept: text/markdown`，以及 `/llms.txt`（索引）与 `/llms-full.txt`（全量 90 万字符）。

**解法**：先拉 `/llms.txt` 摸清结构，需要细节再按 slug 拉 `.md`。整份文档 5 分钟能读完，比在 HTML 里翻半小时准。

## 2. `anna-app dev` 首次启动容易假死

**现象**：`anna-app dev` 报 `python bridge did not signal ready in 8s`。

**原因**：首次运行要用 `uvx` 现装 `anna-app-runtime-local`（十几兆依赖），8 秒 ready 超时不够。第二次运行就正常。

**解法**：先手动预热一次，再启动 harness：

```bash
uvx anna-app-runtime-local@0.2.0a33 --help
```

顺带发现包里真正的可执行文件叫 `anna-app-bridge`，不是包名。

## 3. `--no-llm` 时调用是抛错，不是返回空

**现象**：本地 harness 里点生成，界面直接不响应。

**原因**：`anna.llm.complete` 抛 `not_implemented`（`llm_disabled`），SDK 的 Promise 直接 reject。

**解法**：`llm.js` 把错误码翻成人话；`app.js` 在 `not_implemented / llm_disabled / no_llm` 时自动降级到内置示例并说明原因——评审第一次点开就必须看到东西，不能停在错误上。

## 4. bundle 的 CSP 不允许任何外链脚本

**现象**：想用 CDN 引 PptxGenJS，直接被 CSP 拦。

**原因**：bundle 的基础 CSP 是 `default-src 'none'`、`script-src 'self'`，只有 `csp_overrides` 里列出的指令能放开，且 `script-src` 只接受 `'self'` / `'wasm-unsafe-eval'` / hash / nonce——**没有 CDN 选项**。

**解法**：把 `pptxgen.bundle.js`（460 KB，内含 JSZip）直接放进 `vendor/`。同时静态检查了这个文件：全文只有一处 `new Function`，在 `setImmediate` 的 polyfill 里，且只在传入非函数时执行——加载期不会触发 CSP。`eval(` 为 0 处。

## 5. manifest 的 `extra="forbid"` 比想象中严

**现象**：照旧文档抄的 `permissions`、`host_capabilities` 直接被拒。

**原因**：schema 4 用 Pydantic `extra="forbid"`，退役字段会报错（schema ≤3 才做归一化）。

**解法**：只留 `schema` / `required_executas` / `optional_executas` / `system_prompt_addendum` / `ui` / `tags` / `dev`。能力声明只剩三样（`credentials` / `storage.scopes` / `agent.tools`），而这个 App 一样都不需要——**安装即授权，额度即闸门**。

## 6. 纯 UI App 是合法的，但要 schema ≥ 2

**现象**：`required_executas` 留空会不会被判无效？

**原因**：schema 1 要求至少一个 Executa；schema ≥ 2 的 bundle-only App 允许两个数组都空。

**解法**：`"required_executas": []` + `ui.views` 即可，`anna-app validate` 通过。附带好处是安装时权限说明只有三行。

## 7. iframe 里的下载是受限的

**现象**：`<a download>` 在沙箱 iframe 里点不动；`window.open` 也可能被拦（取决于宿主是否给 `allow-popups` / `allow-downloads`）。

**原因**：App iframe 是 `sandbox` 且不带 `allow-same-origin`，下载/弹窗都需要显式授权，而这不在 App 作者的控制范围内。

**解法**：导出走三步 —— 浏览器内生成 → `anna.upload.inline` 拿 30 分钟有效的 presigned URL（Office 类型在允许列表内，**不走 CSP**）→ 界面同时给「下载 / 复制链接 / 发到对话」三个出口。任何一条被宿主拦掉，用户仍有办法拿到文件。

## 8. 宿主里没有 console

**现象**：staging 上一旦报错，界面白屏，无处可查。

**原因**：iframe 里没有 DevTools，出错也不会显示。

**解法**：`window.onerror` + `unhandledrejection` 直接写到状态栏；`window.report_error` 还没接，但错误文案已经能自己说话。

## 9. `anna-app dev` 的 dashboard 是 mock，不能替代真机

**现象**：本地一切正常，到 staging 可能不一样。

**原因**：本地 harness 用内存 `WindowStore`、`storage legacy` 模式，且不发送 CSP 头（文档明确说明「embeds work locally even without the declaration」）。

**解法**：CSP 相关、上传、下载、`#mention` → `open_app_view` 的链路，必须在 staging 的 working draft 上再过一遍。本地只用来验版式和交互。

## 10. 发布是五个动作，不是一个

**现象**：以为 `publish` 就上架了。

**原因**：`apps push`（工作草稿）→ `apps cut <version>`（冻结不可变版本）→ `apps submit-review`（提交审核）→ 管理员 approve → `apps release` 才真正上线。审核没有 SLA。

**解法**：把 listing 文案、图标、截图在提交前一次做全，把审核排到最早的可行时间点；通过前可以用 working draft 直接装到自己账号上做真机验证。

## 11. 审核实测：无 SLA，首次 7.5 小时，新版本 release 也要再批一道

**现象**：v1.0.4 于 09:58 首次 `submit-review`，17:37 才被 approve + publish，中间无任何进度反馈；随后 `release 1.1.0` 时 CLI 回执说「it goes live once an admin approves; the current live version keeps serving users」——**每个新版本的发布都要管理员再批一道**，这一点所有文档都没写，只有实测才知道。

**原因**：staging 环境没有审核队列的 SLA 或自动任务，管理员上班时间人工处理；夜间和周末完全不流动。

**解法**：① 提交审核放在一天里最早的可行时间点；② 审批期间旧版本继续服务，所以发新版永远是安全的（最坏结果是排队）；③ 不要相信「过审后发版免审」的推断——文档的沉默不是许可。

## 12. PENDING_REVIEW 期间重钉候选版本 = 重新排队

**现象**：为赶进度切了 4 次版本（1.0.0→1.0.4）并各自 `submit-review`，每次都「Switch review candidate」并重跑预检；总等待时间因此被拉长。

**原因**：平台允许在 PENDING_REVIEW 中换候选，但每次换钉都是一次新的提交动作。

**解法**：审核挂起期间冻结版本，改动全部进仓库，攒成一个版本一次提交。改一个 typo 不值得重排一次队。

## 13. DRAFT 只有作者自己可见，评审装不了

**现象**：交付说明里想让评审「在 Developer Console 装 working draft 体验」——做不到。

**原因**：平台状态机里 `DRAFT` 的定义就是 "Not visible to anyone but you"；`PENDING_REVIEW` 时商店详情页对评审可见但只展示 candidate 的工具绑定；真正的「别人可装」要等 `APPROVED`（商店搜不到但 direct lookup 可装）或 `PUBLISHED`。

**解法**：pending 期间给别人看效果，唯一诚实的方式是仓库里放真实生成的录屏/截图（`tools/real-test.mjs` 的 `RECORD=` 出帧、PIL 拼 GIF）。注意 Puppeteer 在模型生成期间截不到帧（CDP 拿不到画面），只能在生成前后等确定节点截。
