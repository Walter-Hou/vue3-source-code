/**
 * 对应源码：packages/runtime-core/src/renderer.ts 的 patchKeyedChildren（约 L1834-2076）
 *
 * 保留的主干：完整的"五步法"——
 *   1. sync from start（头部同步）
 *   2. sync from end（尾部同步）
 *   3. common sequence + mount（只有新增）
 *   4. common sequence + unmount（只有删除）
 *   5. unknown sequence（乱序）：keyToNewIndexMap → newIndexToOldIndexMap →
 *      getSequence 求最长递增子序列 → 从后向前 mount/move
 * 变量命名（i/e1/e2/s1/s2/j/patched/moved/maxNewIndexSoFar/...）与源码保持一致，
 * 方便对照源码逐行理解。
 *
 * 裁剪/简化点（为了自包含、不依赖 vnode.ts）：
 * - 节点只有 { key, type } 两个字段；isSameType(a, b) 等价于源码的
 *   isSameVNodeType：`a.type === b.type && a.key === b.key`。
 *   不传 key 时按 type 是否相同来复用（对应源码里"key-less node"的分支）。
 * - 不接真实 DOM / 不处理 namespace、suspense、slotScopeIds、Teleport、
 *   Fragment 的 move 特殊分支——这些在源码的 move()/patch() 里，不属于
 *   patchKeyedChildren 本身的职责。
 * - "挂载/卸载/移动/打补丁"不实际操作宿主节点，而是把发生了什么记录成
 *   DiffOp 数组返回，交给调用方（示例/测试）去断言或打印。
 * - anchor 用"将要插入到其前面的新节点的 key"表示（null 表示插到末尾，
 *   对应源码里退化到 parentAnchor 的情况）。
 */
import { getSequence } from './getSequence'

export interface DiffNode {
  /** 对应源码 vnode.key：没写 key 的节点在源码里 key 是 null，这里用 undefined 表示同一件事 */
  key: PropertyKey | undefined
  /** 节点类型，isSameType 用它做兜底比较（key 为 undefined 时按 type 复用） */
  type?: string
}

export type DiffOp =
  | { kind: 'patch'; key: PropertyKey | undefined }
  | { kind: 'mount'; key: PropertyKey | undefined; anchor: PropertyKey | null | undefined }
  | { kind: 'move'; key: PropertyKey | undefined; anchor: PropertyKey | null | undefined }
  | { kind: 'unmount'; key: PropertyKey | undefined }

/** 对应源码 vnode.ts 的 isSameVNodeType：type 和 key 都相同才算"同一个节点" */
export function isSameType(a: DiffNode, b: DiffNode): boolean {
  return a.type === b.type && a.key === b.key
}

/**
 * 简化版 patchKeyedChildren。
 * @param c1 旧的子节点数组
 * @param c2 新的子节点数组
 * @returns 按发生顺序记录下来的宿主操作序列
 */
export function patchKeyedChildren(c1: DiffNode[], c2: DiffNode[]): DiffOp[] {
  const ops: DiffOp[] = []
  let i = 0
  const l2 = c2.length
  let e1 = c1.length - 1 // prev ending index
  let e2 = l2 - 1 // next ending index

  // 1. sync from start
  // (a b) c
  // (a b) d e
  while (i <= e1 && i <= e2) {
    const n1 = c1[i]
    const n2 = c2[i]
    if (isSameType(n1, n2)) {
      ops.push({ kind: 'patch', key: n2.key })
    } else {
      break
    }
    i++
  }

  // 2. sync from end
  // a (b c)
  // d e (b c)
  while (i <= e1 && i <= e2) {
    const n1 = c1[e1]
    const n2 = c2[e2]
    if (isSameType(n1, n2)) {
      ops.push({ kind: 'patch', key: n2.key })
    } else {
      break
    }
    e1--
    e2--
  }

  // 3. common sequence + mount
  // (a b)
  // (a b) c      i = 2, e1 = 1, e2 = 2
  // (a b)
  // c (a b)      i = 0, e1 = -1, e2 = 0
  if (i > e1) {
    if (i <= e2) {
      const nextPos = e2 + 1
      const anchor = nextPos < l2 ? c2[nextPos].key : null
      while (i <= e2) {
        ops.push({ kind: 'mount', key: c2[i].key, anchor })
        i++
      }
    }
  }

  // 4. common sequence + unmount
  // (a b) c
  // (a b)        i = 2, e1 = 2, e2 = 1
  // a (b c)
  // (b c)        i = 0, e1 = 0, e2 = -1
  else if (i > e2) {
    while (i <= e1) {
      ops.push({ kind: 'unmount', key: c1[i].key })
      i++
    }
  }

  // 5. unknown sequence
  // [i ... e1 + 1]: a b [c d e] f g
  // [i ... e2 + 1]: a b [e d c h] f g
  else {
    const s1 = i // prev starting index
    const s2 = i // next starting index

    // 5.1 为新节点建立 key -> newIndex 的映射
    const keyToNewIndexMap = new Map<PropertyKey, number>()
    for (i = s2; i <= e2; i++) {
      const nextChild = c2[i]
      if (nextChild.key != null) {
        keyToNewIndexMap.set(nextChild.key, i)
      }
    }

    // 5.2 遍历旧节点中"还没处理"的那一段，尝试复用（patch）或删除（unmount）
    let j: number
    let patched = 0
    const toBePatched = e2 - s2 + 1
    let moved = false
    // 用于判断是否发生了"乱序"（不是单纯的增删）
    let maxNewIndexSoFar = 0
    // newIndexToOldIndexMap[newIndex 相对 s2 的偏移] = oldIndex + 1
    // 0 表示这个新节点在旧数组里找不到对应项（是全新挂载的）
    const newIndexToOldIndexMap = new Array(toBePatched).fill(0)

    for (i = s1; i <= e1; i++) {
      const prevChild = c1[i]
      if (patched >= toBePatched) {
        // 新节点已经全部找到归宿，旧节点剩下的只能是被删除的
        ops.push({ kind: 'unmount', key: prevChild.key })
        continue
      }
      let newIndex: number | undefined
      if (prevChild.key != null) {
        newIndex = keyToNewIndexMap.get(prevChild.key)
      } else {
        // 无 key 节点：在新数组里找一个"还没被占用、type 相同"的位置顶上
        for (j = s2; j <= e2; j++) {
          if (
            newIndexToOldIndexMap[j - s2] === 0 &&
            isSameType(prevChild, c2[j])
          ) {
            newIndex = j
            break
          }
        }
      }
      if (newIndex === undefined) {
        ops.push({ kind: 'unmount', key: prevChild.key })
      } else {
        newIndexToOldIndexMap[newIndex - s2] = i + 1
        if (newIndex >= maxNewIndexSoFar) {
          maxNewIndexSoFar = newIndex
        } else {
          // 出现了"新位置比之前见过的最大位置还靠前"，说明顺序被打乱了
          moved = true
        }
        ops.push({ kind: 'patch', key: c2[newIndex].key })
        patched++
      }
    }

    // 5.3 只有真的发生乱序（moved）才去求最长递增子序列；
    // 纯增删不需要移动任何已存在的节点。
    const increasingNewIndexSequence = moved
      ? getSequence(newIndexToOldIndexMap)
      : []
    j = increasingNewIndexSequence.length - 1
    // 从后往前遍历：这样 anchor 永远是"已经处理好、位置确定"的下一个节点
    for (i = toBePatched - 1; i >= 0; i--) {
      const nextIndex = s2 + i
      const nextChild = c2[nextIndex]
      const anchor = nextIndex + 1 < l2 ? c2[nextIndex + 1].key : null
      if (newIndexToOldIndexMap[i] === 0) {
        // 在旧数组里完全找不到，是全新节点
        ops.push({ kind: 'mount', key: nextChild.key, anchor })
      } else if (moved) {
        // 不在最长递增子序列里的节点，需要移动；在序列里的保持原位不动
        if (j < 0 || i !== increasingNewIndexSequence[j]) {
          ops.push({ kind: 'move', key: nextChild.key, anchor })
        } else {
          j--
        }
      }
    }
  }

  return ops
}
