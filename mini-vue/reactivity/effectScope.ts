/**
 * 对应源码：packages/reactivity/src/effectScope.ts
 *
 * 保留：effects/cleanups/scopes 的父子树、run()（切换 activeEffectScope）、
 * stop()（级联 stop 子 effect + 子 scope + 跑 cleanups）、onScopeDispose、getCurrentScope。
 *
 * 裁剪：pause/resume（与本章主线关系不大，留一句话在 README 提及）、
 * on()/off()（配合 withAsyncContext 的手动进出栈，组件异步 setup 才用得到）、
 * detached scope 从父树里 O(1) 移除的 index 优化（直接用数组 indexOf，逻辑等价，常数项不同）。
 */
import type { ReactiveEffect } from './effect'

export let activeEffectScope: EffectScope | undefined

export class EffectScope {
  private _active = true
  effects: ReactiveEffect[] = []
  cleanups: (() => void)[] = []

  parent: EffectScope | undefined
  scopes: EffectScope[] | undefined

  constructor(public detached = false) {
    if (!detached && activeEffectScope && activeEffectScope.active) {
      this.parent = activeEffectScope
      ;(activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(this)
    }
  }

  get active(): boolean {
    return this._active
  }

  run<T>(fn: () => T): T | undefined {
    if (this._active) {
      const prev = activeEffectScope
      try {
        activeEffectScope = this
        return fn()
      } finally {
        activeEffectScope = prev
      }
    }
  }

  stop(fromParent?: boolean): void {
    if (!this._active) return
    this._active = false

    for (const e of this.effects) e.stop()
    this.effects.length = 0

    for (const cleanup of this.cleanups) cleanup()
    this.cleanups.length = 0

    if (this.scopes) {
      for (const child of this.scopes) child.stop(true)
      this.scopes.length = 0
    }

    // 嵌套 scope：从父节点的 scopes 数组里摘掉自己，避免内存泄漏
    if (!this.detached && this.parent && !fromParent) {
      const idx = this.parent.scopes!.indexOf(this)
      if (idx > -1) this.parent.scopes!.splice(idx, 1)
    }
    this.parent = undefined
  }
}

export function effectScope(detached?: boolean): EffectScope {
  return new EffectScope(detached)
}

export function getCurrentScope(): EffectScope | undefined {
  return activeEffectScope
}

export function onScopeDispose(fn: () => void): void {
  if (activeEffectScope) {
    activeEffectScope.cleanups.push(fn)
  }
}
