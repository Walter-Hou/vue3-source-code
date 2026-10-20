/**
 * 运行：pnpm ex chapters/14-runtime-dom/examples/01-patchProp-dispatch.ts
 * 演示：patchProp 按 key 把 class/style/event/prop/attr 分派到不同模块；
 *      shouldSetAsProp 对 form/list/type/innerHTML/^前缀/.前缀 的判定。
 * 看点：同一个 h() 调用里混用多种 key，对比 el.getAttribute(key) 与 el[key]
 *      两者哪个有值，从而反推 patchProp 实际走的是 patchAttr 还是 patchDOMProp。
 */
import { setupDOM } from '../../../shared/dom'
import { section, step, log } from '../../../shared/print'

setupDOM('<div id="app"></div>')
const { h, render } = await import('vue')

function mount(vnode: any) {
  const container = document.getElementById('app')!
  render(null, container) // 先卸载上一次渲染的内容，让 Vue 自己清理（不要手动改 innerHTML）
  render(vnode, container)
  return container.firstElementChild as HTMLElement
}

// 工具：同时打印 attribute 与 property，一眼看出 patchProp 落到了哪个分支
function probe(el: Element, key: string) {
  const attr = el.getAttribute(key)
  const prop = (el as any)[key]
  log(`${key.padEnd(12)} attribute=${JSON.stringify(attr)}  property=${JSON.stringify(prop)}`)
}

section('1. class / style 走专门模块，不受 shouldSetAsProp 影响')
{
  const el = mount(h('div', { class: 'a b', style: { color: 'red' } }))
  step('h("div", { class: "a b", style: { color: "red" } })')
  // class 落到 patchClass -> el.className；style 落到 patchStyle -> el.style.xxx
  log('el.className =', el.className)
  log('el.style.color =', el.style.color)
  log('el.getAttribute("style") =', el.getAttribute('style'))
}

section('2. 普通 DOM 属性：key in el 为 true -> patchDOMProp（当 prop）')
{
  // <div id="x"> 的 id 在 Element 原型上存在 setter，shouldSetAsProp 返回 true
  const el = mount(h('div', { id: 'x', title: 'hi' }))
  step('h("div", { id: "x", title: "hi" })')
  probe(el, 'id')
  probe(el, 'title')
  log('两者都是 "property 兼 attribute" 的标准 DOM 属性，设置 property 后浏览器会同步反映到 attribute')
}

section('3. shouldSetAsProp 特判：form 属性必须走 attribute（只读 prop）')
{
  // patchProp.ts#L127-L129：key === 'form' 时 shouldSetAsProp 返回 false
  const el = mount(h('button', { form: 'my-form' }))
  step('h("button", { form: "my-form" })')
  probe(el, 'form')
  log('button.form 这个 property 是只读的（指向 HTMLFormElement），只能靠 setAttribute 生效')
}

section('4. shouldSetAsProp 特判：<input list> 必须走 attribute')
{
  // patchProp.ts#L132-L134
  const el = mount(h('input', { list: 'options-id' }))
  step('h("input", { list: "options-id" })')
  probe(el, 'list')
  log('input.list 这个 property 是只读的（指向 <datalist> 元素），同样强制走 patchAttr')
}

section('5. shouldSetAsProp 特判：<textarea type> 必须走 attribute')
{
  // patchProp.ts#L136-L139：textarea 没有真正的 type property（继承自 HTMLElement 则是 undefined），
  // 但如果当成 prop 设置，部分实现会抛错或无意义，所以强制走 attribute
  const el = mount(h('textarea', { type: 'text' }))
  step('h("textarea", { type: "text" })')
  probe(el, 'type')
}

section('6. innerHTML：既不是 class/style/event，也会命中 shouldSetAsProp 的 "innerHTML/textContent 恒为 true"')
{
  const el = mount(h('div', { innerHTML: '<b>bold</b>' }))
  step('h("div", { innerHTML: "<b>bold</b>" })')
  log('el.innerHTML =', el.innerHTML)
  log('el.getAttribute("innerHTML") =', el.getAttribute('innerHTML'))
  log('innerHTML 永远落到 patchDOMProp，被当成 DOM property 直接赋值（modules/props.ts#L16-L23）')
}

section('7. `^` 前缀：强制当 attribute（跳过 shouldSetAsProp 判定）')
{
  // patchProp.ts#L43-L49：key[0] === '^' 时直接走 attribute 分支（false 分支）
  const el = mount(h('div', { '^id': 'forced-attr' } as any))
  step('h("div", { "^id": "forced-attr" })')
  probe(el, 'id')
  log('编译器看到模板里的 .prop / ^attr 前缀会生成这种 key；^ 前缀即使 "id in el" 为 true 也强制走 patchAttr')
}

section('8. `.` 前缀：强制当 property（跳过 shouldSetAsProp 判定）')
{
  // patchProp.ts#L43-L49：key[0] === '.' 时直接走 property 分支（true 分支），对应模板里的 `<div .foo="val">`
  const el = mount(h('div', { '.myCustomProp': { x: 1 } } as any))
  step('h("div", { ".myCustomProp": { x: 1 } })')
  log('(el as any).myCustomProp =', (el as any).myCustomProp)
  log('.foo 前缀用于把任意值（哪怕是对象）硬塞成 DOM property，常用于自定义元素 / web component 互操作')
}

section('9. width/height on <img>：必须走 attribute')
{
  // patchProp.ts#L142-L152
  const el = mount(h('img', { width: 100, height: 50 }))
  step('h("img", { width: 100, height: 50 })')
  probe(el, 'width')
  probe(el, 'height')
}
