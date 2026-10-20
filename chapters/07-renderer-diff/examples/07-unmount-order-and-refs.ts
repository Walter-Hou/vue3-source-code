/**
 * 运行：pnpm ex chapters/07-renderer-diff/examples/07-unmount-order-and-refs.ts
 * 演示：
 *   A. 父子组件的 beforeUnmount / unmounted 钩子顺序；
 *   B. 模板 ref 的设置时机——根组件的首次 mount 和组件自身触发的更新，
 *      ref 落地的时机并不一样；卸载时 ref 会被同步置 null。
 * 看点：
 *   1. beforeUnmount 是同步、自顶向下：父的 bum 先跑，再去递归 unmount 子树
 *      （unmountComponent: renderer.ts#L2367-2407，`if (bum) invokeArrayFns(bum)`
 *      在 `unmount(subTree, ...)` 之前）。
 *   2. unmounted 是通过 queuePostRenderEffect 排队的，子组件先把自己的
 *      um 塞进 post 队列，父组件的 um 后塞进去，flush 时按入队顺序执行，
 *      所以表现为自底向上（子先 unmounted，父后 unmounted）。
 *   3. ref：根组件首次 mount 时，`render()` 内部调用的是 `flushOnAppMount`
 *      （renderer.ts#L2458-2486），它在 patch 完成后【同步】flush 了
 *      post effects，所以 render() 调用一结束，ref 就已经可用——不需要
 *      nextTick。而组件自身状态变化触发的更新走的是 queueJob 的微任务
 *      调度（见第 08 章），这时候 ref 要等 `await nextTick()` 才会更新。
 *   4. 卸载时 setRef(..., isUnmount=true) 分支里 value 是 null（falsy），
 *      源码直接同步 doSet()，不经过 queuePostRenderEffect
 *      （rendererTemplateRef.ts#L188-202）——卸载把 ref 置空不用等 nextTick。
 */
import { defineComponent, h, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref } from '@vue/runtime-core'
import { createRoot, render } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

const elRef = ref<any>(null)

const Child = defineComponent({
  name: 'Child',
  setup() {
    onMounted(() => log('[Child] onMounted'))
    onBeforeUnmount(() => log('[Child] onBeforeUnmount'))
    onUnmounted(() => log('[Child] onUnmounted'))
    return () => h('span', { ref: elRef }, 'child content')
  },
})

const App = defineComponent({
  name: 'App',
  setup() {
    onMounted(() => log('[App] onMounted'))
    onBeforeUnmount(() => log('[App] onBeforeUnmount'))
    onUnmounted(() => log('[App] onUnmounted'))
    return () => h('div', [h(Child)])
  },
})

section('1. 根组件首次 mount：render() 返回时 ref 已经可用（同步 flushOnAppMount）')

const root = createRoot()
step('调用 render(h(App), root)')
render(h(App), root)
log('render() 调用已经返回，此时 elRef.value =', elRef.value ? '(span 元素，已就绪)' : null)

section('2. 对比：组件自身触发的更新，ref 要等 nextTick 才落地')

const show = ref(false)
const elRef2 = ref<any>(null)
const Toggle = defineComponent({
  name: 'Toggle',
  setup() {
    return () => (show.value ? h('span', { ref: elRef2 }, 'toggled in') : h('div', 'placeholder'))
  },
})
const root2 = createRoot()
render(h(Toggle), root2)
log('初始 mount（show=false），elRef2.value =', elRef2.value)

step('show.value = true：这是组件自身状态变化，走 queueJob 的微任务调度（见第 08 章）')
show.value = true
log('刚设置完 show.value=true（仍是同步代码），elRef2.value =', elRef2.value, '<- 还没更新！')

await nextTick()
log('await nextTick() 之后，elRef2.value =', elRef2.value ? '(span 元素，已就绪)' : null)

section('3. 卸载顺序：beforeUnmount 自顶向下，unmounted 自底向上')

step('render(null, root) 卸载整棵树')
render(null, root)

log('卸载过程中 elRef.value（卸载分支是同步 doSet，不等 nextTick）=', elRef.value)
