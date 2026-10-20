/**
 * 运行：pnpm ex chapters/11-compiler-core/examples/03-transform-pipeline.ts
 * 演示：自己写一个 nodeTransform 塞进 nodeTransforms 数组，观察 traverseNode 的
 *       进入/退出顺序；用 context.helper() 注入一个 helper；用 context.replaceNode()
 *       改写节点；transform 跑完后打印每个节点的 codegenNode 类型。
 * 看点：
 *  1. "进入"按 nodeTransforms 数组顺序执行；"退出"按注册顺序**倒序**执行——
 *     这是 traverseNode() 里 `while (i--) exitFns[i]()` 决定的（transform.ts#L480-486）。
 *  2. 我们自定义的 transform 放在数组最前面，所以它的 enter 最先跑，但 exit 最后跑
 *     （因为它排最前面，对应 exitFns 数组下标最小，倒序时最后被 while(i--) 取到）。
 *  3. context.helper(symbol) 只是"登记一次使用"，真正决定产物里出现哪些 `_xxx` 解构
 *     是 codegen.ts 的 genFunctionPreamble，按 root.helpers 里实际出现的 helper 生成。
 *  4. replaceNode 在 transform 期间把当前节点整个换掉（v-if/v-for 都是这么干的），
 *     traverseNode 会感知到并重新读取 context.currentNode 继续往下走。
 */
import { baseParse, transform, type RootNode } from '@vue/compiler-core'
import { getBaseTransformPreset } from '@vue/compiler-core'
import { TO_DISPLAY_STRING } from '@vue/compiler-core'
import { NodeTypes } from '@vue/compiler-core'
import { section, step, log } from '../../../shared/print'
import { printAST, NodeTypeNames } from './_shared'

section('1. 自定义 nodeTransform：打印 enter / exit 顺序')
const order: string[] = []
function makeLogger(name: string) {
  return (node: any) => {
    order.push(`enter:${name}(${NodeTypeNames[node.type]})`)
    return () => {
      order.push(`exit:${name}(${NodeTypeNames[node.type]})`)
    }
  }
}

const ast1: RootNode = baseParse(`<div>{{ msg }}</div>`)
const [baseNodeTransforms, directiveTransforms] = getBaseTransformPreset()
transform(ast1, {
  nodeTransforms: [makeLogger('myFirst'), ...baseNodeTransforms, makeLogger('myLast')],
  directiveTransforms,
})
step('执行顺序（myFirst 排最前面，myLast 排最后面）')
log(order)
step('结论：enter 顺序 = 数组顺序；exit 顺序 = 数组的倒序')
log(
  'myFirst 最先 enter，但因为它在 exitFns[0]，倒序 while(i--) 最后才轮到它，所以最后 exit',
)

section('2. context.helper()：登记一次 helper 使用')
const order2: string[] = []
const ast2: RootNode = baseParse(`<div>static only</div>`)
transform(ast2, {
  nodeTransforms: [
    (node, context) => {
      if (node.type === NodeTypes.ELEMENT) {
        context.helper(TO_DISPLAY_STRING) // 故意注入一个本来用不到的 helper
      }
    },
    ...baseNodeTransforms,
  ],
  directiveTransforms,
})
step('root.helpers 里出现了我们手动注入的 toDisplayString，即使模板里根本没有插值')
log([...ast2.helpers].map(h => h.description))

section('3. context.replaceNode()：在 transform 期间整体替换节点')
const ast3: RootNode = baseParse(`<div>original</div>`)
transform(ast3, {
  nodeTransforms: [
    (node, context) => {
      if (node.type === NodeTypes.ELEMENT && node.tag === 'div') {
        // 把 <div>original</div> 替换成一个 TEXT 节点
        context.replaceNode({
          type: NodeTypes.TEXT,
          content: '(replaced by custom transform)',
          loc: node.loc,
        })
      }
    },
    ...baseNodeTransforms,
  ],
  directiveTransforms,
})
step('替换后的 root.codegenNode')
log(ast3.codegenNode)

section('4. transform 之后，每个节点的 codegenNode 类型')
const ast4 = baseParse(
  `<div id="app"><span v-if="ok">A</span><span v-else>B</span>{{ msg }}</div>`,
)
transform(ast4, { nodeTransforms: baseNodeTransforms, directiveTransforms })
step('printAST 会读取 codegenNode.type 并打印它的 NodeTypes 名字')
printAST(ast4)
