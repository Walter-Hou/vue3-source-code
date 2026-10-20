/**
 * 运行：pnpm ex chapters/08-scheduler/examples/01-batch-updates.ts
 * 演示：同步代码里连续修改 N 次响应式状态，组件只会重新渲染一次——
 *       这就是 queueJob 的 QUEUED 标志去重 + nextTick 微任务调度的直接效果。
 *       再对比 watch(..., { flush: 'sync' })：sync watcher 不经过调度队列，
 *       每次依赖变化都立即同步执行。
 * 看点：
 *   1. 同步修改 count 3 次，渲染函数只被调用 1 次（render 日志只打印一次，
 *      宿主操作也只有一次 setElementText）。
 *   2. 组件的更新函数是一个 SchedulerJob，`effect.scheduler = () =>
 *      queueJob(job)`（renderer.ts#L1631-1635）；queueJob 发现 job 已经
 *      带 QUEUED 标记就直接返回，不会重复入队（scheduler.ts#L100-118）。
 *   3. flush:'sync' 的 watch 完全绕开了这个队列，回调和 trigger 同步执行，
 *      所以同样改 3 次状态，sync watch 会被调用 3 次。
 */
import { createRoot, printOps, render } from '../../../shared/logging-renderer'
import { h, nextTick, ref, watch } from '@vue/runtime-core'
import { log, section, step } from '../../../shared/print'

section('1. 同步改 3 次状态，只渲染一次')

const count = ref(0)
let renderCalls = 0

function App() {
  renderCalls++
  log(`render() 第 ${renderCalls} 次被调用，count = ${count.value}`)
  return h('div', String(count.value))
}

const root = createRoot()
render(h(App), root)
printOps('mount')
renderCalls = 0 // 只统计接下来这一段

step('同步执行 count++ 三次')
count.value++
count.value++
count.value++
log(`三次赋值已经执行完，此刻 renderCalls = ${renderCalls}（还没 flush，应该是 0）`)

await nextTick()
log(`await nextTick() 之后，renderCalls = ${renderCalls}（预期 1：三次修改只触发一次渲染）`)
printOps('update after 3x count++')

section('2. 对比 flush: "sync" 的 watch —— 不经过调度队列，次数 = 触发次数')

const n = ref(0)
let syncWatchCalls = 0
watch(
  n,
  val => {
    syncWatchCalls++
    log(`sync watch 回调第 ${syncWatchCalls} 次，n = ${val}`)
  },
  { flush: 'sync' },
)

step('同步执行 n++ 三次')
n.value++
n.value++
n.value++
log(`不需要等 nextTick，syncWatchCalls 已经是 ${syncWatchCalls}（预期 3，每次改动都立即触发）`)
