# L2 领域公理 · InstantCtrlFlow（即时控制流）

> 编号 `IF-*`。继承 L1 与[共享 CtrlFlow grammar](../../spec/flow-core/nodes.md)。容器根是 `<InstantCtrlFlow>`；产品根的 `[]` 直接保存有序 statements。

## IF-1 · 语法不分叉

InstantCtrlFlow 使用公共 `Run`、`If` / `Branches` / `Branch` / `Otherwise`、`Fallback` / `Strategy`、`Until`、`Return` authoring grammar。顺序由根或嵌套 body 的 `[]` 表达，InstantCtrlFlow 不定义自己的条件、顺序或返回方言。

所有 `src` 与 `when` 引用的动态代码都遵守：

```text
output = fn(runtime, input, config)
```

`input` 是上一条 statement 的 output，`config` 是 definition 中的静态 map，`runtime` 是引擎显式注入的 effect 能力。不得通过隐式全局或可变 input 补充该协议。

## IF-2 · 一次调用内收敛

InstantCtrlFlow 的生命周期边界是一整次调用。它可以 `await` 本次调用内完成的 IO，但不能返回持久挂起状态，也不能等待另一个 tick、进程或外部恢复消息继续执行。

因此以下能力在 InstantCtrlFlow definition 中非法：

- `ExternalJob`、`Timer`、`TaskStep` 等持久挂起 statement。
- snapshot、WaitHandle、ResumeSignal 或已应用恢复消息集合。
- `state.def`、`state.seed`、`task.space` 等跨调用实例事实。

需要这些能力时，作者必须选择 WorkCtrlFlow 或 BPCtrlFlow，而不是给 InstantCtrlFlow 增加例外。

## IF-3 · data 与 fault 分离

一次执行只有两种公开完成结果：正常 output 或技术 fault。`refused`、`declined`、`notFound` 等业务结果是正常 data，可由后续 `If` predicate 读取；代码异常、协议错误和不可恢复 effect 错误才是 fault。

InstantCtrlFlow 没有第三种持久 suspension 结果。引擎内部若使用 Running 等推进状态，它只能存在于当前调用中，不能越过调用边界暴露为可恢复实例。

## IF-4 · 调用间无隐藏状态

每次调用从显式 input、definition config 和显式 runtime 能力开始。引擎不得让上一次调用的执行游标、分支选择或临时 data 隐式影响下一次调用；实现缓存只有在不改变可观察语义时才允许存在。
