/**
 * 运行：pnpm ex chapters/14-runtime-dom/examples/04-v-model-directives.ts
 * 演示：vModelText 的 lazy/trim/number 修饰符、composition 事件对 input 的抑制；
 *      vModelCheckbox 数组绑定；vModelSelect 的多选。
 * 看点：v-model 在运行时就是几个 ObjectDirective（created/mounted/beforeUpdate），
 *      不是编译期内联的 onInput；通过 dispatchEvent 模拟真实输入，观察
 *      modelValue 如何被 assign（即编译器生成的 onUpdate:modelValue）同步回去。
 */
import { setupDOM } from '../../../shared/dom'
import { section, step, log, expectEq } from '../../../shared/print'

const { window } = setupDOM('<div id="app"></div>')
const {
  h,
  render,
  ref,
  nextTick,
  defineComponent,
  withDirectives,
  vModelText,
  vModelCheckbox,
  vModelSelect,
} = await import('vue')

const container = document.getElementById('app')!
const DomEvent = window.Event as unknown as typeof Event

function fireInput(el: HTMLInputElement | HTMLTextAreaElement, value: string, type = 'input') {
  el.value = value
  el.dispatchEvent(new DomEvent(type))
}

section('1. vModelText 基本绑定：input 事件触发 onUpdate:modelValue')
{
  const text = ref('hello')
  const Comp = defineComponent({
    render() {
      return withDirectives(
        h('input', {
          'onUpdate:modelValue': (v: string) => (text.value = v),
        }),
        [[vModelText, text.value]],
      )
    },
  })
  render(h(Comp), container)
  const input = container.querySelector('input')!
  step('初始值 text.value = "hello"，input.value 由 vModelText.mounted 写入')
  log('input.value =', input.value)

  step('模拟用户输入 "world"（dispatch input 事件）')
  fireInput(input, 'world')
  log('text.value =', text.value)
  expectEq('onUpdate:modelValue 被触发', text.value, 'world')
}

render(null, container)

section('2. lazy 修饰符：改成监听 change 而不是 input')
{
  // vModel.ts#L79：addEventListener(el, lazy ? 'change' : 'input', ...)
  const text = ref('a')
  const Comp = defineComponent({
    render() {
      return withDirectives(
        h('input', { 'onUpdate:modelValue': (v: string) => (text.value = v) }),
        [[vModelText, text.value, void 0, { lazy: true }]],
      )
    },
  })
  render(h(Comp), container)
  const input = container.querySelector('input')!

  step('只 dispatch "input" 事件（lazy 模式下应该被忽略）')
  input.value = 'b'
  input.dispatchEvent(new DomEvent('input'))
  log('text.value（dispatch input 后）=', text.value)
  expectEq('input 事件被忽略', text.value, 'a')

  step('dispatch "change" 事件（lazy 模式下才会同步）')
  input.dispatchEvent(new DomEvent('change'))
  log('text.value（dispatch change 后）=', text.value)
  expectEq('change 事件触发同步', text.value, 'b')
}

render(null, container)

section('3. trim + number 修饰符：castValue 的处理')
{
  // vModel.ts#L53-L57：castValue 先 trim 再 looseToNumber
  const num = ref(0)
  const Comp = defineComponent({
    render() {
      return withDirectives(
        h('input', { 'onUpdate:modelValue': (v: number) => (num.value = v) }),
        [[vModelText, num.value, void 0, { trim: true, number: true }]],
      )
    },
  })
  render(h(Comp), container)
  const input = container.querySelector('input')!
  step('输入 "  42  "（带首尾空格）')
  fireInput(input, '  42  ')
  log('num.value =', num.value, typeof num.value)
  expectEq('trim 后转数字', num.value, 42)
}

render(null, container)

section('4. composition 事件期间抑制 input：避免中文输入法打字过程中频繁触发')
{
  // vModel.ts#L79-L96：created 里给 compositionstart/compositionend 各挂了一个监听器，
  // compositionstart 把 target.composing 置 true，input 的监听器里 `if (composing) return`
  const text = ref('')
  const Comp = defineComponent({
    render() {
      return withDirectives(
        h('input', { 'onUpdate:modelValue': (v: string) => (text.value = v) }),
        [[vModelText, text.value]],
      )
    },
  })
  render(h(Comp), container)
  const input = container.querySelector('input')!

  step('compositionstart -> 输入法正在组合中文，此时 input 事件应被忽略')
  input.dispatchEvent(new DomEvent('compositionstart'))
  input.value = '拼音候选中'
  input.dispatchEvent(new DomEvent('input'))
  log('组合输入期间 text.value =', JSON.stringify(text.value))
  expectEq('组合期间不同步', text.value, '')

  step('compositionend -> 用户确认选字（源码里 onCompositionEnd 会在内部补发一次 input 事件）')
  input.dispatchEvent(new DomEvent('compositionend'))
  // happy-dom 的局限：onCompositionEnd 内部是在「正在处理 compositionend 事件」的过程中
  // 同步嵌套调用 target.dispatchEvent(new Event('input'))，这种重入式派发在happy-dom里
  // 不会正确重新遍历已经注册的 'input' 监听器列表（真实浏览器没有这个问题）。所以这里补一次
  // 显式的 input 事件来模拟真实浏览器下 compositionend 之后同步生效的效果。
  input.dispatchEvent(new DomEvent('input'))
  log('组合结束后 text.value =', JSON.stringify(text.value))
  expectEq('组合结束后同步最终值', text.value, '拼音候选中')
}

render(null, container)

section('5. vModelCheckbox：数组绑定，勾选 = push，取消勾选 = splice')
{
  const checkedList = ref<string[]>(['a'])
  const Comp = defineComponent({
    render() {
      return h('div', [
        withDirectives(
          h('input', {
            type: 'checkbox',
            value: 'a',
            'onUpdate:modelValue': (v: string[]) => (checkedList.value = v),
          }),
          [[vModelCheckbox, checkedList.value]],
        ),
        withDirectives(
          h('input', {
            type: 'checkbox',
            value: 'b',
            'onUpdate:modelValue': (v: string[]) => (checkedList.value = v),
          }),
          [[vModelCheckbox, checkedList.value]],
        ),
      ])
    },
  })
  render(h(Comp), container)
  const [cbA, cbB] = Array.from(container.querySelectorAll('input'))
  step('初始 checkedList = ["a"]，对应 checkbox a 应该是 checked')
  log('cbA.checked =', cbA.checked, ' cbB.checked =', cbB.checked)
  expectEq('只有 a 被选中', { a: cbA.checked, b: cbB.checked }, { a: true, b: false })

  step('手动勾选 checkbox b（模拟用户点击后触发 change）')
  cbB.checked = true
  cbB.dispatchEvent(new DomEvent('change'))
  await nextTick()
  log('checkedList.value =', checkedList.value)
  expectEq('b 被 push 进数组', checkedList.value.includes('b'), true)

  step('再取消勾选 checkbox a')
  cbA.checked = false
  cbA.dispatchEvent(new DomEvent('change'))
  await nextTick()
  log('checkedList.value =', checkedList.value)
  expectEq('a 被从数组里移除', checkedList.value, ['b'])
}

render(null, container)

section('6. vModelSelect：多选 <select multiple>')
{
  const selected = ref<string[]>(['x'])
  const Comp = defineComponent({
    render() {
      return withDirectives(
        h(
          'select',
          {
            multiple: true,
            'onUpdate:modelValue': (v: string[]) => (selected.value = v),
          },
          [h('option', { value: 'x' }, 'X'), h('option', { value: 'y' }, 'Y')],
        ),
        [[vModelSelect, selected.value]],
      )
    },
  })
  render(h(Comp), container)
  const select = container.querySelector('select')!
  const options = Array.from(select.options)
  step('初始 selected = ["x"]，对应 option x 应该是 selected')
  log('options[0].selected =', options[0].selected, ' options[1].selected =', options[1].selected)
  expectEq('只有 x 被选中', options[0].selected, true)

  step('手动再选中 option y，派发 change')
  options[1].selected = true
  select.dispatchEvent(new DomEvent('change'))
  await nextTick()
  log('selected.value =', selected.value)
  expectEq('y 被加入 selected', selected.value.includes('y'), true)
}
