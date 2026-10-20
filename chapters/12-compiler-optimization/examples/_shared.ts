/**
 * 本章示例公用的小工具：不是一个独立示例，不要用 `pnpm ex` 直接跑它。
 * - printAST：打印 AST，显示 NodeTypes 名称 / tag / props / patchFlag / codegenNode 类型
 * - decodePatchFlag：把数字 patchFlag 解码成人类可读的 flag 名字
 * - printHelpers：打印 root.helpers（渲染时用到的 runtime helper 列表）
 */
import {
  type AttributeNode,
  type DirectiveNode,
  type RootNode,
  type TemplateChildNode,
  NodeTypes,
  ElementTypes,
} from '@vue/compiler-core'
import { PatchFlagNames, type PatchFlags } from '@vue/shared'

const NodeTypeNames: Record<number, string> = Object.fromEntries(
  Object.entries(NodeTypes)
    .filter(([k]) => Number.isNaN(Number(k)))
    .map(([k, v]) => [v as number, k]),
)
const ElementTypeNames: Record<number, string> = Object.fromEntries(
  Object.entries(ElementTypes)
    .filter(([k]) => Number.isNaN(Number(k)))
    .map(([k, v]) => [v as number, k]),
)

/** 把数字 patchFlag 解码成 `TEXT, PROPS` 这样的名字列表；特殊负数 flag 单独处理 */
export function decodePatchFlag(flag: number | undefined): string {
  if (flag === undefined) return '(none)'
  if (flag < 0) return `${flag} /* ${PatchFlagNames[flag as PatchFlags]} */`
  const names = Object.keys(PatchFlagNames)
    .map(Number)
    .filter(n => n > 0 && flag & n)
    .map(n => PatchFlagNames[n as PatchFlags])
  return `${flag} /* ${names.join(', ')} */`
}

function propToString(p: AttributeNode | DirectiveNode): string {
  if (p.type === NodeTypes.ATTRIBUTE) {
    return p.value === undefined ? p.name : `${p.name}="${p.value.content}"`
  }
  const dir = p as DirectiveNode
  const arg = dir.arg ? (dir.arg.type === NodeTypes.SIMPLE_EXPRESSION ? dir.arg.content : '(复合表达式)') : ''
  const mods = dir.modifiers.length ? '.' + dir.modifiers.map(m => m.content).join('.') : ''
  const exp = dir.exp && dir.exp.type === NodeTypes.SIMPLE_EXPRESSION ? dir.exp.content : ''
  return `v-${dir.name}${arg ? `:${arg}` : ''}${mods}="${exp}"`
}

function codegenNodeType(node: TemplateChildNode): string {
  const anyNode = node as any
  if (!anyNode.codegenNode) return '(none)'
  return NodeTypeNames[anyNode.codegenNode.type] ?? String(anyNode.codegenNode.type)
}

/** 紧凑打印 AST：每行一个节点，用缩进表示层级 */
export function printAST(root: RootNode | TemplateChildNode, indent = 0): void {
  const pad = '  '.repeat(indent)
  const type = (root as any).type as NodeTypes

  switch (type) {
    case NodeTypes.ROOT: {
      console.log(`${pad}ROOT`)
      ;(root as RootNode).children.forEach(c => printAST(c, indent + 1))
      return
    }
    case NodeTypes.ELEMENT: {
      const el = root as any
      const tagType = ElementTypeNames[el.tagType]
      const props = el.props.map(propToString).join(' ')
      const flag = el.codegenNode?.type === NodeTypes.VNODE_CALL ? decodePatchFlag(el.codegenNode.patchFlag) : undefined
      console.log(
        `${pad}ELEMENT <${el.tag}> [${tagType}]${props ? ` props={${props}}` : ''}` +
          `${flag ? ` patchFlag=${flag}` : ''} codegenNode=${codegenNodeType(el)}`,
      )
      el.children.forEach((c: TemplateChildNode) => printAST(c, indent + 1))
      return
    }
    case NodeTypes.TEXT:
      console.log(`${pad}TEXT ${JSON.stringify((root as any).content)}`)
      return
    case NodeTypes.COMMENT:
      console.log(`${pad}COMMENT ${JSON.stringify((root as any).content)}`)
      return
    case NodeTypes.INTERPOLATION: {
      const content = (root as any).content
      console.log(`${pad}INTERPOLATION {{ ${content.content} }}`)
      return
    }
    case NodeTypes.COMPOUND_EXPRESSION: {
      const parts = (root as any).children
        .map((c: any) => (typeof c === 'string' ? c : c.content ?? NodeTypeNames[c.type]))
        .join('')
      console.log(`${pad}COMPOUND_EXPRESSION "${parts}"`)
      return
    }
    case NodeTypes.IF: {
      console.log(`${pad}IF (${(root as any).branches.length} branches)`)
      ;(root as any).branches.forEach((b: TemplateChildNode) => printAST(b, indent + 1))
      return
    }
    case NodeTypes.IF_BRANCH: {
      const cond = (root as any).condition
      console.log(`${pad}IF_BRANCH condition=${cond ? cond.content : '(else)'}`)
      ;(root as any).children.forEach((c: TemplateChildNode) => printAST(c, indent + 1))
      return
    }
    case NodeTypes.FOR: {
      const n = root as any
      console.log(
        `${pad}FOR source="${n.source.content}" value=${n.valueAlias?.content} key=${n.keyAlias?.content}`,
      )
      n.children.forEach((c: TemplateChildNode) => printAST(c, indent + 1))
      return
    }
    case NodeTypes.TEXT_CALL:
      console.log(`${pad}TEXT_CALL codegenNode=${NodeTypeNames[(root as any).codegenNode.type]}`)
      return
    default:
      console.log(`${pad}${NodeTypeNames[type] ?? type}`)
  }
}

export function printHelpers(root: RootNode): void {
  console.log(`helpers = [${[...root.helpers].map(h => String(h.description)).join(', ')}]`)
}

/**
 * 打印一棵真实的 vnode 树（compile -> new Function -> render() 跑出来的结果），
 * 重点展示 patchFlag / dynamicChildren —— 这是运行时真正读取的"编译产物"，
 * 不是 AST。dynamicChildren 不为空时，递归只走 dynamicChildren（模拟
 * patchBlockChildren 的"只看动态列表"视角）；顶层调用则同时展示完整 children。
 */
export function printBlockTree(vnode: any, indent = 0): void {
  const pad = '  '.repeat(indent)
  const tag =
    typeof vnode.type === 'symbol' ? vnode.type.description : vnode.type
  const flag = vnode.patchFlag ? decodePatchFlag(vnode.patchFlag) : '(none)'
  const dyn = vnode.dynamicChildren
    ? `dynamicChildren=${vnode.dynamicChildren.length}`
    : 'dynamicChildren=null'
  console.log(`${pad}<${tag}> patchFlag=${flag} ${dyn}`)
  if (Array.isArray(vnode.dynamicChildren)) {
    vnode.dynamicChildren.forEach((c: any) => printBlockTree(c, indent + 1))
  }
}

export { NodeTypes, ElementTypes, NodeTypeNames }
