/**
 * 运行：pnpm ex chapters/04-ref-computed-watch/examples/04-watch-sources-deep.ts
 * 演示：watch() 支持的几种 source 形式（ref / reactive 对象 / getter 函数 / 数组多源）；
 *       deep 选项的默认值差异——直接 watch 一个 reactive 对象默认是深度的，watch 一个 getter
 *       默认不是；deep: 数字 限定遍历层级（3.5 新特性）。
 * 看点：同样是“嵌套属性变化”，根据 source 的形式和 deep 选项不同，触发行为完全不一样。
 *       本例特意从 '@vue/reactivity' 导入 watch（而不是 'vue'）：@vue/reactivity 的 watch
 *       没有 scheduler 选项时，effect.scheduler 直接等于 job，trigger 当场同步执行回调；
 *       从 'vue' 导入的 watch 默认 flush:'pre'，回调会被 queueJob 推迟到微任务——这个时序差异
 *       正是下一个示例（05-watch-flush-timing）要专门讲的，这里先用同步版本把 source/deep 讲清楚。
 */
import { ref, reactive, shallowReactive, watch } from '@vue/reactivity'
import { section, step, log, expectEq } from '../../../shared/print'

section('1. watch ref：拿到新旧值')
{
  const count = ref(0)
  const log1: Array<[number, number]> = []
  watch(count, (nv, ov) => log1.push([nv, ov]))
  count.value = 1
  count.value = 2
  log('记录：', log1)
  expectEq('两次变化各记录一条', log1, [[1, 0], [2, 1]])
}

section('2. watch getter：只在 getter 返回值真正变化时触发')
{
  const state = reactive({ a: 1, b: 2 })
  let calls = 0
  watch(() => state.a, () => calls++)
  state.b = 100
  expectEq('getter 没读 b，b 变化不触发', calls, 0)
  state.a = 2
  expectEq('a 变化触发', calls, 1)
}

section('3. watch 多个 source（数组）')
{
  const a = ref(1)
  const b = ref('x')
  const log3: any[] = []
  watch([a, b], ([nva, nvb], [ova, ovb]) => log3.push({ nva, nvb, ova, ovb }))
  a.value = 2
  log('只改 a 之后的回调参数：', log3)
  expectEq('b 的新旧值都还是原来的（没变）', [log3[0].nvb, log3[0].ovb], ['x', 'x'])
}

section('4. watch reactive 对象：不传 deep，默认就是深度的')
{
  const state = reactive({ nested: { a: 1 } })
  let calls = 0
  watch(state, () => calls++)

  step('改最深层的属性，照样触发（这是容易被忽视的默认行为）')
  state.nested.a = 2
  expectEq('默认深度遍历，嵌套属性变化也触发', calls, 1)
}

section('5. watch getter + deep: true：手动开启深度遍历')
{
  const state = reactive({ nested: { a: 1 } })
  let calls = 0
  watch(() => state.nested, () => calls++)
  state.nested.a = 2
  expectEq('不开 deep，getter 只认返回值的引用，嵌套变化不触发', calls, 0)

  let calls2 = 0
  watch(() => state.nested, () => calls2++, { deep: true })
  state.nested.a = 3
  expectEq('开了 deep，嵌套属性变化也能触发', calls2, 1)
}

section('6. deep: 数字（3.5 新特性）：限定遍历层级')
{
  const state = reactive({ a: { b: { c: 1 } } })
  let calls = 0
  watch(() => state.a, () => calls++, { deep: 1 })

  step('改第二层（b.c）：deep:1 只遍历到 a.b 这一层，碰不到 c，不触发')
  state.a.b.c = 2
  expectEq('超出 deep 层级的变化不会被发现', calls, 0)

  step('改第一层（直接替换 b）：在 deep:1 的遍历范围内，触发')
  state.a.b = { c: 100 }
  expectEq('在 deep 层级范围内的变化会触发', calls, 1)
}

section('7. watch shallowReactive 对象：即使不传 deep，也不会深度遍历')
{
  const state = shallowReactive({ nested: { a: 1 } })
  let calls = 0
  watch(state, () => calls++)
  state.nested.a = 2 // 嵌套对象本来就不是 reactive 的，这行赋值甚至不会触发任何 track/trigger
  expectEq('shallowReactive 的 watch 不会深度遍历，嵌套变化不可见', calls, 0)

  state.nested = { a: 100 } // 替换根层属性，这个是可见的
  expectEq('根层替换可见', calls, 1)
}
