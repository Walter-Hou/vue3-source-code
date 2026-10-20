/**
 * 运行：pnpm ex chapters/10-builtin-components/examples/03-suspense-flow.ts
 * 演示：Suspense 的 fallback -> resolve 流程、deps 计数、onPending/onFallback/onResolve 事件、
 *      suspensible 嵌套 Suspense 如何把内层的异步状态合并进外层
 * 看点：① mount 时若 deps > 0，fallback 先出现在真实容器里，真正内容先 patch 到 hiddenContainer（看不见）
 *      ② 可以直接从 vnode.suspense 读到 SuspenseBoundary 的 deps/isInFallback，全程可观察
 *      ③ suspensible:true 的嵌套 Suspense 会把自己注册成外层的一个 dep，resolve 顺序反过来传导
 *      ④ 不开 suspensible 时，内层会在外层已经 resolve 的真实 DOM 里自己再闪一次 fallback
 */
import {
  Suspense,
  type VNode,
  defineComponent,
  h,
  nextTick,
} from '@vue/runtime-core'
import { createRoot, render, serialize } from '../../../shared/logging-renderer'
import { log, section, sleep, step } from '../../../shared/print'

function asyncChild(name: string, delay: number) {
  return defineComponent({
    name,
    async setup() {
      log(`${name}.setup() 开始执行，返回一个 Promise`)
      await sleep(delay)
      log(`${name}.setup() 的 Promise resolve（延迟 ${delay}ms）`)
      return () => h('div', { class: name }, `${name} ready`)
    },
  })
}

function boundaryOf(appVNode: VNode) {
  // App 的 subTree 就是 h(Suspense, ...) 产出的 vnode，.suspense 是 createSuspenseBoundary() 的返回值
  return appVNode.component!.subTree.suspense!
}
function dump(b: ReturnType<typeof boundaryOf>, label: string) {
  log(`${label}: deps=${b.deps} isInFallback=${b.isInFallback} pendingId=${b.pendingId}`)
}

// ====================================================================
// 1. 基本流程：两个异步子组件，fallback -> 两者都 resolve 后才整体切换
// ====================================================================
section('1. 两个异步子组件：ChildA(30ms) / ChildB(80ms)')

const ChildA = asyncChild('ChildA', 30)
const ChildB = asyncChild('ChildB', 80)

const root1 = createRoot()
const App1 = defineComponent({
  render() {
    return h(
      Suspense,
      {
        onPending: () => log('[event] onPending'),
        onFallback: () => log('[event] onFallback'),
        onResolve: () => log('[event] onResolve'),
      },
      {
        default: () => h('div', [h(ChildA), h(ChildB)]),
        fallback: () => h('div', null, 'Loading...'),
      },
    )
  },
})

const appVNode1 = h(App1)
step('同步挂载：setup() 里 await 还没走完，渲染器会先看到两个 asyncDep，于是显示 fallback')
render(appVNode1, root1)
dump(boundaryOf(appVNode1), '刚 mount 完')
log('可见 HTML:', serialize(root1))

step('等 30ms：ChildA resolve，deps 1 -> 0？不对，还有 ChildB，deps 应该还剩 1')
await sleep(40)
dump(boundaryOf(appVNode1), '40ms 后（ChildA 已 resolve，ChildB 还没）')

step('再等 60ms：ChildB 也 resolve，deps 归零，suspense.resolve() 把内容从 hiddenContainer 搬到真实容器')
await sleep(60)
await nextTick()
dump(boundaryOf(appVNode1), '100ms 后')
log('可见 HTML:', serialize(root1))

// ====================================================================
// 2. suspensible 嵌套：内层把自己注册成外层的 dep，resolve 顺序反向传导
// ====================================================================
section('2. suspensible=true 的嵌套 Suspense：外层等内层，不会看到内层自己的 fallback')

const ChildC = asyncChild('ChildC', 50)
const root2 = createRoot()
const App2 = defineComponent({
  render() {
    return h(
      Suspense,
      {
        onFallback: () => log('[outer] onFallback'),
        onResolve: () => log('[outer] onResolve'),
      },
      {
        default: () =>
          h('div', [
            h('p', null, 'outer static content（本身没有异步依赖）'),
            h(
              Suspense,
              {
                suspensible: true,
                onFallback: () => log('[inner] onFallback（只是内部状态，不会显示出来）'),
                onResolve: () => log('[inner] onResolve'),
              },
              {
                default: () => h(ChildC),
                fallback: () => h('div', null, 'inner fallback（suspensible 下不会被看到）'),
              },
            ),
          ]),
        fallback: () => h('div', null, 'outer fallback'),
      },
    )
  },
})

render(h(App2), root2)
await nextTick()
log('mount 后可见 HTML（应该直接是 outer fallback，不会闪过 inner fallback）:', serialize(root2))

await sleep(70)
await nextTick()
log('ChildC resolve 后可见 HTML（outer 和 inner 一起切换为真实内容）:', serialize(root2))

// ====================================================================
// 3. 对比：不开 suspensible，内层会在外层已经可见的 DOM 里自己再闪一次 fallback
// ====================================================================
section('3. 对比：suspensible 缺省（false）—— 外层不等内层，内层自己管自己的 fallback')

const ChildD = asyncChild('ChildD', 50)
const root3 = createRoot()
const App3 = defineComponent({
  render() {
    return h(
      Suspense,
      { onResolve: () => log('[outer] onResolve（几乎立刻，因为外层自己没有异步依赖）') },
      {
        default: () =>
          h('div', [
            h('p', null, 'outer static content'),
            h(
              Suspense,
              { onResolve: () => log('[inner] onResolve') },
              {
                default: () => h(ChildD),
                fallback: () => h('div', null, 'inner fallback（这次会被真实看到）'),
              },
            ),
          ]),
        fallback: () => h('div', null, 'outer fallback'),
      },
    )
  },
})

render(h(App3), root3)
await nextTick()
log(
  'mount 后可见 HTML（outer 已经 resolve，但 inner 还在自己的 fallback 阶段）:',
  serialize(root3),
)

await sleep(70)
await nextTick()
log('ChildD resolve 后可见 HTML:', serialize(root3))
