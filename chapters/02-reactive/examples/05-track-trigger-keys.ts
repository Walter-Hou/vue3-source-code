/**
 * 运行：pnpm ex chapters/02-reactive/examples/05-track-trigger-keys.ts
 * 演示：用 effect() 的 onTrack/onTrigger 调试钩子，直接打印每次“谁读了什么”“谁改了什么、
 *       因此通知了哪个 key”——这是本章最直接的“看见 track/trigger”的方式，不用猜源码行为。
 * 看点：ITERATE_KEY 什么时候出现、ADD/SET/DELETE 的 trigger 分别带着什么信息、
 *       以及 trigger 时 oldValue/newValue 是怎么传过来的。
 */
import { reactive, effect } from 'vue'
import { section, step, log } from '../../../shared/print'

function fmtKey(key: unknown): string {
  if (typeof key === 'symbol') return key.toString()
  return String(key)
}

section('1. 最基本的 GET/SET：onTrack 在 effect 第一次运行时触发，onTrigger 在后续修改时触发')
{
  const state = reactive({ count: 0 })
  effect(
    () => {
      state.count
    },
    {
      onTrack(e) {
        log(`[onTrack]  type=${e.type}  key=${fmtKey(e.key)}`)
      },
      onTrigger(e) {
        log(`[onTrigger] type=${e.type}  key=${fmtKey(e.key)}  newValue=${e.newValue}  oldValue=${e.oldValue}`)
      },
    },
  )
  step('修改 count')
  state.count++
}

section('2. ownKeys 触发的 ITERATE_KEY：Object.keys / for...in / JSON.stringify 都会走到它')
{
  const state = reactive({ a: 1, b: 2 } as Record<string, number>)
  effect(
    () => {
      Object.keys(state)
    },
    {
      onTrack(e) {
        log(`[onTrack]  type=${e.type}  key=${fmtKey(e.key)}`)
      },
      onTrigger(e) {
        log(`[onTrigger] type=${e.type}  key=${fmtKey(e.key)}`)
      },
    },
  )

  step('新增属性 c：ADD 操作，会额外触发 ITERATE_KEY（因为 key 的集合变了）')
  state.c = 3

  step('修改已有属性 a 的值：SET 操作，不影响 key 集合，不会触发 ITERATE_KEY（上面不应该再打印 onTrigger）')
  state.a = 100

  step('delete 属性 b：DELETE 操作，key 集合又变了，触发 ITERATE_KEY')
  delete state.b
}

section('3. 数组：ownKeys 追踪的是 "length" 而不是 ITERATE_KEY')
{
  const list = reactive([1, 2, 3])
  effect(
    () => {
      Object.keys(list) // 对数组调用 ownKeys，baseHandlers 里专门判断了 isArray(target)
    },
    {
      onTrack(e) {
        log(`[onTrack]  type=${e.type}  key=${fmtKey(e.key)}`)
      },
      onTrigger(e) {
        log(`[onTrigger] type=${e.type}  key=${fmtKey(e.key)}`)
      },
    },
  )

  step('push 一个元素：length 变化，触发上面追踪的 "length" 依赖')
  list.push(4)
}

section('4. trigger 的分发规则一览（用一个 effect 同时订阅多个 key，观察谁被触发）')
{
  const state = reactive({ a: 1, b: 2, list: [1, 2] } as { a: number; b: number; list: number[] })
  const log4: string[] = []
  effect(
    () => {
      state.a
      state.b
      state.list.length
      Object.keys(state)
    },
    {
      onTrigger(e) {
        log4.push(`${e.type}:${fmtKey(e.key)}`)
      },
    },
  )

  step('依次触发 SET(a) / ADD(新key) / 数组push(length+ADD) / DELETE(b)，观察每次 trigger 带来的 onTrigger 事件')
  log4.length = 0
  state.a = 10
  log(' state.a = 10  =>', log4)

  log4.length = 0
  ;(state as any).c = 1
  log(' state.c = 1 (新增) =>', log4)

  log4.length = 0
  state.list.push(3)
  log(' state.list.push(3) =>', log4)

  log4.length = 0
  delete (state as any).b
  log(' delete state.b =>', log4)
}
