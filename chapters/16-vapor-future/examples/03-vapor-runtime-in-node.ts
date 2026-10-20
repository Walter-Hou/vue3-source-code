/**
 * 运行：pnpm ex chapters/16-vapor-future/examples/03-vapor-runtime-in-node.ts
 * 演示：用 happy-dom 在 Node 里真正跑起来一个 Vapor 组件——
 *   `<script setup vapor>` 编译 -> createVaporApp 挂载 -> DOM 输出 -> 点击触发响应式更新，
 *   全程不经过任何 VNode。
 * 看点：
 *   1. compiler-sfc（3.6.0-rc.12）支持 `<script setup vapor>`：compileScript 检测到
 *      vapor 属性后，把 compileTemplate() 的产物（Vapor 版，不是 vnode 版）直接内联进
 *      setup()，和模板表达式共享同一个作用域——msg/inc 都是 setup() 里的真实局部变量，
 *      不需要任何 `_ctx.`/`$setup.` 间接层
 *   2. 生成的组件对象多了 `__vapor: true` 这个标记，`createVaporApp(comp).mount(sel)`
 *      走的是 @vue/runtime-vapor 的挂载路径，不创建任何 vnode
 *   3. DOM 更新是 `_renderEffect` 直接调用 `_setText` 做的，点击之后立刻能在
 *      container.innerHTML 里看到新文本，不存在"下一轮渲染"这个概念
 *
 * 环境注意（如实记录，不是 Vapor 本身的问题）：
 *   3.6.0-rc.12 的 @vue/runtime-vapor、@vue/runtime-core、@vue/runtime-dom、
 *   @vue/reactivity、@vue/shared 这几个包的 package.json#exports 把 "node" 条件
 *   写在了 "import"/"require" 的同级而不是嵌套在其中；"node" 分支下只有
 *   production/development/default 三个子条件，全部指向通过
 *   `process.env.NODE_ENV` 条件 require 的 CJS 文件。Node 的 ESM 解析只要 "node"
 *   条件匹配（在 Node.js 环境里永远匹配）就会直接选用这个分支，于是不管 import()
 *   还是 require()，这些包最终都解析到那个"条件 require"的 index.js，而 Node 的
 *   CJS/ESM 互操作（cjs-module-lexer）没法静态分析出其具名导出，报
 *   "does not provide an export named 'xxx'"。这是 rc 阶段的打包问题（3.5.44 稳定版
 *   没有这个问题），用同目录下 `_vapor-resolve-loader.mjs` 这个模块解析 hook 绕过——
 *   它只是把 "@vue/*" 的裸 import 重定向到各包 package.json 里 "module" 字段指向的
 *   esm-bundler 产物（纯 ESM 语法，没有条件 require，具名导出不存在歧义），
 *   不修改项目任何 package.json。待 3.6 正式版确认这个问题是否已修复。
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { section, step, log } from '../../../shared/print'

register(
  pathToFileURL('./chapters/16-vapor-future/examples/_vapor-resolve-loader.mjs').href,
  pathToFileURL('./').href,
)

import { setupDOM } from '../../../shared/dom'
setupDOM('<div id="app"></div>')
// 3.6 的 esm-bundler 构建期望这些 tree-shaking 用的编译期标志被打包工具注入；
// 这里手动挂上去，只是为了消除一条和本章内容无关的控制台噪音
Object.assign(globalThis, {
  __VUE_OPTIONS_API__: true,
  __VUE_PROD_DEVTOOLS__: false,
  __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
})

const require = createRequire(import.meta.url)
const vueNextPkgPath = require.resolve('vue-next/package.json')
const req2 = createRequire(vueNextPkgPath)
const compilerSfcPath = req2.resolve('@vue/compiler-sfc')
const csfc = await import(compilerSfcPath)

section('1. 编译 <script setup vapor>（真实调用 3.6.0-rc.12 的 compileScript）')
const SFC_SOURCE = `
<script setup vapor>
import { ref } from 'vue'
const msg = ref('hello vapor')
function inc() {
  msg.value += '!'
}
</script>
<template>
  <div>
    <p>{{ msg }}</p>
    <button id="btn" @click="inc">+1</button>
  </div>
</template>
`.trim()
log(SFC_SOURCE)

const { descriptor, errors } = csfc.parse(SFC_SOURCE, { filename: 'VaporDemo.vue' })
step('parse 结果：descriptor.vapor 标记')
log('errors =', errors, '| descriptor.vapor =', descriptor.vapor)

const compiled = csfc.compileScript(descriptor, {
  id: 'vapor-demo',
  inlineTemplate: true,
})
step('compileScript 产物：注意 __vapor: true，以及 msg/inc 都是裸标识符（直接用 setup 作用域）')
log(compiled.content)

section('2. 实例化并挂载：createVaporApp(comp).mount()')
// 编译产物用 import/export 语法，不能直接塞进 new Function()；
// 写成一个真实的 .mjs 文件再 import() 是对它最忠实的"实例化"方式。
const scratchDir = join(process.cwd(), '.vapor-scratch')
mkdirSync(scratchDir, { recursive: true })
const componentFile = join(scratchDir, 'component.mjs')
writeFileSync(componentFile, compiled.content)

try {
  const component = (await import(pathToFileURL(componentFile).href + '?t=' + Date.now())).default
  const { createVaporApp } = await import(req2.resolve('@vue/runtime-vapor'))

  const app = createVaporApp(component)
  app.mount('#app')

  step('mount 后的真实 DOM（没有任何 VNode 参与）')
  log(document.querySelector('#app')!.innerHTML)

  step('点击按钮，观察 DOM 直接被 _renderEffect/_setText 更新')
  document
    .querySelector('#btn')!
    .dispatchEvent(new (globalThis as any).MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 0))
  log(document.querySelector('#app')!.innerHTML)

  log(
    '\n=> 这次更新完全没有经过 createVNode/patch/diff：msg 的 ref 被读取时，' +
      '编译产物里的 `_renderEffect(() => _setText(x0, _toDisplayString(msg.value)))` ' +
      '这个独立的 effect 订阅了它；msg.value 变化直接重跑这个 effect，调用 _setText ' +
      '改写那一个文本节点，其余 DOM（包括 button 本身）完全不受影响。',
  )
} catch (err) {
  log('本次运行未能完整跑通 Vapor 挂载，如实记录现象与原因：')
  log(String((err as Error)?.stack || err))
  log(
    '\n退而求其次：上面第 1 节的编译产物已经完整展示了 Vapor 的核心设计——' +
      '模板表达式直接闭包访问 setup 作用域变量、运行时操作全部是具体的 DOM 原语调用，' +
      '这是本章想传达的关键信息，运行时验证只是锦上添花。',
  )
} finally {
  rmSync(scratchDir, { recursive: true, force: true })
}
