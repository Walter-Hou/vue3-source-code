/**
 * 运行：pnpm ex chapters/11-compiler-core/examples/05-run-compiled-render.ts
 * 演示：真的把 compile() 的产物跑起来——`new Function('Vue', code)` 实例化出 render
 *       函数，把 @vue/runtime-core 当作 Vue 传进去，再用 shared/logging-renderer
 *       把 vnode 渲染成一棵假 DOM，打印宿主操作，验证"编译产物能跑，而且 patchFlag
 *       驱动的更新是精确的"。
 * 看点：
 *  1. compile() 产物里引用的全局标识符只有 `Vue`（通过 with 块里的 `const _Vue = Vue`），
 *     所以 `new Function('Vue', code)` 只需要注入这一个参数。
 *  2. 直接调用 render(_ctx, _cache) 两次（传入不同的 _ctx），再分别喂给
 *     logging-renderer 的 render(vnode, container)，可以看到 runtime-core 的
 *     patch() 真的按 patchFlag 做了"targeted update"：只 patchProp + setElementText，
 *     没有重新 createElement。
 *  3. 第 7 章讲的 renderer diff 在这里是"消费方"：它完全不知道这段代码是编译出来的，
 *     只认 vnode.patchFlag / vnode.dynamicChildren。
 */
import { compile } from '@vue/compiler-dom'
import * as Vue from '@vue/runtime-core'
import {
  createRoot,
  render as hostRender,
  serializeInner,
  printOps,
  resetOps,
} from '../../../shared/logging-renderer'
import { section, step, log } from '../../../shared/print'

function compileToRenderFn(template: string): (ctx: any, cache: any[]) => any {
  const { code } = compile(template)
  // compile() 产物形如 `const _Vue = Vue\nreturn function render(_ctx, _cache) {...}`，
  // 包一层 Function 构造器，把 Vue 作为唯一的外部依赖注入。
  return new Function('Vue', code)(Vue)
}

section('1. 编译一个带动态 class/文本的模板')
const template = `<div id="app" :class="theme">count: {{ count }}</div>`
const { code } = compile(template)
step('编译产物')
log(code)

section('2. 实例化 render 函数并首次挂载')
const render = compileToRenderFn(template)
const root = createRoot()
resetOps()
hostRender(render({ count: 0, theme: 'light' }, []), root)
step('挂载结果')
log(serializeInner(root))
printOps('mount 触发的宿主操作')

section('3. 用新的 _ctx 再 render 一次，观察 patch')
hostRender(render({ count: 1, theme: 'dark' }, []), root)
step('更新结果')
log(serializeInner(root))
printOps('update 触发的宿主操作（只应该有 patchProp(class) 和 setElementText）')

section('4. 对比：不带 patchFlag 的纯静态模板，更新时也只会重新 setElementText 一次整体 diff')
const render2 = compileToRenderFn(`<p>static</p>`)
const root2 = createRoot()
hostRender(render2({}, []), root2)
resetOps()
hostRender(render2({}, []), root2)
printOps('静态内容：两次渲染调用，但宿主操作为 0（vnode 是新对象，仍会走 patchElement，' +
  '只是 props/children 全等没有变化，不触发任何 DOM 操作）')
