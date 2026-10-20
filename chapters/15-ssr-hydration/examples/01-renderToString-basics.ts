/**
 * 运行：pnpm ex chapters/15-ssr-hydration/examples/01-renderToString-basics.ts
 * 演示：`renderToString()` 把一棵 vnode 树渲染成 HTML 字符串，覆盖元素/文本转义/
 *   布尔属性/注释/Fragment 锚点/异步组件/Teleport 几种典型场景。
 * 看点：
 *   1. 文本自动 HTML 转义（escapeHtml），但不会对已经写好的标签做二次转义
 *   2. `<input type="checkbox" checked>` 这种布尔属性只输出属性名，不输出 `="true"`
 *   3. 一个数组子节点（多个根同级节点）会被包一层 `<!--[-->...<!--]-->` 注释锚点，
 *      这是 hydration 阶段用来定位 Fragment 边界的关键标记（第 15.2 节细讲）
 *   4. 组件的 async setup() 不会阻塞 renderToString 的返回值——它只是让整个
 *      渲染过程变成要 await 的 Promise 链，内容仍然按原来的顺序输出
 *   5. <Teleport> 的内容不会出现在主 HTML 里，而是收集进 `ssrContext.teleports`，
 *      按目标选择器分组，交给调用方自己决定怎么拼进最终页面
 */
import { createSSRApp, h, defineComponent, ref, Comment, Teleport } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { section, step, log } from '../../../shared/print'

const Child = defineComponent({
  name: 'Child',
  props: { n: Number },
  render() {
    return h('span', `child-${this.n}`)
  },
})

section('1. 元素 / 文本转义 / 布尔属性 / 注释 / 隐式 Fragment')
const App1 = defineComponent({
  setup() {
    return { show: ref(true) }
  },
  render() {
    return h('div', { id: 'app', class: ['a', { b: true }] }, [
      h('p', 'hello & <world>'), // 文本会被转义
      h(Child, { n: 1 }),
      h(Comment, 'a real comment'),
      h('input', { type: 'checkbox', checked: true }), // 布尔属性
      h('div', { style: { color: 'red' } }),
      [h(Child, { n: 2 }), h(Child, { n: 3 })], // 数组子节点 -> 隐式 Fragment
    ])
  },
})
const html1 = await renderToString(createSSRApp(App1))
log(html1)
step('解读')
log(
  [
    '"hello & <world>" 被转义成 "hello &amp; &lt;world&gt;"（helpers/ssrRenderAttrs 用的是',
    '  @vue/shared 的 escapeHtml，只转义 & < > " \' 五个字符）',
    'checked: true 渲染成裸的 `checked` 属性，不是 `checked="true"`',
    '  （render.ts 调用 ssrRenderAttrs，布尔属性走 includeBooleanAttr 判断）',
    '最后两个 Child 组成的数组被包进 <!--[--> ... <!--]--> 之间',
    '  （render.ts#L266-L279：Fragment 分支固定 push 这两个注释锚点）',
  ].join('\n'),
)

section('2. async setup() 组件：不阻塞输出顺序，只让整体渲染变成 Promise 链')
const AsyncChild = defineComponent({
  name: 'AsyncChild',
  async setup() {
    await new Promise(r => setTimeout(r, 5))
    return () => h('span', 'async-done')
  },
})
const App2 = defineComponent({
  render() {
    return h('div', [h('span', 'before'), h(AsyncChild), h('span', 'after')])
  },
})
const html2 = await renderToString(createSSRApp(App2))
log(html2)
step('解读')
log(
  '=> "before"/"async-done"/"after" 的输出顺序和模板里写的顺序完全一致，' +
    '即使 AsyncChild 的 setup() 要等 5ms 才 resolve。render.ts#renderComponentVNode ' +
    '对有 async setup 的组件返回一个 Promise<SSRBuffer>，renderToString.ts#unrollBuffer ' +
    '会按原始位置 await 这个 Promise 再拼接字符串，不会因为异步而打乱顺序（下一个示例继续深入这一点）',
)

section('3. Teleport：内容不进主文档流，进 ssrContext.teleports')
const App3 = defineComponent({
  render() {
    return h('div', [
      h('span', 'main content'),
      h(Teleport, { to: '#modal-target' }, [h('p', 'teleported content')]),
    ])
  },
})
const ctx: Record<string, any> = {}
const html3 = await renderToString(createSSRApp(App3), ctx)
log('html3 =', html3)
log('ctx.teleports =', ctx.teleports)
step('解读')
log(
  [
    '主 HTML 里 <Teleport> 原地只留下 <!--teleport start--><!--teleport end--> 两个锚点',
    'teleport 内容被单独渲染进 context.__teleportBuffers[to]，',
    'renderToString.ts#resolveTeleports 在主渲染结束后统一 await 展开，写进 context.teleports',
    '（server.ts 在真实项目里：fastify/express 处理器会把 ctx.teleports["#modal-target"]',
    ' 拼到最终 HTML 模板里 <div id="modal-target"> 占位符的位置）',
  ].join('\n'),
)
