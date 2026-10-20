/**
 * 运行：pnpm ex chapters/16-vapor-future/examples/01-vapor-compile-output.ts
 * 演示：同一份模板（插值 + 事件 + v-if + v-for + 组件）分别用
 *   @vue/compiler-vapor（3.6.0-rc.12）和 @vue/compiler-dom（3.5.44）编译，
 *   贴出真实产物对照，直观感受 Vapor 模式"不生成 VNode"是什么意思。
 * 看点：
 *   1. compiler-dom 产物的核心是"创建一棵 vnode 树再 diff"；compiler-vapor
 *      产物里完全没有 createVNode/openBlock/PatchFlags，取而代之的是
 *      `_template()` 克隆一次性的静态 DOM 骨架，`_child()/_next()` 像指针一样
 *      在这棵已经创建好的真实 DOM 上移动定位
 *   2. 响应式绑定直接编译成 `_renderEffect(() => _setText(...))`——把"访问响应式
 *      数据 + 更新 DOM"包进一个 effect，依赖变化时只重跑这个 effect，不经过
 *      虚拟 DOM diff
 *   3. v-if/v-for 变成 `_createIf`/`_createFor` 这两个运行时函数调用，自己管理
 *      分支切换/列表增删的真实 DOM 操作，而不是"生成新 vnode 树再 diff 出补丁"
 *   4. 模板里的标识符（msg/inc/count/items/item）全部是裸标识符，没有 `_ctx.`
 *      前缀——因为 Vapor 模板总是编译成直接在 setup() 作用域里执行的代码
 *      （这一点和 3.5 inline 模式的 script setup 很像，但 Vapor 是唯一模式，
 *      没有"非 inline"的退路）
 *
 * 注：本例只做纯编译期对比，不涉及 3.6 rc 包的运行时加载问题（见 03 号示例）。
 */
import { compile as compileVapor } from '@vue/compiler-vapor'
import { compile as compileDom } from '@vue/compiler-dom'
import { section, step, log } from '../../../shared/print'

const TEMPLATE = `
<div class="list">
  <p>{{ msg }}</p>
  <button @click="inc">+1</button>
  <span v-if="count > 0">positive</span>
  <ul>
    <li v-for="item in items" :key="item.id">{{ item.name }}</li>
  </ul>
  <Child :count="count" />
</div>
`.trim()

section('0. 待编译模板（插值 / 事件 / v-if / v-for / 组件 一次性全覆盖）')
log(TEMPLATE)

section('1. compiler-vapor 产物（@vue/compiler-vapor 3.6.0-rc.12）')
const vaporResult = compileVapor(TEMPLATE, {
  mode: 'module',
  runtimeModuleName: '@vue/runtime-vapor',
})
log(vaporResult.code)

section('2. compiler-dom 产物（@vue/compiler-dom 3.5.44，对照组）')
const domResult = compileDom(TEMPLATE, { mode: 'module' })
log(domResult.code)

section('3. 逐段对照')
step('静态骨架：hoist 一次性字符串模板 vs hoist vnode 属性对象')
log(
  [
    'Vapor:  const t2 = _template("<div class=list><p> </p><button>+1</button><!><ul>", 1)',
    '        —— 整段静态 DOM 结构一次性用字符串建好，运行时 _template() 内部是',
    '           `innerHTML = ...; return () => el.cloneNode(true)` 这类克隆逻辑',
    '           （每个组件实例 mount 时 clone 一份，之后不再重新创建这些节点）',
    'DOM:    每次 render() 调用都会执行 _createElementVNode(...) 重新构造 vnode 对象',
    '        （即使有 hoistStatic 优化，也只是把*创建 vnode 的调用*提到 render 外层，',
    '         vnode 对象本身在多实例间可以共享，但 Vapor 连"vnode 对象"这一层都不需要）',
  ].join('\n'),
)

step('定位节点：指针式遍历 vs 虚拟树')
log(
  [
    'Vapor:  const n0 = _child(n11); const n1 = _next(n0); ...',
    '        —— 在已经 clone 出来的真实 DOM 上，用 firstChild/nextSibling 风格的',
    '           操作找到"这个位置将来要更新"的具体节点，编译期就把路径算好了',
    'DOM:    不需要"定位"，vnode 树本身就是数据结构，diff 时按结构递归比较',
  ].join('\n'),
)

step('响应式绑定：细粒度 effect vs 整体重新 render')
log(
  [
    'Vapor:  _renderEffect(() => _setText(x0, _toDisplayString(msg)))',
    '        —— 这是一个独立的 ReactiveEffect，只在 msg 变化时重跑，',
    '           直接调用 _setText 改这一个文本节点，不涉及其他任何节点',
    'DOM:    msg 是整个组件 render() 函数（一个大 effect）的依赖之一，',
    '        msg 变化会重新执行整个 render()，生成新 vnode 树，再和旧树 diff',
  ].join('\n'),
)

step('v-if / v-for：运行时控制流函数 vs vnode 树 + diff')
log(
  [
    'Vapor:  _createIf(() => (count > 0), () => { ...挂载分支... }, null, flags)',
    '        _createFor(() => (items), (item) => { ...挂载一项... }, (item) => item.id, flags)',
    '        —— 这两个 helper 自己负责"条件切换时怎么换 DOM""列表怎么增删/复用节点"，',
    '           本质是把 Vue 2/3 patch 算法里"diff 的那部分逻辑"收编成了专门的运行时原语',
    'DOM:    v-if 编译成三元表达式切换 vnode；v-for 编译成 renderList 生成 vnode 数组，',
    '        两者最终都要走 patchChildren 的 key diff（见第 7 章 patchKeyedChildren）',
  ].join('\n'),
)

step('组件：_createAssetComponent vs createVNode + resolveComponent')
log(
  [
    'Vapor:  const n9 = _createAssetComponent("Child", { count: () => (count) })',
    '        —— props 以 getter 函数的形式传入（而不是一个在每次 render 时重新求值的',
    '           对象字面量），子组件内部可以按需读取，粒度比"props 对象整体 diff"更细',
    'DOM:    _createVNode(_component_Child, { count: _ctx.count }, ...)',
    '        —— props 是一次性求值的普通对象，子组件更新靠 vnode 级别的 patchFlag/diff',
  ].join('\n'),
)

log(
  '\n待 3.6 正式版确认：_createAssetComponent 的参数形态、createFor/createIf 的 flags ' +
    '编码含义，以及是否会在正式版里改名或调整——这些属于 rc 阶段还可能变动的实现细节。',
)
