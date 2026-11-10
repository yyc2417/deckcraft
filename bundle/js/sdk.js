/**
 * 宿主连接层。
 *
 * Anna App 的 iframe 里，所有能力都经过 postMessage 到宿主。这一步做两件事：
 * 1. 拿到 SDK 实例（SDK 由宿主在 /static/anna-apps/_sdk/ 提供，ESM 动态导入）。
 * 2. 抹平返回形状差异——有的方法返回 {ok,result}，有的直接返回结果，
 *    上层只想拿到值或一个明确的异常。
 *
 * 连不上宿主时不抛，返回 null，界面降级成「独立预览」：可以看示例、可以走
 * 本地模拟生成，但不能调模型、不能上传。这样同一个 bundle 在浏览器里直接
 * 打开也能演示版式。
 */

let cached = null;
let tried = false;

/** 没有宿主时 connect() 会一直等 hello 回包，加超时避免界面永远白屏。 */
const CONNECT_TIMEOUT_MS = 1800;

export async function connect() {
  if (tried) return cached;
  tried = true;
  try {
    const mod = await import('/static/anna-apps/_sdk/latest/index.js');
    cached = await Promise.race([
      mod.AnnaAppRuntime.connect(),
      new Promise((resolve) => setTimeout(() => resolve(null), CONNECT_TIMEOUT_MS))
    ]);
  } catch (err) {
    console.warn('[deckcraft] 未连上宿主，进入独立预览模式', err);
    cached = null;
  }
  return cached;
}

export class HostError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.code = code || 'unknown';
    this.details = details;
  }
}

/** 统一解包：{ok:false} 抛 HostError；{result} 取值；其它原样返回。 */
export function unwrap(res) {
  if (res && typeof res === 'object' && 'ok' in res) {
    if (res.ok === false) {
      const e = res.error || {};
      throw new HostError(e.code, e.message, e.details);
    }
    return res.result;
  }
  return res;
}

/** 把宿主抛出的异常也收敛成 HostError，上层只判断 code。 */
export async function call(fn, ...args) {
  try {
    return unwrap(await fn(...args));
  } catch (err) {
    if (err instanceof HostError) throw err;
    throw new HostError(err && err.code, err && err.message, err && err.details);
  }
}
