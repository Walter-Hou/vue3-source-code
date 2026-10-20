/**
 * 运行：pnpm vitest run mini-vue/runtime-core/vnode.test.ts
 * 对应源码：packages/runtime-core/src/vnode.ts 的行为验证
 */
import { describe, expect, it } from 'vitest'
import { h } from './h'
import {
  Comment,
  Fragment,
  ShapeFlags,
  Text,
  createVNode,
  isSameVNodeType,
  normalizeVNode,
} from './vnode'

describe('createVNode / createBaseVNode：shapeFlag 计算', () => {
  it('字符串 type -> ELEMENT，字符串 children -> 再 |= TEXT_CHILDREN', () => {
    const vnode = createVNode('div', { id: 'a' }, 'hello')
    expect(vnode.type).toBe('div')
    expect(vnode.props).toEqual({ id: 'a' })
    expect(vnode.children).toBe('hello')
    expect(vnode.shapeFlag & ShapeFlags.ELEMENT).toBeTruthy()
    expect(vnode.shapeFlag & ShapeFlags.TEXT_CHILDREN).toBeTruthy()
    expect(vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN).toBeFalsy()
  })

  it('数组 children -> |= ARRAY_CHILDREN', () => {
    const vnode = createVNode('ul', null, [createVNode('li'), createVNode('li')])
    expect(vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN).toBeTruthy()
    expect(Array.isArray(vnode.children)).toBe(true)
    expect((vnode.children as any[]).length).toBe(2)
  })

  it('对象 type（有状态组件）-> STATEFUL_COMPONENT，并且属于 COMPONENT 联合', () => {
    const Comp = { render: () => null }
    const vnode = createVNode(Comp)
    expect(vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT).toBeTruthy()
    expect(vnode.shapeFlag & ShapeFlags.COMPONENT).toBeTruthy()
    expect(vnode.shapeFlag & ShapeFlags.FUNCTIONAL_COMPONENT).toBeFalsy()
  })

  it('函数 type（函数式组件）-> FUNCTIONAL_COMPONENT', () => {
    const Func = () => null
    const vnode = createVNode(Func)
    expect(vnode.shapeFlag & ShapeFlags.FUNCTIONAL_COMPONENT).toBeTruthy()
    expect(vnode.shapeFlag & ShapeFlags.COMPONENT).toBeTruthy()
  })

  it('对象 children（非数组）-> |= SLOTS_CHILDREN（插槽场景，细节见 09 章）', () => {
    const Comp = { render: () => null }
    const vnode = createVNode(Comp, null, { default: () => [] })
    expect(vnode.shapeFlag & ShapeFlags.SLOTS_CHILDREN).toBeTruthy()
  })

  it('key 从 props 里提取，没有则为 null', () => {
    expect(createVNode('li', { key: 'a' }).key).toBe('a')
    expect(createVNode('li').key).toBeNull()
  })
})

describe('h()：参数重载解析', () => {
  it('h(type) —— 只有 type', () => {
    const vnode = h('div')
    expect(vnode.props).toBeNull()
    expect(vnode.children).toBeNull()
  })

  it('h(type, props) —— 第二参是纯对象当 props', () => {
    const vnode = h('div', { id: 'a' })
    expect(vnode.props).toEqual({ id: 'a' })
    expect(vnode.children).toBeNull()
  })

  it('h(type, children) —— 第二参是字符串/数组时省略 props', () => {
    const text = h('div', 'hello')
    expect(text.props).toBeNull()
    expect(text.children).toBe('hello')

    const arr = h('ul', [h('li'), h('li')])
    expect(arr.props).toBeNull()
    expect((arr.children as any[]).length).toBe(2)
  })

  it('h(type, vnode) —— 第二参是单个 vnode 时包成数组', () => {
    const child = h('span')
    const vnode = h('div', child)
    expect(vnode.props).toBeNull()
    expect(Array.isArray(vnode.children)).toBe(true)
    expect((vnode.children as any[])[0]).toBe(child)
  })

  it('h(type, props, children) —— 三参数完整形式', () => {
    const vnode = h('div', { class: 'a' }, 'text')
    expect(vnode.props).toEqual({ class: 'a' })
    expect(vnode.children).toBe('text')
  })

  it('h(type, props, child1, child2, ...) —— 超过 3 个参数时从第三个开始都是 children', () => {
    const vnode = h('div', null, h('span'), h('span'), 'text')
    expect(Array.isArray(vnode.children)).toBe(true)
    expect((vnode.children as any[]).length).toBe(3)
  })

  it('h(type, props, singleVNode) —— 第三参是单个 vnode 时也要包成数组', () => {
    const child = h('span')
    const vnode = h('div', { id: 'a' }, child)
    expect((vnode.children as any[])[0]).toBe(child)
  })
})

describe('normalizeVNode：patch 前的统一转换', () => {
  it('null / boolean -> Comment 占位节点', () => {
    expect(normalizeVNode(null).type).toBe(Comment)
    expect(normalizeVNode(undefined).type).toBe(Comment)
    expect(normalizeVNode(true).type).toBe(Comment)
    expect(normalizeVNode(false).type).toBe(Comment)
  })

  it('字符串/数字 -> Text vnode，内容转成字符串', () => {
    const s = normalizeVNode('hi')
    expect(s.type).toBe(Text)
    expect(s.children).toBe('hi')

    const n = normalizeVNode(42)
    expect(n.type).toBe(Text)
    expect(n.children).toBe('42')
  })

  it('数组 -> 包一层 Fragment', () => {
    const vnode = normalizeVNode([h('li'), h('li')])
    expect(vnode.type).toBe(Fragment)
    expect((vnode.children as any[]).length).toBe(2)
  })

  it('已是 vnode 且未挂载（el === null）-> 原样返回', () => {
    const original = h('div')
    const normalized = normalizeVNode(original)
    expect(normalized).toBe(original)
  })

  it('已是 vnode 且已挂载（el !== null）-> 克隆一份新的，避免共享 el', () => {
    const original = h('div')
    original.el = { tag: 'div' } // 模拟已挂载
    const normalized = normalizeVNode(original)
    expect(normalized).not.toBe(original)
    expect(normalized.type).toBe(original.type)
    expect(normalized.el).toBeNull() // 新克隆出来的还没挂载
  })
})

describe('isSameVNodeType：diff 时是否可以复用节点', () => {
  it('type 和 key 都相同 -> true', () => {
    const n1 = h('div', { key: 'a' })
    const n2 = h('div', { key: 'a' })
    expect(isSameVNodeType(n1, n2)).toBe(true)
  })

  it('type 不同 -> false', () => {
    expect(isSameVNodeType(h('div'), h('span'))).toBe(false)
  })

  it('key 不同 -> false（即使 type 相同）', () => {
    const n1 = h('div', { key: 'a' })
    const n2 = h('div', { key: 'b' })
    expect(isSameVNodeType(n1, n2)).toBe(false)
  })
})
