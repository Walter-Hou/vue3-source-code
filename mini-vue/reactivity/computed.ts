/**
 * 对应源码：packages/reactivity/src/computed.ts
 *
 * ComputedRefImpl 身兼两职：
 * - 对外是一个 Dep（this.dep），谁读 computed.value 谁就订阅这个 dep
 * - 对内是一个 Subscriber（deps/depsTail/flags），自己读取依赖时的身份就是 activeSub
 *
 * get value() 的三步：dep.track()（让外部 effect 订阅自己）→ refreshComputed()（真正的脏检查 +
 * 重算）→ 把本次 link 的 version 同步成 dep.version（这样外部 effect 下次 isDirty 判断才准）。
 */
import { ReactiveFlags, TrackOpTypes } from './constants'
import { Dep, type Link, globalVersion } from './dep'
import { EffectFlags, type Subscriber, activeSub, batch, refreshComputed } from './effect'

export type ComputedGetter<T> = (oldValue?: T) => T
export type ComputedSetter<T> = (newValue: T) => void

export class ComputedRefImpl<T = any> implements Subscriber {
  _value: any = undefined
  readonly dep: Dep = new Dep(this)
  readonly [ReactiveFlags.IS_REF] = true

  deps?: Link = undefined
  depsTail?: Link = undefined
  flags: EffectFlags = EffectFlags.DIRTY
  /** computed 自己的“上次刷新时，全局版本号是多少” —— refreshComputed 的第一层快速路径 */
  globalVersion = globalVersion - 1
  next?: Subscriber = undefined

  constructor(
    public fn: ComputedGetter<T>,
    private readonly setter: ComputedSetter<T> | undefined,
  ) {}

  /** Dep.notify() 对每个 computed 订阅者调用：只打 DIRTY 标记并登记进批处理，不立刻重算 */
  notify(): true | void {
    this.flags |= EffectFlags.DIRTY
    if (!(this.flags & EffectFlags.NOTIFIED) && activeSub !== this) {
      batch(this, true)
      return true
    }
  }

  get value(): T {
    const link = this.dep.track({ target: this, type: TrackOpTypes.GET, key: 'value' })
    refreshComputed(this)
    if (link) link.version = this.dep.version
    return this._value
  }

  set value(newValue) {
    if (this.setter) this.setter(newValue)
  }
}

export function computed<T>(
  getterOrOptions: ComputedGetter<T> | { get: ComputedGetter<T>; set: ComputedSetter<T> },
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T> | undefined
  if (typeof getterOrOptions === 'function') {
    getter = getterOrOptions
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }
  return new ComputedRefImpl(getter, setter)
}
