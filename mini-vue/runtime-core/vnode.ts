/**
 * 对应源码：packages/runtime-core/src/vnode.ts（+ packages/shared/src/shapeFlags.ts）
 *
 * 只保留主干逻辑：
 *   - ShapeFlags 位标记
 *   - Text / Comment / Fragment 三个特殊类型
 *   - createVNode -> createBaseVNode：根据 type 计算 shapeFlag
 *   - normalizeChildren：根据 children 的运行时类型再 |= 一次 shapeFlag
 *   - normalizeVNode：patch 子节点前的统一转换（null/boolean/数组/字符串/vnode）
 *   - isSameVNodeType：diff 时判断是否可以复用的依据（留给 07 章的 diff.ts 使用）
 * 去掉的内容：Static/Teleport/Suspense、Block 收集（openBlock/closeBlock）、
 * mergeProps/cloneVNode 的 ref 合并与 FULL_PROPS、__DEV__ 警告、兼容层。
 */

// ---------------------------------------------------------------------------
// ShapeFlags —— 对应 packages/shared/src/shapeFlags.ts
// 用位掩码描述「这个 vnode 是什么类型 + children 是什么形态」，
// 这样 patch 时一次 `shapeFlag & ShapeFlags.XXX` 就能做类型分派，
// 比 `typeof` / `instanceof` 一堆 if-else 快，且可以用 `|=` 同时表达多个事实
// （例如“是个有状态组件”和“children 是插槽对象”可以共存在同一个数字上）。
export enum ShapeFlags {
  ELEMENT = 1,
  FUNCTIONAL_COMPONENT = 1 << 1,
  STATEFUL_COMPONENT = 1 << 2,
  TEXT_CHILDREN = 1 << 3,
  ARRAY_CHILDREN = 1 << 4,
  SLOTS_CHILDREN = 1 << 5,
  COMPONENT = ShapeFlags.STATEFUL_COMPONENT | ShapeFlags.FUNCTIONAL_COMPONENT,
}

// ---------------------------------------------------------------------------
// 特殊 vnode 类型。源码里用 Symbol.for(...) 是为了跨 Vue 副本也能 === 比较，
// mini 版不需要考虑多副本问题，用普通 Symbol 即可。
export const Text = Symbol('Text')
export const Comment = Symbol('Comment')
export const Fragment = Symbol('Fragment') as any as { __isFragment: true }

export type VNodeTypes = string | object | Function | typeof Text | typeof Comment | typeof Fragment

export type VNodeChild = VNode | string | number | boolean | null | undefined | void | VNodeChild[]
export type VNodeArrayChildren = Array<VNodeChild>

export interface VNode {
  __v_isVNode: true
  type: VNodeTypes
  props: Record<string, any> | null
  key: string | number | symbol | null
  children: VNode[] | string | null
  component: any | null // mini 阶段先用 any，具体类型见 06 章的 ComponentInternalInstance
  el: any | null // 挂载后指向真实宿主节点
  anchor: any | null // Fragment 专用：标记自己在宿主树中的结束位置
  shapeFlag: number
  patchFlag: number
}

function isVNode(value: unknown): value is VNode {
  return !!value && (value as any).__v_isVNode === true
}

export function isSameVNodeType(n1: VNode, n2: VNode): boolean {
  // diff 的起点：type 和 key 都相同才认为是"同一个节点"，可以 patch 而不是 unmount+mount。
  // 07 章的 diff.ts 会在 patchKeyedChildren 里反复调用它。
  return n1.type === n2.type && n1.key === n2.key
}

function normalizeKey(props: Record<string, any> | null): VNode['key'] {
  return props && props.key != null ? props.key : null
}

/**
 * 对应源码 createBaseVNode。真实源码里还区分了"编译产物"（needFullChildrenNormalization
 * = false，children 只可能是 string/array，直接按类型 |= 一次 shapeFlag）和"手写 h()"
 * （需要 normalizeChildren 处理插槽对象等更复杂的输入）。mini 版统一走 normalizeChildren，
 * 逻辑上等价但少了这个性能分支。
 */
export function createBaseVNode(
  type: VNodeTypes,
  props: Record<string, any> | null = null,
  children: unknown = null,
  shapeFlag: number = typeof type === 'string' ? ShapeFlags.ELEMENT : 0,
): VNode {
  const vnode: VNode = {
    __v_isVNode: true,
    type,
    props,
    key: normalizeKey(props),
    children: null,
    component: null,
    el: null,
    anchor: null,
    shapeFlag,
    patchFlag: 0,
  }
  normalizeChildren(vnode, children)
  return vnode
}

/**
 * 对应源码 createVNode / _createVNode：根据 type 的运行时形态算出 shapeFlag。
 * 省略了：已是 vnode 时的 cloneVNode 分支、class 组件、Suspense/Teleport、
 * reactive 对象当 type 的开发期警告、Block 收集。
 */
export function createVNode(
  type: VNodeTypes,
  props: Record<string, any> | null = null,
  children: unknown = null,
): VNode {
  if (isVNode(type)) {
    // <component :is="someVNode"/> 这种写法：mini 版只做最简单的拷贝
    return createBaseVNode(type.type, { ...type.props, ...props }, children ?? type.children, type.shapeFlag)
  }

  const shapeFlag =
    typeof type === 'string'
      ? ShapeFlags.ELEMENT
      : typeof type === 'function'
        ? ShapeFlags.FUNCTIONAL_COMPONENT
        : typeof type === 'object' && type !== null
          ? ShapeFlags.STATEFUL_COMPONENT
          : 0

  return createBaseVNode(type, props, children, shapeFlag)
}

/**
 * 对应源码 normalizeChildren：只负责"根据 children 的运行时类型再 |= 一次 shapeFlag"，
 * 不负责把 children 里的每一项转成 vnode（那是 normalizeVNode 在 patch 时做的事）。
 */
export function normalizeChildren(vnode: VNode, children: unknown): void {
  let type = 0
  if (children == null) {
    children = null
  } else if (Array.isArray(children)) {
    type = ShapeFlags.ARRAY_CHILDREN
  } else if (typeof children === 'object') {
    // mini 版不区分插槽函数/对象插槽，统一当作 SLOTS_CHILDREN 标记，
    // 具体的插槽收集逻辑见 09 章
    type = ShapeFlags.SLOTS_CHILDREN
  } else {
    children = String(children)
    type = ShapeFlags.TEXT_CHILDREN
  }
  vnode.children = children as VNode['children']
  vnode.shapeFlag |= type
}

/**
 * 对应源码 cloneIfMounted：已挂载过的 vnode（el !== null）如果被复用（例如 v-for
 * 中引用了同一个 vnode 对象），需要克隆一份新的，避免多个位置共享同一个 vnode
 * 导致 el 等挂载信息互相覆盖。
 */
function cloneIfMounted(child: VNode): VNode {
  return child.el === null ? child : createBaseVNode(child.type, child.props, child.children, child.shapeFlag)
}

/**
 * 对应源码 normalizeVNode：patch 前的统一转换入口。
 *   - null / boolean -> 空占位 Comment（例如 v-if 为 false 时渲染一个注释节点占位，
 *     这样下次条件变化时还有一个"锚点"可以 patch 成真正的内容）
 *   - 数组 -> 包一层 Fragment（多根节点 / v-for 的产物）
 *   - 已是 vnode -> cloneIfMounted
 *   - 其余（字符串/数字）-> Text vnode
 */
export function normalizeVNode(child: VNodeChild): VNode {
  if (child == null || typeof child === 'boolean') {
    return createVNode(Comment)
  } else if (Array.isArray(child)) {
    return createVNode(Fragment, null, child.slice())
  } else if (isVNode(child)) {
    return cloneIfMounted(child)
  } else {
    return createVNode(Text, null, String(child))
  }
}
