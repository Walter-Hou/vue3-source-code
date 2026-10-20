/**
 * 对应源码位置：packages/compiler-core/src/transforms/vIf.ts
 *
 * 精简说明：
 * - 省略了 `<template v-if>`（多子节点 Fragment 包裹）、v-if/v-else 之间的注释节点处理。
 *   mini 版本只支持直接写在普通元素上的 v-if/v-else-if/v-else，且每个分支只有一个
 *   子节点（就是它自己）。
 * - 但保留了源码最关键的三个设计点，并在注释里标出：
 *   1. v-if 把自己替换成 IfNode（一个节点变成"分支容器"）。
 *   2. v-else(-if) 要在"退出"阶段才能拿到分支子节点的 codegenNode，所以用 getParentCondition
 *      顺着 ConditionalExpression.alternate 链条找到最后一个空位。
 *   3. 单子节点分支直接复用子节点的 VNodeCall 并标记 isBlock = true
 *     （对应源码 convertToBlock，让 v-if 自己开一个 block）。
 * - **key 的自动注入必须保留**（没有按源码精简掉）：`<p v-if>A</p><p v-else>B</p>`
 *   两个分支标签相同、都没有动态 patchFlag，运行时 `isSameVNodeType` 只比较
 *   `type`/`key`，如果不给分支分别打上 `key: 0` / `key: 1`，diff 会把它们当成
 *   "同一个 p，只是文字从 A 变 B"——而纯静态文本没有 TEXT patchFlag，真实场景里
 *   这意味着文字根本不会被更新（这是笔者实现 mini 版本时真实踩到的坑，
 *   对应 README「与 Vue 2 对比」一节里 key 那条）。
 */
import {
  type ConditionalExpression,
  type DirectiveNode,
  type ElementNode,
  type IfBranchNode,
  type IfNode,
  type VNodeCall,
  NodeTypes,
  convertToBlock,
  createCallExpression,
  createConditionalExpression,
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
} from '../ast'
import {
  type TransformContext,
  createStructuralDirectiveTransform,
  traverseNode,
} from '../transform'

export const transformIf = createStructuralDirectiveTransform(
  /^(?:if|else|else-if)$/,
  (node, dir, context) => {
    return processIf(node, dir, context, (ifNode, branch, isRoot) => {
      // exit 回调：此时 branch.children[0]（也就是原来的元素）已经跑完了
      // transformElement，拥有了自己的 codegenNode。
      return () => {
        const keyIndex = ifNode.branches.indexOf(branch)
        if (isRoot) {
          ifNode.codegenNode = createCodegenNodeForBranch(branch, keyIndex, context)
        } else {
          const parentCondition = getParentCondition(
            ifNode.codegenNode as ConditionalExpression,
          )
          parentCondition.alternate = createCodegenNodeForBranch(
            branch,
            keyIndex,
            context,
          )
        }
      }
    })
  },
)

function processIf(
  node: ElementNode,
  dir: DirectiveNode,
  context: TransformContext,
  processCodegen: (
    ifNode: IfNode,
    branch: IfBranchNode,
    isRoot: boolean,
  ) => () => void,
): (() => void) | undefined {
  if (dir.name === 'if') {
    const branch = createIfBranch(node, dir)
    const ifNode: IfNode = { type: NodeTypes.IF, branches: [branch] }
    context.replaceNode(ifNode)
    return processCodegen(ifNode, branch, true)
  }

  // v-else-if / v-else：往前找相邻的 v-if 链（跳过纯空白文本节点）
  const siblings = context.parent!.children
  let i = siblings.indexOf(node)
  while (i-- >= -1) {
    const sibling = siblings[i]
    if (sibling && sibling.type === NodeTypes.TEXT && !sibling.content.trim()) {
      context.removeNode(sibling)
      continue
    }
    if (sibling && sibling.type === NodeTypes.IF) {
      context.removeNode()
      const branch = createIfBranch(node, dir)
      sibling.branches.push(branch)
      const onExit = processCodegen(sibling, branch, false)
      // 这个节点已经从树上摘掉了，不会再被 traverseChildren 访问到，
      // 要手动触发一次 traverseNode 才能让它的子节点/自己被各 transform 处理。
      traverseNode(branch, context)
      onExit()
      context.currentNode = null
    }
    break
  }
  return undefined
}

function createIfBranch(node: ElementNode, dir: DirectiveNode): IfBranchNode {
  return {
    type: NodeTypes.IF_BRANCH,
    condition: dir.name === 'else' ? undefined : dir.exp,
    children: [node],
  }
}

function createCodegenNodeForBranch(
  branch: IfBranchNode,
  keyIndex: number,
  context: TransformContext,
) {
  if (branch.condition) {
    context.helper('createCommentVNode')
    return createConditionalExpression(
      branch.condition,
      createChildrenCodegenNode(branch, keyIndex, context),
      // 没有 v-else 时，用一个注释占位，保证分支数量/DOM 结构稳定
      createCallExpression('createCommentVNode', [`"v-if"`, 'true']),
    )
  }
  return createChildrenCodegenNode(branch, keyIndex, context)
}

function createChildrenCodegenNode(
  branch: IfBranchNode,
  keyIndex: number,
  context: TransformContext,
) {
  const child = branch.children[0] as ElementNode
  const vnodeCall = child.codegenNode!
  if (vnodeCall.type === NodeTypes.VNODE_CALL) {
    // 把 createElementVNode(...) 升级成 (openBlock(), createElementBlock(...))
    convertToBlock(vnodeCall, context)
    injectKey(vnodeCall, keyIndex)
  }
  return vnodeCall
}

/**
 * 给分支的根 vnode 注入 `key: <keyIndex>`。
 * 对应源码 vIf.ts 里的 keyProperty + injectProp —— 必须让 isSameVNodeType 在
 * "标签相同但来自不同 v-if 分支" 时判定为不同节点，否则运行时会复用旧 DOM，
 * 导致静态文本分支切换时压根不触发任何 patch（见文件头注释里踩的坑）。
 */
function injectKey(vnodeCall: VNodeCall, keyIndex: number): void {
  const keyProp = createObjectProperty(
    'key',
    createSimpleExpression(String(keyIndex), false),
  )
  if (vnodeCall.props) {
    vnodeCall.props.properties.unshift(keyProp)
  } else {
    vnodeCall.props = createObjectExpression([keyProp])
  }
}

function getParentCondition(
  node: ConditionalExpression,
): ConditionalExpression {
  while (node.alternate.type === NodeTypes.JS_CONDITIONAL_EXPRESSION) {
    node = node.alternate
  }
  return node
}
