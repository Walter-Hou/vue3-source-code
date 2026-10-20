/**
 * 对应源码：packages/runtime-core/src/renderer.ts 的 getSequence
 * 覆盖点：基本 LIS、含 0（新增节点占位）、全递增、全递减、空数组、trace 回调。
 */
import { describe, expect, it } from 'vitest'
import { getSequence } from './getSequence'

/** 用值序列校验：下标对应的值必须是严格递增的 */
function assertIncreasing(arr: number[], indices: number[]) {
  const values = indices.map(i => arr[i])
  for (let i = 1; i < values.length; i++) {
    expect(values[i]).toBeGreaterThan(values[i - 1])
  }
}

describe('getSequence (mini-vue)', () => {
  it('经典用例 [2,3,1,5,6,8,7,9,4] -> 最长递增子序列长度为 6', () => {
    const arr = [2, 3, 1, 5, 6, 8, 7, 9, 4]
    const result = getSequence(arr)
    expect(result).toEqual([0, 1, 3, 4, 6, 7])
    assertIncreasing(arr, result)
  })

  it('全递增数组：结果就是 [0..n-1]', () => {
    const arr = [1, 2, 3, 4, 5]
    expect(getSequence(arr)).toEqual([0, 1, 2, 3, 4])
  })

  it('全递减数组：最长递增子序列长度为 1（取最后一个能接上的）', () => {
    const arr = [5, 4, 3, 2, 1]
    const result = getSequence(arr)
    expect(result.length).toBe(1)
    assertIncreasing(arr, result)
  })

  it('空数组：返回 [0]（源码里的初始值，调用方需结合 toBePatched===0 处理）', () => {
    expect(getSequence([])).toEqual([0])
  })

  it('含 0（patchKeyedChildren 的"新增节点无对应旧节点"占位）：0 不参与计算', () => {
    // 对应一个真实的 newIndexToOldIndexMap：
    // 旧 [a,b,c,d,e] 新 [a,c,d,b,e,f]，b/c/d 都能在旧数组里找到，f 是新增(0)
    const arr = [2, 3, 4, 0, 5]
    const result = getSequence(arr)
    // 递增子序列 [2,3,4,5] 对应下标 [0,1,2,4]
    expect(result).toEqual([0, 1, 2, 4])
  })

  it('trace 回调：每处理一个非 0 元素都应该触发一次，且快照是递增过程', () => {
    const arr = [2, 3, 1]
    const steps: number[] = []
    getSequence(arr, step => steps.push(step.i))
    expect(steps).toEqual([0, 1, 2])
  })

  it('单调交替导致多次二分替换的用例', () => {
    const arr = [3, 1, 4, 1, 5, 9, 2, 6]
    const result = getSequence(arr)
    assertIncreasing(arr, result)
    // 该数组的最长递增子序列长度为 4（例如 1,4,5,9 或 1,4,5,6 等）
    expect(result.length).toBe(4)
  })
})
