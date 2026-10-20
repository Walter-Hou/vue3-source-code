/**
 * 运行：pnpm ex chapters/07-renderer-diff/examples/06-block-tree-patchBlockChildren.ts
 * 演示：同一棵"一个静态 <p> + 一个动态 <span>"的树，分别用
 *       "手写 openBlock()+createElementBlock()"（编译器产物的真实写法）
 *       和"普通 h()"（不开 Block）渲染，更新时对比静态 <p> 是否被重新 patch。
 * 看点：
 *   1. Block 版本：root div 的 dynamicChildren 里只有 span（因为 createElementVNode
 *      只有 patchFlag > 0 或是组件时才会被父 Block 收集，vnode.ts#L522-538）。
 *      更新时 patchElement 发现 dynamicChildren 非空，直接走 patchBlockChildren
 *      （renderer.ts#L899-912），一一对应 patch 这个数组——<p> 根本不在数组里，
 *      物理上不可能被访问到。
 *   2. 非 Block 版本：两棵树结构一样，但用 h() 构建，dynamicChildren 始终是
 *      null，patchElement 走 patchChildren 全量 diff（renderer.ts#L913-926），
 *      <p> 和 <span> 都会被递归 patch 一遍。
 *   3. 为了让"被不被 patch"能在宿主操作日志里被肉眼看到，给 <p> 一个每次
 *      渲染都重新创建、但内容相同的内联 style 对象：patchProps 的全量 diff
 *      是按引用比较 `next !== prev`（renderer.ts#L1067），对象字面量每次都是
 *      新引用，所以非 Block 版本里 <p> 会产生一次"内容没变却依然调用"的
 *      patchProp；Block 版本里 <p> 完全不会出现在 ops 里。
 */
import { createElementBlock, createElementVNode, h, openBlock } from '@vue/runtime-core'
import { PatchFlags } from '@vue/shared'
import { createRoot, printOps, render } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

function renderBlock(count: number) {
  // 对应编译器生成的: (openBlock(), createElementBlock('div', null, [...]))
  openBlock()
  return createElementBlock('div', null, [
    // 静态节点：没有 patchFlag，不会被 currentBlock 收集
    createElementVNode('p', { style: { color: 'gray' } }, 'static text'),
    // 动态节点：patchFlag=TEXT，会被收集进父 Block 的 dynamicChildren
    createElementVNode('span', null, String(count), PatchFlags.TEXT),
  ])
}

function renderPlain(count: number) {
  // 结构完全一样，但用普通 h()，不产生 dynamicChildren
  return h('div', [
    h('p', { style: { color: 'gray' } }, 'static text'),
    h('span', String(count)),
  ])
}

section('1. Block 版本：静态 <p> 完全不出现在更新操作里')

const rootBlock = createRoot()
render(renderBlock(0), rootBlock)
printOps('mount')

step('count: 0 -> 1，只应该看到 span 相关的 setElementText')
render(renderBlock(1), rootBlock)
printOps('update (block)')

section('2. 非 Block 版本：静态 <p> 也会被重新 patch 一次 style')

const rootPlain = createRoot()
render(renderPlain(0), rootPlain)
printOps('mount')

step('count: 0 -> 1，对比 ops：多出一次 <p> 的 patchProp(style)')
render(renderPlain(1), rootPlain)
printOps('update (plain h, full diff)')

log('结论：两边最终 DOM 结果一样，但 Block 版本完全没有碰 <p>；')
log('      非 Block 版本因为要对 <p> 做全量 props 比较，style 对象引用变了，')
log('      所以多了一次看似多余的 patchProp —— 这就是"跳过静态子树"的实际收益。')
