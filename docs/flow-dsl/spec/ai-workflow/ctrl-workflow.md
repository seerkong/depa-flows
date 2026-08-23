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

普通 `Run` 节点可通过exact frozen Agent task binding调用typed Agent Processor。底层只提供runtime-first `runAgent(agentRuntime, input, config)`与`runTargetedAgent(agentRuntime, selector, invocation, config)`；组合边界提供同名 `runtime.ai.effects` bound facade。selector只能是exact `{byInstanceId}`或`{byInstanceName}`，resolved identity与receipt随WorkCtrl snapshot进入同一canonical checkpoint；authored surface不暴露generic `invoke`。

## State and recovery

Recovery is WorkCtrlFlow-backed, but its durable owner is one `FlowRunCheckpoint`. The `AICtrlWorkflow` typed profile contains the WorkCtrl snapshot plus closed AI durable state; the common checkpoint envelope contains input/config/state/output and controller/node sidecars. External runtime facts are retained only as opaque identities and receipts.

Before the first node, the complete bundle is admitted as a frozen Instance. A fresh process recompiles from that instance and resumes from the checkpoint; it does not read the live Definition. Node positioning uses stable ids/invocation keys, not array index. Events, run indexes and status views are rebuildable projections and cannot write back to the checkpoint.

The canonical controller CAS-commits checkpoint `v0` with `lastTickNo = 0` before invoking any node. Its historical `stateStore` runtime field is a readonly projection; the writable `AIWorkflowStateStore` API is legacy/derived compatibility and is not a second owner.

See [Definition、Instance 与 Run](../flow-core/instance-run.md) for the physical hierarchy and one-way legacy boundary.
