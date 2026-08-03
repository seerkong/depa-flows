# L2 领域公理 · BPCtrlFlow（人工任务控制流）

> 编号 `BP-*`。继承 L1、[共享 CtrlFlow grammar](../../spec/flow-core/nodes.md)与 [WorkCtrlFlow lifecycle](../work-ctrl-flow/axioms.md)。容器根是 `<BPCtrlFlow>`；只增加 TaskSpace 与 TaskStep 能力。

## BP-1 · TaskSpace 是独立业务事实源

`task.space` 域承载 `TaskSpace -> TaskGroup / Task` 层级与任务状态。TaskSpace store 拥有当前 owner、操作历史、状态和业务 payload；flow snapshot 只保存 TaskStep 的执行位置、等待句柄与已消费结果，不复制或反向覆盖任务事实。

TaskGroup 用 `executionMode = SEQUENTIAL | ANY | ALL` 聚合子任务。任务状态机与组聚合属于任务域，不发明 CtrlFlow 组合节点。

## BP-2 · TaskStep 是唯一生命周期桥

`TaskStep.task = "task-space://#<id>"` 绑定 TaskSpace 的一个直接子节点。首次进入时激活绑定任务、登记任务 WaitHandle、保存 WorkCtrlFlow snapshot 并挂起；合法人工操作到达可恢复结果后，TaskStep 输出普通 `TaskStepResult` data：

```text
{
  taskId,
  status,
  outcome = "approved" | "refused" | "forwarded" | "abandoned",
  payload
}
```

其中 approve 操作可对应任务终态 `Done`，但 flow 观察到的业务 outcome 是 `approved`。`refused`、`forwarded`、`abandoned` 与 `approved` 一样都是正常 output，不映射成技术 Failure。TaskStep 不使用 `assignTo`；result 直接成为下一条 statement 的 input。

## BP-3 · 任务操作、fault 与 suspension 正交

- approved/refused/forwarded/abandoned：业务 data，由后续 predicate 决定路径。
- 非法状态迁移、任务存储不可用、恢复协议损坏：技术 fault，可向外传播或由 Fallback 处理。
- 等待人工操作：suspension，保存 snapshot 后停止当前 tick；既不是 data，也不是 fault。

因此 Fallback 不能把 refused 当作 strategy 失败，内部 engine 也不能用 Failure 偷换任务业务结果。

## BP-4 · 业务路径统一使用 `If`

TaskStep 后的审批、拒绝、转交和升级路径一律使用公共 `If` / `Branches` / `Branch` / `Otherwise`。`Branch.when` 读取 TaskStepResult，并严格遵守 `boolean = fn(runtime, input, config)`；不定义审批专用条件节点或另一套公开条件 authoring。

WorkCtrlFlow 的 branch decision 规则完整适用：一旦 outcome 已选择 Branch，decision 在进入 body 前持久化，后续恢复不得重算已发生路径。

## BP-5 · 人工操作通过 ResumeSignal 进入实例

任务服务先按状态机验证并持久化操作，再向对应 TaskStep WaitHandle 投递幂等 ResumeSignal。UI、通知渠道和组织架构不属于 flow 协议；`ownerAccount` 是任务域的不透明业务值。

重复操作或重复 ResumeSignal 不得重复推进流程。TaskSpace store 与 flow snapshot 的更新必须通过 runtime 的一致性策略关联，不能靠回写 definition 达成同步。

## BP-6 · BPCtrlFlow 是 WorkCtrlFlow capability 超集

BPCtrlFlow 支持 WorkCtrlFlow 的 `ExternalJob`、`Timer`、snapshot/resume 与 branch decision，并追加 `TaskSpace` / `TaskStep`。不使用 TaskStep 的 BPCtrlFlow 仍遵守相同 CtrlFlow grammar 和 WorkCtrlFlow lifecycle；它不会获得另一套 authoring 语言。
