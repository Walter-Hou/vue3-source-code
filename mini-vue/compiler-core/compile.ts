/**
 * 对应源码位置：packages/compiler-core/src/compile.ts（baseCompile + getBaseTransformPreset）
 *
 * 精简说明：
 * 真实的 getBaseTransformPreset 按固定顺序组装了十来个 nodeTransform
 * （transformOnce, transformIf, transformMemo, transformFor, ..., transformElement,
 * trackSlotScopes, transformText），mini 版本只留下教学所需的三个：
 *   [transformIf, transformElement, transformText]
 * 顺序很重要：结构型指令（v-if）必须排在最前面，这样它才能在其它 transform
 * 看到这个节点之前就把它替换成 IfNode；transformText 排在 transformElement 后面，
 * 是因为 exitFns 倒序执行，后注册的先退出（第 11 章 README 有详细推导）。
 */
import { baseParse } from './parse'
import { transform } from './transform'
import { generate } from './codegen'
import { transformElement } from './transforms/transformElement'
import { transformText } from './transforms/transformText'
import { transformIf } from './transforms/vIf'
import type { RootNode } from './ast'

export interface CompileResult {
  code: string
  ast: RootNode
}

export function compile(template: string): CompileResult {
  const ast = baseParse(template)
  transform(ast, {
    nodeTransforms: [transformIf, transformElement, transformText],
  })
  const { code } = generate(ast)
  return { code, ast }
}
