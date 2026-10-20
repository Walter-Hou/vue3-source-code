/**
 * 运行：pnpm ex chapters/15-ssr-hydration/examples/05-lazy-hydration.ts
 * 演示：3.5 的 lazy hydration —— defineAsyncComponent({ hydrate: hydrateOnInteraction('click') })
 *   让一个异步组件的"水合"延迟到用户真正跟它交互的那一刻，而不是页面一加载就做。
 * 看点：
 *   1. SSR 输出的 HTML 里，懒水合组件的内容已经是完整的（用户能看到），
 *      但 mount() 之后它的 setup() 并没有立刻执行——组件还"没活"
 *   2. 交互（这里用 click）触发之前，点击不会被 Vue 的事件系统处理
 *   3. 一旦触发 hydrate，Vue 会把"引发水合的那次事件"重新 dispatch 一遍，
 *      所以用户第一次点击不会被吞掉——水合 + 响应这次点击一次性完成
 *   4. happy-dom 没有 IntersectionObserver，所以 hydrateOnVisible 这个策略
 *      在这个环境跑不了；本例改用 hydrateOnInteraction，并如实说明原因
 */
import { setupDOM } from '../../../shared/dom'
import { section, step, log } from '../../../shared/print'

setupDOM('<div id="app"></div>')
const { createSSRApp, h, defineComponent, defineAsyncComponent, hydrateOnInteraction, ref } =
  await import('vue')
const { renderToString } = await import('@vue/server-renderer')

// 用工厂函数而不是模块级单例，模拟"服务端一次渲染、客户端另一次渲染"这两个
// 相对独立的过程（真实项目里它们是两个不同的 Node/浏览器进程）
function makeApp(onSetup: () => void) {
  const LazyChild = defineAsyncComponent({
    loader: () =>
      Promise.resolve(
        defineComponent({
          name: 'LazyChild',
          setup() {
            onSetup()
            const clicks = ref(0)
            return { clicks }
          },
          render() {
            return h(
              'button',
              { id: 'lazy-btn', onClick: () => this.clicks++ },
              `clicks: ${this.clicks}`,
            )
          },
        }),
      ),
    // happy-dom 不支持 IntersectionObserver，hydrateOnVisible 在这个环境跑不起来；
    // hydrateOnInteraction 只依赖 addEventListener，happy-dom 原生支持
    hydrate: hydrateOnInteraction('click'),
  })
  return defineComponent({
    render() {
      return h('div', [h('span', 'static content（立刻可见）'), h(LazyChild)])
    },
  })
}

section('1. SSR 输出：懒水合组件的内容已经是完整 HTML')
let serverSetupCalls = 0
const html = await renderToString(createSSRApp(makeApp(() => serverSetupCalls++)))
log(html)
log('serverSetupCalls =', serverSetupCalls, '（SSR 渲染时组件必须真正 setup 一次才能产出 HTML）')

section('2. 客户端 mount：hydrate 不会立刻对 LazyChild 生效')
const container = document.querySelector('#app')!
container.innerHTML = html
let clientSetupCalls = 0
const app = createSSRApp(makeApp(() => clientSetupCalls++))
app.mount(container as any)
// 注意：__asyncHydrate 在异步组件 resolve 之后才会调用 hydrateStrategy() 去挂监听器
// （loader() 本身是个 Promise，哪怕立刻 resolve 也要走若干次微任务），
// 用一次宏任务延迟确保"注册交互监听器"这一步已经完成，再继续往下演示
await new Promise(r => setTimeout(r, 10))

step('mount 后立刻检查：LazyChild 的 setup() 还没跑')
log('clientSetupCalls =', clientSetupCalls, '（期望 0）')
log(
  '=> apiAsyncComponent.ts#__asyncHydrate：异步组件 resolve 后，如果提供了 hydrate 策略，' +
    '不会直接调用 hydrate()，而是先调用 hydrateStrategy(performHydrate, forEachElement)，' +
    '策略自己决定什么时候真正调用 performHydrate()',
)

section('3. 交互前：点击不会被 Vue 处理（因为组件实例还不存在）')
const btn = container.querySelector('#lazy-btn')!
log('水合前按钮文本:', (btn as any).textContent)
log('（这个按钮现在只是纯 DOM，上面没有 Vue 绑定的任何事件监听）')

section('4. 第一次点击：触发 hydrateOnInteraction，完成水合，并重放这次点击')
;(btn as any).dispatchEvent(new (globalThis as any).MouseEvent('click', { bubbles: true }))
await new Promise(r => setTimeout(r, 10))
log('clientSetupCalls =', clientSetupCalls, '（期望 1，水合真正发生了）')
log('按钮文本:', (document.querySelector('#lazy-btn') as any).textContent)
log(
  '=> hydrationStrategies.ts#hydrateOnInteraction：addEventListener(type, doHydrate, { once: true })，' +
    '事件触发后立刻 teardown() 移除这个临时监听，调用 hydrate()，' +
    '然后 `e.target!.dispatchEvent(new (e.constructor as any)(e.type, e))` 把原始事件重新派发一次——' +
    '这时候真正的 Vue 事件监听已经挂好了，所以这次"重放"的点击会被组件的 onClick 处理到，' +
    'clicks 从 0 变成 1，用户不会感觉到"点了一下没反应"',
)

section('5. 第二次点击：组件已经是普通的响应式组件了')
;(document.querySelector('#lazy-btn') as any).dispatchEvent(
  new (globalThis as any).MouseEvent('click', { bubbles: true }),
)
await new Promise(r => setTimeout(r, 10))
log('按钮文本:', (document.querySelector('#lazy-btn') as any).textContent)
log('clientSetupCalls 仍然是', clientSetupCalls, '（水合只发生一次，之后就是普通的 Vue 组件更新）')
