/**
 * 运行：pnpm ex chapters/03-effect-dep/examples/04-batch.ts
 * 演示：一次操作牵出多个 key 的变化（数组 push/splice），依赖它们的 effect 只运行一次，
 *       而不是每个 key 触发一次——这是 startBatch/endBatch 机制的效果。
 * 看点：@vue/reactivity 没有把 startBatch/endBatch 作为公开 API 导出（查过 dist 的 .d.ts，
 *       确认只有内部使用），所以本例通过"一次 trigger 本身就会牵出多个 key"的真实场景
 *       （数组 splice）来证明批处理效果，而不是手动调用 startBatch/endBatch。
 */
import { reactive, effect } from 'vue'
import { section, step, log, expectEq } from '../../../shared/print'

section('1. splice 一次性影响多个索引 + length，effect 只跑一次')
{
  const list = reactive([1, 2, 3, 4, 5])
  let runs = 0
  const touchedKeys: string[] = []

  effect(
    () => {
      runs++
      list.length // 订阅 length
    },
    {
      onTrigger(e) {
        touchedKeys.push(String(e.key))
      },
    },
  )
  expectEq('初始运行 1 次', runs, 1)

  step('splice(1, 2) 删除中间两个元素：会牵动索引 1/2/3/4 的值 + length，但只应该 run 一次')
  touchedKeys.length = 0
  list.splice(1, 2)
  log('splice 之后的数组：', list.slice())
  log('导致 onTrigger 触发的次数：', touchedKeys.length, '（可能 >1，因为 splice 内部不止一次写操作）')
  expectEq('尽管内部多次写操作，effect 只重新运行了 1 次', runs, 2)
}

section('2. push 多个参数：一次调用，多次 ADD + 一次 length 变化，仍然只 run 一次')
{
  const list = reactive<number[]>([])
  let runs = 0
  effect(() => {
    runs++
    list.length
  })
  expectEq('初始运行 1 次', runs, 1)

  list.push(1, 2, 3, 4, 5) // 5 个新索引 + 1 次 length 变化
  expectEq('push 5 个元素，effect 仍然只运行 1 次', runs, 2)
}

section('3. 对比：如果不是同一次调用触发（分开写 5 次），则会运行 5 次')
{
  const state = reactive({ a: 0 })
  let runs = 0
  effect(() => {
    runs++
    state.a
  })
  expectEq('初始运行 1 次', runs, 1)

  for (let i = 1; i <= 5; i++) {
    state.a = i // 5 次独立的赋值语句，不在同一个"调用"里，没有机会被同一次 batch 合并
  }
  expectEq('5 次独立赋值，effect 运行了 5 次（这不是 batch 没生效，而是本来就是 5 次独立的 trigger 调用）', runs, 6)
  log('对比上面两组：batch 合并的前提是"多个 trigger 调用发生在同一次 startBatch/endBatch 包裹范围内"')
  log('（比如同一次 push/splice 内部的多次写操作），而不是"凡是短时间内的多次赋值都会自动合并"')
}

section('4. 反例：Object.assign 批量赋值——同一条语句，但效果是 3 次独立 trigger，不会合并')
{
  const state = reactive({ a: 1, b: 2, c: 3 })
  let runs = 0
  effect(() => {
    runs++
    state.a; state.b; state.c
  })
  expectEq('初始运行 1 次', runs, 1)

  Object.assign(state, { a: 10, b: 20, c: 30 }) // Object.assign 内部是 3 次独立的 Reflect.set
  log('Object.assign 修改 3 个属性后，effect 运行次数：', runs)
  expectEq('运行了 3 次，而不是 1 次——这正是 batch 没有自动生效的证据', runs, 4)
  log('关键区别：push/splice 的 noTracking() 显式地在整个操作外面包了一层 startBatch()/endBatch()，')
  log('内部多次 Reflect.set 产生的 trigger() 全部嵌套在这层 batch 里，直到最外层 endBatch 才真正 flush；')
  log('而 Object.assign 对每个属性的 set 都是独立的一次 trigger()，各自的 startBatch/endBatch 互不嵌套，')
  log('第一个属性触发时 batchDepth 就已经归零、effect 立刻重跑了——"同一条语句"不等于"同一次 batch"')
}
