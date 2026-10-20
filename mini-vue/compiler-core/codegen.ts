/**
 * 对应源码位置：packages/compiler-core/src/codegen.ts
 *
 * 精简说明：
 * - 只实现源码里 `useWithBlock` 为 true 的那一条路径（浏览器里直接 new Function 的场景），
 *   对应「不开 prefixIdentifiers」时的 `with (_ctx) { const { helper1: _helper1, ... } = _Vue ... }`。
 *   module 模式（import 语句）、sourceMap、SSR 都没有实现。
 * - 不做 indent/newline 的精确缩进管理（源码的 CodegenContext.indent/deindent/newline
 *   是为了生成"好看"的代码），mini 版本只保证语义正确、单行拼接即可。
 * - genNode 的分派表（switch）结构和源码一模一样，只是分支数量少很多。
 *
 * tag/callee 的约定（mini 独有的简化，源码里 tag 是 "字符串字面量 | symbol | CallExpression"）：
 *   - 以 `"` 开头 -> 普通字符串字面量（元素标签名），原样输出。
 *   - 其余 -> helper 引用，需要在前面拼上 `_`（例如 tag = "Fragment" -> 输出 "_Fragment"）。
 *   CallExpression.callee 永远是 helper 名字，同样需要拼 `_` 前缀。
 */
import {
  type ArrayExpression,
  type CallExpression,
  type CompoundExpressionNode,
  type ConditionalExpression,
  type JSChildNode,
  NodeTypes,
  type ObjectExpression,
  type RootNode,
  type SimpleExpressionNode,
  type TemplateChildNode,
  type VNodeCall,
} from './ast'

export interface CodegenResult {
  code: string
}

export function generate(ast: RootNode): CodegenResult {
  const helpers = [...ast.helpers]
  const helperDecl = helpers.length
    ? `const { ${helpers.map(h => `${h}: _${h}`).join(', ')} } = _Vue\n    `
    : ''

  const body = ast.codegenNode ? genNode(ast.codegenNode) : 'null'

  // 对应源码 genFunctionPreamble + generate() 里 useWithBlock 分支：
  // `const _Vue = Vue` 先把运行时存起来，再在 with 块里按需解构各个 helper，
  // 这样「组件没用到的 helper」就不会出现在产物里。
  const code =
    `const _Vue = Vue\n` +
    `return function render(_ctx, _cache) {\n` +
    `  with (_ctx) {\n` +
    `    ${helperDecl}return ${body}\n` +
    `  }\n` +
    `}`

  return { code }
}

function genNode(node: JSChildNode | TemplateChildNode): string {
  switch (node.type) {
    case NodeTypes.ELEMENT:
    case NodeTypes.IF:
      return genNode((node as any).codegenNode)
    case NodeTypes.TEXT_CALL:
      return genNode((node as any).codegenNode)
    case NodeTypes.TEXT:
      return JSON.stringify((node as any).content)
    case NodeTypes.SIMPLE_EXPRESSION:
      return genExpression(node as SimpleExpressionNode)
    case NodeTypes.INTERPOLATION:
      return `_toDisplayString(${genNode((node as any).content)})`
    case NodeTypes.COMPOUND_EXPRESSION:
      return genCompoundExpression(node as CompoundExpressionNode)
    case NodeTypes.VNODE_CALL:
      return genVNodeCall(node as VNodeCall)
    case NodeTypes.JS_CALL_EXPRESSION:
      return genCallExpression(node as CallExpression)
    case NodeTypes.JS_OBJECT_EXPRESSION:
      return genObjectExpression(node as ObjectExpression)
    case NodeTypes.JS_ARRAY_EXPRESSION:
      return genArrayExpression(node as ArrayExpression)
    case NodeTypes.JS_CONDITIONAL_EXPRESSION:
      return genConditionalExpression(node as ConditionalExpression)
    /* v8 ignore next 2 */
    default:
      return 'null'
  }
}

function genExpression(node: SimpleExpressionNode): string {
  return node.isStatic ? JSON.stringify(node.content) : node.content
}

function genCompoundExpression(node: CompoundExpressionNode): string {
  return node.children
    .map(c => (typeof c === 'string' ? c : genNode(c as any)))
    .join('')
}

function genTag(tag: string): string {
  return tag.startsWith('"') ? tag : `_${tag}`
}

function genVNodeCall(node: VNodeCall): string {
  const { tag, props, children, patchFlag, dynamicProps, isBlock } = node
  const args = genNullableArgs([
    genTag(tag),
    props ? genNode(props) : undefined,
    children === undefined
      ? undefined
      : Array.isArray(children)
        ? genChildrenArray(children)
        : genNode(children as any),
    patchFlag === undefined ? undefined : String(patchFlag),
    dynamicProps,
  ])
  const callee = isBlock ? '_createElementBlock' : '_createElementVNode'
  const call = `${callee}(${args.join(', ')})`
  return isBlock ? `(_openBlock(), ${call})` : call
}

function genChildrenArray(children: TemplateChildNode[]): string {
  return `[${children.map(c => genNode(c)).join(', ')}]`
}

// 去掉参数列表末尾连续的 undefined（和源码 genNullableArgs 一样，
// 为了不把 `createElementVNode("div", null, null, null)` 这种尾部空位写出来）
function genNullableArgs(args: (string | undefined)[]): string[] {
  let i = args.length
  while (i--) {
    if (args[i] != null) break
  }
  return args.slice(0, i + 1).map(a => a ?? 'null')
}

function genCallExpression(node: CallExpression): string {
  const args = node.arguments
    .map(a => (typeof a === 'string' ? a : Array.isArray(a) ? genChildrenArray(a) : genNode(a)))
    .join(', ')
  return `_${node.callee}(${args})`
}

function genObjectExpression(node: ObjectExpression): string {
  if (!node.properties.length) return '{}'
  const props = node.properties
    .map(p => `${genPropertyKey(p.key)}: ${genNode(p.value)}`)
    .join(', ')
  return `{ ${props} }`
}

function genPropertyKey(key: SimpleExpressionNode): string {
  if (key.isStatic) {
    return /^[A-Za-z_$][\w$]*$/.test(key.content)
      ? key.content
      : JSON.stringify(key.content)
  }
  return `[${key.content}]`
}

function genArrayExpression(node: ArrayExpression): string {
  return `[${node.elements
    .map(e => (typeof e === 'string' ? e : genNode(e as any)))
    .join(', ')}]`
}

function genConditionalExpression(node: ConditionalExpression): string {
  return `${genExpression(node.test)} ? ${genNode(node.consequent)} : ${genNode(
    node.alternate,
  )}`
}
