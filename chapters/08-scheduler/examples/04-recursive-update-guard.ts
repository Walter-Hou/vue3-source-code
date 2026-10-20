/**
 * 运行：pnpm ex chapters/08-scheduler/examples/04-recursive-update-guard.ts
 * 演示：在 updated 钩子里改状态会不断触发自己的更新，超过
 *       RECURSION_LIMIT(100) 次后被 checkRecursiveUpdates 识别为死循环；
 *       在 beforeUpdate 钩子里改同一种状态则不会触发任何额外的更新——
 *       因为 beforeUpdate 执行期间 ALLOW_RECURSE 被临时关闭，这个组件的
 *       渲染 effect 当时正是"自己触发自己"的那个 effect，直接被判定为
 *       不应该自我调度。
 * 看点：
 *   1. checkRecursiveUpdates 用一个 Map 记录每个 job（render job / 每个
 *      组件的 updated 钩子数组）在"这一轮递归 flushJobs"里被执行了几次，
 *      超过 100 次就调用 handleError（scheduler.ts#L329-348）。
 *   2. 关键细节：这里的 `handleError(msg, null, ErrorCodes.APP_ERROR_HANDLER)`
 *      **把 instance 硬编码成 null**，而不是传 `fn.i`——这意味着即使你配了
 *      `app.config.errorHandler`，"Maximum recursive updates" 也不会走到
 *      它那里，而是直接走 logError 的默认行为：dev 环境下 `throw err`
 *      （errorHandling.ts#L164-178）。所以这个错误在开发环境下必定会变成
 *      一个未捕获异常/未处理的 Promise rejection——这也是为什么下面的代码
 *      要用 try/catch 包住触发更新的那一步。
 *   3. beforeUpdate 阶段 `toggleRecurse(instance, false)` 关闭了
 *      ALLOW_RECURSE（renderer.ts#L866-874, #L1535-1558）：这个窗口期内，
 *      如果 beforeUpdate 修改了触发本次更新的同一个依赖，这次通知会命中
 *      "effect 正在运行且不允许自我递归"的判断，根本不会再调度一次新的
 *      渲染——不是"调度了但被扛住"，而是"压根没有调度"。
 */
import { defineComponent, h, nextTick, onBeforeUpdate, onUpdated, ref } from '@vue/runtime-core'
import { createRoot, render } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

section('1. 在 onUpdated 里改状态 —— 递归更新超限，dev 环境下必定抛错')

const countA = ref(0)
let updatedCalls = 0
const BadComp = defineComponent({
  name: 'BadComp',
  setup() {
    onUpdated(() => {
      updatedCalls++
      // 危险操作：updated 钩子里又修改了触发这次更新的状态，形成死循环
      countA.value++
    })
    return () => h('div', String(countA.value))
  },
})

const warnings: string[] = []
const origWarn = console.warn
console.warn = (...args: unknown[]) => warnings.push(String(args[0]))

const root1 = createRoot()
render(h(BadComp), root1)

step('countA.value++ 触发第一次更新，之后 updated 钩子会不断自我触发')
countA.value++

let caught: unknown = null
try {
  // 关键点：handleError 把 instance 硬编码成 null，dev 下会 throw，
  // 这个 throw 会让 currentFlushPromise 变成 rejected promise，
  // 而 nextTick() 返回的正是这个 promise —— 必须 catch 住，否则是
  // 一个未处理的 Promise rejection，会直接让 Node 进程崩溃退出。
  await nextTick()
} catch (e) {
  caught = e
}

console.warn = origWarn
log(`updated 钩子一共被调用了 ${updatedCalls} 次（预期刚过 100 就停止，而不是跑到 countA=无穷大）`)
log(`是否捕获到异常：${caught !== null}`)
// 注意：scheduler.ts 里 handleError() 的第一个参数直接传了一个字符串模板，
// 不是 `new Error(...)`，所以这里 catch 到的也是一个纯字符串，不是 Error 对象。
log(`捕获到的内容（字符串，不是 Error 对象）：${String(caught).slice(0, 60)}...`)
log(`控制台 warn 的第一条：${warnings[0]}`)

section('2. 在 onBeforeUpdate 里改同一种状态 —— 根本不会触发额外的更新')

const countB = ref(0)
let beforeUpdateCalls = 0
let renderCalls = 0
const SaferComp = defineComponent({
  name: 'SaferComp',
  setup() {
    onBeforeUpdate(() => {
      beforeUpdateCalls++
      // 同样的"危险操作"，但发生在 beforeUpdate 里：
      // 此时这个组件的渲染 effect 正在运行且 ALLOW_RECURSE 被关闭，
      // 这次修改不会让它把自己重新排进调度队列。
      countB.value++
    })
    return () => {
      renderCalls++
      return h('div', String(countB.value))
    }
  },
})

const root2 = createRoot()
render(h(SaferComp), root2)
renderCalls = 0
beforeUpdateCalls = 0

step('countB.value++ 触发一次更新，beforeUpdate 里也会修改 countB')
countB.value++
await nextTick()

log(`renderCalls = ${renderCalls}（预期 1：只有最初这一次触发的更新，没有被 beforeUpdate 的修改连锁触发第二次）`)
log(`beforeUpdateCalls = ${beforeUpdateCalls}（预期 1，而不是无限增长）`)
log('结论：updated 钩子里的自我修改会被 checkRecursiveUpdates 兜底（超过 100 次报错）；')
log('      beforeUpdate 里的自我修改在源头上就不会触发新的调度——两种"自触发"行为完全不同。')
