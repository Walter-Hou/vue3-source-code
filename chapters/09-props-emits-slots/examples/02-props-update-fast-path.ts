/**
 * 运行：pnpm ex chapters/09-props-emits-slots/examples/02-props-update-fast-path.ts
 * 演示：手写带 PatchFlags.PROPS + dynamicProps 的组件 vnode（模拟编译产物）与普通 h() 调用对比，
 *       观察 updateProps 的快速路径（只遍历 dynamicProps）与全量 diff 路径的行为差异。
 * 看点：
 *   1. 快速路径下，updateProps 只会遍历 vnode.dynamicProps 列出的 key；如果手写时
 *      漏报了一个确实变化的 key（没放进 dynamicProps），这个 key 根本不会被更新——
 *      这正是"手写 Block vnode 很危险，必须让编译器来生成"的原因。
 *   2. 全量 diff 路径（没有 PatchFlags.PROPS，或 optimized=false）会遍历 rawProps 的所有 key，
 *      所以不会有"漏报"问题，但开销更大（这也是为什么编译器要尽量生成精确的 dynamicProps）。
 *   3. attrs 的变化会触发 instance.attrs 的 trigger（给 $attrs 用的响应式 track/trigger），
 *      用于插槽场景下"透传 attrs"的响应式更新。
 */
import { createElementBlock, createVNode, defineComponent, h, openBlock, ref } from '@vue/runtime-core'
import { PatchFlags } from '@vue/shared'
import { createApp, createRoot, printOps } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

function makeChild(name: string) {
  return defineComponent({
    name,
    props: { msg: { type: String, default: '' } },
    render(this: any) {
      return h('span', `msg=${this.msg} attrs.extra=${this.$attrs.extra ?? '(无)'}`)
    },
  })
}

section('1. 快速路径：PatchFlags.PROPS + dynamicProps（模拟编译产物）')

const FastChild = makeChild('FastChild')
const msgA = ref('m1')
const extraA = ref('e1')

const RootFast = defineComponent({
  name: 'RootFast',
  render() {
    // 模拟编译器产物：dynamicProps **故意只报 msg，漏报 extra**（模拟手写/编译器 bug 场景）
    return (
      openBlock(),
      createElementBlock('div', null, [
        createVNode(FastChild, { msg: msgA.value, extra: extraA.value }, null, PatchFlags.PROPS, ['msg']),
      ])
    )
  },
})

const appFast = createApp(RootFast)
const rootFast = createRoot()
appFast.mount(rootFast)
printOps('首次挂载（FastChild）')

step('同时修改 msgA 和 extraA，但 dynamicProps 只报了 "msg"')
msgA.value = 'm2'
extraA.value = 'e2'
await Promise.resolve()
printOps('更新后的宿主操作')
log(
  '结果：msg 正确更新成 m2（在 dynamicProps 里），但 attrs.extra 还停留在 e1',
  '——因为 updateProps 的 PROPS 快速路径只遍历 vnode.dynamicProps 列出的 key，',
  '"extra" 不在这个列表里，压根不会被访问到，是一个被静默忽略的"脏数据"。',
)

section('2. 对照组：dynamicProps 把 extra 也报上，就不会有问题')

const FastChild2 = makeChild('FastChild2')
const msgB = ref('m1')
const extraB = ref('e1')
const RootFast2 = defineComponent({
  name: 'RootFast2',
  render() {
    return (
      openBlock(),
      createElementBlock('div', null, [
        createVNode(FastChild2, { msg: msgB.value, extra: extraB.value }, null, PatchFlags.PROPS, ['msg', 'extra']),
      ])
    )
  },
})
const appFast2 = createApp(RootFast2)
appFast2.mount(createRoot())
msgB.value = 'm2'
extraB.value = 'e2'
await Promise.resolve()
printOps('dynamicProps 完整时的更新操作')

section('3. 全量 diff 路径：普通 h()，没有 PatchFlags.PROPS')

const PlainChild = makeChild('PlainChild')
const msgC = ref('m1')
const extraC = ref('e1')
const RootPlain = defineComponent({
  name: 'RootPlain',
  render() {
    // 普通 h() 调用：没有 openBlock/patchFlag，走全量 props diff（optimized 始终为 false）
    return h('div', [h(PlainChild, { msg: msgC.value, extra: extraC.value })])
  },
})
const appPlain = createApp(RootPlain)
appPlain.mount(createRoot())
msgC.value = 'm2'
extraC.value = 'e2'
await Promise.resolve()
printOps('全量 diff 路径下的更新操作')
log('全量 diff 路径下 msg 和 extra 都正确更新——因为 setFullProps 会遍历 rawProps 的所有 key，不依赖 dynamicProps 列表')

section('4. 全量 diff 路径下删除一个 prop：遗留的旧值会被正确清理')

const DelChild = defineComponent({
  name: 'DelChild',
  props: { msg: { type: String, default: 'default-msg' } },
  render(this: any) {
    return h('span', `msg=${this.msg} attrs.extra=${JSON.stringify(this.$attrs.extra)}`)
  },
})
const hasExtra = ref(true)
const RootDel = defineComponent({
  name: 'RootDel',
  render() {
    const props: Record<string, any> = { msg: 'hi' }
    if (hasExtra.value) props.extra = 'present'
    return h('div', [h(DelChild, props)])
  },
})
const appDel = createApp(RootDel)
const rootDel = createRoot()
appDel.mount(rootDel)
printOps('挂载（带 extra attr）')

step('hasExtra.value = false：下一次渲染 rawProps 里完全没有 extra 这个 key 了')
hasExtra.value = false
await Promise.resolve()
printOps('extra 被移除后的更新操作')
log(
  'setFullProps 的"全量 diff"分支会遍历 rawCurrentProps，发现 extra 不在新的 rawProps 里就 delete attrs.extra',
  '——这是快速路径（只遍历 dynamicProps）做不到的事：PatchFlags.PROPS 的注释明确写了',
  '"Mutually exclusive with FULL_PROPS"，因为 PROPS 场景的前提就是"key 集合不会变"。',
)
