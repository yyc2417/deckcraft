/**
 * 模型调用与 JSON 解析。
 *
 * 走宿主的 anna.llm.complete —— 平台代付、代选模型、计入用户额度，
 * App 自己不留任何 API key。
 *
 * 解析这一层是必需的：即便提示词里写了「只输出 JSON」，模型仍有概率包一层
 * markdown 代码块、在末尾加一句"以上"、或者写出尾逗号。这里做三件事：
 * 剥围栏 → 按括号配对截取 → 修尾逗号，仍然失败才报错。
 */

import { call, HostError } from './sdk.js';

const DEFAULT_MAX_TOKENS = 7600; // 同步通道上限 8192，留 600 给信封与拒答

export function hasLlm(anna) {
  return Boolean(anna && anna.llm && typeof anna.llm.complete === 'function');
}

/**
 * 一次完整调用，返回 { json, text, quota }。
 * maxTokens 上限：同步通道 8192。给 6000 留出余量，避免被截断后 JSON 半截。
 */
export async function completeJSON(anna, messages, { maxTokens = DEFAULT_MAX_TOKENS } = {}) {
  // ?simulate=<code> 用来验证失败分支（额度耗尽、限流）。
  // 这些错误只能由平台回传，正常开发时不可能复现；没有这个开关，
  // 降级路径就永远是"写了但没验过"的代码。
  const sim =
    new URLSearchParams(location.search).get('simulate') ||
    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('deckcraft:simulate'));
  if (sim) {
    const err = new HostError(sim, sim === 'quota_exceeded' ? '额度不足，无法继续生成' : '模拟的模型错误');
    throw err;
  }

  if (!hasLlm(anna)) {
    throw new HostError('no_llm', '当前没有可用的模型（本地预览模式）');
  }

  const payload = {
    messages: messages.map((m) => ({
      role: m.role,
      content: { type: 'text', text: m.content }
    })),
    maxTokens
  };

  let reply;
  try {
    reply = await anna.llm.complete(payload);
  } catch (err) {
    throw normalizeLlmError(err);
  }
  reply = reply && reply.ok !== undefined ? reply : { ok: true, result: reply };
  if (reply.ok === false) throw normalizeLlmError(reply.error || {});

  const result = reply.result || reply;
  const text = extractText(result);
  if (!text) throw new HostError('empty_response', '模型返回了空内容');

  // 留着原始响应：解析失败时这是唯一的诊断材料（界面看不到 console）
  try {
    window.__lastRaw = text;
  } catch (_) {
    /* 非浏览器环境忽略 */
  }

  let json;
  try {
    json = extractJson(text);
  } catch (err) {
    err.raw = text.slice(0, 2000);
    err.rawLength = text.length;
    err.stopReason = result.stopReason;
    throw err;
  }
  return {
    json,
    text,
    quota: (result._meta && result._meta.quotaConsumed) || null,
    model: result.model || null,
    stopReason: result.stopReason || null
  };
}

function extractText(result) {
  const content = result && result.content;
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (content.type === 'text') return content.text || '';
  if (Array.isArray(content)) {
    return content.map((c) => (c && (c.text || '')) || '').join('');
  }
  return String(content.text || '');
}

function normalizeLlmError(err) {
  const code = (err && err.code) || (err && err.error && err.error.code) || 'llm_error';
  const map = {
    not_implemented: '这个环境没有接入模型（本地预览）。到 Anna 里打开本应用即可。',
    llm_disabled: '本地预览模式没有开启模型。',
    quota_exceeded: '额度不足，先去平台的用量页面看一下剩余额度。',
    invalid_arg: '请求被平台拒绝，可能是内容过长。',
    rate_limited: '调用太频繁，等几秒再试。'
  };
  return new HostError(code, map[code] || (err && err.message) || '模型调用失败');
}

/* ---------------- JSON 提取 ---------------- */

export function extractJson(raw) {
  let t = String(raw || '').trim();

  // 1. 剥掉 markdown 围栏（```json ... ```）
  const fence = t.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();

  // 2. 找到第一个 { 或 [，按括号配对截取，跳过字符串内的括号
  const candidates = ['{', '[']
    .map((ch) => ({ ch, i: t.indexOf(ch) }))
    .filter((c) => c.i >= 0)
    .sort((a, b) => a.i - b.i);
  if (!candidates.length) throw new HostError('bad_json', '模型没有返回 JSON');

  const start = candidates[0].i;
  const open = t[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;

  for (let i = start; i < t.length; i += 1) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  let body = end > 0 ? t.slice(start, end + 1) : t.slice(start);

  // 3. 修常见的模型手误：尾逗号、中文引号
  body = body
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u201c\u201d]/g, '"');

  try {
    return JSON.parse(body);
  } catch (e) {
    throw new HostError('bad_json', '模型返回的 JSON 解析失败：' + e.message);
  }
}

/** 供调用方统一处理：把错误转成一句人话。 */
export function friendlyError(err) {
  if (!err) return '未知错误';
  if (err.code === 'no_llm') return '当前是本地预览，没有接入模型';
  if (err.code === 'bad_json') return '模型输出格式不对，重试一次通常就好';
  return err.message || '出错';
}
