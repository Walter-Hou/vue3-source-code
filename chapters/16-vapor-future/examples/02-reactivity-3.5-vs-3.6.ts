/**
 * 运行：pnpm ex chapters/16-vapor-future/examples/02-reactivity-3.5-vs-3.6.ts
 * 演示：同一段 effect/computed 代码分别用 @vue/reactivity（3.5.44，项目直接依赖）
 *   和 3.6.0-rc.12 的 @vue/reactivity（通过 vue-next 间接拿到）跑，对比：
 *   1. 外部可观察行为（effect 触发次数、computed 缓存行为）是否一致
 *   2. 内部实现结构（effect 对象自身的字段）有什么不同
 * 看点：
 *   3.6 把 3.5 的 Dep/Link 双向链表 + version 计数器方案，换成了移植自
 *   alien-signals 的「push-pull」传播算法：trigger 时只是把下游标记成
 *   Dirty/Pending（push，廉价），真正要不要重新计算，等到真的被读取时再用
 *   checkDirty() 顺着依赖链向上验证（pull，按需）。两套实现下，用户能观察到的
 *   行为（什么时候重新算、算几次）完全一致，内部的字段/数据结构完全不同。
 *
 * 环境说明：本项目同时装了 3.5.44（顶层 "vue"/"@vue/reactivity"）和
 * 3.6.0-rc.12（npm alias "vue-next"，解析到 vue@3.6.0-rc.12）。但 "vue-next"
 * 包本身不直接依赖 @vue/reactivity（它通过 runtime-dom -> runtime-core ->
 * reactivity 间接依赖），直接 `createRequire(vueNextPkgPath).resolve('@vue/reactivity')`
 * 会意外落回顶层 3.5.44——下面用「vue -> runtime-dom -> runtime-core -> reactivity」
 * 逐级 createRequire 的方式精确定位到 3.6 的那一份。
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { section, step, log } from '../../../shared/print'

const require = createRequire(import.meta.url)

function resolve36(pkg: string): { version: string; url: string } {
  const vuePkg = require.resolve('vue-next/package.json')
  const req2 = createRequire(vuePkg)
  const runtimeDomPkgPath = req2.resolve('@vue/runtime-dom/package.json')
  const req3 = createRequire(runtimeDomPkgPath)
  const runtimeCorePkgPath = req3.resolve('@vue/runtime-core/package.json')
  const req4 = createRequire(runtimeCorePkgPath)
  const pkgJsonPath = req4.resolve(`${pkg}/package.json`)
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
  return {
    version: pkgJson.version,
    url: pathToFileURL(join(dirname(pkgJsonPath), pkgJson.module)).href,
  }
}

const r35 = await import('@vue/reactivity')
const info36 = resolve36('@vue/reactivity')
const r36 = await import(info36.url)

section('0. 确认两份确实是不同版本')
log('3.5 版本:', (await import('@vue/reactivity/package.json', { with: { type: 'json' } })).default.version)
log('3.6 版本:', info36.version)

section('1. 外部行为对照：effect 触发次数 / computed 缓存')
function runDemo(label: string, { effect, computed, reactive }: any) {
  step(label)
  const state = reactive({ count: 0 })
  let computedRuns = 0
  const double = computed(() => {
    computedRuns++
    return state.count * 2
  })
  let effectRuns = 0
  const log_: number[] = []
  effect(() => {
    effectRuns++
    log_.push(double.value)
  })
  state.count++
  state.count++
  // 连续读两次 computed，且没有新的依赖变化 —— 不应该触发重新计算
  const v1 = double.value
  const v2 = double.value
  log(`effectRuns=${effectRuns} computedRuns=${computedRuns} log=[${log_}] v1=${v1} v2=${v2}`)
  return { effectRuns, computedRuns, log: log_, v1, v2 }
}

const result35 = runDemo('3.5.44', r35)
const result36 = runDemo('3.6.0-rc.12', r36)

step('两组结果逐字段比较')
log(
  'effectRuns 一致:', result35.effectRuns === result36.effectRuns,
  '| computedRuns 一致:', result35.computedRuns === result36.computedRuns,
  '| log 一致:', JSON.stringify(result35.log) === JSON.stringify(result36.log),
)
log(
  '=> 两个版本的公共行为完全兼容：effect 跑 3 次（初始 1 次 + state.count++ 两次各触发 1 次），' +
    'computed 也跑 3 次（和 effect 同步，因为每次 effect 重跑都会读 double.value），' +
    '之后连续两次读 double.value 都不触发重新计算——computed 缓存行为一致。',
)

section('2. 内部结构对照：effect 对象自身的字段完全不同')
const e35 = r35.effect(() => {})
const e36 = r36.effect(() => {})
step('3.5.44：ReactiveEffect 实例字段（reactivity/src/effect.ts + dep.ts 的 Link 方案）')
log(Object.keys(e35.effect).filter((k) => typeof k === 'string'))
step('3.6.0-rc.12：ReactiveEffect 实例字段（system.ts 的 alien-signals 方案）')
log(Object.keys(e36.effect).filter((k) => typeof k === 'string'))
log(
  [
    '3.5 独有: `next`（Vue 3.5 自己维护的一条"当前正在执行的 effect"链表指针，',
    '           用于处理嵌套 effect/递归场景，配合 dep.ts 的 Link.version 做脏检查）',
    '3.6 独有: `subs`/`subsTail`（3.6 里 ReactiveEffect 自己也实现了完整的',
    '           ReactiveNode 接口——不仅有 deps/depsTail，还有 subs/subsTail，',
    '           因为 EffectScope 可以"订阅"一个 effect 的停止；',
    '           `cleanups`/`cleanupsLength` 用定长数组 + 计数器代替 3.5 的单个 `cleanup` 回调，',
    '           同一个 effect 内多次 onEffectCleanup() 注册也不会互相覆盖）',
    '共同点: 两边都有 `deps`/`depsTail`（指向依赖链表）、`flags`（状态位）、`fn`（实际执行体）',
  ].join('\n'),
)

section('3. 两种实现的核心机制对比（源码走读，非运行时能直接观察到的部分）')
log(
  [
    '3.5（packages/reactivity/src/dep.ts + effect.ts）：',
    '  · Dep.version（number）+ 全局 globalVersion：每次响应式变更 globalVersion++，',
    '    Link.version 在 track 时同步成 dep.version；effect 重跑前把所有旧 link 的',
    '    version 标记失效，跑完后清理掉没被重新访问到的 link（标记"过时依赖"的方式）',
    '  · computed 靠比较"自己上次计算时的 globalVersion"和"当前 globalVersion"来判断',
    '    要不要重新算，是一种近似的脏检查（版本号变了不代表真的变了，但没变就一定没变）',
    '',
    '3.6（packages/reactivity/src/system.ts，移植自 alien-signals）：',
    '  · 不用版本号，改用 ReactiveFlags 状态位：Dirty / Pending / Recursed / RecursedCheck',
    '    / Watching / Mutable',
    '  · trigger 时 propagate() 做「push」：把下游全部标记 Pending（代表"依赖变了，但还',
    '    不确定最终值变没变"），只有被 Watching 标记的（effect）才会立刻进 notifyBuffer',
    '    排队重跑；是 Mutable 的（computed）只标记不立刻算，等真正被读取时再算',
    '  · 读取时 checkDirty() 做「pull」：顺着 deps 链一路向上验证，真的发现某个上游值',
    '    变了才继续标 Dirty 并触发重新计算（computed.update()），否则清掉 Pending 标记',
    '  · effect.dirty 这个 getter 就是 push 和 pull 两套机制的交汇点：先看有没有已经确定',
    '    的 Dirty，没有的话才去 checkDirty() 做一次向上验证',
  ].join('\n'),
)

log(
  '\n（待 3.6 正式版确认：alien-signals 移植的细节在 rc 阶段仍可能微调；' +
    '以上字段名/函数名以 core-3.6 分支 packages/reactivity/src/{system,dep,effect,computed}.ts' +
    '实测为准）',
)
