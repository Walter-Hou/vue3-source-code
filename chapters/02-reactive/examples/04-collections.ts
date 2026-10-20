/**
 * 运行：pnpm ex chapters/02-reactive/examples/04-collections.ts
 * 演示：collectionHandlers.ts 对 Map/Set 的拦截粒度——get/set/add/delete/has/size/forEach/
 *       keys()/values()/entries() 分别追踪什么 key；MAP_KEY_ITERATE_KEY 与 ITERATE_KEY 的区别；
 *       以及为什么 Map/Set 必须用单独一套 handlers（不能复用 baseHandlers 的 get/set 陷阱）。
 * 看点：同一个 m.set('a', newValue)（key 不变只改 value），size/forEach/values() 会被触发，
 *       但 keys() 不会——这正是 ITERATE_KEY 和 MAP_KEY_ITERATE_KEY 两条依赖线分开的原因。
 */
import { reactive, effect } from 'vue'
import { section, step, log, expectEq } from '../../../shared/print'

section('1. 为什么 Map/Set 不能用 baseHandlers：方法内部不经过属性访问')
{
  const m = reactive(new Map([['a', 1]]))
  log('m.get —— 类型是', typeof (m as any).get, '；如果用 baseHandlers，Proxy.get("get") 会返回 Map.prototype.get')
  log('但 Map.prototype.get 内部用的是私有 slot 存数据，不经过 `this.a` 这种属性访问，Proxy 的 get/set 陷阱根本拦不到')
  log('所以 collectionHandlers 必须手写 get/set/add/delete/has/size/forEach 等方法，自己在方法体内调用 track/trigger')
}

section('2. get：只有真正访问的 key 建立依赖')
{
  const m = reactive(new Map<string, number>([['a', 1], ['b', 2]]))
  let runs = 0
  effect(() => {
    runs++
    m.get('a')
  })
  expectEq('初始运行 1 次', runs, 1)

  step('改 b（没被读过的 key）：不触发')
  m.set('b', 20)
  expectEq('改未读过的 key 不触发', runs, 1)

  step('改 a（读过的 key）：触发')
  m.set('a', 10)
  expectEq('改读过的 key 触发', runs, 2)
}

section('3. has：和 get 共用同一个 key 的 Dep（depsMap 按 key 分桶，不分 track 类型）')
{
  const m = reactive(new Map<string, number>())
  let runs = 0
  effect(() => {
    runs++
    m.has('x')
  })
  expectEq('初始运行 1 次', runs, 1)

  step('新增 key "x"：has 的判断结果会变化（false -> true），触发')
  m.set('x', 1)
  expectEq('has 依赖被新增 key 触发', runs, 2)
}

section('4. size / forEach：只改 value（不新增/删除 key）也会触发 —— Map 的特殊之处')
{
  const m = reactive(new Map<string, number>([['a', 1]]))
  let sizeRuns = 0
  let forEachRuns = 0
  effect(() => {
    sizeRuns++
    m.size
  })
  effect(() => {
    forEachRuns++
    m.forEach(() => {})
  })

  step('只改 value（a: 1 -> 100），数量没变，但 size 和 forEach 仍然触发')
  m.set('a', 100)
  expectEq('size 被纯改值触发', sizeRuns, 2)
  expectEq('forEach 被纯改值触发', forEachRuns, 2)
  log('源码位置 dep.ts trigger() 的 SET 分支：`if (isMap(target)) run(depsMap.get(ITERATE_KEY))`')
  log('原因：forEach(cb) 的回调会拿到 (value, key, map)，value 变了意味着 forEach 产出的内容也变了，')
  log('所以 Map 的 SET 必须牵动 ITERATE_KEY —— 这跟普通 Object 的 SET 完全不同（Object.set 不会动 ITERATE_KEY）')

  step('新增一个 key：同样触发（ADD 分支里 !targetIsArray 时总是 run(ITERATE_KEY)）')
  m.set('b', 2)
  expectEq('size 被新增 key 触发', sizeRuns, 3)
  expectEq('forEach 被新增 key 触发', forEachRuns, 3)
}

section('5. MAP_KEY_ITERATE_KEY：m.keys() 单独一条依赖，只关心“键集合”有没有变')
{
  const m = reactive(new Map<string, number>([['a', 1]]))
  let keysRuns = 0
  let valuesRuns = 0
  effect(() => {
    keysRuns++
    for (const _ of m.keys()) {
      // noop
    }
  })
  effect(() => {
    valuesRuns++
    for (const _ of m.values()) {
      // noop
    }
  })
  expectEq('初始各运行 1 次', keysRuns + valuesRuns, 2)

  step('只改 value，不新增/删除 key：keys() 不受影响，values() 受影响')
  m.set('a', 999)
  expectEq('keys() 不受纯改值影响（MAP_KEY_ITERATE_KEY 没有被 SET 分支触发）', keysRuns, 1)
  expectEq('values() 受纯改值影响（走的是 ITERATE_KEY）', valuesRuns, 2)

  step('新增一个 key：这次 keys() 也会触发了（ADD 分支里 isMap(target) 时额外 run(MAP_KEY_ITERATE_KEY)）')
  m.set('c', 1)
  expectEq('keys() 被新增 key 触发', keysRuns, 2)
  expectEq('values() 被新增 key 触发', valuesRuns, 3)

  log('源码位置：collectionHandlers.ts createIterableMethod 里 `isKeyOnly = method === "keys" && targetIsMap`')
  log('isKeyOnly 时 track 的是 MAP_KEY_ITERATE_KEY，否则（values/entries/Symbol.iterator）track 的是 ITERATE_KEY')
}

section('6. Set.add：和 Map 不同，Set 没有“只改 value 不改 key”这回事，add 相同值不触发')
{
  const s = reactive(new Set<number>([1, 2]))
  let runs = 0
  effect(() => {
    runs++
    s.has(3)
  })
  s.add(3)
  expectEq('Set.add 新增元素触发 has(3) 的依赖', runs, 2)
  s.add(3) // 重复添加，hadKey 已经是 true，代码直接 return，不会再 trigger
  expectEq('重复 add 相同元素不触发', runs, 2)
}
