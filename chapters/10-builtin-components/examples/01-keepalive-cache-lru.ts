/**
 * 运行：pnpm ex chapters/10-builtin-components/examples/01-keepalive-cache-lru.ts
 * 演示：KeepAlive 的 cache/keys 双数据结构、activate/deactivate 与真正 mount/unmount 的宿主操作差异、
 *      max 限制下的 LRU 淘汰顺序、include/exclude 对缓存的过滤
 * 看点：① 首次挂载打印 createElement/insert，再次切回命中缓存时只有 move，没有 createElement
 *      ② 组件内部状态（count）在 deactivate -> activate 之间原样保留，证明实例没有被销毁
 *      ③ max 限制达到后，keys（Set）打印的插入顺序变化，以及被淘汰的条目会真正触发 unmounted 钩子
 *      ④ include/exclude 不匹配的组件即使在 KeepAlive 内部也会被整个卸载，不会进 cache
 */
import {
  KeepAlive,
  type VNode,
  defineComponent,
  h,
  nextTick,
  ref,
} from '@vue/runtime-core'
import {
  createRoot,
  printOps,
  render,
  resetOps,
  serialize,
} from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

// ------------------------------------------------------------------
// 测试用组件：用 data() 保存一个 count，通过 mounted/unmounted/activated/deactivated
// 四个生命周期钩子打印调用时机；render() 里把 this（public instance）暴存出来，
// 方便外部脚本直接修改 count，观察“缓存是否真的保留了实例状态”。
// ------------------------------------------------------------------
const instances: Record<string, any> = {}

function makeComp(name: string) {
  return defineComponent({
    name,
    data() {
      return { count: 0 }
    },
    mounted() {
      log(`[hook] ${name}.mounted`)
    },
    unmounted() {
      log(`[hook] ${name}.unmounted`)
    },
    activated() {
      log(`[hook] ${name}.activated (count=${this.count})`)
    },
    deactivated() {
      log(`[hook] ${name}.deactivated (count=${this.count})`)
    },
    render() {
      instances[name] = this
      return h('div', { class: name }, `${name}: ${this.count}`)
    },
  })
}

const CompA = makeComp('CompA')
const CompB = makeComp('CompB')
const CompC = makeComp('CompC')

/** 从根 vnode 顺着 subTree 找到 KeepAlive 自己的组件实例，读取它私有的 __v_cache（仅 DEV 下有） */
function getKeepAliveCache(appVNode: VNode): Map<any, VNode> {
  const kaInstance = appVNode.component!.subTree.component as any
  return kaInstance.__v_cache
}
function cacheKeyNames(cache: Map<any, VNode>): string[] {
  return [...cache.keys()].map(k => (k && k.name) || String(k))
}

// ====================================================================
// 1. 基本场景：A -> B -> A，观察 activate 复用实例而不是重新创建
// ====================================================================
section('1. KeepAlive 基本缓存：A -> B -> A')

const current1 = ref<'A' | 'B'>('A')
const App1 = defineComponent({
  render() {
    return h(KeepAlive, null, {
      default: () => h(current1.value === 'A' ? CompA : CompB),
    })
  },
})

const root1 = createRoot()
const appVNode1 = h(App1)

step('首次挂载 current=A（全新 mount）')
render(appVNode1, root1)
await nextTick()
printOps('mount A')
log('HTML:', serialize(root1))
log('cache keys =', cacheKeyNames(getKeepAliveCache(appVNode1)))

step('手动把 CompA 的 count 改成 2，模拟用户在组件内部产生的状态')
instances.CompA.count = 2
await nextTick()
printOps('CompA.count = 2 引发的更新')

step('切换到 B（A 应该被 deactivate：move 到 storageContainer，而不是 unmount）')
current1.value = 'B'
await nextTick()
printOps('switch to B')
log('cache keys =', cacheKeyNames(getKeepAliveCache(appVNode1)))

step('再切回 A（应该命中缓存：activate 时只有 move，没有 createElement；count 还是 2）')
current1.value = 'A'
await nextTick()
printOps('switch back to A')
log('CompA.count after activate =', instances.CompA.count)
log('HTML:', serialize(root1))

// ====================================================================
// 2. max=1：缓存上限最小化，几乎每次切换都会把旧的真正淘汰掉
// ====================================================================
section('2. max=1：缓存容量为 1，旧条目被 pruneCacheEntry 真正卸载')

const current2 = ref<'A' | 'B' | 'C'>('A')
const App2 = defineComponent({
  render() {
    const map = { A: CompA, B: CompB, C: CompC }
    return h(KeepAlive, { max: 1 }, {
      default: () => h(map[current2.value]),
    })
  },
})
const root2 = createRoot()
const appVNode2 = h(App2)

step('挂载 A')
render(appVNode2, root2)
await nextTick()
printOps('mount A')
log('cache keys =', cacheKeyNames(getKeepAliveCache(appVNode2)))
resetOps()

step('切到 B：keys 从 {A} 变成 {A,B}，size(2) > max(1)，pruneCacheEntry 淘汰最旧的 A')
current2.value = 'B'
await nextTick()
printOps('switch to B（注意 A 触发的是 unmounted，不是 deactivated）')
log('cache keys =', cacheKeyNames(getKeepAliveCache(appVNode2)))

step('再切回 A：A 已经被淘汰，必须重新 mount（又一次 createElement，而不是 activate）')
current2.value = 'A'
await nextTick()
printOps('switch back to A（重新 mount）')
log('cache keys =', cacheKeyNames(getKeepAliveCache(appVNode2)))

// ====================================================================
// 3. max=2：体现 LRU 的“刷新顺序”——命中缓存会把 key 移到 Set 末尾
// ====================================================================
section('3. max=2：A -> B -> A（命中，刷新顺序）-> C（该淘汰 B 而不是 A）')

const current3 = ref<'A' | 'B' | 'C'>('A')
const App3 = defineComponent({
  render() {
    const map = { A: CompA, B: CompB, C: CompC }
    return h(KeepAlive, { max: 2 }, {
      default: () => h(map[current3.value]),
    })
  },
})
const root3 = createRoot()
const appVNode3 = h(App3)

render(appVNode3, root3)
await nextTick()
resetOps() // 丢弃初始 mount A 的操作，后面只看每一步切换

step('挂载 A，然后切到 B（两者都在 max=2 容量内，不触发淘汰）')
current3.value = 'B'
await nextTick()
printOps('switch to B')
log('cache keys =', cacheKeyNames(getKeepAliveCache(appVNode3)), '（插入顺序 A,B）')

step('切回 A：命中缓存，keys.delete(A) + keys.add(A) 把 A 刷新为“最新”')
current3.value = 'A'
await nextTick()
printOps('switch back to A（命中缓存，只有 move，没有 createElement）')
log('cache keys =', cacheKeyNames(getKeepAliveCache(appVNode3)), '（顺序变成 B,A）')

step('切到 C：size(3) > max(2)，淘汰 keys 里排在最前的 B（而不是 A）')
current3.value = 'C'
await nextTick()
printOps('switch to C（应看到 B.unmounted，而不是 A.unmounted）')
log('cache keys =', cacheKeyNames(getKeepAliveCache(appVNode3)))

// ====================================================================
// 4. include/exclude：名字不匹配的组件即使包在 KeepAlive 里也不会进缓存
// ====================================================================
section('4. include=["CompA","CompC"]：CompB 被排除在缓存之外')

const current4 = ref<'A' | 'B'>('A')
const App4 = defineComponent({
  render() {
    return h(KeepAlive, { include: ['CompA', 'CompC'] }, {
      default: () => h(current4.value === 'A' ? CompA : CompB),
    })
  },
})
const root4 = createRoot()
const appVNode4 = h(App4)

render(appVNode4, root4)
await nextTick()
resetOps()

step('切到 B：旧的 A 这一轮渲染时仍带着上次打上的 COMPONENT_SHOULD_KEEP_ALIVE 标记，所以离场时依然是 deactivated；' +
  '但 B 的名字不在 include 里，新 vnode 不会被打上该标记')
current4.value = 'B'
await nextTick()
printOps('switch to B（CompA 是 deactivated，B 只是普通 mount）')
log('cache keys =', cacheKeyNames(getKeepAliveCache(appVNode4)), '（B 不会出现在这里，A 还在）')

step('切回 A：命中缓存，直接 activate；B 因为从未进入 cache，这次离场是真正的 unmounted')
current4.value = 'A'
await nextTick()
printOps('switch back to A（B.unmounted + A 的 activate move）')
