/**
 * 运行：pnpm ex chapters/07-renderer-diff/examples/05-keyed-vs-unkeyed.ts
 * 演示：同样是"在列表头部插入一项"，稳定 key（如数据的 id）和"用数组下标
 *       当 key"两种写法，patchKeyedChildren 产生的宿主操作数量完全不同。
 * 看点：
 *   1. 稳定 key：patchKeyedChildren 的 step 3（common sequence + mount）
 *      直接命中——原有节点一个都不用碰，只 mount 新插入的那一个。
 *   2. index 当 key：插入新项后，所有旧节点的"index"全部向后挪了一位，
 *      等价于每个位置的 key 全变了。isSameVNodeType 在 step 1（sync from
 *      start）第一次比较就失败（index 0 的 key 变了），于是整条 patchChildren
 *      退化成"旧的每个位置都要重新比对内容"——文本节点能原地更新内容，但
 *      组件/有副作用的节点会被整体销毁重建（这里用 li 的内容更新次数体现）。
 *   3. 结论：index 当 key 在"头部/中间插入或删除"场景下，等价于没有 key——
 *      源码 isSameVNodeType 的判断依据是 `n1.key === n2.key`
 *      (vnode.ts#L391)，下标变了，key 就变了。
 */
import { h } from '@vue/runtime-core'
import { createRoot, printOps, render, serialize } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

interface Item {
  id: number
  text: string
}

const base: Item[] = [
  { id: 1, text: 'A' },
  { id: 2, text: 'B' },
  { id: 3, text: 'C' },
]
const inserted: Item[] = [{ id: 0, text: 'NEW' }, ...base]

section('1. 稳定 key（item.id）：头部插入')

const rootStable = createRoot()
render(
  h('ul', base.map(it => h('li', { key: it.id }, it.text))),
  rootStable,
)
printOps('mount')

step('在数组头部插入一项，key 用 item.id（真正的数据身份，不随位置变化）')
render(
  h('ul', inserted.map(it => h('li', { key: it.id }, it.text))),
  rootStable,
)
log('html =', serialize(rootStable))
printOps('insert at head (stable key)')

section('2. 用数组下标当 key：头部插入')

const rootIndex = createRoot()
render(
  h('ul', base.map((it, i) => h('li', { key: i }, it.text))),
  rootIndex,
)
printOps('mount')

step('同样在头部插入一项，但 key 用的是"插入后的新下标"（典型的 index-as-key 误用）')
render(
  h('ul', inserted.map((it, i) => h('li', { key: i }, it.text))),
  rootIndex,
)
log('html =', serialize(rootIndex))
printOps('insert at head (index as key)')

log('对比两组 ops 数量：稳定 key 只需 1 次 mount；index 当 key 时，')
log('原来 3 个 <li> 的 key(0,1,2) 分别变成了新数组里 A/B/C 的 key(1,2,3)，')
log('没有一个位置的 key 对得上旧节点原来的 key，退化为"按位置更新内容 + 尾部挂载一个"。')
