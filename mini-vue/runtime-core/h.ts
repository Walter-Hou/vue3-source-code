/**
 * 对应源码：packages/runtime-core/src/h.ts
 *
 * h() 是 createVNode 的「用户友好版」：根据参数个数/类型猜测调用者省略了 props 还是 children。
 * 真实源码为了类型提示写了十几个重载，这里只保留运行时判断逻辑（函数实现部分），
 * 去掉了类型重载、v-memo 相关的 setBlockTracking(-1)（因为 mini 版没有 Block 收集）。
 */
import { type VNode, type VNodeTypes, createVNode } from './vnode'

function isVNode(value: unknown): value is VNode {
  return !!value && (value as any).__v_isVNode === true
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

// 第 4 个及以后的参数只是为了让 TS 允许 h(type, props, child1, child2, ...) 这种调用方式；
// 函数体内完全不读 rest，真正的多参数处理靠下面对 arguments 对象的操作（和源码的运行时行为一致：
// 类型重载只是给调用方的提示，实现内部只认 arguments.length）。
export function h(type: VNodeTypes, propsOrChildren?: any, children?: any, ...rest: any[]): VNode {
  const l = arguments.length
  if (l === 2) {
    if (isObject(propsOrChildren) && !Array.isArray(propsOrChildren)) {
      // h('div', vnode) —— 第二个参数是单个 vnode，当作 children
      if (isVNode(propsOrChildren)) {
        return createVNode(type, null, [propsOrChildren])
      }
      // h('div', { id: 'a' }) —— 第二个参数是 props
      return createVNode(type, propsOrChildren)
    } else {
      // h('div', 'text') / h('div', [...]) —— 省略 props
      return createVNode(type, null, propsOrChildren)
    }
  } else {
    if (l > 3) {
      // h('div', {}, child1, child2, child3) —— 从第三个参数开始都是 children
      children = Array.prototype.slice.call(arguments, 2)
    } else if (l === 3 && isVNode(children)) {
      children = [children]
    }
    return createVNode(type, propsOrChildren, children)
  }
}
