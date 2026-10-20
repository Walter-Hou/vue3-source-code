/**
 * 运行：pnpm ex chapters/06-component/examples/04-update-flow.ts
 * 演示：父组件更新时，子组件 props 没变 -> shouldUpdateComponent 为 false，不重新渲染；
 *       props 变了 -> 走完整的 updateComponent -> setupRenderEffect 更新分支。
 * 看点：
 *   1. 手写 render 函数（没有 PatchFlags）走的是 shouldUpdateComponent 的"非 optimized"分支：
 *      只要 props 引用不同就认为"可能变了"，调用 hasPropsChanged 逐 key 比较。
 *   2. instance.next 只在"父组件向子组件传入新 vnode 并确认需要更新"时才会被赋值，
 *      自己触发的更新（数据变化）不会经过 instance.next，而是直接调用 instance.update()。
 *   3. 子组件 renderCount 的变化可以直接证明"props 没变时子组件完全没有重新执行 render"，
 *      这是 Vue 3 组件级别更新优化的核心（而不是 Vue 2 那种"父更新子一定重新 render，
 *      只是 patch 阶段靠 diff 跳过无变化的 DOM"）。
 */
import { defineComponent, h, ref } from '@vue/runtime-core'
import { createApp, createRoot, printOps } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

let childRenderCount = 0
let childInstanceRef: any

const Child = defineComponent({
  name: 'Child',
  props: { label: String },
  render(this: any) {
    childRenderCount++
    childInstanceRef = this.$
    return h('span', `label=${this.label} renderCount=${childRenderCount}`)
  },
})

section('1. 父组件强制更新（自己的响应式数据变了），但子组件 props 没变')

const unrelated = ref(0)
const label = ref('A')

const Root = defineComponent({
  name: 'Root',
  render() {
    // 读取 unrelated.value 建立依赖，Root 自己的渲染会因为它变化而重新执行；
    // 但传给 Child 的 props（label）在这一步没有变
    return h('div', [h('p', `unrelated=${unrelated.value}`), h(Child, { label: label.value })])
  },
})

const app = createApp(Root)
const root = createRoot()
app.mount(root)
printOps('首次挂载')
log('childRenderCount =', childRenderCount)

step('修改 unrelated.value（Root 需要重新渲染，Child 的 props.label 不变）')
unrelated.value++
await Promise.resolve() // 等一个微任务，调度器 flush
printOps('Root 更新后的宿主操作')
log('childRenderCount =', childRenderCount, '(应该还是 1 —— shouldUpdateComponent 判定 false，Child 完全没有重新 render)')

section('2. 修改 label.value：Child 的 props 真的变了')

step('修改 label.value（Child 的 props.label 改变，必须重新渲染）')
log('修改前 childInstanceRef.next =', childInstanceRef.next, '(平时是 null)')
label.value = 'B'
await Promise.resolve()
printOps('label 变化后的宿主操作')
log('childRenderCount =', childRenderCount, '(应该变成 2)')

section('3. 观察 instance.next 的出现时机')

// 为了捕捉 instance.next 在"存在"那一刻的值，我们借助一个自定义渲染补丁：
// 在 Child 的 render 函数里读取 this.$.next，由于 render 在 updateComponentPreRender
// 把 next 置空【之后】才被调用（next.el = vnode.el 发生在 render 之前，但 instance.next = null
// 发生在 updateComponentPreRender 内，也在 render 之前），所以 render 执行时 next 已经是 null。
// 下面改用"猴子补丁" instance.update 来在 patch 之前窥视 next 的值。
const ChildWithPeek = defineComponent({
  name: 'ChildWithPeek',
  props: { label: String },
  render(this: any) {
    return h('span', `label=${this.label}`)
  },
})

const label2 = ref('X')
const Root2 = defineComponent({
  name: 'Root2',
  render() {
    return h(ChildWithPeek, { label: label2.value })
  },
})
const app2 = createApp(Root2)
app2.mount(createRoot())

// 猴子补丁 instance.update：在真正触发 componentUpdateFn 之前，先看一眼 instance.next
// 是不是已经被 updateComponent() 设置成了父组件带来的新 vnode。
const childInstance2 = (app2._instance as any).subTree.component
const originalUpdate = childInstance2.update
childInstance2.update = () => {
  step('【猴子补丁】即将调用 componentUpdateFn 之前，instance.next 的实际值')
  log('instance.next.props =', childInstance2.next?.props, '(非 null，说明这是一次"父组件带着新 vnode 触发"的更新)')
  originalUpdate()
}

label2.value = 'Y'
await Promise.resolve()

// 从父组件的角度看：updateComponent() 在判定需要更新后会设置 `instance.next = n2`，
// 紧接着同步调用 `instance.update()`，所以 next 存在的窗口非常短——它存在的意义是让
// componentUpdateFn 的 update 分支知道"这次更新是被父组件带着新 vnode 触发的"，
// 从而需要先 updateProps/updateSlots，而不是直接 renderComponentRoot。
step('直接阅读源码里的时序（renderer.ts updateComponent / setupRenderEffect）')
log(
  [
    '1. 父组件 render 产出新的 Child vnode (n2)',
    '2. patch(n1, n2) -> processComponent -> updateComponent(n1, n2)',
    '3. shouldUpdateComponent(n1, n2) 判定需要更新',
    '4. instance.next = n2   <-- next 第一次被赋值',
    '5. instance.update() 同步执行 componentUpdateFn 的 update 分支',
    '6. updateComponentPreRender(instance, next) 内部：instance.vnode = next; instance.next = null  <-- next 被清空',
    '7. renderComponentRoot(instance) 重新渲染，patch 新旧 subTree',
  ].join('\n'),
)
