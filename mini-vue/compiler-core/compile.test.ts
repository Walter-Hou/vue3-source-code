/**
 * 对应源码位置：packages/compiler-core/__tests__/*.spec.ts（精简整合为一个文件）
 *
 * 分三类断言：
 * 1. AST 结构（parse 对不对）
 * 2. codegen 产物字符串（transform + generate 对不对）
 * 3. 真的用 `new Function('Vue', code)` 把产物实例化，接上 @vue/runtime-core 的
 *    真实运行时（reactivity + renderer），验证"编译产物能跑，而且 patchFlag
 *    驱动的靶向更新确实生效"——这是本章最想让读者确认的事情。
 */
import { describe, expect, it } from 'vitest'
import * as Vue from '@vue/runtime-core'
import {
  createRoot,
  render as hostRender,
  serializeInner,
  dumpOps,
  resetOps,
  desc,
} from '@shared/logging-renderer'
import { baseParse } from './parse'
import { compile } from './compile'
import { NodeTypes, ElementTypes } from './ast'

function compileToRenderFn(template: string) {
  const { code } = compile(template)
  return new Function('Vue', code)(Vue) as (ctx: any, cache: any[]) => any
}

describe('mini-vue/compiler-core: parse', () => {
  it('解析元素、静态属性、文本', () => {
    const ast = baseParse(`<div id="app">hello</div>`)
    expect(ast.children).toHaveLength(1)
    const el = ast.children[0]
    expect(el.type).toBe(NodeTypes.ELEMENT)
    if (el.type !== NodeTypes.ELEMENT) throw new Error('unreachable')
    expect(el.tag).toBe('div')
    expect(el.tagType).toBe(ElementTypes.ELEMENT)
    expect(el.props).toEqual([{ type: NodeTypes.ATTRIBUTE, name: 'id', value: 'app' }])
    expect(el.children).toEqual([{ type: NodeTypes.TEXT, content: 'hello' }])
  })

  it('解析插值表达式', () => {
    const ast = baseParse(`{{ msg }}`)
    expect(ast.children).toHaveLength(1)
    const node = ast.children[0]
    expect(node.type).toBe(NodeTypes.INTERPOLATION)
    if (node.type !== NodeTypes.INTERPOLATION) throw new Error('unreachable')
    expect(node.content).toEqual({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: 'msg',
      isStatic: false,
    })
  })

  it('把 :xxx 解析成 bind 指令，@xxx 解析成 on 指令', () => {
    const ast = baseParse(`<div :id="foo" @click="onClick"></div>`)
    const el = ast.children[0]
    if (el.type !== NodeTypes.ELEMENT) throw new Error('unreachable')
    expect(el.props).toEqual([
      {
        type: NodeTypes.DIRECTIVE,
        name: 'bind',
        arg: 'id',
        exp: { type: NodeTypes.SIMPLE_EXPRESSION, content: 'foo', isStatic: false },
      },
      {
        type: NodeTypes.DIRECTIVE,
        name: 'on',
        arg: 'click',
        exp: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'onClick',
          isStatic: false,
        },
      },
    ])
  })

  it('自闭合标签不会把后面的内容当成子节点', () => {
    const ast = baseParse(`<div><br/>after</div>`)
    const div = ast.children[0]
    if (div.type !== NodeTypes.ELEMENT) throw new Error('unreachable')
    expect(div.children).toHaveLength(2)
    expect(div.children[0]).toMatchObject({ type: NodeTypes.ELEMENT, tag: 'br' })
    expect(div.children[1]).toMatchObject({ type: NodeTypes.TEXT, content: 'after' })
  })
})

describe('mini-vue/compiler-core: compile (transform + codegen)', () => {
  it('静态元素 + 静态文本：没有 patchFlag，产物只用到 createElementBlock', () => {
    const { code } = compile(`<div>hello</div>`)
    expect(code).toBe(
      [
        `const _Vue = Vue`,
        `return function render(_ctx, _cache) {`,
        `  with (_ctx) {`,
        `    const { openBlock: _openBlock, createElementBlock: _createElementBlock } = _Vue`,
        `    return (_openBlock(), _createElementBlock("div", null, "hello"))`,
        `  }`,
        `}`,
      ].join('\n'),
    )
  })

  it('单个插值子节点：TEXT patchFlag(1)，children 直接是 toDisplayString(...) 而不是数组', () => {
    const { code, ast } = compile(`<div>{{ msg }}</div>`)
    expect(code).toContain(
      '_createElementBlock("div", null, _toDisplayString(msg), 1)',
    )
    const div = ast.children[0]
    if (div.type !== NodeTypes.ELEMENT) throw new Error('unreachable')
    expect(div.codegenNode?.type).toBe(NodeTypes.VNODE_CALL)
  })

  it(':class 之类的动态属性会算进 PROPS patchFlag(8) 并记录 dynamicProps', () => {
    const { code } = compile(`<div :class="cls">hi</div>`)
    expect(code).toContain('createElementBlock("div", { class: cls }, "hi", 8, ["class"])')
  })

  it('v-if/v-else 编译成三元表达式，并且分支各自拿到不同的 key', () => {
    const { code } = compile(`<p v-if="ok">YES</p><p v-else>NO</p>`)
    expect(code).toContain('ok ? (')
    expect(code).toContain('{ key: 0 }, "YES"')
    expect(code).toContain('{ key: 1 }, "NO"')
  })

  it('多根节点编译成 Fragment block', () => {
    const { code } = compile(`<span>A</span><span>B</span>`)
    expect(code).toContain('_createElementBlock(_Fragment, null, [')
  })
})

describe('mini-vue/compiler-core: 编译产物接上真实运行时', () => {
  it('new Function(Vue, code) 产出的 render 函数可以直接喂给 @vue/runtime-core 渲染', () => {
    const render = compileToRenderFn(`<div id="app" :class="cls">count: {{ count }}</div>`)
    const root = createRoot()
    resetOps()
    hostRender(render({ count: 0, cls: 'a' }, []), root)
    expect(serializeInner(root)).toBe('<div id="app" class="a">count: 0</div>')
    const div = desc(root.children[0] as any)
    expect(dumpOps()).toEqual([
      `createElement(div) -> ${div}`,
      `setElementText(${div}, "count: 0")`,
      `patchProp(${div}, id: null -> "app")`,
      `patchProp(${div}, class: null -> "a")`,
      `insert(${div} -> ${desc(root)})`,
    ])
  })

  it('PROPS/TEXT patchFlag 驱动的更新是"targeted"的：只 patch 变化的 prop 和文本，不重新创建元素', () => {
    const render = compileToRenderFn(`<div id="app" :class="cls">count: {{ count }}</div>`)
    const root = createRoot()
    hostRender(render({ count: 0, cls: 'a' }, []), root)
    const div = desc(root.children[0] as any)
    resetOps()
    hostRender(render({ count: 1, cls: 'b' }, []), root)
    // 没有 createElement / remove：说明走的是 patchElement 的靶向更新，不是整节点替换
    expect(dumpOps()).toEqual([
      `patchProp(${div}, class: "a" -> "b")`,
      `setElementText(${div}, "count: 1")`,
    ])
  })

  it('v-if/v-else 切换时，key 的差异迫使运行时 remove 旧节点、insert 新节点（而不是原地改文字）', () => {
    const render = compileToRenderFn(`<p v-if="ok">YES</p><p v-else>NO</p>`)
    const root = createRoot()
    hostRender(render({ ok: true }, []), root)
    expect(serializeInner(root)).toBe('<p>YES</p>')
    resetOps()
    hostRender(render({ ok: false }, []), root)
    expect(serializeInner(root)).toBe('<p>NO</p>')
    const ops = dumpOps()
    expect(ops.some(op => op.startsWith('remove('))).toBe(true)
    expect(ops.some(op => op.startsWith('createElement(p)'))).toBe(true)
  })

  it('@click 编译出的事件处理函数在真实渲染器下可以被触发', () => {
    const render = compileToRenderFn(`<button @click="onClick">{{ n }}</button>`)
    const root = createRoot()
    let clicked = 0
    const ctx = {
      n: 0,
      onClick() {
        clicked++
      },
    }
    hostRender(render(ctx, []), root)
    const btn = root.children[0]
    // 直接从 logging-renderer 的内部结构里取出注册的 click 监听器并调用
    ;(btn as any).listeners.click()
    expect(clicked).toBe(1)
  })
})
