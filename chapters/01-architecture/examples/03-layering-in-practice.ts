/**
 * 运行：pnpm ex chapters/01-architecture/examples/03-layering-in-practice.ts
 * 演示：用三个小实验，把第一个示例画出来的"依赖层级"落到实际行为上——
 *       响应式系统不知道渲染，运行时核心不知道 DOM，编译器核心不知道 HTML。
 * 看点：
 *   1. @vue/reactivity 可以完全脱离 @vue/runtime-core 单独使用，构建一个
 *      "响应式计算器"，证明它对"组件""渲染"一无所知。
 *   2. @vue/runtime-core 的 createRenderer() 需要调用方传入一整套 RendererOptions
 *      （createElement/insert/patchProp/...）——这就是它"不知道 DOM 具体怎么操作"
 *      的证据，真正知道怎么操作 DOM 的是 @vue/runtime-dom（第 14 章）。
 *   3. @vue/compiler-core 自带的 directiveTransforms 其实包含一个通用的 v-model
 *      实现（把 modelValue/onUpdate:modelValue 当 props 生成），而且不管目标是
 *      原生元素还是组件，生成的 props 都一样——它不知道 <input> 需要特殊对待；
 *      v-show 则完全没有通用实现，在 baseCompile 里会被直接丢弃。
 *      @vue/compiler-dom 叠加了一层 DOM 专属 transform：对原生 <input>/<textarea>/
 *      <select> 去掉 modelValue prop，换成真正的 vModelText 等指令调用，并补上 vShow。
 */
import { reactive, effect } from '@vue/reactivity'
import { createRenderer, h } from '@vue/runtime-core'
import { baseCompile } from '@vue/compiler-core'
import { compile as compileDom } from '@vue/compiler-dom'
import { section, step, log } from '../../../shared/print'

section('1. @vue/reactivity 单独使用：一个不涉及任何渲染概念的"响应式计算器"')
{
  const state = reactive({ price: 10, qty: 3 })
  let total = 0
  let runs = 0
  effect(() => {
    total = state.price * state.qty
    runs++
  })
  step('初始计算')
  log('total =', total, '(10 * 3)')
  state.qty = 5
  step('改 qty 之后，effect 自动重跑')
  log('total =', total, '(10 * 5)，effect 运行次数 =', runs)
  log('全程没有出现 VNode、组件、DOM 的任何概念——这就是 reactivity 包独立存在的意义。')
}

section('2. @vue/runtime-core 离不开"平台"：createRenderer 必须传入一整套操作接口')
{
  step('不传 RendererOptions 直接用 createRenderer 会怎样？')
  // createRenderer<HostNode, HostElement>(options) 的 options 参数是必需的，
  // TS 层面就不允许空调用；这里构造一套"什么都不做，只打印自己被调用了"的最小实现，
  // 证明 runtime-core 的 patch/diff 算法本身完全不关心"插入"到底是不是真的操作了 DOM。
  const calls: string[] = []
  const { render } = createRenderer({
    createElement: (tag: string) => {
      calls.push(`createElement(${tag})`)
      return { tag, children: [] as any[] }
    },
    createText: (text: string) => {
      calls.push(`createText(${text})`)
      return { text }
    },
    setText: () => {},
    setElementText: (el: any, text: string) => {
      calls.push(`setElementText(${text})`)
      el.children = [text]
    },
    insert: (child: any, parent: any) => {
      calls.push(`insert`)
      parent.children.push(child)
    },
    remove: () => {},
    patchProp: (el: any, key: string, _prev: any, next: any) => {
      calls.push(`patchProp(${key}=${next})`)
    },
    parentNode: () => null,
    nextSibling: () => null,
    createComment: (text: string) => ({ text }),
  } as any)

  const root: any = { tag: 'root', children: [] }
  render(h('div', { id: 'x' }, 'hello'), root)
  step('用一套"玩具级" RendererOptions 跑一次 render()')
  log('收到的宿主操作调用顺序 =', calls)
  log(
    '这套 options 里完全没有出现 document/HTMLElement/addEventListener 等任何',
    '浏览器 API —— runtime-core 的 diff 算法只认 RendererOptions 这组接口，',
    '真正知道"怎么操作真实 DOM"的是 @vue/runtime-dom（第 14 章）传进来的另一套实现',
    '（本仓库 shared/logging-renderer.ts 也是同样的思路，只是把调用记得更详细）。',
  )
}

section('3. @vue/compiler-core 不知道"HTML 标签"，@vue/compiler-dom 补上这一层')
{
  const template = '<input v-model="text" v-show="visible" />'

  step('用 @vue/compiler-core 的 baseCompile 直接编译（不经过 compiler-dom）')
  const { code } = baseCompile(template, { mode: 'function' })
  log(code)

  step('用 @vue/compiler-dom 的 compile 编译同一段模板')
  const { code: domCode } = compileDom(template, { mode: 'function' })
  log(domCode)

  log(
    '\n真实结果比"直接报错或忽略"更微妙：',
    '1) v-model 在 baseCompile 里其实编译成功了——生成了 modelValue / onUpdate:modelValue',
    '   两个 props。注意 <input> 在这里仍然是元素（产物是 createElementBlock("input")，',
    '   不是 resolveComponent），只是 compiler-core 自带的通用 v-model transform 不区分',
    '   元素和组件，一律套用"modelValue prop + update:modelValue 事件"这套组件协议。',
    '   （isNativeTag 只决定"是不是组件"：不传或返回 true 都按元素处理，返回 false',
    '   才会把 <input> 当成名叫 input 的组件去 resolveComponent，props 部分不变。）',
    '2) v-show 在 baseCompile 里完全没有生效，也没有报错——它被静默丢弃了，因为',
    '   compiler-core 根本不认识这个指令名，而"未知指令"在源码里就是直接跳过。',
    '3) compiler-dom 的产物完全不同：它自己的 v-model transform 先调用 compiler-core',
    '   的通用版本，再发现目标是原生 <input> 元素，于是用 DOM 专属的 vModelText 指令',
    '   （能处理 lazy/trim/number 修饰符、composition',
    '   事件）替换掉通用的 prop 写法，v-show 也补上了 vShow 指令——这两个都写在',
    '   compiler-dom/src/transforms/{vModel,vShow}.ts 里，compiler-core 本身',
    '   不内置任何"浏览器专属"的指令语义。',
  )
}
