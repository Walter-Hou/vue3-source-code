/**
 * 对应源码：packages/runtime-core/src/renderer.ts 的 patchKeyedChildren
 * 覆盖点：五步法里的每一步，以及"最少移动"的核心断言。
 */
import { describe, expect, it } from 'vitest'
import { type DiffNode, patchKeyedChildren } from './diff'

function nodes(keys: (string | number)[], type = 'div'): DiffNode[] {
  return keys.map(key => ({ key, type }))
}

/** 只取 move 操作的 key 列表，方便断言"移动了哪些节点" */
function moves(ops: ReturnType<typeof patchKeyedChildren>) {
  return ops.filter(op => op.kind === 'move').map(op => op.key)
}

describe('patchKeyedChildren (mini-vue)', () => {
  it('step 1+2: 纯头尾同步，中间替换 —— 只有中间的节点被 unmount+mount', () => {
    const ops = patchKeyedChildren(nodes(['a', 'b', 'c']), nodes(['a', 'x', 'c']))
    expect(ops).toEqual([
      { kind: 'patch', key: 'a' },
      { kind: 'patch', key: 'c' },
      { kind: 'unmount', key: 'b' },
      { kind: 'mount', key: 'x', anchor: 'c' },
    ])
  })

  it('step 3: common sequence + mount —— 纯新增，走头部同步后直接挂载', () => {
    const ops = patchKeyedChildren(nodes(['a', 'b']), nodes(['a', 'b', 'c', 'd']))
    expect(ops).toEqual([
      { kind: 'patch', key: 'a' },
      { kind: 'patch', key: 'b' },
      { kind: 'mount', key: 'c', anchor: null },
      { kind: 'mount', key: 'd', anchor: null },
    ])
  })

  it('step 3: 头部插入一个新节点 —— anchor 指向紧随其后的旧节点', () => {
    const ops = patchKeyedChildren(nodes(['a', 'b', 'c']), nodes(['z', 'a', 'b', 'c']))
    // 尾部同步命中 c, b, a（倒序），然后在剩余区间 [0, 0) 挂载 z，anchor = a
    expect(ops).toContainEqual({ kind: 'mount', key: 'z', anchor: 'a' })
    expect(ops.filter(op => op.kind === 'mount')).toHaveLength(1)
    expect(ops.filter(op => op.kind === 'unmount')).toHaveLength(0)
    expect(ops.filter(op => op.kind === 'move')).toHaveLength(0)
  })

  it('step 4: common sequence + unmount —— 纯删除，不产生 move', () => {
    const ops = patchKeyedChildren(nodes(['a', 'b', 'c', 'd']), nodes(['a', 'b']))
    expect(ops).toEqual([
      { kind: 'patch', key: 'a' },
      { kind: 'patch', key: 'b' },
      { kind: 'unmount', key: 'c' },
      { kind: 'unmount', key: 'd' },
    ])
  })

  it('step 5: 乱序 [a,b,c,d,e] -> [a,c,d,b,e,f] —— 只移动 b，新增 f', () => {
    const ops = patchKeyedChildren(
      nodes(['a', 'b', 'c', 'd', 'e']),
      nodes(['a', 'c', 'd', 'b', 'e', 'f']),
    )
    // 头尾同步各自命中 0 次（首尾都不相同类型位置），全部落入 5.2 的 patch
    expect(ops.filter(op => op.kind === 'patch')).toHaveLength(5)
    expect(ops).toContainEqual({ kind: 'mount', key: 'f', anchor: null })
    // 核心断言：LIS = [a, c, d, e]（a 在最前已固定，c/d/e 相对顺序不变），
    // 只有 b 需要移动 —— 这正是"最少移动"的体现
    expect(moves(ops)).toEqual(['b'])
  })

  it('step 5: 完全反转 —— LIS 长度为 1，n-1 个节点都要移动', () => {
    const old = ['a', 'b', 'c', 'd', 'e']
    const ops = patchKeyedChildren(nodes(old), nodes([...old].reverse()))
    expect(ops.filter(op => op.kind === 'patch')).toHaveLength(5)
    expect(ops.filter(op => op.kind === 'mount')).toHaveLength(0)
    // 反转后退化到几乎全量移动，只有一个节点能保持不动
    expect(moves(ops)).toHaveLength(4)
  })

  it('无 key 节点：按 type 相同的位置复用（对应源码"key-less node"分支）', () => {
    const old: DiffNode[] = [
      { key: undefined, type: 'div' },
      { key: undefined, type: 'span' },
    ]
    const next: DiffNode[] = [
      { key: undefined, type: 'span' },
      { key: undefined, type: 'div' },
    ]
    const ops = patchKeyedChildren(old, next)
    // 首尾各自的 type 都不同，sync 两步都立刻 break，落入 unknown sequence；
    // 在 5.2 里按 type 配对成功，两个节点都被 patch 复用，不会被卸载重建，
    // 但因为顺序被打乱（span 从位置1挪到位置0），仍需要一次 move
    expect(ops.filter(op => op.kind === 'patch')).toHaveLength(2)
    expect(ops.filter(op => op.kind === 'unmount')).toHaveLength(0)
    expect(ops.filter(op => op.kind === 'mount')).toHaveLength(0)
    expect(ops.filter(op => op.kind === 'move')).toHaveLength(1)
  })

  it('同 key 不同 type：patchKeyedChildren 本身按 key 盲配，不检查 type', () => {
    // 对应源码 L1997-1998：`if (prevChild.key != null) { newIndex =
    // keyToNewIndexMap.get(prevChild.key) }`——这里只用 key 查表，完全不比较
    // type。真正"类型不同就 unmount 旧的再 mount 新的"发生在更外层的 patch()
    // 函数里（isSameVNodeType 判断），不属于 patchKeyedChildren 的职责。
    // 所以这里观察到的是一次 patch，而不是 unmount+mount。
    const ops = patchKeyedChildren(
      [{ key: 'a', type: 'div' }],
      [{ key: 'a', type: 'span' }],
    )
    expect(ops).toEqual([{ kind: 'patch', key: 'a' }])
  })
})
