/**
 * 运行：pnpm ex chapters/11-compiler-core/examples/04-codegen-modes.ts
 * 演示：同一个模板，在 mode: 'function' / 'module'、prefixIdentifiers: true/false、
 *       以及不同 bindingMetadata 下，codegen 产物长什么样。
 * 看点：
 *  1. mode: 'function' + prefixIdentifiers: false（浏览器运行时默认）-> `with (_ctx) { ... }`，
 *     helper 在 with 块内部解构，避免每次属性访问都要走 `in` 判断。
 *  2. mode: 'module' 会强制 prefixIdentifiers = true（compile.ts#L80 `isModuleMode` 那行），
 *     因为 ES Module 顶层不能用 with，变量必须显式 `import { xxx as _xxx } from 'vue'`。
 *  3. prefixIdentifiers 开启后，裸标识符会被 processExpression 加上 `_ctx.` 前缀；
 *     如果传了 bindingMetadata，不同 BindingTypes 会走不同前缀（$setup./$props./$data./_ctx.）。
 *  4. 同一个 mode: 'function' 也可以手动打开 prefixIdentifiers（Node 环境下
 *     __BROWSER__ 为 false，不受限制），此时既不会生成 with，也不会生成 import，
 *     纯粹是"看前缀效果"的中间状态，真实场景不会这样用。
 */
import { compile } from '@vue/compiler-dom'
import { BindingTypes } from '@vue/compiler-core'
import { section, step, log } from '../../../shared/print'

const template = `<div>{{ msg }} - {{ count }}</div>`

section("1. mode: 'function'，prefixIdentifiers: false（默认，浏览器运行时编译）")
step('产物')
log(compile(template).code)

section("2. mode: 'module'（构建时编译，比如 vite-plugin-vue）")
step('产物：import 语句 + _ctx. 前缀，没有 with')
log(compile(template, { mode: 'module' }).code)

section('3. 同一个 function 模式，手动打开 prefixIdentifiers（仅用于对比，实际不会这样配置）')
step('既没有 with，也没有 import，直接是裸的 _ctx.xxx')
log(compile(template, { prefixIdentifiers: true }).code)

section('4. bindingMetadata：不同 BindingTypes 决定前缀是 _ctx. 还是 $xxx.')
const bindingMetadata = {
  msg: BindingTypes.SETUP_REF, // <script setup> 里的 ref
  count: BindingTypes.PROPS, // defineProps 声明的 prop
}
step('mode: module 下传入 bindingMetadata（compiler-sfc 编译 <script setup> 时就是这样用的）')
log(
  compile(template, {
    mode: 'module',
    bindingMetadata,
  }).code,
)

section('5. 四种 BindingTypes 前缀对照')
for (const type of [
  BindingTypes.SETUP_REF,
  BindingTypes.PROPS,
  BindingTypes.DATA,
  BindingTypes.OPTIONS,
] as const) {
  const { code } = compile(`{{ x }}`, {
    mode: 'module',
    bindingMetadata: { x: type },
  })
  const line = code.split('\n').find(l => l.includes('return'))!
  step(`BindingTypes.${type} ->`)
  log(line.trim())
}
step('没有命中任何 bindingMetadata 的裸标识符，兜底前缀是 _ctx.')
{
  const { code } = compile(`{{ y }}`, { mode: 'module', bindingMetadata: {} })
  log(code.split('\n').find(l => l.includes('return'))!.trim())
}
