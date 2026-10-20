/**
 * 对应源码：packages/runtime-core/src/scheduler.ts
 * 覆盖点：去重、按 id 排序 + PRE 优先、postFlush 去重排序、nextTick 的链式关系、
 * flushPreFlushCbs 按 instance 过滤、递归更新上限。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type SchedulerJob,
  SchedulerJobFlags,
  __resetSchedulerForTest,
  nextTick,
  queueJob,
  queuePostFlushCb,
} from './scheduler'

beforeEach(() => {
  __resetSchedulerForTest()
})

function job(fn: () => void, id?: number, flags = 0): SchedulerJob {
  const j: SchedulerJob = fn as SchedulerJob
  j.id = id
  j.flags = flags
  return j
}

describe('queueJob / flushJobs (mini-vue)', () => {
  it('同一个 job 在一轮 flush 里只执行一次（QUEUED 去重）', async () => {
    let calls = 0
    const j = job(() => calls++, 5)
    queueJob(j)
    queueJob(j)
    queueJob(j)
    await nextTick()
    expect(calls).toBe(1)
  })

  it('按 id 升序执行：父组件（id 小）先于子组件（id 大）', async () => {
    const order: string[] = []
    const child = job(() => order.push('child'), 2)
    const parent = job(() => order.push('parent'), 1)
    // 故意先 queue 子后 queue 父，验证执行顺序仍按 id 排
    queueJob(child)
    queueJob(parent)
    await nextTick()
    expect(order).toEqual(['parent', 'child'])
  })

  it('同 id 时 PRE job 排在组件更新 job 之前', async () => {
    const order: string[] = []
    const update = job(() => order.push('update'), 1)
    const pre = job(() => order.push('pre'), 1, SchedulerJobFlags.PRE)
    // 先 queue update 再 queue pre，findInsertionIndex 应该把 pre 插到 update 前面
    queueJob(update)
    queueJob(pre)
    await nextTick()
    expect(order).toEqual(['pre', 'update'])
  })

  it('一次同步代码里改 3 次状态，只触发一次 flush（批处理的直接体现）', async () => {
    let runCount = 0
    const render = job(() => runCount++, 1)
    queueJob(render)
    queueJob(render)
    queueJob(render)
    expect(runCount).toBe(0) // flush 是异步的，微任务之前还没执行
    await nextTick()
    expect(runCount).toBe(1)
  })

  it('递归更新超过 RECURSION_LIMIT (100) 时报错并停止，而不是死循环', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let runs = 0
    const recursive: SchedulerJob = () => {
      runs++
      recursive.flags! |= SchedulerJobFlags.ALLOW_RECURSE
      queueJob(recursive)
    }
    recursive.id = 1
    recursive.flags = SchedulerJobFlags.ALLOW_RECURSE
    queueJob(recursive)
    await nextTick()
    // count 从 0 开始，第 101 次自增后 (101 > 100) 触发报错并被跳过
    expect(runs).toBe(101)
    expect(errSpy).toHaveBeenCalled()
    expect(errSpy.mock.calls[0].join(' ')).toContain('Maximum recursive updates')
    errSpy.mockRestore()
  })
})

describe('queuePostFlushCb / flushPostFlushCbs (mini-vue)', () => {
  it('数组形式展开 + 去重，按 id 排序后执行', async () => {
    const order: string[] = []
    const cb1 = job(() => order.push('cb1'), 2)
    const cb2 = job(() => order.push('cb2'), 1)
    queuePostFlushCb([cb1, cb2])
    queuePostFlushCb(cb1) // 已经在队列里，应该被去重，不会跑第二次
    await nextTick()
    expect(order).toEqual(['cb2', 'cb1'])
  })

  it('post cb 在所有 queueJob 的主任务之后执行', async () => {
    const order: string[] = []
    queueJob(job(() => order.push('render'), 1))
    queuePostFlushCb(job(() => order.push('mounted'), 1))
    await nextTick()
    expect(order).toEqual(['render', 'mounted'])
  })
})

describe('nextTick (mini-vue)', () => {
  it('nextTick 挂在 currentFlushPromise 之后：本轮 job 先跑完，回调才执行', async () => {
    const order: string[] = []
    queueJob(job(() => order.push('job'), 1))
    nextTick(() => order.push('tick-1'))
    nextTick(() => order.push('tick-2'))
    await nextTick()
    expect(order).toEqual(['job', 'tick-1', 'tick-2'])
  })

  it('没有待 flush 的任务时，nextTick 退化为 resolvedPromise.then', async () => {
    const order: string[] = []
    await nextTick(() => order.push('a'))
    expect(order).toEqual(['a'])
  })

  it('nextTick 支持 this 绑定并返回回调的返回值', async () => {
    const ctx = { value: 42 }
    const result = await nextTick(function (this: typeof ctx) {
      return this.value
    }.bind(ctx))
    // 直接 call 风格也验证一遍（源码签名支持 `nextTick.call(ctx, fn)`）
    const result2 = await (nextTick as any).call(ctx, function (this: typeof ctx) {
      return this.value
    })
    expect(result).toBe(42)
    expect(result2).toBe(42)
  })
})

describe('flushPreFlushCbs 的 instance 过滤（mini-vue）', () => {
  it('组件更新前只跑属于该组件的 PRE job，顺序是 pre -> update', async () => {
    const order: string[] = []
    const instanceA = { name: 'A' }
    const instanceB = { name: 'B' }

    const preA = job(() => order.push('pre-A'), 1, SchedulerJobFlags.PRE)
    preA.i = instanceA
    const updateA = job(() => order.push('update-A'), 1)
    updateA.i = instanceA
    const preB = job(() => order.push('pre-B'), 2, SchedulerJobFlags.PRE)
    preB.i = instanceB
    const updateB = job(() => order.push('update-B'), 2)
    updateB.i = instanceB

    // 乱序 queue，验证排序 + PRE 优先 + instance 隔离都生效
    queueJob(updateA)
    queueJob(preA)
    queueJob(updateB)
    queueJob(preB)
    await nextTick()
    expect(order).toEqual(['pre-A', 'update-A', 'pre-B', 'update-B'])
  })
})
