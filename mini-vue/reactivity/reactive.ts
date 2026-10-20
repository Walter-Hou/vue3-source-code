/**
 * 对应源码：packages/reactivity/src/reactive.ts
 *
 * 保留：createReactiveObject 的完整判断顺序（这是本章最值得精读的一段）、
 * 四张 proxyMap 缓存、targetTypeMap（COMMON/COLLECTION/INVALID）、
 * ReactiveFlags 相关的 isReactive/isReadonly/isShallow/isProxy/toRaw/markRaw。
 *
 * 裁剪：Map/Set/WeakMap/WeakSet 的 collectionHandlers 完全省略（见本章 README「与源码的差异」），
 * 所以这里的 targetTypeMap 永远不会走到 COLLECTION 分支，只是保留判断逻辑让读者看到入口是怎么分流的。
 */
import { ReactiveFlags } from './constants'
import { mutableHandlers, readonlyHandlers, shallowReactiveHandlers, shallowReadonlyHandlers } from './baseHandlers'

export interface Target {
  [ReactiveFlags.SKIP]?: boolean
  [ReactiveFlags.IS_REACTIVE]?: boolean
  [ReactiveFlags.IS_READONLY]?: boolean
  [ReactiveFlags.IS_SHALLOW]?: boolean
  [ReactiveFlags.RAW]?: any
}

export const reactiveMap: WeakMap<Target, any> = new WeakMap()
export const shallowReactiveMap: WeakMap<Target, any> = new WeakMap()
export const readonlyMap: WeakMap<Target, any> = new WeakMap()
export const shallowReadonlyMap: WeakMap<Target, any> = new WeakMap()

enum TargetType {
  INVALID = 0,
  COMMON = 1,
  COLLECTION = 2,
}

function targetTypeMap(rawType: string): TargetType {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      // mini 版没有实现 collectionHandlers，真走到这里会在 createReactiveObject 里
      // 被当成 COLLECTION 使用 baseHandlers（不对），所以下面直接改用 toRawType 兜底：
      // 为了不误导读者，这里仍然如实返回 COLLECTION，createReactiveObject 会原样返回 target。
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

function toRawType(value: unknown): string {
  return Object.prototype.toString.call(value).slice(8, -1)
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

export function reactive<T extends object>(target: T): T {
  if (isReadonly(target)) return target as T
  return createReactiveObject(target, false, mutableHandlers, reactiveMap)
}

export function shallowReactive<T extends object>(target: T): T {
  return createReactiveObject(target, false, shallowReactiveHandlers, shallowReactiveMap)
}

export function readonly<T extends object>(target: T): T {
  return createReactiveObject(target, true, readonlyHandlers, readonlyMap)
}

export function shallowReadonly<T extends object>(target: T): T {
  return createReactiveObject(target, true, shallowReadonlyHandlers, shallowReadonlyMap)
}

function createReactiveObject(
  target: Target,
  isReadonlyFlag: boolean,
  baseHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>,
) {
  if (!isObject(target)) return target

  // target 已经是一个 Proxy：直接返回它自己，除非是对 reactive 对象再调用 readonly
  if (target[ReactiveFlags.RAW] && !(isReadonlyFlag && target[ReactiveFlags.IS_REACTIVE])) {
    return target
  }

  // markRaw 标记过，或者对象已被冻结/不可扩展：原样返回，不做代理
  if (target[ReactiveFlags.SKIP] || !Object.isExtensible(target)) {
    return target
  }

  // 同一个 target 只代理一次，命中缓存直接复用——这是“懒代理”的另一半：不仅懒，而且幂等
  const existingProxy = proxyMap.get(target)
  if (existingProxy) return existingProxy

  const targetType = targetTypeMap(toRawType(target))
  if (targetType === TargetType.INVALID || targetType === TargetType.COLLECTION) {
    // mini 版未实现 collectionHandlers，Map/Set 原样返回（不可代理）
    return target
  }

  const proxy = new Proxy(target, baseHandlers)
  proxyMap.set(target, proxy)
  return proxy
}

export function isReactive(value: unknown): boolean {
  if (isReadonly(value)) return isReactive((value as Target)[ReactiveFlags.RAW])
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

export function isReadonly(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}

export function isShallow(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_SHALLOW])
}

export function isProxy(value: unknown): boolean {
  return value ? !!(value as Target)[ReactiveFlags.RAW] : false
}

export function toRaw<T>(observed: T): T {
  const raw = observed && (observed as Target)[ReactiveFlags.RAW]
  return raw ? toRaw(raw) : observed
}

export function markRaw<T extends object>(value: T): T {
  if (!Object.prototype.hasOwnProperty.call(value, ReactiveFlags.SKIP) && Object.isExtensible(value)) {
    Object.defineProperty(value, ReactiveFlags.SKIP, { value: true, configurable: true })
  }
  return value
}

export const toReactive = <T>(value: T): T => (isObject(value) ? (reactive(value as object) as T) : value)
export const toReadonly = <T>(value: T): T => (isObject(value) ? (readonly(value as object) as T) : value)
