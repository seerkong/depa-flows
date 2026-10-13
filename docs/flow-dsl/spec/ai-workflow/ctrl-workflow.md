# L3 · AICtrlWorkflow profile

`AICtrlWorkflow` is the AI-facing WorkCtrlFlow profile. Use it when a run may wait for an agent, tool, human review, timer or other durable external signal.

## Root shape

```xnl
<AICtrlWorkflow #depa.examples.SupportReview apiVersion="depa.flows/v1" version="1.0.0" (
  <FlowContract #depa.examples.SupportReview {
    input = "vfs://./flow-code/agent.ts#SupportReviewInput"
    output = "vfs://./flow-code/agent.ts#SupportReviewResult"
  }>
) [
  <Run #draft-context {
    src = "vfs://./flow-code/agent.ts#draftContext"
  }>
  <ExternalJob #agent-review {
    signalKind = "ai.agent.reviewed"
    signalKey = "support-review"
  }>
  <Return #done {
    src = "vfs://./flow-code/agent.ts#toResult"
  }>
]>
```

## Statements

`AICtrlWorkflow` accepts the WorkCtrlFlow statement surface:

- shared CtrlFlow statements such as `Run`, `If`, `Fallback`, `Retry`, `Timeout`, `Until`, `ForEach`, `Parallel`, `Race`, `CallFlow` and `Return`;
- WorkCtrlFlow interruptible statements such as `ExternalJob` and `Timer`.

It does not accept BPCtrlFlow-only `TaskStep` unless a future profile explicitly extends it.

## Runtime-first AI context

Dynamic code receives the host runtime. AI-capable runtimes include an `ai` field with roots, state port and embedded effect provider. Runtime-bearing code remains a DEPA Processor:

```ts
export function draftContext(runtime: AICtrlRuntime, input: SupportReviewInput, config: ReviewConfig) {
  return runtime.review.prepare(input, config)
}
```

普通 `Run` 节点可通过exact frozen Agent task binding调用typed Agent Processor。底层只提供runtime-first `runAgent(agentRuntime, input, config)`与`runTargetedAgent(agentRuntime, selector, invocation, config)`；组合边界提供同名 `runtime.ai.effects` bound facade。selector只能是exact `{byId}`或`{byName}`，旧的instance-prefixed keys fail closed；resolved identity与receipt随WorkCtrl snapshot进入同一canonical checkpoint；authored surface不暴露generic `invoke`。

需要遵循启动时已冻结的节点来源时，使用显式节点入口 `runtime.ai.tasks.invoke(input, {agentDefinitionRef})`，返回本次任务的业务输出。它先验证同节点的冻结 Agent 定义证明：未覆盖来源时调用原资源 Agent Processor；已覆盖时只调用原准入委托 owner，unknown 继续观察原 invocation，不回退新建 Agent。来源来自 canonical checkpoint 的不可变配置，不能由任务 input 指定。委托路径拒绝额外 `instanceName`、`materialRefs` 或 `effectPolicy`，避免静默忽略与原准入不一致的 Agent 选项；其材料、模型、上下文沿冻结委托。原 `runAgent`/`runTargetedAgent` 仍保留严格定义、selector 与来源保护。这不是通用 Effect 派发入口。

Host 可在首次 checkpoint 中冻结 `workflowAgentContexts[nodeId] = {schemaVersion: "workflow.agent-context/v1", agentDefinitionRef, sessionPolicy}`。`shared` 通过同一 canonical 实例索引把后续完整任务交给原实例；`independent-per-generation` 按实际节点代次及原生 lane scope 使用不同实例。配置缺省时，旧命名、targeted 和 receipt 行为保持。ctrl 绑定器提供的 `nodeContext` 只用于显式策略，不把旧 receipt 的缺省代次改写成新事实。错误定义、缺代次、越代或跨 lane 的 targeted 及额外实例名均在派发前拒绝；不能用作者指定名字替换冻结上下文身份。该配置只管理原生实例选择，不选择主机模型、读主机文件或承担频道派工。

`sessionPolicy: "authored"` 保留作者的原实例名和显式 targeted 选择，只采用真实节点代次；适合保留既有作者执行方式的新运行。Host 可同时冻结 `nodeIdentity: true` 作为新节点身份协议的采用标记。旧冻结配置没有该标记时，主机不能给既有请求补字段而改变原 Effect 请求指纹或历史身份。

## State and recovery

Recovery is WorkCtrlFlow-backed, but its durable owner is one `FlowRunCheckpoint`. The `AICtrlWorkflow` typed profile contains the WorkCtrl snapshot plus closed AI durable state; the common checkpoint envelope contains input/config/state/output and controller/node sidecars. External runtime facts are retained only as opaque identities and receipts.

Before the first node, the complete bundle is admitted as a frozen Instance. A fresh process recompiles from that instance and resumes from the checkpoint; it does not read the live Definition. Node positioning uses stable ids/invocation keys, not array index. Events, run indexes and status views are rebuildable projections and cannot write back to the checkpoint.

The canonical controller CAS-commits checkpoint `v0` with `lastTickNo = 0` before invoking any node. Its historical `stateStore` runtime field is a readonly projection; the writable `AIWorkflowStateStore` API is legacy/derived compatibility and is not a second owner.

See [Definition、Instance 与 Run](../flow-core/instance-run.md) for the physical hierarchy and one-way legacy boundary.

For organization-level delegation, see [Holon-targeted organization tasks](holon-task.md). It uses the shared TaskSpace owner and frozen Holon snapshot rather than adding a Ctrl-specific task forest.
