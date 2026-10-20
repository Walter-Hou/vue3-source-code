/**
 * 对应源码位置：packages/compiler-core/src/transforms/transformElement.ts
 *
 * 精简说明：
 * 真实的 buildProps/analyzePatchFlag 要处理 class/style/FULL_PROPS/ref/自定义指令/
 * 组件 slots 等十几种情况（完整讲解见第 12 章）。mini 版本只保留两种 patchFlag：
 *   - PROPS(8)：有 `:attr="expr"` 这样的动态属性（dynamicProps 记录属性名）
 *   - TEXT(1)：唯一子节点是动态文本（由 transformText.ts 判断并直接写回 VNodeCall）
 * 事件处理用一个简单的正则近似源码里的 isMemberExpression 判断（完整的 babel AST
 * 判断见第 12 章 vOn.ts 精读）：
 *   - `@click="onClick"` / `@click="this.onClick"` 这种"纯引用"直接原样输出
 *     （`onClick: onClick`），否则函数引用会被意外"调用"一次导致语义错误。
 *   - 其余（`count++`、`doSomething()`、多语句）包成内联语句
 *     `(...args) => (expr)`，对应源码的 isInlineStatement 分支。
 * 不做 cacheHandlers（见第 12 章 05 示例）。
 */
import {
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  NodeTypes,
  type ObjectExpression,
  type Property,
  type VNodeCall,
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
  createVNodeCall,
} from '../ast'
import type { NodeTransform } from '../transform'

const PatchFlags = {
  TEXT: 1,
  PROPS: 1 << 3,
}

function camelize(str: string): string {
  return str.replace(/-(\w)/g, (_, c) => c.toUpperCase())
}
function capitalize(str: string): string {
  return str[0].toUpperCase() + str.slice(1)
}
function toHandlerKey(event: string): string {
  return event ? `on${capitalize(camelize(event))}` : ``
}

// 近似源码 utils.ts 的 isMemberExpression：形如 `foo` / `foo.bar` / `foo['bar']`
// 的"纯引用"，可以直接当函数用，不需要再包一层箭头函数。
const MEMBER_EXPRESSION_RE =
  /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[[^[\]]+\])*$/
function isMemberExpression(content: string): boolean {
  return MEMBER_EXPRESSION_RE.test(content.trim())
}

// 和源码一样：transformElement 在"进入"阶段什么都不做，返回一个 exit 函数，
// 在所有子节点、所有指令 transform 都跑完之后才真正合成 codegenNode。
export const transformElement: NodeTransform = (node, context) => {
  if (node.type !== NodeTypes.ELEMENT) return

  return () => {
    const el = context.currentNode as ElementNode
    const { tag, props, children } = el

    let patchFlag = 0
    const dynamicPropNames: string[] = []
    const properties: Property[] = []

    for (const prop of props) {
      if (prop.type === NodeTypes.ATTRIBUTE) {
        const attr = prop as AttributeNode
        properties.push(
          createObjectProperty(
            attr.name,
            createSimpleExpression(attr.value ?? '', true),
          ),
        )
      } else {
        // DIRECTIVE：v-bind / v-on（v-if 已经在 transformIf 里被摘走了）
        const dir = prop as DirectiveNode
        if (dir.name === 'bind' && dir.arg) {
          properties.push(
            createObjectProperty(
              dir.arg,
              createSimpleExpression(dir.exp?.content ?? '', false),
            ),
          )
          if (dir.arg !== 'key') {
            dynamicPropNames.push(dir.arg)
          }
        } else if (dir.name === 'on' && dir.arg) {
          const handlerKey = toHandlerKey(dir.arg)
          const raw = dir.exp?.content ?? ''
          const handlerExp = isMemberExpression(raw)
            ? raw
            : `(...args) => (${raw})`
          properties.push(
            createObjectProperty(handlerKey, createSimpleExpression(handlerExp, false)),
          )
          // 事件不计入 dynamicPropNames：源码里事件走的是另一套
          // hasHydrationEventBinding 逻辑（见第 12 章），这里简化掉。
        }
      }
    }

    if (dynamicPropNames.length) {
      patchFlag |= PatchFlags.PROPS
    }

    const propsExpression: ObjectExpression | undefined = properties.length
      ? createObjectExpression(properties)
      : undefined

    // 单子节点优化：唯一子节点是文本/插值/复合表达式时，不要把它塞进 children 数组
    // （数组里应该全是 vnode，TextNode/InterpolationNode 都不是），而是直接把它
    // 当成 VNodeCall.children，运行时会走 `el.textContent = ...` 的快速路径。
    // 对应源码 transformElement.ts 里 `hasDynamicTextChild` 那一段。
    let vnodeChildren: VNodeCall['children']
    if (children.length === 1) {
      const only = children[0]
      const isDynamicText =
        only.type === NodeTypes.INTERPOLATION ||
        only.type === NodeTypes.COMPOUND_EXPRESSION
      if (isDynamicText) {
        patchFlag |= PatchFlags.TEXT
      }
      vnodeChildren =
        isDynamicText || only.type === NodeTypes.TEXT ? only : children
    } else if (children.length > 1) {
      vnodeChildren = children
    }

    const vnodeCall: VNodeCall = createVNodeCall(
      context,
      `"${tag}"`,
      propsExpression,
      vnodeChildren,
      patchFlag === 0 ? undefined : patchFlag,
      dynamicPropNames.length ? JSON.stringify(dynamicPropNames) : undefined,
      false, // isBlock：是否开 block 由根节点/v-if 决定，mini 版本固定在 createRootCodegen 里处理
    )

    el.codegenNode = vnodeCall
  }
}
