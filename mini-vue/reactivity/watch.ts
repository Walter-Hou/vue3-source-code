/**
 * 对应源码：packages/reactivity/src/watch.ts 的 watch()（3.5 把它从 runtime-core 下沉到了
 * @vue/reactivity，这样 reactivity 包就能独立提供 watch 能力，不必依赖组件系统）。
 *
 * 保留：getter 规范化（ref/reactive/函数/数组多源）、deep 的 traverse、
 * `new ReactiveEffect(getter)` + `effect.scheduler = job`、INITIAL_WATCHER_VALUE、
 * immediate/once、onWatcherCleanup 的 cleanupMap、WatchHandle 的 pause/resume/stop。
 *
 * 裁剪：runtime-core/src/apiWatch.ts 的 flush 调度分层（pre/post/sync 对接组件调度器，
 * 见 ch04 README「与 apiWatch.ts 的关系」）、SSR 分支、call 选项的统一错误处理包装
 * （mini 版直接让异常冒泡，不做 try/catch 包装）。
 */
import { ReactiveFlags } from './constants'
import { EffectFlags, ReactiveEffect, pauseTracking, resetTracking } from './effect'
import { isReactive, isShallow } from './reactive'
import { type Ref, isRef } from './ref'

export type WatchSource<T = any> = Ref<T> | (() => T)
export type WatchCallback<V = any, OV = any> = (value: V, oldValue: OV, onCleanup: OnCleanup) => any
export type OnCleanup = (cleanupFn: () => void) => void

export interface WatchOptions {
  immediate?: boolean
  deep?: boolean | number
  once?: boolean
}

export interface WatchHandle {
  (): void
  pause: () => void
  resume: () => void
  stop: () => void
}

const INITIAL_WATCHER_VALUE = {}
const cleanupMap = new WeakMap<ReactiveEffect, (() => void)[]>()
let activeWatcher: ReactiveEffect | undefined

export function onWatcherCleanup(cleanupFn: () => void, owner = activeWatcher): void {
  if (owner) {
    let cleanups = cleanupMap.get(owner)
    if (!cleanups) cleanupMap.set(owner, (cleanups = []))
    cleanups.push(cleanupFn)
  }
}

export function watch(
  source: WatchSource | WatchSource[] | object,
  cb: WatchCallback | null,
  options: WatchOptions = {},
): WatchHandle {
  const { immediate, deep, once } = options

  // 直接 watch 一个 reactive 对象时，“不传 deep”默认就是深度遍历——这是容易被忽视的一条规则：
  // 只有显式传 deep:false/0，或者源本身是 shallowReactive，才会退化成只看根层一级。
  const reactiveGetter = (src: object) => {
    if (deep) return src // deep 为 true 时，真正的 traverse 在外层 wrappedGetter 里做
    if (isShallow(src) || deep === false || deep === 0) return traverse(src, 1)
    return traverse(src)
  }

  let getter: () => any
  let forceTrigger = false
  let isMultiSource = false

  if (isRef(source)) {
    getter = () => source.value
    forceTrigger = isShallow(source)
  } else if (isReactive(source)) {
    getter = () => reactiveGetter(source)
    forceTrigger = true
  } else if (Array.isArray(source)) {
    isMultiSource = true
    forceTrigger = source.some(s => isReactive(s) || isShallow(s))
    getter = () =>
      source.map(s => (isRef(s) ? s.value : isReactive(s) ? reactiveGetter(s) : typeof s === 'function' ? (s as Function)() : s))
  } else if (typeof source === 'function') {
    if (cb) {
      getter = source as () => any
    } else {
      // watchEffect：没有 cb，getter 本身就是副作用函数，onCleanup 作为参数传入
      getter = () => {
        if (cleanup) {
          pauseTracking()
          try {
            cleanup()
          } finally {
            resetTracking()
          }
        }
        const prev = activeWatcher
        activeWatcher = effect
        try {
          return (source as (onCleanup: OnCleanup) => void)(boundCleanup)
        } finally {
          activeWatcher = prev
        }
      }
    }
  } else {
    getter = () => undefined
  }

  if (cb && deep) {
    const baseGetter = getter
    const depth = deep === true ? Infinity : deep
    getter = () => traverse(baseGetter(), depth)
  }

  const watchHandle: WatchHandle = (() => {
    effect.stop()
  }) as WatchHandle

  let _cb = cb
  if (once && _cb) {
    const rawCb = _cb
    _cb = (...args) => {
      try {
        return rawCb(...(args as [any, any, OnCleanup]))
      } finally {
        watchHandle()
      }
    }
  }

  let oldValue: any = isMultiSource ? new Array((source as unknown[]).length).fill(INITIAL_WATCHER_VALUE) : INITIAL_WATCHER_VALUE

  const job = (immediateFirstRun?: boolean) => {
    if (!(effect.flags & EffectFlags.ACTIVE) || (!effect.dirty && !immediateFirstRun)) return
    if (_cb) {
      const newValue = effect.run()
      if (
        immediateFirstRun ||
        deep ||
        forceTrigger ||
        (isMultiSource ? (newValue as any[]).some((v, i) => hasChanged(v, oldValue[i])) : hasChanged(newValue, oldValue))
      ) {
        const currentWatcher = activeWatcher
        pauseTracking()
        try {
          if (cleanup) cleanup()
          activeWatcher = effect
          const args: [any, any, OnCleanup] = [
            newValue,
            oldValue === INITIAL_WATCHER_VALUE ? undefined : oldValue,
            boundCleanup,
          ]
          oldValue = newValue
          _cb(...args)
        } finally {
          activeWatcher = currentWatcher
          resetTracking()
        }
      }
    } else {
      effect.run()
    }
  }

  const effect = new ReactiveEffect(getter)
  effect.scheduler = () => job()
  const boundCleanup: OnCleanup = fn => onWatcherCleanup(fn, effect)
  let cleanup: (() => void) | undefined
  cleanup = effect.onStop = () => {
    const cleanups = cleanupMap.get(effect)
    if (cleanups) {
      for (const fn of cleanups) fn()
      cleanupMap.delete(effect)
    }
  }

  if (_cb) {
    if (immediate) job(true)
    else oldValue = effect.run()
  } else {
    effect.run()
  }

  watchHandle.pause = effect.pause.bind(effect)
  watchHandle.resume = effect.resume.bind(effect)
  watchHandle.stop = watchHandle

  return watchHandle
}

export function traverse(value: unknown, depth = Infinity, seen = new Map<unknown, number>()): unknown {
  if (depth <= 0 || typeof value !== 'object' || value === null || (value as any)[ReactiveFlags.SKIP]) {
    return value
  }
  if ((seen.get(value) || 0) >= depth) return value
  seen.set(value, depth)
  depth--
  if (isRef(value)) {
    traverse(value.value, depth, seen)
  } else if (Array.isArray(value)) {
    for (const item of value) traverse(item, depth, seen)
  } else if (value instanceof Map || value instanceof Set) {
    ;(value as Map<unknown, unknown>).forEach(v => traverse(v, depth, seen))
  } else {
    for (const key in value) traverse((value as any)[key], depth, seen)
  }
  return value
}

function hasChanged(a: unknown, b: unknown): boolean {
  return !Object.is(a, b)
}
