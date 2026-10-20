/**
 * 运行：pnpm ex chapters/02-reactive/examples/03-array-instrumentations.ts
 * 演示：arrayInstrumentations.ts 里三类特殊处理——
 *       (1) includes/indexOf 对 reactive 元素做“先按原样查、找不到再退化成 raw 查”；
 *       (2) 在 effect 里调用 push，不会死循环（pauseTracking + startBatch）；
 *       (3) forEach/map 等只产生一次 ARRAY_ITERATE_KEY 依赖，而不是给每个元素单独建依赖。
 * 看点：第 2 组的运行次数计数器——如果没有 pauseTracking，这里会无限循环直到栈溢出。
 */
import { reactive, effect, toRaw } from 'vue'
import { section, step, log, expectEq } from '../../../shared/print'

section('1. includes/indexOf：reactive 数组里的对象元素')
{
  const rawItem = { id: 1 }
  const list = reactive([rawItem, { id: 2 }])

  step('用原始对象 rawItem 去 includes —— 它在数组里实际上已经被包成另一个 Proxy 了')
  const got = list[0]
  expectEq('list[0] === rawItem（直接下标访问，天然是同一个代理）', got === rawItem, false)
  expectEq('list.includes(rawItem) 仍然能找到', list.includes(rawItem), true)
  log('原理：arrayInstrumentations.includes -> searchProxy，先用原始参数查一次原生数组，')
  log('找不到（因为数组里存的是 reactive(rawItem) 这个新 Proxy，不是 rawItem 本身）就再 toRaw(args[0]) 查一次')

  step('indexOf 同理')
  expectEq('list.indexOf(rawItem)', list.indexOf(rawItem), 0)
}

section('2. 在 effect 里 push：不会死循环（两道保险，缺一都不够）')
{
  const list = reactive<number[]>([1, 2, 3])
  let runs = 0

  const runner = effect(() => {
    runs++
    list.length // 显式读一次 length，建立一条真实的依赖（故意的，为了让下面的推理可观察）
    // push 内部等价于 `this[length] = x; this.length++`——如果这两步都正常触发 track/trigger，
    // “自己写 length 又通知自己”就会在这一行原地死循环
    list.push(runs)
  })

  expectEq('effect 初始只运行了 1 次（而不是卡死）', runs, 1)
  log('push 之后的数组：', toRaw(list))

  step('保险 1：pauseTracking —— push 执行期间关闭 track，不会为“内部读 length”重新建依赖')
  log('   （这里的依赖只有一条，就是上面显式读的那次 list.length，不会因为 push 内部的读写而增生）')

  step('保险 2：ReactiveEffect.notify() 的 RUNNING 标记 —— 自己正在跑的时候，自己触发自己会被直接丢弃')
  log('   push 让 length 变化 -> trigger 通知到这个 effect 自己 -> notify() 发现 flags 里有 RUNNING 且没开 ALLOW_RECURSE -> 直接 return')
  log('   注意：这不是“延后执行”，是“这次通知被彻底忽略”，所以 runs 不会因为这次自触发而增加')

  step('从外部再 push 一次，验证 effect 确实还活着、并且会对外部变化做出反应')
  list.push(999)
  expectEq('外部触发让 effect 又运行了一次', runs, 2)
  runner.effect.stop()
}

section('3. forEach / map：只追踪一次 ARRAY_ITERATE_KEY，不是“每个元素一个依赖”')
{
  const list = reactive([1, 2, 3])
  let forEachRuns = 0

  effect(() => {
    forEachRuns++
    let sum = 0
    list.forEach(n => (sum += n))
  })
  expectEq('初始运行 1 次', forEachRuns, 1)

  step('修改某个索引的值：forEach 内部读过所有元素，所以索引变化也会触发')
  list[1] = 20
  expectEq('forEach 对索引变化有反应', forEachRuns, 2)

  step('关键对比：不修改任何元素，只是整体替换成另一个等长数组（length 不变，ARRAY_ITERATE_KEY 不变）')
  // 这里特意不做这一步真实赋值（会整体替换引用，不在 ARRAY_ITERATE_KEY 的讨论范围内）
  // 换成一个更能说明问题的操作：给数组追加一个新元素，只会新增一个 ADD + length 变化
  list.push(4)
  expectEq('追加新元素也会让 forEach 重新执行（新增索引触发 ADD -> 影响 ARRAY_ITERATE_KEY 吗？见下方源码解释）', forEachRuns, 3)
  log('源码里 ADD 分支只在“不是数组”或“数组的 length 变化”时才会牵动 ARRAY_ITERATE_KEY；')
  log('这里 forEach 重新运行，根因是 push 本身也会 trigger("length")，而 forEach 的 apply() 读取过 shallowReadArray(self)，')
  log('该函数对数组整体 track 的是 ARRAY_ITERATE_KEY —— 而 trigger 阶段，isArrayIndex 为真时会 run(depsMap.get(ARRAY_ITERATE_KEY))')
  log('（dep.ts#L353-L356：对任何数字下标的变化都顺带触发 ARRAY_ITERATE_KEY，这正是 forEach 能感知新增元素的原因）')
}

section('4. map 的返回值是全新数组，元素也会被重新包一层 reactive')
{
  const list = reactive([{ v: 1 }, { v: 2 }])
  const mapped = list.map(item => item)
  log('mapped[0] 是否是 reactive：', (mapped[0] as any).__v_isReactive === true)
}
