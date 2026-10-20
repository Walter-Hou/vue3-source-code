/**
 * 对应源码：packages/reactivity/src/dep.ts
 *
 * 3.5 重构的核心：用 Link（双向链表节点）+ version（版本号）替代 3.4 及以前的
 * `Dep.subs: Set<ReactiveEffect>` + `Watcher` 两套 Set 做 cleanup 的方案。
 *
 * 一个 Link 同时挂在两条链表上：
 * - dep 的 subs 链表（这个 key 被谁订阅了，尾插法，notify 时倒序遍历）
 * - sub 的 deps 链表（这个 effect/computed 依赖了哪些 key，按访问顺序）
 *
 * 裁剪：去掉了 DEV only 的 subsHead（用于保证 onTrigger 按原始顺序触发，非核心机制）。
 */
import {
  EffectFlags,
  type Subscriber,
  activeSub,
  endBatch,
  shouldTrack,
  startBatch,
} from './effect'
import type { ComputedRefImpl } from './computed'
import type { TrackOpTypes, TriggerOpTypes } from './constants'

/** 每次响应式变更都会 ++，给 computed 一条“全局有没有任何变化”的快速判断路径 */
export let globalVersion = 0

export class Link {
  /**
   * - 每次 effect 运行前，所有旧 link 的 version 先被置为 -1
   * - 运行过程中，被访问到的 link 会把 version 同步成 dep.version
   * - 运行结束后，version 仍是 -1 的 link 说明这轮没用到，清理掉
   */
  version: number

  nextDep?: Link
  prevDep?: Link
  nextSub?: Link
  prevSub?: Link
  prevActiveLink?: Link

  constructor(
    public sub: Subscriber,
    public dep: Dep,
  ) {
    this.version = dep.version
  }
}

export class Dep {
  version = 0
  /** 当前 activeSub 对应的 link（同一个 effect 在一轮运行里重复访问同一个 key 时直接复用） */
  activeLink?: Link = undefined
  /** 订阅者链表的尾节点（track 时尾插，notify 时从尾到头遍历） */
  subs?: Link = undefined
  /** 这个 dep 存在哪个 target 的哪个 key 上，用于“最后一个订阅者离开时把自己从 Map 里删掉” */
  map?: Map<unknown, Dep> = undefined
  key?: unknown = undefined
  /** 订阅者计数，归零且挂在 map 上就自毁 */
  sc = 0

  constructor(public computed?: ComputedRefImpl | undefined) {}

  track(debugInfo?: DebugInfo): Link | undefined {
    if (!activeSub || !shouldTrack || activeSub === this.computed) {
      return
    }

    let link = this.activeLink
    if (link === undefined || link.sub !== activeSub) {
      link = this.activeLink = new Link(activeSub, this)

      if (!activeSub.deps) {
        activeSub.deps = activeSub.depsTail = link
      } else {
        link.prevDep = activeSub.depsTail
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link
      }
      addSub(link)
    } else if (link.version === -1) {
      // 本轮之前已经用过这个 dep（link 还在），只需要同步 version，
      // 并把它挪到 sub 的 deps 尾部，让依赖顺序和这次的访问顺序一致
      link.version = this.version
      if (link.nextDep) {
        const next = link.nextDep
        next.prevDep = link.prevDep
        if (link.prevDep) link.prevDep.nextDep = next
        link.prevDep = activeSub.depsTail
        link.nextDep = undefined
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link
        if (activeSub.deps === link) activeSub.deps = next
      }
    }

    if (activeSub.onTrack) {
      activeSub.onTrack({ effect: activeSub, ...(debugInfo as DebugInfo) })
    }
    return link
  }

  trigger(debugInfo?: DebugInfo): void {
    this.version++
    globalVersion++
    this.notify(debugInfo)
  }

  notify(debugInfo?: DebugInfo): void {
    startBatch()
    try {
      for (let link = this.subs; link; link = link.prevSub) {
        if (link.sub.onTrigger) {
          link.sub.onTrigger({ effect: link.sub, ...(debugInfo as DebugInfo) })
        }
      }
      for (let link = this.subs; link; link = link.prevSub) {
        if (link.sub.notify()) {
          // notify() 返回 true 说明这是 computed，由这里代为 notify 它对外的 dep，
          // 避免在 ComputedRefImpl.notify 内部直接递归、加深调用栈
          ;(link.sub as ComputedRefImpl).dep.notify()
        }
      }
    } finally {
      endBatch()
    }
  }
}

function addSub(link: Link) {
  link.dep.sc++
  if (link.sub.flags & EffectFlags.TRACKING) {
    const computed = link.dep.computed
    if (computed && !link.dep.subs) {
      // computed 第一次有订阅者：把 TRACKING | DIRTY 打开，并把它自己的依赖也“传染”式订阅上
      computed.flags |= EffectFlags.TRACKING | EffectFlags.DIRTY
      for (let l = computed.deps; l; l = l.nextDep) {
        addSub(l)
      }
    }
    const currentTail = link.dep.subs
    if (currentTail !== link) {
      link.prevSub = currentTail
      if (currentTail) currentTail.nextSub = link
    }
    link.dep.subs = link
  }
}

type KeyToDepMap = Map<unknown, Dep>
export const targetMap: WeakMap<object, KeyToDepMap> = new WeakMap()

export const ITERATE_KEY: unique symbol = Symbol('iterate')
export const MAP_KEY_ITERATE_KEY: unique symbol = Symbol('Map keys iterate')
export const ARRAY_ITERATE_KEY: unique symbol = Symbol('Array iterate')

interface DebugInfo {
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
  newValue?: any
  oldValue?: any
}

export function track(target: object, type: TrackOpTypes, key: unknown): void {
  if (shouldTrack && activeSub) {
    let depsMap = targetMap.get(target)
    if (!depsMap) targetMap.set(target, (depsMap = new Map()))
    let dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = new Dep()))
      dep.map = depsMap
      dep.key = key
    }
    dep.track({ target, type, key })
  }
}

export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
): void {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    globalVersion++
    return
  }

  const run = (dep: Dep | undefined) => {
    if (dep) dep.trigger({ target, type, key, newValue, oldValue })
  }

  startBatch()

  if (type === 'clear') {
    depsMap.forEach(run)
  } else {
    const targetIsArray = Array.isArray(target)
    const isArrayIndex = targetIsArray && isIntegerKey(key)

    if (targetIsArray && key === 'length') {
      const newLength = Number(newValue)
      depsMap.forEach((dep, rawDepKey) => {
        // Map<unknown, Dep>.forEach 给出的 key 类型是 unknown；先转成 PropertyKey，
        // TS 才能靠 typeof 把 symbol 排除掉，剩下 string | number 去跟 newLength 比较
        // （数组索引在这里永远是字符串形式的 key，Number() 转换和源码里依赖 JS 的
        // 字符串/数字隐式比较是同一件事，只是显式写出来更符合严格模式）。
        const depKey = rawDepKey as PropertyKey
        if (depKey === 'length' || depKey === ARRAY_ITERATE_KEY || (typeof depKey !== 'symbol' && Number(depKey) >= newLength)) {
          run(dep)
        }
      })
    } else {
      if (key !== undefined || depsMap.has(undefined)) {
        run(depsMap.get(key))
      }
      if (isArrayIndex) {
        run(depsMap.get(ARRAY_ITERATE_KEY))
      }
      switch (type) {
        case 'add':
          if (!targetIsArray) {
            run(depsMap.get(ITERATE_KEY))
            if (target instanceof Map) run(depsMap.get(MAP_KEY_ITERATE_KEY))
          } else if (isArrayIndex) {
            run(depsMap.get('length'))
          }
          break
        case 'delete':
          if (!targetIsArray) {
            run(depsMap.get(ITERATE_KEY))
            if (target instanceof Map) run(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
          break
        case 'set':
          if (target instanceof Map) run(depsMap.get(ITERATE_KEY))
          break
      }
    }
  }

  endBatch()
}

function isIntegerKey(key: unknown): boolean {
  return typeof key === 'string' && key !== 'NaN' && key[0] !== '-' && String(parseInt(key, 10)) === key
}

export function getDepFromReactive(object: any, key: unknown): Dep | undefined {
  return targetMap.get(object)?.get(key)
}
