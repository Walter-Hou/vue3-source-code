/**
 * 运行：pnpm ex chapters/12-compiler-optimization/examples/06-slots-codegen.ts
 * 演示：buildSlots() 产出的三种 slotFlag（STABLE/DYNAMIC/FORWARDED）、renderSlot 的
 *       fallback 内容、动态插槽名、以及 v-for + v-slot 生成的 createSlots(...)。
 * 看点：
 *  1. 插槽被编译成函数（`() => [...]`），用 withCtx 包裹——因为插槽内容在"使用插槽的
 *     那个作用域"里求值，但要在"定义插槽的组件"渲染时执行，withCtx 负责在执行期间
 *     临时切换 currentRenderingInstance，让 inject/响应式依赖收集落到正确的组件上。
 *  2. slots 对象最后有个 `_: 1/2/3` 字段（slotFlagsText 能看到名字），运行时靠它判断
 *     "插槽是否需要强制走 force update"：STABLE(1) 表示插槽内容不依赖外部作用域，
 *     DYNAMIC(2) 用于编译器认为"插槽本身" compiled from a legit template that may change
 *     （比如在 v-for/v-slot 里)，FORWARDED(3) 表示这个组件只是把自己收到的插槽原样转发。
 *  3. `<slot name="x" :foo="bar">fallback</slot>` 编译成
 *     `renderSlot($slots, "x", { foo: bar }, () => [fallback])`——插槽使用方
 *     不需要关心这个组件内部是否提供了该插槽，renderSlot 运行时会自己决定用
 *     传入的 slot 函数还是 fallback。
 *  4. `<template v-slot:[name]>` 动态插槽名、`<template v-for v-slot>` 都会让
 *     hasDynamicSlots=true，产物从单纯的 slots 对象变成 createSlots(slots, [...动态项])。
 */
import { compile } from '@vue/compiler-dom'
import { section, step, log } from '../../../shared/print'

section('1. 最简单的默认插槽：隐式 default，slotFlag = STABLE(1)')
log(compile(`<Comp>hello {{ name }}</Comp>`).code)

section('2. 具名插槽 + 作用域插槽 props')
log(
  compile(
    `<Comp><template #header="{ title }">{{ title }}</template><template #default>body</template></Comp>`,
  ).code,
)

section('3. transformSlotOutlet：<slot> 出口，带 fallback 和传给插槽的 props')
log(compile(`<slot name="footer" :year="2024">© default footer</slot>`).code)

section('4. 动态插槽名：<template v-slot:[name]> -> slotFlag 变成 DYNAMIC(2)')
log(compile(`<Comp><template v-slot:[slotName]>{{ content }}</template></Comp>`).code)

section('5. v-for + v-slot：生成 createSlots(...) + renderList 动态项')
log(
  compile(
    `<Comp><template v-for="tab in tabs" #[tab.name]="{ active }">{{ tab.name }}: {{ active }}</template></Comp>`,
  ).code,
)

section('6. FORWARDED(3)：组件内部只是把收到的插槽原样转发给子组件')
log(
  compile(`<Outer><Inner><slot/></Inner></Outer>`).code,
)
