/**
 * 运行：pnpm ex chapters/05-vnode-createapp/examples/02-h-overloads-and-normalize.ts
 * 演示：h() 的参数重载解析规则、normalizeChildren 产出的 shapeFlag、
 *       normalizeVNode 对 null/数组/字符串的转换、cloneVNode/mergeProps 的行为。
 * 看点：
 *   1. h() 运行时实现只看 arguments.length 和第二个参数的类型，跟 TS 重载声明无关
 *      （那十几个 overload 只是给类型检查用的，运行时走的是同一份 if/else）。
 *   2. normalizeVNode 是 patch 前的"收口"：无论 render() 返回什么奇怪的东西，
 *      最终都会被转成一个合法的 VNode。
 *   3. cloneVNode 用 extraProps 合并时会强制打上 FULL_PROPS，因为"克隆时加了新 props"
 *      这件事编译器并不知道，运行时不能再相信原来的 patchFlag。
 */
import { Comment, Fragment, Text, cloneVNode, createVNode, h, mergeProps } from '@vue/runtime-core'
import * as RuntimeCore from '@vue/runtime-core'
import { PatchFlags } from '@vue/shared'
import { log, section, step } from '../../../shared/print'

// normalizeVNode 是 runtime-core 的内部函数（标 @private），没有作为公开 API 导出，
// 但 server-renderer 需要用它来统一渲染结果，所以源码通过 `ssrUtils` 这个内部对象
// （packages/runtime-core/src/index.ts#L408-L436）把它和其他几个内部函数一起"开了个后门"。
// 这里借用同一条通道来观察它的行为。注意：ssrUtils 在运行时确实存在于模块导出里
// （cjs/esm 产物都能看到），但公开的 .d.ts 把它标成 @internal 裁掉了，所以不能直接
// `import { ssrUtils }`，只能 `import * as` 整体拿到模块对象后用 any 绕过类型检查。
const { normalizeVNode } = (RuntimeCore as any).ssrUtils!

section('1. h() 的参数重载：运行时只看 arguments.length + 类型')

step('h("div") —— 只有 type')
{
  const v = h('div')
  log({ type: v.type, props: v.props, children: v.children, shapeFlag: v.shapeFlag })
}

step('h("div", { id: "a" }) —— 第二参是"非数组对象"当 props')
log({ props: h('div', { id: 'a' }).props })

step('h("div", "text") —— 第二参是字符串，视为 children，props 省略为 null')
{
  const v = h('div', 'text')
  log({ props: v.props, children: v.children })
}

step('h("div", [h("span")]) —— 第二参是数组，也视为 children（省略 props）')
{
  const v = h('div', [h('span')])
  log({ props: v.props, childrenLength: (v.children as any[]).length })
}

step('h("div", h("span")) —— 第二参是"单个 vnode"，会被包一层数组再当 children')
{
  const inner = h('span')
  const v = h('div', inner)
  log({
    props: v.props,
    isArray: Array.isArray(v.children),
    firstChildIsInner: (v.children as any[])[0] === inner,
  })
}

step('h("div", {}, a, b, c) —— 超过 3 个参数时，从第 3 个开始都是 children（等价于 h(type, props, [a,b,c])）')
{
  // h() 运行时实现靠 arguments.length 支持任意多个 children 参数（见本章 README），
  // 但公开的 .d.ts 里 h() 的重载都只声明到 3 个参数，所以这种调用方式在类型层面
  // 没有对应的重载——这正好印证了看点 1："类型声明和运行时实现是两回事"。
  const v = (h as any)('div', {}, h('span', '1'), h('span', '2'), 'text')
  log({ childrenLength: (v.children as any[]).length })
}

step('h(Comp, null, {}) —— 具名插槽必须显式传 null 占位 props，否则 {} 会被当成 props 而不是 slots')
{
  const Comp = { render: () => null }
  const v = h(Comp, null, { default: () => [] })
  log({ props: v.props, children: Object.keys(v.children as object) })
}

section('2. normalizeVNode：render() 返回值的统一收口')

for (const [desc, input] of [
  ['null', null],
  ['undefined', undefined],
  ['false', false],
  ['字符串', 'hi'],
  ['数字', 42],
  ['数组', [h('li'), h('li')]],
  ['已经是 vnode', h('div')],
] as const) {
  const normalized = normalizeVNode(input as any)
  const children = Array.isArray(normalized.children)
    ? normalized.children.map((c: any) => ({ type: c.type, children: c.children }))
    : normalized.children
  step(`normalizeVNode(${desc}) -> type = ${describeType(normalized.type)}`)
  log('children =', children)
}

function describeType(type: unknown): string {
  if (type === Text) return 'Text'
  if (type === Comment) return 'Comment'
  if (type === Fragment) return 'Fragment'
  return String(type)
}

step('cloneIfMounted：vnode.el 是否为 null 决定 normalizeVNode 是否需要克隆')
{
  const fresh = h('div') // el 还是 null -> 未挂载
  const mounted = h('span')
  mounted.el = {} as any // 模拟"已经挂载过"（el 不为 null）

  log('fresh.el === null  -> normalizeVNode 原样返回:', normalizeVNode(fresh) === fresh)
  log('mounted.el !== null -> normalizeVNode 会克隆一份:', normalizeVNode(mounted) !== mounted)
}

section('3. cloneVNode / mergeProps')

step('cloneVNode(vnode, extraProps)：合并 props，并打上 FULL_PROPS')
{
  const original = createVNode('div', { id: 'a' }, 'hi', PatchFlags.TEXT)
  const cloned = cloneVNode(original, { class: 'extra' })
  log('original.patchFlag =', original.patchFlag, '(PatchFlags.TEXT = 1)')
  log('cloned.props        =', cloned.props)
  log(
    'cloned.patchFlag     =',
    cloned.patchFlag,
    `(TEXT | FULL_PROPS = ${PatchFlags.TEXT | PatchFlags.FULL_PROPS}；源码：patchFlag | PatchFlags.FULL_PROPS)`,
  )
}

step('mergeProps：class/style 会合并拼接，on* 事件会合并成数组，普通 key 后者覆盖前者')
{
  const merged = mergeProps(
    { class: 'a', style: { color: 'red' }, onClick: () => {}, id: 'x' },
    { class: 'b', style: { fontSize: '12px' }, onClick: () => {}, id: 'y' },
  )
  log('class  =', merged.class, '(两个 class 用空格拼接)')
  log('style  =', merged.style, '(两个 style 对象合并)')
  log('onClick 是否变成数组 =', Array.isArray(merged.onClick), '(两个处理函数都要调用，所以合并成数组)')
  log('id     =', merged.id, '(普通 key 后者覆盖前者)')
}
