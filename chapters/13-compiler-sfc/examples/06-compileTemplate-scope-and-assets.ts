/**
 * 运行：pnpm ex chapters/13-compiler-sfc/examples/06-compileTemplate-scope-and-assets.ts
 * 演示：compileTemplate() 的 transformAssetUrl/transformSrcset 节点转换，
 *   以及一个常被误解的点——`scoped: true` 并不会在 render 函数代码里插入任何
 *   `data-v-xxx` 相关的东西。scopeId 是运行时机制，不是编译期字符串拼接。
 * 看点：
 *   1. <img src="./logo.png">、srcset 多候选图都被转成具名 import（给打包工具处理）
 *   2. compileTemplate({ scoped: true }) 和 { scoped: false } 产出的 render 函数代码
 *      逐字节相同 —— 真正的 scopeId 注入发生在运行时，不在这里
 *   3. 组件上有插槽时，插槽内容会被 `withCtx()` 包一层，用于在插槽渲染时
 *      恢复「定义插槽的那个组件实例」作为 currentRenderingInstance
 */
import { compileTemplate } from '@vue/compiler-sfc'
import { section, step, log } from '../../../shared/print'

const TEMPLATE = `
<div class="wrap">
  <img src="./logo.png" srcset="./logo.png 1x, ./logo@2x.png 2x" />
  <Comp :msg="m">
    <template #footer><span>f</span></template>
  </Comp>
</div>
`.trim()

section('1. transformAssetUrl / transformSrcset：资源路径变成具名 import')
const scoped = compileTemplate({
  id: 'data-v-abc123',
  filename: 'Scope.vue',
  source: TEMPLATE,
  scoped: true,
  compilerOptions: {},
})
log(scoped.code)
step('解读')
log(
  [
    'src="./logo.png"        -> import _imports_0 from "./logo.png"',
    'srcset 里出现的每个候选图都单独 import（见 template/transformSrcset.ts）',
    '最终 srcset 字符串在编译期拼接：_hoisted_1 = _imports_0 + " 1x, " + _imports_1 + " 2x"',
    '这一步只认相对路径；base64 data url / 绝对 url / http(s) url 默认不转换',
    '（见 template/transformAssetUrl.ts 的 isDataUrl / isExternalUrl 判断）',
  ].join('\n'),
)

section('2. scoped: true 并不往 render 函数里插入任何东西——对比 scoped:false')
const unscoped = compileTemplate({
  id: 'data-v-abc123',
  filename: 'Scope.vue',
  source: TEMPLATE,
  scoped: false,
  compilerOptions: {},
})
step('两份产物逐字节比较')
log('scoped === unscoped ?', scoped.code === unscoped.code)
log(
  '=> 真相：packages/compiler-core/src/codegen.ts#L305 算出的 genScopeId 在 3.5 的 ' +
    'genModulePreamble/genHoists 里根本没被使用；scopeId 相关的编译期代码生成从 3.0.8 之后' +
    '就名存实亡了，`pushScopeId/popScopeId/withScopeId` 只是为了兼容“更老版本编译器生成的代码”' +
    '而保留的空壳（withScopeId 直接等于 withCtx，见 runtime-core/src/componentRenderContext.ts#L52）',
)

section('3. scopeId 真正的实现：运行时读 instance.type.__scopeId')
log(
  [
    '1. 构建工具（@vitejs/plugin-vue）在组装最终模块时，给组件对象加一行：',
    '     _sfc_main.__scopeId = "data-v-abc123"',
    '   （真实证据：node_modules 里 @vitejs/plugin-vue/dist/index.mjs 搜索 __scopeId，',
    '    能看到 `attachedProps.push([\'__scopeId\', JSON.stringify(`data-v-${descriptor.id}`)])`）',
    '',
    '2. 每次要渲染这个组件实例之前，setCurrentRenderingInstance(instance) 会执行：',
    '     currentScopeId = instance.type.__scopeId || null',
    '   （runtime-core/src/componentRenderContext.ts#L26-L28）',
    '',
    '3. 渲染期间每创建一个 vnode，createBaseVNode 都会把 currentScopeId 记到',
    '   vnode.scopeId 上（runtime-core/src/vnode.ts#L460）',
    '',
    '4. patch 阶段 mountElement 调用 setScopeId(el, vnode, vnode.scopeId, ...)，',
    '   这才是真正把 `data-v-abc123` 属性打到 DOM 元素上的地方',
    '   （runtime-core/src/renderer.ts#L713-L808）',
  ].join('\n'),
)

section('4. 插槽内容用 withCtx() 包裹：恢复“定义插槽的那个实例”')
step('footer 插槽函数被包了一层 _withCtx(() => [...])')
{
  const start = scoped.code.indexOf('footer: _withCtx')
  const end = scoped.code.indexOf('_: 1')
  log(scoped.code.slice(start, end).trim())
}
log(
  '=> 子组件渲染 footer 插槽时，运行的是父组件写的 JSX/模板片段，但这段代码创建的 vnode' +
    '应该带着"父组件"的 scopeId（因为 DOM 结构上这块内容归父组件的样式作用域管）。' +
    'withCtx 在调用插槽函数前后临时把 currentRenderingInstance/currentScopeId 切回父实例，' +
    '用完再切回去 —— 这正是 :slotted() 选择器要解决的样式穿透问题的运行时基础。',
)
