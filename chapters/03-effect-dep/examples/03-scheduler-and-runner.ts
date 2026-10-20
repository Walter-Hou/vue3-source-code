/**
 * 运行：pnpm ex chapters/03-effect-dep/examples/03-scheduler-and-runner.ts
 * 演示：scheduler 选项如何接管"依赖变化之后要做什么"；effect() 返回的 runner 可以手动重跑
 *       并拿到返回值；stop() 之后依赖关系被物理清除；pause()/resume() 的"冻结期间的变化在
 *       恢复时补发一次"语义。
 * 看点：有 scheduler 时，依赖变化不会自动重跑 fn，而是把控制权交给 scheduler——这正是
 *       渲染场景下"依赖变了不代表立刻同步重新渲染"的来源（第 08 章调度器会在这个基础上展开）。
 */
import { reactive, effect, stop } from 'vue'
import { section, step, log, expectEq } from '../../../shared/print'

section('1. scheduler：接管"依赖变化之后做什么"')
{
  const state = reactive({ count: 0 })
  let fnRuns = 0
  let schedulerCalls = 0
  let pendingJob: (() => void) | null = null

  const runner = effect(
    () => {
      fnRuns++
      return state.count
    },
    {
      scheduler() {
        schedulerCalls++
        // 典型用法：不立刻重跑，攒到"下一帧"再统一跑（这里用一个变量模拟队列）
        pendingJob = () => runner()
      },
    },
  )

  expectEq('初始运行 1 次', fnRuns, 1)
  state.count++
  expectEq('依赖变化后，fn 本身没有被自动重跑', fnRuns, 1)
  expectEq('但 scheduler 被调用了', schedulerCalls, 1)

  step('手动执行"队列里"的任务，这时才真正重跑 fn')
  pendingJob!()
  expectEq('手动触发 pendingJob 之后，fn 才重跑', fnRuns, 2)
}

section('2. runner()：拿到返回值，可以当成"手动重新求值"来用')
{
  const state = reactive({ price: 10, qty: 3 })
  const runner = effect(() => state.price * state.qty)
  expectEq('runner() 返回 fn 的返回值', runner(), 30)

  state.qty = 5
  expectEq('依赖变化后，手动调用 runner() 拿到最新值', runner(), 50)
}

section('3. stop()：物理清除依赖关系，而不是"打个标记忽略"')
{
  const state = reactive({ a: 1 })
  let runs = 0
  const runner = effect(() => {
    runs++
    state.a
  })
  expectEq('初始运行 1 次', runs, 1)

  step('stop 之后，depsTail 应该被清空（stop() 会遍历 deps 调用 removeSub，再把 deps/depsTail 都置空）')
  stop(runner)
  // deps 是 @internal 字段，公开的 .d.ts 里没有声明（被 api-extractor 裁掉），
  // 但运行时确实存在，这里用 any 绕过类型声明去访问它。
  const effectAny = runner.effect as any
  log('stop 后 runner.effect.deps：', effectAny.deps)
  expectEq('deps 被清空', effectAny.deps, undefined)

  state.a = 999
  expectEq('依赖变化不再触发（因为这个 effect 已经不在任何 Dep 的 subs 链表里了）', runs, 1)

  step('手动调用 runner() 仍然会执行 fn 本体（ReactiveEffect.run() 对非 ACTIVE 状态的特殊处理）')
  runner()
  expectEq('手动调用仍然执行，但不会重新建立订阅', runs, 2)
  state.a = 1000
  expectEq('再次修改 a，不会触发（订阅没有恢复）', runs, 2)
}

section('4. pause() / resume()：冻结期间的变化在恢复时补发一次')
{
  const state = reactive({ a: 1 })
  let runs = 0
  const runner = effect(() => {
    runs++
    state.a
  })

  step('pause：之后的依赖变化不会立刻触发')
  runner.effect.pause()
  state.a = 2
  state.a = 3
  state.a = 4 // 期间改了 3 次
  expectEq('pause 期间完全不触发（哪怕改了好几次）', runs, 1)

  step('resume：补跑一次（不是补跑 3 次——因为 trigger 时只是把这个 effect 记进了"暂停队列"，是个去重的 WeakSet）')
  runner.effect.resume()
  expectEq('resume 之后只补跑了 1 次', runs, 2)
  log('最终值：', state.a)
}

section('5. onStop：effect 停止时的回调')
{
  const onStopCalls: string[] = []
  const runner = effect(() => 1, {
    onStop() {
      onStopCalls.push('stopped')
    },
  })
  stop(runner)
  stop(runner) // 重复 stop
  expectEq('onStop 只触发一次（EffectFlags.ACTIVE 被清除后，再次 stop 直接短路）', onStopCalls.length, 1)
}
