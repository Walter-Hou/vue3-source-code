/**
 * 运行：pnpm ex chapters/07-renderer-diff/examples/03-keyed-diff-step-by-step.ts
 * 演示：patchKeyedChildren 的"五步法"在几种典型输入下分别走到哪一步、
 *       产生了哪些宿主操作。每组用例都用 h() 手写一个 <ul><li key=.. /></ul>，
 *       两个数组都是 array children，renderer 会直接进入 patchKeyedChildren
 *       （renderer.ts#L1731-1746：两边都是数组，不能假设任何东西，必须全量 diff）。
 * 看点：
 *   1. 用例 1：头尾同步各命中一部分之后，中间一段在新数组里完全找不到同 key
 *      节点，照样会落入 step 5（unknown sequence），只是结果退化成"全部
 *      unmount 旧的 + mount 新的"——没有 key 复用就没有真正的"移动"。
 *   2. 用例 2：common sequence + mount，只有 insert，没有 move/unmount。
 *   3. 用例 3：common sequence + unmount，只有 remove，没有 move。
 *   4. 用例 4：[a,b,c,d,e] -> [a,c,d,b,e,f]，经典乱序用例——头尾都无法同步，
 *      落入 step 5；最长递增子序列是 [a,c,d,e]（对应新下标里的稳定段），
 *      所以只有 b 被 move，f 被 mount。对照 mini-vue/runtime-core/diff.ts
 *      的同一用例（04-lis-trace.ts 会把 LIS 的计算过程打印出来）。
 *   5. 用例 5：完全反转，LIS 长度退化为 1，n-1 个节点都要移动——这是
 *      patchKeyedChildren 的最坏情况，也是"键控 diff 不是银弹"的证据。
 *   6. 宿主层面没有单独的"move"操作：renderer 的 move() 对普通元素就是
 *      再调一次 hostInsert（把已存在的节点插到新位置），所以下面的 ops
 *      日志里"移动"也显示成 insert。
 */
import { h } from '@vue/runtime-core'
import { createRoot, printOps, render, serialize } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

function list(keys: string[]) {
  return h(
    'ul',
    keys.map(k => h('li', { key: k }, k)),
  )
}

function run(title: string, before: string[], after: string[]) {
  const root = createRoot()
  render(list(before), root)
  printOps(`mount [${before.join(',')}]`) // 挂载产生的操作不是本例重点，打印后清空
  step(title)
  log(`[${before.join(',')}] -> [${after.join(',')}]`)
  render(list(after), root)
  log('html =', serialize(root))
  printOps('patch')
}

section('五步法逐步验证')

run('1. 头尾同步缩小范围后落入 step 5：头部 a 命中 1 次，尾部 e/d 命中 2 次，' +
    '剩下 b,c -> x,y 在新数组里找不到同 key 节点，整体 unmount+mount',
  ['a', 'b', 'c', 'd', 'e'],
  ['a', 'x', 'y', 'd', 'e'],
)

run('2. 纯头部同步 + 尾部新增（common sequence + mount，走 step 3）',
  ['a', 'b'],
  ['a', 'b', 'c', 'd'],
)

run('3. 纯尾部同步 + 头部删除（common sequence + unmount，走 step 4）',
  ['a', 'b', 'c', 'd'],
  ['c', 'd'],
)

run('4. 经典乱序：头尾都无法同步，落入 step 5，只移动 1 个节点',
  ['a', 'b', 'c', 'd', 'e'],
  ['a', 'c', 'd', 'b', 'e', 'f'],
)

run('5. 完全反转：LIS 长度退化为 1，n-1 个节点都要 move（最坏情况）',
  ['a', 'b', 'c', 'd', 'e'],
  ['e', 'd', 'c', 'b', 'a'],
)
