/**
 * 运行：pnpm ex chapters/14-runtime-dom/examples/02-event-invoker.ts
 * 演示：patchEvent 用一个 invoker 包一层再 addEventListener，多次更新 handler 时
 *      只替换 invoker.value，不会重新 add/removeEventListener；invoker.attached
 *      时间戳守卫如何过滤「挂载前就已经在冒泡途中」的事件；Once/Capture/Passive
 *      修饰符的解析；数组形式的多 handler。
 * 看点：用 monkeypatch el.addEventListener / removeEventListener 统计调用次数，
 *      证明「handler 从 fn1 换成 fn2」时不会重新 add/remove；并手动伪造 event._vts
 *      复现 vuejs/vue#6566 的时间戳守卫。
 */
import { setupDOM } from '../../../shared/dom'
import { section, step, log, expectEq, sleep } from '../../../shared/print'

const { window } = setupDOM('<div id="app"></div>')
const { h, render } = await import('vue')

const container = document.getElementById('app')!

// 坑：Node 18+ 自带全局 Event/CustomEvent（WHATWG 标准的一部分），
// 和 happy-dom 内部用的 Event 不是同一个类。happy-dom 的 dispatchEvent 在 capture
// 阶段会依赖它自己 Event 实现上的内部状态，用全局 `new DomEvent(...)` 构造的事件对象
// 在 target/bubble 阶段能触发监听器，但 capture 阶段的监听器完全不会被调用。
// 所以这里统一用 window.Event / window.CustomEvent（来自 setupDOM 返回的 happy-dom window）。
const DomEvent = window.Event as unknown as typeof Event
const DomCustomEvent = window.CustomEvent as unknown as typeof CustomEvent

section('1. 同一个事件多次更新 handler：addEventListener 只调用一次')
{
  let calledWith = ''
  const handler1 = () => (calledWith = 'handler1')
  const handler2 = () => (calledWith = 'handler2')
  const handler3 = () => (calledWith = 'handler3')

  step('第一次 render：onClick = handler1（真正 addEventListener 发生在这里）')
  render(h('button', { onClick: handler1 }, 'btn'), container)
  const btn = container.querySelector('button')!

  // 挂载完成后再 monkeypatch，专门统计「更新阶段」是否还会调用 add/removeEventListener
  let addCount = 0
  let removeCount = 0
  const originalAdd = btn.addEventListener.bind(btn)
  const originalRemove = btn.removeEventListener.bind(btn)
  ;(btn as any).addEventListener = (...args: any[]) => {
    addCount++
    return originalAdd(...(args as [any, any, any]))
  }
  ;(btn as any).removeEventListener = (...args: any[]) => {
    removeCount++
    return originalRemove(...(args as [any, any, any]))
  }

  step('更新 onClick = handler2（vnode.type 不变，patch 复用同一个 <button>）')
  render(h('button', { onClick: handler2 }, 'btn'), container)
  step('再更新 onClick = handler3')
  render(h('button', { onClick: handler3 }, 'btn'), container)

  log('这两次更新期间 addEventListener 调用次数 =', addCount, '；removeEventListener 调用次数 =', removeCount)
  expectEq('两次更新均未重新 add/remove', { add: addCount, remove: removeCount }, { add: 0, remove: 0 })

  step('等待 5ms 后派发一次 click（跨过 invoker.attached 的时间戳），验证生效的是最新 handler3')
  await sleep(5)
  btn.dispatchEvent(new DomEvent('click'))
  expectEq('事件触发的是最新 handler', calledWith, 'handler3')
  log('')
  log('原理（packages/runtime-dom/src/modules/events.ts#L36-L67）：')
  log('patchEvent 第一次挂载时才 addEventListener(el, name, invoker)，之后只做 invokers[rawName].value = nextValue')
  log('invoker 本身是一个长期存活的闭包，value 可以随时换，不需要向浏览器重新注册监听器')
}

render(null, container) // 卸载上一节的 button，避免跨 section 复用同一个 DOM 节点造成干扰

section('2. invoker.attached 时间戳守卫：过滤挂载前就已经触发的事件')
{
  // events.ts#L88-L116：
  //   - getNow() 把同一 tick 内的 Date.now() 缓存成 cachedNow，下一个微任务才清零
  //   - createInvoker 里 invoker.attached = getNow()
  //   - 真正触发时：事件对象第一次被 Vue 处理会打上 e._vts = Date.now()；
  //     之后只要 e._vts <= invoker.attached 就直接 return，不执行用户 handler
  // 这是在修 vuejs/vue#6566：内层元素的 click 在冒泡过程中，可能导致父元素身上
  // "本次 patch 刚挂上去的" handler 被这一次冒泡误触发；用「挂载时间戳 > 事件产生时间戳才放行」来解决。
  let clicked = 0
  render(h('button', { onClick: () => clicked++ }, 'guarded'), container)
  const btn = container.querySelector('button')!

  step('伪造一个 "挂载之前就已产生" 的事件：_vts 设为很早的时间戳')
  const staleEvent = new DomEvent('click') as Event & { _vts?: number }
  staleEvent._vts = 1 // 远早于 invoker.attached
  btn.dispatchEvent(staleEvent)
  log('伪造 stale 事件后 clicked =', clicked)
  expectEq('stale 事件被时间戳守卫拦截', clicked, 0)

  step('等待 5ms 后派发一个正常事件（没有预置 _vts，由 invoker 内部现场打上 Date.now()）')
  await sleep(5)
  btn.dispatchEvent(new DomEvent('click'))
  log('正常事件触发后 clicked =', clicked)
  expectEq('正常事件照常触发 handler', clicked, 1)
}

render(null, container)

section('3. 事件名里的 Once / Capture / Passive 修饰符解析（parseName）')
{
  // events.ts#L70-L86：optionsModifierRE = /(Once|Passive|Capture)$/，从右往左剥
  // 这些 key 由编译器根据 @click.once.capture 生成，这里手写等价的 h() 调用
  let clicked = 0
  render(
    h('button', { onClickOnceCapture: () => clicked++ }, 'once-capture'),
    container,
  )
  const btn = container.querySelector('button')!
  step('onClickOnceCapture -> addEventListener("click", invoker, { once: true, capture: true })')
  await sleep(5)
  btn.dispatchEvent(new DomEvent('click', { bubbles: true }))
  btn.dispatchEvent(new DomEvent('click', { bubbles: true }))
  log('触发两次 click，实际调用次数 =', clicked)
  expectEq('once 修饰符生效，只触发一次', clicked, 1)
}

render(null, container)

section('4. 数组形式的 handler：依次调用，支持 stopImmediatePropagation 提前终止')
{
  // events.ts#L117-L139：value 是数组时，invoker 会劫持 e.stopImmediatePropagation，
  // 调用后打一个 _stopped 标记，后续 handler 不再执行
  const calls: string[] = []
  const h1 = (e: Event) => {
    calls.push('h1')
    e.stopImmediatePropagation()
  }
  const h2 = () => calls.push('h2')
  render(h('button', { onClick: [h1, h2] }, 'multi'), container)
  const btn = container.querySelector('button')!
  step('onClick = [h1, h2]，h1 内部调用 stopImmediatePropagation')
  await sleep(5)
  btn.dispatchEvent(new DomEvent('click'))
  log('实际执行的 handler 顺序 =', calls)
  expectEq('h2 被 h1 的 stopImmediatePropagation 跳过', calls, ['h1'])
}

render(null, container)

section('5. 不写 Once/Capture/Passive 时 parseName 的默认行为')
{
  // events.ts#L84：name[2] === ':' 走 onXxx:bar 透传事件名，否则 hyphenate(name.slice(2))
  // 普通 onMyCustomEvent -> my-custom-event
  let payload: unknown
  render(h('div', { onMyCustomEvent: (p: unknown) => (payload = p) } as any), container)
  const div = container.querySelector('div')!
  step('onMyCustomEvent 被 hyphenate 成 "my-custom-event"')
  await sleep(5)
  div.dispatchEvent(new DomCustomEvent('my-custom-event', { detail: 42 }))
  log('payload.detail =', (payload as CustomEvent).detail)
}
