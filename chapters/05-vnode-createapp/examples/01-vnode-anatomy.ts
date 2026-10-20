/**
 * 运行：pnpm ex chapters/05-vnode-createapp/examples/01-vnode-anatomy.ts
 * 演示：h() 产出的 VNode 到底长什么样 —— type/props/key/children/shapeFlag/patchFlag
 *       分别对元素、组件、文本、数组子节点、插槽子节点五种场景抓拍一次。
 * 看点：
 *   1. shapeFlag 是个数字，但 decodeShapeFlag 能把它拆解成人类可读的标记组合
 *      （例如一个带文本的 div 是 `ELEMENT | TEXT_CHILDREN`）。
 *   2. 组件 vnode 的 shapeFlag 里同时包含 STATEFUL_COMPONENT；
 *      它的 children 在没有编译宏的情况下就是插槽对象，shapeFlag 会多一位 SLOTS_CHILDREN。
 *   3. patchFlag 手写 h() 时永远是 0 —— 只有编译器生成的 createVNode 调用才会带正值，
 *      这是第 12 章「Block 优化」的核心前提。
 */
import { Comment, Fragment, Text, h } from '@vue/runtime-core'
import { PatchFlagNames, PatchFlags, ShapeFlags } from '@vue/shared'
import { log, section, step } from '../../../shared/print'

// ShapeFlags 是一组位掩码（1, 1<<1, 1<<2 ...），一个 vnode 的 shapeFlag 可以同时
// "是" 好几个标记的组合（用 |= 累加）。decodeShapeFlag 反过来把数字拆成名字列表，
// 方便肉眼核对；真实源码里判断用的是 `shapeFlag & ShapeFlags.XXX`，不会做这种解码。
function decodeShapeFlag(flag: number): string[] {
  const names: string[] = []
  for (const key of Object.keys(ShapeFlags)) {
    if (!Number.isNaN(Number(key))) continue // enum 的反向数字映射跳过
    const value = (ShapeFlags as any)[key]
    if (typeof value === 'number' && value > 0 && flag & value) {
      names.push(key)
    }
  }
  return names
}

function decodePatchFlag(flag: number): string {
  if (flag === 0) return '(无，手写 h() 的默认值)'
  if (flag < 0) return PatchFlagNames[flag as PatchFlags] // CACHED / BAIL 是负数，不能用位运算判断
  const names: string[] = []
  for (const key of Object.keys(PatchFlagNames)) {
    const value = Number(key)
    if (value > 0 && flag & value) names.push(PatchFlagNames[value as PatchFlags])
  }
  return names.join(' | ')
}

// 子节点太长时只打印摘要（type + children），完整字段用不着重复刷屏
function briefChildren(children: unknown): unknown {
  if (Array.isArray(children)) {
    return children.map(c =>
      c && typeof c === 'object' && '__v_isVNode' in c
        ? { type: (c as any).type, children: (c as any).children }
        : c,
    )
  }
  if (children && typeof children === 'object') {
    return Object.fromEntries(
      Object.entries(children).map(([k, v]) => [k, typeof v === 'function' ? '[slot fn]' : v]),
    )
  }
  return children
}

function inspectVNode(label: string, vnode: ReturnType<typeof h>): void {
  step(label)
  log('type          =', typeof vnode.type === 'symbol' ? vnode.type.toString() : vnode.type)
  log('props         =', vnode.props)
  log('key           =', vnode.key)
  log('children      =', briefChildren(vnode.children))
  log('shapeFlag     =', vnode.shapeFlag, '->', decodeShapeFlag(vnode.shapeFlag).join(' | '))
  log('patchFlag     =', vnode.patchFlag, '->', decodePatchFlag(vnode.patchFlag))
  log('el / anchor   =', vnode.el, '/', vnode.anchor, '(未挂载，都是 null)')
}

section('1. 元素 vnode：带文本子节点')
inspectVNode('h("div", { id: "app" }, "hello")', h('div', { id: 'app' }, 'hello'))

section('2. 元素 vnode：数组子节点')
inspectVNode(
  'h("ul", null, [h("li", "a"), h("li", "b")])',
  h('ul', null, [h('li', 'a'), h('li', 'b')]),
)

section('3. 组件 vnode：默认插槽（函数形式）')
const MyComp = { name: 'MyComp', render: () => h('span', 'comp') }
inspectVNode('h(MyComp, null, () => h("span", "slot"))', h(MyComp, null, () => h('span', 'slot')))

section('4. 组件 vnode：具名插槽（对象形式）')
inspectVNode(
  'h(MyComp, null, { default: () => [...], footer: () => [...] })',
  h(MyComp, null, {
    default: () => [h('span', 'default')],
    footer: () => [h('span', 'footer')],
  }),
)

section('5. 特殊类型：Text / Comment / Fragment')
step('h(Text, null, "纯文本节点")')
const textVNode = h(Text, null, '纯文本节点')
log('type === Text ?', textVNode.type === Text)
log('children =', textVNode.children)

step('h(Comment, null, "v-if 为 false 时的占位")')
const commentVNode = h(Comment, null, 'v-if 为 false 时的占位')
log('type === Comment ?', commentVNode.type === Comment)

step('h(Fragment, null, [...]) —— 多根节点 / v-for 产物')
const fragmentVNode = h(Fragment, null, [h('li', 'x'), h('li', 'y')])
log('type === Fragment ?', fragmentVNode.type === Fragment)
log('shapeFlag =', fragmentVNode.shapeFlag, '-> 注意 Fragment 没有 ELEMENT 位（源码里 shapeFlag 初始为 0）')
