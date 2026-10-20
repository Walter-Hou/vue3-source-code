/**
 * 运行：pnpm ex chapters/14-runtime-dom/examples/05-directive-hooks-order.ts
 * 演示：自定义指令 created/beforeMount/mounted/beforeUpdate/updated/beforeUnmount/unmounted
 *      的完整调用顺序、binding 的内容（value/oldValue/arg/modifiers/instance）；
 *      函数式指令会被展开成 { mounted, updated }；withDirectives 产物 vnode.dirs 的结构。
 * 看点：顺序严格对应 renderer.ts 里调用 invokeDirectiveHook 的位置
 *      （created 在 patchProp 之前、mounted 在插入 DOM 之后的 postFlush、
 *       beforeUpdate 在 diff children 之前、updated 也在 postFlush）。
 */
import { setupDOM } from '../../../shared/dom'
import { section, step, log } from '../../../shared/print'

setupDOM('<div id="app"></div>')
const { h, render, ref, nextTick, defineComponent, withDirectives } = await import('vue')

const container = document.getElementById('app')!

section('1. 完整生命周期顺序：created -> beforeMount -> mounted -> beforeUpdate -> updated -> beforeUnmount -> unmounted')
{
  const log1: string[] = []
  const myDirective = {
    created(el: any, binding: any) {
      log1.push(`created(value=${binding.value})`)
    },
    beforeMount(el: any) {
      log1.push(`beforeMount(el.isConnected=${el.isConnected})`)
    },
    mounted(el: any) {
      log1.push(`mounted(el.isConnected=${el.isConnected})`)
    },
    beforeUpdate(el: any, binding: any) {
      log1.push(`beforeUpdate(value=${binding.value}, oldValue=${binding.oldValue})`)
    },
    updated(el: any, binding: any) {
      log1.push(`updated(value=${binding.value}, oldValue=${binding.oldValue})`)
    },
    beforeUnmount(el: any) {
      log1.push('beforeUnmount')
    },
    unmounted(el: any) {
      log1.push('unmounted')
    },
  }

  const n = ref(1)
  const show = ref(true)
  const Comp = defineComponent({
    render() {
      return show.value
        ? withDirectives(h('div', `n=${n.value}`), [[myDirective, n.value]])
        : null
    },
  })

  step('mount')
  render(h(Comp), container)
  await nextTick()
  step('更新 n: 1 -> 2')
  n.value = 2
  await nextTick()
  step('卸载（show = false）')
  show.value = false
  await nextTick()

  log('完整调用顺序：')
  log1.forEach((l, i) => log(`  ${i + 1}. ${l}`))
}

render(null, container)

section('2. binding 的完整内容：value/oldValue/arg/modifiers/dir/instance')
{
  // directives.ts#L28-L39：DirectiveBinding 的字段
  let captured: any = null
  const probe = {
    mounted(el: any, binding: any) {
      captured = binding
    },
  }
  const Comp = defineComponent({
    name: 'ProbeOwner',
    render() {
      return withDirectives(h('div', 'x'), [
        [probe, { foo: 1 }, 'myArg', { modA: true, modB: true }],
      ])
    },
  })
  render(h(Comp), container)
  step('withDirectives(vnode, [[probe, { foo: 1 }, "myArg", { modA: true, modB: true }]])')
  log('binding.value =', captured.value)
  log('binding.arg =', captured.arg)
  log('binding.modifiers =', captured.modifiers)
  log('binding.oldValue =', captured.oldValue)
  log('binding.instance?.$options.name =', captured.instance?.$options?.name)
  log('binding.dir === probe ?', captured.dir === probe)
}

render(null, container)

section('3. 函数式指令：被 withDirectives 内部展开成 { mounted: fn, updated: fn }')
{
  // directives.ts#L148-L153：isFunction(dir) 时 dir = { mounted: dir, updated: dir }
  const calls: string[] = []
  function fnDirective(el: any, binding: any) {
    calls.push(`call(value=${binding.value})`)
  }
  const n = ref(1)
  const Comp = defineComponent({
    render() {
      return withDirectives(h('div', 'x'), [[fnDirective, n.value]])
    },
  })
  render(h(Comp), container)
  step('mount：函数式指令等价于 mounted 钩子被调用一次')
  n.value = 2
  await nextTick()
  step('更新：函数式指令等价于 updated 钩子又被调用一次')
  log('calls =', calls)
}

render(null, container)

section('4. withDirectives 产物：vnode.dirs 的结构')
{
  const dirA = { mounted() {} }
  const dirB = { mounted() {} }
  let vnode: any
  const Comp = defineComponent({
    render() {
      vnode = withDirectives(h('div', 'x'), [
        [dirA, 'valueA', 'argA', { mod1: true }],
        [dirB, 'valueB'],
      ])
      return vnode
    },
  })
  render(h(Comp), container)
  step('withDirectives 把 [dir, value, arg, modifiers] 规范化成 vnode.dirs: DirectiveBinding[]')
  log('vnode.dirs.length =', vnode.dirs.length)
  vnode.dirs.forEach((b: any, i: number) => {
    log(`dirs[${i}] = { value: ${JSON.stringify(b.value)}, arg: ${JSON.stringify(b.arg)}, modifiers: ${JSON.stringify(b.modifiers)}, dir === dir${i === 0 ? 'A' : 'B'}: ${b.dir === (i === 0 ? dirA : dirB)} }`)
  })
}
