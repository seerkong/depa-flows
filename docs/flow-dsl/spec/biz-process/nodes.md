# L3 · BizProcess statements 与 TaskSpace

> BizProcess 继承[共享 CtrlFlow statements](../flow-core/nodes.md)及 [WorkFlow statements/resume](../work-flow/nodes.md)，只增加 `TaskStep` statement 与 TaskSpace domain nodes。

## `<BizProcess>` definition

根 `[]` 直接保存有序 statements。TaskStepResult 沿公共 data chain 进入后续 `If`：

```xnl
<BizProcess #depa.flows.demo.ExpenseApproval apiVersion="depa.flows/v1" version="1.0.0" [
  <TaskStep #manager-approval {
    task = "task-space://#task_manager_approve"
  }>
  <If #route-manager-result (
    <Branches [
      <Branch #approved {
        when = "vfs://./flow-code/approval.ts#isApproved"
      } [
        <Run #start-payout {
          src = "vfs://./flow-code/approval.ts#startPayout"
        }>
        <Return #approved-result>
      ]>
      <Branch #forwarded {
        when = "vfs://./flow-code/approval.ts#isForwarded"
      } [
        <Return #forwarded-result>
      ]>
      <Otherwise [
        <Return #refused-result>
      ]>
    ]>
  )>
]>
```

```ts
export function isApproved(runtime, input, config) {
  return input.outcome === 'approved';
}

export function isForwarded(runtime, input, config) {
  return input.outcome === 'forwarded';
}
```

predicate 与 `startPayout` 都遵守 `output = fn(runtime, input, config)`。没有审批专用 expression 或节点结果分支。

## `<TaskStep>`

| 字段 | 必填 | 说明 |
|---|---:|---|
| `#id` | 是 | 构成稳定 statement path 与任务 WaitHandle identity |
| `task` | 是 | `"task-space://#<id>"`，目标是 TaskSpace 直接子节点 |
| `config` | 否 | 静态 statement config，缺省 `{}` |

首次进入时 TaskStep 激活绑定任务并持久挂起。任务操作恢复后，statement 正常输出：

```ts
interface TaskStepResult<Payload = unknown> {
  taskId: string;
  status: 'Done' | 'Refused' | 'Forwarded' | 'Abandoned';
  outcome: 'approved' | 'refused' | 'forwarded' | 'abandoned';
  payload?: Payload;
}
```

四种 outcome 都是 data。`Refused` 不产生技术 Failure，`Forwarded` 也不伪装成 Success 控制信号；下一条普通 `If` 决定业务路径。TaskStep 没有 `assignTo`，也没有私有 Hooks authoring；前后副作用用相邻 `Run` statement 显式表达。

非法任务迁移、TaskSpace store 错误或损坏的恢复消息才走技术 fault 通道。等待合法人工操作是 suspension。Fallback 只能捕获前述 fault，不能消费 `TaskStepResult.outcome`。

## `<TaskSpace>` / `<TaskGroup>` / `<Task>`

任务子节点直接放父节点的 `[]`；没有 `SubNodes` wrapper：

```xnl
<TaskSpace #space_expense_approval version=1 { name = "费用审批任务空间" } [
  <Task #task_manager_approve {
    name = "直属主管审批"
    ownerAccount = "user:manager"
    status = "NotStarted"
    order = 0
  }>
  <TaskGroup #grp_finance {
    name = "财务复核"
    executionMode = "ALL"
    order = 1
  } [
    <Task #task_finance_approve {
      name = "财务审批"
      ownerAccount = "group:finance"
      status = "NotStarted"
      order = 0
    }>
  ]>
]>
```

| node | metadata | `{}` fields | `[]` |
|---|---|---|---|
| `TaskSpace` | `version` | `name` | direct Task / TaskGroup |
| `TaskGroup` | - | `name`, `executionMode = SEQUENTIAL | ANY | ALL`, `order` | nested Task / TaskGroup |
| `Task` | - | `name`, `ownerAccount`, `status`, `order`, optional `description` | none |

基础状态机：

```text
NotStarted -> Active | Abandoned
Active     -> Done | Refused | Forwarded | Delegated | NotStarted | Abandoned
Delegated  -> Active | Abandoned
Done / Refused / Forwarded / Abandoned = terminal
```

approve 操作把任务推进到 `Done`，并由 TaskStep 投影为 `outcome = "approved"`。TaskGroup 按 executionMode 聚合子任务并输出同形 TaskStepResult；聚合细节属于任务域，不改变 CtrlFlow grammar。

## Validation And Rejections

- `TaskStep.task` 必须解析到当前 bundle TaskSpace 的直接子节点；同一任务不能绑定多个 TaskStep。
- `TaskStep` 只能出现在 BizProcess definition，且必须有稳定唯一 `#id`。
- `status`、`executionMode` 与状态迁移必须合法；运行期事实不得回写 definition。
- authoring 中出现 `Tree`、`Sequence`、`Selector`、`Condition`、`action.types`、`SubNodes` 或 `assignTo` 必须拒绝。
- 每个 `src` / `when` export 都必须遵守 `output = fn(runtime, input, config)`；predicate output 必须是 boolean。
