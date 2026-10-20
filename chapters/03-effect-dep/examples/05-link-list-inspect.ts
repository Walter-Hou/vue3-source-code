/**
 * 运行：pnpm ex chapters/03-effect-dep/examples/05-link-list-inspect.ts
 * 演示：直接访问 runner.effect.deps/depsTail/nextDep/prevDep，把 Link 双向链表的内部结构
 *       打印出来；改变属性的访问顺序，观察链表节点顺序如何跟着变化（3.5 的"链表复用"设计）。
 * 看点：Link.version 字段在 prepareDeps/cleanupDeps 前后的变化；同一个 Dep 在 run() 之间
 *       如果继续被访问，Link 实例是被复用的（同一个对象引用），不是每次重新 new。
 */
import { reactive, effect } from 'vue'
import { section, step, log } from '../../../shared/print'

function dumpDeps(e: any): Array<{ key: string; version: number; depVersion: number }> {
  const list = []
  for (let link = e.deps; link; link = link.nextDep) {
    list.push({ key: String(link.dep.key), version: link.version, depVersion: link.dep.version })
  }
  return list
}

section('1. 打印一个 effect 的完整依赖链表')
{
  const state = reactive({ a: 1, b: 2, c: 3 })
  const runner = effect(() => {
    state.a
    state.b
    state.c
  })
  log('依赖链表（按访问顺序，从 deps 头节点到 depsTail 尾节点）：')
  log(dumpDeps(runner.effect))

  step('验证首尾指针：effect.deps 是第一个访问的，effect.depsTail 是最后一个')
  // deps/depsTail 是 @internal 字段，公开类型里没有，这里用 any 绕过去访问
  const effectAny = runner.effect as any
  log('deps.dep.key =', String(effectAny.deps.dep.key))
  log('depsTail.dep.key =', String(effectAny.depsTail.dep.key))
}

section('2. 改变访问顺序：链表节点顺序跟着变，但是是同一批 Link 对象被复用')
{
  const state = reactive({ a: 1, b: 2, c: 3 })
  let order = ['a', 'b', 'c']
  const map: Record<string, () => number> = { a: () => state.a, b: () => state.b, c: () => state.c }

  const runner = effect(() => {
    order.forEach(k => map[k]())
  })

  const linkA_before = findLink(runner.effect, 'a')
  log('第一次运行后的顺序：', dumpDeps(runner.effect).map(d => d.key))

  step('改变访问顺序为 c, a, b，重新触发一次运行')
  order = ['c', 'a', 'b']
  state.a++ // 随便改一个值触发重新运行（runIfDirty -> run）
  log('第二次运行后的顺序：', dumpDeps(runner.effect).map(d => d.key))

  const linkA_after = findLink(runner.effect, 'a')
  log('key=a 的 Link 对象，两次运行是否是同一个引用（复用）：', linkA_before === linkA_after)
  log('源码位置 dep.ts#L127-L151：Dep.track() 发现 link.version === -1（本轮之前用过），')
  log('只同步 version、把这个 link 挪到 sub.depsTail 尾部——不会 new 一个新 Link')
}

section('3. Link.version 在 prepareDeps / cleanupDeps 前后的变化')
{
  const state = reactive({ cond: true, a: 1, b: 2 })
  const runner = effect(() => (state.cond ? state.a : state.b))

  step('运行完毕后，所有活跃 Link 的 version 应该等于对应 Dep 的 version（同步过）')
  log(dumpDeps(runner.effect))

  step('切换分支：a 不再被访问，它的 Link 会在 cleanupDeps 里被摘除（不会停留在"version=-1"的状态被看到）')
  state.cond = false
  log('切换后的依赖链表（a 已经被物理删除，不是停留在链表里只是 version 不同步）：')
  log(dumpDeps(runner.effect))
}

function findLink(e: any, key: string): any {
  for (let link = e.deps; link; link = link.nextDep) {
    if (String(link.dep.key) === key) return link
  }
  return undefined
}
