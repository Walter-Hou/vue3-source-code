/**
 * 运行：pnpm ex chapters/05-vnode-createapp/examples/04-createApp-flow.ts
 * 演示：用 shared/logging-renderer.ts 的 createApp 走一遍完整流程 ——
 *       app 对象长什么样、use/component/directive/provide 注册到哪里、
 *       mount 之后根 vnode.component 是什么、printOps 看宿主操作、unmount 后的状态。
 * 看点：
 *   1. app._context 就是 createAppContext() 的产物，use/component/directive/provide
 *      全部是在"修改 context 上的某个字段"，app 对象本身只是一堆方法 + 对 context 的引用。
 *   2. mount() 内部做的事：createVNode(rootComponent) -> vnode.appContext = context ->
 *      render(vnode, container)。根 vnode 的 component 字段在 render 完成后才会被填充。
 *   3. unmount 调用 render(null, container) 把整棵树卸载，并把 app._container.__vue_app__ 删掉——
 *      这也是源码里"同一个容器不能重复 mount 两个 app"的检测依据。
 */
import { h, inject, ref } from '@vue/runtime-core'
import { createApp, createRoot, dumpOps, printOps, serialize } from '../../../shared/logging-renderer'
import { inspect, log, section, step } from '../../../shared/print'

section('1. createApp(rootComponent) 返回的 app 对象')

const CounterPlugin = {
  install(app: any, prefix: string) {
    app.config.globalProperties.$prefix = prefix
  },
}

const Child = {
  name: 'Child',
  setup() {
    return () => h('span', 'child')
  },
}

const RootComponent = {
  name: 'Root',
  setup() {
    const count = ref(0)
    return () => h('div', { id: 'root' }, [h('p', `count: ${count.value}`), h(Child)])
  },
}

const app = createApp(RootComponent)

step('app 对象的方法（use/mixin/component/directive/mount/unmount/provide/runWithContext/onUnmount）')
log(
  Object.keys(app).filter(k => typeof (app as any)[k] === 'function'),
)

step('app._uid / app._component / app._container（挂载前）/ app._instance（挂载前）')
log({ _uid: app._uid, _component: app._component === RootComponent, _container: app._container, _instance: app._instance })

section('2. use / component / directive / provide：本质是在改 app._context')

step('app.use(CounterPlugin, "ns:") —— install 被调用，globalProperties 被写入 context.config')
app.use(CounterPlugin, 'ns:')
log('app._context.config.globalProperties =', app._context.config.globalProperties)

step('app.component("Child", Child) —— 注册进 app._context.components')
app.component('Child', Child)
log('app._context.components 里是否有 Child:', 'Child' in app._context.components)

const MyDirective = { mounted() {} }
step('app.directive("my-dir", MyDirective) —— 注册进 app._context.directives')
app.directive('my-dir', MyDirective)
log('app._context.directives 里是否有 my-dir:', 'my-dir' in app._context.directives)

step('app.provide("theme", "dark") —— 写入 app._context.provides')
app.provide('theme', 'dark')
log('app._context.provides =', app._context.provides)

step('app.runWithContext(fn)：在 fn 执行期间把 currentApp 设为这个 app，使 inject() 能在组件外读到 app-level provide')
{
  // 从 runtime-core 里把 inject 单独拿出来验证：inject 内部会 fallback 到 currentApp._context.provides
  const result = app.runWithContext(() => {
    // 这里没有组件实例，但因为 currentApp 被设置了，inject 依然能工作
    return inject('theme')
  })
  log('runWithContext 内部 inject("theme") =', result)
}

section('3. mount：createVNode -> appContext 挂载 -> render -> 根实例产生')

const root = createRoot()
const instance = app.mount(root)

step('mount 返回值就是根组件的 public instance（getComponentPublicInstance 的产物）')
log('mount() 返回的 instance.$options.name =', (instance as any).$options.name)

step('app._instance 现在指向根组件实例，app._container 指向挂载容器')
log('app._instance === instance 的内部 instance? (两者都是同一个 proxy)', app._instance?.proxy === instance)
log('app._container === root ?', app._container === root)

step('容器上出现了 __vue_app__（devtools / 防重复 mount 检测用）')
log('(root as any).__vue_app__ === app ?', (root as any).__vue_app__ === app)

step('serialize(root)：挂载后的 DOM 快照')
log(serialize(root))

step('本次挂载触发的宿主操作（printOps 会清空 ops，方便下一步观察增量）')
printOps('mount')

section('4. unmount：render(null, container) 卸载整棵树')

app.unmount()

step('unmount 之后 __vue_app__ 被删除')
log('(root as any).__vue_app__ =', (root as any).__vue_app__)

step('unmount 触发的宿主操作：remove 掉所有节点')
printOps('unmount')

step('serialize(root)：卸载后容器变回空')
log(JSON.stringify(serialize(root)))

step('再次调用 unmount()：注意源码的 unmount() 成功卸载后并不会把 isMounted 重置回 false，')
log('所以第二次调用仍会进入 render(null, container) 分支，只是 container._vnode 已经是 null，renderer 什么也不做：')
app.unmount()
printOps('unmount again (应为 0 次操作)')
