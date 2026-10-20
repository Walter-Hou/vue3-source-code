/**
 * 运行：pnpm ex chapters/11-compiler-core/examples/01-parse-ast.ts
 * 演示：用 compiler-dom 的 parse() 把不同形态的模板解析成 AST，并用 printAST 打印出
 *       NodeTypes 名称 / tag / props / 指令 / 插值 / 注释 / 文本压缩 / v-pre / 自闭合 / textarea。
 * 看点：
 *  1. 属性与指令在 AST 里长什么样（ATTRIBUTE vs DIRECTIVE，v-bind/v-on 的 arg/modifiers）。
 *  2. whitespace: 'condense'（默认值）如何把标签之间的换行+缩进折叠成一个空格或直接删除。
 *  3. v-pre 区域里的指令会被当成普通属性保留原样，不会被解析成 DirectiveNode。
 *  4. <textarea> 是 RCDATA，内部的 `{{ }}` 不会被当成插值解析。
 *  5. loc（SourceLocation）记录了节点在原始模板字符串里的精确位置。
 */
import { parse } from '@vue/compiler-dom'
import { section, step, log } from '../../../shared/print'
import { printAST } from './_shared'

section('1. 基础元素 / 属性 / 指令 / 插值')
step('解析一个常见模板')
printAST(
  parse(`<div id="app" :class="cls" @click="onClick" v-if="visible">{{ msg }}</div>`),
)

section('2. 注释与自闭合标签')
step('解析 <!-- comment --> 与 <img/>')
printAST(parse(`<div><!-- a comment --><img src="x.png"/></div>`, { comments: true }))

section('3. 文本压缩（whitespace: condense，默认值）')
step('标签之间的纯换行+缩进会被处理掉')
printAST(
  parse(`<ul>
  <li>A</li>
  <li>B</li>
</ul>`),
)

section('4. v-pre：指令原样保留为 ATTRIBUTE')
step('v-pre 区域内的 v-xxx / {{ }} 都不会被解析')
printAST(parse(`<div v-pre>{{ not interpolated }} <span v-if="x"></span></div>`))

section('5. textarea/title 是 RCDATA，script/style 是纯文本（Raw Text）')
step('tokenizer.ts#stateInRCDATA 对 <title>/<textarea> 特殊处理：仍然识别 {{ }} 插值与实体')
printAST(parse(`<textarea>{{ msg }} &amp; more</textarea>`))
step('而 <script>/<style> 走 fastForwardTo，内部文本原样保留，{{ }} 不会被解析成插值')
printAST(parse(`<script>var a = {{ not_interpolation }}</script>`))

section('6. loc：节点在源码里的精确位置')
step('打印第一个元素的 loc')
const ast = parse(`<div id="app">hi</div>`)
const el = ast.children[0] as any
log({
  'el.loc.source': el.loc.source,
  'el.loc.start': el.loc.start,
  'el.loc.end': el.loc.end,
  'id attr nameLoc': el.props[0].nameLoc,
})
