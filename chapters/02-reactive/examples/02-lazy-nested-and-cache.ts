/**
 * 运行：pnpm ex chapters/02-reactive/examples/02-lazy-nested-and-cache.ts
 * 演示：reactive() 的“懒代理”——嵌套对象只有被访问到才会现场转成 Proxy；同一个原始对象无论
 *       调用多少次 reactive() 都复用同一个 Proxy（四张 proxyMap 之一）；markRaw/toRaw 的逃生舱；
 *       readonly(reactive(x)) 与 reactive(readonly(x)) 的差异。
 * 看点：用 Proxy !== 原始对象 的身份判断，观察“访问之前”和“访问之后”的区别；
 *       以及 isReactive/isReadonly/isProxy/isShallow 四个判断函数分别在说什么。
 */
import { reactive, readonly, markRaw, toRaw, isReactive, isReadonly, isProxy, isShallow, shallowReactive } from 'vue'
import { section, step, log, expectEq } from '../../../shared/print'

section('1. 懒代理：嵌套对象在没被访问之前，“原始引用”并不是 reactive')
{
  const rawNested = { count: 0 }
  const state = reactive({ nested: rawNested })

  step('直接检查原始对象本身')
  expectEq('isReactive(rawNested)', isReactive(rawNested), false)

  step('通过 state.nested 访问一次（触发 baseHandlers.get 里的 reactive(res)）')
  const nested1 = state.nested
  expectEq('isReactive(state.nested)', isReactive(nested1), true)
  expectEq('toRaw(state.nested) === rawNested', toRaw(nested1) === rawNested, true)

  step('再访问一次 state.nested，看是不是同一个 Proxy')
  const nested2 = state.nested
  expectEq('两次访问拿到同一个 Proxy', nested1 === nested2, true)
  log('原理：第二次访问时，reactive(rawNested) 内部会在 reactiveMap 里查到第一次创建的 Proxy，直接复用')
}

section('2. 同一个原始对象，reactive() 多次调用返回同一个 Proxy')
{
  const raw = { a: 1 }
  const p1 = reactive(raw)
  const p2 = reactive(raw)
  expectEq('reactive(raw) === reactive(raw)', p1 === p2, true)

  step('对 Proxy 再调用一次 reactive()，也直接返回它自己（createReactiveObject 里 target[RAW] 的判断）')
  const p3 = reactive(p1)
  expectEq('reactive(p1) === p1', p3 === p1, true)
}

section('3. markRaw：彻底跳过代理，即使嵌套在 reactive 对象里也不转换')
{
  class ThirdPartyInstance {
    constructor(public id: number) {}
  }
  const raw = markRaw(new ThirdPartyInstance(1))
  const state = reactive({ lib: raw })

  expectEq('isReactive(state.lib)', isReactive(state.lib), false)
  expectEq('state.lib === raw（没有被包成新的 Proxy）', state.lib === raw, true)
  log('典型场景：第三方类实例（如 echarts 的 chart 对象）塞进 reactive 状态里，又不想被 Proxy 包一层时用 markRaw')
}

section('4. toRaw：拿到原始对象，绕过 get/set 陷阱')
{
  const state = reactive({ a: 1 })
  const raw = toRaw(state)
  expectEq('toRaw(state) !== state', raw !== (state as any), true)
  expectEq('toRaw(toRaw(state)) === toRaw(state)（递归解包，多层代理也只剥到底层原始对象）', toRaw(raw) === raw, true)

  step('用 toRaw 读写不会触发 track/trigger —— 常用于“批量初始化，不想触发一堆 effect”的场景')
  log('（这里不方便直接打印“有没有触发”，第 5 章会用 onTrack/onTrigger 更直接地证明这一点）')
}

section('5. readonly(reactive(x)) vs reactive(readonly(x))：组合顺序决定身份')
{
  const base = { count: 0 }

  step('readonly(reactive(base))：先 reactive 再 readonly，两个身份都在')
  const r1 = reactive(base)
  const ro1 = readonly(r1)
  expectEq('isReactive(ro1)', isReactive(ro1), true) // 因为 ro1[RAW] 指向 r1，isReactive 会顺着 RAW 继续判断
  expectEq('isReadonly(ro1)', isReadonly(ro1), true)
  expectEq('isProxy(ro1)', isProxy(ro1), true)

  step('直接 readonly(base)（没有先 reactive）：只有 readonly 身份，没有 reactive 身份')
  const ro2 = readonly(base)
  expectEq('isReactive(ro2)', isReactive(ro2), false)
  expectEq('isReadonly(ro2)', isReadonly(ro2), true)

  step('reactive(readonly(base))：reactive() 入口处特判 isReadonly(target) 直接原样返回')
  const weird = reactive(ro2 as any)
  expectEq('reactive(readonly(x)) === readonly(x)（直接返回，不会再包一层）', weird === ro2, true)
  log('源码位置：packages/reactivity/src/reactive.ts#L88-L91，reactive() 的第一行就是 `if (isReadonly(target)) return target`')
}

section('6. isShallow：shallowReactive 只影响“根层”')
{
  const state = shallowReactive({ nested: { a: 1 } })
  expectEq('isShallow(state)', isShallow(state), true)
  expectEq('isReactive(state.nested)（嵌套对象完全不代理）', isReactive(state.nested), false)
}
