# AI Ctrl workflow · Frozen execution example

[`manifest.xnl`](manifest.xnl) 是 `AICtrlWorkflow` Definition，[`flow-code/agent.ts`](flow-code/agent.ts) 是通过 `vfs://` 挂接的 runtime-first code。source bundle 不保存 instance、run、等待结果或外部 runtime state。

执行前完整 bundle 被录取为 frozen Instance。每个 run 的 canonical `checkpoint.json` 使用 `profile.kind = "AICtrlWorkflow"`，并在一次 version transition 中共同保存：

- `input/config/state/output`；
- controller/node sidecars，包括 WorkCtrl wait/resume/branch facts；
- `profile.snapshot`；
- `profile.ai` 中按 instance id 建立的 opaque external-runtime refs、唯一 name index 与 pending/completed invocation receipts。

events、run index 和 status view 只能从 checkpoint 投影。fresh process 从 instance descriptor、frozen definition 与 checkpoint 恢复，不读取 live source bundle。

本示例的普通 `Run` code保持 `output = fn(runtime, input, config)`：首次调用同名 bound `runtime.ai.effects.runAgent(input, config)`，后续节点以 exact `{byInstanceName}` 调用 `runTargetedAgent`。bound facade只闭包绑定 canonical runtime-first Processor；底层仍是 `runAgent(agentRuntime, input, config)` / `runTargetedAgent(agentRuntime, selector, invocation, config)`。authored surface不暴露 generic `invoke`，也不保存child history。

物理目录和 CAS 约束见 [Definition、Instance 与 Run](../../../docs/flow-dsl/spec/flow-core/instance-run.md)。
