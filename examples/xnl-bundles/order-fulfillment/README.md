# Order fulfillment · Definition to Run

本目录是可编辑的 `WorkCtrlFlow` Definition source，不是运行目录。其 authoring facets 为：

- [`manifest.xnl`](manifest.xnl)：`FlowContract` 与唯一 `StepSpaceRef`。
- [`step-space.xnl`](step-space.xnl)：显式、递归的 definition Step forest。
- [`steps/`](steps/)：每个被引用 Step 的唯一 `Core`；目录枚举不产生 topology。
- [`state.def.xnl`](state.def.xnl)：持久 state shape。
- [`state.seed.xnl`](state.seed.xnl)：每个新 run 恰好应用一次的只读初值。
- [`config.def.xnl`](config.def.xnl) 与 [`config.xnl`](config.xnl)：config schema 与默认 authoring data。
- [`actions/fulfillment.actions.ts`](actions/fulfillment.actions.ts)：由 `vfs://` 引用的 runtime-first Processor code。

首个节点运行前，runtime 将本目录完整复制到 `<support-root>/instances/<instance-id>/definition/`，校验相对路径、raw bytes、digest、schema 与 containment，然后原子录取 `instance.json`。`actions/`、配置和 state facets 都必须被复制，不能只复制 `manifest.xnl`。

本示例的 `StepGroup #fulfillment` 只组织 definition ownership。其五个 Step Core
仍按原 WorkCtrl statement 顺序组成 `Retry → ExternalJob → Timer → Parallel → Return`；
StepSpace 不保存 wait、status 或 task 状态，也不建立第二个 scheduler。

每个 `<run-id>` 的活状态只进入同级 `runs/<run-id>/checkpoint.json`。新 run 从冻结 `state.seed.xnl` 创建自己的 checkpoint v0；resume 从 checkpoint state 继续，不再读取 seed。运行结果、等待和 status view 均不得回写本 source bundle。

完整 hierarchy 与恢复协议见 [Definition、Instance 与 Run](../../../docs/flow-dsl/spec/flow-core/instance-run.md)。
