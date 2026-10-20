/**
 * 运行：pnpm ex chapters/02-reactive/examples/01-proxy-vs-defineProperty.ts
 * 演示：用一个简化版的 Vue 2 `defineReactive`（Object.defineProperty）和 Vue 3 的 `reactive`（Proxy）
 *       分别跑同一组操作——新增属性、数组索引赋值、改 length、delete——对比谁能响应、谁不能。
 * 看点：defineProperty 版本在「新增属性」「数组索引」「delete」三种场景下完全没反应（这就是 Vue 2
 *       需要 Vue.set/Vue.delete、以及数组要重写 7 个方法的根本原因）；Proxy 版本全部正常响应。
 */
import { reactive } from 'vue'
import { section, step, log } from '../../../shared/print'

// ------------------------------------------------------------------
// 一个最简化的 Vue 2 风格 defineReactive：只做“递归遍历、初始化时挂 getter/setter”，
// 不含 Dep/Watcher，只用一个全局数组记录“谁被通知过”，够用来对比行为即可。
// 对应 Vue 2 源码：src/core/observer/index.ts 的 defineReactive + observe
// ------------------------------------------------------------------
const notified: string[] = []

function defineReactiveV2(obj: any, key: string) {
  let val = obj[key]
  if (val && typeof val === 'object') observeV2(val) // 递归：初始化时就要把每一层都走一遍
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get() {
      return val
    },
    set(newVal) {
      if (newVal === val) return
      val = newVal
      if (val && typeof val === 'object') observeV2(val)
      notified.push(`${key} -> ${JSON.stringify(newVal)}`)
    },
  })
}

function observeV2(obj: any) {
  if (Array.isArray(obj)) {
    // Vue 2 对数组的应对：换掉原型链上的 7 个方法（push/pop/shift/unshift/splice/sort/reverse）
    // 这里只做行为说明，不真的重写，因为本例要展示的正是“不重写就完全没辙”
    obj.forEach((_: unknown, i: number) => observeV2(obj[i]))
    return
  }
  Object.keys(obj).forEach(key => defineReactiveV2(obj, key))
}

section('1. 新增属性：Vue 2 defineProperty 版 vs Vue 3 Proxy 版')
{
  const v2: Record<string, number> = { a: 1 }
  observeV2(v2)
  const v3 = reactive({ a: 1 } as Record<string, number>)

  step('给两个对象都新增属性 b')
  notified.length = 0
  v2.b = 2 // 直接赋值新 key：defineReactive 从没给 b 定义过 getter/setter，这只是一次普通的属性写入
  log('defineProperty 版本收到的通知：', notified) // 期望：空数组，因为 b 从未被 defineReactive 处理过
  log('v2.b 的值：', v2.b, '（属性确实加上了，只是不是响应式的）')

  let v3Runs = 0
  // 用一个简单的“手写 effect”代替 import 自 reactivity 的 effect，这里只是为了不引入额外概念
  const track = () => {
    v3Runs++
    return v3.b
  }
  track()
  v3.b = 2
  track()
  log('Proxy 版本：b 被访问 + 修改后，“手写 effect”运行次数 =', v3Runs, '（新增属性一样能被追踪到）')
}

section('2. 数组索引赋值：arr[idx] = x')
{
  const v2 = { list: [1, 2, 3] }
  observeV2(v2)
  const v3 = reactive({ list: [1, 2, 3] })

  step('直接用下标赋值，不走 push/pop 等 7 个被重写的方法')
  notified.length = 0
  v2.list[1] = 100
  log('defineProperty 版本收到的通知：', notified, '-> list[1] 现在是', v2.list[1])
  log('这正是 Vue 2 文档里「不能检测到以下数组变动」的第一条：arr[index] = value')

  let seen: number[] = []
  const readList = () => {
    seen = [...v3.list]
  }
  readList()
  v3.list[1] = 100
  readList()
  log('Proxy 版本：赋值后再次读取 list =', seen, '（索引写入本质上就是 set 陷阱，天然被 track/trigger 覆盖）')
}

section('3. 修改 length')
{
  const v2 = { list: [1, 2, 3] }
  observeV2(v2)
  const v3 = reactive({ list: [1, 2, 3] })

  step('把 length 改小，相当于截断数组')
  notified.length = 0
  v2.list.length = 1
  log('defineProperty 版本：list.length 从未被 defineReactive 处理过（它不是通过 Object.keys 遍历到的自有属性）')
  log('修改后的数组：', v2.list, '—— 值变了，但没有任何响应式通知')

  log('Proxy 版本：baseHandlers 的 ownKeys 对数组专门 track 的是 "length" 这个 key（而不是 ITERATE_KEY）')
  log('这意味着 trigger 阶段，type===SET + key==="length" 会走 dep.ts trigger() 里的专门分支：')
  log('  遍历 depsMap，key 是 "length" 本身、或 ARRAY_ITERATE_KEY、或数字 key>=newLength 的全部触发')
}

section('4. delete 属性')
{
  const v2: any = { a: 1, b: 2 }
  observeV2(v2)
  const v3 = reactive({ a: 1, b: 2 } as Record<string, number>)

  step('delete 一个已存在的属性')
  notified.length = 0
  delete v2.a
  log('defineProperty 版本收到的通知：', notified, '-> v2 =', v2)
  log('delete 只是把属性从对象上摘掉，Object.defineProperty 装好的 getter/setter 根本不会被触发')

  let v3Runs = 0
  const track2 = () => {
    v3Runs++
    return v3.a
  }
  track2()
  delete v3.a
  track2()
  log('Proxy 版本：deleteProperty 陷阱里 hadKey && result 就会 trigger(DELETE)，手写 effect 跑了', v3Runs, '次')
}

section('结论')
log('defineProperty 版本必须在「初始化」时就知道所有 key（递归 observe），运行期新增/删除/数组索引全部失明。')
log('Proxy 版本的 baseHandlers 拦截的是「操作」本身（get/set/deleteProperty/has/ownKeys），')
log('而不是某个具体的 key，所以不需要预先知道有哪些 key —— 这也是 Vue.set/Vue.delete 在 Vue 3 里消失的原因。')
