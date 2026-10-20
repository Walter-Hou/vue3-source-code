/**
 * 运行：pnpm ex chapters/15-ssr-hydration/examples/02-ssr-vs-client-compile.ts
 * 演示：同一份模板（含组件 + 插槽 + v-if）分别用 compiler-dom（客户端模式）和
 *   compiler-ssr（SSR 模式）编译，贴出两份真实产物并逐段对照。
 * 看点：
 *   1. 客户端产物是"创建 vnode 树"（_createVNode/_createElementBlock），
 *      SSR 产物是"直接拼 HTML 字符串"（_push(`<div...>`)），两者的 codegen 目标完全不同
 *   2. v-if 在客户端编译成三元表达式 + createCommentVNode 占位；
 *      SSR 编译成普通的 if/else 语句，直接 push 对应的字符串或 `<!---->`
 *   3. 插槽函数在 SSR 模式下会生成"两份身体"：
 *      `(_, _push, _parent, _scopeId) => { if (_push) { SSR 分支 } else { return [vnode 分支] } }`
 *      —— 因为子组件不一定是 SSR 编译过的（可能是手写 render 函数/第三方库组件），
 *      父组件没法保证子组件会用 _push 调用插槽函数，所以两条路都要准备好
 *      （源码：compiler-ssr/src/transforms/ssrTransformComponent.ts）
 * 本例直接用 @vue/compiler-sfc 的 compileTemplate({ ssr: true/false })，
 *   这是 compiler-ssr 对外可用的方式之一；如果环境允许，也可以直接
 *  `import { compile as ssrCompile } from '@vue/compiler-ssr'`。
 */
import { compileTemplate } from '@vue/compiler-sfc'
import { section, step, log } from '../../../shared/print'

const TEMPLATE = `
<div class="a">
  <Comp :msg="m">
    <template #footer>foot {{ x }}</template>
  </Comp>
  <p v-if="show">hi {{ name }}</p>
</div>
`.trim()

section('1. 客户端编译产物（mode 默认走 compiler-dom）')
const client = compileTemplate({
  id: 'ssrdemo',
  filename: 'X.vue',
  source: TEMPLATE,
  compilerOptions: {},
})
log(client.code)

section('2. SSR 编译产物（ssr: true，内部用 compiler-ssr）')
const ssr = compileTemplate({
  id: 'ssrdemo',
  filename: 'X.vue',
  source: TEMPLATE,
  ssr: true,
  ssrCssVars: [],
  compilerOptions: {},
})
log(ssr.code)

section('3. 逐段对照')
step('函数签名')
log(
  [
    '客户端: render(_ctx, _cache)                      —— 返回一棵 vnode 树',
    'SSR:    ssrRender(_ctx, _push, _parent, _attrs)    —— 没有返回值，靠调用 _push() 写字符串',
  ].join('\n'),
)

step('普通元素')
log(
  [
    '客户端: _createElementBlock("div", _hoisted_1, [...])',
    'SSR:    _push(`<div${_ssrRenderAttrs(_mergeProps({ class: "a" }, _attrs))}>`)',
    '        —— SSR 侧直接把静态属性拼进模板字符串，动态/透传属性用 _ssrRenderAttrs(_mergeProps(...))',
    '           一次性字符串化（compiler-ssr/src/transforms/ssrTransformElement.ts）',
  ].join('\n'),
)

step('v-if')
log(
  [
    '客户端: (_ctx.show) ? (vnode) : _createCommentVNode("v-if", true)',
    'SSR:    if (_ctx.show) { _push(`<p>...</p>`) } else { _push(`<!---->`) }',
    '        —— 条件逻辑一样，只是真分支走普通 if 语句而不是三元表达式',
    '           （compiler-ssr/src/transforms/ssrVIf.ts#ssrProcessIf）',
  ].join('\n'),
)

step('插槽：两份身体')
{
  const start = ssr.code.indexOf('footer: _withCtx')
  const end = ssr.code.indexOf('_: 1')
  log(ssr.code.slice(start, end).trim())
}
log(
  [
    '=> _push 参数存在就说明调用方（子组件 Comp）是 SSR 编译过的，走字符串拼接分支；',
    '   _push 为空（undefined）说明调用方在走普通 vnode 渲染路径（比如 Comp 是手写 render()',
    '   的组件，或没有 ssrRender），这时候退回执行 return [...]，产出一个真正的 vnode 数组',
    '   给 renderVNode() 走回退路径（server-renderer/src/render.ts 的 default 分支）。',
    '   两份代码体来自同一段模板源码——编译器在"第一遍"就用 vnode 版 transform 预先构建好',
    '   vnodeBranch，"第二遍"再构建 SSR 版本，最后拼成 if/else 塞进同一个函数里。',
  ].join('\n'),
)
