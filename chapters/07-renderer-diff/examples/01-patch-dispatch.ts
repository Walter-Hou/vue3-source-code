/**
 * 运行：pnpm ex chapters/07-renderer-diff/examples/01-patch-dispatch.ts
 * 演示：patch(n1, n2, ...) 按 n2.type 分派到 Text/Comment/Element/Fragment 四种处理函数；
 *       同一个位置的 vnode 类型发生变化时，先 unmount 旧的再重新 mount 新的。
 * 看点：
 *   1. Text -> Comment -> Element -> Fragment 互相切换时，宿主操作里既有旧节点的
 *      remove，也有新节点的 create+insert —— 这就是 isSameVNodeType 判定为 false
 *      的直接后果（renderer.ts#L399-404）。
 *   2. 相同 tag 但 key 不同的 Element，也会被当成"不同类型"处理（unmount+mount），
 *      而不是走 patchElement 更新属性。
 */
import { Comment, Fragment, Text, h } from '@vue/runtime-core'
import { createRoot, printOps, render, serialize } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

const root = createRoot()

section('1. Text -> Comment -> Element -> Fragment：type 不同，全部重建')

step('首次挂载一个 Text 节点')
render(h(Text, 'hello'), root)
log('html =', serialize(root))
printOps('mount Text')

step('换成 Comment（type 从 Text 变成 Comment）')
render(h(Comment, 'a comment'), root)
log('html =', serialize(root))
printOps('Text -> Comment')

step('换成 Element（type 从 Comment 变成 "div"）')
render(h('div', { class: 'box' }, 'I am a div'), root)
log('html =', serialize(root))
printOps('Comment -> Element')

step('换成 Fragment（type 从 "div" 变成 Fragment）')
render(h(Fragment, [h('span', 'a'), h('span', 'b')]), root)
log('html =', serialize(root))
printOps('Element -> Fragment')

section('2. isSameVNodeType：type 相同但 key 不同，照样重建')

step('挂载 <li key="a">A</li>')
render(h('ul', [h('li', { key: 'a' }, 'A')]), root)
printOps('mount li[key=a]')

step('同样是 <li>，但 key 换成 "b" —— 对比 renderer.ts 里 isSameVNodeType 的判断')
render(h('ul', [h('li', { key: 'b' }, 'B')]), root)
log('html =', serialize(root))
printOps('li[key=a] -> li[key=b]（key 不同，整节点重建）')

step('再来一次：同样是 <li>，key 也是 "b"，只是文本变了 —— 这次会走 patchElement 更新')
render(h('ul', [h('li', { key: 'b' }, 'B2')]), root)
log('html =', serialize(root))
printOps('li[key=b] 内容更新（type+key 相同，复用节点）')
