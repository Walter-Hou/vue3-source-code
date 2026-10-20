/**
 * 对应源码位置：packages/compiler-core/src/transforms/transformText.ts
 *
 * 精简说明：
 * 和源码一样做两件事（都在"退出"阶段做，因为要等子节点都处理完）：
 *   1. 把相邻的 TEXT / INTERPOLATION 合并成一个 COMPOUND_EXPRESSION
 *      （`前缀{{a}}中缀{{b}}` 应该只占一个 child slot）。
 *   2. 如果父节点不是"只有一个文本型子节点的普通元素"，就把每个文本型子节点包成
 *      `createTextVNode(text, patchFlag?)` 调用 —— 因为 children 数组里其它位置
 *      放的都是 vnode，原始字符串/表达式不能直接塞进数组。
 *      唯一的例外（"单文本子节点"）留给 transformElement 直接处理，运行时对这种
 *      情况有 `el.textContent = text` 的快速路径，见第 7 章 renderer。
 *
 * 这个文件必须在 transformElement **之前**注册到 nodeTransforms 数组里 —— 但因为
 * exitFns 是倒序执行的，注册顺序在后面的 transform 反而先"退出"。mini-vue/compile.ts
 * 里的顺序是 [transformIf, transformElement, transformText]，所以实际退出顺序是
 * transformText -> transformElement -> transformIf，和源码的 preset 顺序一致。
 */
import {
  type CompoundExpressionNode,
  ElementTypes,
  NodeTypes,
  type TemplateChildNode,
  createCallExpression,
  createCompoundExpression,
} from '../ast'
import type { NodeTransform } from '../transform'

const PatchFlags = { TEXT: 1 }

function isTextNode(node: TemplateChildNode): boolean {
  return node.type === NodeTypes.INTERPOLATION || node.type === NodeTypes.TEXT
}

export const transformText: NodeTransform = (node, context) => {
  if (
    node.type !== NodeTypes.ROOT &&
    node.type !== NodeTypes.ELEMENT &&
    node.type !== NodeTypes.IF_BRANCH
  ) {
    return
  }

  return () => {
    const container = context.currentNode as typeof node
    if (
      container.type !== NodeTypes.ROOT &&
      container.type !== NodeTypes.ELEMENT &&
      container.type !== NodeTypes.IF_BRANCH
    ) {
      return
    }
    const children = container.children
    let currentContainer: CompoundExpressionNode | undefined
    let hasText = false

    // 1. 合并相邻文本/插值
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (isTextNode(child)) {
        hasText = true
        for (let j = i + 1; j < children.length; j++) {
          const next = children[j]
          if (isTextNode(next)) {
            if (!currentContainer) {
              currentContainer = children[i] = createCompoundExpression([
                child as any,
              ]) as any
            }
            currentContainer!.children.push(' + ', next as any)
            children.splice(j, 1)
            j--
          } else {
            currentContainer = undefined
            break
          }
        }
      }
    }

    const isPlainElementSingleChild =
      children.length === 1 &&
      (container.type === NodeTypes.ROOT ||
        (container.type === NodeTypes.ELEMENT &&
          container.tagType === ElementTypes.ELEMENT))

    if (!hasText || isPlainElementSingleChild) {
      // 单文本子节点交给 transformElement 的"单子节点优化"直接处理
      return
    }

    // 2. 把文本型子节点转成 createTextVNode(...) 调用
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (isTextNode(child) || child.type === NodeTypes.COMPOUND_EXPRESSION) {
        const callArgs: any[] = [child]
        // 只要出现在多子节点数组里，就一定需要在更新时被 patch 到，
        // 所以这里始终带上 TEXT patchFlag（源码还会判断 getConstantType，
        // 完整规则见第 12 章 cacheStatic）。
        callArgs.push(PatchFlags.TEXT)
        context.helper('createTextVNode')
        children[i] = {
          type: NodeTypes.TEXT_CALL,
          codegenNode: createCallExpression('createTextVNode', callArgs),
        } as any
      }
    }
  }
}
