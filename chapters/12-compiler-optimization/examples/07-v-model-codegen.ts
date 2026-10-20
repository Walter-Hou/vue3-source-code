/**
 * 运行：pnpm ex chapters/12-compiler-optimization/examples/07-v-model-codegen.ts
 * 演示：v-model 在组件 vs 原生表单元素上编译出完全不同的东西——组件走
 *       compiler-core 的 transformModel（生成 props + 事件），原生元素被
 *       compiler-dom 的 transformModel 接管，改成跑时指令（withDirectives +
 *       resolveDirective 出 vModelText/vModelCheckbox/vModelRadio/vModelSelect/
 *       vModelDynamic 这几个内置指令对象）。
 * 看点：
 *  1. 组件 v-model：`modelValue` prop + `onUpdate:modelValue` 事件，参数化的
 *     `v-model:title` 会变成 `title` / `onUpdate:title`；修饰符会多生成一个
 *     `xxxModifiers` 的静态对象 prop。
 *  2. 原生元素：根据 tag + type 属性选择不同的内置指令——text/textarea 用 vModelText，
 *     checkbox 用 vModelCheckbox，radio 用 vModelRadio，select 用 vModelSelect；
 *     `type` 是动态绑定时（`:type="t"`）没法在编译期确定，退化成 vModelDynamic。
 *  3. 原生 v-model 的 props 列表里**没有** `modelValue`，只有一个 `value`/事件——
 *     因为指令对象的 `beforeMount`/`updated` 钩子会直接读 `binding.value`，
 *     compiler-dom 的 transformModel 最后会把 modelValue 这个 prop 过滤掉
 *     （见 compiler-dom/transforms/vModel.ts 末尾的 filter），省掉重复。
 *  4. `<input type="file">` 是单向的（只能用户选文件，不能程序赋值），用 v-model
 *     会被编译期直接报错。
 */
import { compile } from '@vue/compiler-dom'
import { section, step, log } from '../../../shared/print'

section('1. 组件 v-model：modelValue + onUpdate:modelValue')
log(compile(`<Comp v-model="value"/>`).code)

step('带参数：v-model:title -> title / onUpdate:title')
log(compile(`<Comp v-model:title="value"/>`).code)

step('带修饰符：v-model.trim -> 额外生成 modelModifiers 静态对象')
log(compile(`<Comp v-model.trim="value"/>`).code)

section('2. 原生 <input type="text">：vModelText 指令')
log(compile(`<input v-model="value">`).code)

step('<textarea v-model>：同样用 vModelText')
log(compile(`<textarea v-model="value"></textarea>`).code)

section('3. <input type="checkbox">：vModelCheckbox')
log(compile(`<input type="checkbox" v-model="checked">`).code)

section('4. <input type="radio">：vModelRadio')
log(compile(`<input type="radio" value="a" v-model="picked">`).code)

section('5. <select v-model>：vModelSelect')
log(compile(`<select v-model="selected"><option value="a">A</option></select>`).code)

section('6. type 是动态绑定：编译期无法确定，退化成 vModelDynamic')
log(compile(`<input :type="inputType" v-model="value">`).code)

section('7. <input type="file"> + v-model：编译期直接报错')
try {
  compile(`<input type="file" v-model="file">`)
} catch (e) {
  log('捕获到异常：', (e as Error).message)
}
