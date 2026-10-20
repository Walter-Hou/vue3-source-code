/**
 * 运行：pnpm ex chapters/06-component/examples/03-lifecycle-order.ts
 * 演示：父子孙三层组件挂载/更新/卸载时生命周期钩子的触发顺序，
 *       以及 Options API 钩子（created/mounted）和 Composition API 钩子（onMounted）混用时的顺序。
 * 看点：
 *   1. 挂载顺序是"深度优先，子先于父"：beforeMount 自顶向下，mounted 自底向上
 *      （因为 mounted 是用 queuePostRenderEffect 排进去的，子组件先完成 patch 才会排父组件的）。
 *   2. 卸载顺序同理：beforeUnmount 自顶向下，unmounted 自底向上。
 *   3. 同一个组件如果 Options API 和 Composition API 的同名钩子都注册了，
 *      它们会被 injectHook 追加进同一个数组，按"注册顺序"依次执行——
 *      applyOptions 的 mounted 选项注册发生在 setup() 返回之后，所以通常是
 *      "setup() 里的 onMounted 先于 Options API 的 mounted 选项" 执行。
 */
import { defineComponent, h, onBeforeMount, onBeforeUnmount, onMounted, onUnmounted, ref } from '@vue/runtime-core'
import { createApp, createRoot, printOps } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

const trace: string[] = []
const record = (msg: string) => trace.push(msg)

// 注意：这里返回的是一个「普通选项对象」，不是 defineComponent() 的结果——
// defineComponent() 会按参数形状解析出一个具体的重载（比如只有 setup 没有 render 时，
// 会推导成"函数式 setup 组件"的类型），把它的返回值再展开进另一个 defineComponent({...})
// 里会导致类型对不上（setup 和 render 混在一起不属于任何一个重载的形状）。
// 只把 withHooks 当成"生成一组可复用选项片段"的工具函数，真正的 defineComponent()
// 调用放在 Grandchild/Child 自己那里，运行时行为完全不变。
function withHooks(name: string) {
  return {
    name,
    setup() {
      onBeforeMount(() => record(`${name}.beforeMount`))
      onMounted(() => record(`${name}.mounted`))
      onBeforeUnmount(() => record(`${name}.beforeUnmount`))
      onUnmounted(() => record(`${name}.unmounted`))
    },
  }
}

section('1. 父子孙三层：挂载顺序')

const Grandchild = defineComponent({
  ...withHooks('Grandchild'),
  render() {
    return h('span', 'grandchild')
  },
})
const Child = defineComponent({
  ...withHooks('Child'),
  render() {
    return h(Grandchild)
  },
})
const show = ref(true)
const Root = defineComponent({
  name: 'Root',
  setup() {
    onBeforeMount(() => record('Root.beforeMount'))
    onMounted(() => record('Root.mounted'))
    onBeforeUnmount(() => record('Root.beforeUnmount'))
    onUnmounted(() => record('Root.unmounted'))
    return () => (show.value ? h(Child) : null)
  },
})

const app = createApp(Root)
const root = createRoot()
app.mount(root)

step('挂载触发的钩子顺序')
log(trace.join(' -> '))
log('(预期：beforeMount 自顶向下 Root -> Child -> Grandchild；mounted 自底向上 Grandchild -> Child -> Root)')
trace.length = 0
printOps('mount')

section('2. 卸载顺序')

app.unmount()
step('卸载触发的钩子顺序')
log(trace.join(' -> '))
log('(预期：beforeUnmount 自顶向下 Root -> Child -> Grandchild；unmounted 自底向上 Grandchild -> Child -> Root)')
trace.length = 0

section('3. Options API 与 Composition API 混用时的顺序')

const Mixed = defineComponent({
  name: 'Mixed',
  setup() {
    // setup() 内同步调用的 onMounted 会被先注册进 instance.m 数组
    onMounted(() => record('Mixed: onMounted (来自 setup)'))
    onBeforeMount(() => record('Mixed: onBeforeMount (来自 setup)'))
  },
  created() {
    // Options API 的 created 在 applyOptions 阶段同步执行，发生在 setup() 返回之后、
    // finishComponentSetup 内部，所以它比 setup() 里注册的 onMounted 更早"执行"，
    // 但它本身不是"挂载钩子"，created 在实例创建阶段就直接调用了，不进 m 数组
    record('Mixed: created (Options API)')
  },
  beforeMount() {
    record('Mixed: beforeMount (Options API，经 registerLifecycleHook 追加进 instance.bm 数组)')
  },
  mounted() {
    record('Mixed: mounted (Options API，追加进 instance.m 数组，排在 setup 的 onMounted 之后)')
  },
  render() {
    return h('div', 'mixed')
  },
})

const app2 = createApp(Mixed)
app2.mount(createRoot())
step('created 执行时机 vs beforeMount/mounted 钩子数组的注册顺序')
log(trace.join('\n'))
log(
  '\n结论：created 在 applyOptions 阶段就被同步调用（不经过 injectHook），',
  '而 beforeMount/mounted 等选项是通过 registerLifecycleHook -> onBeforeMount/onMounted 追加到',
  '"setup() 里已经注册的钩子数组"末尾，所以同名钩子的执行顺序是 [setup 里的] -> [Options API 里的]。',
)
