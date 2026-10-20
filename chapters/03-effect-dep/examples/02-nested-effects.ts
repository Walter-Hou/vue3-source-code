/**
 * 运行：pnpm ex chapters/03-effect-dep/examples/02-nested-effects.ts
 * 演示：effect 嵌套时，activeSub 的保存与恢复——外层 effect 在执行到一半时创建内层 effect，
 *       内层运行完必须把 activeSub 还原成外层，否则外层剩下的代码会把依赖错误地记到内层头上。
 * 看点：用一个"陷阱属性"验证——如果 activeSub 恢复错了，外层 effect 访问的属性会被内层"偷走"。
 */
import { reactive, effect } from 'vue'
import { section, step, log, expectEq } from '../../../shared/print'

function depKeys(e: any): string[] {
  const keys: string[] = []
  for (let link = e.deps; link; link = link.nextDep) keys.push(String(link.dep.key))
  return keys
}

section('1. 嵌套 effect：执行顺序与 activeSub 的保存/恢复')
{
  const state = reactive({ outer1: 1, outer2: 2, inner: 1 })
  const order: string[] = []

  const outerRunner = effect(() => {
    order.push('outer-start')
    state.outer1 // 外层读第一个属性
    effect(() => {
      order.push('inner')
      state.inner // 内层读自己的属性
    })
    state.outer2 // 外层读第二个属性——这一步执行时 activeSub 必须已经恢复成外层 effect
    order.push('outer-end')
  })

  log('执行顺序：', order)
  expectEq('顺序符合预期', order, ['outer-start', 'inner', 'outer-end'])

  step('关键验证：outer2 有没有被正确记到外层 effect 的依赖里（而不是内层，或者谁都没记到）')
  expectEq('外层依赖包含 outer1 和 outer2，不包含 inner', depKeys(outerRunner.effect), ['outer1', 'outer2'])
}

section('2. 如果 activeSub 恢复错了会怎样（反证）：用 run() 的 try/finally 保证恢复')
{
  // effect.run() 的实现：
  //   const prevEffect = activeSub
  //   activeSub = this
  //   try { return this.fn() }
  //   finally { activeSub = prevEffect; ... }
  // try/finally 保证即使 fn() 抛异常，activeSub 也会被正确恢复。下面验证这一点：
  const state = reactive({ a: 1, b: 1 })
  let afterThrowRuns = 0

  const outer = effect(() => {
    state.a
    try {
      effect(() => {
        throw new Error('inner boom')
      })
    } catch {
      // 吞掉内层的异常（effect() 工厂函数里 catch 到异常会 stop() 再重新 throw）
    }
    afterThrowRuns++
    state.b // 即使内层抛了异常，外层这一行依然要能正确追踪到 b
  })

  state.b = 2
  expectEq('外层 effect 在内层抛异常之后，依然正确追踪了 b', afterThrowRuns, 2)
}

section('3. 三层嵌套：每一层都应该只收集自己读到的依赖')
{
  const state = reactive({ l1: 1, l2: 2, l3: 3 })
  const effects: any[] = []

  effect(() => {
    state.l1
    effect(() => {
      state.l2
      effect(() => {
        state.l3
        effects.push('inner-most-ran')
      })
    })
  })

  log('三层嵌套全部正常执行完毕：', effects)
  state.l3 = 30
  log('改 l3 之后，effects 数组：', effects, '（最内层 effect 应该又跑了一次）')
}
