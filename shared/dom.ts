/**
 * 在 Node 里造一个真实可用的 DOM（happy-dom），让 @vue/runtime-dom 的示例不用开浏览器也能跑。
 *
 * 注意：runtime-dom 在模块初始化时就会读取全局 `document`（见 packages/runtime-dom/src/nodeOps.ts 顶部
 * `const doc = (typeof document !== 'undefined' ? document : null)`），所以必须 **先** 调用 setupDOM()，
 * **再** 动态 import vue：
 *
 *   import { setupDOM } from '../../../shared/dom'
 *   const { document } = setupDOM('<div id="app"></div>')
 *   const { createApp, h } = await import('vue')      // 动态 import，保证在 setupDOM 之后执行
 */
import { Window } from 'happy-dom'

export function setupDOM(bodyHTML = '<div id="app"></div>') {
  const window = new Window({ url: 'http://localhost/' })
  const document = window.document
  document.body.innerHTML = bodyHTML
  const g = globalThis as any
  g.window = window
  g.document = document
  for (const k of [
    'HTMLElement', 'SVGElement', 'Element', 'Node', 'Text', 'Comment', 'Event', 'CustomEvent',
    'MouseEvent', 'KeyboardEvent', 'InputEvent', 'DocumentFragment', 'HTMLInputElement',
    'HTMLSelectElement', 'HTMLTextAreaElement', 'MutationObserver', 'getComputedStyle',
    'requestAnimationFrame', 'cancelAnimationFrame', 'navigator', 'customElements', 'CSSStyleSheet',
  ]) {
    if ((window as any)[k] !== undefined && g[k] === undefined) {
      const v = (window as any)[k]
      g[k] = typeof v === 'function' && !/^[A-Z]/.test(k) ? v.bind(window) : v
    }
  }
  // 运行时这就是 happy-dom 的 Document，但 happy-dom 自带的 TS 类型和 lib.dom.d.ts 的
  // 全局 Document/Element 结构上并不完全一致（字段集合不同）。setupDOM() 存在的意义就是让
  // 调用方能像在浏览器里一样用全局 DOM 类型写代码（包括把 document.createElement(...) 的
  // 结果传给 @vue/runtime-dom 的 app.mount()，它的参数类型是 lib.dom.d.ts 的 Element），
  // 所以这里按「调用方看到的应该是标准 DOM 类型」把 document 转成全局 Document 类型。
  return { window, document: document as unknown as Document }
}
