/**
 * 对应源码：packages/reactivity/src/ref.ts
 *
 * 保留：RefImpl（_value/_rawValue/dep/__v_isRef/__v_isShallow）、ref/shallowRef 的创建、
 * triggerRef、customRef（CustomRefImpl 把 track/trigger 两个回调交给用户控制）、
 * proxyRefs + shallowUnwrapHandlers（setup() 返回值自动解包的实现）、isRef/unref/toValue。
 *
 * 裁剪：toRef/toRefs/ObjectRefImpl/GetterRefImpl —— 这组是“把 reactive 对象的某个属性
 * 转成独立 ref”的工具函数，和响应式的核心追踪机制关系不大（内部也是复用 Dep.track/trigger），
 * 为了控制篇幅没有照抄，真实源码在 ref.ts#L372-L522。
 */
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './constants'
import { Dep } from './dep'
import { isReactive, isReadonly, isShallow, toRaw, toReactive } from './reactive'

function hasChanged(a: unknown, b: unknown): boolean {
  return !Object.is(a, b)
}
function isObject(v: unknown): v is object {
  return typeof v === 'object' && v !== null
}

export interface Ref<T = any> {
  value: T
}

export function isRef<T>(r: unknown): r is Ref<T> {
  return !!(r && (r as any)[ReactiveFlags.IS_REF] === true)
}

export function ref<T>(value: T): Ref<T> {
  return createRef(value, false)
}

export function shallowRef<T>(value: T): Ref<T> {
  return createRef(value, true)
}

function createRef<T>(rawValue: T, isShallowFlag: boolean): Ref<T> {
  if (isRef<T>(rawValue)) return rawValue
  return new RefImpl(rawValue, isShallowFlag)
}

class RefImpl<T = any> {
  _value: T
  private _rawValue: T
  dep: Dep = new Dep()

  public readonly [ReactiveFlags.IS_REF] = true
  public readonly [ReactiveFlags.IS_SHALLOW]: boolean

  constructor(value: T, isShallowFlag: boolean) {
    this._rawValue = isShallowFlag ? value : toRaw(value)
    this._value = isShallowFlag ? value : toReactive(value)
    this[ReactiveFlags.IS_SHALLOW] = isShallowFlag
  }

  get value() {
    this.dep.track({ target: this, type: TrackOpTypes.GET, key: 'value' })
    return this._value
  }

  set value(newValue) {
    const oldValue = this._rawValue
    const useDirectValue = this[ReactiveFlags.IS_SHALLOW] || isShallow(newValue) || isReadonly(newValue)
    newValue = (useDirectValue ? newValue : toRaw(newValue)) as T
    if (hasChanged(newValue, oldValue)) {
      this._rawValue = newValue
      this._value = useDirectValue ? newValue : (toReactive(newValue) as T)
      this.dep.trigger({ target: this, type: TriggerOpTypes.SET, key: 'value', newValue, oldValue })
    }
  }
}

/** 强制触发一个 shallowRef 的依赖——用于“我手动改了 .value 内部的东西，但 .value 本身没变” */
export function triggerRef(ref: Ref): void {
  const impl = ref as unknown as RefImpl
  if (impl.dep) {
    impl.dep.trigger({ target: ref, type: TriggerOpTypes.SET, key: 'value', newValue: impl._value })
  }
}

export function unref<T>(ref: T | Ref<T>): T {
  return isRef(ref) ? (ref as Ref<T>).value : (ref as T)
}

export function toValue<T>(source: T | Ref<T> | (() => T)): T {
  return typeof source === 'function' ? (source as () => T)() : unref(source)
}

export type CustomRefFactory<T> = (
  track: () => void,
  trigger: () => void,
) => { get: () => T; set: (value: T) => void }

class CustomRefImpl<T> {
  public dep: Dep
  private readonly _get: () => T
  private readonly _set: (value: T) => void
  public readonly [ReactiveFlags.IS_REF] = true

  constructor(factory: CustomRefFactory<T>) {
    const dep = (this.dep = new Dep())
    const { get, set } = factory(dep.track.bind(dep), dep.trigger.bind(dep))
    this._get = get
    this._set = set
  }

  get value(): T {
    return this._get()
  }
  set value(newVal: T) {
    this._set(newVal)
  }
}

export function customRef<T>(factory: CustomRefFactory<T>): Ref<T> {
  return new CustomRefImpl(factory) as unknown as Ref<T>
}

const shallowUnwrapHandlers: ProxyHandler<any> = {
  get: (target, key, receiver) => (key === ReactiveFlags.RAW ? target : unref(Reflect.get(target, key, receiver))),
  set: (target, key, value, receiver) => {
    const oldValue = target[key]
    if (isRef(oldValue) && !isRef(value)) {
      oldValue.value = value
      return true
    }
    return Reflect.set(target, key, value, receiver)
  },
}

/** 对应源码的 ShallowUnwrapRef：类型层面描述"每个字段如果是 Ref<V> 就看作 V"，
 * 这样 proxyRefs 返回值上访问/赋值某个曾经是 ref 的字段时，类型里就是解包后的值类型。 */
export type ShallowUnwrapRef<T> = {
  [K in keyof T]: T[K] extends Ref<infer V> ? V : T[K]
}

/** setup() 返回对象时组件实例做的事：reactive 对象原样返回，普通对象套一层“读写自动解包 ref” */
export function proxyRefs<T extends object>(objectWithRefs: T): ShallowUnwrapRef<T> {
  return (
    isReactive(objectWithRefs) ? objectWithRefs : new Proxy(objectWithRefs, shallowUnwrapHandlers)
  ) as ShallowUnwrapRef<T>
}
