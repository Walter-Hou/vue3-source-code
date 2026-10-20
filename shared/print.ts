/**
 * 示例输出的小工具：让每个示例的终端输出结构一致、便于对照 README。
 *
 * 用法：
 *   import { section, step, log, inspect } from '../../../shared/print'
 *   section('1. 基本 reactive')
 *   step('修改 state.count')
 *   log('effect 运行次数 =', runs)
 */
import { inspect as nodeInspect } from 'node:util'

let stepNo = 0

/** 大标题：一段演示的开始 */
export function section(title: string): void {
  stepNo = 0
  const line = '─'.repeat(Math.max(8, 60 - title.length))
  console.log(`\n┌${line} ${title}`)
}

/** 小步骤：描述「接下来做什么」 */
export function step(desc: string): void {
  stepNo++
  console.log(`│ ${String(stepNo).padStart(2, ' ')}. ${desc}`)
}

/** 普通输出：缩进两格，和 step 对齐 */
export function log(...args: unknown[]): void {
  const text = args
    .map(a => (typeof a === 'string' ? a : nodeInspect(a, { depth: 4, colors: false })))
    .join(' ')
  for (const l of text.split('\n')) console.log(`│      ${l}`)
}

/** 深度打印对象（不折叠） */
export function inspect(obj: unknown, depth = 6): string {
  return nodeInspect(obj, { depth, colors: false, compact: false })
}

/** 断言式输出：期望值对不上就显眼地标出来，便于读者核对 README 里的「预期输出」 */
export function expectEq(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`│      ${ok ? '✓' : '✗'} ${label}: ${nodeInspect(actual)}${ok ? '' : `  (期望 ${nodeInspect(expected)})`}`)
}

/** 等待一个微任务（用于演示 nextTick / 调度器批处理） */
export const tick = (): Promise<void> => Promise.resolve()

/** 等待若干毫秒 */
export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
