/**
 * 运行：pnpm ex chapters/10-builtin-components/examples/04-async-component-states.ts
 * 演示：defineAsyncComponent 包装出来的 AsyncComponentWrapper 在 delay/loading/error/timeout/retry
 *      之间的状态迁移，以及它和 Suspense 搭配时行为上的差异
 * 看点：① 没有 Suspense 时，wrapper 自己用 loaded/error/delayed 三个 ref 驱动 render，
 *        在 delay 时间内先什么都不渲染，过了 delay 才显示 loadingComponent
 *      ② timeout 比 loader 先到就会报错并渲染 errorComponent，即使 loader 最终会成功
 *      ③ onError 的 retry()/fail() 回调可以手动控制重试或改判为失败
 *      ④ 放进 Suspense 且 suspensible!==false 时，wrapper 直接 return load().then(...)，
 *        loading/error/delay 这套状态机完全不会跑，统一交给 Suspense 的 fallback
 */
import {
  Suspense,
  defineAsyncComponent,
  defineComponent,
  h,
  nextTick,
} from '@vue/runtime-core'
import { createRoot, render, serialize } from '../../../shared/logging-renderer'
import { log, section, sleep, step } from '../../../shared/print'

function makeLoader(opts: { delay: number; fail?: boolean; name?: string }) {
  const name = opts.name ?? 'RemoteComp'
  return () =>
    new Promise<any>((resolve, reject) => {
      setTimeout(() => {
        if (opts.fail) {
          reject(new Error(`${name} 加载失败`))
        } else {
          resolve(
            defineComponent({
              name,
              render: () => h('div', { class: name }, `${name} 加载完成`),
            }),
          )
        }
      }, opts.delay)
    })
}

// ====================================================================
// 1. 正常流程：delay -> loading -> 成功
// ====================================================================
section('1. delay=20ms, loader 50ms 完成：先空白，再 loading，再真实内容')

const Comp1 = defineAsyncComponent({
  loader: makeLoader({ delay: 50, name: 'Comp1' }),
  loadingComponent: defineComponent({ render: () => h('div', null, '[loading Comp1...]') }),
  delay: 20,
})

const root1 = createRoot()
render(h(Comp1), root1)
log('t=0ms（delay 窗口内，三个 ref 都是初始值，render 返回 undefined -> 空）:', JSON.stringify(serialize(root1)))

await sleep(30)
await nextTick()
log('t=30ms（超过 delay=20ms，还没到 50ms，显示 loadingComponent）:', serialize(root1))

await sleep(40)
await nextTick()
log('t=70ms（loader 的 50ms 已完成，显示真实组件）:', serialize(root1))

// ====================================================================
// 2. timeout 比 loader 先到：报错并渲染 errorComponent
// ====================================================================
section('2. timeout=30ms < loader 80ms：会先报超时错误，哪怕 loader 最终能成功')

const Comp2 = defineAsyncComponent({
  loader: makeLoader({ delay: 80, name: 'Comp2' }),
  errorComponent: defineComponent({
    props: ['error'],
    render(this: any) {
      return h('div', { class: 'error' }, `加载出错：${this.error.message}`)
    },
  }),
  timeout: 30,
})

const root2 = createRoot()
render(h(Comp2), root2)
await sleep(50)
await nextTick()
log('t=50ms（已超过 timeout=30ms，errorComponent 顶替上场）:', serialize(root2))

// ====================================================================
// 3. onError 的 retry()：第一次失败，用户选择重试，第二次成功
// ====================================================================
section('3. onError(err, retry, fail, attempts)：第一次失败后手动 retry')

let attemptCount = 0
const flakyLoader = () =>
  new Promise<any>((resolve, reject) => {
    attemptCount++
    const thisAttempt = attemptCount
    setTimeout(() => {
      if (thisAttempt === 1) {
        reject(new Error('第一次网络抖动'))
      } else {
        resolve(defineComponent({ render: () => h('div', null, `第 ${thisAttempt} 次尝试成功`) }))
      }
    }, 20)
  })

const Comp3 = defineAsyncComponent({
  loader: flakyLoader,
  onError(err, retry, fail, attempts) {
    log(`[onError] 第 ${attempts} 次失败：${err.message}`)
    if (attempts <= 2) {
      step('自动调用 retry()')
      retry()
    } else {
      fail()
    }
  },
})

const root3 = createRoot()
render(h(Comp3), root3)
await sleep(60)
await nextTick()
log('最终 HTML:', serialize(root3))
log('loader 总共被调用次数 =', attemptCount)

// ====================================================================
// 4. 和 Suspense 搭配：loading/delay/error 状态机完全不跑，统一走 fallback
// ====================================================================
section('4. 放进 <Suspense>：wrapper 的 setup() 直接 return load().then(...)')

const Comp4 = defineAsyncComponent({
  loader: makeLoader({ delay: 50, name: 'Comp4' }),
  // 即使写了 loadingComponent，在 Suspense 环境下也完全用不上（除非 suspensible: false）
  loadingComponent: defineComponent({ render: () => h('div', null, '[这个 loading 不会被用到]') }),
  delay: 0,
})

const root4 = createRoot()
const App4 = defineComponent({
  render() {
    return h(Suspense, null, {
      default: () => h(Comp4),
      fallback: () => h('div', null, 'Suspense fallback（不是 Comp4 自己的 loadingComponent）'),
    })
  },
})
render(h(App4), root4)
log('mount 后（Comp4 的 setup() 返回了 promise，Suspense 立刻接管显示 fallback）:', serialize(root4))

await sleep(60)
await nextTick()
log('resolve 后:', serialize(root4))
