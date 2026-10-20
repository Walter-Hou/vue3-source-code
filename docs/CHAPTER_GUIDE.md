# 章节写作规范（CHAPTER_GUIDE）

本文件定义每一章的结构、口径与质量要求。所有章节都按它来写，读者也可以按它来补充章节。

## 0. 基本口径

| 项 | 约定 |
|---|---|
| 源码版本 | **Vue 3.5.44**（npm `latest`，2026-10）。3.6 的 Vapor 只在前瞻章节出现 |
| 读者画像 | **有 Vue 2 源码基础**：熟悉 `Object.defineProperty` + `Dep/Watcher`、双端 diff、`parse/optimize/generate`、`nextTick` 队列、Options API 初始化流程。因此每章都要有「与 Vue 2 对比」，讲清楚**为什么改、改成了什么、代价是什么** |
| 语言 | 中文讲解，技术术语/标识符保留英文 |
| 源码引用格式 | `packages/reactivity/src/dep.ts`（相对 vuejs/core 仓库根目录），需要时加行号区间 `#L24-L60`。**代码片段必须来自真实源码**，可删减但要用 `// ...` 标注省略；不要凭记忆编造函数名或逻辑 |
| 图示 | Mermaid（GitHub / VS Code 自带预览均可渲染）。**每章至少 3 张**：整体结构图 1 张 + 核心流程图/时序图 ≥ 2 张。复杂数据结构（链表、树）再配一张 ASCII 图 |
| 示例 | `chapters/<章>/examples/NN-<topic>.ts`，用 `pnpm ex <路径>` 直接运行。**每个示例必须实际跑通**，README 里给出运行命令与关键预期输出 |
| mini 实现 | `mini-vue/<package>/<与源码同名文件>.ts` + `*.test.ts`，`pnpm test` 通过。函数名、关键变量名与源码保持一致，文件头注释标注「对应源码位置」 |

## 1. 目录结构

```
vue3-source-code/
├── README.md                  # 总览、学习路线、运行方式
├── docs/CHAPTER_GUIDE.md      # 本文件
├── chapters/
│   └── NN-topic/
│       ├── README.md          # 讲解正文（必须）
│       ├── examples/          # 可运行示例（必须，≥ 3 个）
│       │   └── 01-xxx.ts
│       └── assets/            # 可选：补充图片、ASCII 图
├── mini-vue/                  # 与源码对照的精简实现
│   ├── reactivity/
│   ├── runtime-core/
│   └── compiler-core/
├── shared/                    # 示例公用工具
│   ├── print.ts               # section / step / log / expectEq / tick
│   └── logging-renderer.ts    # 打日志的自定义渲染器（在 Node 里观察宿主操作）
└── playground/                # Vite 多页 demo（需要真实浏览器的示例放这里）
    ├── index.html
    └── pages/NN-xxx.html
```

## 2. 每章 README 的固定结构

```markdown
# NN. 章节标题

> 一句话说明本章解决的问题。

## 本章导读
- 学完能回答什么问题（3~5 条）
- 前置章节 / 预计阅读时间
- 涉及源码文件清单（表格：文件 | 作用 | 行数量级）

## 先跑起来
运行示例的命令 + 关键输出截取 + 一句话点出「看到了什么」。
（目的：先有体感，再读源码）

## 整体图
一张 Mermaid 图（结构图或调用链总览）+ 文字解说。

## 源码精读
按调用链拆小节（### 2.1 / 2.2 ...）。每小节：
1. 源码片段（标注文件与行号，删减用 // ...）
2. 逐段解释（讲设计意图，不复述代码）
3. 需要时配图（流程图 / 时序图 / 数据结构变化前后对比）

## 与 Vue 2 对比
表格列出差异点 + 每一条的「为什么这么改」。

## 动手：mini 实现 / 实验
- mini-vue 对应文件与测试命令
- 建议读者自己改一改的实验点（2~3 个）

## 常见疑问
面试高频 + 实践坑，Q/A 形式，每条答案 ≤ 150 字并指向源码位置。

## 小结
要点清单（5~8 条）。

## 延伸阅读
RFC / PR / issue / 官方文档链接（真实链接，不要编）。

## 思考题
2~3 题，答案放在 <details> 里。
```

## 3. 写作要求

- **讲清楚设计意图**，不要逐行翻译代码。读者能自己读代码，读者需要的是「为什么这样写」「这一步在解决什么问题」。
- **一段一个点**。每段不超过 6 行。
- **以调用链为线索**：从入口 API（如 `reactive()` / `createApp().mount()` / `compile()`）出发，顺着调用一层层往下，让读者能在脑子里跑通一次。
- **示例要能「看见」内部状态**：打印 dep 结构、打印 vnode 的 `shapeFlag/patchFlag`、打印渲染器收到的宿主操作、打印编译产物。只演示 API 用法的示例没有价值。
- **图要画机制**：数据结构的前后变化、函数之间的调用关系、时间顺序。装饰性的图不要画。
- **Vue 2 对比必须具体**：对应到 Vue 2 的文件/类（如 `src/core/observer/dep.js` 的 `Dep`、`watcher.js` 的 `Watcher`、`vdom/patch.js` 的 `updateChildren`）。
- **不确定就去看源码**（本地 clone 的 vuejs/core v3.5.44），不要猜。
- 示例文件头部固定注释：
  ```ts
  /**
   * 运行：pnpm ex chapters/02-reactive/examples/01-proxy-vs-defineProperty.ts
   * 演示：……（一两句）
   * 看点：……（读者应该注意输出里的什么）
   */
  ```
- 示例用 `shared/print.ts` 的 `section/step/log/expectEq` 组织输出；需要观察渲染器行为时用 `shared/logging-renderer.ts`。
- 示例中的导入：响应式 API 从 `@vue/reactivity` 或 `vue` 导入均可；需要配合 logging-renderer 的示例，`h/ref/nextTick` 等从 `@vue/runtime-core` 或 `vue` 导入（同一份实例，两者等价）。
- mini 实现只保留主干逻辑，去掉开发期警告、兼容分支、边缘情况，但**保留源码的函数划分和命名**，让读者能一一对照。

## 4. 章节清单

| 章 | 目录 | 主题 | 核心源码 |
|---|---|---|---|
| 00 | `00-guide` | 导读：学习路线、如何调试源码、工具 | — |
| 01 | `01-architecture` | 整体架构：monorepo、包依赖、构建产物、与 Vue 2 对比 | `packages/*/package.json`、`scripts/build.js`、`rollup.config.js` |
| 02 | `02-reactive` | `reactive` 与 Proxy handlers、数组/集合拦截、`track/trigger` 入口 | `reactivity/src/reactive.ts`、`baseHandlers.ts`、`collectionHandlers.ts`、`arrayInstrumentations.ts` |
| 03 | `03-effect-dep` | `ReactiveEffect`、`Dep/Link` 双向链表、版本号机制、batch、`effectScope` | `reactivity/src/effect.ts`、`dep.ts`、`effectScope.ts` |
| 04 | `04-ref-computed-watch` | `ref` 家族、`computed`、`watch/watchEffect` | `reactivity/src/ref.ts`、`computed.ts`、`watch.ts`、`runtime-core/src/apiWatch.ts` |
| 05 | `05-vnode-createapp` | VNode、ShapeFlags/PatchFlags、`h/createVNode`、`createApp().mount()` | `runtime-core/src/vnode.ts`、`h.ts`、`apiCreateApp.ts`、`shared/src/shapeFlags.ts`、`patchFlags.ts` |
| 06 | `06-component` | 组件实例、`setup`、公共实例代理、Options API 兼容、生命周期、组件更新 | `runtime-core/src/component.ts`、`componentPublicInstance.ts`、`componentOptions.ts`、`apiLifecycle.ts`、`renderer.ts`(mountComponent/setupRenderEffect) |
| 07 | `07-renderer-diff` | `patch` 分派、元素挂载/更新、`patchKeyedChildren` + LIS、Block 快速路径、unmount | `runtime-core/src/renderer.ts` |
| 08 | `08-scheduler` | 调度队列、`nextTick`、pre/post flush、递归更新保护 | `runtime-core/src/scheduler.ts` |
| 09 | `09-props-emits-slots` | props 规范化与更新、emits、slots、attrs 透传、provide/inject、`defineModel` 运行时 | `componentProps.ts`、`componentEmits.ts`、`componentSlots.ts`、`apiInject.ts`、`apiSetupHelpers.ts`、`componentRenderUtils.ts` |
| 10 | `10-builtin-components` | KeepAlive、Teleport、Suspense、Transition、`defineAsyncComponent` | `runtime-core/src/components/*`、`apiAsyncComponent.ts` |
| 11 | `11-compiler-core` | parse（tokenizer 状态机）、AST、transform、codegen | `compiler-core/src/tokenizer.ts`、`parser.ts`、`ast.ts`、`transform.ts`、`codegen.ts`、`compile.ts` |
| 12 | `12-compiler-optimization` | Block tree、PatchFlags 生成、`cacheStatic`、v-if/v-for/v-slot/v-model/v-on transform | `compiler-core/src/transforms/*` |
| 13 | `13-compiler-sfc` | SFC parse、`compileScript`（`<script setup>` 宏）、`compileTemplate`、`compileStyle` | `compiler-sfc/src/*` |
| 14 | `14-runtime-dom` | nodeOps、patchProp（class/style/attr/prop/event）、事件系统、v-model/v-show 指令、Transition DOM、自定义元素 | `runtime-dom/src/*` |
| 15 | `15-ssr-hydration` | `renderToString`、SSR 编译（compiler-ssr）、客户端 hydration | `server-renderer/src/*`、`compiler-ssr/src/*`、`runtime-core/src/hydration.ts` |
| 16 | `16-vapor-future` | 3.6 前瞻：Vapor 模式、alien-signals 响应式、与 3.5 的关系 | 3.6 分支 `packages/runtime-vapor`、`compiler-vapor`（只做概览） |
