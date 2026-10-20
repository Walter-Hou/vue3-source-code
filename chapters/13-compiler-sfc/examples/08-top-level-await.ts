/**
 * 运行：pnpm ex chapters/13-compiler-sfc/examples/08-top-level-await.ts
 * 演示：<script setup> 里的顶层 await 会被改写为 withAsyncContext(...) 调用，
 *   setup() 本身也被标记为 async；嵌套在普通函数里的 await 则完全不受影响。
 * 看点：
 *   1. 为什么不能直接写 `const data = await fetch(...)`：
 *      await 之后 JS 引擎会把后续代码丢进微任务队列执行，这期间
 *      "当前组件实例"这个全局变量（currentInstance）可能已经被别的组件渲染流程改写了，
 *      如果这时候再调用 onMounted() 等生命周期 API，会挂到错误的实例上
 *   2. withAsyncContext 把 await 之前"记住当前实例"、await 之后"恢复当前实例"
 *      这件事封装了起来（runtime-core/src/apiSetupHelpers.ts#withAsyncContext）
 *   3. 只有"顶层"的 await 会被改写；写在具名函数/箭头函数内部的 await 原样保留，
 *      因为那是用户自己调用的异步函数，不需要这层保护
 */
import { parse, compileScript } from '@vue/compiler-sfc'
import { section, step, log } from '../../../shared/print'

const SFC = `
<script setup>
import { ref } from 'vue'

// 顶层 await：会被改写
const data = await fetch('/api').then(r => r.json())

const count = ref(0)

// 嵌套在函数体内的 await：原样保留
async function reload() {
  const fresh = await fetch('/api').then(r => r.json())
  count.value++
}
</script>`.trimStart()

const { descriptor } = parse(SFC, { filename: 'Async.vue' })
const result = compileScript(descriptor, { id: 'await-demo' })

section('1. 完整编译产物')
log(result.content)

section('2. 改写细节（script/topLevelAwait.ts#processAwait）')
step('原始写法')
log(`const data = await fetch('/api').then(r => r.json())`)
step('改写后（手动折行方便对照）')
log(
  [
    'const data = (',
    '  ([__temp,__restore] = _withAsyncContext(() => fetch(\'/api\').then(r => r.json()))),',
    '  __temp = await __temp,',
    '  __restore(),',
    '  __temp',
    ')',
  ].join('\n'),
)
log(
  [
    '逐步拆解：',
    '1. 先在"同步阶段"调用 getAwaitable()（即原来 await 后面那坨表达式），拿到 Promise，',
    '   同时 withAsyncContext 记下当前的组件实例 ctx = getCurrentInstance()',
    '2. __temp = await __temp 才是真正让出线程、等待 Promise resolve 的地方',
    '3. __restore() 把 currentInstance 重新设置回 ctx —— 哪怕 await 期间别的组件',
    '   setup() 也在跑、把 currentInstance 改来改去，这里都能准确恢复',
    '4. 整个表达式的值就是最后一个 __temp，所以可以直接 `const data = (...)`',
  ].join('\n'),
)

section('3. setup() 本身被标记为 async（见产物顶部 "async setup(...)"）')
log(result.content.match(/async setup\(.*?\)/)?.[0])
log(
  '=> compileScript.ts 里 hasAwait 一旦为 true，就在生成 setup 签名时加上 `async ` 前缀' +
    '（compileScript.ts#L1060/#L1073/#L1080 附近的 `${hasAwait ? `async ` : ``}setup(...)`）',
)

section('4. 嵌套函数里的 await 完全不受影响')
log(result.content.match(/async function reload[\s\S]*?\n\}/)?.[0])
log(
  '=> walk() 在遇到函数类型节点时调用 this.skip()（compileScript.ts#L644-L646），' +
    '不会继续往函数体内部找 AwaitExpression，所以 reload() 内部的 await 原样保留',
)

section('5. 为什么需要这套机制：onMounted 等生命周期 API 依赖全局的 currentInstance')
log(
  [
    '如果没有 withAsyncContext：',
    '  <script setup>',
    '    await something()      // 让出线程',
    '    onMounted(() => {})    // 此时 currentInstance 可能已经是别的组件了！',
    '  </script>',
    '有了 withAsyncContext 的包裹，await 恢复执行后会先把 currentInstance 修好，',
    '紧接着写的 onMounted() 才能稳定挂到"当前这个正在 setup 的组件"上。',
    '这也是官方文档里"使用顶层 await 的组件必须配合 <Suspense>"这条规则的底层原因：',
    'setup() 变成 async 函数后，返回值是一个 Promise，必须由 Suspense 来等待它完成。',
  ].join('\n'),
)
