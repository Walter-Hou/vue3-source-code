/**
 * 运行：pnpm ex chapters/09-props-emits-slots/examples/06-provide-inject-chain.ts
 * 演示：打印 provides 的原型链（Object.getPrototypeOf 一层层往上），app.provide 和
 *       组件内 provide() 的关系，runWithContext 的作用，default 工厂函数的求值时机。
 * 看点：
 *   1. 默认情况下子组件的 instance.provides 和父组件是同一个引用（原型链"共享"而不是"复制"），
 *      只有组件自己第一次调用 provide() 时才会 Object.create(parentProvides) 分裂出自己的一层。
 *   2. inject() 的查找完全依赖原型链：`key in provides` 会自动沿着原型链往上找，
 *      不需要 Vue 自己写一个"沿 parent 指针逐层查找"的循环。
 *   3. app.provide() 写入的是 appContext.provides，是整条原型链的最顶端（根组件的原型）。
 */
import { defineComponent, getCurrentInstance, h, inject, provide } from '@vue/runtime-core'
import { createApp, createRoot } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

section('1. 不调用 provide() 时，子孙组件的 provides 都是同一个引用')

const instances: Record<string, any> = {}
function record(name: string) {
  instances[name] = getCurrentInstance()
}

const Grandchild = defineComponent({
  name: 'Grandchild',
  setup() {
    record('grandchild')
    return () => h('span', 'grandchild')
  },
})
const ChildNoProvide = defineComponent({
  name: 'ChildNoProvide',
  setup() {
    record('child')
    return () => h(Grandchild)
  },
})
const RootNoProvide = defineComponent({
  name: 'RootNoProvide',
  setup() {
    record('root')
    return () => h(ChildNoProvide)
  },
})

const app1 = createApp(RootNoProvide)
app1.provide('appLevel', 'from-app')
app1.mount(createRoot())

step('三层实例的 provides 是否是同一个引用')
log('root.provides === child.provides ?', instances.root.provides === instances.child.provides)
log('child.provides === grandchild.provides ?', instances.child.provides === instances.grandchild.provides)
log('root.provides 的原型就是 appContext.provides ?', Object.getPrototypeOf(instances.root.provides) === app1._context.provides)

section('2. 一旦某一层调用了 provide()，就会分裂出自己的一层（Object.create(parentProvides)）')

const instances2: Record<string, any> = {}
const Grandchild2 = defineComponent({
  name: 'Grandchild2',
  setup() {
    instances2.grandchild = getCurrentInstance()
    const theme = inject('theme')
    const level = inject('level', 'no-level')
    return () => h('span', `theme=${theme} level=${level}`)
  },
})
const Child2 = defineComponent({
  name: 'Child2',
  setup() {
    instances2.child = getCurrentInstance()
    provide('level', 'child-level') // Child2 自己 provide 一次，provides 会分裂
    return () => h(Grandchild2)
  },
})
const Root2 = defineComponent({
  name: 'Root2',
  setup() {
    instances2.root = getCurrentInstance()
    provide('theme', 'dark')
    return () => h(Child2)
  },
})
const app2 = createApp(Root2)
app2.mount(createRoot())

step('打印 provides 原型链：从 grandchild 往上，每一层 Object.getPrototypeOf 分别是谁')
{
  let cur = instances2.grandchild.provides
  let depth = 0
  const chain: string[] = []
  while (cur) {
    const ownKeys = Object.keys(cur)
    chain.push(`depth${depth}: own keys = [${ownKeys.join(', ')}]`)
    const proto = Object.getPrototypeOf(cur)
    if (proto === Object.prototype || proto === null) break
    cur = proto
    depth++
    if (depth > 10) break // 安全保护
  }
  log(chain.join('\n'))
}
log(
  'grandchild.provides === child.provides ?',
  instances2.grandchild.provides === instances2.child.provides,
  '(Grandchild2 自己没有调用 provide，继续共享 Child2 的 provides)',
)
log('child.provides === root.provides ?', instances2.child.provides === instances2.root.provides, '(Child2 调用过 provide，分裂出自己的一层)')

section('3. inject() 沿原型链查找，所以 Grandchild2 能同时拿到 theme（来自 Root2）和 level（来自 Child2）')

step('(已在上面的渲染结果里验证，这里直接读取 DOM 快照)')
const root2DomCheck = createRoot()
const app2b = createApp(Root2)
app2b.mount(root2DomCheck)
log('说明：theme 在 Root2.provides 这一层（grandchild 原型链最顶端那一层），level 在 Child2.provides 这一层，两者都能被 inject 到')

section('4. default 工厂函数：treatDefaultAsFactory')

let factoryCalls = 0
let injectedValue: unknown
const NoProviderChild = defineComponent({
  name: 'NoProviderChild',
  setup() {
    injectedValue = inject(
      'notProvided',
      () => {
        factoryCalls++
        return `computed-default-${factoryCalls}`
      },
      true /* treatDefaultAsFactory */,
    )
    return () => h('span', injectedValue as string)
  },
})
const RootNoProvider = defineComponent({
  name: 'RootNoProvider',
  render: () => h(NoProviderChild),
})
createApp(RootNoProvider).mount(createRoot())
step('inject("notProvided", factory, true)：没有任何地方 provide 过这个 key，default 工厂函数被调用')
log('injectedValue =', injectedValue, ', factoryCalls =', factoryCalls, '(只调用一次)')

section('5. app.runWithContext：在没有组件实例的地方也能 inject 到 app 级 provide')

const app3 = createApp(defineComponent({ render: () => h('div') }))
app3.provide('globalKey', 'global-value')
app3.mount(createRoot())

step('在组件渲染上下文之外调用 inject，不借助 runWithContext 会发生什么')
log('直接 inject("globalKey")（没有 currentInstance，也没有 currentApp） =', inject('globalKey'))

step('借助 app.runWithContext 包裹后再调用')
const viaContext = app3.runWithContext(() => inject('globalKey'))
log('runWithContext 内部 inject("globalKey") =', viaContext)
