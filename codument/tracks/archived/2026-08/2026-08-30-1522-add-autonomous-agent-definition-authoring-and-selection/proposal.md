# 变更：自主 AIAgentDefinition authoring 投影与 typed selection

## 背景和动机 (Context And Why)

当前 depa-flows 已能从 Halfcode effective registry 投影、冻结并执行一个既有 `AIAgentDefinition`，但“动态 Agent”仍只表示创建新的 runtime instance。Controller 不能表达一个可机器校验的 Worker 任务需求，不能在多个 definition candidate 中选择，也不能把 Halfcode runtime authoring transaction 新产生的 definition receipt 接回 projection/freeze 链路。这使早期 AI Workflow 的“自主创建 AgentDefinition”能力在迁移中只留下了一半。

Halfcode 已提供通用 `ResourceAuthoringProposal -> Plan -> Apply -> Receipt` 事务。本 Track 在 depa-flows 建立 AI 领域的 typed projection/admission：Halfcode 继续拥有资源与 registry authority；depa-flows 只把真实 effective registry 和 receipt 投影成 Agent candidate、验证 typed requirement、接纳 `select-existing | author-new` 决策，并为已选择 definition 产生既有的 frozen task proof。

## "要做"和"不做" (Goals / Non-Goals)

目标：

- 定义 `AgentTaskRequirement`、detached candidate、selection decision 与 admission 的 closed typed contract。
- 从当前 Halfcode effective registry 投影所有可用 `AIAgentDefinition` candidate，并以 exact resource/content/registry identity 绑定。
- 验证 Halfcode authoring receipt 对应的资源确实已进入当前 effective registry，再投影为新 candidate。
- 让 Controller 选择 exact existing candidate，或提交一个 `AIAgentDefinition` 的 Halfcode `ResourceAuthoringProposal` 请求 `author-new`。
- admission 只按 schema、tool/effect、material、ContextPipeline、MessageSource 等 typed facts判断兼容性，并复用现有 run-freeze authority生成 task proof。

非目标：

- 不实现 Halfcode generic authoring transaction、文件写入、CAS 或 registry refresh。
- 不在本 Track 接入 Eidolon tool/effect host；该组合属于后续 host integration Track。
- 不动态扩展 `AIDataControlCapabilityCatalog`，不创建新的 catalog authority。
- 不按文件名、Agent 名称、prompt 文本或自然语言 reason 在代码中做 fuzzy routing。
- 不把 runtime instance creation/targeting称为 definition authoring/selection。

## 变更内容（What Changes）

- 在 `ai-workflow-contract` 增加 Agent task requirement、candidate、decision、admission 与 authored receipt projection contract。
- 在 `ai-workflow-logic` 增加 effective-registry candidate projection、receipt reconciliation、typed compatibility admission和 selected task freeze processor。
- 补齐 existing selection、author-new、真实 receipt、伪造/陈旧 receipt、typed mismatch、无 fuzzy routing 与 exact proof 的测试。
- 把新 public contract/logic 导出并将 Halfcode dependency 对齐到包含 resource authoring API 的 exact release identity。

## 影响范围（Impact）

- 受影响能力：`ai-workflow-resource-system`
- 受影响代码：`packages/ai-workflow-contract`、`packages/ai-workflow-logic`
- 后续消费者：Eidolon AI Data Mission Controller host integration
