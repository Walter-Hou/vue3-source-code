/**
 * 对应源码位置：packages/compiler-core/src/parser.ts + tokenizer.ts
 *
 * 精简说明：
 * 真实源码从 3.4 开始把"正则 + 递归下降"改写成了移植自 htmlparser2 的 Tokenizer 状态机
 * （见本章 README「3.3 tokenizer」），用回调的方式把词法事件交给 parser.ts 组装 AST。
 * mini 版本为了让读者在一个文件里看清"解析"这件事本身在做什么，刻意退回到
 * Vue 2 / Vue 3.3 之前那种"正则匹配 + 递归下降"的写法：
 *   parseChildren -> 看下一个字符决定是 parseInterpolation / parseElement / parseText
 *   parseElement  -> parseTag(开始标签) -> parseChildren(递归) -> parseTag(结束标签)
 * 性能、流式解析能力都不如状态机，但逻辑是一一对应的，适合先建立心智模型。
 */
import {
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  ElementTypes,
  type InterpolationNode,
  NodeTypes,
  type RootNode,
  type TemplateChildNode,
  type TextNode,
  createRoot,
  createSimpleExpression,
} from './ast'

export interface ParserContext {
  /** 还未消费的剩余源码；每解析完一部分就从头部切掉 */
  source: string
}

const VOID_TAGS = new Set(['br', 'img', 'input', 'hr', 'meta', 'link'])

function createParserContext(content: string): ParserContext {
  return { source: content }
}

export function baseParse(content: string): RootNode {
  const context = createParserContext(content)
  const children = parseChildren(context, [])
  return createRoot(children)
}

function parseChildren(
  context: ParserContext,
  ancestors: ElementNode[],
): TemplateChildNode[] {
  const nodes: TemplateChildNode[] = []

  while (!isEnd(context, ancestors)) {
    const s = context.source
    let node: TemplateChildNode | undefined

    if (s.startsWith('{{')) {
      node = parseInterpolation(context)
    } else if (s[0] === '<') {
      if (/^<[a-zA-Z]/.test(s)) {
        node = parseElement(context, ancestors)
      } else if (s.startsWith('</')) {
        // 不应该走到这里：说明遇到了一个没有匹配开始标签的闭合标签，
        // 真实源码会走 emitError(X_INVALID_END_TAG)，mini 版本直接跳过。
        const end = s.indexOf('>')
        advanceBy(context, end + 1)
        continue
      }
    }
    if (!node) {
      node = parseText(context)
    }
    nodes.push(node)
  }

  // 相邻纯空白文本折叠成一个空格，近似源码 whitespace: 'condense' 的效果
  // （真正的规则见第 11 章 README 对 condenseWhitespace 的讲解）
  return nodes.filter(n => {
    if (n.type === NodeTypes.TEXT && n.content.trim() === '') {
      n.content = ' '
    }
    return true
  })
}

function isEnd(context: ParserContext, ancestors: ElementNode[]): boolean {
  const s = context.source
  if (!s) return true
  if (s.startsWith('</')) {
    // 从栈顶往下找，只要祖先里有能匹配的闭合标签，就认为当前层级结束
    for (let i = ancestors.length - 1; i >= 0; i--) {
      if (startsWithEndTagOf(s, ancestors[i].tag)) return true
    }
  }
  return false
}

function startsWithEndTagOf(source: string, tag: string): boolean {
  return (
    source.startsWith('</') &&
    source.slice(2, 2 + tag.length).toLowerCase() === tag.toLowerCase() &&
    /[\t\r\n\f />]/.test(source[2 + tag.length] || '>')
  )
}

// ---- 插值 {{ expr }} ------------------------------------------------------

function parseInterpolation(context: ParserContext): InterpolationNode {
  const closeIndex = context.source.indexOf('}}', 2)
  const rawContent = context.source.slice(2, closeIndex)
  advanceBy(context, closeIndex + 2)
  const content = rawContent.trim()
  return {
    type: NodeTypes.INTERPOLATION,
    content: createSimpleExpression(content, false),
  }
}

// ---- 文本 ------------------------------------------------------------------

function parseText(context: ParserContext): TextNode {
  let endIndex = context.source.length
  const ltIndex = context.source.indexOf('<')
  const delimiterIndex = context.source.indexOf('{{')
  if (ltIndex !== -1 && ltIndex < endIndex) endIndex = ltIndex
  if (delimiterIndex !== -1 && delimiterIndex < endIndex) endIndex = delimiterIndex

  const content = context.source.slice(0, endIndex)
  advanceBy(context, content.length)
  return { type: NodeTypes.TEXT, content }
}

// ---- 元素 ------------------------------------------------------------------

function parseElement(
  context: ParserContext,
  ancestors: ElementNode[],
): ElementNode | undefined {
  const element = parseTag(context)
  if (element.isSelfClosing || VOID_TAGS.has(element.tag)) {
    return element
  }

  ancestors.push(element)
  element.children = parseChildren(context, ancestors)
  ancestors.pop()

  if (startsWithEndTagOf(context.source, element.tag)) {
    parseTag(context) // 消费掉结束标签 </tag>
  }
  // 否则说明没有闭合标签：真实源码会 emitError(X_MISSING_END_TAG)
  return element
}

const TAG_NAME_RE = /^<\/?([a-zA-Z][^\t\r\n\f />]*)/

function parseTag(context: ParserContext): ElementNode {
  const match = TAG_NAME_RE.exec(context.source)!
  const tag = match[1]
  advanceBy(context, match[0].length)
  advanceSpaces(context)

  const props: ElementNode['props'] = []
  while (
    context.source.length &&
    !context.source.startsWith('>') &&
    !context.source.startsWith('/>')
  ) {
    const prop = parseAttribute(context)
    if (prop) props.push(prop)
    advanceSpaces(context)
  }

  const isSelfClosing = context.source.startsWith('/>')
  advanceBy(context, isSelfClosing ? 2 : 1)

  return {
    type: NodeTypes.ELEMENT,
    tag,
    tagType: ElementTypes.ELEMENT,
    props,
    children: [],
    isSelfClosing,
    codegenNode: undefined,
  }
}

const ATTR_NAME_RE = /^[^\t\r\n\f />][^\t\r\n\f />=]*/

function parseAttribute(
  context: ParserContext,
): AttributeNode | DirectiveNode | undefined {
  const nameMatch = ATTR_NAME_RE.exec(context.source)
  if (!nameMatch) return undefined
  const rawName = nameMatch[0]
  advanceBy(context, rawName.length)
  advanceSpaces(context)

  let value: string | undefined
  if (context.source[0] === '=') {
    advanceBy(context, 1)
    advanceSpaces(context)
    value = parseAttributeValue(context)
  }

  // 指令：v-xxx / :xxx / @xxx
  // （真实源码在 tokenizer 的 ondirname/ondirarg/ondirmodifier 回调里逐段切出
  //  name/arg/modifiers，这里用一次性的字符串切片简化）
  if (rawName[0] === ':' || rawName[0] === '@' || rawName.startsWith('v-')) {
    let name: string
    let arg: string | undefined
    if (rawName[0] === ':') {
      name = 'bind'
      arg = rawName.slice(1)
    } else if (rawName[0] === '@') {
      name = 'on'
      arg = rawName.slice(1)
    } else {
      // v-xxx or v-xxx:arg
      const rest = rawName.slice(2)
      const colonIndex = rest.indexOf(':')
      name = colonIndex === -1 ? rest : rest.slice(0, colonIndex)
      arg = colonIndex === -1 ? undefined : rest.slice(colonIndex + 1)
    }
    return {
      type: NodeTypes.DIRECTIVE,
      name,
      arg,
      exp: value ? createSimpleExpression(value, false) : undefined,
    }
  }

  return { type: NodeTypes.ATTRIBUTE, name: rawName, value }
}

function parseAttributeValue(context: ParserContext): string {
  const quote = context.source[0]
  const isQuoted = quote === '"' || quote === "'"
  if (isQuoted) {
    advanceBy(context, 1)
    const endIndex = context.source.indexOf(quote)
    const content = context.source.slice(0, endIndex)
    advanceBy(context, content.length + 1)
    return content
  }
  // 无引号值：读到下一个空白或 '>'
  const match = /^[^\t\r\n\f >]+/.exec(context.source)!
  advanceBy(context, match[0].length)
  return match[0]
}

function advanceBy(context: ParserContext, numberOfChars: number): void {
  context.source = context.source.slice(numberOfChars)
}

function advanceSpaces(context: ParserContext): void {
  const match = /^[\t\r\n\f ]+/.exec(context.source)
  if (match) advanceBy(context, match[0].length)
}
