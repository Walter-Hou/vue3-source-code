/**
 * 运行：pnpm ex chapters/09-props-emits-slots/examples/04-slots.ts
 * 演示：默认/具名/作用域插槽的运行时表现；手写 SlotFlags 模拟编译产物；
 *       updateSlots 在 STABLE / DYNAMIC 两种标记下的差异；renderSlot 产出的 Fragment 与 fallback。
 * 看点：
 *   1. 不管是默认插槽还是具名插槽，运行时统一存成 instance.slots 上的一组函数
 *      （InternalSlots：{ [name]: (props) => VNode[] }），没有"作用域插槽"和"普通插槽"的区分，
 *      区别只在于调用插槽函数时有没有传参数。
 *   2. SlotFlags.STABLE 时 updateSlots 完全跳过重新赋值（needDeletionCheck=false），
 *      这是编译器确认"这个组件的插槽内容不依赖外部可能变化的状态"时才会打的标记。
 *   3. renderSlot() 产出的永远是一个 Fragment（即使只有一个子节点），这样插槽内容的
 *      "容器"和外部结构解耦，父组件更新插槽内容不需要关心子组件 <slot> 所在的具体位置。
 */
import {
  Fragment,
  type VNode,
  createElementBlock,
  createVNode,
  defineComponent,
  h,
  openBlock,
  renderSlot,
  withCtx,
} from '@vue/runtime-core'
import { PatchFlags, SlotFlags } from '@vue/shared'
import { createApp, createRoot, serializeInner } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

section('1. 默认插槽 / 具名插槽：底层都是 instance.slots 上的函数')

let slotsSeen: any
const SlotHost = defineComponent({
  name: 'SlotHost',
  setup(_, { slots }) {
    slotsSeen = slots
    return () =>
      h('div', [
        h('header', renderSlot(slots, 'header')),
        h('main', renderSlot(slots, 'default')),
        h('footer', renderSlot(slots, 'footer', {}, () => [h('span', 'fallback-footer')])),
      ])
  },
})

const Root1 = defineComponent({
  name: 'Root1',
  render: () =>
    h(
      SlotHost,
      null,
      {
        header: () => [h('h1', 'Header 内容')],
        default: () => [h('p', 'Default 内容')],
        // 没有传 footer，让 fallback 生效
      } as any,
    ),
})
const root1 = createRoot()
createApp(Root1).mount(root1)

step('instance.slots 上有哪些 key')
log(Object.keys(slotsSeen).filter(k => k !== '_' && k !== '_ctx'))
step('渲染结果（footer 走 fallback）')
log(serializeInner(root1, 2))

section('2. 作用域插槽：父组件的插槽函数能接收子组件传来的参数')

let scopedPayload: any
const ScopedHost = defineComponent({
  name: 'ScopedHost',
  setup(_, { slots }) {
    return () => h('ul', renderSlot(slots, 'default', { item: 'apple', index: 0 }))
  },
})
const Root2 = defineComponent({
  name: 'Root2',
  render: () =>
    h(ScopedHost, null, {
      default: (payload: any) => {
        scopedPayload = payload
        return [h('li', `${payload.index}: ${payload.item}`)]
      },
    }),
})
const root2 = createRoot()
createApp(Root2).mount(root2)
step('子组件通过 renderSlot(slots, name, props) 把 props 传给父组件写的插槽函数')
log('scopedPayload =', scopedPayload)
log(serializeInner(root2, 2))

section('3. renderSlot 产出的永远是 Fragment')

// 手动调用一次 renderSlot 看看它的返回值结构（在一个临时的渲染上下文里）
let fragmentVNode: VNode | undefined
const PeekHost = defineComponent({
  name: 'PeekHost',
  setup(_, { slots }) {
    return () => {
      fragmentVNode = renderSlot(slots, 'default')
      return h('div', fragmentVNode)
    }
  },
})
createApp(defineComponent({ render: () => h(PeekHost, null, { default: () => [h('span', 'x')] }) })).mount(createRoot())
step('renderSlot(...) 的返回值')
log('type === Fragment ?', fragmentVNode!.type === Fragment)
log('patchFlag =', fragmentVNode!.patchFlag, '(STABLE_FRAGMENT 或 BAIL，取决于 slots._ 是否标记为 SlotFlags.STABLE)')

section('4. 手写 SlotFlags 模拟编译产物：STABLE vs DYNAMIC 对 updateSlots 的影响')

// 关键前提：updateSlots 里 `optimized && type === SlotFlags.STABLE` 才会跳过 assignSlots，
// 所以必须让 Child vnode 的 patch 调用带着 optimized=true —— 这只有在父组件自己也是一个
// Block（openBlock + createElementBlock）、Child 被父 block 的 dynamicChildren 收集到时，
// patchBlockChildren 才会显式传 optimized=true（见第 05 章 5.6 节 / chapters/05 的 block 示例）。

const UpdateChild = defineComponent({
  name: 'UpdateChild',
  setup(_, { slots }) {
    return () => h('div', renderSlot(slots, 'default'))
  },
})

async function runSlotFlagCase(flag: number, label: string) {
  let outerValue = 'v1'
  function makeSlotsObj() {
    return { default: withCtx(() => [h('span', outerValue)]), _: flag }
  }
  // 注意：真正驱动 shouldUpdateComponent 判定"要不要更新"的，是 vnode 自己的 patchFlag
  // 里有没有 DYNAMIC_SLOTS 这一位（编译器在 transformElement.ts 里检测到插槽内容可能变化时
  // 会给 createVNode 调用本身加上这个 patchFlag），而不是 slots 对象上的 `_` 字段
  // ——`_` 字段只是 updateSlots 内部用来决定"要不要 assignSlots"的依据。
  const vnodePatchFlag = flag === SlotFlags.DYNAMIC ? PatchFlags.DYNAMIC_SLOTS : 0
  const Root = defineComponent({
    name: 'Root_' + label,
    render() {
      // 模拟编译产物：(openBlock(), createElementBlock('div', null, [ child vnode ]))
      return (
        openBlock(),
        createElementBlock('div', null, [
          createVNode(UpdateChild, null, makeSlotsObj(), vnodePatchFlag),
        ])
      )
    },
  })
  const app = createApp(Root)
  const root = createRoot()
  app.mount(root)
  const rootInstance = app._instance as any
  const childInstance = rootInstance.subTree.children[0].component
  const slotFnBefore = childInstance.slots.default

  step(`${label}：首次渲染内容`)
  log(serializeInner(root).trim())

  // 修改闭包变量，强制 Root 自己重新渲染（Root 没有响应式依赖，用 update() 模拟"父组件因为
  // 其他原因重新渲染"这件事——此时新产出的 Child vnode 带着全新的 slots 对象）
  outerValue = 'v2'
  rootInstance.update()
  await Promise.resolve()

  log(`slots.default 函数引用是否还是同一个 =`, childInstance.slots.default === slotFnBefore)
  log('更新后的渲染内容 =', serializeInner(root).trim())
}

await runSlotFlagCase(
  SlotFlags.STABLE,
  'STABLE（源码：optimized && type===STABLE 时完全跳过 assignSlots，needDeletionCheck=false）',
)
log(
  '-> STABLE 场景下 slots.default 还是第一次渲染时的那个函数引用，渲染内容也停留在 v1 ——',
  '这正是"手写/编译器错误地把实际会变的插槽标成 STABLE"会导致的内容不更新问题，',
  '真实编译器只有在插槽内容"不引用任何可能变化的外部状态"时才会生成这个标记。',
)

await runSlotFlagCase(SlotFlags.DYNAMIC, 'DYNAMIC（源码：走 assignSlots 分支，重新赋值）')
log('-> DYNAMIC 场景下 slots.default 变成了新的函数引用，渲染内容正确更新为 v2。')
