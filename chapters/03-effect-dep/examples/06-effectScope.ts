/**
 * 运行：pnpm ex chapters/03-effect-dep/examples/06-effectScope.ts
 * 演示：effectScope() 把一批 effect“打包”在一起管理；嵌套 scope 的父子关系；
 *       父 scope.stop() 级联停掉所有子 scope 和它们的 effect；onScopeDispose 注册清理回调。
 * 看点：这正是组件卸载时"一次性停掉这个组件所有 effect/watcher"的底层机制
 *       （组件实例的 setupState 对应一个 EffectScope，详见第 06 章）。
 */
import { reactive, effect, effectScope, getCurrentScope, onScopeDispose } from 'vue'
import { section, step, log, expectEq } from '../../../shared/print'

section('1. scope.run() 内创建的 effect 都会被收进这个 scope')
{
  const scope = effectScope()
  const state = reactive({ a: 1, b: 2 })
  let aRuns = 0
  let bRuns = 0

  scope.run(() => {
    effect(() => {
      aRuns++
      state.a
    })
    effect(() => {
      bRuns++
      state.b
    })
  })

  // effects 是 @internal 字段，公开类型里没有，这里用 any 绕过去访问
  expectEq('scope 收集了 2 个 effect', (scope as any).effects.length, 2)
  state.a++
  state.b++
  expectEq('两个 effect 各运行了 2 次（初始 1 次 + 变化 1 次）', [aRuns, bRuns], [2, 2])
}

section('2. scope.stop()：一次性停掉里面所有的 effect')
{
  const scope = effectScope()
  const state = reactive({ a: 1 })
  let runs = 0
  scope.run(() => {
    effect(() => {
      runs++
      state.a
    })
  })

  step('stop 之前，正常响应')
  state.a++
  expectEq('stop 前正常响应', runs, 2)

  step('stop 之后，不再响应')
  scope.stop()
  state.a++
  expectEq('stop 后不再响应', runs, 2)
}

section('3. 嵌套 scope：父子关系与级联 stop')
{
  const parent = effectScope()
  let child: ReturnType<typeof effectScope> | undefined
  const state = reactive({ childVal: 1 })
  let childRuns = 0

  parent.run(() => {
    child = effectScope() // 默认不是 detached，会被挂到当前 activeEffectScope（也就是 parent）下面
    child.run(() => {
      effect(() => {
        childRuns++
        state.childVal
      })
    })
  })

  log('parent.scopes 里有几个子 scope：', (parent as any).scopes?.length)
  expectEq('parent 自动收录了这个子 scope', (parent as any).scopes?.length, 1)

  step('父 scope.stop()：子 scope 和子 scope 里的 effect 全部级联停止')
  parent.stop()
  expectEq('子 scope 被级联标记为非 active', child!.active, false)
  state.childVal++
  expectEq('子 scope 里的 effect 不再响应', childRuns, 1)
}

section('4. detached scope：不受父 scope.stop() 影响，必须自己手动 stop')
{
  const parent = effectScope()
  let detached: ReturnType<typeof effectScope> | undefined
  parent.run(() => {
    detached = effectScope(true) // detached: true，不挂到 parent.scopes 下面
  })
  parent.stop()
  expectEq('detached scope 不受父 stop 影响，仍然 active', detached!.active, true)
  detached!.stop()
  expectEq('手动 stop 之后才失效', detached!.active, false)
}

section('5. onScopeDispose：注册清理回调，scope.stop() 时按注册顺序执行')
{
  const scope = effectScope()
  const order: number[] = []
  scope.run(() => {
    onScopeDispose(() => order.push(1))
    onScopeDispose(() => order.push(2))
    onScopeDispose(() => order.push(3))
  })
  scope.stop()
  expectEq('按注册顺序依次执行', order, [1, 2, 3])
}

section('6. getCurrentScope()：只在 run() 执行期间能拿到当前 scope')
{
  const scope = effectScope()
  log('scope.run() 之外：', getCurrentScope())
  let inside: unknown
  scope.run(() => {
    inside = getCurrentScope()
  })
  log('scope.run() 内部拿到的 scope 是否就是自己：', inside === scope)
}
