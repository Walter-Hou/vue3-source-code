/**
 * 运行：pnpm ex chapters/08-scheduler/examples/02-job-order.ts
 * 演示：父子组件各自的 pre watch / post watch / onUpdated 钩子 + nextTick
 *       回调，在一次状态更新里的完整执行顺序。
 * 看点：
 *   1. pre watcher 的 job 带 SchedulerJobFlags.PRE，并且 id 等于它所属组件的
 *      uid，和该组件的渲染 job 排在一起、且排在前面（findInsertionIndex:
 *      scheduler.ts#L79-98）。
 *   2. 子组件的 props 更新发生在父组件渲染过程中的 updateComponentPreRender
 *      里（renderer.ts#L1653-1670），它会调用 `updateProps` 之后立即调用
 *      `flushPreFlushCbs(instance)`——只 flush 属于子组件的 pre job，
 *      所以子组件的 pre watch 是在父组件这次渲染"内部"同步跑完的，
 *      不需要等主队列按 id 轮到它。
 *   3. onUpdated / post watch 都通过 queuePostRenderEffect 进了
 *      post 队列，在所有主任务（render job + pre job）跑完之后统一 flush，
 *      顺序是"先入队先执行"——父组件先渲染完就先把自己的 post 任务排进去。
 *   4. nextTick 回调排在 currentFlushPromise 之后，所以永远在这一整轮
 *      flush（包括 post 任务）结束之后才执行。
 */
import { defineComponent, h, nextTick, onUpdated, ref, watch } from '@vue/runtime-core'
import { createRoot, render } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

let seq = 0
const mark = (msg: string) => log(`#${++seq} ${msg}`)

const trigger = ref(0)

const Child = defineComponent({
  name: 'Child',
  props: ['n'],
  setup(props: any) {
    watch(() => props.n, () => mark('[Child] pre watch'), { flush: 'pre' })
    watch(() => props.n, () => mark('[Child] post watch'), { flush: 'post' })
    onUpdated(() => mark('[Child] onUpdated'))
    return () => h('span', String(props.n))
  },
})

const Parent = defineComponent({
  name: 'Parent',
  setup() {
    watch(trigger, () => mark('[Parent] pre watch'), { flush: 'pre' })
    watch(trigger, () => mark('[Parent] post watch'), { flush: 'post' })
    onUpdated(() => mark('[Parent] onUpdated'))
    return () => {
      mark('[Parent] render')
      return h('div', [h(Child, { n: trigger.value })])
    }
  },
})

section('1. 挂载（建立 watch，此时还没有任何变化触发它们）')
const root = createRoot()
render(h(Parent), root)

section('2. 触发一次更新：trigger.value++')
step('同步修改 trigger')
seq = 0
trigger.value++
mark('(同步代码执行完，microtask 还没开始)')

step('await nextTick()：等这一轮 flush 全部跑完')
await nextTick(() => mark('nextTick 回调'))

log('')
log('把上面 #1.. 的顺序和 README 里"源码精读"小节的时序图对照一下。')
