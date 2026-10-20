/**
 * 运行：pnpm ex chapters/13-compiler-sfc/examples/07-compileStyle-scoped-cssvars.ts
 * 演示：compileStyle() 的 postcss 插件管线——scoped 选择器改写、
 *   :deep()/:slotted()/:global()、keyframes 改名，以及 v-bind() CSS 变量
 *   如何在 style 侧变成 var(--xxx)，在 script 侧配套生成 useCssVars() 调用。
 * 看点：
 *   1. 普通选择器 `.a` -> `.a[data-v-xxx]`；`:deep(.inner)` -> `[data-v-xxx] .inner`
 *   2. `::v-slotted(.foo)` 用的是另一个后缀 `-s`，不是普通 scopeId
 *   3. @keyframes 名字被加上 `-${shortId}` 后缀，且引用它的 animation/animation-name 一并改写
 *   4. v-bind(color) 在 CSS 里变成 var(--xxx-color)，在 compileScript 产物里对应一段
 *      useCssVars(_ctx => ({ "xxx-color": (...) })) —— 两边用同一个 hash 规则对上
 */
import { compileStyle } from '@vue/compiler-sfc'
import { parse, compileScript } from '@vue/compiler-sfc'
import { section, step, log } from '../../../shared/print'

const CSS = `
.a { color: red; }
.b .c { color: blue; }
:deep(.inner) { color: green; }
::v-slotted(.foo) { font-weight: bold; }
.wrap {
  color: v-bind(color);
}
@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.fadein { animation: fade 1s; }
`.trim()

section('1. compileStyle({ scoped: true }) 的选择器改写')
const result = compileStyle({
  id: 'data-v-abc123',
  filename: 'Style.vue',
  source: CSS,
  scoped: true,
})
log(result.code)
step('逐条解读（style/pluginScoped.ts#processRule / rewriteSelector）')
log(
  [
    '.a                 -> .a[data-v-abc123]                 普通选择器，追加属性选择器',
    '.b .c              -> .b .c[data-v-abc123]               只给"最后一个复合选择器"加',
    ':deep(.inner)      -> [data-v-abc123] .inner             deep 的锚点在前面，内部不加',
    '::v-slotted(.foo)  -> .foo[data-v-abc123-s]              slotted 用的是 id + "-s" 后缀',
    '@keyframes fade    -> @keyframes fade-abc123             关键帧改名，避免跨组件冲突',
    'animation: fade 1s -> animation: fade-abc123 1s          同步改写引用处',
  ].join('\n'),
)

section('2. v-bind() 变量：CSS 侧 var()，script 侧 useCssVars()')
step('CSS 侧：v-bind(color) 变成 var(--xxx-color)')
log(result.code.match(/\.wrap\[[\s\S]*?\}/)?.[0])

const SFC = `
<template><div class="wrap">{{ color }}</div></template>
<script setup>
import { ref } from 'vue'
const color = ref('red')
</script>
<style scoped>
.wrap { color: v-bind(color); }
</style>
`.trim()
const { descriptor } = parse(SFC, { filename: 'CssVars.vue' })
const script = compileScript(descriptor, { id: 'data-v-abc123' })
step('script 侧：compileScript 自动在 setup() 顶部注入 useCssVars() 调用（同一个 id -> 同一个变量名）')
log(script.content)

section('3. 运行时 useCssVars 怎么把变量值写到 DOM 上（runtime-dom/src/helpers/useCssVars.ts）')
log(
  [
    'onMounted 时：watch(setVars, NOOP, { flush: "post" }) 建立响应式订阅，',
    '  同时用 MutationObserver 盯着挂载点的父节点，DOM 结构变化（比如被 Teleport 移动）也会重新设置变量',
    'setVars() 内部调用 getter(instance.proxy) 算出 { "xxx-color": "red" } 这样的对象，',
    '  再逐个 setVarsOnNode(el, vars) 实际执行 el.style.setProperty("--xxx-color", "red")',
    '依赖的 color 变化时，watch 的回调重新执行 setVars，CSS 变量随之更新 —— ',
    '  不需要重新生成任何 CSS 规则，这是 v-bind() 比"写一堆条件 class"更轻量的原因',
  ].join('\n'),
)

section('4. :global() 不加任何东西（原样保留，用户自己负责全局样式的影响范围）')
const globalCss = compileStyle({
  id: 'data-v-abc123',
  filename: 'Global.vue',
  source: `:global(.reset) { margin: 0; }`,
  scoped: true,
})
log(globalCss.code)
