# Track：implement-ai-ctrl-workflow-on-work-ctrl-flow

## 背景

AI Ctrl Workflow 需要长生命周期、可挂起、可恢复和节点状态投影。现有 WorkCtrlFlow 已提供快照、WaitHandle、ResumeSignal 与状态恢复能力，因此本 track 在 WorkCtrlFlow 之上建立 AI Ctrl Workflow profile adapter。

## 目标

- 新增 AI Ctrl Workflow contract/logic 包。
- 复用 WorkCtrlFlowEngine、WorkCtrlFlowStore 与 WorkCtrlFlowSnapshot，不复制底层 flow engine。
- 将 AI runtime context 注入 WorkCtrlFlow runtime。
- 提供 start/resume/refresh/outcome 的 run record 投影。
- 保留节点状态记录与恢复信息来自 WorkCtrlFlow snapshot。

## 非目标

- 不实现 AI Data Workflow DAG。
- 不新增完整 XNL profile docs/examples。
- 不调用外部 CLI effect provider。
- 不硬编码 runtime state roots。

## 成功判据

- AI Ctrl Workflow adapter 能启动一个 WorkCtrlFlow-backed run。
- Run record 能投影 workflow status、open wait handles 和 node statuses。
- ResumeSignal 仍走 WorkCtrlFlowEngine。
- Typecheck、tests、路径卫生通过。
