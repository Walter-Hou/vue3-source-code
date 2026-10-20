/**
 * 运行：pnpm ex chapters/15-ssr-hydration/examples/03-buffer-tree-and-async.ts
 * 演示：为什么 server-renderer 用"buffer 树"而不是直接拼字符串——
 *   父组件渲染不会被某个慢的异步子组件阻塞，多个异步子组件是并行 setup 的，
 *   但最终字符串拼接顺序依然和模板里写的顺序一致。
 * 看点：
 *   1. 两个 async setup 子组件几乎同时开始执行（父组件渲染到它们时立刻 setup()，
 *      不会等前一个 resolve 才开始下一个）
 *   2. 总耗时接近 max(两者耗时)，而不是 sum（证明是并行，不是排队）
 *   3. 即使"耗时短的"子组件先 resolve，最终 HTML 里的顺序仍然是模板顺序，
 *      不是 resolve 顺序——这是 unrollBuffer 按位置 await 的效果
 *   4. renderToNodeStream 可以在父组件的静态部分就绪时立刻把第一个 chunk 发出去，
 *      不需要等所有异步组件都 resolve
 */
import { createSSRApp, h, defineComponent } from 'vue'
import { renderToString, renderToNodeStream } from '@vue/server-renderer'
import { section, step, log } from '../../../shared/print'

function makeAsyncChild(name: string, delay: number) {
  return defineComponent({
    name,
    async setup() {
      log(`${name} setup() 开始`)
      await new Promise(r => setTimeout(r, delay))
      log(`${name} setup() resolve（等了 ${delay}ms）`)
      return () => h('span', name)
    },
  })
}

section('1. 两个异步子组件：谁先 setup、谁先 resolve、最终顺序是什么')
const SlowChild = makeAsyncChild('SlowChild(30ms)', 30)
const FastChild = makeAsyncChild('FastChild(5ms)', 5)

const App = defineComponent({
  render() {
    log('App.render()（同步，立刻返回）')
    // 注意模板顺序：SlowChild 在前，FastChild 在后
    return h('div', [h(SlowChild), h(FastChild)])
  },
})

const t0 = Date.now()
const html = await renderToString(createSSRApp(App))
const elapsed = Date.now() - t0
step(`总耗时 ${elapsed}ms（理论值接近 max(30,5)=30ms，如果是串行会接近 35ms）`)
log('html =', html)
log(
  '=> FastChild 明明先 resolve，但最终字符串里 SlowChild 的 <span> 仍然排在前面。' +
    '原因：render.ts#renderComponentVNode 给每个异步组件返回一个 Promise<SSRBuffer>，' +
    '父组件的 buffer 数组里，这个 Promise 占据着"它应该在的那个位置"；' +
    'renderToString.ts#unrollBuffer 遍历 buffer 时是按位置顺序处理的，' +
    '遇到某个位置是 Promise 就 await 它，和它是不是"最先完成"无关。',
)

section('2. renderToNodeStream：父组件的同步部分可以立刻发送，不用等异步子组件')
const StreamChild = makeAsyncChild('StreamChild(10ms)', 10)
const StreamApp = defineComponent({
  render() {
    return h('div', [h('span', 'before'), h(StreamChild), h('span', 'after')])
  },
})

step('逐块打印 renderToNodeStream 产出的 chunk')
const stream = renderToNodeStream(createSSRApp(StreamApp))
let chunkIndex = 0
for await (const chunk of stream as any) {
  chunkIndex++
  log(`chunk #${chunkIndex}:`, JSON.stringify(chunk.toString()))
}
log(
  '=> 第一个 chunk 在异步组件 resolve 之前就发出去了（"before" 先到），' +
    '第二个 chunk 才包含 StreamChild 渲染完的内容和 "after"。' +
    'renderToStream.ts 的实现是：unrollBuffer 遇到字符串就立刻写流，' +
    '遇到 Promise 就 await 之后再继续写——不需要把整棵树渲染完才开始发送第一个字节，' +
    '这正是流式 SSR 对首字节时间（TTFB）友好的原因。',
)
