# L3 · Halfcode-backed AI workflow resources

AI workflow 资源以 Halfcode `ResourcePackage` 为通用 authority。Halfcode 负责 Catalog、KindDefinition、文件发现、URI containment、identity、provenance、layer composition 与 dependency snapshot；depa-flows 只读取规范化 `ResourceRecord`，投影 AI workflow 领域语义。

这意味着 `AIWorkflowAppBundle` 仍然存在，但它不再拥有一套通用 `ResourceCatalog`。它只是工作流领域的 app projection：明确声明哪些 `AICtrlWorkflow` / `AIDataWorkflow` 属于该 app，以及哪些 workflow 是 entrypoint。

## Authority pipeline

```text
XNL ResourcePackage
  -> halfcode-compiler.xnl/resource-core loadResourceTree
  -> ResourceTree.registry / EffectiveResourceRegistry.byKind
  -> depa-flows projectAIWorkflowAppBundles / projectAIWorkflowAgentResources
  -> AIWorkflowAppBundleProjection / AIWorkflowAgentResourceProjection
  -> depa-flows run-freeze (Node-only)
  -> Halfcode ResourceDependencySnapshot
```

边界约束：

- depa-flows 不遍历资源目录、不解析第二份 Catalog、不从路径推导 identity。
- `ResourcePackage`、`Catalog`、`KindDefinition` 和通用 `vfs://` containment 的规范均由 Halfcode 维护。
- wrapper（例如 Eidolon）绑定真实 root，但 root policy 不进入 workflow definition。
- workflow projector 只检查明确的 `WorkflowBindings` 结构，不扫描 prompt、任意 property 或自然语言。

## Package shape

AI workflow app 可以与其他资源一起放在标准 Halfcode package 中：

```text
support-agent/
  manifest.xnl                         # ResourcePackage（Halfcode authority）
  KindDefinitions/
    AIWorkflowAppBundle/manifest.xnl
    AICtrlWorkflow/manifest.xnl
    AIDataWorkflow/manifest.xnl
  Apps/
    SupportAgent.xnl                   # AIWorkflowAppBundle domain resource
  CtrlWorkflows/
    SupportAgent.xnl
  DataWorkflows/
    Evidence.xnl
```

package 根、Catalog 和 KindDefinition 的完整写法以 Halfcode Resource DSL 为准。depa-flows 只拥有下面的 workflow Kind 内容契约。

## AIWorkflowAppBundle

`WorkflowBindings[]` 保留 authoring 顺序。每个 `WorkflowBinding` 必须显式声明：

- `#id`：app 内唯一 binding id；
- `kind`：精确为 `AICtrlWorkflow` 或 `AIDataWorkflow`；
- `ref`：`resource://<resource-id>`；
- `entrypoint`：显式 boolean。

```xnl
<AIWorkflowAppBundle #depa.flows.demo.SupportAgent apiVersion="depa.flows/v1" version="1.0.0" {
  lifecycle = "Active"
  description = "Support agent workflow app"
} (
  <WorkflowBindings [
    <WorkflowBinding #primary {
      kind = "AICtrlWorkflow"
      ref = "resource://depa.flows.demo.SupportAgent.Workflow"
      entrypoint = true
    }>
    <WorkflowBinding #evidence {
      kind = "AIDataWorkflow"
      ref = "resource://depa.flows.demo.SupportAgent.Evidence"
      entrypoint = false
    }>
  ]>
)>
```

projector 会按 exact resource identity 在 Halfcode registry 中解析目标，并核对目标 record 的 kind。任一 binding 缺失、重复、目标不存在或 kind 不一致时，整个 projection fail closed；不会返回 partial app。

至少一个 binding 必须是 entrypoint。entrypoint 是 workflow 领域语义，不会替代 Halfcode package root 或 Catalog。

## AIAgentDefinition

`AIAgentDefinition` 是可复用 Agent 能力的资源定义，不是 Eidolon actor/session 配置，也不是新的 WorkCtrlFlow statement。它只通过固定 child nodes 声明资源关系：

- `Messages[]`：按 authoring 顺序保存 `Message`；`#id` 在 Agent 内唯一，`role` 精确为 `system | developer | user | assistant`，prompt 使用显式 `promptKind + promptRef`；
- `InputSchemaRef` / `OutputSchemaRef`：可选的单一 typed ref；
- `ToolRefs[]`：有序 `ToolRef`，每项显式 `kind + ref`；
- `EffectPolicyRef`：可选的单一 typed ref；
- `MaterialPortRefs[]`：有序 `MaterialPortRef`，目标 kind 固定为 `MaterialPort`。

```xnl
<AIAgentDefinition #depa.flows.demo.Agent.Support apiVersion="depa.flows/v1" version="1.0.0" {
  lifecycle = "Active"
  description = "Support Agent definition"
} (
  <Messages [
    <Message #system {
      role = "system"
      promptKind = "Prompt"
      promptRef = "resource://depa.flows.demo.Prompt.Support.System"
    }>
    <Message #user {
      role = "user"
      promptKind = "Prompt"
      promptRef = "resource://depa.flows.demo.Prompt.Support.User"
    } (
      <SchemaRef { kind = "MessageSchema" ref = "resource://depa.flows.demo.Schema.Request" }>
    )>
  ]>
  <InputSchemaRef { kind = "MessageSchema" ref = "resource://depa.flows.demo.Schema.Request" }>
  <OutputSchemaRef { kind = "MessageSchema" ref = "resource://depa.flows.demo.Schema.Response" }>
  <ToolRefs [
    <ToolRef #lookup { kind = "Tool" ref = "resource://depa.flows.demo.Tool.Lookup" }>
  ]>
  <EffectPolicyRef { kind = "EffectPolicy" ref = "resource://depa.flows.demo.Policy.Safe" }>
  <MaterialPortRefs [
    <MaterialPortRef #request { kind = "MaterialPort" ref = "resource://depa.flows.demo.Port.Request" }>
  ]>
)>
```

projector 只读取这些固定位置。普通 prompt、description、metadata 或其他 property 中即使出现 URI 形式文本或业务词语，也不会产生 tool、policy、task 或 dependency edge。

### Executable schema and effect policy

`MessageSchema` 必须在唯一的 `schema` property 中声明 JSON Schema value map。schema 是资源内容事实；projector 会把它复制成与 Halfcode record 分离的深度不可变值。缺少 map、出现非有限 number、稀疏 list、accessor、symbol、cycle 或非 plain-data object 时，整个 Agent projection fail closed。

```xnl
<MessageSchema #depa.flows.demo.Schema.Request apiVersion="depa.flows/v1" version="1.0.0" {
  lifecycle = "Stable"
  schema = {
    type = "object"
    properties = { request = { type = "string" } }
    required = ["request"]
    additionalProperties = false
  }
}>
```

`EffectPolicy` 的首个标准化执行 profile 是闭集 `toolMode`：

- `declared-only`：运行 host 只可向 Agent 暴露 `ToolRefs[]` 中声明且成功解析的 exact tools；
- `none`：运行 host 不可向 Agent 暴露工具；若 definition 同时声明非空 `ToolRefs[]`，host 必须 fail closed。

```xnl
<EffectPolicy #depa.flows.demo.Policy.DeclaredOnly apiVersion="depa.flows/v1" version="1.0.0" {
  lifecycle = "Stable"
  toolMode = "declared-only"
}>
```

depa-flows 只投影并冻结 schema/policy 领域事实，不选择 JSON Schema validator、不解析 host tool catalog，也不创建 actor。JSON Schema 校验、exact tool binding 与 actor lifecycle 由运行 host 承担。

## MaterialPort and MaterialBinding

`MaterialPort` 定义 Agent 可消费的 material contract：

```xnl
<MaterialPort #depa.flows.demo.Port.Request apiVersion="depa.flows/v1" version="1.0.0" {
  materialKind = "RequestMaterial"
  required = true
  cardinality = "one"
} (
  <SchemaRef { kind = "MessageSchema" ref = "resource://depa.flows.demo.Schema.Request" }>
)>
```

`required` 必须是 boolean，`cardinality` 精确为 `one | many`。`SchemaRef` 可选。Agent 的 `MaterialPortRefs[]` 顺序是 run freeze 的 port 顺序 authority；`many` port 内多个 binding 再按 resource id 的固定 UTF-16 code-unit 顺序排列。

`MaterialBinding` 把一个精确 workflow node + Agent tuple 的 port 绑定到一个 material：

```xnl
<MaterialBinding #depa.flows.demo.Binding.Request apiVersion="depa.flows/v1" version="1.0.0" {
  lifecycle = "Active"
} (
  <AgentTaskRef {
    workflowKind = "AICtrlWorkflow"
    workflowRef = "resource://depa.flows.demo.Workflow.Support"
    nodeId = "collect-request"
    agentDefinitionRef = "resource://depa.flows.demo.Agent.Support"
  }>
  <PortRef { kind = "MaterialPort" ref = "resource://depa.flows.demo.Port.Request" }>
  <MaterialRef { kind = "RequestMaterial" ref = "resource://depa.flows.demo.Material.Request.001" }>
)>
```

`AgentTaskRef` 只是资源选择 tuple，不新增 substrate node，也不包含 run id、session、generation、actor 或 provider。所有 ref 都按完整 resource identity 和目标 kind 精确核对；相似名称没有关联语义。

被选择的 material 必须在资源根的 `value` property 中声明可执行 `ResourceValue`。projector 深复制并冻结该值，运行 host 按 Agent 的 `MaterialPortRefs[]` authoring 顺序组装输入；`cardinality="many"` 的同一 port 内再按 MaterialBinding resource id 的固定 UTF-16 code-unit 顺序排列。

```xnl
<RequestMaterial #depa.flows.demo.Material.Request.001 apiVersion="depa.flows/v1" version="1.0.0" {
  lifecycle = "Active"
  value = { request = "request-001" }
}>
```

输入 schema 校验发生在 dispatch 前，输出 schema 校验发生在 Agent 完成、workflow node 接收结果前。MaterialPort 自身的可选 `SchemaRef` 验证每个绑定值；Agent 的 `InputSchemaRef` 验证由 ordered port values 形成的完整输入。任一校验失败都不得启动 provider call、写入成功 result 或隐式丢弃 material。

同一 tuple 同时适用于两种 profile：`AICtrlWorkflow` 的普通 `Run` node 与 `AIDataWorkflow` 的普通 `TransformNode` 可以通过各自明确的 `ai.agent` effect 调用该 Agent。`workflowKind` 必须与目标 workflow record kind 完全一致；depa-flows 不新增 `AIAgentTask` substrate statement，也不根据 node 名称、文字描述或 topology 猜测 Agent 调用。

## Typed dependency relations

depa-flows 只发出闭集 relation：

- `agent-message-prompt`、`agent-message-schema`；
- `agent-input-schema`、`agent-output-schema`；
- `agent-tool`、`agent-effect-policy`、`agent-material-port`；
- `material-port-schema`；
- `material-binding-port`、`material-binding-material`；
- run freeze 期间的 `workflow-agent-task`、`workflow-material-binding`。

Halfcode 验证 edge endpoints、计算 reachable closure 并生成 revision；depa-flows 不实现 generic dependency resolver。

## Run resource freeze

纯 projection 仍从 root/browser entry 导出：

```ts
import { projectAIWorkflowAgentResources } from "ai-workflow-logic"

const projection = projectAIWorkflowAgentResources(effectiveRegistry)
```

Node/server consumer 使用独立 entry，输入必须是同一个 authentic effective registry、由该 registry 产生的 exact projection，以及 Halfcode loader-owned content identities：

```ts
import { freezeAIWorkflowRunResources } from "ai-workflow-logic/run-freeze"

const receipt = freezeAIWorkflowRunResources({
  registry: effectiveRegistry,
  projection,
  task: {
    workflowKind: "AICtrlWorkflow",
    workflowRef: "resource://depa.flows.demo.Workflow.Support",
    nodeId: "collect-request",
    agentDefinitionRef: "resource://depa.flows.demo.Agent.Support",
  },
  contentIdentities,
})
```

freeze 会检查 port 属于 Agent、required/cardinality 与 material kind，然后直接调用 Halfcode `buildResourceDependencySnapshot`。receipt 深度不可变，包含：

- exact task 与 ordered binding resource ids；
- 完整 Halfcode `ResourceDependencySnapshot`，用于 proof/recovery；
- `sha256:` domain semantic fingerprint，只绑定所选 task、Agent/Message/Tool/Policy/Port/Binding、participating edges 与 reachable content digest。

完整 snapshot revision 会绑定 effective registry revision，因此未被选择的资源变化也可能改变 proof。domain semantic fingerprint 排除未被选择的资源以及 host run/session/generation/path facts；两者不得混用。

## Public consumer API

纯 projection 可用于 browser 或任何已取得 normalized registry 的 consumer：

```ts
import { projectAIWorkflowAppBundles } from "ai-workflow-logic"

const apps = projectAIWorkflowAppBundles(effectiveRegistry)
const agentResources = projectAIWorkflowAgentResources(effectiveRegistry)
```

输入是 Halfcode public `Pick<ResourceRegistry, "byKind">` read port；`ResourceTree.registry` 与 `EffectiveResourceRegistry` 都可直接使用。

需要从 filesystem root 加载时，使用单独的 Node entry：

```ts
import { loadAIWorkflowResourcePackage } from "ai-workflow-logic/filesystem"

const loaded = await loadAIWorkflowResourcePackage({ rootDir: resourceRootDir })
```

该 adapter 直接调用 Halfcode `loadResourceTree`。depa-flows 没有 fallback scanner 或 containment 实现。`ai-workflow-logic/browser` 仍只导出纯 projector。

## Compatibility surface

早期发布的 `AIWorkflowResourceCatalog`、`AIWorkflowAppBundleManifest`、`AIWorkflowResourceRef` 和 ref helper 在 `0.1.x` 中保留为 deprecated compatibility surface，避免 patch upgrade 破坏既有 import。它们不再出现在 canonical authoring pipeline 中，新 Kind 不得扩展这些旧类型形成第二套 registry。

## Facts and runtime state

- XNL ResourcePackage 和 ResourceRecord：Halfcode-owned authoring facts。
- AIWorkflowAppBundleProjection：可从 normalized records 重建的 depa domain projection，不反写 source。
- AIWorkflowAgentResourceProjection：固定 Agent/Message/schema/effect-policy/Material 关系及其不可变可执行值的可重建 depa domain projection，不是第二份 registry。
- AIWorkflowRunResourceFreezeReceipt：Halfcode snapshot proof + depa selected-resource semantic fingerprint；作为 run checkpoint 可验证 evidence 持久化或引用，但不成为并列 run authority，也不回写 source。
- AICtrlWorkflow / AIDataWorkflow definition：workflow domain facts。
- workflow snapshot / RunGraph：同一 FlowRunCheckpoint typed profile 中的运行态，不回写 ResourcePackage 或 app projection。
- global/workspace root、installation 与 external runtime：host-owned facts；checkpoint 只保存 opaque identity/receipt，不复制其内部历史。

Definition freeze、single checkpoint owner 与 fresh recovery 见 [Definition、Instance 与 Run](../flow-core/instance-run.md)。
