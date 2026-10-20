/**
 * 运行：pnpm ex chapters/05-vnode-createapp/examples/03-block-tree-structure.ts
 * 演示：手写 openBlock() + createElementBlock() 模拟编译器产物，观察 dynamicChildren
 *       收集了哪些节点、嵌套 block（v-if/v-for 分支）之间的关系。
 * 看点：
 *   1. 普通 createVNode 不会把自己塞进 currentBlock；只有"带 patchFlag 的节点"
 *      或"组件/Teleport/Suspense"会被父 block 收集——这正是源码 createBaseVNode
 *      末尾那段 if 判断的内容（本章 README 有引用）。
 *   2. openBlock()/closeBlock() 维护的是一个栈（blockStack），每次 openBlock 入栈一个
 *      新的 dynamicChildren 数组，closeBlock 出栈并把 currentBlock 恢复成上一层。
 *   3. v-if / v-for 的分支为什么要"开新 block"：因为它们的子树结构在运行时可能整体
 *      替换/增减，不能指望"同一个位置永远是同一个节点"，所以要单独起一个 block
 *      来追踪这个不稳定区域内部的动态节点，外层 block 只需要知道"这一整块可能变"。
 */
import { PatchFlags } from '@vue/shared'
import {
  type VNode,
  createElementBlock,
  createElementVNode,
  createVNode,
  openBlock,
} from '@vue/runtime-core'
import { log, section, step } from '../../../shared/print'

function dump(vnode: VNode, label: string): void {
  // dynamicChildren 是 @internal 字段，公开的 VNode 类型声明里没有它（被 api-extractor
  // 裁掉），但运行时确实存在——这里用 any 绕过类型声明去访问。
  const dyn = (vnode as any).dynamicChildren as VNode[] | null
  log(
    // vnode.type 可能是 Symbol（Text/Comment/Fragment），不能直接拼进模板字符串，要 String() 一下
    `${label}: type=${String(vnode.type)} patchFlag=${vnode.patchFlag} dynamicChildren=`,
    dyn ? dyn.map((c: VNode) => `${String(c.type)}(patchFlag=${c.patchFlag})`) : dyn,
  )
}

section('1. 对照组：不开 block，普通 createVNode 嵌套')
step('createVNode("div", null, [createVNode("span", null, msg, TEXT)])')
{
  // 没有 openBlock，currentBlock 恒为 null，所以内层的动态节点根本没地方可收集，
  // 之后 diff 时只能回退到"遍历所有 children 逐个比较"的全量 diff。
  const inner = createVNode('span', null, 'hi', PatchFlags.TEXT)
  const outer = createVNode('div', null, [inner])
  dump(outer, 'outer')
  log('（没有 openBlock，outer.dynamicChildren 恒为 null，inner 这种动态节点没被收集）')
}

section('2. 模拟编译产物：<div>{{ msg }}<span class="x"></span></div>')
step('openBlock() -> createElementVNode(动态子节点) -> createElementBlock(根)')
{
  // 真实编译产物形如：
  //   (openBlock(), createElementBlock('div', null, [
  //     createElementVNode('p', null, toDisplayString(msg), 1 /* TEXT */),
  //     staticSpan, // 没有 patchFlag 的静态节点，不会被收集
  //   ]))
  openBlock()
  const dynamicP = createElementVNode('p', null, 'msg 的值', PatchFlags.TEXT)
  const staticSpan = createElementVNode('span', { class: 'x' })
  const root = createElementBlock('div', null, [dynamicP, staticSpan])
  dump(root, 'root')
  log('只有 dynamicP 被收集进 root.dynamicChildren，staticSpan（patchFlag=0）被跳过')
}

section('3. 嵌套 block：v-if 分支需要单独开一个 block')
step('外层 block 收集"组件/带 patchFlag 节点"，v-if 分支自己是一个独立的 block')
{
  // 模拟模板：
  //   <div>
  //     <p>{{ a }}</p>
  //     <div v-if="show">{{ b }}</div>
  //   </div>
  // 编译器会给 v-if 分支整体包一个 (openBlock(), createElementBlock(...))，
  // 这个 block 本身作为一个节点，又会被外层 block 收集（因为它有 patchFlag，
  // 或者至少会被当成需要 patch 的节点）。
  openBlock()
  const pA = createElementVNode('p', null, 'a 的值', PatchFlags.TEXT)

  // v-if 分支：自己开一个新 block
  openBlock()
  const pB = createElementVNode('div', null, 'b 的值', PatchFlags.TEXT)
  const ifBranch = createElementBlock('div', null, [pB], PatchFlags.TEXT)

  const root = createElementBlock('div', null, [pA, ifBranch])

  dump(root, 'root（外层 block）')
  dump(ifBranch, 'ifBranch（v-if 分支自己的 block）')
  log(
    '可以看到 root.dynamicChildren 里只有两项：pA 和 ifBranch 本身（整体），',
    '而 ifBranch 内部的 pB 则被收进了 ifBranch.dynamicChildren —— 这就是"嵌套 block"。',
  )
  log(
    '为什么要这样分层：如果 show 从 true 变成 false，ifBranch 整个子树可能被替换成',
    '注释占位节点，外层 block 只需要在"ifBranch 这个位置"做一次 patch 判断，',
    '不需要、也不能假设 pB 一定还存在。',
  )
}

section('4. isBlockTreeEnabled：v-once 会临时关闭 block 收集')
step('源码里 setBlockTracking(-1) 会让 isBlockTreeEnabled <= 0，期间创建的 vnode 不会被收集')
log('本章只做文字说明，isBlockTreeEnabled 是内部变量，不建议在示例里直接改——详见 README「常见疑问」')
