/**
 * 运行：pnpm ex chapters/06-component/examples/01-instance-anatomy.ts
 * 演示：用 getCurrentInstance() 在 setup() 内部和 onMounted() 里分别抓一次组件实例，
 *       对比关键字段在"实例刚创建"和"挂载完成后"两个时间点的变化。
 * 看点：
 *   1. setup() 执行时 instance.subTree / instance.effect / instance.isMounted 都还没准备好
 *      （因为 setupRenderEffect 在 setupComponent 之后才调用），但 instance.props/attrs/slots
 *      已经初始化完毕（initProps/initSlots 先于 setupStatefulComponent 执行）。
 *   2. instance.scope 是一个 EffectScope 实例，组件内所有的 watch/computed 都挂在这个 scope
 *      下，卸载时只需要 scope.stop() 一次就能批量清理，不用逐个找 watcher。
 *   3. instance.provides 在没有调用过 provide() 时和 appContext.provides 是同一个引用
 *      （Object.create 出来的原型关系），第一次调用 provide() 之后才会分裂成自己的对象。
 */
import { EffectScope } from '@vue/reactivity'
import { defineComponent, getCurrentInstance, h, onMounted, provide, ref } from '@vue/runtime-core'
import { createApp, createRoot, printOps } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

let instanceInSetup: any
let instanceInMounted: any

const Child = defineComponent({
  name: 'Child',
  props: { title: String },
  setup(props) {
    const instance = getCurrentInstance()!
    instanceInSetup = instance

    step('setup() 内部抓到的 instance（挂载前）')
    log('uid            =', instance.uid)
    log('type.name      =', instance.type.name)
    log('parent?.type.name =', instance.parent?.type.name)
    log('appContext === parent.appContext ?', instance.appContext === instance.parent!.appContext)
    log('vnode.shapeFlag =', instance.vnode.shapeFlag, '(STATEFUL_COMPONENT 位应该置位)')
    log('subTree        =', instance.subTree, '(还没 render，自然是 null)')
    log('effect         =', instance.effect, '(setupRenderEffect 还没执行，是 null)')
    log('isMounted      =', instance.isMounted)
    // scope/provides 是 @internal 字段，公开的 ComponentInternalInstance 类型里没有
    // 声明它们（被 api-extractor 裁掉），但运行时确实存在，这里用 any 绕过类型声明去访问。
    const instanceAny = instance as any
    log('scope instanceof EffectScope ?', instanceAny.scope instanceof EffectScope)
    log('props          =', { ...instance.props })
    log('attrs          =', { ...instance.attrs })
    log('provides === parent.provides ?', instanceAny.provides === instanceAny.parent.provides, '(还没调用过 provide()，共享父级对象)')

    provide('fromChild', 'child-value')
    log('调用 provide() 之后：provides === parent.provides ?', instanceAny.provides === instanceAny.parent.provides)

    const count = ref(props.title?.length ?? 0)

    onMounted(() => {
      instanceInMounted = getCurrentInstance()
      step('onMounted() 里再抓一次同一个 instance（挂载后）')
      log('instance 是不是同一个对象 ?', instanceInMounted === instanceInSetup)
      log('subTree.type   =', instanceInMounted.subTree.type, '(已经渲染出真正的子树)')
      log('effect 是否存在 =', !!instanceInMounted.effect)
      log('update 是否是函数 =', typeof instanceInMounted.update === 'function')
      log('job 是否是函数   =', typeof instanceInMounted.job === 'function')
      log('isMounted      =', instanceInMounted.isMounted)
    })

    return () => h('div', { class: 'child' }, `title=${props.title}, count=${count.value}`)
  },
})

const Root = defineComponent({
  name: 'Root',
  setup() {
    return () => h(Child, { title: 'hello' })
  },
})

section('1. 挂载前后对比同一个组件实例')
const app = createApp(Root)
const root = createRoot()
app.mount(root)
printOps('mount')

section('2. getCurrentInstance() 在 setup() 之外会返回什么')
step('组件渲染/生命周期之外调用 getCurrentInstance()')
log('结果 =', getCurrentInstance(), '(没有活跃实例，返回 null；源码：currentInstance || currentRenderingInstance)')
