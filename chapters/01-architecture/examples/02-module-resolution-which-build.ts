/**
 * 运行：pnpm ex chapters/01-architecture/examples/02-module-resolution-which-build.ts
 * 演示：同一个 "vue" 包，CJS 解析（require）和 ESM 解析（import）会分别命中
 *       package.json#exports 里不同的条件分支，本仓库所有示例实际加载的是哪个文件。
 * 看点：
 *   1. exports 字段里 "require" 和 "import" 下各自都细分了 "node"/"default" 等条件，
 *      Node 的 CJS resolver 和 ESM resolver 走的不是同一条分支。
 *   2. 不管走哪条分支，最终都会落到 index.js——它本身不是实现，只是按 NODE_ENV
 *      去 require 不同的 dist 文件，这就是本仓库示例实际加载的"完整版"（含编译器）。
 *   3. Vite/webpack 这类打包器不是 Node 运行时，解析器不会带 "node" 条件，会优先
 *      命中 "module" 字段指向的 vue.runtime.esm-bundler.js —— 这是"运行时版"
 *      （不含编译器），配合构建时把 <script setup>/SFC 编译成 render 函数使用。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { section, step, log } from '../../../shared/print'

const require = createRequire(import.meta.url)
const pkgDir = dirname(require.resolve('vue/package.json'))

section('1. 同一个 "vue"，CJS 解析 vs ESM 解析，分别命中哪个文件')

const cjsResolved = require.resolve('vue')
step('CJS：require.resolve("vue")（走 exports["."].require 分支）')
log('->', cjsResolved.replace(pkgDir, '<vue 包根目录>'))

const esmResolvedUrl = import.meta.resolve('vue')
step('ESM：import.meta.resolve("vue")（走 exports["."].import 分支）')
log('->', esmResolvedUrl.replace('file://' + pkgDir, '<vue 包根目录>'))

log(
  '两条路径字面上不同，但都会落到同一个 index.js —— require 分支直接指向它；',
  'import 分支先过 index.mjs（内容只有一行 `export * from "./index.js"`），再转回 index.js。',
)

section('2. index.js 按 NODE_ENV 转发到哪个 dist 文件')

const indexJs = readFileSync(`${pkgDir}/index.js`, 'utf-8')
step('index.js 的完整内容（它本身不是实现，只负责按环境转发）')
log(indexJs.trim())

const nodeEnv = process.env.NODE_ENV
const actualDistFile = nodeEnv === 'production' ? 'dist/vue.cjs.prod.js' : 'dist/vue.cjs.js'
step(`当前 NODE_ENV = ${JSON.stringify(nodeEnv)}，本仓库所有示例实际加载的是`)
log(actualDistFile)

section('3. 对比几种典型场景各自命中的 dist 产物，是不是"完整版"（含运行时模板编译器）')

const variants: Array<[string, string]> = [
  ['本仓库 Node 脚本（tsx）实际加载的文件', actualDistFile],
  ['Vite/webpack 等打包器优先识别的 "module" 字段', 'dist/vue.runtime.esm-bundler.js'],
  ['显式引入、想要运行时编译器的完整 ESM 版', 'dist/vue.esm-bundler.js'],
  ['直接用 <script> 标签、挂全局 Vue 变量', 'dist/vue.global.js'],
]
for (const [scenario, file] of variants) {
  let size = '(未找到)'
  let hasCompiler = false
  try {
    const content = readFileSync(`${pkgDir}/${file}`, 'utf-8')
    size = `${(content.length / 1024).toFixed(1)} KB`
    hasCompiler = content.includes('compileToFunction') || content.includes('registerRuntimeCompiler')
  } catch {
    // 文件不存在就保持默认值
  }
  step(scenario)
  log(`文件 = ${file}，大小 = ${size}，含运行时编译器 = ${hasCompiler}`)
}

log(
  '\n结论：本仓库所有 "import ... from \'vue\'" 的示例，实际加载的都是 dist/vue.cjs.js ——',
  '"完整版"，这也是第 14 章"容器 innerHTML 当 template 用"那个例子能跑通的原因。',
  'vue.runtime.esm-bundler.js 体积明显更小、且不含编译器，是大多数用 Vite 构建、',
  '写 <script setup> 的生产项目实际用的那个文件——这正是 rollup.config.js 里',
  'PackageFormat 表要解决的问题（见本章 README「构建产物」一节）。',
)
