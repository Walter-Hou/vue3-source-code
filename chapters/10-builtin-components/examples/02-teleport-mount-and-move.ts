/**
 * 运行：pnpm ex chapters/10-builtin-components/examples/02-teleport-mount-and-move.ts
 * 演示：Teleport 把内容挂载到另一个容器节点；disabled 开关；to 目标切换；
 *      main view 里始终留着的 teleportStart/teleportEnd 注释占位符
 * 看点：① 主视图里 Teleport 的“坑位”其实是两个注释节点（开发模式下用 createComment('teleport start'/'teleport end')）
 *      ② disabled=true 时内容其实被 mount 在主视图里两个注释之间，并没有真的插到 target
 *      ③ 切换 to 触发的是 moveTeleport(TARGET_CHANGE)，只搬运节点，不会重新 createElement
 *      ④ logging-renderer 的 to 必须传 createRoot() 得到的节点对象，不支持选择器字符串
 */
import {
  Teleport,
  defineComponent,
  h,
  nextTick,
  ref,
} from '@vue/runtime-core'
import {
  createRoot,
  printOps,
  render,
  resetOps,
  serialize,
} from '../../../shared/logging-renderer'
import { log, section, step } from '../../../shared/print'

// ====================================================================
// 1. 基本挂载：内容真的跑到了另一个容器里，主视图只留两个注释占位符
// ====================================================================
section('1. 基本挂载：to 指向另一个 createRoot() 节点')

const appRoot = createRoot('app-root')
const modalRoot = createRoot('modal-root')

const App1 = defineComponent({
  render() {
    return h('div', { class: 'app' }, [
      h('p', null, 'main content'),
      h(Teleport, { to: modalRoot }, h('div', { class: 'modal' }, 'I am teleported')),
    ])
  },
})

step('挂载：注意宿主操作里对 modalRoot 做了 createElement + insert，对 appRoot 只插入了两个注释')
render(h(App1), appRoot)
printOps('mount')
log('appRoot  HTML:', serialize(appRoot, 2))
log('modalRoot HTML:', serialize(modalRoot, 2))
log(
  'div.app 的 children 类型（p, 注释, 注释，内容真的不在这里）:',
  appRoot.children[0].children.map(c =>
    c.type === 'comment' ? `<!--${c.text}-->` : c.type === 'element' ? `<${c.tag}>` : `"${c.text}"`,
  ),
)

// ====================================================================
// 2. disabled：内容不搬家，直接留在主视图的两个注释之间
// ====================================================================
section('2. disabled 切换：内容在“搬出去”和“留在原地”之间切换')

const disabled = ref(false)
const appRoot2 = createRoot('app-root')
const modalRoot2 = createRoot('modal-root')
const App2 = defineComponent({
  render() {
    return h('div', { class: 'app' }, [
      h('p', null, 'main content'),
      h(
        Teleport,
        { to: modalRoot2, disabled: disabled.value },
        h('div', { class: 'modal' }, 'toggle me'),
      ),
    ])
  },
})

render(h(App2), appRoot2)
await nextTick()
resetOps()
log('初始（disabled=false）modalRoot HTML:', serialize(modalRoot2, 2))

step('disabled = true：TeleportMoveTypes.TOGGLE，把内容从 target 搬回主容器')
disabled.value = true
await nextTick()
printOps('disabled: false -> true')
log('appRoot2  HTML:', serialize(appRoot2, 2))
log('modalRoot2 HTML（应为空）:', JSON.stringify(serialize(modalRoot2, 2)))

step('disabled = false：再搬回 target')
disabled.value = false
await nextTick()
printOps('disabled: true -> false')
log('modalRoot2 HTML:', serialize(modalRoot2, 2))

// ====================================================================
// 3. to 切换：moveTeleport(TARGET_CHANGE)，只搬运，不重新创建
// ====================================================================
section('3. to 切换：从 modalRootA 搬到 modalRootB')

const target = ref<'A' | 'B'>('A')
const modalRootA = createRoot('modal-A')
const modalRootB = createRoot('modal-B')
const appRoot3 = createRoot('app-root')
const App3 = defineComponent({
  render() {
    return h(
      Teleport,
      { to: target.value === 'A' ? modalRootA : modalRootB },
      h('div', { class: 'modal' }, 'follow the target'),
    )
  },
})

render(h(App3), appRoot3)
await nextTick()
resetOps()
log('初始 modalRootA:', serialize(modalRootA, 2))

step('target: A -> B（应只看到 insert，没有 createElement / remove+create）')
target.value = 'B'
await nextTick()
printOps('to: A -> B')
log('modalRootA（应为空）:', JSON.stringify(serialize(modalRootA, 2)))
log('modalRootB:', serialize(modalRootB, 2))
