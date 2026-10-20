import { describe, expect, it, vi } from 'vitest'
import { effect } from './effect'
import { EffectScope, effectScope, getCurrentScope, onScopeDispose } from './effectScope'
import { reactive } from './reactive'

describe('EffectScope', () => {
  it('scope.run() 内创建的 effect 会被收进 scope.effects', () => {
    const scope = effectScope()
    const state = reactive({ a: 1 })
    const fn = vi.fn(() => state.a)

    scope.run(() => {
      effect(fn)
    })

    expect(scope.effects).toHaveLength(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('scope.stop() 会停掉所有在它里面创建的 effect', () => {
    const scope = effectScope()
    const state = reactive({ a: 1 })
    const fn = vi.fn(() => state.a)
    scope.run(() => effect(fn))

    scope.stop()
    state.a = 2
    expect(fn).toHaveBeenCalledTimes(1) // 已经被 scope 级联 stop，不再响应
  })

  it('嵌套 scope：父 scope.stop() 会级联 stop 子 scope 及其 effect', () => {
    const parent = effectScope()
    let child!: EffectScope
    const state = reactive({ a: 1 })
    const childFn = vi.fn(() => state.a)

    parent.run(() => {
      child = effectScope()
      child.run(() => effect(childFn))
    })

    expect(parent.scopes).toHaveLength(1)
    parent.stop()
    expect(child.active).toBe(false)

    state.a = 2
    expect(childFn).toHaveBeenCalledTimes(1)
  })

  it('onScopeDispose 注册的回调在 stop() 时按顺序触发', () => {
    const scope = effectScope()
    const order: number[] = []
    scope.run(() => {
      onScopeDispose(() => order.push(1))
      onScopeDispose(() => order.push(2))
    })
    scope.stop()
    expect(order).toEqual([1, 2])
  })

  it('getCurrentScope() 只在 run() 执行期间返回当前 scope', () => {
    const scope = effectScope()
    expect(getCurrentScope()).toBeUndefined()
    let inside: EffectScope | undefined
    scope.run(() => {
      inside = getCurrentScope()
    })
    expect(inside).toBe(scope)
    expect(getCurrentScope()).toBeUndefined()
  })

  it('detached scope 不会被父 scope 的 stop 级联', () => {
    const parent = effectScope()
    let detached!: EffectScope
    parent.run(() => {
      detached = effectScope(true)
    })
    parent.stop()
    expect(detached.active).toBe(true)
    detached.stop()
  })
})
