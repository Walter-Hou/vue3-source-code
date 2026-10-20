/**
 * 运行：pnpm ex chapters/11-compiler-core/examples/02-parse-edge-cases.ts
 * 演示：parser.ts 里几个容易被忽略的边界行为——whitespace condense vs preserve、
 *       实体解码、以及通过 onError 收集解析错误（未闭合标签 / 重复属性）而不是直接 throw。
 * 看点：
 *  1. condense（默认）会把"纯换行的空白文本"整个删掉，"夹在文字中间的空格"压缩成一个空格；
 *     preserve 则原样保留所有空白。
 *  2. 非浏览器构建下（我们用的 @vue/compiler-dom npm 包）实体解码由 tokenizer 自己完成，
 *     不依赖 decodeEntities 选项（那个选项只在 __BROWSER__ 构建里才会被用到）。
 *  3. baseParse 默认 onError 会直接 throw；传入自定义 onError 可以把错误收集起来，
 *     解析仍然继续（parser 会做"错误恢复"，比如把未闭合的标签当成在文件末尾自动闭合）。
 */
import { parse } from '@vue/compiler-dom'
import type { CompilerError } from '@vue/compiler-core'
import { ErrorCodes } from '@vue/compiler-core'
import { section, step, log } from '../../../shared/print'
import { printAST } from './_shared'

section('1. whitespace: condense（默认）')
step('标签间纯换行 -> 整段删除；文字中间的换行/多空格 -> 压成一个空格')
const template = `<div>
  <span>  a   b  </span>
  <span>c</span>
</div>`
printAST(parse(template))

section('2. whitespace: preserve')
step('同一段模板，原样保留所有空白文本节点')
printAST(parse(template, { whitespace: 'preserve' }))

section('3. 实体解码（非浏览器构建：tokenizer 内置的具名/数字字符引用表）')
step('文本节点里的 &amp; &lt; &#65; &#x42;')
printAST(parse(`<p>&amp; &lt; &#65; &#x42;</p>`))

section('4. 错误收集：onError 不中断解析')
step('重复属性 DUPLICATE_ATTRIBUTE')
{
  const errors: CompilerError[] = []
  const ast = parse(`<div id="a" id="b"></div>`, {
    onError: e => errors.push(e),
  })
  log(
    'errors =',
    errors.map(e => ErrorCodes[e.code as number]),
  )
  printAST(ast)
}

step('未闭合标签 X_MISSING_END_TAG：解析器在遇到父标签结束/文件结束时自动"隐式闭合"')
{
  const errors: CompilerError[] = []
  const ast = parse(`<div><span>oops</div>`, {
    onError: e => errors.push(e),
  })
  log(
    'errors =',
    errors.map(e => ErrorCodes[e.code as number]),
  )
  printAST(ast)
}

step('对比：默认 onError（defaultOnError）会直接 throw')
try {
  parse(`<div id="a" id="b"></div>`)
} catch (e) {
  log('捕获到异常：', (e as Error).message)
}
