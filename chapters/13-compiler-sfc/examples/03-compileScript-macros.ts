/**
 * 运行：pnpm ex chapters/13-compiler-sfc/examples/03-compileScript-macros.ts
 * 演示：defineProps 的运行时写法 vs 类型写法 vs withDefaults、defineEmits、
 *   defineModel、defineExpose、defineOptions 分别编译出什么样的运行时 options。
 * 看点：
 *   1. 宏调用本身会被 MagicString 整体删除/替换（源文件里看不到 defineProps 的痕迹）
 *   2. 类型写法的 props 会被 resolveType 推导出 { type: Xxx, required: ... }
 *   3. defineModel() 展开成「一个 props + 一个 modelModifiers prop + 一条 emits」
 *      并把调用点改写为 useModel(__props, 'xxx')
 */
import { parse, compileScript } from '@vue/compiler-sfc'
import { section, step, log } from '../../../shared/print'

function compile(src: string, id: string) {
  const { descriptor } = parse(src, { filename: `${id}.vue` })
  return compileScript(descriptor, { id })
}

/** 从 content 里找到 `marker` 后第一个 `{`，按括号配对截到对应的 `}`（含 marker 本身） */
function extractBlock(content: string, marker: string): string {
  const markerIdx = content.indexOf(marker)
  if (markerIdx === -1) return `(未找到 ${marker})`
  const braceStart = content.indexOf('{', markerIdx)
  let depth = 0
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === '{') depth++
    else if (content[i] === '}') {
      depth--
      if (depth === 0) return content.slice(markerIdx, i + 1)
    }
  }
  return content.slice(markerIdx)
}

/** 提取 `marker` 后的一个方括号数组字面量（用于 emits: [...]） */
function extractArray(content: string, marker: string): string {
  const markerIdx = content.indexOf(marker)
  if (markerIdx === -1) return `(未找到 ${marker})`
  const end = content.indexOf(']', markerIdx)
  return content.slice(markerIdx, end + 1)
}

section('1. defineProps 运行时写法')
const runtimeProps = compile(
  `
<script setup>
const props = defineProps({
  title: { type: String, required: true },
  count: { type: Number, default: 0 },
})
</script>`,
  'runtime-props',
)
step('props 运行时写法原样透传（没有类型推导）')
log(extractBlock(runtimeProps.content, 'props:'))

section('2. defineProps 类型写法（触发 resolveType 推导）')
const typeProps = compile(
  `
<script setup lang="ts">
interface Props {
  title: string
  count?: number
  onSave?: () => void
}
const props = defineProps<Props>()
</script>`,
  'type-props',
)
step('推导出的 runtime props（见 defineProps.ts#genRuntimePropFromType）')
log(extractBlock(typeProps.content, 'props:'))
log('bindings.title/count/onSave =', [
  typeProps.bindings?.title,
  typeProps.bindings?.count,
  typeProps.bindings?.onSave,
])

section('3. withDefaults + 类型写法')
const withDefaults = compile(
  `
<script setup lang="ts">
interface Props {
  title: string
  size?: 'small' | 'large'
}
const props = withDefaults(defineProps<Props>(), {
  size: 'small',
})
</script>`,
  'with-defaults',
)
step('withDefaults 把默认值塞进了 generated 的 default 字段')
log(extractBlock(withDefaults.content, 'props:'))

section('4. defineEmits：运行时数组 vs 类型写法')
const runtimeEmits = compile(
  `
<script setup>
const emit = defineEmits(['change', 'save'])
function onClick() { emit('change', 1) }
</script>`,
  'runtime-emits',
)
step('emits 运行时数组原样透传 + emit() 调用点被改写为 __emit')
log(extractArray(runtimeEmits.content, 'emits:'))
log(extractBlock(runtimeEmits.content, 'function onClick'))

const typeEmits = compile(
  `
<script setup lang="ts">
const emit = defineEmits<{ change: [value: number]; save: [] }>()
</script>`,
  'type-emits',
)
step('类型写法：从 TSFunctionType/调用签名推导出事件名列表（见 defineEmits.ts#extractRuntimeEmits）')
log(extractArray(typeEmits.content, 'emits:'))

section('5. defineModel：展开成 props + modifiers prop + emits，并改写调用点')
const model = compile(
  `
<script setup lang="ts">
const modelValue = defineModel<string>()
const count = defineModel<number>('count', { default: 0 })
</script>`,
  'define-model',
)
step('props：modelValue / modelModifiers / count / countModifiers（见 defineModel.ts#genModelProps）')
log(extractBlock(model.content, 'props:'))
step('emits：自动补上 update:modelValue / update:count')
log(extractArray(model.content, 'emits:'))
step('调用点改写：defineModel(...) -> _useModel(__props, ...)')
log(model.content.match(/const modelValue[\s\S]*?\n.*?const count[\s\S]*?\)/)?.[0])

section('6. defineExpose：callee 改写为 __expose，且不再自动插入空调用')
const expose = compile(
  `
<script setup>
import { ref } from 'vue'
const inner = ref(0)
defineExpose({ inner })
</script>`,
  'define-expose',
)
step('defineExpose({...}) -> __expose({...})')
log(expose.content.match(/__expose\(\{[\s\S]*?\}\)/)?.[0])

section('7. defineOptions：合入运行时 options（注意它不影响自动生成的 __name）')
const options = compile(
  `
<script setup>
defineOptions({ name: 'MyWidget', inheritAttrs: false })
</script>`,
  'define-options',
)
step('defineOptions({...}) 整体被当作 Object.assign 的第一个参数拼进产物')
log(options.content)
step(
  '注意：__name 仍然是按文件名自动生成的（compileScript.ts#L1019-L1024 只在' +
    '`ctx.hasDefaultExportName` 时才跳过，而这个标记只由普通 <script> 里手写的 ' +
    "`export default { name }` 置位，defineOptions() 不会设置它）。" +
    '所以这里 name 和 __name 会同时存在，是两个不同用途的字段：' +
    'name 是用户可见的组件名（递归自引用、devtools 显示用），' +
    '__name 是编译器塞的内部字段（也用于 devtools/HMR 兜底显示）。',
)
