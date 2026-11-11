/**
 * 离线示例数据。
 *
 * 两个用途：
 * 1. 没有连上模型时（本地 harness、额度耗尽、审核环境）点「看示例」仍能完整体验。
 * 2. 作为版式回归的固定输入——改 layout 后先看这份 deck 有没有错位。
 *
 * 里面的数字是示例，不来自任何真实业务；界面会标注「示例」。
 */

export const SAMPLE_BRIEF = `上周组会讲周报，被导师打断三次，问我"所以你到底想说什么"。
后来复盘：我把 12 件事按时间顺序讲了一遍，每页都是"我做了 A，然后做了 B"。
同门做同样的事，10 分钟讲完，导师只问了一个问题，还是关于下一步的。
差别不在做了多少，在于有没有先给结论。`;

export function mockDeck(theme = 'slate') {
  return {
    title: '把周报讲成 10 分钟',
    theme,
    scene: 'report',
    demo: true,
    slides: [
      {
        type: 'cover',
        kicker: '组会汇报 · 复盘',
        title: '把周报讲成 10 分钟',
        subtitle: '同一件事，换个讲法，追问从三次变成一次',
        meta: '示例数据 · DeckCraft'
      },
      {
        type: 'agenda',
        kicker: '目录',
        title: '三件事：哪里丢分、怎么改、改完什么效果',
        items: [
          { label: '丢分不在内容不够', hint: '同一份材料，被追问三次' },
          { label: '改结构不改内容', hint: '结论往前放，过程压到附页' },
          { label: '效果与下一步', hint: '10 分钟讲完，追问只剩一次' }
        ]
      },
      {
        type: 'points',
        kicker: '',
        title: '失分的地方不是做得少，是没先给结论',
        points: [
          { lead: '按时间顺序讲，听众要自己拼结论', detail: '12 件事平铺，每件都重要等于没有重点，导师只能中途打断来问「所以呢」。' },
          { lead: '过程细节占了 70% 的时间', detail: '调试过程讲了两分钟，但结论只有一句，听众记住的是过程而不是判断。' },
          { lead: '没有交代下一步', detail: '讲完就停，没有说清本周要做什么、需要谁配合，讨论无法收敛。' }
        ]
      },
      {
        type: 'stat',
        kicker: '',
        title: '改动只发生在结构上，内容一条没加',
        stats: [
          { value: '3 次', label: '被打断次数', note: '改造前，平均每 3 分钟一次' },
          { value: '1 次', label: '被打断次数', note: '改造后，且只问了下一步' },
          { value: '10 分钟', label: '讲完用时', note: '内容量与上一版相同' }
        ]
      },
      {
        type: 'compare',
        title: '流水账和结论先行的差别，只在第一句话',
        left: { label: '流水账版', items: ['这周我先做了数据清洗', '然后调了检索的召回', '中间遇到一个 bug，花了两天', '最后跑了一轮评测'] },
        right: { label: '结论先行版', items: ['召回率从 71% 到 92%', '主要靠换切块策略，不是换模型', '踩过一个坑：分块边界切断了表格', '下一步验证长文档场景'] }
      },
      {
        type: 'timeline',
        kicker: '',
        title: '四步改造，每步只动一层',
        steps: [
          { label: '定结论', text: '先用一句话写下这次汇报要对方记住什么，写不出就说明还没想清楚。' },
          { label: '排证据', text: '每页只留支撑这句话的证据，其余全部移到备份页。' },
          { label: '删过程', text: '调试过程只保留「踩了什么坑、怎么绕过去」，不保留时间线。' },
          { label: '收下一步', text: '最后一页写清楚要谁在什么时候做什么。' }
        ]
      },
      {
        type: 'table',
        kicker: '',
        title: '三种改法的成本不一样，先做最便宜的那个',
        columns: ['改法', '要花多久', '效果', '风险'],
        rows: [
          ['只改标题', '20 分钟', '追问减少一半', '低'],
          ['重排页面顺序', '1 小时', '听众能跟上', '低'],
          ['重做全部版式', '半天', '更好看，但内容没变', '中']
        ],
        note: '样本量 1 次汇报，效果为主观判断'
      },
      {
        type: 'split',
        kicker: '',
        title: '真正起作用的是把结论提前到第一句',
        value: '3 → 1',
        label: '被追问次数',
        note: '同一份材料，两次汇报对比',
        side: 'right',
        points: [
          { lead: '结论占第一页', detail: '听众知道要往哪听，后面每页都能挂在这句话上。' },
          { lead: '过程只留结论', detail: '调试细节压到备查页，问到再翻。' }
        ]
      },
      {
        type: 'chart',
        kicker: '',
        title: '每页信息越密，被追问的概率越高',
        kind: 'bar',
        categories: ['1 个结论', '2-3 个要点', '4-5 个要点', '6 个以上'],
        series: [{ name: '被追问次数', values: [1, 1.4, 2.6, 4.1] }],
        insight: '把每页压到 3 个要点以内，追问次数下降最明显。示例数据，仅示意。'
      },
      {
        type: 'quote',
        quote: '听众不关心你做了多少事，只关心这些事改变了什么。',
        attribution: '导师在复盘时的原话'
      },
      {
        type: 'points',
        kicker: '',
        title: '下周只做三件事',
        points: [
          { lead: '把长文档场景的召回补上', detail: '目标：200 页以上的 PDF，R@5 不低于 85%，周三前出第一版数字。' },
          { lead: '把评测脚本接进 CI', detail: '每次改动自动跑 20 题小集，避免手工回归漏掉。' },
          { lead: '重写汇报模板', detail: '固定为「结论 / 证据 / 下一步」三段，减少临时组织语言的时间。' }
        ]
      },
      {
        type: 'end',
        title: '需要导师确认：长文档场景要不要单独做切块',
        subtitle: '如果要，本周会把切块策略拆成独立模块；如果不要，先按通用方案跑一轮数据。'
      }
    ]
  };
}

/** 模拟一次带进度的生成，用于没有模型时的演示。 */
// 示例稿的备注：内容刻意写成"怎么讲"而不是"页面上写了什么"，
// 让用户第一次点开就知道备注栏该填什么。
const SAMPLE_NOTES = {
  cover: '先别急着讲内容，说清楚这次汇报只要一个决定：字段清单砍不砍。',
  agenda: '这一页只花 20 秒，让他们知道后面还有多久。',
  points: '停一下，问他们上一次被追问是在哪一页。',
  table: '强调"只改标题"这一行——20 分钟就能做，先从这个开始。',
  split: '把 3 降到 1 这个数字念出来，然后闭嘴两秒。',
  chart: '不要说"如图所示"，直接说结论：信息越密，追问越多。',
  end: '落到具体动作和日期，不要用"谢谢聆听"收尾。'
};

export async function mockGenerate({ theme = 'slate', onProgress } = {}) {
  const deck = mockDeck(theme);
  deck.slides.forEach((sl) => {
    if (!sl.notes && SAMPLE_NOTES[sl.type]) sl.notes = SAMPLE_NOTES[sl.type];
  });
  const total = deck.slides.length;
  for (let i = 1; i <= total; i += 1) {
    if (onProgress) onProgress(i, total);
    await sleep(90 + Math.random() * 120);
  }
  return deck;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
