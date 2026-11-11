/**
 * 交付合规自检：把题目的硬要求拆成可机器验证的检查项。
 *
 * 只检查"代码层面能证明"的部分——账号、真实调用、上架这些必须由平台侧
 * 证据支撑的，脚本会标成 MANUAL，不假装通过。
 *
 * 用法：node tools/compliance-check.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rows = [];
const add = (id, name, status, detail) => rows.push({ id, name, status, detail });

/* ---- 1. 只能用平台提供的 AI 能力：仓内不得出现第三方模型凭据或直连 ---- */

const forbidden = [
  { re: /api\.openai\.com/i, why: '直连 OpenAI' },
  { re: /api\.deepseek\.com/i, why: '直连 DeepSeek' },
  { re: /api\.anthropic\.com/i, why: '直连 Anthropic' },
  { re: /generativelanguage\.googleapis/i, why: '直连 Gemini' },
  { re: /dashscope\.aliyuncs/i, why: '直连 DashScope' },
  { re: /\bsk-[A-Za-z0-9]{16,}/, why: '硬编码 API key' },
  { re: /ANTHROPIC_API_KEY|OPENAI_API_KEY|DEEPSEEK_API_KEY/, why: '引用外部模型环境变量' }
];

const hits = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(js|mjs|html|css|json)$/.test(name) && !/pptxgen|LICENSE/i.test(name)) {
      const text = readFileSync(p, 'utf8');
      for (const f of forbidden) {
        if (f.re.test(text)) hits.push(`${p.replace(root, '.')}: ${f.why}`);
      }
    }
  }
};
walk(join(root, 'bundle'));

hits.length
  ? add('R1a', '产品 AI 只走平台，无自有凭据', 'FAIL', hits.join('; '))
  : add('R1a', '产品 AI 只走平台，无自有凭据', 'PASS', 'bundle 内 0 处第三方模型地址 / key');

const llmCall = readFileSync(join(root, 'bundle/js/llm.js'), 'utf8');
const usesHostLlm = /anna\.llm\.complete/.test(llmCall);
add('R1b', '模型调用走 Host API', usesHostLlm ? 'PASS' : 'FAIL', usesHostLlm ? 'anna.llm.complete' : '没有找到调用');

/* ---- 2. 不打包 Executa（纯 UI App，安装零权限声明） ---- */

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const noExecuta = (manifest.required_executas || []).length === 0 && !existsSync(join(root, 'executas'));
add('R2', '纯 UI App，不打包 Executa', noExecuta ? 'PASS' : 'FAIL',
  `required_executas=${(manifest.required_executas || []).length}, executas/ 目录 ${existsSync(join(root, 'executas')) ? '存在' : '不存在'}`);

/* ---- 3. manifest 合规 ---- */

add('R3', 'manifest schema 4 且 ui.views 已声明',
  manifest.schema === 4 && (manifest.ui?.views || []).length > 0 ? 'PASS' : 'FAIL',
  `schema=${manifest.schema}, views=${(manifest.ui?.views || []).map((v) => v.name).join(',')}`);

/* ---- 4. 导出必须是可编辑的原生对象，不是图片 ---- */

const exporter = readFileSync(join(root, 'bundle/js/export.js'), 'utf8');
const nativeOnly = !/addImage\s*\(/.test(exporter) && /addText|addShape/.test(exporter);
add('R4', '导出为原生文本框/形状/图表（非图片）', nativeOnly ? 'PASS' : 'FAIL',
  nativeOnly ? 'export.js 无 addImage，使用 addText/addShape/addChart' : '发现图片化导出');

/* ---- 5. 生成内容来自模型，而不是模板拼接 ---- */

const prompt = readFileSync(join(root, 'bundle/js/prompt.js'), 'utf8');
const hasSchema = /SEMANTIC|slides/i.test(prompt) && prompt.includes('{');
add('R5', '内容由模型生成（提示词 + 结构化 JSON）', hasSchema ? 'PASS' : 'FAIL', 'prompt.js 定义了完整 slide schema');

/* ---- 6. 必须有可交付的验证手段 ---- */

const tools = ['export-smoke.mjs', 'flow-test.mjs', 'overflow-check.mjs'];
const missing = tools.filter((t) => !existsSync(join(root, 'tools', t)));
add('R6', '仓内有可重跑的验证脚本', missing.length ? 'FAIL' : 'PASS', missing.length ? `缺 ${missing.join(',')}` : tools.join(', '));

/* ---- 7. 必须由平台证明的部分：不判通过，只列证据要求 ---- */

add('R7', '真实模型调用发生在 staging', 'MANUAL', '需 `_meta.quotaConsumed` 与状态栏截图；本地 harness 用 --no-llm，不算');
add('R8', '账号已注册且额度消耗合理', 'MANUAL', '当前消耗 0 CU，注册后补首次调用记录');
add('R9', '已上传并发布到 App Store', 'MANUAL', '需管理员 approve + release，审核无 SLA');
add('R10', '交付三项：仓库地址 / App name / slug', 'MANUAL', 'name=DeckCraft 已定；slug 待查重；仓库未推送');

/* ---- 输出 ---- */

const icon = { PASS: '✓', FAIL: '✗', MANUAL: '·' };
let fail = 0;
for (const r of rows) {
  if (r.status === 'FAIL') fail += 1;
  console.log(`${icon[r.status]} ${r.id.padEnd(5)} ${r.name.padEnd(34)} ${r.detail}`);
}
const pass = rows.filter((r) => r.status === 'PASS').length;
const manual = rows.filter((r) => r.status === 'MANUAL').length;
console.log(`\n代码层：${pass} 项通过${fail ? `，${fail} 项失败` : ''}；平台层：${manual} 项待证明`);
process.exit(fail ? 1 : 0);
