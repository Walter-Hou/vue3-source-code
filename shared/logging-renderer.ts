/**
 * 「打日志的自定义渲染器」—— 用 @vue/runtime-core 的 createRenderer 接一套内存里的假 DOM。
 *
 * 目的：在 Node 里（不开浏览器）观察 Vue 运行时对「宿主节点」做了哪些操作：
 *   createElement / insert / remove / setElementText / patchProp ...
 * 这正是 Vue 3 把 runtime-core 与平台解耦的产物：runtime-core 只认 RendererOptions 这组接口。
 *
 * 设计上参考了官方仓库里的私有包 packages/runtime-test（它没有发布到 npm，所以自己写一个）。
 *
 * 用法：
 *   import { h, ref } from '@vue/runtime-core'
 *   import { render, createRoot, serialize, dumpOps, resetOps } from '../../../shared/logging-renderer'
 *   const root = createRoot()
 *   render(h('div', { id: 'a' }, 'hi'), root)
 *   console.log(serialize(root))   // <div id="a">hi</div>
 *   console.log(dumpOps())         // 本次 render 触发的所有宿主操作
 */
import {
  createRenderer,
  type CreateAppFunction,
  type RootRenderFunction,
  type VNode,
} from '@vue/runtime-core'

export type NodeType = 'element' | 'text' | 'comment'

export interface LNode {
  id: number
  type: NodeType
  tag?: string
  text?: string
  props: Record<string, unknown>
  children: LNode[]
  parentNode: LNode | null
  listeners: Record<string, Function>
}

let uid = 0
let ops: string[] = []
let recording = true

/** 返回自上次 resetOps 以来记录的所有宿主操作 */
export function dumpOps(): string[] {
  return ops.slice()
}
export function resetOps(): void {
  ops = []
}
/** 暂停/恢复记录（例如只想看更新阶段的操作） */
export function setRecording(on: boolean): void {
  recording = on
}
function record(op: string): void {
  if (recording) ops.push(op)
}

/** 节点的简短描述：<div#3> / "text#5" / <!--#7--> */
export function desc(n: LNode | null | undefined): string {
  if (!n) return 'null'
  if (n.type === 'element') return `<${n.tag}#${n.id}>`
  if (n.type === 'text') return `"${n.text}"#${n.id}`
  return `<!--${n.text}#${n.id}-->`
}

function createNode(type: NodeType, extra: Partial<LNode>): LNode {
  return {
    id: ++uid,
    type,
    props: {},
    children: [],
    parentNode: null,
    listeners: {},
    ...extra,
  }
}

/** 创建一个作为挂载容器的根元素 */
export function createRoot(tag = 'root'): LNode {
  return createNode('element', { tag })
}

const nodeOps = {
  createElement(tag: string): LNode {
    const el = createNode('element', { tag })
    record(`createElement(${tag}) -> ${desc(el)}`)
    return el
  },
  createText(text: string): LNode {
    const n = createNode('text', { text })
    record(`createText(${JSON.stringify(text)}) -> ${desc(n)}`)
    return n
  },
  createComment(text: string): LNode {
    const n = createNode('comment', { text })
    record(`createComment(${JSON.stringify(text)}) -> ${desc(n)}`)
    return n
  },
  insert(child: LNode, parent: LNode, anchor: LNode | null = null): void {
    if (child.parentNode) {
      const idx = child.parentNode.children.indexOf(child)
      if (idx > -1) child.parentNode.children.splice(idx, 1)
    }
    child.parentNode = parent
    if (anchor) {
      const i = parent.children.indexOf(anchor)
      if (i === -1) throw new Error(`anchor ${desc(anchor)} 不在 ${desc(parent)} 中`)
      parent.children.splice(i, 0, child)
    } else {
      parent.children.push(child)
    }
    record(
      `insert(${desc(child)} -> ${desc(parent)}${anchor ? `, before ${desc(anchor)}` : ''})`,
    )
  },
  remove(child: LNode): void {
    const p = child.parentNode
    if (p) {
      const i = p.children.indexOf(child)
      if (i > -1) p.children.splice(i, 1)
      child.parentNode = null
    }
    record(`remove(${desc(child)})`)
  },
  setText(node: LNode, text: string): void {
    record(`setText(${desc(node)}, ${JSON.stringify(text)})`)
    node.text = text
  },
  setElementText(el: LNode, text: string): void {
    record(`setElementText(${desc(el)}, ${JSON.stringify(text)})`)
    el.children.forEach(c => (c.parentNode = null))
    el.children = text ? [createNode('text', { text, parentNode: el })] : []
  },
  parentNode(node: LNode): LNode | null {
    return node.parentNode
  },
  nextSibling(node: LNode): LNode | null {
    const p = node.parentNode
    if (!p) return null
    return p.children[p.children.indexOf(node) + 1] ?? null
  },
  querySelector(): never {
    throw new Error('logging-renderer 不支持 querySelector，请传入 createRoot() 作为容器')
  },
  setScopeId(el: LNode, id: string): void {
    el.props[id] = ''
  },
  patchProp(el: LNode, key: string, prev: unknown, next: unknown): void {
    if (/^on[A-Z]/.test(key)) {
      const evt = key.slice(2).toLowerCase()
      if (next) el.listeners[evt] = next as Function
      else delete el.listeners[evt]
    } else if (next == null) {
      delete el.props[key]
    } else {
      el.props[key] = next
    }
    record(`patchProp(${desc(el)}, ${key}: ${fmt(prev)} -> ${fmt(next)})`)
  },
}

function fmt(v: unknown): string {
  if (typeof v === 'function') return 'fn'
  if (v === undefined) return 'undefined'
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

const { render: baseRender, createApp: baseCreateApp } = createRenderer<LNode, LNode>(nodeOps)

export const render = baseRender as RootRenderFunction<LNode>
export const createApp = baseCreateApp as CreateAppFunction<LNode>
export { nodeOps }

/** 触发假 DOM 上的事件（用于演示 emit / 事件更新） */
export function triggerEvent(el: LNode, event: string, payload: unknown = {}): void {
  const fn = el.listeners[event]
  if (fn) fn(payload)
}

/** 把假 DOM 序列化成 HTML 字符串，方便肉眼核对 */
export function serialize(node: LNode, indent = 0, depth = 0): string {
  if (node.type === 'text') return pad(indent, depth) + (node.text ?? '')
  if (node.type === 'comment') return pad(indent, depth) + `<!--${node.text ?? ''}-->`
  return serializeElement(node, indent, depth)
}
export function serializeInner(node: LNode, indent = 0, depth = 0): string {
  const nl = indent ? '\n' : ''
  return node.children.map(c => serialize(c, indent, depth + 1)).join(nl)
}
function serializeElement(node: LNode, indent: number, depth: number): string {
  const props = Object.keys(node.props)
    .map(k => {
      const v = node.props[k]
      if (v == null || v === false) return ''
      if (typeof v === 'object') return ` ${k}=${JSON.stringify(JSON.stringify(v))}`
      return ` ${k}=${JSON.stringify(String(v))}`
    })
    .join('')
  const nl = indent ? '\n' : ''
  const inner = serializeInner(node, indent, depth)
  return (
    pad(indent, depth) +
    `<${node.tag}${props}>` +
    (inner ? nl + inner + nl + pad(indent, depth) : '') +
    `</${node.tag}>`
  )
}
function pad(indent: number, depth: number): string {
  return ' '.repeat(indent * depth)
}

/** 一次性渲染并返回 HTML（常用于快速验证） */
export function renderToString(vnode: VNode): string {
  const root = createRoot()
  render(vnode, root)
  return serializeInner(root)
}

/** 打印一次操作日志并清空 */
export function printOps(title = 'ops'): void {
  const list = dumpOps()
  console.log(`│      [${title}] ${list.length} 次宿主操作`)
  list.forEach((op, i) => console.log(`│        ${String(i + 1).padStart(2, ' ')}. ${op}`))
  resetOps()
}
