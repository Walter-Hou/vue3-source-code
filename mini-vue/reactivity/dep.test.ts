import { describe, expect, it } from 'vitest'
import { Dep, targetMap } from './dep'
import { effect } from './effect'
import { reactive, toRaw } from './reactive'

describe('Dep / Link：版本号与双向链表', () => {
  it('每次 trigger 都会让 dep.version 自增', () => {
    const state = reactive({ a: 1 })
    effect(() => state.a)
    const dep = targetMap.get(toRaw(state))!.get('a')!
    expect(dep.version).toBe(0)
    state.a = 2
    expect(dep.version).toBe(1)
    state.a = 3
    expect(dep.version).toBe(2)
  })

  it('Link.version 在 run() 之后会被同步成 dep.version，这是 isDirty 判断的依据', () => {
    const state = reactive({ a: 1 })
    const runner = effect(() => state.a)
    const link = runner.effect.deps!
    const dep = link.dep
    expect(link.version).toBe(dep.version)

    state.a = 2 // dep.version++，effect 的 scheduler 为空所以同步 runIfDirty -> run，link.version 又被同步
    expect(link.version).toBe(dep.version)
  })

  it('同一个 dep 被多个 effect 订阅时，subs 是一条按 track 顺序尾插的链表', () => {
    const state = reactive({ a: 1 })
    const r1 = effect(() => state.a)
    const r2 = effect(() => state.a)
    const dep = targetMap.get(toRaw(state))!.get('a')!

    // dep.subs 是尾节点，顺着 prevSub 往前能走到最早订阅的那个
    expect(dep.subs!.sub).toBe(r2.effect)
    expect(dep.subs!.prevSub!.sub).toBe(r1.effect)
  })

  it('effect.stop() 之后，这个 effect 的 link 从 dep.subs 链表里被摘除', () => {
    const state = reactive({ a: 1 })
    const runner = effect(() => state.a)
    const dep = targetMap.get(toRaw(state))!.get('a')!
    expect(dep.sc).toBe(1)

    runner.effect.stop()
    expect(dep.sc).toBe(0)
  })

  it('最后一个订阅者离开且挂在 map 上时，Dep 会把自己从 targetMap 的内层 Map 里删除', () => {
    const state = reactive({ a: 1 })
    const raw = toRaw(state)
    const runner = effect(() => state.a)
    expect(targetMap.get(raw)!.has('a')).toBe(true)

    runner.effect.stop()
    expect(targetMap.get(raw)!.has('a')).toBe(false)
  })

  it('new Dep() 独立使用也能 track/trigger（不挂在任何 target 上，供 ref/computed 使用）', () => {
    const dep = new Dep()
    let value = 0
    effect(() => {
      dep.track()
      value++
    })
    expect(value).toBe(1)
    dep.trigger()
    expect(value).toBe(2)
  })
})
