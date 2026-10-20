/**
 * 运行：pnpm ex chapters/12-compiler-optimization/examples/05-v-on-cache-and-modifiers.ts
 * 演示：v-on 的几种 handler 形态（方法引用 / 内联语句 / 函数表达式）编译结果的差异、
 *       cacheHandlers 打开前后的产物对比，以及 compiler-dom 层的事件修饰符
 *       （.stop/.prevent/.once/.capture/.passive、按键修饰符、.right/.middle、.exact）。
 * 看点：
 *  1. `@click="onClick"`（方法引用/member expression）直接把表达式当 handler 用，不包一层
 *     箭头函数——这样引用不变时，组件更新也不会触发子组件重新渲染（compare by reference）。
 *  2. `@click="count++"`（内联语句）会被包成 `$event => (count++)`；多条语句用 `{ }`。
 *  3. cacheHandlers 必须配合 prefixIdentifiers（mode: module 或显式传）才能用——
 *     baseCompile 里有一行专门的 onError 检查（X_CACHE_HANDLER_NOT_SUPPORTED）。
 *  4. cacheHandlers 打开后，"方法引用"类型的 handler 会被重写成
 *     `_cache[n] || (_cache[n] = (...args) => (_ctx.onClick && _ctx.onClick(...args)))`——
 *     注意这里反而**多包了一层**，是为了"每次都读最新的 _ctx.onClick"，同时整个箭头函数
 *     对象的引用是稳定的（来自 _cache），避免只因为父组件重渲染就触发子组件更新。
 *  5. .passive/.once/.capture 会改写事件名后缀（onClickOnce 之类），按键修饰符和
 *     .stop/.prevent 等则包一层 withKeys/withModifiers 运行时 helper。
 */
import { compile } from '@vue/compiler-dom'
import { section, step, log } from '../../../shared/print'

section('1. 三种 handler 形态的编译结果')
step('方法引用：@click="onClick" -> 直接用，不包箭头函数')
log(compile(`<button @click="onClick">x</button>`).code)

step('内联语句（单条）：@click="count++" -> $event => (count++)')
log(compile(`<button @click="count++">x</button>`).code)

step('内联语句（多条，用分号隔开）：包成 { } 代码块')
log(compile(`<button @click="count++; log(count)">x</button>`).code)

step('函数表达式：@click="() => count++" -> 直接用，不再包一层')
log(compile(`<button @click="() => count++">x</button>`).code)

step('内联语句里访问 $event')
log(compile(`<button @click="onClick($event, 1)">x</button>`).code)

section('2. cacheHandlers：必须配合 prefixIdentifiers')
step('不开 prefixIdentifiers 直接用 cacheHandlers 会报错（X_CACHE_HANDLER_NOT_SUPPORTED）')
try {
  compile(`<button @click="onClick">x</button>`, { cacheHandlers: true })
} catch (e) {
  log('捕获到异常：', (e as Error).message)
}

step('mode: module（自动打开 prefixIdentifiers）+ cacheHandlers: true')
log(
  compile(`<button @click="onClick">x</button>`, {
    mode: 'module',
    cacheHandlers: true,
  }).code,
)
step('对比：同样的模板，不开 cacheHandlers（但开 prefixIdentifiers）')
log(compile(`<button @click="onClick">x</button>`, { mode: 'module' }).code)

step('内联语句开 cacheHandlers：本来就是新建的箭头函数，直接整体缓存，不需要再包一层 &&')
log(
  compile(`<button @click="count++">x</button>`, {
    mode: 'module',
    cacheHandlers: true,
  }).code,
)

section('3. compiler-dom 的事件修饰符')
step('.stop.prevent -> withModifiers')
log(compile(`<button @click.stop.prevent="go">x</button>`).code)

step('.once.capture.passive -> 改写事件名后缀，不需要运行时 helper')
log(compile(`<button @click.once.capture.passive="go">x</button>`).code)

step('按键修饰符 .enter -> withKeys；非按键修饰符 .ctrl -> withModifiers')
log(compile(`<input @keyup.enter="submit" @keydown.ctrl.exact="onCtrl">`).code)

step('.right / .middle：click 事件改写成 contextmenu / mouseup')
log(compile(`<div @click.right="onRight" @click.middle="onMiddle"></div>`).code)
