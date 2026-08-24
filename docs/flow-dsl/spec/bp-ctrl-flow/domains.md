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

TaskSpace store 的共享 kernel 只拥有 `Pending | Ready | Claimed | Running | Waiting | Succeeded | Failed | Cancelled`。`ownerAccount`、operator/transfer facts 以及 `NotStarted | Active | Delegated | Forwarded | Done | Refused | Abandoned` 全部属于 `depa.bp.task` profile；TaskGroup 的 `executionMode` 属于 `depa.bp.task-group` profile。BP adapter 负责 authoring/profile/legacy view 的转换，不能把这些字段扩散到共享 task record。旧调用侧可继续读取 `BPTaskSpaceDTO` 投影，或用 `legacyBPTaskSpaceToDefinition` 显式迁移尚未启动的树；非 `NotStarted` 历史状态需要显式 event/receipt import 协议，在该协议存在前转换器 fail closed。

## Runtime Ownership

| fact | owner | flow 可见性 |
|---|---|---|
| canonical lifecycle / claim / history / artifacts | TaskSpace kernel owner | 仅通过 runtime-first TaskSpace Processors 修改 |
| BP status/owner/operator/transfer facts | Task record 的 BP profile | TaskStep 完成时投影为 TaskStepResult data |
| TaskStep WaitHandle / applied signal | BPCtrlFlow snapshot | 只用于挂起、恢复与幂等 |
| TaskStepResult | CtrlFlow data chain | 成为下一条 statement 的 input |
| branch decision | BPCtrlFlow snapshot | 记录后复用，不重算已发生任务路径 |

TaskSpace store、snapshot 与 definition 三个 owner 不得互相复制语义真源。特别是 `Done` / `Refused` / `Forwarded` 都是成功完成业务处理，在 kernel 中映射为 `Succeeded`；其精确业务含义只保存在 BP profile 并投影为 data，不能再写成 engine Failure。`Abandoned` 映射为 `Cancelled`，不属于成功处理；`Delegated` 映射为 `Waiting`。TaskGroup 必须使用同一分类和 canonical group identity 判定终态，不能恢复 leaf dependency cross-product 或在 BP adapter 里维护第二套 lifecycle。

## Rejected Authoring Facts

`tree.xnl`、`action.types.xnl`、`Tree` 根、独立 `CtrlFlow` 根以及公开 `Sequence` / `Selector` / `Condition` 都是已移除语法。TaskSpace 不允许用这些节点描述会签/或签；只能使用 TaskGroup 的 executionMode。
