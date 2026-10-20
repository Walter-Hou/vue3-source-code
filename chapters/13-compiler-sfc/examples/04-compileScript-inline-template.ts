/**
 * 运行：pnpm ex chapters/13-compiler-sfc/examples/04-compileScript-inline-template.ts
 * 演示：`inlineTemplate: true/false` 两种模式下，同一个模板表达式
 *   （ref、props、事件处理函数）最终访问方式完全不同。
 * 看点：
 *   1. 非 inline 模式：compileScript 不处理模板，构建工具（vite-plugin-vue）
 *      要另外调用 compileTemplate() 生成一个独立的 render 函数，
 *      通过 `render(_ctx, _cache, $props, $setup, $data, $options)` 的参数访问状态，
 *      ref 在这里访问的是 `$setup.count`（不带 .value，因为模板里对 ref 会自动解包）
 *   2. inline 模式：render 函数直接写在 setup() 末尾作为闭包返回，
 *      count 是 setup 作用域里的本地变量，所以要显式 `.value`；
 *      props 用 `__props.title` 而不是 `$props.title`
 *   3. 两种模式殊途同归：都是 compiler-core/transforms/transformExpression.ts
 *      里 `rewriteIdentifier()` 根据 bindingMetadata 和 `inline` 选项做的改写
 */
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { section, step, log } from '../../../shared/print'

const SFC = `
<template><div @click="inc">{{ count }} - {{ title }}</div></template>
<script setup lang="ts">
import { ref } from 'vue'
const props = defineProps<{ title: string }>()
const count = ref(0)
function inc() { count.value++ }
</script>`.trimStart()

const { descriptor } = parse(SFC, { filename: 'Inline.vue' })

section('1. inlineTemplate: false（生产环境构建工具的默认路径之一）')
step('compileScript 只编译脚本，不碰模板 —— setup() 直接 return __returned__')
const nonInline = compileScript(descriptor, {
  id: 'inline-demo',
  inlineTemplate: false,
})
log(nonInline.content)

step('构建工具另外调用 compileTemplate()，用 bindingMetadata 决定如何访问状态')
const standaloneRender = compileTemplate({
  id: 'inline-demo',
  filename: 'Inline.vue',
  source: descriptor.template!.content,
  compilerOptions: { bindingMetadata: nonInline.bindings },
})
log(standaloneRender.code)
log(
  '=> ref 访问 $setup.count（不带 .value，因为 $setup 实参是 proxyRefs() 包过的 ' +
    'setupState，读取时自动 unref）；props 访问 $props.title；' +
    '事件处理函数 $setup.inc 同理',
)

section('2. inlineTemplate: true（@vitejs/plugin-vue 生产构建的常用路径）')
step('compileScript 内部直接调用 compileTemplate({ inline: true, ... })，把 render 函数拼进 setup() 末尾')
const inline = compileScript(descriptor, {
  id: 'inline-demo',
  inlineTemplate: true,
})
log(inline.content)
log(
  '=> count 是 setup() 作用域里的局部变量（ref 对象本身），所以要显式 `.value`；' +
    'props.title 不能用，因为没有 props 这个本地变量名 —— 直接生成 `__props.title`；' +
    '事件处理函数 `inc` 可以直接当闭包变量使用，不需要任何前缀',
)

section('3. 两种模式的本质区别：bindingMetadata 一样，只是 context.inline 不同')
log(
  [
    '源码位置：compiler-core/src/transforms/transformExpression.ts#rewriteIdentifier',
    '',
    'if (inline) {',
    '  SETUP_REF        => `${raw}.value`',
    '  SETUP_MAYBE_REF  => `_unref(${raw})`（非赋值场景）',
    '  PROPS            => genPropsAccessExp(raw)  // __props.xxx',
    '} else {',
    '  type startsWith "setup" => `$setup.${raw}`',
    '  PROPS                   => `$props.${raw}`',
    '  // render(_ctx,_cache,$props,$setup,...) 的 $setup 实参就是 instance.setupState，',
    '  // 而 instance.setupState = proxyRefs(setupResult)（runtime-core/component.ts#L964），',
    '  // proxyRefs 在 get/set 时自动 unref，所以模板里读 $setup.xxx 不需要 .value',
    '}',
  ].join('\n'),
)
