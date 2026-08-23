# L3 · WorkCtrlFlow 事实与域

> 公共 definition/config/layout 见 [flow-core 事实与域](../flow-core/domains.md)。WorkCtrlFlow 只增加持久实例 state facet；snapshot 和 WaitHandle 是 runtime facts，不是 authoring topology。

## Authoring Facts

| fact / domain | file | root / scheme | 说明 |
|---|---|---|---|
| `<WorkCtrlFlow>` definition | 单文件或 `manifest.xnl` | 根 `[]` 或一个 `StepSpaceRef` | 共享 CtrlFlow statements，可使用 `ExternalJob` / `Timer`；inline 与 StepSpace 互斥 |
| `step.space` | `step-space.xnl` + 显式 step refs | `<StepSpace>` | 可选 definition ownership forest；不拥有 scheduler 或 run status |
| `state.def` | `state.def.xnl` | `<StateDef>` / `state-def://` | 可选；声明受版本契约保护的实例 state shape |
| `state.seed` | `state.seed.xnl` | `<StateSeed>` / `state-seed://` | 可选；新实例的只读初始 state |
| `task.space` | - | - | 禁用；人工任务事实只属于 BPCtrlFlow |

`StateDef` 与 `StateSeed` 通过相同 `#id` 关联。seed 是冻结 instance 的只读 facet，在每个新 run 的 checkpoint v0 中恰好应用一次；resume 不再应用。运行期 state 只写 canonical checkpoint，绝不回写 definition 或 seed。动态代码若访问实例 state，必须经 `runtime` 显式提供的 state effect，函数签名仍是 `output = fn(runtime, input, config)`。

## Runtime Facts

| fact | owner | 持久化约束 |
|---|---|---|
| snapshot | FlowRunCheckpoint `profile.snapshot` | 保存恢复位置、当前 data、state、decisions、等待与幂等事实 |
| WaitHandle | 同一 checkpoint profile | 以 statement path + token 定位 open/closed wait |
| ResumeSignal | runtime ingress | 消费后只记录标识与 payload/fault 结果，不进入 definition |
| branch decision | snapshot | 在进入 Branch body 前记录，恢复时复用 |

实例物化必须在首个节点前冻结完整 definition bundle，以保证 code、facets 与 topology 版本稳定；冻结副本仍不是新的 authoring 入口。每个 run 的 snapshot、input/config/state/output 与 sidecars 由[单一 checkpoint hierarchy](../flow-core/instance-run.md)共同持有。运行状态可以投影到 editor/runtime overlay；不得向 XNL definition 注入 `status`、执行游标或 decision 作为语义事实。

模块化 authoring 中，每个 `Step` 的 `Core` 仍是原 WorkCtrl statement；嵌套
`Retry`、`Parallel` 等语义继续由 WorkCtrl runtime 解释。`StepGroup` 只组织文件与
ownership，不能改变 statement 顺序、等待关系或建立另一套执行状态。

## Rejected Authoring Facts

`tree.xnl`、`action.types.xnl`、`Tree` 根、独立 `CtrlFlow` 根以及公开 `Sequence` / `Selector` / `Condition` 都必须拒绝。snapshot schema、WaitHandle 列表和 branch decision 也不能被伪装成 definition 子域。
