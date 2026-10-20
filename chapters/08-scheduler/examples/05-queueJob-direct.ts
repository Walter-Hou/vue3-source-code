/**
 * 运行：pnpm ex chapters/08-scheduler/examples/05-queueJob-direct.ts
 * 演示：直接调用调度器的几个底层函数，脱离组件/渲染器的包装，纯粹观察
 *       queueJob 的去重、按 id 排序、PRE 优先这几条规则。
 * 看点：
 *   1. `queueJob`/`findInsertionIndex` 这些函数**没有**从 'vue' /
 *      '@vue/runtime-core' 导出（确认方式：grep SRC 的
 *      packages/runtime-core/src/index.ts，只有 `export { nextTick } from
 *      './scheduler'` 和 `export { queuePostFlushCb } from './scheduler'`
 *      两行，没有 queueJob）。所以这里用 mini-vue/runtime-core/scheduler.ts
 *      —— 它是源码 scheduler.ts 的逐行复刻，变量名、算法完全一致。
 *   2. 用纯函数（不是组件更新）直接演示三件事：同一个 job 多次 queueJob
 *      只执行一次；多个不同 id 的 job 按 id 升序执行；相同 id 时 PRE
 *      job 排在前面。
 */
import {
  type SchedulerJob,
  SchedulerJobFlags,
  __resetSchedulerForTest,
  nextTick,
  queueJob,
} from '../../../mini-vue/runtime-core/scheduler'
import { log, section, step } from '../../../shared/print'

section('1. 去重：同一个 job 在一轮里只跑一次')

__resetSchedulerForTest()
let calls = 0
const job: SchedulerJob = () => calls++
job.id = 1

step('连续 queueJob(job) 5 次')
queueJob(job)
queueJob(job)
queueJob(job)
queueJob(job)
queueJob(job)
log(`同步代码执行完，calls = ${calls}（还没 flush）`)
await nextTick()
log(`flush 之后，calls = ${calls}（预期 1，QUEUED 标志让后续 4 次 queueJob 直接短路）`)

section('2. 按 id 升序执行：id 代表"谁先创建"，父组件总是比子组件先更新')

__resetSchedulerForTest()
const order: string[] = []
function makeJob(name: string, id: number): SchedulerJob {
  const j: SchedulerJob = () => order.push(name)
  j.id = id
  return j
}

step('乱序 queueJob：先 queue 子组件(id=30)，再 queue 父组件(id=10)，再 queue 中间层(id=20)')
queueJob(makeJob('child(id=30)', 30))
queueJob(makeJob('parent(id=10)', 10))
queueJob(makeJob('middle(id=20)', 20))
await nextTick()
log('实际执行顺序 =', order, '（跟 queueJob 调用顺序无关，只看 id）')

section('3. 同 id 时 PRE job 排在前面')

__resetSchedulerForTest()
const order2: string[] = []
const updateJob: SchedulerJob = () => order2.push('component update')
updateJob.id = 5
const preWatchJob: SchedulerJob = () => order2.push('pre watch')
preWatchJob.id = 5
preWatchJob.flags = SchedulerJobFlags.PRE

step('先 queue "component update"，再 queue 同 id=5 的 "pre watch"')
queueJob(updateJob)
queueJob(preWatchJob)
await nextTick()
log('实际执行顺序 =', order2, '（findInsertionIndex 在 id 相同时，把 PRE 的插到前面）')

log('')
log('这正是 scheduler.ts#L79-98 findInsertionIndex 的二分查找逻辑：')
log('middleJobId < id，或者 (middleJobId === id 且 middleJob 带 PRE 标志)，都继续往右找插入点。')
