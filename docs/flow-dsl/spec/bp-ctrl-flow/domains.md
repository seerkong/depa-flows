# L3 · BPCtrlFlow 事实与域

> BPCtrlFlow 继承 [flow-core 事实与域](../flow-core/domains.md)和 [WorkCtrlFlow 持久事实](../work-ctrl-flow/domains.md)，只增加 TaskSpace authoring/runtime facts。

## Authoring Facts

| fact / domain | file | root / scheme | 说明 |
|---|---|---|---|
| `<BPCtrlFlow>` definition | 单文件或 `manifest.xnl` | 根 `[]` | 共享 CtrlFlow statements，可使用 `ExternalJob` / `Timer` / `TaskStep` |
| `state.def` / `state.seed` | 同 WorkCtrlFlow | 同 WorkCtrlFlow | 可选实例 state shape 与只读 seed |
| `task.space` | `task.space.xnl` | `<TaskSpace>` / `task-space://` | TaskGroup/Task 层级与初始任务事实 |

`task-space://#<id>` 只在当前 bundle 内解析，唯一公开消费者是 `TaskStep.task`。目标必须是 TaskSpace 的直接子节点；深层任务由所属 TaskGroup 的 executionMode 推进。

definition 中的 task status 只表示新实例初始值。运行期任务事实写 TaskSpace store，不能回写 authoring bundle；实例目录可提供只读投影，但投影不成为第二份事实源。

## Runtime Ownership

| fact | owner | flow 可见性 |
|---|---|---|
| task status/owner/history/payload | TaskSpace store | TaskStep 完成时投影为 TaskStepResult data |
| TaskStep WaitHandle / applied signal | BPCtrlFlow snapshot | 只用于挂起、恢复与幂等 |
| TaskStepResult | CtrlFlow data chain | 成为下一条 statement 的 input |
| branch decision | BPCtrlFlow snapshot | 记录后复用，不重算已发生任务路径 |

TaskSpace store、snapshot 与 definition 三个 owner 不得互相复制语义真源。特别是 `Refused` / `Forwarded` 等任务状态投影成 data 后，不能再写成 engine Failure。

## Rejected Authoring Facts

`tree.xnl`、`action.types.xnl`、`Tree` 根、独立 `CtrlFlow` 根以及公开 `Sequence` / `Selector` / `Condition` 都是已移除语法。TaskSpace 不允许用这些节点描述会签/或签；只能使用 TaskGroup 的 executionMode。
