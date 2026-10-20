/**
 * 运行：pnpm ex chapters/04-ref-computed-watch/examples/03-computed-chain.ts
 * 演示：a -> b -> c 三层 computed 链式依赖，只有真正变化的那一层才会继续往下传播；
 *       打印每一层的计算次数，直观看到"值没变就不再往下传"的剪枝效果。
 * 看点：一个容易被误解的细节——如果链条顶端挂着一个没有 scheduler 的 effect，
 *       a 变化时中间层 b 会被“提前”重算（不是等到用户代码读 c.value 才算），
 *       但只要 b 的结果没变，c 仍然不会被重算、effect 也不会重新运行。
 *       这是 isDirty() 递归调用 refreshComputed() 的必然结果，不是实现 bug。
 */
import { ref, computed, effect } from 'vue'
import { section, step, log, expectEq } from '../../../shared/print'

section('1. a -> b -> c 链式依赖，奇偶性不变时在 c 这一层剪枝')
{
  const a = ref(1)
  let bCalls = 0
  let cCalls = 0
  const b = computed(() => {
    bCalls++
    return a.value % 2 === 0 ? 'even' : 'odd'
  })
  const c = computed(() => {
    cCalls++
    return `parity:${b.value}`
  })
  let effectRuns = 0
  effect(() => {
    effectRuns++
    c.value
  })

  log('初始：bCalls=', bCalls, 'cCalls=', cCalls, 'effectRuns=', effectRuns)
  expectEq('初始都算了一次', [bCalls, cCalls, effectRuns], [1, 1, 1])

  step('a: 1 -> 3（奇数变奇数，b 的结果不变）—— 注意：这里还没有读任何 .value')
  a.value = 3
  log('a.value=3 这条语句执行完之后，立刻看 bCalls/cCalls（还没有手动读过 c.value！）：')
  log('bCalls=', bCalls, 'cCalls=', cCalls)
  expectEq('b 已经被重算了——因为链条顶端有个没有 scheduler 的 effect，trigger 阶段会同步级联检查', bCalls, 2)
  expectEq('但 c 没有被重算：refreshComputed(b) 发现值没变，isDirty(c) 判定为不脏，提前返回', cCalls, 1)
  expectEq('effect 自然也不会重新运行', effectRuns, 1)
  log('原理：effect 没有 scheduler，trigger 时会同步 runIfDirty() -> isDirty(effect)；')
  log('isDirty 发现它依赖的 c 是个 computed，于是调用 refreshComputed(c)；')
  log('refreshComputed(c) 要判断"c 是否需要重算"，又得先知道"c 依赖的 b 是否变了"，于是递归 refreshComputed(b)；')
  log('b 被迫提前算出新值，但新值和旧值一样（hasChanged=false），b.dep.version 不变 -> c 判定不脏 -> c 自己不会被重算')

  step('a: 3 -> 4（奇数变偶数，b 的结果真的变了）')
  a.value = 4
  expectEq('这次 effect 会重新运行', effectRuns, 2)
  log('最终：bCalls=', bCalls, 'cCalls=', cCalls, 'effectRuns=', effectRuns)
}

section('2. 对比组：链条顶端没有任何 effect，computed 才是真正"完全懒"的')
{
  const a = ref(1)
  let bCalls = 0
  let cCalls = 0
  const b = computed(() => {
    bCalls++
    return a.value % 2 === 0 ? 'even' : 'odd'
  })
  const c = computed(() => {
    cCalls++
    return `parity:${b.value}`
  })
  // 注意：这里没有任何 effect/watch 订阅 c，c 和 b 都只是“挂在那里”的 ComputedRefImpl

  c.value // 先访问一次，建立 a -> b -> c 的依赖链
  expectEq('访问一次，b/c 各算一次', [bCalls, cCalls], [1, 1])

  step('改 a，但完全不访问 b.value / c.value')
  a.value = 3
  log('a.value=3 之后，没有任何代码读 b/c：bCalls=', bCalls, 'cCalls=', cCalls)
  expectEq('没有 effect 在场，b 完全不会被提前计算——这才是"纯粹的懒"', bCalls, 1)

  step('现在才去读 c.value')
  c.value
  expectEq('访问时才重算 b', bCalls, 2)
  log('cCalls=', cCalls, '(c 会不会被重算，取决于 b 的新值是否真的变了，这里 1->3 都是奇数，c 应该还是 1)')
  expectEq('b 的值没变，c 也不会被重算', cCalls, 1)
}

section('3. 税费计算：两个 computed 共享同一个源，互不影响')
{
  const price = ref(100)
  const taxRate = ref(0.1)
  let taxCalls = 0
  let totalCalls = 0

  const tax = computed(() => {
    taxCalls++
    return Math.round(price.value * taxRate.value)
  })
  const total = computed(() => {
    totalCalls++
    return price.value + tax.value
  })

  total.value
  expectEq('初始各算一次', [taxCalls, totalCalls], [1, 1])

  step('改价格：tax 和 total 都直接依赖 price，两个都要重算')
  price.value = 200
  total.value
  expectEq('tax 被重算', taxCalls, 2)
  expectEq('total 也被重算（它自己也直接读了 price.value，不只是依赖 tax）', totalCalls, 2)
}
