/**
 * 运行：pnpm ex chapters/09-props-emits-slots/examples/03-emit-and-v-model.ts
 * 演示：emit() 查找 onXxx / onXxxOnce 处理函数的顺序，v-model 修饰符（trim/number）的处理，
 *       useModel() 的本地状态双向同步，以及父组件没有传 modelValue 时的本地回退行为。
 * 看点：
 *   1. emit('customEvent') 实际查找的是 props.onCustomEvent（toHandlerKey + camelize 转换），
 *      大小写不敏感的事件名在 DOM 模板里很容易踩坑，emit() 内部专门有一段警告逻辑。
 *   2. v-model 的修饰符是通过 `${name}Modifiers`（或 modelModifiers）这个"隐藏 prop"传递的，
 *      emit() 在触发 update:xxx 事件前会读取它并对参数做 trim/number 转换。
 *   3. useModel() 返回一个 customRef：读的时候看 props，写的时候 emit('update:xxx')；
 *      如果父组件没有监听 onUpdate:xxx，会退化成一个纯本地状态（hasVModel = false 分支）。
 */
import { defineComponent, h, nextTick, ref, useModel } from '@vue/runtime-core'
import { createApp, createRoot, triggerEvent } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

section('1. emit() 的事件名查找：onXxx / camelCase / onXxxOnce')

let emitFn: any
const EmitChild = defineComponent({
  name: 'EmitChild',
  emits: ['customEvent'],
  setup(_, { emit }) {
    emitFn = emit
    return () => h('div', 'emit-child')
  },
})

const calls: string[] = []
const EmitRoot = defineComponent({
  name: 'EmitRoot',
  render: () =>
    h(EmitChild, {
      onCustomEvent: (...args: any[]) => calls.push(`onCustomEvent: ${JSON.stringify(args)}`),
      onCustomEventOnce: (...args: any[]) => calls.push(`onCustomEventOnce: ${JSON.stringify(args)}`),
    } as any),
})
createApp(EmitRoot).mount(createRoot())

step('emit("customEvent", 1) —— toHandlerKey("customEvent") = "onCustomEvent"')
emitFn('customEvent', 1)
log(calls)

step('同一个事件名的 Once 处理函数：源码查找 props[handlerName + "Once"]，首次触发后用 instance.emitted 去重')
calls.length = 0
emitFn('customEvent', 2)
emitFn('customEvent', 3) // 第二次触发，Once 处理函数不应该再被调用
log(calls, '(onCustomEventOnce 应该只出现一次，即使 emit 了两次)')

section('2. v-model 修饰符：trim / number')

let emitFn2: any
const ModChild = defineComponent({
  name: 'ModChild',
  props: { modelValue: String, modelModifiers: { default: () => ({}) } },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    emitFn2 = emit
    return () => h('div', `value=${props.modelValue}`)
  },
})

let receivedValue: any
const ModRoot = defineComponent({
  name: 'ModRoot',
  render: () =>
    h(ModChild, {
      modelValue: 'init',
      'onUpdate:modelValue': (v: any) => (receivedValue = v),
      modelModifiers: { trim: true, number: false },
    } as any),
})
createApp(ModRoot).mount(createRoot())

step('emit("update:modelValue", "  hello  ")，modelModifiers.trim = true')
emitFn2('update:modelValue', '  hello  ')
log('父组件收到的值 =', JSON.stringify(receivedValue), '(前后空格被 trim 掉)')

let emitFn3: any
const NumChild = defineComponent({
  name: 'NumChild',
  props: { age: Number, ageModifiers: { default: () => ({}) } },
  emits: ['update:age'],
  setup(props, { emit }) {
    emitFn3 = emit
    return () => h('div', `age=${props.age}`)
  },
})
let receivedAge: any
const NumRoot = defineComponent({
  name: 'NumRoot',
  // v-model:age.number 编译产物等价形式：传 `ageModifiers` 这个隐藏 prop
  render: () =>
    h(NumChild, {
      age: 0,
      'onUpdate:age': (v: any) => (receivedAge = v),
      ageModifiers: { number: true },
    } as any),
})
createApp(NumRoot).mount(createRoot())
step('emit("update:age", "42")，ageModifiers.number = true（针对具名 v-model:age）')
emitFn3('update:age', '42')
log('父组件收到的值 =', receivedAge, ', typeof =', typeof receivedAge, '(字符串被转成数字)')

section('3. useModel()：本地 ref 与 props 双向同步')

let localModelRef: any
const UseModelChild = defineComponent({
  name: 'UseModelChild',
  props: { modelValue: { type: String, default: undefined } },
  emits: ['update:modelValue'],
  setup(props) {
    const model = useModel(props, 'modelValue')
    localModelRef = model
    return () => h('input' as any, { value: model.value })
  },
})

section('3a. 父组件传了 v-model（有 onUpdate:modelValue 监听）')

const parentValue = ref('from-parent')
const updates: string[] = []
const UseModelParent = defineComponent({
  name: 'UseModelParent',
  render: () =>
    h(UseModelChild, {
      modelValue: parentValue.value,
      'onUpdate:modelValue': (v: string) => {
        updates.push(v)
        parentValue.value = v
      },
    } as any),
})
createApp(UseModelParent).mount(createRoot())
step('子组件内部 model.value = "typed" （模拟用户在 input 里打字）')
localModelRef.value = 'typed'
await nextTick()
log('父组件的 onUpdate:modelValue 被调用 =', updates)
log('parentValue.value =', parentValue.value, '(双向同步成功)')

section('3b. 父组件完全没有传 modelValue / 监听器：useModel 退化为本地状态')

const NoParentModel = defineComponent({
  name: 'NoParentModel',
  render: () => h(UseModelChild), // 不传任何 props
})
createApp(NoParentModel).mount(createRoot())
step('没有 v-model 绑定，子组件内部仍然可以读写 model.value（本地状态）')
log('初始 model.value =', localModelRef.value)
localModelRef.value = 'local-only'
log('修改后 model.value =', localModelRef.value, '(hasVModel=false 分支：localValue 直接本地更新，同时仍会 emit，只是没人监听)')
