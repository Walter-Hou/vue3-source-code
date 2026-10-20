/**
 * 运行：pnpm ex chapters/13-compiler-sfc/examples/05-props-destructure.ts
 * 演示：3.5 稳定的「响应式 props 解构」—— `const { title, count = 0 } = defineProps<...>()`
 *   解构出来的本地变量在整个 <script setup> 作用域里（包括嵌套的函数体、watch 回调）
 *   都会被静态改写成 `__props.xxx`，所以它们始终是响应式的，不会在解构那一刻被"值拷贝"死。
 * 看点：
 *   1. 默认值 `count = 0` 不是留在本地变量上，而是被挪进了运行时 props 声明的 `default` 字段
 *   2. 别名解构 `label: aliasedLabel` 产生 PROPS_ALIASED 绑定 + `__propsAliases` 映射表
 *   3. walkIdentifiers 会深入函数体、箭头函数、watch 的 getter 回调，逐个替换引用，
 *      而不是只替换顶层的那一次赋值
 */
import { parse, compileScript } from '@vue/compiler-sfc'
import { section, step, log } from '../../../shared/print'

const SFC = `
<template><div>{{ title }} {{ count }}</div></template>
<script setup lang="ts">
import { watch } from 'vue'
const { title, count = 0, label: aliasedLabel } = defineProps<{
  title: string
  count?: number
  label?: string
}>()

watch(() => count, (v) => console.log(v))

function show() {
  console.log(title, count, aliasedLabel)
}
</script>`.trimStart()

const { descriptor } = parse(SFC, { filename: 'Destructure.vue' })
const result = compileScript(descriptor, { id: 'destructure-demo' })

section('1. 完整编译产物')
log(result.content)

section('2. bindingMetadata：别名解构产生 PROPS_ALIASED + __propsAliases')
log(result.bindings)
step('解读')
log(
  [
    'title / count / label  -> PROPS          （解构变量名和 prop 名一致）',
    'aliasedLabel           -> PROPS_ALIASED   （解构变量名与 prop 名不同）',
    '__propsAliases.aliasedLabel = "label"     （记录「本地名 -> 真实 prop 名」）',
  ].join('\n'),
)

section('3. 三处引用都被改写为 __props.xxx（definePropsDestructure.ts#transformDestructuredProps）')
step('watch 的 getter 回调里：() => count  变成  () => __props.count')
log(result.content.match(/watch\(.*\)/)?.[0])
step('普通函数体里：title/count/aliasedLabel 三个标识符都被替换')
log(result.content.match(/function show[\s\S]*?\n\}/)?.[0])

section('4. 默认值去哪了？被 genRuntimeProps 合并进了运行时声明，而不是留在解构赋值里')
log(result.content.match(/props: \{[\s\S]*?\n {2}\},/)?.[0])
log(
  '=> count 的 default: 0 来自 defineProps.ts#genDestructuredDefaultValue，' +
    '它把 ctx.propsDestructuredBindings[key].default 塞进生成的 prop 选项，' +
    '而不是像老式写法那样在 setup 里写 `count = count ?? 0`',
)

section('5. 对比：如果不使用解构（withDefaults 风格），访问方式也是 __props.xxx（见第 4 章示例）')
log('两种写法编译结果趋同，区别只在源码可读性：解构写法不用重复写 props.xxx 前缀')
