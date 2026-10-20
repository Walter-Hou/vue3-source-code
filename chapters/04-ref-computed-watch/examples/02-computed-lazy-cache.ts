/**
 * 运行：pnpm ex chapters/04-ref-computed-watch/examples/02-computed-lazy-cache.ts
 * 演示：computed 的懒计算（不访问 .value 不执行 getter）、缓存（依赖不变多次访问只算一次）、
 *       以及"依赖变了但值没变"时不会重新计算下游（惰性 + 结果比较双重优化）。
 * 看点：用一个计数器包住 getter，直接数"到底算了几次"。
 */
import { ref, computed, effect } from 'vue'
import { section, step, log, expectEq } from '../../../shared/print'

section('1. 不访问 .value，getter 完全不执行')
{
  let calls = 0
  const c = computed(() => {
    calls++
    return 1
  })
  log('computed 创建后，getter 执行次数：', calls)
  expectEq('还没访问 .value，getter 没执行', calls, 0)

  step('第一次访问 .value')
  c.value
  expectEq('访问一次，getter 执行一次', calls, 1)
}

section('2. 依赖不变，多次访问只计算一次（缓存）')
{
  const r = ref(1)
  let calls = 0
  const c = computed(() => {
    calls++
    return r.value * 2
  })
  c.value
  c.value
  c.value
  expectEq('访问 3 次 .value，只计算了 1 次', calls, 1)
}

section('3. 惰性重算：依赖变化后不会立刻重算，等下次访问才算')
{
  const r = ref(1)
  let calls = 0
  const c = computed(() => {
    calls++
    return r.value * 2
  })
  c.value
  expectEq('初次访问计算 1 次', calls, 1)

  r.value = 2 // 依赖变了
  expectEq('依赖变化后，还没有人访问 .value，getter 没有被重新执行', calls, 1)

  step('这时候才访问 .value')
  expectEq('访问时才重新计算', c.value, 4)
  expectEq('计算次数变成 2', calls, 2)
}

section('4. 依赖变化但结果不变：不会触发下游 effect')
{
  const r = ref(1)
  const c = computed(() => (r.value > 0 ? 'positive' : 'non-positive'))
  let effectRuns = 0
  effect(() => {
    effectRuns++
    c.value
  })
  expectEq('初始运行 1 次', effectRuns, 1)

  r.value = 2 // 依赖变了，但 c.value 还是 'positive'
  expectEq('结果没变，下游 effect 不会重新运行', effectRuns, 1)

  r.value = -1 // 这次结果真的变了
  expectEq('结果变了，下游 effect 才重新运行', effectRuns, 2)
}

section('5. writable computed：get/set 分离')
{
  const r = ref(1)
  const c = computed({
    get: () => r.value * 2,
    set: v => { r.value = v / 2 },
  })
  expectEq('读', c.value, 2)
  c.value = 10
  expectEq('写之后，底层 ref 被更新', r.value, 5)
  expectEq('再读，反映新的底层值', c.value, 10)
}

section('6. 没有 setter 的 computed，赋值会被拒绝（开发环境有 warning，这里只看值）')
{
  const r = ref(1)
  const c = computed(() => r.value * 2)
  ;(c as any).value = 100 // 直接赋值
  expectEq('只读 computed 赋值无效，值不变', c.value, 2)
}
