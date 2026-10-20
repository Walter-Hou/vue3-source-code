import { describe, expect, it, vi } from 'vitest'
import { computed } from './computed'
import { effect } from './effect'
import { ref } from './ref'

describe('computed()：懒计算与缓存', () => {
  it('不访问 .value 就不会执行 getter', () => {
    const getter = vi.fn(() => 1)
    computed(getter)
    expect(getter).not.toHaveBeenCalled()
  })

  it('依赖不变时，多次访问 .value 只计算一次', () => {
    const r = ref(1)
    const getter = vi.fn(() => r.value * 2)
    const c = computed(getter)
    expect(c.value).toBe(2)
    expect(c.value).toBe(2)
    expect(c.value).toBe(2)
    expect(getter).toHaveBeenCalledTimes(1)
  })

  it('依赖变化后，下次访问才会重新计算（惰性，不是依赖变了立刻算）', () => {
    const r = ref(1)
    const getter = vi.fn(() => r.value * 2)
    const c = computed(getter)
    c.value
    r.value = 2
    expect(getter).toHaveBeenCalledTimes(1) // 还没访问 .value，不会重算
    expect(c.value).toBe(4)
    expect(getter).toHaveBeenCalledTimes(2)
  })

  it('computed 可以被 effect 订阅，依赖变化会让 effect 重新运行', () => {
    const r = ref(1)
    const c = computed(() => r.value * 2)
    const fn = vi.fn(() => c.value)
    effect(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    r.value = 2
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('计算结果不变时，即使依赖变了也不会通知下游 effect 重新运行', () => {
    const r = ref(1)
    const c = computed(() => (r.value > 0 ? 'positive' : 'non-positive'))
    const fn = vi.fn(() => c.value)
    effect(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    r.value = 2 // 依赖变了，但 computed 的值仍然是 'positive'
    expect(fn).toHaveBeenCalledTimes(1)
    r.value = -1 // 这次值真的变了
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('writable computed：set 走用户提供的 setter', () => {
    const r = ref(1)
    const c = computed({
      get: () => r.value * 2,
      set: v => (r.value = v / 2),
    })
    c.value = 10
    expect(r.value).toBe(5)
  })

  it('computed 链：a -> b -> c，只有真正变化的那一层才会继续往下传播', () => {
    const a = ref(1)
    const bGetter = vi.fn(() => a.value % 2) // 奇偶性
    const cGetter = vi.fn(() => `parity:${bGetter()}`)
    const b = computed(bGetter)
    const c = computed(() => `parity:${b.value}`)
    const fn = vi.fn(() => c.value)
    effect(fn)
    expect(fn).toHaveBeenCalledTimes(1)

    a.value = 3 // 1 -> 3，奇偶性不变（都是奇数），b 的值没变，c 不应该重新计算
    expect(c.value).toBe('parity:1')
    expect(fn).toHaveBeenCalledTimes(1)

    a.value = 4 // 奇偶性变了，b 的值变化，一路传播到 c 和 effect
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
