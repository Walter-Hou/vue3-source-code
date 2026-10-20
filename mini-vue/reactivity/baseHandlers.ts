/**
 * 对应源码：packages/reactivity/src/baseHandlers.ts
 *
 * 保留：BaseReactiveHandler.get 的完整判断链（ReactiveFlags 拦截 → 数组 instrumentation →
 * Reflect.get → Symbol/不可追踪 key 跳过 → track → ref 自动解包 → 嵌套对象懒代理 → readonly 分支）；
 * MutableReactiveHandler 的 set（hasChanged、ADD/SET 判断、readonly ref 赋值）、
 * deleteProperty、has、ownKeys（数组走 'length'，普通对象走 ITERATE_KEY）。
 *
 * 裁剪：builtInSymbols 白名单（跳过 Symbol.iterator 等内置 symbol 的 track，mini 里简化成
 * “所有 symbol 都不 track”）、hasOwnProperty 的特殊处理、shallow 分支的完整判断。
 */
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './constants'
import { ITERATE_KEY, track, trigger } from './dep'
import { isRef } from './ref'
import {
  type Target,
  isReadonly as checkIsReadonly,
  isShallow as checkIsShallow,
  reactive,
  readonly,
  reactiveMap,
  readonlyMap,
  shallowReactiveMap,
  shallowReadonlyMap,
  toRaw,
} from './reactive'
import { arrayInstrumentations } from './arrayInstrumentations'

function hasChanged(a: unknown, b: unknown): boolean {
  return !Object.is(a, b)
}
function isIntegerKey(key: unknown): boolean {
  return typeof key === 'string' && key !== 'NaN' && key[0] !== '-' && String(parseInt(key, 10)) === key
}

class BaseReactiveHandler implements ProxyHandler<Target> {
  constructor(
    protected readonly _isReadonly = false,
    protected readonly _isShallow = false,
  ) {}

  get(target: Target, key: string | symbol, receiver: object): any {
    const isReadonlyFlag = this._isReadonly
    const isShallowFlag = this._isShallow

    if (key === ReactiveFlags.IS_REACTIVE) return !isReadonlyFlag
    if (key === ReactiveFlags.IS_READONLY) return isReadonlyFlag
    if (key === ReactiveFlags.IS_SHALLOW) return isShallowFlag
    if (key === ReactiveFlags.RAW) {
      if (
        receiver ===
          (isReadonlyFlag
            ? isShallowFlag
              ? shallowReadonlyMap
              : readonlyMap
            : isShallowFlag
              ? shallowReactiveMap
              : reactiveMap
          ).get(target) ||
        Object.getPrototypeOf(target) === Object.getPrototypeOf(receiver)
      ) {
        return target
      }
      return undefined
    }

    const targetIsArray = Array.isArray(target)
    if (!isReadonlyFlag && targetIsArray && Object.prototype.hasOwnProperty.call(arrayInstrumentations, key)) {
      return arrayInstrumentations[key]
    }

    const res = Reflect.get(target, key, isRef(target) ? target : receiver)

    // Symbol 一律不 track（真实源码只跳过 Symbol.xxx 这些内置 symbol，mini 做了简化）
    if (typeof key === 'symbol') return res

    if (!isReadonlyFlag) {
      track(target, TrackOpTypes.GET, key)
    }

    if (isShallowFlag) return res

    if (isRef(res)) {
      // ref 自动解包——数组的整数索引除外（数组里存 ref 本身就是“数组的一项是 ref”，不解包）
      const value = targetIsArray && isIntegerKey(key) ? res : (res as any).value
      return isReadonlyFlag && typeof value === 'object' && value !== null ? readonly(value) : value
    }

    if (typeof res === 'object' && res !== null) {
      // 懒代理：只有真正被访问到的嵌套对象才会变成 reactive/readonly
      return isReadonlyFlag ? readonly(res) : reactive(res)
    }

    return res
  }
}

class MutableReactiveHandler extends BaseReactiveHandler {
  constructor(isShallow = false) {
    super(false, isShallow)
  }

  set(target: Record<string | symbol, unknown>, key: string | symbol, value: unknown, receiver: object): boolean {
    let oldValue = target[key]
    const isArrayWithIntegerKey = Array.isArray(target) && isIntegerKey(key)

    if (!this._isShallow) {
      if (!checkIsShallow(value) && !checkIsReadonly(value)) {
        oldValue = toRaw(oldValue)
        value = toRaw(value)
      }
      if (!isArrayWithIntegerKey && isRef(oldValue) && !isRef(value)) {
        // 给“reactive 对象里的某个 ref 属性”直接赋新值时，写到 ref.value 上，而不是替换掉这个 ref
        ;(oldValue as any).value = value
        return true
      }
    }

    const hadKey = isArrayWithIntegerKey ? Number(key) < (target as any).length : Object.prototype.hasOwnProperty.call(target, key)
    const result = Reflect.set(target, key, value, isRef(target) ? target : receiver)

    if (target === toRaw(receiver)) {
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }

  deleteProperty(target: Record<string | symbol, unknown>, key: string | symbol): boolean {
    const hadKey = Object.prototype.hasOwnProperty.call(target, key)
    const oldValue = target[key]
    const result = Reflect.deleteProperty(target, key)
    if (result && hadKey) {
      trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
    }
    return result
  }

  has(target: Record<string | symbol, unknown>, key: string | symbol): boolean {
    const result = Reflect.has(target, key)
    if (typeof key !== 'symbol') track(target, TrackOpTypes.HAS, key)
    return result
  }

  ownKeys(target: Record<string | symbol, unknown>): (string | symbol)[] {
    track(target, TrackOpTypes.ITERATE, Array.isArray(target) ? 'length' : ITERATE_KEY)
    return Reflect.ownKeys(target)
  }
}

class ReadonlyReactiveHandler extends BaseReactiveHandler {
  constructor(isShallow = false) {
    super(true, isShallow)
  }
  set(): boolean {
    return true
  }
  deleteProperty(): boolean {
    return true
  }
}

export const mutableHandlers: ProxyHandler<object> = new MutableReactiveHandler()
export const readonlyHandlers: ProxyHandler<object> = new ReadonlyReactiveHandler()
export const shallowReactiveHandlers: ProxyHandler<object> = new MutableReactiveHandler(true)
export const shallowReadonlyHandlers: ProxyHandler<object> = new ReadonlyReactiveHandler(true)
