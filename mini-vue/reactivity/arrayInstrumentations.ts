/**
 * 对应源码：packages/reactivity/src/arrayInstrumentations.ts（3.5 新文件，源码 412 行）
 *
 * 源码里一共处理了三类问题，mini 版只挑了最关键、最常被面试问到的两类来实现：
 *
 * 1. includes/indexOf/lastIndexOf：数组里存的是 reactive 包过的元素，但用户经常拿原始对象去
 *    `arr.includes(rawItem)` —— 直接用代理数组的原生方法会因为 `===` 比较失败而找不到。
 *    源码的 searchProxy 先按用户传的参数查一次，找不到再退化成全部转成 raw 再查一次。
 *
 * 2. push/pop/shift/unshift/splice：这几个方法会先读 length 再写 length（比如 push 内部等价于
 *    `this[this.length] = x; this.length++`），如果这期间 track 是开着的，在 effect 内部调用
 *    push 会把“读 length”也记成依赖，于是自己触发的 length 变化又把自己重新排进调度 —— 死循环。
 *    源码用 pauseTracking() 关掉这期间的依赖收集，再用 startBatch/endBatch 把一次调用触发的
 *    多个 key（索引 + length）的 trigger 合并成一次 notify。
 *
 * 没有实现（本章 README 里会提到，让读者知道这是"故意省略"而不是"没注意到"）：
 * - map/filter/forEach/find/every/some/reduce 等用 ARRAY_ITERATE_KEY 做"读了就当读过全部元素"
 *   的追踪（源码里的 apply/reduce/iterator 函数）
 * - toReversed/toSorted/toSpliced 等 ES2023 新方法
 * - 原生迭代器协议的包装（避免 V8 对 Array Iterator 的快速路径失效，#15643）
 */
import { pauseTracking, resetTracking, startBatch, endBatch } from './effect'
import { toRaw } from './reactive'
import { TrackOpTypes } from './constants'
import { ARRAY_ITERATE_KEY, track } from './dep'

export const arrayInstrumentations: Record<string | symbol, Function> = {
  // 显式标注 this 的类型（和源码一样）：这些方法本来就只打算通过 `arr.includes(...)`
  // 这种"以数组实例为 this"的方式调用，而不是作为 Record<string|symbol, Function> 的
  // 普通方法使用，所以 this 的真实类型跟外层对象字面量的类型无关。
  includes(this: unknown[], ...args: unknown[]) {
    return searchProxy(this, 'includes', args)
  },
  indexOf(this: unknown[], ...args: unknown[]) {
    return searchProxy(this, 'indexOf', args)
  },
  lastIndexOf(this: unknown[], ...args: unknown[]) {
    return searchProxy(this, 'lastIndexOf', args)
  },
  push(this: unknown[], ...args: unknown[]) {
    return noTracking(this, 'push', args)
  },
  pop(this: unknown[]) {
    return noTracking(this, 'pop')
  },
  shift(this: unknown[]) {
    return noTracking(this, 'shift')
  },
  unshift(this: unknown[], ...args: unknown[]) {
    return noTracking(this, 'unshift', args)
  },
  splice(this: unknown[], ...args: unknown[]) {
    return noTracking(this, 'splice', args)
  },
}

function searchProxy(self: unknown[], method: 'includes' | 'indexOf' | 'lastIndexOf', args: unknown[]) {
  const arr = toRaw(self) as any
  track(arr, TrackOpTypes.ITERATE, ARRAY_ITERATE_KEY)
  const res = arr[method](...args)
  if ((res === -1 || res === false) && isProxyLike(args[0])) {
    args = args.slice()
    args[0] = toRaw(args[0])
    return arr[method](...args)
  }
  return res
}

function isProxyLike(v: unknown): boolean {
  return !!(v && typeof v === 'object' && (v as any).__v_raw)
}

function noTracking(self: unknown[], method: 'push' | 'pop' | 'shift' | 'unshift' | 'splice', args: unknown[] = []) {
  pauseTracking()
  startBatch()
  const res = (toRaw(self) as any)[method].apply(self, args)
  endBatch()
  resetTracking()
  return res
}
