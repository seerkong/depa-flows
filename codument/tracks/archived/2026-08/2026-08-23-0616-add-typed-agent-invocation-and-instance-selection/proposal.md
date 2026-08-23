# 变更：增加 typed Agent invocation 与实例选择

## 背景和动机 (Context And Why)

depa-flows 已经拥有完整 `AIAgentDefinition` 投影、Agent task/resource freeze，以及 Definition→frozen Instance→Run 的单一 checkpoint authority；但 authored Ctrl/Data flow 仍只能借助 generic effect envelope 调用 Agent，checkpoint 的 AI profile 也只有松散的 external reference map，尚不能可靠地按返回 id 或 authored name 复用同一 Agent runtime instance。

本 Track 在 workflow 领域层补齐 typed invocation。底层 API 必须继续是显式 runtime 首参的 DEPA Processor；runtime-bound facade 只在组合边界闭包绑定 runtime。Agent 实例索引、稳定外部引用和 invocation receipts 统一进入当前 Flow run 的 canonical checkpoint AI profile，不建立 conversation/history/session 的第二 authority。

## “要做”和“不做” (Goals / Non-Goals)

**目标：**

- 提供 `runAgent(agentRuntime, input, config)` 与 `runTargetedAgent(agentRuntime, selector, invocation, config)` 两个 canonical Processor。
- 提供同名 runtime-bound authored facade：`runAgent(input, config)` 与 `runTargetedAgent(selector, invocation, config)`。
- 定义 closed selector：`{ byInstanceId: string } | { byInstanceName: string }`，并对所有歧义、空值、未解析和索引冲突 fail closed。
- `runAgent` 返回 output、稳定 instance identity 和 execution receipt；后续节点可直接使用返回的 `instance.instanceId`，也可使用 run-local authored `instanceName`。
- 让 canonical `FlowRunCheckpoint.profile.ai` 拥有 run-local id/name index、pending/completed invocation receipts 和 opaque host runtime refs，并以 CAS 支持等待、完成和 fresh recovery。
- 在不扩张 substrate grammar 的前提下，为 AICtrlWorkflow 的普通 `Run` 和 AIDataWorkflow 的普通 processor node 定义 typed Agent task/config binding。
- 让 generated Flow DSL reference、examples 与 public authored runtime typings只教授 named methods；generic dispatcher 仅保留给 host/runtime infrastructure。

**非目标：**

- 不在 depa-flows 实现 provider、actor、session、tool 或 conversation store；这些由 host 的通用 Agent runtime 拥有。
- 不把 conversation、message history、compaction 或 actor state复制进 Flow checkpoint。
- 不新增 `AIAgentTask`、`AgentTask` 等角色专属 WorkCtrlFlow/EagerDataFlow substrate node。
- 不让 targeted selector 解析失败时回退为新建 Agent instance。
- 不新增 workflow-specific filesystem root、sidecar state file 或第二 checkpoint owner。
- 不改变 Halfcode 的 ResourcePackage、Kind、catalog、dependency closure 或 resource loader authority。
- 不实现 Eidolon bootstrap/generated-code/publication gate；本 Track只提供 depa-owned public contract、logic、DSL reference和examples。
- 不发布 package；发布由后续 mission 阶段以末端最小 patch 版本完成。

## 变更内容（What Changes）

- **BREAKING authored surface:** authored runtime 从 generic Agent `invoke` envelope 收敛到 named typed methods；host infrastructure compatibility dispatcher 可以保留，但不再出现在 authored facade。
- 为 Agent Processor runtime、config、invocation、selector、stable instance reference、result 与 receipt增加 closed public types和 normalizer。
- 把 AI profile durable state收紧为以 instance id 为 authority 的索引、name→id 唯一索引及可恢复 invocation receipt；旧松散 external refs只通过显式兼容投影读取，不成为新写入 authority。
- 在 effect logic 中实现 run-local reservation、host dispatch、checkpoint CAS 与完成回写；同一 invocation key 在等待、重入和恢复时不得创建第二实例或第二 host child。
- 为 AICtrlWorkflow 与 AIDataWorkflow 补齐 typed Agent task/config 的编译、runtime binding、示例和文档。
- 增加 selector 边界、name唯一性、id/name conflict、pending/completed/fresh recovery、Ctrl/Data数据绑定和 public authored surface 回归测试。

## 影响范围（Impact）

- 受影响的能力（behaviors）：`ai-workflow-effects`、`flow-profile-runtime`、`ai-ctrl-workflow`、`ai-data-workflow`。
- 受影响的代码：`ai-workflow-contract`、`ai-workflow-logic`、`ai-ctrl-workflow-*`、`ai-data-workflow-*`、Flow DSL docs/reference generator 与 Ctrl/Data XNL examples。
- 兼容性：host infrastructure 的 generic dispatcher可作为显式兼容入口保留；新 authored runtime types、generated code 和示例不得暴露它。已有 checkpoint AI state需要确定性 read/upgrade adapter，新的 commit 只写 canonical typed state。
