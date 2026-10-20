/**
 * 运行：pnpm ex chapters/06-component/examples/02-proxy-lookup-order.ts
 * 演示：PublicInstanceProxyHandlers.get 的查找顺序（setupState -> data -> props -> ctx -> $xxx），
 *       accessCache 的命中效果，以及对 props 赋值触发的只读警告。
 * 看点：
 *   1. 同名字段在 setupState/data/props 里谁赢——源码按固定优先级查找，setupState 最高。
 *   2. accessCache 是一个"查过一次就记住查找路径"的缓存：同一个 key 第二次访问时直接走
 *      缓存分支，不用重新做四五次 hasOwn 判断。
 *   3. this.someProp = xxx（props 只读）、this.$xxx = xxx（$ 开头保留字段）都会被 set 陷阱拦截，
 *      在开发模式下打印警告但不会真的修改。
 */
import { defineComponent, h } from '@vue/runtime-core'
import { createApp, createRoot } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

section('1. setupState / data / props 同名时的优先级')

let proxyRef: any
let instanceRef: any

const Comp = defineComponent({
  name: 'Comp',
  props: { shared: { type: String, default: 'from-props' } },
  data() {
    // data() 里也声明一个 shared 字段 —— 和 props 同名在 Options API 里是不被允许的
    // （开发期会有 duplicate key 警告），这里改用一个不冲突的 data-only 字段 + 一个单独的
    // "只在 data 层定义" 的字段来做对比，避免警告干扰主线演示
    return { dataOnly: 'from-data' }
  },
  methods: {
    methodOnly() {
      return 'from-method'
    },
  },
  setup(props) {
    return {
      setupOnly: 'from-setup',
      // 刻意用一个和 props 同名的 key，观察 setupState 是否会"遮蔽" props
      shared: 'from-setup-shadow',
    }
  },
  render() {
    proxyRef = this
    instanceRef = (this as any).$ // publicPropertiesMap.$ 直接返回 instance 本身
    return h('div', 'rendered')
  },
})

const app = createApp(Comp)
app.mount(createRoot())

step('setupState 和 props 同名（shared）时，谁赢？')
log('this.shared =', proxyRef.shared, '(源码 get 陷阱：先查 setupState，查到就直接返回，不会再看 props)')

step('只在某一层定义的字段：setupOnly / dataOnly / methodOnly / props.shared 对应的真实值')
log('this.setupOnly =', proxyRef.setupOnly)
log('this.dataOnly  =', proxyRef.dataOnly)
log('this.methodOnly() =', proxyRef.methodOnly())
log('instance.props.shared（绕开 setupState 直接看 props 原始值）=', instanceRef.props.shared)

section('2. $ 开头的公共属性：publicPropertiesMap')

step('this.$el / this.$props / this.$attrs / this.$parent / this.$options.name / this.$nextTick')
log('$el 的 tagName        =', proxyRef.$el?.tag)
log('$props                =', { ...proxyRef.$props })
log('$attrs                =', { ...proxyRef.$attrs })
log('$parent               =', proxyRef.$parent)
log('$options.name         =', proxyRef.$options.name)
log('typeof $nextTick      =', typeof proxyRef.$nextTick)
log('typeof $forceUpdate   =', typeof proxyRef.$forceUpdate)

section('3. accessCache：查过一次的 key 会被记住查找路径')

step('第一次访问 setupOnly 之前 accessCache 里还没有这个 key')
log('accessCache 初始内容  =', { ...instanceRef.accessCache })
// 触发一次访问（上面已经访问过 proxyRef.setupOnly 了，这里再访问一次确认缓存存在）
void proxyRef.setupOnly
log('访问过 setupOnly 之后 accessCache.setupOnly =', instanceRef.accessCache.setupOnly, '(1 = AccessTypes.SETUP，源码里的 enum 顺序 OTHER=0, SETUP=1, DATA=2, PROPS=3, CONTEXT=4)')
void proxyRef.dataOnly
log('访问过 dataOnly 之后 accessCache.dataOnly   =', instanceRef.accessCache.dataOnly, '(2 = AccessTypes.DATA)')
void proxyRef.$props // $ 开头的 key 不会进 accessCache（get 陷阱里 key[0] !== '$' 才会查缓存）
log('$props 有没有进 accessCache                 =', 'props' in instanceRef.accessCache === false)

section('4. 对 props 赋值 / 修改 $ 属性 会被 set 陷阱拦截')

step('this.shared = "xxx"：props 虽然被 setupState 遮蔽读取，但 instance.props 仍然只读')
try {
  // 注意：由于 setupState 里也有同名 shared 字段，赋值实际命中的是 hasSetupBinding 分支
  // （setupState 可写），所以换一个"只存在于 props、不在 setupState"的 key 来验证只读警告
  ;(proxyRef as any).onlyInProps = 'try to mutate'
} catch (e) {
  log('赋值抛出异常:', (e as Error).message)
}
log('赋值后 instance.props.onlyInProps =', instanceRef.props.onlyInProps, '(undefined，因为它压根不是声明的 prop，走的是"写入 ctx" 分支)')

step('this.$data = "xxx"：$ 开头且是保留字段，set 陷阱返回 false 会警告 + 严格模式下 Proxy 再抛 TypeError')
try {
  ;(proxyRef as any).$data = 'try to mutate $data'
} catch (e) {
  log('捕获到异常（ESM 严格模式下 set 陷阱返回 false 会被 Proxy 规范转成 TypeError）:', (e as Error).message)
}
log('赋值后 instance.data 仍是原值 =', instanceRef.data, '(set 陷阱里 key[0]===$ && key.slice(1) in instance 时直接 return false，没有真的写入)')
