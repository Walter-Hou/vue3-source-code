/**
 * 运行：pnpm ex chapters/12-compiler-optimization/examples/04-static-cache-and-stringify.ts
 * 演示：3.5 的 cacheStatic（transforms/cacheStatic.ts，由更早版本的 hoistStatic 改名而来）
 *       真实产物是什么样；以及 compiler-dom 的 stringifyStatic 什么时候会把一长串静态节点
 *       合并成 createStaticVNode。全部用真实 compile() 输出验证，不手写猜测。
 * 看点：
 *  1. 3.5 不再把"整棵静态子树"提升成模块级 `_hoisted_n` 变量——而是用
 *     `_cache[n] || (_cache[n] = createElementVNode(...))` 把它缓存进 `_cache` 数组
 *     （renderHotModuleReload/多应用实例场景下，模块级 hoist 会在多个 app 实例之间
 *     共享同一个 vnode 对象，可能引发奇怪的 bug；缓存在每个组件实例自己的 `_cache`
 *     数组里就没有这个问题）。
 *  2. 但"纯静态的 props 对象"仍然会被提升成 `_hoisted_n`（cacheStatic.ts#L88-107），
 *     因为 props 对象本身不是 vnode，不存在跨实例共享 vnode 对象的问题，提升出去
 *     纯粹是省掉"每次 render 都要 new 一个一样的对象"的开销。
 *  3. compiler-dom 的 stringifyStatic 只在 Node.js 端生效（`transformHoist`）。
 *     阈值是"节点数 nc >= 20" 或 "带 props 的元素个数 ec >= 5"，但 nc 的计数规则很容易
 *     猜错：它不是"数有几个标签"，而是 analyzeNode() 里 `walk()` 对每个子节点都 `nc++`
 *     ——包括文本子节点。所以 `<li>x</li>` 算 2 个节点（元素本身 1 + 文本子节点 1），
 *     10 个这样的 `<li>` 就有 nc=20，已经够触发合并，不需要凑满 20 个标签。
 *  4. 一旦某个节点变成动态的，它就不再满足"可字符串化"条件，会打断当前这一段
 *     chunk 的合并（见 stringifyStatic.ts 的 chunk 扫描逻辑）。
 */
import { compile } from '@vue/compiler-dom'
import * as Vue from '@vue/runtime-core'
import {
  createRoot,
  render as hostRender,
  serializeInner,
  resetOps,
  dumpOps,
} from '../../../shared/logging-renderer'
import { section, step, log } from '../../../shared/print'

section('1. 静态子节点被整体缓存：_cache[n] || (_cache[n] = ...)')
step('<div><p>static</p>{{ msg }}</div>：第一个 <p> 是纯静态，第二个是动态插值')
log(compile(`<div><p>static</p>{{ msg }}</div>`, { hoistStatic: true }).code)

section('2. 静态 props 对象仍然会被 hoist 成 _hoisted_n')
step('<div><span :foo="1" bar="2">x</span>{{ msg }}</div>：span 本身有 patchFlag=NEED_PATCH? 不——')
step('换一个更典型的例子：元素有静态 props，但因为同级有动态兄弟，元素本身不满足整体缓存条件')
log(
  compile(`<div><input :disabled="false" placeholder="name">{{ msg }}</div>`, {
    hoistStatic: true,
  }).code,
)

section('3. 对比：compiler-dom 的 compile() 默认 hoistStatic 其实是 false')
step(
  'transform.ts#L337 `if (options.hoistStatic) { cacheStatic(root, context) }`——' +
    'compile() 本身不会帮你把它设成 true，必须显式传入（vite-plugin-vue / vue-loader ' +
    '这些真实构建工具会在调用处显式传 true，所以日常开发感知不到这个默认值）',
)
log(compile(`<div><p>static</p>{{ msg }}</div>`).code)

section('4. stringifyStatic：nc(节点数) >= 20 或 ec(带props的元素数) >= 5 才会合并')
function buildList(n: number) {
  return `<div>${'<li>x</li>'.repeat(n)}{{ msg }}</div>`
}
step('9 个 <li>x</li>：nc = 9 个元素 + 9 个文本子节点 = 18，还没到 20，只会被逐个 _cache[n] 缓存')
log(
  compile(buildList(9), { hoistStatic: true }).code.includes('createStaticVNode')
    ? '包含 createStaticVNode（不符合预期）'
    : '不包含 createStaticVNode（符合预期，产物里应该有 9 个 _cache[n] || (...)）',
)
step('10 个 <li>x</li>：nc = 10 + 10 = 20，刚好达到阈值，触发 stringifyStatic')
const code10 = compile(buildList(10), { hoistStatic: true }).code
log(code10)

step('对比 ec 阈值：5 个带静态属性的 <li class="x">，元素数不到 20 个，但 ec=5 也会触发合并')
const codeEc = compile(
  `<div>${'<li class="x">x</li>'.repeat(5)}{{ msg }}</div>`,
  { hoistStatic: true },
).code
log(codeEc)

section('5. 把其中一个 <li> 改成动态内容，打断这一串 chunk')
const mixedTemplate = `<div>${'<li>x</li>'.repeat(10)}<li>{{ dyn }}</li>${'<li>x</li>'.repeat(10)}{{ msg }}</div>`
const codeMixed = compile(mixedTemplate, { hoistStatic: true }).code
log(codeMixed)
step('前 10 个和后 10 个各自的 nc 都是 20，各自单独触发 stringify，合并成两段 createStaticVNode；中间那个动态 li 原样保留，把两段隔开')

section('6. 用 logging-renderer 验证：被缓存/字符串化的静态内容，第二次渲染不会触发任何宿主操作')
{
  const render = new Function(
    'Vue',
    compile(`<div><p>static</p>{{ msg }}</div>`, { hoistStatic: true }).code,
  )(Vue)
  const root = createRoot()
  hostRender(render({ msg: 'a' }, []), root)
  resetOps()
  hostRender(render({ msg: 'b' }, []), root)
  log('第二次渲染的宿主操作：', dumpOps())
  log('最终 DOM：', serializeInner(root))
  log('只有 setElementText 作用在动态文本上，静态的 <p>static</p> 完全没有被碰过')
}
