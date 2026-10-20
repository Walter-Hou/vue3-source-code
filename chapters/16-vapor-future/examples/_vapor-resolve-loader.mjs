/**
 * 内部小工具：不是本章的教学内容本身，只是用来绕开 3.6.0-rc.12 打包时的一个已知问题。
 *
 * 现象：@vue/runtime-vapor 等 3.6 rc 包的 dist 文件里有
 * `import { ... } from '@vue/runtime-dom'` 这样的裸标识符导入，而这些 @vue/* 包的
 * package.json#exports 都把 "node" 条件写在了 "import"/"require" 的同级（而不是嵌套在
 * 它们里面），"node" 分支下又只有 production/development/default 三个子条件，全部指向
 * CJS 文件。Node 做 ESM 解析时，只要 "node" 条件匹配（在 Node.js 环境里永远匹配），就会
 * 直接采用这个分支，根本不会再看同级的 "import" 条件——于是不管是 import() 还是
 * require()，"@vue/xxx" 最终都解析到 index.js；而 index.js 又是
 * `process.env.NODE_ENV` 条件 require，Node 的 CJS/ESM 互操作（cjs-module-lexer）
 * 没法静态分析出它的具名导出，于是报 "does not provide an export named 'xxx'"。
 *
 * 这是 rc 阶段的打包问题（3.5.44 稳定版的 exports 字段没有这个问题），不代表
 * runtime-vapor 本身有 bug——本章 README 会明确标注"待 3.6 正式版确认"。
 *
 * 修复思路：对每一个 "@vue/*" 裸标识符，用它的"导入方"（context.parentURL）作为
 * require 的起点去定位该包的 package.json（这完全复刻 Node 默认解析会走的
 * node_modules 查找链，只是不少数情况下会因为上面那个 exports bug 走偏），
 * 然后改用这个 package.json 里 "module" 字段指向的 esm-bundler 产物（纯 ESM
 * 语法，具名导出没有歧义）。全程不碰项目的任何 package.json。
 *
 * 额外处理 "vue" 这个裸标识符：本项目用 `vue-next`（npm alias）同时装了 3.5.44
 * （顶层 "vue"）和 3.6.0-rc.12（"vue-next"）两个版本，是本仓库特有的并存方式。
 * compiler-vapor 编译产物里 vapor 专属 helper（template/child/next/...）默认
 * 从 'vue' 导入，而 3.6 的 "vue" 包本身 `export * from "@vue/runtime-vapor"`、
 * `export * from "@vue/runtime-dom"`，一份 import 就能拿到全部 API。为了不让
 * 这份"假装是 vue@3.6 的 'vue'"意外解析成项目里真正的 3.5.44，这里把裸的 "vue"
 * 专门指向 vue-next（3.6）包自己的 esm-bundler 产物。只在本章示例脚本里生效。
 */
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

const VUE_SCOPED_PACKAGES = new Set([
  '@vue/runtime-dom',
  '@vue/runtime-core',
  '@vue/runtime-vapor',
  '@vue/reactivity',
  '@vue/shared',
])

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'vue' && context.parentURL && context.parentURL.includes('.vapor-scratch')) {
    // 只重写"我们自己生成的临时 vapor 组件文件"里的 'vue' import，
    // 不影响这个进程里其他正常 import 'vue'（3.5.44）的代码
    const require = createRequire(import.meta.url)
    const pkgJsonPath = require.resolve('vue-next/package.json')
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
    const url = pathToFileURL(join(dirname(pkgJsonPath), pkgJson.module)).href
    return { url, shortCircuit: true }
  }
  if (VUE_SCOPED_PACKAGES.has(specifier) && context.parentURL) {
    try {
      const requireFromParent = createRequire(fileURLToPath(context.parentURL))
      const pkgJsonPath = requireFromParent.resolve(`${specifier}/package.json`)
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
      const url = pathToFileURL(join(dirname(pkgJsonPath), pkgJson.module)).href
      return { url, shortCircuit: true }
    } catch {
      // 解析失败就让默认流程处理（例如这次调用方其实用的是 3.5.44）
    }
  }
  return nextResolve(specifier, context)
}
