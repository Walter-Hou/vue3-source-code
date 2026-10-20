import { describe, expect, it, vi } from 'vitest'
import { effect } from './effect'
import { isReactive, reactive } from './reactive'
import { customRef, isRef, proxyRefs, ref, shallowRef, triggerRef, unref } from './ref'

describe('ref()', () => {
  it('.value 变化触发依赖，未变化（hasChanged 为 false）不触发', () => {
    const r = ref(1)
    const fn = vi.fn(() => r.value)
    effect(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    r.value = 1 // 没变化
    expect(fn).toHaveBeenCalledTimes(1)
    r.value = 2
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('ref 包对象时，.value 会被 toReactive 转成 reactive 对象', () => {
    const r = ref({ a: 1 })
    expect(isReactive(r.value)).toBe(true)
  })

  it('isRef 能识别 ref，对普通值/reactive 对象返回 false', () => {
    expect(isRef(ref(1))).toBe(true)
    expect(isRef(1)).toBe(false)
    expect(isRef(reactive({}))).toBe(false)
  })

  it('unref 对 ref 取 .value，对普通值原样返回', () => {
    expect(unref(ref(1))).toBe(1)
    expect(unref(1)).toBe(1)
  })
})

describe('shallowRef() / triggerRef()', () => {
  it('shallowRef 包对象时不会自动转成 reactive', () => {
    const r = shallowRef({ a: 1 })
    expect(isReactive(r.value)).toBe(false)
  })

  it('直接改 .value 内部属性不会触发依赖，triggerRef 可以强制触发', () => {
    const r = shallowRef({ a: 1 })
    const fn = vi.fn(() => r.value.a)
    effect(fn)
    r.value.a = 2
    expect(fn).toHaveBeenCalledTimes(1) // 内部变化不可见
    triggerRef(r)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('customRef()', () => {
  it('track/trigger 完全由用户控制，可以实现防抖等自定义逻辑', () => {
    let value = 0
    let triggerFn: () => void
    const r = customRef<number>((track, trigger) => ({
      get() {
        track()
        return value
      },
      set(v) {
        value = v
        triggerFn = trigger
        trigger()
      },
    }))

    const fn = vi.fn(() => r.value)
    effect(fn)
    r.value = 10
    expect(fn).toHaveBeenCalledTimes(2)
    expect(r.value).toBe(10)
  })
})

describe('proxyRefs()', () => {
  it('普通对象被包装后，读写属性自动解包/写回内部的 ref', () => {
    const raw = { a: ref(1), b: 2 }
    const p = proxyRefs(raw)
    expect(p.a).toBe(1) // 自动解包，不需要 .value
    p.a = 100
    expect(raw.a.value).toBe(100) // 写回了内部 ref
  })

  it('reactive 对象传入时原样返回（reactive 自身已经做了 ref 解包）', () => {
    const r = reactive({ a: ref(1) })
    expect(proxyRefs(r)).toBe(r)
  })
})
