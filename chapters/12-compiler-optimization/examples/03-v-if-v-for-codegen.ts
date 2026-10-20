/**
 * 运行：pnpm ex chapters/12-compiler-optimization/examples/03-v-if-v-for-codegen.ts
 * 演示：v-if/v-else(-if)/v-for 的真实编译产物——分支 key 的自动注入、没有 v-else 时的
 *       注释占位、Fragment 的三种 flag（STABLE/KEYED/UNKEYED）、openBlock(true)，
 *       以及 v-if + v-for 同时出现在一个元素上时谁包谁。
 * 看点：
 *  1. 每个 v-if/v-else-if/v-else 分支的根 vnode 都会被塞一个 `key: N`（N 从 0 递增），
 *     哪怕分支内容是纯静态文本——这是为了让 isSameVNodeType 判定为"不同节点"，强制
 *     remove+insert 而不是误判成"同一个元素，只是内容变了"（vIf.ts#L246-254）。
 *  2. 没写 v-else 时，compiler 会补一个 `createCommentVNode("v-if", true)` 作为占位，
 *     保证这个位置在条件为 false 时也有一个"锚点"节点，分支切换不会打乱兄弟节点顺序。
 *  3. v-for 的 Fragment 永远是 block（isBlock=true），`openBlock(fragmentFlag !== STABLE)`
 *     ——也就是 openBlock(true) 关闭自身 tracking（上一个示例已经验证了效果）。
 *  4. v-if 和 v-for 写在同一个标签上时，transformIf 在 nodeTransforms 数组里排在
 *     transformFor 前面，先把元素包成 IfNode；v-for 是在被包起来之后，作为 IfNode
 *     分支的子节点被重新遍历时才处理的——所以产物是"外层三元表达式，内层 renderList"。
 */
import { compile } from '@vue/compiler-dom'
import { section, step, log } from '../../../shared/print'

section('1. v-if / v-else：key 注入 + 没有 v-else 时的注释占位')
step('<p v-if="ok">YES</p><p v-else>NO</p>')
log(compile(`<p v-if="ok">YES</p><p v-else>NO</p>`).code)

step('只有 v-if，没有 v-else：补一个 createCommentVNode 占位')
log(compile(`<p v-if="ok">YES</p>`).code)

step('v-if / v-else-if / v-else 三段：key 依次是 0 / 1 / 2')
log(compile(`<p v-if="a">A</p><p v-else-if="b">B</p><p v-else>C</p>`).code)

section('2. v-for 的三种 Fragment flag')
step('不带 key -> UNKEYED_FRAGMENT(256)')
log(compile(`<ul><li v-for="n in list">{{ n }}</li></ul>`).code)

step('带 :key -> KEYED_FRAGMENT(128)')
log(compile(`<ul><li v-for="n in list" :key="n.id">{{ n.text }}</li></ul>`).code)

step('遍历范围 `in 5`（编译期能确定是稳定的整数范围）-> STABLE_FRAGMENT(64) 需要 mode: module 才会判定')
log(compile(`<li v-for="n in 5">{{ n }}</li>`, { mode: 'module' }).code)

section('3. <template v-for> 多子节点：每一轮循环包一层 Fragment')
log(
  compile(
    `<template v-for="item in list" :key="item.id"><dt>{{ item.term }}</dt><dd>{{ item.desc }}</dd></template>`,
  ).code,
)

section('4. v-if + v-for 同时出现：v-if 在外层，v-for 在内层（3.x 的优先级）')
log(compile(`<li v-if="show" v-for="n in list">{{ n }}</li>`).code)
