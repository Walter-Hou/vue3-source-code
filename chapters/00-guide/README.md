# 00. 导读

> 这不是一本"抄一遍源码"的书，是一条从你已经会的 Vue 2 源码出发，走到 Vue 3.5.44 源码内部的路径。

## 这套材料是什么

`vue3-source-code` 逐章拆解 Vue 3（以 npm `latest` 标签对应的 **3.5.44** 为准）的源码，覆盖响应式系统、运行时核心、渲染器与调度器、编译器三件套（compiler-core/compiler-dom/compiler-sfc）、内置组件、运行时 DOM 层、SSR/hydration，最后前瞻一下 3.6（rc 阶段）的 Vapor 模式。

每一章都是同一个套路：

1. **先跑起来**——一段可以直接执行的示例，把本章要讲的内部状态打印出来，给你一个"长什么样"的直觉。
2. **源码精读**——贴真实源码片段（标注文件路径和行号），顺着调用链讲"为什么这样设计"，不逐行翻译代码。
3. **与 Vue 2 对比**——既然你已经读过 Vue 2 源码，每章都会具体点名 Vue 2 对应的文件/类/函数，讲清楚"改了什么、为什么改、代价是什么"。
4. **动手实验**——对响应式系统、渲染器 diff、调度器、编译器这几个最核心的模块，配了一份 `mini-vue` 精简实现，文件名、函数名、变量名都和源码保持一致，方便对照着读，也方便你自己改着玩。

## 读者假设

默认你已经读过 Vue 2（2.x/2.7）的源码，至少熟悉：

- `Object.defineProperty` 递归劫持 + `Dep`/`Watcher` 的发布订阅模型；
- `vdom/patch.js` 的双端比较 diff 算法；
- `compiler/parser` → `optimizer` → `codegen` 三段式编译流程；
- `nextTick` 的异步队列和 `Watcher` 的调度机制；
- `_init` → `$mount` 的组件初始化顺序。

如果这些你还不熟，建议先过一遍 Vue 2.7 的源码（它结构更简单，是理解 Vue 3 改动动机的最佳参照系）。

## 怎么读

### 推荐顺序

按章节编号从 02 读到 16 是默认顺序，但不是唯一顺序。三条主线，挑你最想搞懂的先读：

```
响应式内核        运行时渲染                编译器
02 reactive       05 vnode/createApp        11 compiler-core
03 effect/dep  →  06 component          →   12 compiler-optimization
04 ref/computed   07 renderer/diff          13 compiler-sfc
   /watch          08 scheduler
                   09 props/emits/slots
                   10 内置组件
                   14 runtime-dom
                                             15 ssr/hydration（依赖运行时+编译器两条线）
                                             16 vapor 前瞻（依赖响应式+编译器两条线）
```

如果你的目标很具体，比如"只想搞懂 diff 算法"，可以直接跳到第 07 章，遇到不认识的概念（VNode/ShapeFlags/PatchFlags）再回头翻第 05 章。每章开头的"本章导读"都列了前置知识。

### 每章怎么用

1. 先别看源码精读，直接把"先跑起来"里的示例跑一遍，照着看点去读终端输出。
2. 带着"这个输出是怎么来的"这个问题，再去看源码精读部分。
3. 看"与 Vue 2 对比"，确认自己真的理解了"为什么要改"，而不只是"改成了什么样"。
4. 如果这章有 mini 实现，去跑一下对应的测试，然后试着改一两处 README 里提的实验点，看会发生什么。
5. 最后看"常见疑问"和"思考题"，检验理解程度。

## 环境与工具

### 目录结构

```
vue3-source-code/
├── chapters/           每章一个目录：README.md + examples/
├── mini-vue/           响应式、渲染器 diff、调度器、编译器的精简实现 + 测试
├── shared/             示例公用工具（见下）
├── playground/         需要真实浏览器的 demo（Vite 多页应用）
└── docs/               写作规范（给贡献者看的，读者可以跳过）
```

### 跑示例

```bash
pnpm install                                    # 第一次使用需要先装依赖
pnpm ex chapters/02-reactive/examples/01-xxx.ts  # 跑一个示例（基于 tsx，支持顶层 await）
pnpm test                                        # 跑 mini-vue 的全部测试（vitest）
pnpm typecheck                                   # 类型检查
pnpm play                                        # 打开需要真实浏览器的 playground 页面
```

### 两个公用工具

**`shared/print.ts`**——统一示例输出格式的小工具。`section(title)` 开始一段新演示，`step(desc)` 标注"接下来做什么"，`log(...)` 打印内容，`expectEq(label, actual, expected)` 做一个带 ✓/✗ 标记的断言式输出，`tick()`/`sleep(ms)` 用于演示异步时序。几乎每个示例都会用到它。

**`shared/logging-renderer.ts`**——一个接在 `@vue/runtime-core` 的 `createRenderer` 上的"假 DOM"。它不是真的操作浏览器 DOM，而是把 `createElement`/`insert`/`remove`/`setElementText`/`patchProp` 等每一次宿主操作都记录下来，再配合 `serialize()` 把内存里的树打印成 HTML 字符串。为什么需要它：runtime-core 本身是平台无关的，真实源码靠一套叫 `RendererOptions` 的接口和 DOM 解耦，官方仓库里也有一个类似用途的私有包 `packages/runtime-test`（没有发布到 npm）。用它能在 Node 里直接"看见"渲染器做了什么，而不需要打开浏览器、也不需要猜 diff 到底有没有少做几次 DOM 操作。

涉及真实 DOM API（`runtime-dom`、hydration、自定义元素）的章节还会用到 `shared/dom.ts`，它用 happy-dom 在 Node 里造一个足够用的 DOM 环境。

### 调试源码的建议

1. **本地跑官方仓库的测试**：`git clone https://github.com/vuejs/core`，切到 `v3.5.44` 标签，`pnpm install && pnpm test`，对着某个 `__tests__` 目录单测一个模块，比 看源码更快建立直觉。
2. **用 `console.log` 或断点，不要只靠眼睛读**：响应式系统和调度器里有大量"状态机式"的标志位（`EffectFlags`、`SchedulerJobFlags`），光看代码很难建立直觉，跑起来看状态变化快得多。
3. **装 Vue Devtools**：对组件实例、依赖关系的可视化非常有用，尤其是调试 `provide/inject`、`KeepAlive` 缓存这类"看不见摸不着"的内部状态时。
4. **本仓库的示例就是最小复现**：如果你怀疑自己对某个机制的理解不对，照着某个示例的写法现改一版去验证，比空想靠谱。

## 版本说明

- 正文统一基于 **Vue 3.5.44**（2026-10 npm `latest`）。
- 第 16 章前瞻 **3.6**（写作时为 `3.6.0-rc.12`），标注了哪些内容"待正式版确认"。
- 示例代码里 `import ... from 'vue'` 和 `import ... from '@vue/reactivity'`（等各个子包）是同一份实现，二者等价，用哪个只是看示例想强调"用户视角的 API"还是"内部包的边界"。

## 下一步

从第 01 章开始，先搞清楚 Vue 3 这个 monorepo 是怎么组织的、各个包之间的依赖关系，再一路往下拆到响应式系统。
