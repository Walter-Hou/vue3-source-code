/**
 * 运行：pnpm ex chapters/11-compiler-core/examples/06-custom-directive-transform.ts
 * 演示：compile() 的 nodeTransforms / directiveTransforms 都是开放的扩展点——
 *       1) 自定义 directiveTransforms.highlight，把 `v-highlight="color"` 编译成
 *          `style: { color: ... }`（和内置的 v-bind/v-on/v-model 是同一套机制）。
 *       2) 自定义 nodeTransform，自动给所有 <img> 标签注入 `loading="lazy"` 属性
 *          （没有任何指令触发，纯粹是"看到 img 标签就加属性"）。
 * 看点：
 *  1. DirectiveTransform 的签名是 (dir, node, context) => { props: Property[] }，
 *     和内置的 transformOn/transformBind/transformModel 完全一样，返回的 props
 *     会被塞进 buildProps() 的 properties 数组参与 patchFlag 分析
 *     （transformElement.ts#L507-726 的那个大循环）。
 *  2. nodeTransform 在"进入"阶段直接 push 一个 AttributeNode 到 node.props，
 *     只要发生在 transformElement 的"退出"阶段之前（也就是子节点遍历、exit 倒序执行
 *     之前）都来得及被 buildProps 读到——这正是两阶段 enter/exit 设计带来的好处。
 *  3. compiler-dom 的 compile() 会把 options.nodeTransforms / directiveTransforms
 *     拼接在内置列表**后面**（index.ts#L46-56），用户扩展不会覆盖内置行为，只会追加。
 */
import { compile } from '@vue/compiler-dom'
import {
  type DirectiveTransform,
  type NodeTransform,
  NodeTypes,
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
} from '@vue/compiler-core'
import { section, step, log } from '../../../shared/print'

section('1. 自定义 directiveTransforms：v-highlight="color" -> style: { color }')
const transformHighlight: DirectiveTransform = (dir, _node, _context) => {
  const color = dir.exp ?? createSimpleExpression('"red"', false)
  return {
    props: [
      createObjectProperty(
        'style',
        createObjectExpression([createObjectProperty('color', color)]),
      ),
    ],
  }
}

step("模板：<p v-highlight=\"'orange'\">hi</p>")
log(
  compile(`<p v-highlight="'orange'">hi</p>`, {
    directiveTransforms: { highlight: transformHighlight },
  }).code,
)

section('2. 自定义 nodeTransform：给所有 <img> 自动加 loading="lazy"')
const transformLazyImg: NodeTransform = node => {
  if (node.type === NodeTypes.ELEMENT && node.tag === 'img') {
    const hasLoading = node.props.some(
      p => p.type === NodeTypes.ATTRIBUTE && p.name === 'loading',
    )
    if (!hasLoading) {
      node.props.push({
        type: NodeTypes.ATTRIBUTE,
        name: 'loading',
        nameLoc: node.loc,
        value: { type: NodeTypes.TEXT, content: 'lazy', loc: node.loc },
        loc: node.loc,
      })
    }
  }
}

step('模板：<div><img src="a.png"/><img src="b.png" loading="eager"/></div>')
log(
  compile(`<div><img src="a.png"/><img src="b.png" loading="eager"/></div>`, {
    nodeTransforms: [transformLazyImg],
  }).code,
)
step('第二个 img 已经手写了 loading="eager"，我们的 transform 检测到就不会重复添加/覆盖')
