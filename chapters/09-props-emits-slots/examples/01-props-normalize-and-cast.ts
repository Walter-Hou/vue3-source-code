/**
 * 运行：pnpm ex chapters/09-props-emits-slots/examples/01-props-normalize-and-cast.ts
 * 演示：数组写法 vs 对象写法声明 props 时 instance.propsOptions 的样子；
 *       Boolean casting 的各种情况；default 工厂函数；kebab-case -> camelCase 转换。
 * 看点：
 *   1. normalizePropsOptions 把数组/对象两种写法统一成 [normalized, needCastKeys] 二元组，
 *      needCastKeys 只包含"需要 Boolean 转换或者有 default"的 key，减少运行时判断成本。
 *   2. Boolean prop 的转换规则：缺省 -> false；传空字符串或等于连字符形式的属性名 -> true。
 *   3. default 工厂函数每个组件实例只调用一次并缓存在 instance.propsDefaults 里，
 *      不会每次渲染都重新执行。
 */
import { defineComponent, getCurrentInstance, h } from '@vue/runtime-core'
import { createApp, createRoot } from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

section('1. 数组写法 vs 对象写法：instance.propsOptions')

let arrInstance: any
const ArrProps = defineComponent({
  name: 'ArrProps',
  props: ['title', 'count'], // 数组写法：全部是"没有任何校验规则"的声明
  setup() {
    arrInstance = getCurrentInstance()
    return () => h('div', 'arr')
  },
})
createApp(ArrProps).mount(createRoot())
step('数组写法 props: ["title", "count"] 规范化后的 propsOptions')
log(arrInstance.propsOptions)
log('(第一个元素是 normalized 对象，每个 key 的值是 EMPTY_OBJ；第二个元素 needCastKeys 为空数组，因为没有 Boolean/default)')

let objInstance: any
const ObjProps = defineComponent({
  name: 'ObjProps',
  props: {
    title: { type: String, required: true },
    disabled: Boolean, // 简写形式：直接写构造函数
    count: { type: Number, default: 0 },
    mode: { type: [String, Boolean] }, // 数组类型：Boolean 排第二位
  },
  setup() {
    objInstance = getCurrentInstance()
    return () => h('div', 'obj')
  },
})
createApp(ObjProps).mount(createRoot())
step('对象写法规范化后的 propsOptions（注意 shouldCast / shouldCastTrue 这两个 Symbol 键）')
log(objInstance.propsOptions[0])
log('needCastKeys =', objInstance.propsOptions[1], '(disabled 因为是 Boolean 需要转换，count 因为有 default，都进了这个列表)')

section('2. Boolean casting 的几种情况')

let boolInstance: any
const BoolComp = defineComponent({
  name: 'BoolComp',
  props: {
    simple: Boolean, // 纯 Boolean
    mixed: { type: [String, Boolean] }, // String 在前会影响 shouldCastTrue（这里是 Boolean 在前，便于对比见下个例子）
  },
  setup() {
    boolInstance = getCurrentInstance()
    return () => h('div', 'bool')
  },
})
// 用 createElementVNode 手写一个"编译产物风格"的根组件，模拟 <BoolComp simple mixed="mixed" /> 的多种写法
function mountBoolCase(label: string, rawProps: Record<string, any>) {
  const Root = defineComponent({
    name: 'Root_' + label,
    render: () => h(BoolComp, rawProps),
  })
  createApp(Root).mount(createRoot())
  step(`${label}: rawProps = ${JSON.stringify(rawProps)}`)
  log('casting 结果 -> simple =', boolInstance.props.simple, ', mixed =', boolInstance.props.mixed)
}

mountBoolCase('未传任何值', {})
mountBoolCase('simple 传空字符串（<BoolComp simple />编译产物等价形式）', { simple: '' })
mountBoolCase('simple 传与属性名相同的字符串（<BoolComp simple="simple" />）', { simple: 'simple' })
mountBoolCase('simple 传 false', { simple: false })
mountBoolCase('simple 传任意非空字符串（不等于属性名）', { simple: 'yes' })

section('3. [String, Boolean] 的顺序如何影响 shouldCastTrue')

let orderInstance: any
const BoolFirst = defineComponent({
  name: 'BoolFirst',
  props: { v: { type: [Boolean, String] } }, // Boolean 排第一
  setup() {
    orderInstance = getCurrentInstance()
    return () => h('div')
  },
})
const StringFirst = defineComponent({
  name: 'StringFirst',
  props: { v: { type: [String, Boolean] } }, // String 排第一
  setup() {
    orderInstance = getCurrentInstance()
    return () => h('div')
  },
})
function mountOrderCase(Comp: any, label: string) {
  const Root = defineComponent({ name: 'OrderRoot', render: () => h(Comp, { v: '' }) })
  createApp(Root).mount(createRoot())
  step(`${label}：<Comp v="" />`)
  log('casting 结果 v =', orderInstance.props.v)
}
mountOrderCase(BoolFirst, '[Boolean, String]')
mountOrderCase(StringFirst, '[String, Boolean]')
log(
  '结论：[Boolean, String] 时空字符串被转成 true（标准 Boolean 行为）；',
  '[String, Boolean] 时 shouldCastTrue=false，空字符串保持原样（当作字符串处理），',
  '这是为了让 <input value="" /> 这种"值恰好是空字符串"的场景不会被误转换成 true。',
)

section('4. default 工厂函数：只调用一次并缓存')

let factoryCallCount = 0
let defInstance: any
const DefComp = defineComponent({
  name: 'DefComp',
  props: {
    list: {
      type: Array,
      default: () => {
        factoryCallCount++
        return ['a', 'b']
      },
    },
  },
  setup() {
    defInstance = getCurrentInstance()
    return () => h('div', String(factoryCallCount))
  },
})
const DefRoot = defineComponent({
  name: 'DefRoot',
  render: () => h(DefComp), // 不传 list，走 default 工厂
})
const defApp = createApp(DefRoot)
const defRoot = createRoot()
defApp.mount(defRoot)
step('首次挂载，default 工厂被调用')
log('factoryCallCount =', factoryCallCount, ', propsDefaults.list =', defInstance.propsDefaults.list)

step('强制重新渲染子组件（instance.update()），default 工厂不会被重复调用')
defInstance.update()
await Promise.resolve()
log('factoryCallCount =', factoryCallCount, '(应该还是 1，因为 resolvePropValue 命中了 propsDefaults 缓存)')

section('5. kebab-case -> camelCase')

let kebabInstance: any
const KebabComp = defineComponent({
  name: 'KebabComp',
  props: { userName: String },
  setup() {
    kebabInstance = getCurrentInstance()
    return () => h('div', 'kebab')
  },
})
// 用 h() 手写时也可以直接传 kebab-case 的 key（等价于模板里的 user-name="xxx"）
const KebabRoot = defineComponent({
  name: 'KebabRoot',
  render: () => h(KebabComp, { 'user-name': 'Tom' } as any),
})
createApp(KebabRoot).mount(createRoot())
step('h(KebabComp, { "user-name": "Tom" })')
log('instance.props.userName =', kebabInstance.props.userName, '(camelize 把 kebab-case 转成了 camelCase)')
