/**
 * 运行：pnpm ex chapters/14-runtime-dom/examples/06-mount-flow.ts
 * 演示：createApp().mount() 对容器的处理：选择器字符串 vs 元素对象、
 *      挂载时清空 container 内容、挂载后设置 data-v-app、移除 v-cloak、
 *      unmount 之后容器恢复「空」状态。
 * 看点：runtime-dom/src/index.ts 里 app.mount 是对 runtime-core 的 mount 的一层包装，
 *      这层包装只负责「DOM 容器相关」的事，和组件挂载本身无关。
 */
import { setupDOM } from '../../../shared/dom'
import { section, step, log, expectEq } from '../../../shared/print'

const { document } = setupDOM(
  '<div id="app" v-cloak><p>server-rendered or placeholder content</p></div>',
)
const { createApp, h } = await import('vue')

section('1. 用选择器字符串挂载：normalizeContainer 内部 document.querySelector')
{
  // index.ts#L234-L245：normalizeContainer 对字符串调用 document.querySelector
  const app = createApp({ render: () => h('span', 'hello') })
  step('createApp(...).mount("#app")')
  app.mount('#app')
  const el = document.getElementById('app')!
  log('el.innerHTML =', el.innerHTML)
  log('el.getAttribute("data-v-app") =', el.getAttribute('data-v-app'))
  log('el.getAttribute("v-cloak") =', el.getAttribute('v-cloak'))
  expectEq('data-v-app 被加上', el.hasAttribute('data-v-app'), true)
  expectEq('v-cloak 被移除', el.hasAttribute('v-cloak'), false)
  app.unmount()
}

section('2. 挂载前会清空容器原有内容（SSR 占位符/手写 HTML 都会被清掉）')
{
  // index.ts#L139-L142：container.nodeType === 1 时 container.textContent = ''
  // 注意：这发生在「拿到 container.innerHTML 作为 template」之后（如果组件没有 render/template），
  // 所以不会清空「从容器读 template」这个能力，只是清空完再 patch 真正的 vnode 树进去
  const el = document.createElement('div')
  el.innerHTML = '<p>will be wiped</p>'
  document.body.appendChild(el)
  step('mount 前 el.innerHTML =')
  log(el.innerHTML)

  const app = createApp({ render: () => h('span', 'new content') })
  app.mount(el)
  step('mount 后 el.innerHTML =')
  log(el.innerHTML)
  expectEq('原有占位内容被替换', el.innerHTML.includes('new content'), true)
  expectEq('旧内容已不在', el.innerHTML.includes('will be wiped'), false)
  app.unmount()
}

section('3. 没有 render/template 时，组件的 template 来自 container.innerHTML（运行时编译版）')
{
  // index.ts#L117-L124：
  //   if (!isFunction(component) && !component.render && !component.template) {
  //     component.template = container.innerHTML
  //   }
  // 这是 "In-DOM Template" 用法：<div id="app">{{ msg }}</div> + new Vue({ data... }).mount('#app')
  const el = document.createElement('div')
  el.innerHTML = '{{ 1 + 1 }}'
  document.body.appendChild(el)
  step('容器内写的是 "{{ 1 + 1 }}"，组件本身没有 render/template')
  const app = createApp({ data: () => ({}) } as any)
  app.mount(el)
  log('挂载后 el.innerHTML =', el.innerHTML)
  expectEq('runtime-compiler 把 container.innerHTML 当成 template 编译执行', el.innerHTML.trim(), '2')
  app.unmount()
}

section('4. unmount 后容器变回空')
{
  // apiCreateApp.ts 里 app.unmount() 最终调用 render(null, container)，
  // render(null, ...) 会走 unmount 流程，把子树全部移除
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = createApp({ render: () => h('div', 'temp') })
  app.mount(el)
  step('mount 后 el.innerHTML =')
  log(el.innerHTML)
  app.unmount()
  step('unmount 后 el.innerHTML =')
  log(JSON.stringify(el.innerHTML))
  expectEq('容器变回空', el.innerHTML, '')
  // 但 data-v-app 这个 attribute 是 mount 包装逻辑自己加的，unmount 不负责清理它
  log('unmount 不会移除 data-v-app（这是 app.mount 包装自己加的标记，和 render(null) 的职责无关）：', el.hasAttribute('data-v-app'))
}

section('5. mount 到一个不存在的选择器：返回 undefined 并在 dev 模式下 warn')
{
  const app = createApp({ render: () => h('div', 'x') })
  step('createApp(...).mount("#not-exist")')
  const result = app.mount('#not-exist' as any)
  log('mount 返回值 =', result)
  expectEq('mount 失败时返回 undefined', result, undefined)
}
