/**
 * 运行：pnpm ex chapters/04-ref-computed-watch/examples/06-watch-cleanup-once-pause.ts
 * 演示：onCleanup（下次回调前/stop 时跑上一次注册的清理函数）、once（只触发一次后自动 stop）、
 *       WatchHandle 的 pause()/resume()/stop()。
 * 看点：onCleanup 典型用于"取消上一次还没完成的异步请求"——这里用一个模拟的计时器体现。
 */
import { ref, watch } from '@vue/reactivity'
import { section, step, log, expectEq, sleep } from '../../../shared/print'

section('1. onCleanup：下一次回调执行前，先跑上一次注册的清理函数')
{
  const id = ref(1)
  const order: string[] = []

  watch(id, (newId, _old, onCleanup) => {
    order.push(`fetch start:${newId}`)
    onCleanup(() => order.push(`cancel:${newId}`))
  })

  id.value = 2
  id.value = 3
  log('执行顺序：', order)
  expectEq('每次新回调之前，先取消上一次', order, [
    'fetch start:2',
    'cancel:2',
    'fetch start:3',
  ])
}

section('2. once：只触发一次，之后自动 stop')
{
  const count = ref(0)
  let calls = 0
  watch(count, () => calls++, { once: true })
  count.value = 1
  count.value = 2
  count.value = 3
  expectEq('不管改了多少次，只触发了 1 次', calls, 1)
}

section('3. stop()：手动停止')
{
  const count = ref(0)
  let calls = 0
  const handle = watch(count, () => calls++)
  count.value = 1
  expectEq('stop 前正常触发', calls, 1)

  handle.stop()
  count.value = 2
  expectEq('stop 后不再触发', calls, 1)
}

section('4. pause()/resume()：和 effect 的 pause/resume 语义一致')
{
  const count = ref(0)
  let calls = 0
  const handle = watch(count, () => calls++)

  handle.pause()
  count.value = 1
  count.value = 2
  expectEq('暂停期间完全不触发', calls, 0)

  handle.resume()
  expectEq('恢复后补跑一次（不是补跑 2 次）', calls, 1)
}

section('5. onCleanup 在 stop() 时也会被调用（不只是"下次回调前"）')
{
  const count = ref(0)
  const order: string[] = []
  const handle = watch(count, (_v, _ov, onCleanup) => {
    order.push('run')
    onCleanup(() => order.push('cleanup-on-stop'))
  })
  count.value = 1 // 触发一次，注册一个 cleanup
  handle.stop()
  expectEq('stop 时也会执行上一次注册的 cleanup', order, ['run', 'cleanup-on-stop'])
}

section('6. 模拟真实场景：用 onCleanup 取消过期的异步请求')
{
  const userId = ref(1)
  const results: string[] = []

  async function fakeFetch(id: number, signal: { cancelled: boolean }) {
    await sleep(20)
    if (!signal.cancelled) results.push(`用户${id}的数据`)
    else results.push(`用户${id}的请求被取消，结果丢弃`)
  }

  watch(userId, (id, _old, onCleanup) => {
    const signal = { cancelled: false }
    onCleanup(() => {
      signal.cancelled = true
    })
    fakeFetch(id, signal)
  })

  step('快速切换两次 userId，模拟用户快速点击切换')
  userId.value = 2
  await sleep(5)
  userId.value = 3 // 第二次切换发生在第一次请求还没返回时，onCleanup 会取消它

  await sleep(40) // 等两个请求都"完成"
  log('最终结果：', results)
  expectEq('只有最后一次请求的结果被保留，中间的被标记取消', results, [
    '用户2的请求被取消，结果丢弃',
    '用户3的数据',
  ])
}
