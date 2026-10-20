/**
 * 对应源码位置：packages/compiler-core/src/ast.ts
 *
 * 精简说明：
 * - 只保留教学所需的节点类型：元素/文本/插值/属性/指令/复合表达式/v-if/几种 JS AST 节点。
 * - 省略了 FOR / SLOT_OUTLET / COMPONENT / 多命名空间(svg/mathml) / SSR 节点 / 2.x 兼容字段。
 * - ConstantTypes、hoist、cache 等"优化"相关的字段全部省略 —— 那是第 12 章 cacheStatic 的内容，
 *   mini 版本里每个节点要么是"静态"要么是"动态"，用布尔值 `isStatic`/`patchFlag` 直接表达。
 * - 工厂函数（createXxx）保留与源码一致的命名，方便和 transform/codegen 对照阅读。
 */

export enum NodeTypes {
  ROOT,
  ELEMENT,
  TEXT,
  ATTRIBUTE,
  DIRECTIVE,
  // containers
  SIMPLE_EXPRESSION,
  INTERPOLATION,
  COMPOUND_EXPRESSION,
  IF,
  IF_BRANCH,
  TEXT_CALL,
  // codegen (JS AST)
  VNODE_CALL,
  JS_CALL_EXPRESSION,
  JS_OBJECT_EXPRESSION,
  JS_PROPERTY,
  JS_ARRAY_EXPRESSION,
  JS_CONDITIONAL_EXPRESSION,
}

export enum ElementTypes {
  ELEMENT,
  TEMPLATE,
}

export interface Node {
  type: NodeTypes
}

export type ParentNode = RootNode | ElementNode | IfBranchNode

export type TemplateChildNode =
  | ElementNode
  | TextNode
  | InterpolationNode
  | CompoundExpressionNode
  | IfNode
  | IfBranchNode
  | TextCallNode

export interface RootNode extends Node {
  type: NodeTypes.ROOT
  children: TemplateChildNode[]
  /** mini 版本的 helper 都用字符串名字（如 "openBlock"），源码里是 symbol */
  helpers: Set<string>
  codegenNode?: TemplateChildNode | JSChildNode
}

export interface ElementNode extends Node {
  type: NodeTypes.ELEMENT
  tag: string
  tagType: ElementTypes
  props: Array<AttributeNode | DirectiveNode>
  children: TemplateChildNode[]
  isSelfClosing: boolean
  codegenNode?: VNodeCall | CallExpression
}

export interface TextNode extends Node {
  type: NodeTypes.TEXT
  content: string
}

export interface AttributeNode extends Node {
  type: NodeTypes.ATTRIBUTE
  name: string
  value: string | undefined
}

export interface DirectiveNode extends Node {
  type: NodeTypes.DIRECTIVE
  /** 去掉前缀/简写后的指令名，如 "bind" "on" "if" */
  name: string
  arg: string | undefined
  exp: SimpleExpressionNode | undefined
}

export interface SimpleExpressionNode extends Node {
  type: NodeTypes.SIMPLE_EXPRESSION
  content: string
  isStatic: boolean
}

export interface InterpolationNode extends Node {
  type: NodeTypes.INTERPOLATION
  content: SimpleExpressionNode
}

export interface CompoundExpressionNode extends Node {
  type: NodeTypes.COMPOUND_EXPRESSION
  children: (TextNode | InterpolationNode | string)[]
}

export interface IfNode extends Node {
  type: NodeTypes.IF
  branches: IfBranchNode[]
  codegenNode?: JSChildNode
}

export interface IfBranchNode extends Node {
  type: NodeTypes.IF_BRANCH
  /** undefined 表示这是 v-else 分支 */
  condition: SimpleExpressionNode | undefined
  children: TemplateChildNode[]
}

export interface TextCallNode extends Node {
  type: NodeTypes.TEXT_CALL
  codegenNode: CallExpression
}

// ---- JS AST（codegen 的输入）--------------------------------------------

export type JSChildNode =
  | VNodeCall
  | CallExpression
  | ObjectExpression
  | ArrayExpression
  | ConditionalExpression
  | SimpleExpressionNode

export interface VNodeCall extends Node {
  type: NodeTypes.VNODE_CALL
  tag: string
  props: ObjectExpression | undefined
  children: TemplateChildNode[] | TemplateChildNode | undefined
  patchFlag: number | undefined
  dynamicProps: string | undefined
  isBlock: boolean
}

export interface CallExpression extends Node {
  type: NodeTypes.JS_CALL_EXPRESSION
  callee: string
  arguments: (string | JSChildNode | TemplateChildNode[])[]
}

export interface ObjectExpression extends Node {
  type: NodeTypes.JS_OBJECT_EXPRESSION
  properties: Property[]
}

export interface Property extends Node {
  type: NodeTypes.JS_PROPERTY
  key: SimpleExpressionNode
  value: JSChildNode
}

export interface ArrayExpression extends Node {
  type: NodeTypes.JS_ARRAY_EXPRESSION
  elements: (string | JSChildNode)[]
}

export interface ConditionalExpression extends Node {
  type: NodeTypes.JS_CONDITIONAL_EXPRESSION
  test: SimpleExpressionNode
  consequent: JSChildNode
  alternate: JSChildNode
}

// ---- 工厂函数（命名与源码一致）--------------------------------------------

export function createRoot(children: TemplateChildNode[]): RootNode {
  return {
    type: NodeTypes.ROOT,
    children,
    helpers: new Set<string>(),
    codegenNode: undefined,
  }
}

export function createSimpleExpression(
  content: string,
  isStatic = false,
): SimpleExpressionNode {
  return { type: NodeTypes.SIMPLE_EXPRESSION, content, isStatic }
}

export function createCompoundExpression(
  children: CompoundExpressionNode['children'],
): CompoundExpressionNode {
  return { type: NodeTypes.COMPOUND_EXPRESSION, children }
}

/** 和源码一样，只要求一个"能记 helper"的最小接口，避免和 transform.ts 循环依赖 */
export interface HelperContext {
  helper(name: string): string
  removeHelper(name: string): void
}

export function createVNodeCall(
  context: HelperContext | null,
  tag: string,
  props: ObjectExpression | undefined,
  children: VNodeCall['children'],
  patchFlag: number | undefined,
  dynamicProps: string | undefined,
  isBlock = false,
): VNodeCall {
  if (context) {
    if (isBlock) {
      context.helper('openBlock')
      context.helper('createElementBlock')
    } else {
      context.helper('createElementVNode')
    }
  }
  return {
    type: NodeTypes.VNODE_CALL,
    tag,
    props,
    children,
    patchFlag,
    dynamicProps,
    isBlock,
  }
}

/**
 * 把一个普通的 createElementVNode(...) 调用升级成 block：
 * (openBlock(), createElementBlock(...))。
 * 源码里 v-if/v-for 命中"单子节点可以直接复用"时就调用它（见 vIf.ts）。
 */
export function convertToBlock(node: VNodeCall, context: HelperContext): void {
  if (!node.isBlock) {
    node.isBlock = true
    context.removeHelper('createElementVNode')
    context.helper('openBlock')
    context.helper('createElementBlock')
  }
}

export function createCallExpression(
  callee: string,
  args: CallExpression['arguments'] = [],
): CallExpression {
  return { type: NodeTypes.JS_CALL_EXPRESSION, callee, arguments: args }
}

export function createObjectExpression(properties: Property[]): ObjectExpression {
  return { type: NodeTypes.JS_OBJECT_EXPRESSION, properties }
}

export function createObjectProperty(key: string, value: JSChildNode): Property {
  return {
    type: NodeTypes.JS_PROPERTY,
    key: createSimpleExpression(key, true),
    value,
  }
}

export function createConditionalExpression(
  test: SimpleExpressionNode,
  consequent: JSChildNode,
  alternate: JSChildNode,
): ConditionalExpression {
  return { type: NodeTypes.JS_CONDITIONAL_EXPRESSION, test, consequent, alternate }
}
