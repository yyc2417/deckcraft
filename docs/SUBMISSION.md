# 交付信息（发给评审/HR 的原文）

## 一句话

DeckCraft：把一段现成材料变成一份「每页结论句都能被追问」的 10 页演示，导出的 .pptx 在 PowerPoint 里还能继续改。

## 三个必填项

| 项 | 值 |
|---|---|
| GitHub 仓库 | https://github.com/yyc2417/deckcraft （public，main） |
| App name | **DeckCraft** |
| Slug | **deckcraft**（完整命名空间 `@yyc2417/deckcraft`，app_id 261） |

## 平台侧状态（如实写，不要美化）

- 在审版本：**v1.0.4**，状态 `pending_review`（提交后一直未审，平台无 SLA）
- **working draft 已推送且 bundle 状态 ready**，在 Developer Console 里可直接安装体验
- 真实模型调用：`xiaomi/mimo-v2.5`，短材料回传 0 CU，5000 字长材料回传 1 CU
- 环境里没有任何第三方 API key / base URL，AI 全部走 `anna.llm.complete`

## 怎么体验（写给评审）

**注意：working draft 只有开发者自己的账号可见**（平台规则：`DRAFT` 状态 "Not visible to anyone but you"），
评审装不了 draft。pending_review 期间的体验路径只有两条：

1. **看仓库 README 顶部的演示 GIF**——真实平台模型生成 + 翻页的实际录屏，不是渲染图
2. **审核通过后直接安装**：`APPROVED` 状态下商店搜不到，但**可以直接 lookup 安装**
   （App name `DeckCraft` / slug `deckcraft`）；管理员 approve 后即为可用状态

体验要点：贴一段真实材料 → `#deckcraft` → 生成后点画布标题直接改字、换版式（不耗额度）→ 导出 PPTX

## 邮件/微信正文（可直接复制）

> 您好，笔试题已完成，交付信息如下：
>
> - GitHub 仓库：https://github.com/yyc2417/deckcraft
> - App name：DeckCraft
> - Slug：deckcraft（@yyc2417/deckcraft，app_id 261）
>
> 产品定位：把一段现成材料（周报/纪要/论文摘要）变成一份能讲的 10 页汇报，每页标题是一句可被反驳的判断句，而不是「背景/现状」这类标签。骨架确认后，换版式、换主题、调顺序都是纯前端重算，**不消耗模型额度**；导出的 .pptx 里文字是文本框、图形是形状、图表是 PowerPoint 原生图表（双击可改数据）。
>
> 平台侧：AI 能力全部走 `anna.llm.complete`，App 内不持有任何 API key；真实调用已跑通（模型 xiaomi/mimo-v2.5），额度消耗记录在仓库 README 的「发布状态」里。当前版本 v1.0.4 已提交审核（`pending_review`，平台审核无 SLA）；审核通过前可先看仓库 README 顶部的真实生成录屏，通过后用 App name `DeckCraft` 直接安装。
>
> 体验建议：现在可以先看仓库 README 顶部的真实生成录屏；管理员 approve 后用 App name `DeckCraft` 直接安装，贴一段手边材料试一次，重点看两件事——标题是不是判断句、导出的 PPTX 能不能继续改。工程记录见 `docs/PLATFORM-NOTES.md`（平台踩坑）和 `docs/RELEASE.md`（发布 runbook）。
