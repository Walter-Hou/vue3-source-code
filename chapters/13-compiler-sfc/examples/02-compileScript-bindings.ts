/**
 * 运行：pnpm ex chapters/13-compiler-sfc/examples/02-compileScript-bindings.ts
 * 演示：同一批不同声明方式（字面量 const / ref / let / reactive() / import 组件 / props）
 *   经 compileScript() 之后在 bindingMetadata 里各自落在哪个 BindingTypes。
 * 看点：
 *   1. bindingMetadata 是 compileScript 返回的 SFCScriptBlock.bindings
 *   2. 不同 BindingTypes 决定了模板里访问这个标识符时生成什么代码
 *      （non-inline 模式下是 `$setup.x`/`_ctx.x`，这点在 04 号示例里继续展开）
 *   3. 非 inline 模式下，setup() 会把"暴露给模板用"的绑定打包进 __returned__ 返回对象
 */
import { parse, compileScript } from '@vue/compiler-sfc'
import { section, step, log } from '../../../shared/print'

const SFC = `
<template><div>{{ a }}{{ b }}{{ n }}{{ c }}{{ Comp }}{{ foo }}</div></template>
<script setup lang="ts">
import Comp from './Comp.vue'
import { reactive, ref } from 'vue'

const a = 'literal string'      // 字面量常量 -> LITERAL_CONST
const obj = { x: 1 }            // 非字面量 const，但 canNeverBeRef -> SETUP_CONST
const n = ref(0)                // ref() -> SETUP_REF
let count = 0                   // let -> SETUP_LET
const state = reactive({ x: 1 })// reactive() -> SETUP_REACTIVE_CONST
const maybe = useSomething()    // 既不是字面量也不是已知的 ref 工厂 -> SETUP_MAYBE_REF
function useSomething() { return 1 }

defineProps<{ foo: string }>()
</script>
`.trimStart()

const { descriptor } = parse(SFC, { filename: 'Bindings.vue' })
const result = compileScript(descriptor, { id: 'bindings-demo' })

section('1. bindingMetadata：各种声明方式对应的 BindingTypes')
step('完整 bindings 对象（key -> BindingTypes 字符串）')
log(result.bindings)

step('逐项解读')
for (const [key, type] of Object.entries(result.bindings ?? {})) {
  if (key.startsWith('__')) continue
  log(`${key.padEnd(10)} -> ${type}`)
}

section('2. 编译产物（dev 非 inline 模式）')
step('生成的 setup() 末尾 —— 注意 __returned__ 对象与 __isScriptSetup 标记')
const lines = result.content.split('\n')
const tailStart = lines.findIndex(l => l.includes('__returned__'))
log(lines.slice(Math.max(0, tailStart - 1), tailStart + 3).join('\n'))

step('完整产物（节选顶部 import + defineComponent 签名）')
log(lines.slice(0, 6).join('\n'))

section('3. 对照源码判定规则（compileScript.ts#walkDeclaration, L1146-L1239）')
log(
  [
    'const 字面量（字符串/数字/布尔/模板字面量等） => LITERAL_CONST',
    'const 初始值是 canNeverBeRef（对象/数组/函数/new 表达式等字面量） => SETUP_CONST',
    'const = reactive(...) => SETUP_REACTIVE_CONST',
    'const = ref()/computed()/shallowRef()/toRef()/defineModel() 等已知工厂 => SETUP_REF',
    '其余 const = 某个函数调用（不确定是不是 ref） => SETUP_MAYBE_REF',
    'let 声明 => SETUP_LET',
    'defineProps<{ ... }>() 的字段 => PROPS',
  ].join('\n'),
)
