/**
 * 运行：pnpm ex chapters/04-ref-computed-watch/examples/05-watch-flush-timing.ts
 * 演示：flush: 'sync' | 'pre' | 'post' 相对组件渲染的真实时序——用 shared/logging-renderer.ts
 *       接一个假 DOM，在 render 函数里打点，和三个不同 flush 的 watch 打点放在一起比较顺序。
 * 看点：sync 立刻跑（比渲染还早）；pre 在渲染之前、但要等到微任务刷新；post 在渲染之后。
 */
import { defineComponent, h, ref, watch, nextTick } from 'vue'
import { render, createRoot, resetOps } from '../../../shared/logging-renderer'
import { section, step, log } from '../../../shared/print'

section('1. 三种 flush 相对渲染的顺序')
{
  const order: string[] = []
  const count = ref(0)

  const Comp = defineComponent({
    setup() {
      watch(count, () => order.push('watch(sync)'), { flush: 'sync' })
      watch(count, () => order.push('watch(pre)'), { flush: 'pre' })
      watch(count, () => order.push('watch(post)'), { flush: 'post' })
      return () => {
        order.push(`render(count=${count.value})`)
        return h('div', String(count.value))
      }
    },
  })

  const root = createRoot()
  render(h(Comp), root)
  resetOps()
  order.length = 0

  step('修改 count：同步阶段立刻打印一次，看看哪些 watch 已经跑了')
  count.value = 1
  log('state 修改后，nextTick 之前的 order：', [...order])

  step('await nextTick() 之后，剩下的 watch 和 render 应该都跑完了')
  await nextTick()
  log('nextTick 之后的完整 order：', [...order])
}

section('2. sync watch 甚至比"下一次宏观代码"还快——用在需要立即响应的场景')
{
  const count = ref(0)
  const seen: number[] = []
  watch(count, v => seen.push(v), { flush: 'sync' })
  count.value = 1
  count.value = 2
  log('没有等待任何 tick，sync watch 已经记录了全部变化：', seen)
}

section('3. 默认 flush（不传）等价于 pre：和 watch 不传 flush 的行为一致')
{
  const count = ref(0)
  const order3: string[] = []
  watch(count, () => order3.push('default(pre)'))
  count.value = 1
  log('修改后，微任务之前：', [...order3], '（期望为空，pre 默认是异步的）')
  await nextTick()
  log('微任务之后：', [...order3])
}

section('4. watchEffect 本身的 flush 语义：默认也是 pre，watchPostEffect/watchSyncEffect 是语法糖')
{
  const { watchEffect, watchPostEffect, watchSyncEffect } = await import('vue')
  const count = ref(0)
  const order4: string[] = []
  watchSyncEffect(() => {
    order4.push(`sync:${count.value}`)
  })
  watchEffect(() => {
    order4.push(`pre:${count.value}`)
  })
  watchPostEffect(() => {
    order4.push(`post:${count.value}`)
  })
  order4.length = 0 // 清掉 immediate 首次运行的记录（watchEffect 系列默认 immediate）
  count.value = 1
  log('修改后，微任务之前：', [...order4])
  await nextTick()
  log('微任务之后（完整顺序 sync -> pre -> post）：', [...order4])
}
