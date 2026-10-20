/**
 * 运行：pnpm ex chapters/15-ssr-hydration/examples/04-hydration-happy-dom.ts
 * 演示：用 happy-dom 在 Node 里模拟"服务端渲染好的 HTML 已经在页面上"，
 *   然后 createSSRApp().mount() 走 hydrate 路径，观察：
 *   1. DOM 节点是否被复用（而不是被销毁重建）
 *   2. 事件在 hydrate 之后能不能正常触发
 *   3. 三种 mismatch（文本/class/节点类型）各自的处理方式有什么不同
 *   4. data-allow-mismatch 只能消音警告，不能阻止"文本会被纠正"这件事
 *
 * 必须先 setupDOM() 再动态 import('vue')，原因见 shared/dom.ts 顶部注释：
 * runtime-dom 的 nodeOps.ts 在模块初始化时就读取全局 document。
 */
import { setupDOM } from '../../../shared/dom'
import { section, step, log } from '../../../shared/print'

setupDOM('<div id="app"></div>')
const { createSSRApp, h, defineComponent, ref } = await import('vue')
const { renderToString } = await import('@vue/server-renderer')

/** 每个小节都要一个"全新"的容器——否则复用同一个 DOM 节点会触发
 * "already an app instance mounted" 的警告，干扰我们要观察的 mismatch 警告 */
function freshContainer(html: string): Element {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

async function captureWarnings(fn: () => void | Promise<void>): Promise<string[]> {
  const warnings: string[] = []
  const orig = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  try {
    await fn()
  } finally {
    console.warn = orig
  }
  return warnings
}

section('1. hydrate 之后 DOM 节点不会被重建，事件和响应式更新照常工作')
{
  const App = defineComponent({
    setup() {
      const count = ref(0)
      return { count }
    },
    render() {
      return h('div', [
        h('p', { id: 'count-p' }, `count: ${this.count}`),
        h('button', { id: 'btn', onClick: () => this.count++ }, 'inc'),
      ])
    },
  })

  const html = await renderToString(createSSRApp(App))
  step('先用 renderToString 产出 HTML，模拟"服务端已经吐出的页面"')
  log(html)

  const container = document.querySelector('#app')!
  container.innerHTML = html
  const pBefore = container.querySelector('#count-p')
  const btnBefore = container.querySelector('#btn')

  step('createSSRApp(App).mount(container) —— 走 hydrate 而不是 render')
  const app = createSSRApp(App)
  app.mount(container as any)

  const pAfter = container.querySelector('#count-p')
  const btnAfter = container.querySelector('#btn')
  log('p 节点引用未变:', pBefore === pAfter)
  log('button 节点引用未变:', btnBefore === btnAfter)

  step('触发 click 事件，验证事件监听确实挂上了，且后续更新正常 patch')
  ;(btnAfter as any).dispatchEvent(new (globalThis as any).MouseEvent('click', { bubbles: true }))
  await Promise.resolve()
  log('点击后 p 的文本:', (pAfter as any).textContent)
}

section('2. 文本 mismatch：会被警告，且自动纠正为客户端的值')
{
  const container = freshContainer('<p>server text</p>')
  const App = defineComponent({
    render() {
      return h('p', 'client text')
    },
  })
  const p = container.querySelector('p')
  const warnings = await captureWarnings(() => {
    createSSRApp(App).mount(container as any)
  })
  log('警告条数:', warnings.length)
  warnings.forEach(w => log(w))
  log('纠正之后的文本:', (p as any).textContent)
}

section('3. class/style/attribute mismatch：只警告，不纠正（源码明确注释的行为）')
{
  const container = freshContainer('<p class="server-class">same text</p>')
  const App = defineComponent({
    render() {
      return h('p', { class: 'client-class' }, 'same text')
    },
  })
  const p = container.querySelector('p')
  const warnings = await captureWarnings(() => {
    createSSRApp(App).mount(container as any)
  })
  log('警告条数:', warnings.length)
  warnings.forEach(w => log(w))
  log('mount 后 DOM 上的 class（没有被改成 client-class）:', (p as any).getAttribute('class'))
  log(
    '=> hydration.ts#propHasMismatch 对 class/style/attribute 的处理只调用 warn()，' +
      '从不执行 patchProp 去覆盖它（源码注释原话："The DOM will not be rectified in ' +
      'production due to performance overhead."）——这与文本 mismatch 的"必定纠正"形成对比',
  )
}

section('4. 节点类型 mismatch：直接整体移除重建（走 handleMismatch）')
{
  const container = freshContainer('<span id="old">server span</span>')
  const App = defineComponent({
    render() {
      return h('p', { id: 'new' }, 'client p')
    },
  })
  const oldSpan = container.querySelector('#old')
  const warnings = await captureWarnings(() => {
    createSSRApp(App).mount(container as any)
  })
  log('警告条数:', warnings.length)
  warnings.forEach(w => log(w))
  log('最终 DOM:', (container as any).innerHTML)
  log('旧的 span 节点还在文档里吗:', container.contains(oldSpan as any))
  log(
    '=> hydration.ts#handleMismatch：vnode.type 和 DOM 节点完全对不上时，' +
      '直接 remove(node) + patch(null, vnode, container) 做一次全新挂载，' +
      '这是唯一会整体丢弃服务端 DOM 的 mismatch 类型',
  )
}

section('5. data-allow-mismatch：只消音警告，不改变"文本仍会被纠正"的行为')
{
  const container = freshContainer('<span data-allow-mismatch="text">server text</span>')
  const App = defineComponent({
    render() {
      return h('span', { 'data-allow-mismatch': 'text' }, 'client text')
    },
  })
  const span = container.querySelector('span')
  const warnings = await captureWarnings(() => {
    createSSRApp(App).mount(container as any)
  })
  log('警告条数（期望 0，因为声明了 data-allow-mismatch="text"）:', warnings.length)
  log('文本仍然被纠正为客户端的值:', (span as any).textContent)
  log(
    '=> isMismatchAllowed() 只影响要不要 warn()，hydrateElement 里 ' +
      '`el.textContent = vnode.children` 这行纠正代码在 TEXT_CHILDREN 分支里是无条件执行的',
  )
}
