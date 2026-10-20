/**
 * 对应源码：packages/reactivity/src/effect.ts
 *
 * 保留的主干：
 * - EffectFlags 位标志、Subscriber 接口（ReactiveEffect 与 mini-vue 的 ComputedRefImpl 都实现它）
 * - ReactiveEffect.run() 的 prepareDeps → fn() → cleanupDeps 三段式
 * - activeSub / shouldTrack 全局状态与 pauseTracking/enableTracking/resetTracking 栈
 * - startBatch/endBatch + batchedSub/batchedComputed 的批处理（notify 时只登记，一批结束才真正 run）
 * - isDirty / refreshComputed：版本号比对 + computed 的“脏”判断
 *
 * 为了聚焦核心机制，裁剪掉了：
 * - 源码里 Suspense/withAsyncContext 相关的 activeEffectScope 边缘分支注释
 * - dirty 兼容字段 `_dirty`（Pinia 等库的历史遗留 hack）
 * - __DEV__ 包裹（mini 版没有生产构建，onTrack/onTrigger 始终可用）
 */
import type { Link } from './dep'
import { globalVersion } from './dep'
import { activeEffectScope } from './effectScope'
import type { ComputedRefImpl } from './computed'
import type { TrackOpTypes, TriggerOpTypes } from './constants'

export type EffectScheduler = (...args: any[]) => any

export type DebuggerEvent = {
  effect: Subscriber
} & DebuggerEventExtraInfo

export type DebuggerEventExtraInfo = {
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
  newValue?: any
  oldValue?: any
}

export interface DebuggerOptions {
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
}

export interface ReactiveEffectOptions extends DebuggerOptions {
  scheduler?: EffectScheduler
  onStop?: () => void
}

export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}

/** 当前正在运行的订阅者（effect 或 computed）。track() 靠它知道“是谁在读” */
export let activeSub: Subscriber | undefined

export enum EffectFlags {
  ACTIVE = 1 << 0,
  RUNNING = 1 << 1,
  TRACKING = 1 << 2,
  NOTIFIED = 1 << 3,
  DIRTY = 1 << 4,
  ALLOW_RECURSE = 1 << 5,
  PAUSED = 1 << 6,
  EVALUATED = 1 << 7,
}

/**
 * Subscriber：会订阅若干 Dep 的东西。ReactiveEffect 和 ComputedRefImpl 都实现它，
 * 这是 3.5 把“依赖链表”抽象成双向链表节点（Link）的关键接口。
 */
export interface Subscriber extends DebuggerOptions {
  deps?: Link
  depsTail?: Link
  flags: EffectFlags
  next?: Subscriber
  /** 返回 true 表示这是一个 computed，需要让它的 dep 也 notify 一次 */
  notify(): true | void
}

const pausedQueueEffects = new WeakSet<ReactiveEffect>()

export class ReactiveEffect<T = any> implements Subscriber, ReactiveEffectOptions {
  deps?: Link = undefined
  depsTail?: Link = undefined
  flags: EffectFlags = EffectFlags.ACTIVE | EffectFlags.TRACKING
  next?: Subscriber = undefined
  cleanup?: () => void = undefined

  scheduler?: EffectScheduler = undefined
  onStop?: () => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void

  constructor(public fn: () => T) {
    if (activeEffectScope && activeEffectScope.active) {
      activeEffectScope.effects.push(this)
    }
  }

  pause(): void {
    this.flags |= EffectFlags.PAUSED
  }

  resume(): void {
    if (this.flags & EffectFlags.PAUSED) {
      this.flags &= ~EffectFlags.PAUSED
      if (pausedQueueEffects.has(this)) {
        pausedQueueEffects.delete(this)
        this.trigger()
      }
    }
  }

  /** Dep.notify() 对每个订阅者调用的入口：只负责“登记去批处理队列”，不在这里直接跑 */
  notify(): void {
    if (this.flags & EffectFlags.RUNNING && !(this.flags & EffectFlags.ALLOW_RECURSE)) {
      return
    }
    if (!(this.flags & EffectFlags.NOTIFIED)) {
      batch(this)
    }
  }

  run(): T {
    if (!(this.flags & EffectFlags.ACTIVE)) {
      return this.fn()
    }

    this.flags |= EffectFlags.RUNNING
    cleanupEffect(this)
    prepareDeps(this)
    const prevEffect = activeSub
    const prevShouldTrack = shouldTrack
    activeSub = this
    shouldTrack = true

    try {
      return this.fn()
    } finally {
      cleanupDeps(this)
      activeSub = prevEffect
      shouldTrack = prevShouldTrack
      this.flags &= ~EffectFlags.RUNNING
    }
  }

  stop(): void {
    if (this.flags & EffectFlags.ACTIVE) {
      for (let link = this.deps; link; link = link.nextDep) {
        removeSub(link)
      }
      this.deps = this.depsTail = undefined
      cleanupEffect(this)
      this.onStop && this.onStop()
      this.flags &= ~EffectFlags.ACTIVE
    }
  }

  /** Dep.trigger() 最终调用到这里（经过 batch 延迟）：有 scheduler 用 scheduler，否则按脏检查重跑 */
  trigger(): void {
    if (this.flags & EffectFlags.PAUSED) {
      pausedQueueEffects.add(this)
    } else if (this.scheduler) {
      this.scheduler()
    } else {
      this.runIfDirty()
    }
  }

  runIfDirty(): void {
    if (isDirty(this)) {
      this.run()
    }
  }

  get dirty(): boolean {
    return isDirty(this)
  }
}

let batchDepth = 0
let batchedSub: Subscriber | undefined
let batchedComputed: Subscriber | undefined

/**
 * 把 sub 挂到一条“待通知”单链表上（借用 Subscriber.next 字段），
 * 只打 NOTIFIED 标记，不立刻执行——这就是“一次 trigger 影响多个 key，effect 只跑一次”的秘密。
 */
export function batch(sub: Subscriber, isComputed = false): void {
  sub.flags |= EffectFlags.NOTIFIED
  if (isComputed) {
    sub.next = batchedComputed
    batchedComputed = sub
    return
  }
  sub.next = batchedSub
  batchedSub = sub
}

export function startBatch(): void {
  batchDepth++
}

/** batchDepth 归零时才真正触发：先把所有 computed 的 NOTIFIED 清掉，再按入队顺序跑 effect */
export function endBatch(): void {
  if (--batchDepth > 0) return

  if (batchedComputed) {
    let e: Subscriber | undefined = batchedComputed
    batchedComputed = undefined
    while (e) {
      const next: Subscriber | undefined = e.next
      e.next = undefined
      e.flags &= ~EffectFlags.NOTIFIED
      e = next
    }
  }

  let error: unknown
  while (batchedSub) {
    let e: Subscriber | undefined = batchedSub
    batchedSub = undefined
    while (e) {
      const next: Subscriber | undefined = e.next
      e.next = undefined
      e.flags &= ~EffectFlags.NOTIFIED
      if (e.flags & EffectFlags.ACTIVE) {
        try {
          ;(e as ReactiveEffect).trigger()
        } catch (err) {
          if (!error) error = err
        }
      }
      e = next
    }
  }

  if (error) throw error
}

/** run() 开始前：把所有旧 link 的 version 标成 -1，“假装还没用过” */
function prepareDeps(sub: Subscriber) {
  for (let link = sub.deps; link; link = link.nextDep) {
    link.version = -1
    link.prevActiveLink = link.dep.activeLink
    link.dep.activeLink = link
  }
}

/** run() 结束后：version 仍是 -1 的说明这轮没再访问，彻底从双向链表里摘除 */
function cleanupDeps(sub: Subscriber) {
  let head
  let tail = sub.depsTail
  let link = tail
  while (link) {
    const prev = link.prevDep
    if (link.version === -1) {
      if (link === tail) tail = prev
      removeSub(link)
      removeDep(link)
    } else {
      head = link
    }
    link.dep.activeLink = link.prevActiveLink
    link.prevActiveLink = undefined
    link = prev
  }
  sub.deps = head
  sub.depsTail = tail
}

function isDirty(sub: Subscriber): boolean {
  for (let link = sub.deps; link; link = link.nextDep) {
    if (
      link.dep.version !== link.version ||
      (link.dep.computed && (refreshComputed(link.dep.computed) || link.dep.version !== link.version))
    ) {
      return true
    }
  }
  return false
}

/** computed 专用：三层快速路径（见 ch04 README），只有真正算出不同的值才会 dep.version++ */
export function refreshComputed(computed: ComputedRefImpl): undefined {
  if (computed.flags & EffectFlags.TRACKING && !(computed.flags & EffectFlags.DIRTY)) {
    return
  }
  computed.flags &= ~EffectFlags.DIRTY

  if (computed.globalVersion === globalVersion) {
    return
  }
  computed.globalVersion = globalVersion

  if (
    computed.flags & EffectFlags.EVALUATED &&
    ((!computed.deps && !isDirty(computed)) || !isDirty(computed))
  ) {
    return
  }
  computed.flags |= EffectFlags.RUNNING

  const dep = computed.dep
  const prevSub = activeSub
  const prevShouldTrack = shouldTrack
  activeSub = computed
  shouldTrack = true

  try {
    prepareDeps(computed)
    const value = computed.fn(computed._value)
    if (dep.version === 0 || hasChanged(value, computed._value)) {
      computed.flags |= EffectFlags.EVALUATED
      computed._value = value
      dep.version++
    }
  } finally {
    activeSub = prevSub
    shouldTrack = prevShouldTrack
    cleanupDeps(computed)
    computed.flags &= ~EffectFlags.RUNNING
  }
}

function hasChanged(a: unknown, b: unknown): boolean {
  return !Object.is(a, b)
}

function removeSub(link: Link, soft = false) {
  const { dep, prevSub, nextSub } = link
  if (prevSub) {
    prevSub.nextSub = nextSub
    link.prevSub = undefined
  }
  if (nextSub) {
    nextSub.prevSub = prevSub
    link.nextSub = undefined
  }
  if (dep.subs === link) {
    dep.subs = prevSub
    if (!prevSub && dep.computed) {
      // computed 失去最后一个订阅者：没人关心它的值了，
      // 顺手把它自己也从“它依赖的那些 dep”的 subs 链表里摘掉（但只是 soft 摘除，
      // 不动 sc / map，因为 computed.deps 这条链表本身还保留着，随时可能重新被订阅）
      dep.computed.flags &= ~EffectFlags.TRACKING
      for (let l = dep.computed.deps; l; l = l.nextDep) {
        removeSub(l, true)
      }
    }
  }
  if (!soft && !--dep.sc && dep.map) {
    dep.map.delete(dep.key)
  }
}

function removeDep(link: Link) {
  const { prevDep, nextDep } = link
  if (prevDep) {
    prevDep.nextDep = nextDep
    link.prevDep = undefined
  }
  if (nextDep) {
    nextDep.prevDep = prevDep
    link.nextDep = undefined
  }
}

export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions,
): ReactiveEffectRunner<T> {
  const e = new ReactiveEffect(fn)
  if (options) Object.assign(e, options)
  try {
    e.run()
  } catch (err) {
    e.stop()
    throw err
  }
  const runner = e.run.bind(e) as ReactiveEffectRunner
  runner.effect = e
  return runner
}

export function stop(runner: ReactiveEffectRunner): void {
  runner.effect.stop()
}

export let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking(): void {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function enableTracking(): void {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking(): void {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

export function onEffectCleanup(fn: () => void): void {
  if (activeSub instanceof ReactiveEffect) {
    activeSub.cleanup = fn
  }
}

function cleanupEffect(e: ReactiveEffect) {
  const { cleanup } = e
  e.cleanup = undefined
  if (cleanup) {
    const prevSub = activeSub
    activeSub = undefined
    try {
      cleanup()
    } finally {
      activeSub = prevSub
    }
  }
}
