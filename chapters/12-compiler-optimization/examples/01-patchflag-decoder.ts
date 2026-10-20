/**
 * 运行：pnpm ex chapters/12-compiler-optimization/examples/01-patchflag-decoder.ts
 * 演示：编译一组各自只演示"一种 patchFlag"的模板，取出根 VNodeCall（或 v-for 的
 *       Fragment VNodeCall），解码 patchFlag 数字、打印 dynamicProps。
 * 看点：
 *  1. patchFlag 是按位组合的（`shared/src/patchFlags.ts`），同一个 vnode 可以同时
 *     带多个 flag，比如 `:class` + `{{ }}` 会是 `TEXT | CLASS = 3`。
 *  2. CLASS/STYLE 有专属的 bit，不计入 dynamicProps；其它动态属性走 PROPS(8) 并把
 *     属性名记录进 dynamicProps，这样运行时 patchElement 可以只 diff 这几个 key，
 *     不用整个 props 对象做 for-in。
 *  3. FULL_PROPS(16) 和 PROPS 互斥：只要出现动态 key（`:[key]="..."`），运行时就没法
 *     知道"会不会有属性被整个替换掉"，只能退回全量 diff。
 *  4. 负数是"特殊 flag"（CACHED=-1，由 v-once/静态缓存产生），不会和其它位组合。
 */
import { compile } from '@vue/compiler-dom'
import type { RootNode, TemplateChildNode, VNodeCall } from '@vue/compiler-core'
import { NodeTypes } from '@vue/compiler-core'
import { section, step, log } from '../../../shared/print'
import { decodePatchFlag } from './_shared'

/** 从 ROOT/ELEMENT/IF/FOR 一路解开到它的 VNodeCall（mini 场景足够用，不做通用 JS AST 遍历） */
function unwrapToVNodeCall(node: TemplateChildNode | RootNode): VNodeCall {
  const n: any = node.type === NodeTypes.ROOT ? node.codegenNode : (node as any).codegenNode
  if (n.type === NodeTypes.VNODE_CALL) return n
  throw new Error(`unexpected codegenNode type: ${n.type}`)
}

interface Row {
  label: string
  template: string
  tag: string
  patchFlag: string
  dynamicProps: string
}

const rows: Row[] = []
function record(label: string, template: string, pick: (ast: RootNode) => VNodeCall) {
  const ast = compile(template, { hoistStatic: false }).ast
  const vcall = pick(ast)
  const dp = vcall.dynamicProps as any
  rows.push({
    label,
    template,
    tag: typeof vcall.tag === 'string' ? vcall.tag : String(vcall.tag),
    patchFlag: decodePatchFlag(vcall.patchFlag),
    // dynamicProps 要么是一个已经格式化好的字符串（如 `["title","data-id"]`，见
    // transformElement.ts#stringifyDynamicPropNames），要么是动态 key 场景下的表达式节点
    dynamicProps: dp == null ? '-' : typeof dp === 'string' ? dp : dp.content,
  })
}

section('逐个 patchFlag 的最小复现模板')

record('TEXT(1)', `<div>{{ msg }}</div>`, ast => unwrapToVNodeCall(ast.children[0]))
record('CLASS(2)', `<div :class="cls">x</div>`, ast => unwrapToVNodeCall(ast.children[0]))
record('STYLE(4)', `<div :style="st">x</div>`, ast => unwrapToVNodeCall(ast.children[0]))
record('PROPS(8)', `<div :title="t" :data-id="id">x</div>`, ast =>
  unwrapToVNodeCall(ast.children[0]),
)
record('FULL_PROPS(16)', `<div v-bind:[key]="val">x</div>`, ast =>
  unwrapToVNodeCall(ast.children[0]),
)
record(
  'NEED_HYDRATION(32)：注意不是 @click（click 有专属 hydration 快速路径，被源码特判排除）',
  `<div @mouseover="go">x</div>`,
  ast => unwrapToVNodeCall(ast.children[0]),
)
record(
  '对比：@click 不会带 NEED_HYDRATION，但仍然算进 dynamicProps/PROPS',
  `<div @click="go">x</div>`,
  ast => unwrapToVNodeCall(ast.children[0]),
)
record('NEED_PATCH(512)：只有 ref，没有任何 props patchFlag', `<div ref="r">x</div>`, ast =>
  unwrapToVNodeCall(ast.children[0]),
)
record(
  'v-for 遍历字面量数组，但 prefixIdentifiers 没开：constType 判定不生效，退化成 UNKEYED',
  `<li v-for="n in [1,2,3]">{{ n }}</li>`,
  ast => (ast.children[0] as any).codegenNode,
)
record('KEYED_FRAGMENT(128)：v-for 带 :key', `<li v-for="n in list" :key="n.id">{{ n.text }}</li>`, ast => {
  const forNode = ast.children[0] as any
  return forNode.codegenNode
})
record('UNKEYED_FRAGMENT(256)：v-for 不带 key', `<li v-for="n in list">{{ n }}</li>`, ast => {
  const forNode = ast.children[0] as any
  return forNode.codegenNode
})
record('TEXT+CLASS(3) 组合', `<div :class="cls">{{ msg }}</div>`, ast =>
  unwrapToVNodeCall(ast.children[0]),
)

step('结果表')
for (const r of rows) {
  log(
    `${r.label.padEnd(44)} | <${r.template}>`.padEnd(100),
  )
  log(`    tag=${r.tag}  patchFlag=${r.patchFlag}  dynamicProps=${r.dynamicProps}`)
}

section('STABLE_FRAGMENT(64) 的真实触发条件：需要 prefixIdentifiers（mode: module）')
{
  const fnMode = compile(`<li v-for="n in [1,2,3]">{{ n }}</li>`).ast.children[0] as any
  const moduleMode = compile(`<li v-for="n in [1,2,3]">{{ n }}</li>`, {
    mode: 'module',
  }).ast.children[0] as any
  log('mode: function (默认，不做 prefixIdentifiers) ->', decodePatchFlag(fnMode.codegenNode.patchFlag))
  log('mode: module（强制 prefixIdentifiers=true，会调用 processExpression 判定常量）->', decodePatchFlag(moduleMode.codegenNode.patchFlag))
}

section('特殊 flag：CACHED(-1)（v-once）')
{
  const ast = compile(`<div v-once>{{ msg }}</div>`, { hoistStatic: true }).ast
  const div = ast.children[0] as any
  log('div.codegenNode.type =', NodeTypes[div.codegenNode.type])
  log(
    'CACHED 不是出现在 VNodeCall.patchFlag 上，而是整个 codegenNode 被换成了 JS_CACHE_EXPRESSION',
    '（下一个示例会专门看 cacheStatic 的产物）',
  )
}
