/**
 * 运行：pnpm ex chapters/03-effect-dep/examples/01-effect-basics-and-dynamic-deps.ts
 * 演示：effect() 的最基本用法；条件分支切换依赖时，旧分支的依赖会被 cleanupDeps 真正摘掉
 *       （不是"逻辑上不触发"，而是 Link 从双向链表里被物理删除）。
 * 看点：用 onTrack 打印每次收集到的依赖顺序；通过 runner.effect.deps 链表直接验证
 *       "旧分支的 key 不在依赖链表里了"。
 */
import { reactive, effect } from 'vue'
import { section, step, log, expectEq } from '../../../shared/print'

function depKeys(e: any): string[] {
  const keys: string[] = []
  for (let link = e.deps; link; link = link.nextDep) keys.push(String(link.dep.key))
  return keys
}

section('1. 最基本的 effect：创建时立刻执行一次')
{
  const state = reactive({ count: 0 })
  let runs = 0
  effect(() => {
    runs++
    state.count
  })
  expectEq('effect 创建后立刻跑了一次', runs, 1)
}

section('2. onTrack 打印依赖收集顺序')
{
  const state = reactive({ a: 1, b: 2, c: 3 })
  const runner = effect(
    () => {
      state.c
      state.a
      state.b
    },
    {
      onTrack(e) {
        log(`[onTrack] key=${String(e.key)}`)
      },
    },
  )
  log('依赖链表顺序（应该和访问顺序一致，不是声明顺序）：', depKeys(runner.effect))
}

section('3. 条件分支切换依赖：旧分支被 cleanupDeps 摘除')
{
  const state = reactive({ cond: true, a: 1, b: 2 })
  const trackLog: string[] = []
  const runner = effect(
    () => (state.cond ? state.a : state.b),
    {
      onTrack(e) {
        trackLog.push(String(e.key))
      },
    },
  )

  step('初次运行：依赖应该是 [cond, a]')
  expectEq('初次依赖链表', depKeys(runner.effect), ['cond', 'a'])

  step('切换 cond，effect 重新运行，这次读的是 b')
  trackLog.length = 0
  state.cond = false
  log('这次 onTrack 收集到的 key：', trackLog)
  expectEq('切换后依赖链表变成 [cond, b]', depKeys(runner.effect), ['cond', 'b'])

  step('验证 a 已经被摘除：改 a 不应该再触发这个 effect')
  let extraRuns = 0
  const probe = effect(() => {
    extraRuns++
    state.a // 用另一个 effect 读 a，确保 a 本身的 Dep 还活着、只是没有 runner 这个订阅者了
  })
  extraRuns = 0
  state.a = 100
  expectEq('probe effect 对 a 的变化仍然敏感（证明 a 的 Dep 没坏）', extraRuns, 1)

  step('而原来的 runner 不会因为 a 变化而重跑：清空 trackLog，改 a，看 onTrack 还会不会触发')
  trackLog.length = 0
  state.a = 200
  log('改 a 后，runner 的 onTrack 触发次数：', trackLog.length, '（期望 0，因为 a 已经不在它的依赖里）')
  expectEq('runner 不再响应 a 的变化', trackLog.length, 0)
}

section('4. 同一个 effect 内重复读同一个 key，只产生一个 Link')
{
  const state = reactive({ a: 1 })
  const runner = effect(() => state.a + state.a + state.a)
  expectEq('重复读 3 次 a，依赖链表里只有 1 条', depKeys(runner.effect), ['a'])
}
