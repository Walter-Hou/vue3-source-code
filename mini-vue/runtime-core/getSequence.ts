/**
 * 对应源码：packages/runtime-core/src/renderer.ts 的 getSequence（约 L2608-2647）
 *
 * 作用：求数组的「最长递增子序列」(Longest Increasing Subsequence, LIS)，
 * 返回的不是子序列本身，而是子序列各元素在原数组中的下标。
 *
 * 在 patchKeyedChildren 里，输入数组是 newIndexToOldIndexMap：
 * 下标是“新位置相对 toBePatched 的偏移”，值是“旧下标 + 1”（0 表示新增节点）。
 * 这个数组里的“递增子序列”对应一批节点——它们在旧列表和新列表里的相对顺序都没变，
 * 所以这批节点可以原地不动，只需要移动其余节点。
 *
 * 算法：贪心 + 二分（O(n log n)），用前驱数组 p 回溯出完整序列。
 * - result[k] 保存「长度为 k+1 的递增子序列」目前已知最小的结尾元素的下标；
 *   result 本身按值递增，因此可以二分查找。
 * - p[i] 记录 arr[i] 被接到 result 的哪个下标后面（前驱），最后从 result 的
 *   最后一个元素出发，顺着 p 向前回溯，就还原出一条完整的递增子序列。
 * - 注意：result 在算法执行过程中不是最终答案的直接记录（中间会被就地替换
 *   result[u] = i 来保持"最小结尾"），真正的答案要靠最后的回溯 while 循环生成。
 *
 * 保留了源码的变量名（result/p/u/v/c），裁剪点：
 * - 新增了可选的 trace 回调，每处理一个非 0 元素就把 { i, arrI, result, p } 的快照
 *   传出去，方便示例一步步打印中间状态（源码没有这个参数）。
 */

export interface SequenceTraceStep {
  /** 当前处理的原数组下标 */
  i: number
  /** arr[i] 的值 */
  arrI: number
  /** 处理完这一步之后 result 的快照（不是最终答案，是中间状态） */
  result: number[]
  /** 处理完这一步之后 p（前驱数组）的快照 */
  p: number[]
}

export function getSequence(
  arr: number[],
  trace?: (step: SequenceTraceStep) => void,
): number[] {
  const p = arr.slice()
  const result = [0]
  let i, j, u, v, c
  const len = arr.length
  for (i = 0; i < len; i++) {
    const arrI = arr[i]
    // patchKeyedChildren 里 0 表示“这个新节点没有对应的旧节点”，不参与 LIS 计算
    if (arrI !== 0) {
      j = result[result.length - 1]
      if (arr[j] < arrI) {
        // arrI 比 result 当前最后一个元素还大，直接接到后面，序列变长
        p[i] = j
        result.push(i)
        trace?.({ i, arrI, result: result.slice(), p: p.slice() })
        continue
      }
      // 二分查找 result 中第一个「对应值 >= arrI」的位置 u
      u = 0
      v = result.length - 1
      while (u < v) {
        c = (u + v) >> 1
        if (arr[result[c]] < arrI) {
          u = c + 1
        } else {
          v = c
        }
      }
      if (arrI < arr[result[u]]) {
        // 用更小的结尾替换掉 result[u]，为后续能接更长的序列留空间
        if (u > 0) {
          p[i] = result[u - 1]
        }
        result[u] = i
      }
      trace?.({ i, arrI, result: result.slice(), p: p.slice() })
    }
  }
  // 从 result 的最后一个下标出发，沿 p 回溯，还原真正的递增子序列
  u = result.length
  v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}
