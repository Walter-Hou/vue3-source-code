/**
 * 运行：pnpm ex chapters/04-ref-computed-watch/examples/01-ref-internals.ts
 * 演示：RefImpl 的内部结构（_value/_rawValue/dep）；ref 包对象时内部自动变成 reactive；
 *       shallowRef + triggerRef 的组合；proxyRefs 对 setup() 返回值的自动解包。
 * 看点：直接打印 ref 实例本身（看 dep 字段），以及 ref(obj).value 和 reactive(obj) 的关系。
 */
import { ref, shallowRef, triggerRef, isRef, unref, proxyRefs, reactive, isReactive, effect } from 'vue'
import { section, step, log, expectEq } from '../../../shared/print'

section('1. RefImpl 的内部结构：_value / _rawValue / dep')
{
  const r = ref(0)
  log('ref(0) 实例本身的字段：', Object.keys(r as any))
  log('__v_isRef：', (r as any).__v_isRef, '  __v_isShallow：', (r as any).__v_isShallow)
  log('内部的 dep 是不是一个独立的 Dep 实例（不挂在 targetMap 上，是 ref 自己持有的）：', !!(r as any).dep)
}

section('2. ref 包对象：.value 会被 toReactive 转成 reactive 对象')
{
  const r = ref({ count: 0 })
  expectEq('r.value 是 reactive 的', isReactive(r.value), true)

  step('直接改 r.value.count（通过 reactive 代理的 set 陷阱）')
  let runs = 0
  effect(() => {
    runs++
    r.value.count
  })
  r.value.count++
  expectEq('能正常触发（因为 .value 本身是 reactive 对象）', runs, 2)

  step('整个替换 r.value：触发的是 ref 自己的 dep，不是 reactive 对象的 dep')
  r.value = { count: 100 }
  expectEq('替换整个对象也能触发', runs, 3)
}

section('3. shallowRef：不自动转 reactive，内部变化不可见')
{
  const sr = shallowRef({ count: 0 })
  expectEq('shallowRef 包的对象不是 reactive', isReactive(sr.value), false)

  let runs = 0
  effect(() => {
    runs++
    sr.value.count
  })
  sr.value.count = 1 // 直接改内部属性：因为 sr.value 不是 reactive 对象，这个赋值走的是普通对象的属性赋值
  expectEq('内部变化不可见，不触发', runs, 1)

  step('triggerRef：手动强制通知，哪怕值的引用没变')
  triggerRef(sr)
  expectEq('triggerRef 之后，强制触发了一次', runs, 2)
}

section('4. isRef / unref：类型判断与解包')
{
  const r = ref(1)
  const plain = 1
  expectEq('isRef(ref(1))', isRef(r), true)
  expectEq('isRef(1)', isRef(plain), false)
  expectEq('unref(ref(1))', unref(r), 1)
  expectEq('unref(1)', unref(plain), 1)
}

section('5. proxyRefs：setup() 返回值的自动解包机制')
{
  const raw = { count: ref(0), label: 'hi' }
  const exposed = proxyRefs(raw)

  step('读：自动解包，不需要 .count.value')
  expectEq('exposed.count 直接是数字', exposed.count, 0)

  step('写：自动写回内部的 ref.value')
  exposed.count = 10
  expectEq('写回去之后，原始 ref 的 .value 也变了', raw.count.value, 10)

  step('对比：reactive 对象传进 proxyRefs，原样返回（reactive 自己就有解包能力）')
  const r = reactive({ count: ref(0) })
  expectEq('reactive 对象本身就会自动解包', r.count, 0)
  expectEq('proxyRefs(reactive对象) === 原对象', proxyRefs(r) === r, true)
}
