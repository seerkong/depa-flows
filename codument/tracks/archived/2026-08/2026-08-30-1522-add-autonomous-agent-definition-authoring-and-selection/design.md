# Design：自主 AIAgentDefinition authoring 投影与 typed selection

## Authority 与边界

唯一资源 authority 仍是 Halfcode authoring layer 与它刷新出的 effective registry。`ResourceAuthoringReceipt` 是一次 transaction 的证据，不能单独证明资源当前有效；depa-flows 必须把 receipt 与当前 registry、content identities、effective origin 和 content-sensitive registry revision 对账。Candidate 与 admission 都是只读、可丢弃的领域投影，不能反写 registry。

```text
Halfcode ResourceAuthoringProposal
  -> Halfcode plan/apply/CAS/refresh
  -> ResourceAuthoringReceipt + EffectiveResourceRegistry
  -> depa-flows authored-definition reconciliation
  -> detached AgentDefinitionCandidate
  -> typed selection admission
  -> existing AIWorkflow run-freeze
  -> FrozenAIAgentTaskBinding
```

`author-new` 不是“直接相信一份 Agent XNL”。它只是一个被 requirement、candidate set 与当前 registry revision约束的 selection admission，携带标准 Halfcode proposal。Host 必须先交给 Halfcode plan/apply；只有原始 author-new admission、Halfcode transaction port 持久化并可按 `planDigest` 重新读取的 receipt、以及新 effective registry 三者通过 reconciliation，才会解除该 resource ref 的 in-flight gate并出现带 authoring evidence 的可选择 candidate与 executable proof。自行重算 `receiptDigest` 只证明内容自洽，不证明 receipt 来自 transaction authority，因此不能通过此 gate。

这里的 gate 约束一次进程内正在执行的 `author-new` transition：同 ref 在 reconciliation 前即使已出现在一次 refreshed projection 中，也会以 `authoring-in-progress` 拒绝选择。已经存在于启动时 canonical effective registry 的 definition 本身就是 Halfcode authority，仍按普通 existing candidate 选择；进程重启后已持久化的资源同样属于 existing authority，不要求永久携带历史 transaction receipt。

## Typed task requirement

`AgentTaskRequirement` 分为两类信息：

- `objective` 是 Controller/审计 evidence，不参与代码级 candidate routing。
- typed constraints 是 admission authority：input/output schema ref、required Tool refs、EffectPolicy/tool mode、MaterialPort refs、ContextPipeline ref、MessageSource refs。

约束使用 exact `resource://` identity。集合 canonicalize 为 UTF-16 稳定排序、唯一值；requirement digest覆盖所有字段。兼容规则是确定性的集合包含或 exact identity匹配，不分析 prompt 文本，也不根据 resource/name做猜测。

## Candidate projection

Candidate 从 `projectAIWorkflowAgentResources` 的 authentic projection与同一 effective registry/content identity构造，包含：

- exact `agentDefinitionRef`、`contentDigest`、`registryRevision`；
- input/output schema、tools、effect policy、material ports、ContextPipeline、MessageSource的 detached typed facts；
- candidate digest，覆盖资源身份、content identity、typed facts以及存在时的authoring evidence；
- 可选 authoring evidence（receipt digest/plan/transaction），仅当 receipt与当前 effective resource逐字段对账成功。

普通既有 definition 与本轮新 authoring definition使用相同 candidate shape；差别只是新资源可附带 authoring evidence，selection不能为它另开特权路径。

## Selection 与 admission

Controller decision 是 closed union：

1. `select-existing`：引用 exact candidate ref/digest；
2. `author-new`：携带标准 Halfcode `ResourceAuthoringProposal`，且 proposal必须创建 `AIAgentDefinition`、目标 resource ref与decision一致、expected registry revision等于当前candidate projection revision。

两类 decision 都绑定 `requirementDigest` 与 `candidateSetDigest`，陈旧 observation 必须 fail closed。Existing admission重新计算 compatibility；不兼容 candidate即使模型选中也拒绝。Author-new admission只接纳“需要进入 Halfcode transaction的请求”，不伪造 candidate、receipt或proof。

## Task proof

一个 existing 或 authoring 后重新选择的 admission，使用 exact workflow kind/ref/node与candidate definition ref调用既有 `freezeAIWorkflowRunResources`。因此 MaterialBinding、dependency closure、semantic fingerprint与authentic WeakSet proof机制不分叉。动态资源不修改 parent run原 dependency snapshot；调用方把新 receipt/candidate/proof作为新增节点或child run的增量 executable evidence保存。

## Package 与版本

实现消费公开的 `halfcode-compiler.xnl/authoring-runtime` 与 `resource-core` subpath，不引用 Halfcode 源码路径或私有 workspace package。由于 `0.2.8` 已对应旧的不可变 registry 字节，本 Mission 先产生并安装通过 tarball-only consumer 门禁但尚未发布的 `halfcode-compiler.xnl@0.2.9` 本地 candidate；`ai-workflow-contract@0.1.9` 与 `ai-workflow-logic@0.1.10` manifest保持 exact semver，禁止 `file:`/`workspace:`协议。npm 发布仍是单独、显式的后续决策。

## 验证矩阵

- 两个 candidate 中仅一个满足 schema/tool/effect/context typed requirement，选择正确者并冻结 exact task proof。
- 缺少兼容 candidate时，`author-new` admission接受标准 Halfcode create proposal，但在 receipt前不产生candidate/proof。
- Halfcode apply后的真实 durable receipt、原 author-new admission与effective registry产生新 candidate；随后可按普通 existing路径选择和freeze。
- author-new尚未reconcile时，直接重新投影refreshed registry并选择同ref仍被in-flight gate拒绝。
- 自签且重新计算过`receiptDigest`、但不能由原Halfcode transaction port按`planDigest`读取的receipt被拒绝。
- forged、stale、wrong-kind、wrong-content、wrong-authority-bytes、wrong-origin receipt fail closed。
- candidate/ref/digest、requirement digest、candidate-set digest任一陈旧或篡改均拒绝。
- candidate名称或prompt包含相似文字但typed facts不满足时不得被选择。
