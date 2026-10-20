/**
 * 运行：pnpm ex chapters/10-builtin-components/examples/05-base-transition-hooks.ts
 * 演示：直接用 @vue/runtime-core 的 BaseTransition（不经过 runtime-dom 的 CSS 类名包装）配纯 JS 钩子，
 *      观察 enter/leave 回调顺序、done() 如何控制宿主节点真正被 remove 的时机、
 *      mode="out-in" 的先后顺序、以及同 key 快速切换时的“强制提前结束 / 取消”
 * 看点：① done() 调用之前宿主节点还在树里——“leave 开始”和“remove 真正发生”是两个时间点
 *      ② mode="out-in" 严格保证：旧节点 leave 完全结束（state.isLeaving 变回 false）之后，新节点才 enter
 *      ③ 同 key 快速切换（enter 还没完成就要求 leave）会触发 onEnterCancelled，而不是 onAfterEnter
 */
import {
  BaseTransition,
  Comment,
  type VNode,
  defineComponent,
  h,
  nextTick,
  ref,
} from '@vue/runtime-core'
import {
  createRoot,
  printOps,
  render,
  resetOps,
  serialize,
} from '../../../shared/logging-renderer'
import { log, section, sleep, step } from '../../../shared/print'

// ====================================================================
// 1. 基本 enter/leave：done() 决定宿主 remove 的真正时机
// ====================================================================
section('1. 基本 enter/leave：注意 "leave 开始" 和 "真正 remove" 是两个时间点')

const visible1 = ref(false)
const root1 = createRoot()
// 手动模拟编译器给 v-if 产出的「稳定占位」：true 时是真实 div，false 时是注释 vnode，
// 这样 BaseTransition 才能识别出「从真实内容切换成空」与「从空切换成真实内容」。
const App1 = defineComponent({
  render() {
    return h(
      BaseTransition,
      {
        onBeforeEnter: () => log('[hook] beforeEnter'),
        onEnter: (el: any, done: () => void) => {
          log('[hook] enter 开始（模拟 20ms 动画，此时节点已经 insert 到容器里了）')
          setTimeout(() => {
            log('[hook] enter 动画结束，调用 done()')
            done()
          }, 20)
        },
        onAfterEnter: () => log('[hook] afterEnter'),
        onBeforeLeave: () => log('[hook] beforeLeave'),
        onLeave: (el: any, done: () => void) => {
          log('[hook] leave 开始（模拟 20ms 动画，节点还在树里，还没有 remove）')
          setTimeout(() => {
            log('[hook] leave 动画结束，调用 done() —— 这里才会触发 renderer.remove()')
            done()
          }, 20)
        },
        onAfterLeave: () => log('[hook] afterLeave'),
      },
      {
        default: () =>
          visible1.value ? [h('div', { key: 'box' }, 'box')] : [h(Comment, 'v-if')],
      },
    )
  },
})

render(h(App1), root1)
await nextTick()
resetOps()

step('visible = true：先 insert，再异步调用 enter 的 done()')
visible1.value = true
await nextTick()
printOps('visible=true 后立即发生的宿主操作（此时应该已经 insert，但 enter 还没结束）')
await sleep(30)
printOps('30ms 后（enter 的 setTimeout 已跑完，done() 触发 afterEnter，没有新的宿主操作）')

step('visible = false：注意 remove 推迟到 leave 的 done() 调用之后才发生')
visible1.value = false
await nextTick()
printOps('visible=false 后立即发生的宿主操作（这里应该是空——还没 remove）')
log('此刻 HTML（节点应该还在）:', serialize(root1))
await sleep(30)
printOps('30ms 后（leave 的 done() 调用了 remove()，这里才看到 remove）')
log('此刻 HTML（节点真的没了）:', serialize(root1))

// ====================================================================
// 2. mode="out-in"：旧节点必须完全 leave 完，新节点才会 enter
// ====================================================================
section('2. mode="out-in"：tab A -> B，严格先后顺序，不会同时出现在树里')

const tab = ref<'A' | 'B'>('A')
const root2 = createRoot()
const App2 = defineComponent({
  render() {
    return h(
      BaseTransition,
      {
        mode: 'out-in',
        onBeforeLeave: (el: any) => log(`[hook] beforeLeave <${(el as any).tag}>`),
        onLeave: (el: any, done: () => void) => {
          log(`[hook] leave 开始 <${el.tag}>`)
          setTimeout(() => {
            log(`[hook] leave 结束 <${el.tag}>，调用 done()`)
            done()
          }, 20)
        },
        onBeforeEnter: (el: any) => log(`[hook] beforeEnter <${el.tag}>`),
        onEnter: (el: any, done: () => void) => {
          log(`[hook] enter 开始 <${el.tag}>（这一步必须等上一个 leave 的 afterLeave 触发重新渲染之后才会跑）`)
          setTimeout(() => {
            log(`[hook] enter 结束 <${el.tag}>`)
            done()
          }, 20)
        },
      },
      {
        default: () => [h('div', { key: tab.value, tag: tab.value }, `tab ${tab.value}`)],
      },
    )
  },
})

render(h(App2), root2)
await nextTick()
resetOps()

step('tab: A -> B（out-in：A 必须先 leave 完，B 才开始 enter）')
tab.value = 'B'
await nextTick()
printOps('切换瞬间的宿主操作（这里不会 insert B，因为 B 还在等 A leave 完）')
log('这期间 HTML（A 还占着位置，B 还没出现）:', serialize(root2))

await sleep(30)
printOps('30ms 后：A leave 完成 -> afterLeave 触发重新渲染 -> B 才被 createElement+insert')
log('HTML:', serialize(root2))

await sleep(30)
printOps('再过 30ms：B 的 enter 也结束了（没有新的宿主操作，只是钩子调用）')

// ====================================================================
// 3. 同 key 快速切换：enter 还没完成就要求 leave，触发 onEnterCancelled
// ====================================================================
section('3. 同一个 key 快速切换：enter 没做完就 leave，应该看到 onEnterCancelled 而不是 onAfterEnter')

const visible3 = ref(false)
const root3 = createRoot()
const App3 = defineComponent({
  render() {
    return h(
      BaseTransition,
      {
        onBeforeEnter: () => log('[hook] beforeEnter'),
        onEnter: (el: any, done: () => void) => {
          log('[hook] enter 开始（故意模拟 50ms 的慢动画）')
          setTimeout(done, 50)
        },
        onAfterEnter: () => log('[hook] afterEnter（不应该出现——enter 会被提前取消）'),
        onEnterCancelled: () => log('[hook] onEnterCancelled —— enter 还没完成就被要求 leave 了'),
        onBeforeLeave: () => log('[hook] beforeLeave'),
        onLeave: (el: any, done: () => void) => {
          log('[hook] leave 开始')
          setTimeout(done, 10)
        },
        onAfterLeave: () => log('[hook] afterLeave'),
      },
      {
        default: () =>
          visible3.value ? [h('div', { key: 'box' }, 'box')] : [h(Comment, 'v-if')],
      },
    )
  },
})

render(h(App3), root3)
await nextTick()

step('visible = true：enter 开始（50ms 才会 done）')
visible3.value = true
await nextTick()

await sleep(10)
step('10ms 时（enter 远没结束）就把 visible 设回 false：leave() 钩子内部会调用 el[enterCbKey](true) 提前终止 enter')
visible3.value = false
await nextTick()

await sleep(60)
log('全部定时器跑完，没有再产生任何输出——说明被取消的 enter 的 setTimeout 虽然还在跑，' +
  '但 done() 再被调用时 enterCbKey 已经是 undefined，done 的闭包里 called 标记已经 true，不会重复触发')
