/**
 * 对应源码位置：packages/compiler-core/src/transform.ts
 *
 * 精简说明：
 * - 保留源码最核心的结构：createTransformContext + traverseNode(收集 exitFns，倒序执行)
 *   + traverseChildren + createStructuralDirectiveTransform。
 * - 省略了 hoistStatic/cacheStatic、identifiers 作用域追踪、helpers 计数之外的大部分字段
 *   （components/directives/imports/scopes...），这些在 mini 场景下用不到。
 * - helper() 仍然用 Map 计数，是为了在 codegen.ts 里演示"按需生成 helper 列表"这件事。
 */
import {
  type DirectiveNode,
  type ElementNode,
  NodeTypes,
  type ParentNode,
  type RootNode,
  type TemplateChildNode,
  convertToBlock,
  createVNodeCall,
} from './ast'

export type NodeTransform = (
  node: RootNode | TemplateChildNode,
  context: TransformContext,
) => void | (() => void)

export type StructuralDirectiveTransform = (
  node: ElementNode,
  dir: DirectiveNode,
  context: TransformContext,
) => void | (() => void)

export interface TransformOptions {
  nodeTransforms?: NodeTransform[]
}

export interface TransformContext {
  root: RootNode
  parent: ParentNode | null
  childIndex: number
  currentNode: RootNode | TemplateChildNode | null
  helpers: Map<string, number>
  nodeTransforms: NodeTransform[]
  helper(name: string): string
  removeHelper(name: string): void
  replaceNode(node: TemplateChildNode): void
  removeNode(node?: TemplateChildNode): void
  onNodeRemoved: () => void
}

export function createTransformContext(
  root: RootNode,
  { nodeTransforms = [] }: TransformOptions,
): TransformContext {
  const context: TransformContext = {
    root,
    parent: null,
    childIndex: 0,
    currentNode: root,
    helpers: new Map(),
    nodeTransforms,
    helper(name) {
      const count = context.helpers.get(name) || 0
      context.helpers.set(name, count + 1)
      return name
    },
    removeHelper(name) {
      const count = context.helpers.get(name)
      if (count) {
        const next = count - 1
        if (!next) context.helpers.delete(name)
        else context.helpers.set(name, next)
      }
    },
    replaceNode(node) {
      context.parent!.children[context.childIndex] = context.currentNode = node
    },
    removeNode(node) {
      const list = context.parent!.children
      const removalIndex = node ? list.indexOf(node) : context.childIndex
      if (!node || node === context.currentNode) {
        context.currentNode = null
        context.onNodeRemoved()
      } else if (context.childIndex > removalIndex) {
        context.childIndex--
        context.onNodeRemoved()
      }
      list.splice(removalIndex, 1)
    },
    onNodeRemoved: () => {},
  }
  return context
}

export function transform(root: RootNode, options: TransformOptions): void {
  const context = createTransformContext(root, options)
  traverseNode(root, context)
  createRootCodegen(root, context)
  root.helpers = new Set(context.helpers.keys())
}

/**
 * 对应源码 transform.ts 里的 createRootCodegen：决定模板"整体"长什么样。
 * - 只有一个元素子节点 -> 把它自己升级成 block，当作根 codegenNode。
 * - 只有一个非元素子节点（IfNode/文本）-> 直接用，因为它自己已经是/将会是一个 block。
 * - 多个子节点 -> 包一层 Fragment block（mini 版本只处理这一种，不区分 STABLE_FRAGMENT）。
 */
function createRootCodegen(root: RootNode, context: TransformContext): void {
  const { children } = root
  if (children.length === 1) {
    const child = children[0]
    if (child.type === NodeTypes.ELEMENT && child.codegenNode) {
      const codegenNode = child.codegenNode
      if (codegenNode.type === NodeTypes.VNODE_CALL) {
        convertToBlock(codegenNode, context)
      }
      root.codegenNode = codegenNode
    } else {
      root.codegenNode = child
    }
  } else if (children.length > 1) {
    context.helper('Fragment')
    // tag 写成不带引号的 `Fragment`：codegen 遇到不是以 `"` 开头的 tag，
    // 就知道这是一个 helper 引用，会自动拼成 `_Fragment`
    // （省去源码里"tag 是 symbol 还是字符串字面量"的类型分支）。
    root.codegenNode = createVNodeCall(
      context,
      'Fragment',
      undefined,
      root.children,
      undefined,
      undefined,
      true,
    )
  }
}

export function traverseChildren(
  parent: ParentNode,
  context: TransformContext,
): void {
  let i = 0
  const nodeRemoved = () => {
    i--
  }
  for (; i < parent.children.length; i++) {
    const child = parent.children[i]
    context.parent = parent
    context.childIndex = i
    context.onNodeRemoved = nodeRemoved
    traverseNode(child, context)
  }
}

export function traverseNode(
  node: RootNode | TemplateChildNode,
  context: TransformContext,
): void {
  context.currentNode = node
  const { nodeTransforms } = context
  // 关键点 1：每个 nodeTransform 在"进入"阶段执行一次，如果返回了函数，
  // 就先收集起来，等子节点处理完之后、离开当前节点时再倒序调用。
  const exitFns: (() => void)[] = []
  for (let i = 0; i < nodeTransforms.length; i++) {
    const onExit = nodeTransforms[i](node, context)
    if (onExit) exitFns.push(onExit)
    if (!context.currentNode) return // 节点被移除
    node = context.currentNode
  }

  switch (node.type) {
    case NodeTypes.INTERPOLATION:
      // 和源码一样：toDisplayString 的 helper 登记发生在 traverseNode 本体里，
      // 不属于任何一个具名的 nodeTransform。
      context.helper('toDisplayString')
      break
    case NodeTypes.IF:
      for (let i = 0; i < node.branches.length; i++) {
        traverseNode(node.branches[i], context)
      }
      break
    case NodeTypes.IF_BRANCH:
    case NodeTypes.ELEMENT:
    case NodeTypes.ROOT:
      traverseChildren(node, context)
      break
  }

  // 关键点 2：倒序执行 exitFns。
  // 子节点必须先生成好自己的 codegenNode，父节点的 transformElement 在"退出"时
  // 才能读到完整的 children 去合成 VNodeCall；"后注册的 transform 先退出"这一点
  // 在 03-transform-pipeline 示例里会直接打印出来验证。
  context.currentNode = node
  let i = exitFns.length
  while (i--) {
    exitFns[i]()
  }
}

export function createStructuralDirectiveTransform(
  name: string | RegExp,
  fn: StructuralDirectiveTransform,
): NodeTransform {
  const matches = typeof name === 'string' ? (n: string) => n === name : (n: string) => name.test(n)

  return (node, context) => {
    if (node.type !== NodeTypes.ELEMENT) return
    const { props } = node
    const exitFns: (() => void)[] = []
    for (let i = 0; i < props.length; i++) {
      const prop = props[i]
      if (prop.type === NodeTypes.DIRECTIVE && matches(prop.name)) {
        // 结构型指令在"进入"阶段就从 props 里摘除，避免被后面的 transformElement
        // 当成普通 prop 处理，也避免死循环重复匹配。
        props.splice(i, 1)
        i--
        const onExit = fn(node, prop, context)
        if (onExit) exitFns.push(onExit)
      }
    }
    if (exitFns.length) {
      return () => exitFns.forEach(fn => fn())
    }
  }
}
