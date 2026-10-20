# vue3-source-code

> 给已经读过 Vue 2 源码的人准备的 Vue 3 源码精读：逐章拆解、有图、有可运行示例、有对照 Vue 2 的 mini 实现。

基准版本：**Vue 3.5.44**（2026-10 npm `latest`）。第 16 章额外前瞻 3.6（写作时为 `3.6.0-rc.12`）。

## 这是什么

17 章内容，覆盖响应式系统、运行时核心（VNode/组件/渲染器/调度器）、编译器三件套（compiler-core/compiler-dom/compiler-sfc）、内置组件、运行时 DOM 层、SSR/hydration，最后前瞻 3.6 的 Vapor 模式。每一章都遵循同一个结构：

1. **先跑起来**——一个可以直接执行的 TypeScript 脚本，把本章要讲的内部状态打印出来。
2. **源码精读**——贴真实源码片段（标注文件路径和行号），讲"为什么这样设计"。
3. **与 Vue 2 对比**——具体点名 Vue 2 对应的文件/类/函数，讲清楚改了什么、为什么改。
4. **动手实验**——核心模块配了 `mini-vue` 精简实现，文件名/函数名和源码保持一致。

所有示例都已经实际跑通，README 里贴的"预期输出"就是真实运行结果，不是手写的。

## 快速开始

```bash
pnpm install

# 跑一个示例（基于 tsx，支持顶层 await）
pnpm ex chapters/02-reactive/examples/01-proxy-vs-defineProperty.ts

# 跑 mini-vue 的全部测试
pnpm test

# 类型检查
pnpm typecheck

# 打开需要真实浏览器的 playground 页面
pnpm play
```

不知道从哪开始？先看 [`chapters/00-guide`](chapters/00-guide/README.md)——里面有推荐阅读顺序、环境说明、调试源码的建议。

## 目录

| 章 | 主题 |
|---|---|
| [00](chapters/00-guide/README.md) | 导读：学习路线、工具、怎么调试源码 |
| [01](chapters/01-architecture/README.md) | 整体架构：monorepo 包依赖图、构建产物、与 Vue 2 对比 |
| [02](chapters/02-reactive/README.md) | `reactive` 与 Proxy handlers |
| [03](chapters/03-effect-dep/README.md) | `ReactiveEffect`、Dep/Link 双向链表、版本号机制 |
| [04](chapters/04-ref-computed-watch/README.md) | `ref` 家族、`computed`、`watch`/`watchEffect` |
| [05](chapters/05-vnode-createapp/README.md) | VNode、ShapeFlags/PatchFlags、`createApp().mount()` |
| [06](chapters/06-component/README.md) | 组件实例、`setup`、生命周期、组件更新 |
| [07](chapters/07-renderer-diff/README.md) | 渲染器与 diff：`patch`、`patchKeyedChildren`、Block 快速路径 |
| [08](chapters/08-scheduler/README.md) | 调度器与 `nextTick`：批处理、pre/post flush、递归保护 |
| [09](chapters/09-props-emits-slots/README.md) | props / emits / slots / attrs / provide-inject |
| [10](chapters/10-builtin-components/README.md) | 内置组件：KeepAlive / Teleport / Suspense / Transition / 异步组件 |
| [11](chapters/11-compiler-core/README.md) | compiler-core：parse → transform → codegen |
| [12](chapters/12-compiler-optimization/README.md) | 编译优化：Block tree、PatchFlags、缓存、指令 transform |
| [13](chapters/13-compiler-sfc/README.md) | 单文件组件编译：compiler-sfc |
| [14](chapters/14-runtime-dom/README.md) | runtime-dom：平台层实现 |
| [15](chapters/15-ssr-hydration/README.md) | 服务端渲染与激活：SSR / Hydration |
| [16](chapters/16-vapor-future/README.md) | 3.6 前瞻：Vapor 模式与新响应式 |

每章的具体收获和示例清单见各自 README 开头的"本章导读"。

## 项目结构

```
vue3-source-code/
├── chapters/           每章一个目录：README.md + examples/*.ts
├── mini-vue/           响应式、渲染器 diff、调度器、编译器的精简实现 + vitest 测试
├── shared/             示例公用工具（见下）
├── playground/         需要真实浏览器的 demo（Vite 多页应用，`pnpm play` 打开）
└── docs/               写作规范（给想补写章节的人看，读者可以跳过）
```

两个核心公用工具：

- **`shared/print.ts`**：统一示例输出格式，`section`/`step`/`log`/`expectEq`。
- **`shared/logging-renderer.ts`**：接在 `@vue/runtime-core` 的 `createRenderer` 上的"假 DOM"，把每一次宿主操作（`createElement`/`insert`/`patchProp`/...）都记录下来，能在 Node 里直接"看见"渲染器做了什么。涉及真实 DOM API 的章节另有 `shared/dom.ts`（基于 happy-dom）。

## 读者假设

默认你已经读过 Vue 2（2.x/2.7）的源码，熟悉 `Object.defineProperty` + `Dep`/`Watcher`、双端 diff、`parse → optimize → generate` 编译流程、`nextTick` 异步队列、`_init → $mount` 组件初始化顺序。如果还不熟，建议先过一遍 Vue 2.7 源码——它结构更简单，是理解 Vue 3 改动动机的最佳参照系。

## 写作规范

如果想给这个仓库补写章节或提 PR，先看 [`docs/CHAPTER_GUIDE.md`](docs/CHAPTER_GUIDE.md)，里面定义了每章的固定结构、源码引用格式、示例质量要求。
