import { describe, expect, it, vi } from 'vitest'
import { effect } from './effect'
import { isProxy, isReactive, isReadonly, markRaw, reactive, readonly, shallowReactive, shallowReadonly, toRaw } from './reactive'

describe('reactive()', () => {
  it('同一个 target 只会被代理一次（命中 proxyMap 缓存）', () => {
    const raw = { a: 1 }
    const p1 = reactive(raw)
    const p2 = reactive(raw)
    expect(p1).toBe(p2)
  })

  it('对已经是 reactive 的对象再调用 reactive，返回同一个 proxy', () => {
    const p = reactive({ a: 1 })
    expect(reactive(p)).toBe(p)
  })

  it('嵌套对象是懒代理：原始嵌套对象本身不是 reactive，访问到的那一层才是', () => {
    const rawNested = { a: 1 }
    const p = reactive({ nested: rawNested }) as any
    // 还没经过 get 陷阱包装的原始对象，本身并不是 reactive
    expect(isReactive(rawNested)).toBe(false)
    // 通过 p.nested 访问时才会现场 new Proxy(rawNested, ...)
    expect(isReactive(p.nested)).toBe(true)
    expect(toRaw(p.nested)).toBe(rawNested)
    // 同一个 key 多次访问拿到的是同一个代理对象（因为 reactive() 内部也走 proxyMap 缓存）
    expect(p.nested).toBe(p.nested)
  })

  it('markRaw 标记的对象不会被 reactive 转换，即使嵌套在 reactive 对象里', () => {
    const raw = markRaw({ a: 1 })
    const p = reactive({ child: raw }) as any
    expect(isReactive(p.child)).toBe(false)
    expect(p.child).toBe(raw)
  })

  it('toRaw 拿到原始对象，toRaw(toRaw(x)) 等价于 toRaw(x)', () => {
    const raw = { a: 1 }
    const p = reactive(raw)
    expect(toRaw(p)).toBe(raw)
    expect(toRaw(raw)).toBe(raw)
  })

  it('isProxy 对 reactive/readonly 都返回 true，对原始对象返回 false', () => {
    const raw = { a: 1 }
    expect(isProxy(raw)).toBe(false)
    expect(isProxy(reactive(raw))).toBe(true)
    expect(isProxy(readonly(raw))).toBe(true)
  })

  it('新增属性触发依赖（ADD），delete 触发依赖（DELETE）', () => {
    const p = reactive<Record<string, number>>({ a: 1 })
    const fn = vi.fn(() => Object.keys(p))
    effect(fn)
    expect(fn).toHaveBeenCalledTimes(1)

    p.b = 2
    expect(fn).toHaveBeenCalledTimes(2)

    delete p.a
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('数组 push 新增索引触发 length 依赖', () => {
    const p = reactive<number[]>([1, 2])
    const fn = vi.fn(() => p.length)
    effect(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    p.push(3)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('shallowReactive()', () => {
  it('只有根层是响应式的，嵌套对象保持原样', () => {
    const p = shallowReactive({ nested: { a: 1 } })
    expect(isReactive(p.nested)).toBe(false)
    const fn = vi.fn(() => p.nested.a)
    effect(fn)
    p.nested.a = 2
    expect(fn).toHaveBeenCalledTimes(1) // 嵌套对象的属性不是响应式的，不会触发
  })
})

describe('readonly()', () => {
  it('readonly 对象不能被修改，值保持不变', () => {
    const p = readonly({ a: 1 }) as { a: number }
    p.a = 2
    expect(p.a).toBe(1)
  })

  it('isReadonly 对 readonly(reactive(x)) 也返回 true，且仍能从 reactive 侧触发追踪', () => {
    const r = reactive({ a: 1 })
    const ro = readonly(r) as { a: number }
    expect(isReadonly(ro)).toBe(true)
    expect(isReactive(ro)).toBe(true) // readonly(reactive(x)) 同时具备两个身份
    const fn = vi.fn(() => ro.a)
    effect(fn)
    r.a = 2 // 从可写的那一侧改
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('shallowReadonly()', () => {
  it('根层只读，嵌套对象仍可写', () => {
    const p = shallowReadonly({ nested: { a: 1 } }) as any
    p.nested.a = 2
    expect(p.nested.a).toBe(2)
    p.nested = {}
    expect(p.nested.a).toBe(2) // 根层赋值被拒绝，值不变
  })
})
