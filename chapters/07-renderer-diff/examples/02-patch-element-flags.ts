/**
 * 运行：pnpm ex chapters/07-renderer-diff/examples/02-patch-element-flags.ts
 * 演示：手写编译器才会生成的 createElementVNode(..., patchFlag, dynamicProps)，
 *       对比"有 PatchFlags"与"没有 PatchFlags（手写 h()）"两种情况下，
 *       patchElement 触发 patchProp 的次数差异。
 * 看点：
 *   1. 没有 patchFlag 时，patchElement 走 `patchProps` 全量 diff：
 *      新旧 props 的所有 key 都要被遍历一遍（renderer.ts#L1039-1075）。
 *   2. 有 PatchFlags.CLASS | PatchFlags.STYLE | PatchFlags.PROPS 时，
 *      patchElement 直接按位判断，只处理真正可能变化的那几个 key，
 *      且 PROPS 位只遍历 dynamicProps 数组里列出的 key（renderer.ts#L928-969）。
 *   3. h() 内部会调用 setBlockTracking(-1)，不会写 patchFlag，所以这里用
 *      createElementVNode（编译产物真正调用的函数）手写 vnode。
 */
import { createElementVNode, ref, type Ref } from '@vue/runtime-core'
import { PatchFlags } from '@vue/shared'
import { createRoot, printOps, render } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

const root1 = createRoot()
const root2 = createRoot()

section('1. 没有 patchFlag（相当于手写 render，或 FULL_PROPS）—— 全量 patchProps')

function renderNoFlag(cls: string, color: string, title: string) {
  // 没有 patchFlag：等价于普通 h()，patchElement 会整个 for..in 两份 props
  return createElementVNode('div', { class: cls, style: { color }, title }, 'text')
}

step('挂载')
render(renderNoFlag('a', 'red', 't1'), root1)
printOps('mount')

step('只改 class，其余不变 —— 但因为没有 patchFlag，PROPS/CLASS/STYLE/title 都会被比较一遍')
render(renderNoFlag('b', 'red', 't1'), root1)
printOps('update class only (no patchFlag)')

section('2. 带 PatchFlags.CLASS | STYLE | PROPS —— 按位命中，精确更新')

function renderWithFlags(cls: string, color: string, title: string) {
  // 第 4 个参数是 patchFlag，第 5 个参数 dynamicProps 告诉 renderer
  // "PROPS 位要看的 key 列表只有 title"
  return createElementVNode(
    'div',
    { class: cls, style: { color }, title },
    'text',
    PatchFlags.CLASS | PatchFlags.STYLE | PatchFlags.PROPS,
    ['title'],
  )
}

step('挂载（首次挂载走 mountElement，patchFlag 在挂载阶段不生效）')
render(renderWithFlags('a', 'red', 't1'), root2)
printOps('mount')

step('只改 class —— 只命中 PatchFlags.CLASS 这一个分支')
render(renderWithFlags('b', 'red', 't1'), root2)
printOps('update class only (patchFlag=CLASS|STYLE|PROPS)')

step('只改 title（走 PROPS 分支，但只遍历 dynamicProps=["title"]，不会碰 class/style）')
render(renderWithFlags('b', 'red', 't2'), root2)
printOps('update title only')

step('class 和 style 同时改 —— CLASS 和 STYLE 两个分支都会命中，但 title 不会被碰')
render(renderWithFlags('c', 'blue', 't2'), root2)
printOps('update class + style')

log('结论：同样是"改一个 class"，无 patchFlag 版本和有 patchFlag 版本的 patchProp 调用次数不同，')
log('      具体次数见上面的 ops 列表（README 里会贴真实输出并逐条核对）。')
