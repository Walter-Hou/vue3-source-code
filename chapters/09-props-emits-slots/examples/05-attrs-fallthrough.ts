/**
 * 运行：pnpm ex chapters/09-props-emits-slots/examples/05-attrs-fallthrough.ts
 * 演示：单根节点自动把 $attrs 合并到根节点上；多根节点（Fragment）时不会自动透传并有开发期警告；
 *       inheritAttrs: false 关闭自动透传；class/style 合并规则；useAttrs()。
 * 看点：
 *   1. attrs fallthrough 发生在 renderComponentRoot 里，本质是 cloneVNode(root, fallthroughAttrs)——
 *      根节点被替换成一个新的、合并了 attrs 的 vnode，原来的根 vnode 对象并不会被原地修改。
 *   2. 多根节点组件渲染出 Fragment，Vue 不知道该把 attrs 糊到哪个根节点上，所以直接跳过透传，
 *      并在开发期打印 "Extraneous non-props attributes" 警告（除非用户访问过 $attrs 自己处理）。
 *   3. class/style 走 mergeProps 的合并规则（拼接/合并对象），其余同名 key 以透传的 attrs 为准
 *      （因为 cloneVNode(root, fallthroughAttrs) 里 fallthroughAttrs 是后合并的那一个）。
 */
import { defineComponent, h, useAttrs } from '@vue/runtime-core'
import { createApp, createRoot, serializeInner } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

section('1. 单根节点：attrs 自动合并到根节点上')

const SingleRootChild = defineComponent({
  name: 'SingleRootChild',
  props: { label: String },
  render(this: any) {
    return h('button', { class: 'btn' }, this.label)
  },
})
const Root1 = defineComponent({
  name: 'Root1',
  render: () =>
    h(SingleRootChild, {
      label: 'click me',
      id: 'submit-btn', // 未声明的 prop -> 进 attrs -> 自动透传到 <button>
      class: 'extra', // class 会和子组件自己的 class 合并，不是覆盖
      onClick: () => {}, // 事件监听器也会透传（attrs 包含事件）
    } as any),
})
const root1 = createRoot()
createApp(Root1).mount(root1)
step('渲染结果：id/class/onClick 都出现在 <button> 上')
log(serializeInner(root1))

section('2. 多根节点（Fragment）：不会自动透传，并有开发期警告')

const MultiRootChild = defineComponent({
  name: 'MultiRootChild',
  render: () => [h('span', 'a'), h('span', 'b')], // 返回数组 -> normalizeVNode 包成 Fragment
})
const Root2 = defineComponent({
  name: 'Root2',
  render: () => h(MultiRootChild, { 'data-extra': 'x' } as any),
})
const root2 = createRoot()
createApp(Root2).mount(root2)
step('渲染结果：data-extra 没有出现在任何一个 <span> 上（应该在控制台看到一条 Extraneous 警告）')
log(serializeInner(root2))

section('3. inheritAttrs: false：手动用 $attrs 决定透传到哪')

const ManualChild = defineComponent({
  name: 'ManualChild',
  inheritAttrs: false,
  render(this: any) {
    // 手动把 $attrs 透传到内层元素，而不是根元素
    return h('div', { class: 'wrapper' }, [h('button', this.$attrs, 'manual')])
  },
})
const Root3 = defineComponent({
  name: 'Root3',
  render: () => h(ManualChild, { id: 'inner-btn', title: 'tip' } as any),
})
const root3 = createRoot()
createApp(Root3).mount(root3)
step('渲染结果：id/title 出现在内层 <button> 而不是外层 <div> 上')
log(serializeInner(root3))

section('4. class / style 合并规则')

const MergeChild = defineComponent({
  name: 'MergeChild',
  render: () => h('div', { class: 'own', style: { color: 'red' } }, 'merge-demo'),
})
const Root4 = defineComponent({
  name: 'Root4',
  render: () =>
    h(MergeChild, {
      class: ['extra1', { extra2: true, extra3: false }],
      style: { fontSize: '14px' },
    } as any),
})
const root4 = createRoot()
createApp(Root4).mount(root4)
step('class 拼接、style 合并（不是覆盖）')
log(serializeInner(root4))

section('5. useAttrs()：响应式地读取透传属性')

let attrsRef: any
const UseAttrsChild = defineComponent({
  name: 'UseAttrsChild',
  setup() {
    attrsRef = useAttrs()
    return () => h('span', `extra=${attrsRef.extra}`)
  },
})
const Root5 = defineComponent({
  name: 'Root5',
  render: () => h(UseAttrsChild, { extra: 'hello' } as any),
})
createApp(Root5).mount(createRoot())
step('useAttrs() 返回的对象和 instance.attrs 是同一份数据的只读视图')
log('attrsRef.extra =', attrsRef.extra)
