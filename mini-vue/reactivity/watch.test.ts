import { describe, expect, it, vi } from 'vitest'
import { reactive } from './reactive'
import { ref } from './ref'
import { onWatcherCleanup, traverse, watch } from './watch'

describe('watch()：source 规范化', () => {
  it('watch ref：回调拿到新旧值', () => {
    const r = ref(1)
    const cb = vi.fn()
    watch(r, cb)
    r.value = 2
    expect(cb).toHaveBeenCalledWith(2, 1, expect.any(Function))
  })

  it('watch getter：只有 getter 读到的属性变化才触发', () => {
    const state = reactive({ a: 1, b: 2 })
    const cb = vi.fn()
    watch(() => state.a, cb)
    state.b = 100
    expect(cb).not.toHaveBeenCalled()
    state.a = 2
    expect(cb).toHaveBeenCalledWith(2, 1, expect.any(Function))
  })

  it('watch 多个 source（数组）：回调拿到值数组', () => {
    const a = ref(1)
    const b = ref(2)
    const cb = vi.fn()
    watch([a, b], cb)
    a.value = 10
    expect(cb).toHaveBeenCalledWith([10, 2], [1, 2], expect.any(Function))
  })

  it('watch reactive 对象：默认深度遍历，嵌套属性变化也会触发', () => {
    const state = reactive({ nested: { a: 1 } })
    const cb = vi.fn()
    watch(state, cb)
    state.nested.a = 2
    expect(cb).toHaveBeenCalledTimes(1)
  })
})

describe('watch()：immediate / once', () => {
  it('immediate: true 时，watch 创建时立刻执行一次，oldValue 为 undefined', () => {
    const r = ref(1)
    const cb = vi.fn()
    watch(r, cb, { immediate: true })
    expect(cb).toHaveBeenCalledWith(1, undefined, expect.any(Function))
    r.value = 2
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('once: true 时，回调只触发一次，之后自动 stop', () => {
    const r = ref(1)
    const cb = vi.fn()
    watch(r, cb, { once: true })
    r.value = 2
    r.value = 3
    expect(cb).toHaveBeenCalledTimes(1)
  })
})

describe('watch()：deep 选项', () => {
  it('watch 一个 getter 函数：默认不 deep，只有 getter 返回值本身变化才触发', () => {
    const state = reactive({ nested: { a: 1 } })
    const cb = vi.fn()
    watch(() => state.nested, cb) // getter 只返回 state.nested 这个引用，没有 deep 选项就不会往下遍历
    state.nested.a = 2 // 只改了嵌套属性，没有替换 state.nested 本身，getter 返回值的引用没变
    expect(cb).not.toHaveBeenCalled()
    state.nested = { a: 3 } // 替换了整个对象，getter 返回值变化
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('deep: true 时，嵌套属性变化也能触发', () => {
    const state = reactive({ nested: { a: 1 } })
    const cb = vi.fn()
    watch(() => state.nested, cb, { deep: true })
    state.nested.a = 2
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('deep: 1 限定遍历层级，更深层的变化不会被发现', () => {
    const state = reactive({ a: { b: { c: 1 } } })
    const cb = vi.fn()
    watch(() => state.a, cb, { deep: 1 })
    state.a.b.c = 2 // 第二层才变化，deep:1 只遍历到 a.b，没有深入 a.b.c
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('onWatcherCleanup / stop / pause-resume', () => {
  it('下次回调执行前会先调用上一次注册的 cleanup', () => {
    const r = ref(1)
    const order: string[] = []
    watch(r, (v, _ov, onCleanup) => {
      order.push(`run:${v}`)
      onCleanup(() => order.push(`cleanup:${v}`))
    })
    r.value = 2
    r.value = 3
    expect(order).toEqual(['run:2', 'cleanup:2', 'run:3'])
  })

  it('stop() 之后不再响应变化', () => {
    const r = ref(1)
    const cb = vi.fn()
    const handle = watch(r, cb)
    handle.stop()
    r.value = 2
    expect(cb).not.toHaveBeenCalled()
  })

  it('onWatcherCleanup 作为独立函数调用时，绑定到当前 activeWatcher', () => {
    const r = ref(1)
    const order: string[] = []
    watch(r, v => {
      order.push(`run:${v}`)
      onWatcherCleanup(() => order.push(`cleanup:${v}`))
    })
    r.value = 2
    expect(order).toEqual(['run:2'])
    r.value = 3
    expect(order).toEqual(['run:2', 'cleanup:2', 'run:3'])
  })
})

describe('traverse()', () => {
  it('遍历对象所有层级，支持循环引用检测', () => {
    const a: any = { b: { c: 1 } }
    a.self = a // 循环引用
    expect(() => traverse(a)).not.toThrow()
  })
})
