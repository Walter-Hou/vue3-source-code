/**
 * 运行：pnpm ex chapters/08-scheduler/examples/03-nextTick-internals.ts
 * 演示：nextTick() 到底在等什么——它返回的 Promise 是"挂在当前这一轮
 *       flush 后面"，而不是一个固定的微任务数量；flush 过程中再调用
 *       nextTick 仍然能排到同一轮结束之后。
 * 看点：
 *   1. 源码实现只有一行关键逻辑：
 *      `const p = currentFlushPromise || resolvedPromise; return fn ? p.then(fn) : p`
 *      （scheduler.ts#L57-68）。没有状态变化、没有 pending job 时，
 *      currentFlushPromise 是 null，nextTick 退化成 resolvedPromise.then()。
 *   2. 一旦有 job 被 queueJob 排队，`queueFlush()` 会把
 *      `currentFlushPromise = resolvedPromise.then(flushJobs)` 设置好
 *      （scheduler.ts#L120-124）；这之后调用的 nextTick 都 `.then` 在
 *      这个 promise 后面，所以不管调用几次 nextTick，它们都会在
 *      flushJobs 跑完（包括 post 任务）之后才触发，且彼此之间按注册顺序。
 *   3. 在 flushJobs 执行过程中（也就是某个 job 自己的函数体内）再调用
 *      nextTick()，这时 currentFlushPromise 还没被置 null（要等 flushJobs
 *      的 finally 块执行完才置 null），所以这次 nextTick 依然挂在"本轮"
 *      后面，而不是新开一轮——但它在微任务队列里排在谁后面，看的是
 *      "谁先对 currentFlushPromise 调用 .then()"（attach 顺序），不是
 *      "谁在代码里写得更靠前"。本例最后一组会验证这一点。
 */
import { h, nextTick, ref } from '@vue/runtime-core'
import { createRoot, render } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

section('1. 没有任何 pending job 时，nextTick 退化为 resolvedPromise.then()')

const p1 = nextTick()
const p2 = nextTick()
log('两次调用 nextTick() 返回的是不是同一个 Promise？', p1 === p2)
await p1
log('resolved（没有状态变化，这一步几乎是立即完成的微任务）')

section('2. 触发一次更新后，多次 nextTick 都排在这一轮 flush 之后')

const count = ref(0)
function App() {
  return h('div', String(count.value))
}
const root = createRoot()
render(h(App), root)

const order: string[] = []
step('同步修改 count，紧接着连续调用 3 次 nextTick(cb)')
count.value++
nextTick(() => order.push('tick-1'))
nextTick(() => order.push('tick-2'))
nextTick(() => order.push('tick-3'))
log('此刻 order =', order, '（还没 flush，应为空数组）')

await nextTick()
log('flush 完成后 order =', order, '（三个回调按注册顺序依次执行）')

section('3. 在 job 执行过程中调用 nextTick：依然排在"本轮" flush 之后，而不是新开一轮')

const flag = ref(0)
const insideOrder: string[] = []
function Watcher() {
  // 渲染函数本身就是一个 SchedulerJob；在它执行期间调用 nextTick
  if (flag.value === 1) {
    insideOrder.push('job-body-start')
    nextTick(() => insideOrder.push('nextTick-called-inside-job'))
    insideOrder.push('job-body-end')
  }
  return h('div', String(flag.value))
}
const root2 = createRoot()
render(h(Watcher), root2)

step('flag.value = 1，触发更新；渲染函数内部会调用一次 nextTick')
flag.value = 1
await nextTick(() => insideOrder.push('outer-nextTick'))
log('insideOrder =', insideOrder)
log('两个 nextTick 回调都挂在同一个 currentFlushPromise 上，谁先对它调用 .then()，')
log('谁的回调就先进微任务队列。外层的 nextTick(cb) 是在 flag.value=1 后【立即同步】')
log('调用的，这时 flushJobs 还没开始跑，所以它比 job 内部那次 nextTick 调用更早')
log('attach 到 promise 上——即使 job 内部那行代码在时间线上执行得更早，outer 回调')
log('依然先触发。这是源码里"挂在 currentFlushPromise 后面"的字面含义：看 attach')
log('顺序，不是看"写在代码里的物理位置"。')
