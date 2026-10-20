/**
 * 运行：pnpm ex chapters/07-renderer-diff/examples/04-lis-trace.ts
 * 演示：mini-vue/runtime-core/getSequence 是源码 getSequence 的逐行复刻
 *       （贪心 + 二分 + 前驱数组回溯），用 trace 回调把每一步的 result/p
 *       打印出来，手推一遍 [2,3,1,5,6,8,7,9,4] 这个经典用例。
 * 看点：
 *   1. result 数组在计算过程中保存的是"长度为 k+1 的递增子序列，目前已知
 *      最小的结尾元素的下标"，它本身不是最终答案，中间会被就地替换。
 *   2. p（前驱数组）记录每个被接上的元素的"前一个"下标，最后从 result 的
 *      最后一项出发沿 p 回溯，才还原出真正的递增子序列。
 *   3. 第二组用例把 [a,b,c,d,e] -> [a,c,d,b,e,f] 换算成真实的
 *      newIndexToOldIndexMap，验证"LIS 对应的节点不用移动"这件事。
 */
import { getSequence } from '../../../mini-vue/runtime-core/getSequence'
import { log, section, step } from '../../../shared/print'

section('1. 经典用例：手推 [2,3,1,5,6,8,7,9,4]')

const arr = [2, 3, 1, 5, 6, 8, 7, 9, 4]
log('arr =', arr)
step('逐步打印 result / p 的变化（result 下标 -> 对应的 arr 值，方便肉眼核对）')
const result = getSequence(arr, ({ i, arrI, result, p }) => {
  log(
    `处理 i=${i} (arr[i]=${arrI})`,
    ` result=${JSON.stringify(result)} -> 值=${JSON.stringify(result.map(x => arr[x]))}`,
    ` p=${JSON.stringify(p)}`,
  )
})
step('最终回溯结果')
log('result(下标) =', result)
log('对应的值     =', result.map(i => arr[i]))
log('这是一条长度为 6 的递增子序列：2,3,5,6,7,9（对应原数组下标 0,1,3,4,6,7）')

section('2. 还原成 patchKeyedChildren 的真实场景')

step('[a,b,c,d,e] -> [a,c,d,b,e,f]：手算 newIndexToOldIndexMap')
// 头尾同步之后，剩余区间 s1=s2=1, e1=4, e2=4（b,c,d,e -> c,d,b,e）
// newIndexToOldIndexMap 的下标是"新位置相对 s2 的偏移"，值是"旧下标+1"：
//   新位置1(c) 对应旧下标2 -> 3
//   新位置2(d) 对应旧下标3 -> 4
//   新位置3(b) 对应旧下标1 -> 2
//   新位置4(e) 对应旧下标4 -> 5
const newIndexToOldIndexMap = [3, 4, 2, 5]
log('newIndexToOldIndexMap =', newIndexToOldIndexMap, '(对应 c,d,b,e 四个位置)')
const lis = getSequence(newIndexToOldIndexMap)
log('getSequence 结果(下标) =', lis, '-> 对应位置', lis.map(i => ['c', 'd', 'b', 'e'][i]))
log('结论：c,d,e 三个位置在 LIS 里，原地不动；b 不在 LIS 里，是唯一需要 move 的节点。')
log('这和 03-keyed-diff-step-by-step.ts 用例 4 的真实宿主操作完全对应。')
