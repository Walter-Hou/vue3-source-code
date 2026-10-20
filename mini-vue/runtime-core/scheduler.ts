/**
 * 对应源码：packages/runtime-core/src/scheduler.ts
 *
 * 保留的主干：
 * - SchedulerJob 接口与 SchedulerJobFlags（QUEUED/PRE/ALLOW_RECURSE/DISPOSED）
 * - queue / flushIndex、pendingPostFlushCbs / activePostFlushCbs / postFlushIndex 这几组状态
 * - resolvedPromise / currentFlushPromise 与 nextTick 的"挂在当前这轮 flush 后面"
 * - findInsertionIndex 的二分插入（按 id 排序，同 id 时 PRE 排前面）
 * - queueJob 的去重（QUEUED 标志）与 queueFlush
 * - queuePostFlushCb 的数组展开与去重
 * - flushJobs 的主循环、DISPOSED 跳过、开发期 checkRecursiveUpdates 递归上限
 * - flushPostFlushCbs 的去重 + 按 id 排序 + 递归处理新加入的 cb
 *
 * 裁剪点（为了自包含、聚焦主干）：
 * - 不依赖 @vue/reactivity / component.ts，SchedulerJob.i 只是一个任意标记，
 *   不要求是真正的组件实例。
 * - flushPreFlushCbs 去掉了源码里 minUid（root mount 时过滤"属于本次挂载"的
 *   job）的分支，只保留按 instance 过滤 PRE job 的核心逻辑。
 * - flushOnAppMount（root mount/unmount 的特殊 flush 时机）、Suspense 相关的
 *   queueEffectWithSuspense 不在 mini 范围内，这些在源码里是为了处理
 *   「挂载阶段只 flush 自己创建的 job」这种边缘时序，不影响理解主流程。
 * - 导出了一个 `__resetSchedulerForTest()`，仅用于测试之间清空模块级状态；
 *   真实源码没有这个函数（它是单例模块，不需要在运行时重置）。
 * - 源码的 callWithErrorHandling/handleError（errorHandling.ts）接入了
 *   app.config.errorHandler 等一整套错误处理基础设施，mini 版在本文件内
 *   给了一个够用的最小实现：出错就 console.error，不中断 flush 循环。
 */

// 参数类型用 Function（和源码的 callWithErrorHandling(fn: Function, ...) 一致），
// 而不是 () => void —— 这样才能直接传入 SchedulerJob（它继承自 Function，但没有
// 一个具体的调用签名，赋给 () => void 会被 TS 拒绝）。
function callWithErrorHandling(fn: Function): void {
  try {
    fn()
  } catch (err) {
    handleError(err)
  }
}

function handleError(err: unknown): void {
  console.error('[mini-scheduler]', err)
}

export enum SchedulerJobFlags {
  QUEUED = 1 << 0,
  PRE = 1 << 1,
  /**
   * 默认情况下一个 job 不允许在自己执行的过程中把自己重新排进队列
   * （防止递归无限循环）。组件更新函数和 watch 回调是例外——它们的副作用
   * 可能在本轮里又触发了自身的依赖，这是预期行为。
   */
  ALLOW_RECURSE = 1 << 2,
  DISPOSED = 1 << 3,
}

export interface SchedulerJob extends Function {
  id?: number
  flags?: SchedulerJobFlags
  /** 调试用：记录这个 job 属于哪个"组件"（mini 版里只是个任意标记） */
  i?: unknown
}

export type SchedulerJobs = SchedulerJob | SchedulerJob[]

const queue: SchedulerJob[] = []
let flushIndex = -1

const pendingPostFlushCbs: SchedulerJob[] = []
let activePostFlushCbs: SchedulerJob[] | null = null
let postFlushIndex = 0

const resolvedPromise = /*@__PURE__*/ Promise.resolve()
let currentFlushPromise: Promise<void> | null = null

const RECURSION_LIMIT = 100
type CountMap = Map<SchedulerJob, number>

export function nextTick<T, R>(
  this: T,
  fn?: (this: T) => R | Promise<R>,
): Promise<void | R> {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(this ? fn.bind(this) : fn) : p
}

// 二分查找 job 应该插入的位置。队列按 id 递增排序：
// 1. 父组件总是比子组件先创建，id 更小，保证父先于子更新；
// 2. 同 id 时 PRE job 排在前面——pre watcher 的 job 和它所属组件的更新 job
//    id 相同，必须排在组件更新之前执行（props 变化要先跑完 pre watcher，
//    再用最新状态渲染）。
function findInsertionIndex(id: number): number {
  let start = flushIndex + 1
  let end = queue.length

  while (start < end) {
    const middle = (start + end) >>> 1
    const middleJob = queue[middle]
    const middleJobId = getId(middleJob)
    if (
      middleJobId < id ||
      (middleJobId === id && middleJob.flags! & SchedulerJobFlags.PRE)
    ) {
      start = middle + 1
    } else {
      end = middle
    }
  }

  return start
}

export function queueJob(job: SchedulerJob): void {
  if (!(job.flags! & SchedulerJobFlags.QUEUED)) {
    const jobId = getId(job)
    const lastJob = queue[queue.length - 1]
    if (
      !lastJob ||
      // 快路径：新 job 的 id 比队尾还大，直接 push，省掉二分查找
      (!(job.flags! & SchedulerJobFlags.PRE) && jobId >= getId(lastJob))
    ) {
      queue.push(job)
    } else {
      queue.splice(findInsertionIndex(jobId), 0, job)
    }

    job.flags! |= SchedulerJobFlags.QUEUED
    queueFlush()
  }
}

function queueFlush(): void {
  if (!currentFlushPromise) {
    // 不直接传 flushJobs 引用：Promise<void>.then() 的回调类型是 (value: void) => ...，
    // 和 flushJobs(seen?: CountMap) 的参数类型对不上（TS 的函数参数逆变检查），
    // 包一层箭头函数绕过纯类型层面的不匹配，运行时行为不变（flushJobs() 的 seen 本来就是可选参数）。
    currentFlushPromise = resolvedPromise.then(() => flushJobs())
  }
}

export function queuePostFlushCb(cb: SchedulerJobs): void {
  if (!Array.isArray(cb)) {
    if (activePostFlushCbs && cb.id === -1) {
      activePostFlushCbs.splice(postFlushIndex + 1, 0, cb)
    } else if (!(cb.flags! & SchedulerJobFlags.QUEUED)) {
      pendingPostFlushCbs.push(cb)
      cb.flags! |= SchedulerJobFlags.QUEUED
    }
  } else {
    for (let i = 0; i < cb.length; i++) {
      pendingPostFlushCbs.push(cb[i])
    }
  }
  queueFlush()
}

/**
 * 在组件渲染之前把"属于这个组件、带 PRE 标记"的 job 先执行掉。
 * 对应 updateComponentPreRender 里的 `flushPreFlushCbs(instance)` 调用：
 * props 更新可能触发了 flush: 'pre' 的 watch 回调，这些回调必须在组件
 * 本次渲染之前跑完，这样渲染时读到的才是最新状态。
 */
export function flushPreFlushCbs(
  instance?: unknown,
  seen?: CountMap,
  i: number = flushIndex + 1,
): void {
  seen = seen || new Map()
  for (; i < queue.length; i++) {
    const cb = queue[i]
    if (cb && cb.flags! & SchedulerJobFlags.PRE) {
      if (instance && cb.i !== instance) {
        continue
      }
      if (checkRecursiveUpdates(seen, cb)) {
        continue
      }
      queue.splice(i, 1)
      i = instance ? i - 1 : flushIndex
      if (cb.flags! & SchedulerJobFlags.ALLOW_RECURSE) {
        cb.flags! &= ~SchedulerJobFlags.QUEUED
      }
      cb()
      if (!(cb.flags! & SchedulerJobFlags.ALLOW_RECURSE)) {
        cb.flags! &= ~SchedulerJobFlags.QUEUED
      }
    }
  }
}

export function flushPostFlushCbs(seen?: CountMap): void {
  if (pendingPostFlushCbs.length) {
    const deduped = [...new Set(pendingPostFlushCbs)].sort(
      (a, b) => getId(a) - getId(b),
    )
    pendingPostFlushCbs.length = 0

    // 已经有一个 activePostFlushCbs 在跑（嵌套调用），直接并进去，
    // 让外层的循环接着处理，不另起一轮
    if (activePostFlushCbs) {
      activePostFlushCbs.push(...deduped)
      return
    }

    activePostFlushCbs = deduped
    seen = seen || new Map()

    for (
      postFlushIndex = 0;
      postFlushIndex < activePostFlushCbs.length;
      postFlushIndex++
    ) {
      const cb = activePostFlushCbs[postFlushIndex]
      if (checkRecursiveUpdates(seen, cb)) {
        continue
      }
      if (cb.flags! & SchedulerJobFlags.ALLOW_RECURSE) {
        cb.flags! &= ~SchedulerJobFlags.QUEUED
      }
      if (!(cb.flags! & SchedulerJobFlags.DISPOSED)) cb()
      cb.flags! &= ~SchedulerJobFlags.QUEUED
    }
    activePostFlushCbs = null
    postFlushIndex = 0
  }
}

const getId = (job: SchedulerJob): number =>
  job.id == null ? (job.flags! & SchedulerJobFlags.PRE ? -1 : Infinity) : job.id

function flushJobs(seen?: CountMap): void {
  seen = seen || new Map()

  try {
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex]
      if (job && !(job.flags! & SchedulerJobFlags.DISPOSED)) {
        if (checkRecursiveUpdates(seen, job)) {
          continue
        }
        if (job.flags! & SchedulerJobFlags.ALLOW_RECURSE) {
          job.flags! &= ~SchedulerJobFlags.QUEUED
        }
        callWithErrorHandling(job)
        if (!(job.flags! & SchedulerJobFlags.ALLOW_RECURSE)) {
          job.flags! &= ~SchedulerJobFlags.QUEUED
        }
      }
    }
  } finally {
    for (; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex]
      if (job) {
        job.flags! &= ~SchedulerJobFlags.QUEUED
      }
    }

    flushIndex = -1
    queue.length = 0

    flushPostFlushCbs(seen)

    currentFlushPromise = null
    // flush 过程中又有新 job 被加入（例如 updated 钩子里改了状态），继续 flush
    if (queue.length || pendingPostFlushCbs.length) {
      flushJobs(seen)
    }
  }
}

function checkRecursiveUpdates(seen: CountMap, fn: SchedulerJob): boolean {
  const count = seen.get(fn) || 0
  if (count > RECURSION_LIMIT) {
    handleError(
      `Maximum recursive updates exceeded. This means you have a reactive ` +
        `effect that is mutating its own dependencies and thus recursively ` +
        `triggering itself.`,
    )
    return true
  }
  seen.set(fn, count + 1)
  return false
}

/**
 * 仅供测试使用：清空所有模块级状态。真实源码是一个长期存活的单例模块，
 * 不需要也没有提供这种重置能力——这里加上纯粹是为了让 vitest 的多个
 * test case 之间互不干扰。
 */
export function __resetSchedulerForTest(): void {
  queue.length = 0
  flushIndex = -1
  pendingPostFlushCbs.length = 0
  activePostFlushCbs = null
  postFlushIndex = 0
  currentFlushPromise = null
}
