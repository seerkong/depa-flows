# Track：implement-ai-data-workflow-on-eager-data-flow

## 背景

AI Data Workflow 需要把 AI 任务组织成可迭代修改的 DAG，并保存 run-local 的节点状态、patch/generation/invalidation 和 semantic reuse 记录。现有 EagerDataFlow 已提供 eager DAG authoring plan、节点、端口和依赖边，因此本 track 在其上建立 AI Data Workflow RunGraph 层。

## 目标

- 新增 AI Data Workflow contract/logic 包。
- 从 EagerDataFlowAuthoringPlan 派生 RunGraph。
- 一等支持 GraphPatch、generation 历史和传递性 invalidation。
- 支持 node-level reuse policy，默认 semantic-hash，manual 默认 never。
- 在 run-local scope 下复用语义等价节点结果，不把 generation 写入复用指纹。

## 非目标

- 不替换 EagerDataFlow scheduler。
- 不实现跨 run 共享缓存。
- 不新增完整 XNL 示例；后续 docs/examples track 负责。

## 成功判据

- RunGraph 可由 EagerDataFlow plan 构建。
- Patch 会产生新 generation 和 patch history。
- 修改节点会传递性 invalidation 下游节点。
- 相同语义指纹可跨 generation run-local reuse；`never` policy 不复用。
- Typecheck、tests、路径卫生通过。
