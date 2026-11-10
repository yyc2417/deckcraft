/**
 * 主题定义：一套主题 = 一组颜色令牌 + 字体。
 *
 * 令牌只保留 8 个，够用且逼着版式靠留白和层级而不是花活取巧：
 *   bg        幻灯片底色
 *   ink       正文/标题颜色
 *   muted     次要文字
 *   accent    强调色（标题装饰、序号、图表主色）
 *   accent2   图表第二色（对比页右侧、双系列）
 *   panel     卡片/容器底色
 *   rule      分隔线、网格
 *   dark      是否为深色底（影响阴影、图片处理等少量分支）
 *
 * 为什么用十六进制字符串而不是数字：PptxGenJS 接受 'RRGGBB'，DOM 需要 '#RRGGBB'，
 * 统一存 '#RRGGBB'，导出时由 hex() 去掉井号，只有一处转换。
 */

export const THEMES = {
  slate: {
    id: 'slate',
    name: '墨蓝',
    hint: '深色，适合投影和技术汇报',
    bg: '#0F1B2D',
    ink: '#F2F5FA',
    muted: '#9DB0CB',
    accent: '#4FD1C5',
    accent2: '#F6AD55',
    panel: '#16263C',
    rule: '#2A3F5C',
    dark: true,
    font: 'Microsoft YaHei'
  },
  paper: {
    id: 'paper',
    name: '纸白',
    hint: '浅色，适合打印和正式场合',
    bg: '#F7F2E7',
    ink: '#1F1C17',
    muted: '#6E6656',
    accent: '#B8412A',
    accent2: '#2F5D50',
    panel: '#FFFDF6',
    rule: '#D9CFBC',
    dark: false,
    font: 'Microsoft YaHei'
  },
  grid: {
    id: 'grid',
    name: '蓝图',
    hint: '中性，适合方案和数据分析',
    bg: '#FFFFFF',
    ink: '#101828',
    muted: '#5A6B85',
    accent: '#2563EB',
    accent2: '#0E9F6E',
    panel: '#F4F7FC',
    rule: '#D6E0F0',
    dark: false,
    font: 'Microsoft YaHei'
  }
};

export const THEME_IDS = Object.keys(THEMES);

export function getTheme(id) {
  return THEMES[id] || THEMES.slate;
}

/** '#RRGGBB' -> 'RRGGBB'，PptxGenJS 的写法。 */
export function hex(color) {
  return String(color || '#000000').replace('#', '').toUpperCase();
}

/** 用于在浅色/深色底上做 8% 透明度叠加时算出实色（pptx 的透明度支持不稳定）。 */
export function mix(a, b, ratio) {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa.r * (1 - ratio) + pb.r * ratio);
  const g = Math.round(pa.g * (1 - ratio) + pb.g * ratio);
  const bl = Math.round(pa.b * (1 - ratio) + pb.b * ratio);
  return '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(c) {
  const s = hex(c);
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16)
  };
}
