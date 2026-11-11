# 发布 runbook

从「代码在本机」到「App Store 里能被别人装上」要走的五步，以及每步之后该验什么。
按顺序执行，任何一步失败都不要往下走。

## 0. 前置（开发者账号，一次性）

1. 在 `https://staging.anna.partners` 注册并**完成邮箱验证**（未验证时开不了开发者）。
2. 打开 `/developer`，读并接受 Developer ToS，点 **Activate developer access**。
   这一步是自助的、即时的，不需要等人工审批。
3. 设置 handle（App 会以 `@handle/slug` 发布）：

   ```bash
   anna-app account set-handle <handle>
   ```

## 1. 登录

```bash
anna-app login --host https://staging.anna.partners
```

设备码流程：终端会打印一个码，浏览器里确认。凭据落在
`~/.config/anna/credentials.json`，之后所有命令复用。

```bash
anna-app whoami          # 确认当前账号与 host
```

## 2. 本地最后一道闸

```bash
anna-app validate --strict     # manifest + bundle 静态检查 + Host API 调用白名单
npm run smoke                  # 三主题导出
python tools/check-pptx.py out/*.pptx
node tools/overflow-check.mjs  # 正常 + 压力两轮文本溢出
node tools/flow-test.mjs       # 宿主握手 / 生成 / 存储往返 / 导出
```

## 3. 推工作草稿（可以反复推，不影响版本）

```bash
anna-app apps push
```

push 之后立刻做**真机自测**，这是题目要求「在该平台完成真实测试」的那一步：

1. 在 App Center 里把 DeckCraft 装到自己的账号（draft 版本可直接装）。
2. 打开对话，输入 `#deckcraft 把这段周报做成 10 页`，贴一段真实材料。
3. 检查：窗口是否自己弹出、生成是不是走了真实模型（画布上方**不应**出现
   「示例数据」横幅）、状态栏右下角是否有模型名与 CU 消耗、导出的 `.pptx` 能否打开。

把这次调用的 `_meta.quotaConsumed` 记下来写进 README 的「验证记录」。

## 4. 切版本并提交审核

```bash
anna-app apps cut 1.0.0 --changelog "首个版本：12 种版式、3 套主题、真 PPTX 导出"
anna-app apps submit-review
```

提交前确认 UI bundle 已经是 `bundle_ready`——`push` 会走完
`bundle/init → PUT → finalize`，如果卡在 draft，打开窗口会报 `bundle_not_ready`。

审核没有 SLA，所以**尽早提交**，之后改代码不影响在审的那个版本。

## 5. 发布

管理员 approve 之后：

```bash
anna-app apps status deckcraft        # 确认状态是 APPROVED
anna-app apps release 1.0.0
```

`release` 把该版本标成 `is_latest`，App 状态自动升到 PUBLISHED，此时才会出现在
App Store 列表里、别的用户才能搜到并安装。

## 可能会踩的坑

| 现象 | 原因 | 处理 |
|---|---|---|
| `slug` 冲突 | slug 全局唯一且创建后不可改 | 换 `deck-craft`，同时改 `manifest.json` 里 `--slug` 与 listing |
| 提交时 `400` | 没有 cut 版本，或 bundle 未 ready | 先 `apps cut`，再 `bundle status` 确认 `bundle_ready` |
| 审核说要截图 | listing 的 `screenshots[]` 必须是**公网可访问的 URL**，不是本地路径 | 仓库公开后用 `raw.githubusercontent.com` 链接 |
| 窗口打开报 `bundle_not_ready` | 版本 bundle 还是 draft | 重跑 `apps push`，它会把 bundle 重新 finalize |
| 生成时出现「示例数据」横幅 | 当前环境的 `llm.complete` 不可用（浏览器缓存了旧 bundle、或额度耗尽） | 强刷窗口；到用量页确认剩余额度 |

## 当前状态

- 代码、bundle、图标、截图、商店文案：就绪
- `anna-app validate --strict`：通过
- 上架用的截图：**在本地预览环境拍的**，画布上方带「示例数据」横幅。
  真机（接了模型）跑通后应重拍 `assets/listing/shot-1-editor.png` 与 `shot-2-input.png`。
