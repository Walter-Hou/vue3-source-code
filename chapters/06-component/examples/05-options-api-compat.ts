/**
 * 运行：pnpm ex chapters/06-component/examples/05-options-api-compat.ts
 * 演示：data/computed/watch/methods/provide/inject/mixins 全部走 applyOptions，
 *       this 如何访问到这些状态，以及 setup() 和 Options API 同时存在时谁优先。
 * 看点：
 *   1. mixins 里的 data() 会和组件自己的 data() 合并（mergeDataFn 递归合并对象）；
 *      methods/computed 等则是"组件自己的覆盖 mixin 的"（mergeObjectOptions 用 extend）。
 *   2. provide/inject 在 Options API 里也是走同一套 apiInject.ts 的 provide()/inject()，
 *      只是 applyOptions 帮你在 setCurrentInstance 期间调用了它们。
 *   3. setup() 返回的绑定会出现在 setupState 里，比 data() 的结果优先级更高
 *      （PublicInstanceProxyHandlers.get 查找顺序：setupState -> data -> props -> ctx）。
 */
import { defineComponent, h } from '@vue/runtime-core'
import { createApp, createRoot } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

section('1. mixins：data 合并、methods 覆盖')

const mixinA = {
  data() {
    return { fromMixin: 'mixinA-data', shared: 'mixinA-shared' }
  },
  methods: {
    sayMixin() {
      return 'mixinA-method'
    },
    sayShared() {
      return 'mixinA-sayShared'
    },
  },
  created(this: any) {
    recordTrace('mixinA.created')
  },
}

const trace1: string[] = []
function recordTrace(msg: string) {
  trace1.push(msg)
}

let proxy1: any
const CompWithMixin = defineComponent({
  name: 'CompWithMixin',
  mixins: [mixinA],
  data() {
    return { own: 'comp-data', shared: 'comp-shared' } // shared 覆盖 mixin 里的同名字段
  },
  methods: {
    sayShared() {
      return 'comp-sayShared' // 覆盖 mixin 的同名方法
    },
  },
  created() {
    recordTrace('comp.created')
  },
  render() {
    proxy1 = this
    return h('div', 'mixin-demo')
  },
})

createApp(CompWithMixin).mount(createRoot())

step('created 钩子的执行顺序：mixin 先于组件自身（resolveMergedOptions 把 mixins 放在前面合并）')
log(trace1.join(' -> '))

step('data 合并结果：fromMixin 来自 mixin，own 来自组件，shared 被组件覆盖')
log({ fromMixin: proxy1.fromMixin, own: proxy1.own, shared: proxy1.shared })

step('methods 合并结果：sayMixin 来自 mixin，sayShared 被组件覆盖')
log({ sayMixin: proxy1.sayMixin(), sayShared: proxy1.sayShared() })

section('2. computed / watch（Options API）')

let proxy2: any
const watchLog: string[] = []
const CompComputedWatch = defineComponent({
  name: 'CompComputedWatch',
  data() {
    return { count: 1 }
  },
  computed: {
    double(this: any) {
      return this.count * 2
    },
  },
  watch: {
    count(newVal: number, oldVal: number) {
      watchLog.push(`count: ${oldVal} -> ${newVal}`)
    },
  },
  render() {
    proxy2 = this
    return h('div', `double=${(this as any).double}`)
  },
})
createApp(CompComputedWatch).mount(createRoot())

step('computed.double 的初始值（count=1）')
log('this.double =', proxy2.double)

step('修改 this.count，computed 自动重新求值，watch 回调触发')
proxy2.count = 5
await Promise.resolve()
log('this.double =', proxy2.double, '(应为 10)')
log('watchLog =', watchLog)

section('3. provide / inject（Options API）')

const ProviderComp = defineComponent({
  name: 'ProviderComp',
  provide() {
    return { theme: 'dark', level: 1 }
  },
  render() {
    return h(ConsumerComp)
  },
})
let consumerProxy: any
const ConsumerComp = defineComponent({
  name: 'ConsumerComp',
  inject: { theme: {}, level: { from: 'level', default: 0 } },
  render() {
    consumerProxy = this
    return h('span', `theme=${(this as any).theme}`)
  },
})
createApp(ProviderComp).mount(createRoot())
step('ConsumerComp 读取到 Options API 的 provide() 结果')
log({ theme: consumerProxy.theme, level: consumerProxy.level })

section('4. setup() 与 Options API 同时存在：优先级')

let proxy3: any
const CompBoth = defineComponent({
  name: 'CompBoth',
  data() {
    return { value: 'from-data' }
  },
  setup() {
    return { value: 'from-setup' }
  },
  render() {
    proxy3 = this
    return h('div', (this as any).value)
  },
})
createApp(CompBoth).mount(createRoot())
step('data 和 setup() 返回值同名时，谁赢？')
log('this.value =', proxy3.value, '(setupState 优先级高于 data，见第 2 节 PublicInstanceProxyHandlers.get 查找顺序)')

step('this 在 Options API 钩子里访问的是同一个 proxy 吗？')
log(
  'proxy1 / proxy2 / proxy3 都是 ComponentPublicInstance（new Proxy(instance.ctx, PublicInstanceProxyHandlers)），',
  '不是组件实例本身——这是 Vue 3 和 Vue 2 的关键区别（Vue 2 的 vm 自己就是暴露给用户的对象）。',
)
