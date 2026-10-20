/**
 * 对应源码：packages/reactivity/src/constants.ts
 *
 * 纯常量定义，照抄即可：
 * - TrackOpTypes / TriggerOpTypes：调试用的操作类型标签（onTrack/onTrigger 事件里能看到）。
 * - ReactiveFlags：挂在 Proxy target 上的“暗号”属性，baseHandlers.get 里专门拦截这几个 key。
 */

export enum TrackOpTypes {
  GET = 'get',
  HAS = 'has',
  ITERATE = 'iterate',
}

export enum TriggerOpTypes {
  SET = 'set',
  ADD = 'add',
  DELETE = 'delete',
  CLEAR = 'clear',
}

export enum ReactiveFlags {
  SKIP = '__v_skip',
  IS_REACTIVE = '__v_isReactive',
  IS_READONLY = '__v_isReadonly',
  IS_SHALLOW = '__v_isShallow',
  RAW = '__v_raw',
  IS_REF = '__v_isRef',
}
