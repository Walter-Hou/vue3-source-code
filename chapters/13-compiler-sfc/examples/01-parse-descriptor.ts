/**
 * 运行：pnpm ex chapters/13-compiler-sfc/examples/01-parse-descriptor.ts
 * 演示：用 @vue/compiler-sfc 的 parse() 把一个包含
 *   <script setup> + 普通 <script> + <style scoped> + 自定义块 的 .vue 源码
 *   拆成 SFCDescriptor，打印每个 block 的关键信息。
 * 看点：
 *   1. descriptor.script / scriptSetup / styles / customBlocks 分别对应哪一段源码
 *   2. SFCBlock.loc 记录的是「这个 block 在整份源文件里的行列偏移」，不是从 0 开始
 *   3. descriptor.cssVars 是从 <style> 里用正则 + 手写小状态机扫出来的 v-bind() 变量名
 *   4. descriptor.slotted 只是一个布尔优化提示（style 里出现 :slotted() 才为 true）
 */
import { parse } from '@vue/compiler-sfc'
import { section, step, log, inspect } from '../../../shared/print'

const SFC = `
<template>
  <p :class="$style.msg" v-slotted-mark>{{ msg }}</p>
  <slot name="footer" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
const msg = ref('hello sfc')
const color = ref('red')
</script>

<script lang="ts">
export default {
  name: 'ParseDemo',
}
</script>

<style scoped>
.msg {
  color: v-bind(color);
}
:slotted(.footer-slot) {
  font-size: 12px;
}
</style>

<custom-block foo="bar">
{ "note": "随便一个自定义块，比如 i18n / docs 元数据" }
</custom-block>
`.trimStart()

section('1. parse() 产出的 SFCDescriptor')
const { descriptor, errors } = parse(SFC, { filename: 'ParseDemo.vue' })

step('errors（期望为空数组）')
log(errors)

step('template block')
log({
  tag: descriptor.template?.type,
  loc: descriptor.template && {
    start: descriptor.template.loc.start,
    end: descriptor.template.loc.end,
  },
  contentPreview: descriptor.template?.content.trim().split('\n')[0] + ' ...',
})

step('scriptSetup block（attrs.setup 为 true 时才会进入这里，见 parse.ts#L196-L208）')
log({
  lang: descriptor.scriptSetup?.lang,
  setup: descriptor.scriptSetup?.setup,
  loc: descriptor.scriptSetup && {
    startLine: descriptor.scriptSetup.loc.start.line,
    endLine: descriptor.scriptSetup.loc.end.line,
  },
  content: descriptor.scriptSetup?.content,
})

step('script block（普通 <script>，与 scriptSetup 可以共存，各自一份）')
log({
  lang: descriptor.script?.lang,
  content: descriptor.script?.content.trim(),
})

step('styles[0]：scoped / module / 原始 content')
log({
  scoped: descriptor.styles[0]?.scoped,
  module: descriptor.styles[0]?.module,
  content: descriptor.styles[0]?.content.trim(),
})

step('customBlocks：type 就是标签名，content 是原文')
log(
  descriptor.customBlocks.map(b => ({
    type: b.type,
    attrs: b.attrs,
    content: b.content.trim(),
  })),
)

step('cssVars：从 style 内容里用 v-bind() 扫出来的变量名列表（见 style/cssVars.ts#parseCssVars）')
log(descriptor.cssVars)

step('slotted：style 里出现 :slotted() → true（见 parse.ts#L287-L291 的 slottedRE）')
log(descriptor.slotted)

section('2. SFCBlock.loc 不是从 0 开始——它是整份源文件里的真实坐标')
step('scriptSetup 内容第一行在源文件中的行号')
log('loc.start.line =', descriptor.scriptSetup?.loc.start.line)
log('（对照上面 SFC 字符串，<script setup> 标签在源文件的第 6 行，内容从第 7 行开始）')

section('3. 完整 descriptor 的字段形状（去掉 source 全文，太长）')
const { source, ...rest } = descriptor as any
log(inspect({ ...rest, template: '(省略，见上)', script: '(省略，见上)', scriptSetup: '(省略，见上)' }, 2))
