/**
 * 运行：pnpm ex chapters/12-compiler-optimization/examples/02-block-tree-visualize.ts
 * 演示：compile -> new Function 得到 render，真的调用一次拿到 vnode 树，递归打印每个
 *       block 的 dynamicChildren，看"块"是怎么嵌套的。
 * 看点：
 *  1. 根元素会被转成 block（openBlock + createElementBlock），它的 dynamicChildren
 *     收集的是"遍历过程中遇到的、patchFlag > 0 或有 ref/指令的后代 vnode"——
 *     不是直接子节点，而是"挖穿了所有非 block 中间层"之后找到的动态节点。
 *  2. v-if/v-for 自己也会开一个新 block（isBlock=true），所以它们会被父 block 的
 *     dynamicChildren 收进去（因为它们本身也是"动态"的——条件/列表会变），但它们
 *     内部的动态子节点不会被父 block 收集，而是进自己的 dynamicChildren——
 *     这就是"嵌套 block 作为更新边界"的含义。
 *  3. v-for 的 Fragment block 用 openBlock(true) 关闭 tracking
 *     （disableTracking=true -> patchFlag 带 UNKEYED/KEYED_FRAGMENT 时很常见），
 *     所以它自己不会被外层 block 当成"可以精确定位的单个动态节点"收集，
 *     而是整体会被 dynamicChildren 收进去但运行时按"列表"而不是"单节点"处理。
 */
import { compile } from '@vue/compiler-dom'
import * as Vue from '@vue/runtime-core'
import { section, step, log } from '../../../shared/print'
import { printBlockTree } from './_shared'

function compileToRenderFn(template: string) {
  return new Function('Vue', compile(template).code)(Vue)
}

section('1. 普通元素树：没有 v-if/v-for，只有动态文本/属性')
{
  const render = compileToRenderFn(
    `<div id="app"><p>{{ a }}</p><span :class="c">static</span><p>static too</p></div>`,
  )
  const vnode = render({ a: 1, c: 'x' }, [])
  printBlockTree(vnode)
  step('根 div 的 dynamicChildren 应该正好是 2 个：<p>{{a}}</p> 和 <span :class>')
  log('dynamicChildren.length =', vnode.dynamicChildren.length)
}

section('2. 带 v-if 的树：v-if 自己是一个 block，会被父 block 收进 dynamicChildren')
{
  const render = compileToRenderFn(
    `<div><p v-if="ok">YES</p><p v-else>NO</p><span>{{ n }}</span></div>`,
  )
  const vnode = render({ ok: true, n: 1 }, [])
  printBlockTree(vnode)
  step('根 div 的 dynamicChildren：v-if 产生的那个 <p> 本身 + <span>{{n}}</span>，一共 2 个')
  log('dynamicChildren.length =', vnode.dynamicChildren.length)
  log(
    '注意第一个 dynamicChild 的 patchFlag 是 (none)——它是 <p>YES</p> 这个静态文本块本身，' +
      '被收集进来不是因为它自己有 patchFlag，而是因为 v-if 分支永远可能整体换成别的 vnode。',
  )
}

section('3. 带 v-for 的树：Fragment block 用 openBlock(true) 关闭自身 tracking')
{
  const render = compileToRenderFn(`<ul><li v-for="n in list" :key="n">{{ n }}</li></ul>`)
  const vnode = render({ list: [1, 2, 3] }, [])
  printBlockTree(vnode)
  step('ul 的 dynamicChildren 里只有 1 项：整个 v-for 产生的 Fragment（不会展开成 3 个 li）')
  log('ul.dynamicChildren.length =', vnode.dynamicChildren.length)
  const fragment = vnode.dynamicChildren[0]
  log('fragment.dynamicChildren =', fragment.dynamicChildren)
  log(
    'openBlock(true) 关闭的是"tracking"而不是"block 本身"：disableTracking 期间',
    'currentBlock 被设成 null，renderList 回调里创建的每个 <li> block 都不会被这个',
    'Fragment 收集，所以 fragment.dynamicChildren 是空数组——列表更新靠 patchKeyedChildren',
    '的全量 diff（配合 key 做最长递增子序列），而不是 dynamicChildren 快路径',
    '（运行时这部分在第 7 章 renderer.ts 的 patchKeyedChildren 里）。',
  )
}
