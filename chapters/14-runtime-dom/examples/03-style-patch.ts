/**
 * 运行：pnpm ex chapters/14-runtime-dom/examples/03-style-patch.ts
 * 演示：patchStyle 对 object/string/数组多值/!important/CSS 变量/属性删除的处理；
 *      v-show 切换时如何保留并恢复用户自己设置的 display 值。
 * 看点：对象形式更新时「旧 key 在新对象里消失」会被置空；CSS 变量走 setProperty
 *      而不是普通属性赋值；v-show 隐藏时 style.display 被强制 'none'，
 *      显示时恢复成 patchStyle 记录的「原本应该是什么」而不是写死的 ''。
 */
import { setupDOM } from '../../../shared/dom'
import { section, step, log, expectEq } from '../../../shared/print'

setupDOM('<div id="app"></div>')
const { h, render, vShow, withDirectives, ref, nextTick, defineComponent } = await import('vue')

const container = document.getElementById('app')!

function mount(vnode: any) {
  render(null, container)
  render(vnode, container)
  return container.firstElementChild as HTMLElement
}

section('1. 对象形式 style：逐个 key 走 setStyle')
{
  const el = mount(h('div', { style: { color: 'red', fontSize: '14px' } }))
  step('style = { color: "red", fontSize: "14px" }')
  log('el.style.cssText =', el.style.cssText)
}

section('2. 对象 -> 对象更新：旧 key 在新对象里消失则清空，而不是保留')
{
  // modules/style.ts#L18-L34：遍历 prev 的每个 key，如果 next[key] == null 就 setStyle(style, key, '')
  mount(h('div', { style: { color: 'red', fontSize: '14px' } }))
  step('初始：{ color: "red", fontSize: "14px" }')
  const el = container.firstElementChild as HTMLElement
  render(h('div', { style: { color: 'blue' } }), container)
  step('更新为：{ color: "blue" }（fontSize 被删掉）')
  log('el.style.cssText =', el.style.cssText)
  log('el.style.fontSize =', JSON.stringify(el.style.fontSize))
  expectEq('fontSize 被清空', el.style.fontSize, '')
}

section('3. 字符串形式 style：整体走 style.cssText 快速路径')
{
  // modules/style.ts#L55-L65：isCssString 时直接 style.cssText = next
  const el = mount(h('div', { style: 'color: green; font-weight: bold;' }))
  step('style = "color: green; font-weight: bold;"（字符串）')
  log('el.style.cssText =', el.style.cssText)
  log('el.style.color =', el.style.color)
}

section('4. 数组多值：同一个 CSS 属性给多个候选值（渐进增强）')
{
  // modules/style.ts#L91-L93：isArray(val) 时递归对每个值调用 setStyle，
  // 浏览器会跳过不支持的值，最终生效的是最后一个被接受的值
  const el = mount(h('div', { style: { display: ['-webkit-box', 'flex'] } }))
  step('style = { display: ["-webkit-box", "flex"] }')
  log('el.style.display =', el.style.display)
  log('happy-dom 的 CSSOM 简化实现可能只接受标准值，这里重点是看 setStyle 确实被调用了两次（见 README 的源码片段）')
}

section('5. !important')
{
  // modules/style.ts#L104-L119：importantRE 命中后用 style.setProperty(name, value, "important")
  const el = mount(h('div', { style: { color: 'red !important' } }))
  step('style = { color: "red !important" }')
  log('el.style.cssText =', el.style.cssText)
  log('el.style.getPropertyPriority("color") =', el.style.getPropertyPriority('color'))
  expectEq('优先级被设置为 important', el.style.getPropertyPriority('color'), 'important')
}

section('6. CSS 自定义属性（变量）：走 setProperty 而不是普通属性赋值')
{
  // modules/style.ts#L102-L109：name.startsWith('--') 时用 style.setProperty，
  // 因为 style['--x'] = val 这种写法在标准 CSSOM 里根本不生效
  const el = mount(h('div', { style: { '--main-color': '#42b883', color: 'var(--main-color)' } }))
  step('style = { "--main-color": "#42b883", color: "var(--main-color)" }')
  log('el.style.getPropertyValue("--main-color") =', el.style.getPropertyValue('--main-color'))
  log('el.style.cssText =', el.style.cssText)
}

// withDirectives 只能在「组件 render 函数执行期间」调用（它要把 binding 挂到
// currentRenderingInstance 对应的 vnode 上），所以 v-show 的例子必须包一层组件，
// 不能像前面那样直接在普通函数里调用 h() + withDirectives。
section('7. v-show：隐藏时记录原始 display，显示时恢复')
{
  // directives/vShow.ts + modules/style.ts#L70-L80：
  //   - vShow.beforeMount 把 el[vShowOriginalDisplay] 记成当前 style.display（排除 'none'）
  //   - 之后每次 patchStyle 运行，只要元素身上有 vShowOriginalDisplay 这个标记，
  //     就会把 "这次 style 更新算出来的 display" 同步进 vShowOriginalDisplay，
  //     这样 v-show 重新显示时恢复的是"用户最新声明的 display"而不是挂载时的旧值
  const visible = ref(true)
  const Comp = defineComponent({
    render() {
      return withDirectives(h('div', { style: { color: 'red' } }, 'hello'), [
        [vShow, visible.value],
      ])
    },
  })
  render(null, container)
  render(h(Comp), container)
  const el = container.firstElementChild as HTMLElement
  step('mount: v-show=true，style.display 不受影响')
  log('el.style.display =', JSON.stringify(el.style.display))

  visible.value = false
  await nextTick()
  step('v-show 切换为 false')
  log('el.style.display =', el.style.display)
  expectEq('display 被设成 none', el.style.display, 'none')

  visible.value = true
  await nextTick()
  step('v-show 切换回 true')
  log('el.style.display =', JSON.stringify(el.style.display))
  expectEq('display 恢复成空字符串（即跟随 color:red 这条规则，不含 display）', el.style.display, '')
}

section('8. v-show + 显式 display：隐藏再显示后恢复到用户设置的 display 而不是空串')
{
  const visible = ref(true)
  const Comp = defineComponent({
    render() {
      return withDirectives(
        h('div', { style: { display: 'flex', color: 'red' } }, 'hello'),
        [[vShow, visible.value]],
      )
    },
  })
  render(null, container)
  render(h(Comp), container)
  const el = container.firstElementChild as HTMLElement
  step('mount: v-show=true, style.display="flex"')
  log('el.style.display =', el.style.display)

  visible.value = false
  await nextTick()
  step('v-show=false：style.display 被强制改成 none（但 vShowOriginalDisplay 记住了 "flex"）')
  log('el.style.display =', el.style.display)

  visible.value = true
  await nextTick()
  step('v-show=true：恢复成 "flex"，而不是丢失用户原本的设置')
  log('el.style.display =', el.style.display)
  expectEq('恢复为 flex', el.style.display, 'flex')
}
