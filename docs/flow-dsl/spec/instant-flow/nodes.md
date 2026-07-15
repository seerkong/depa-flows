# L3 · InstantFlow statements

> InstantFlow 完整继承[共享 CtrlFlow statements](../flow-core/nodes.md)，不新增 statement，只收窄生命周期能力。

## `<InstantFlow>` definition

根 `[]` 直接保存有序 statements；没有结构 wrapper：

```xnl
<InstantFlow #depa.flows.demo.PriceQuote apiVersion="depa.flows/v1" version="1.0.0" [
  <Run #load-quote {
    src = "vfs://./flow-code/quote.ts#loadQuote"
  }>
  <If #route-quote (
    <Branches [
      <Branch #accepted {
        when = "vfs://./flow-code/quote.ts#isAccepted"
      } [
        <Return #accepted-result { value = { outcome = "accepted" } }>
      ]>
      <Otherwise [
        <Return #review-result { value = { outcome = "review" } }>
      ]>
    ]>
  )>
]>
```

`loadQuote`、`isAccepted` 及其他 code ref 都必须使用 `output = fn(runtime, input, config)`；predicate output 必须是 boolean。

## Allowed Statements

| statement | InstantFlow 语义 |
|---|---|
| `Run` | 在当前调用内完成，output 传给下一条 statement |
| `If` | 按序选择首个为 true 的 Branch，或选择末尾 Otherwise |
| `Fallback` | 仅在 strategy 发生技术 fault 时尝试下一项 |
| `Until` | 在当前调用内迭代，受 `maxIterations` guard 约束 |
| `Return` | 立即结束整个 flow 并返回 output |

## Lifecycle Rejections

- `ExternalJob`、`Timer`、`TaskStep`：加载期错误，因为它们需要持久挂起。
- snapshot、WaitHandle、ResumeSignal、`state.*`、`task.space`：不属于 InstantFlow 实例模型。
- `Tree`、`Sequence`、`Selector`、`Condition`、动作类型节点：不是公开 statements；出现即拒绝。

普通业务 data 即使包含 `refused` 或 `declined` 也仍是正常 output。只有 throw/fault 进入技术失败通道；InstantFlow 不把业务值或持久 Waiting 伪装成 Failure。
