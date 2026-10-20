import { describe, expect, it, vi } from 'vitest'
import { EffectFlags, effect, pauseTracking, resetTracking, stop } from './effect'
import { reactive } from './reactive'

describe('ReactiveEffect：动态依赖与清理', () => {
  it('条件分支切换后，旧分支的依赖会被 cleanupDeps 摘掉', () => {
    const state = reactive({ cond: true, a: 1, b: 2 })
    const fn = vi.fn(() => (state.cond ? state.a : state.b))
    const runner = effect(fn)

    expect(fn).toHaveBeenCalledTimes(1)
    // 此时依赖链表应该是 cond -> a
    expect(depKeys(runner.effect)).toEqual(['cond', 'a'])

    state.cond = false // 切到 b 分支，重新收集依赖
    expect(fn).toHaveBeenCalledTimes(2)
    expect(depKeys(runner.effect)).toEqual(['cond', 'b'])

    // 旧分支的 a 已经不再被订阅：改 a 不应该再触发 effect
    state.a = 100
    expect(fn).toHaveBeenCalledTimes(2)

    // 新分支的 b 仍然有效
    state.b = 200
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('同一个 effect 内重复访问同一个 key，只产生一个 Link', () => {
    const state = reactive({ a: 1 })
    const runner = effect(() => state.a + state.a + state.a)
    expect(depKeys(runner.effect)).toEqual(['a'])
  })
})

describe('嵌套 effect：activeSub 的保存与恢复', () => {
  it('内层 effect 运行结束后，外层 effect 能正确恢复成 activeSub', () => {
    const state = reactive({ outer: 1, inner: 1 })
    const order: string[] = []

    effect(() => {
      order.push('outer-start')
      state.outer
      effect(() => {
        order.push('inner')
        state.inner
      })
      order.push('outer-end')
    })

    expect(order).toEqual(['outer-start', 'inner', 'outer-end'])

    order.length = 0
    state.outer++
    // 只有外层 effect 重新运行，内层 effect 的依赖不受影响
    expect(order).toEqual(['outer-start', 'inner', 'outer-end'])
  })
})

describe('scheduler / runner / stop / pause-resume', () => {
  it('提供 scheduler 时，依赖变化不会直接重跑 fn，而是调用 scheduler', () => {
    const state = reactive({ a: 1 })
    const scheduler = vi.fn()
    const fn = vi.fn(() => state.a)
    effect(fn, { scheduler })

    expect(fn).toHaveBeenCalledTimes(1)
    state.a++
    expect(fn).toHaveBeenCalledTimes(1) // fn 没有被自动重跑
    expect(scheduler).toHaveBeenCalledTimes(1)
  })

  it('runner() 可以手动重跑并拿到返回值', () => {
    const state = reactive({ a: 1 })
    const runner = effect(() => state.a * 10)
    expect(runner()).toBe(10)
    state.a = 5
    expect(runner()).toBe(50)
  })

  it('stop() 之后不再响应依赖变化，再次手动调用 runner 仍能跑一次 fn 本体', () => {
    const state = reactive({ a: 1 })
    const fn = vi.fn(() => state.a)
    const runner = effect(fn)
    stop(runner)

    state.a = 2
    expect(fn).toHaveBeenCalledTimes(1) // 已停止，不再响应

    runner() // 手动调用仍然执行 fn，但不会重新收集依赖订阅
    expect(fn).toHaveBeenCalledTimes(2)
    state.a = 3
    expect(fn).toHaveBeenCalledTimes(2) // 依然不会被自动触发
  })

  it('pause() 冻结通知，resume() 后补跑一次', () => {
    const state = reactive({ a: 1 })
    const fn = vi.fn(() => state.a)
    const runner = effect(fn)
    runner.effect.pause()

    state.a = 2
    expect(fn).toHaveBeenCalledTimes(1) // 暂停期间不执行

    runner.effect.resume()
    expect(fn).toHaveBeenCalledTimes(2) // 恢复时补跑一次
  })

  it('onStop 回调在 stop() 时触发一次', () => {
    const onStop = vi.fn()
    const runner = effect(() => 1, { onStop })
    stop(runner)
    expect(onStop).toHaveBeenCalledTimes(1)
    stop(runner) // 重复 stop 不应该重复触发
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})

describe('批处理：一次改动触发多个 key，effect 只跑一次', () => {
  it('push 一次性改变多个索引 + length，effect 只重新执行一次', () => {
    const list = reactive<number[]>([1, 2, 3])
    const fn = vi.fn(() => list.length)
    effect(fn)
    expect(fn).toHaveBeenCalledTimes(1)

    list.push(4, 5, 6) // 3 个新索引 + 1 次 length 变化，仍然只触发 1 次 run
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('pauseTracking/resetTracking 可以临时关闭依赖收集', () => {
    const state = reactive({ a: 1, b: 2 })
    const fn = vi.fn(() => {
      pauseTracking()
      const sum = state.a + state.b
      resetTracking()
      return sum
    })
    effect(fn)
    state.a = 10
    state.b = 20
    expect(fn).toHaveBeenCalledTimes(1) // a/b 都没有被真正追踪，不会触发重新执行
  })
})

describe('EffectFlags', () => {
  it('新建的 effect 默认带有 ACTIVE | TRACKING 标记', () => {
    const runner = effect(() => 1)
    expect(runner.effect.flags & EffectFlags.ACTIVE).toBeTruthy()
    expect(runner.effect.flags & EffectFlags.TRACKING).toBeTruthy()
  })
})

function depKeys(sub: { deps?: any }): unknown[] {
  const keys: unknown[] = []
  for (let link = sub.deps; link; link = link.nextDep) keys.push(link.dep.key)
  return keys
}
