/**
 * 运行：pnpm ex chapters/01-architecture/examples/01-package-dependency-graph.ts
 * 演示：读取每个 @vue 子包真实安装的 package.json，把 "dependencies" 字段拼成一张
 *       依赖关系图——这就是 monorepo 里每个包各自的 package.json 互相引用的真实样子
 *       （workspace 协议在发布时会被替换成具体版本号，这里装的就是发布后的版本）。
 * 看点：
 *   1. @vue/shared 是唯一一个"不依赖任何其他 @vue 包"的包，所有包都直接或间接依赖它。
 *   2. @vue/reactivity 只依赖 shared——它对"组件""渲染""DOM"一无所知。
 *   3. @vue/compiler-core 同样只依赖 shared——它不知道"浏览器""HTML"是什么，这些
 *      是 compiler-dom 的事。
 *   4. "vue" 这个顶层包本身不包含任何实现，只是把 compiler-dom + runtime-dom +
 *      compiler-sfc + server-renderer 这几个包粘合在一起（见第二个示例）。
 */
import { createRequire } from 'node:module'
import { section, step, log } from '../../../shared/print'

const require = createRequire(import.meta.url)

const PACKAGES = [
  'vue',
  '@vue/shared',
  '@vue/reactivity',
  '@vue/runtime-core',
  '@vue/runtime-dom',
  '@vue/compiler-core',
  '@vue/compiler-dom',
  '@vue/compiler-sfc',
  '@vue/compiler-ssr',
  '@vue/server-renderer',
]

interface PkgInfo {
  name: string
  version: string
  deps: string[]
}

function loadPkgInfo(pkgName: string): PkgInfo {
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`)
  const pkg = require(pkgJsonPath)
  return {
    name: pkg.name,
    version: pkg.version,
    deps: Object.keys(pkg.dependencies ?? {}).filter(d => d.startsWith('@vue/')),
  }
}

section('1. 每个包真实的 "dependencies" 字段')

const infos = PACKAGES.map(loadPkgInfo)
for (const info of infos) {
  step(`${info.name}@${info.version}`)
  log('依赖 =', info.deps.length ? info.deps.join(', ') : '(无 @vue/* 依赖)')
}

section('2. 画出依赖层级（按"被依赖的包排在上面"分层）')

// 简单分层算法：第 0 层是没有 @vue 依赖的包，第 N 层是依赖都在 0..N-1 层的包
const nameToInfo = new Map(infos.map(i => [i.name, i]))
const layerOf = new Map<string, number>()
function computeLayer(name: string): number {
  if (layerOf.has(name)) return layerOf.get(name)!
  const info = nameToInfo.get(name)
  if (!info || info.deps.length === 0) {
    layerOf.set(name, 0)
    return 0
  }
  const layer = 1 + Math.max(...info.deps.map(d => computeLayer(d)))
  layerOf.set(name, layer)
  return layer
}
for (const info of infos) computeLayer(info.name)

const byLayer = new Map<number, string[]>()
for (const [name, layer] of layerOf) {
  if (!byLayer.has(layer)) byLayer.set(layer, [])
  byLayer.get(layer)!.push(name)
}
for (const layer of [...byLayer.keys()].sort((a, b) => a - b)) {
  step(`第 ${layer} 层`)
  log(byLayer.get(layer)!.sort().join('、'))
}

log(
  '\n结论：shared 在第 0 层；reactivity/compiler-core 在第 1 层（分别是响应式和编译器两条线的起点）；',
  'runtime-core/compiler-dom 在第 2 层；runtime-dom/compiler-sfc 在第 3 层；',
  'vue 这个顶层包在最后一层——它不产生新能力，只是把下面几条线粘合起来。',
)
