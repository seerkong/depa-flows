# L3 · AIDataWorkflow profile

`AIDataWorkflow` is the AI-facing EagerDataFlow profile. Use it when AI work is best represented as a DAG whose nodes can be patched, invalidated and reused inside a long-running run.

## Root shape

```xnl
<AIDataWorkflow #depa.examples.SupportEvidenceDag apiVersion="depa.flows/v1" version="1.0.0" (
  <FlowContract #depa.examples.SupportEvidenceDag {
    inputPorts = ["ticket"]
    outputPorts = ["summary"]
  }>
) [
  <EntryNode #entry>
  <TransformNode #retrieve {
    inputs = { ticket = "flow-port://#entry/ticket" }
    outputs = ["evidence"]
    src = "vfs://./flow-code/evidence.ts#retrieveEvidence"
  }>
  <TransformNode #summarize {
    inputs = { evidence = "flow-port://#retrieve/evidence" }
    outputs = ["summary"]
    src = "vfs://./flow-code/evidence.ts#summarizeEvidence"
  }>
  <ReturnNode #return {
    inputs = { summary = "flow-port://#summarize/summary" }
  }>
]>
```

## Nodes

`AIDataWorkflow` accepts the EagerDataFlow node surface:

- `EntryNode`
- `TransformNode`
- `SinkNode`
- `SubFlowNode`
- `ReturnNode`

`flow-port://#node/port` creates a data dependency. `flow-node://#node` creates a completion dependency through `waitFor`.

## Modular StepSpace form

大型 definition 可以把根内联 nodes 替换为一个精确的 `StepSpaceRef`：

```xnl
<AIDataWorkflow #depa.examples.SupportEvidenceDag apiVersion="depa.flows/v1" version="1.0.0" (
  <FlowContract #depa.examples.SupportEvidenceDag {
    inputPorts = ["ticket"]
    outputPorts = ["summary"]
  }>
  <StepSpaceRef { src = "step-space.xnl" }>
)>
```

`step-space.xnl` 通过显式 `StepRef` 定位每个 `step.xnl`；每个 Step 的唯一
`Core` 保存一个 `EntryNode`、`TransformNode`、`SinkNode`、`SubFlowNode` 或
`ReturnNode`。loader 将 Core 投影回同一个 canonical EagerDataFlow plan，所以
ports、dependency edges、declaration order 和 scheduler 语义与等价 inline
definition 完全相同。StepGroup 只表达 authoring ownership，不推导 DAG edges。
inline nodes 与 `StepSpaceRef` 同时出现会在 materialization 前关闭失败。

## RunGraph checkpoint profile

The XNL definition produces an EagerDataFlow authoring plan. At run time, AIDataWorkflow stores a RunGraph inside the run's single `FlowRunCheckpoint` typed profile, with:

- node status and generation;
- patch history;
- transitive invalidation records;
- node-level reuse policy and semantic fingerprints.

Definition edits and RunGraph patches are separate surfaces. A run patch does not rewrite the XNL definition.

RunGraph, input/config/state/output, controller/node sidecars and AI opaque refs advance in one checkpoint version transition. There is no parallel graph-state owner. The complete Definition is frozen before execution; a fresh process recompiles from that Instance and restores the RunGraph from the checkpoint. Events and indexes are rebuildable readonly projections.

The envelope is an exact reciprocal projection of the RunGraph rather than an independently writable summary: state is exactly `{ status, generation }`, the controller sidecar contains only the derived status, every declared node has exactly one `{ status, generation }` node sidecar, and only a Succeeded graph carries the Return node's result as checkpoint output. A nonterminal or Failed graph has `output = null`.

The durable RunGraph is a fixed closed profile contract rather than an opaque object. Version zero is only the complete generation-zero binding projection: empty patch/invalidation history, exactly the binding's initial nodes in binding order, all Pending with canonical type/reuse policy, and no result, fingerprint or tombstone facts. A generic checkpoint create cannot admit an already advanced graph. After admission, `runId` equals the checkpoint envelope, generation is non-negative and monotonic, and `nodes`/`declarationOrder` describe the same identities exactly once. Every node declared by the frozen binding remains present for the full run; removal retains a same-generation `Removed` tombstone rather than deleting its identity, and that tombstone cannot be removed again. Once accepted, no node may disappear. Binding and structural node facts remain immutable unless a newly appended add/update/remove operation names the target and exactly explains its after-projection; declaration order only appends declared add-node targets. Every flow-port input reference resolves to an existing node and declared source output, its URI exactly projects node/port identity, and its source appears in `dependsOn`; `dependents` is the reciprocal declaration-ordered projection. A `nodeType` patch recomputes a reuse policy carrying the same node type before the graph can be persisted. Generation-zero nodes match the binding's tag, ports, config and dependency projection. A terminal execution node carries a result with the same node id and generation as its owner; its status, fingerprint and exact output-port keys project to that node. Reused results carry a matching fingerprint and `reusedFrom` identity. Graph invalidations reference declared source/target nodes and exactly equal the union of each node's `invalidatedBy` facts. Patch history and invalidations retain their accepted append-only prefixes and append-monotonic generations; every newly appended fact uses the graph's accepted current generation and its target node projects that generation. Public patch/invalidation Processors reject an explicitly selected generation that precedes either the graph or an affected node. An invalidation that emits no facts is a deterministic no-op and cannot advance generation. An accepted terminal result, output and fingerprint are immutable within one node generation; invalidation or removal clears stale result/fingerprint facts before a later generation can accept a new result. The binding is the complete AIDataWorkflow/EagerDataFlow authoring projection with exact contract, node, edge and diagnostic collections. Commit, filesystem decode and fresh reconstruction reject incomplete, extended-authority or identity-mismatched graphs.

The in-memory loader may carry a host-local `baseUri` while resolving frozen code. The durable facade strips it, and the checkpoint owner independently rejects absolute paths, `file:` URIs, UNC paths and drive-local URIs. Semantic fingerprint object keys use explicit UTF-16 code-unit ordering, so Unicode input permutations produce the same bytes without locale policy.

Execution CAS-commits a Pending `v0` before code materialization or node invocation. Every node then commits one Running transition before invocation and one Succeeded/Failed transition before its settlement can release dependent nodes. The Return node's accepted success transition carries the final output and is itself the terminal checkpoint; execution does not issue a second commit after terminal acceptance. The Eager scheduler restores accepted node outputs as durable ports; after fresh reconstruction it schedules only unfinished nodes and does not replay an already accepted effectful node. This preserves scheduler dependency/concurrency semantics while keeping `FlowRunCheckpointStore` as the only state owner. The historical `stateStore` runtime field is a readonly projection; writable `AIWorkflowStateStore` compatibility is not used as a graph or run owner.

If a process stops after `v0` or any node boundary is accepted, a fresh runtime continues through the runtime-first `continueMaterializedAIDataWorkflow(runtime, input, config)` Processor. `startMaterializedAIDataWorkflow` also recognizes an already-bound checkpoint instead of attempting a second `expectedVersion = null` creation. Running nodes without an accepted success fact are unfinished and may execute again; nodes whose success fact is already accepted are restored without replay. A terminal checkpoint is returned without invoking nodes again; changed input/config always fail closed, and changed initialization state or AI durable facts fail while the checkpoint is still Pending.

## Reuse policy

Machine nodes default to `semantic-hash`; manual nodes default to `never`. Author a canonical manual node through AIDataWorkflow config:

```xnl
<TransformNode #human-review {
  inputs = { evidence = "flow-port://#retrieve/evidence" }
  outputs = ["review"]
  src = "vfs://./flow-code/evidence.ts#reviewEvidence"
  config = { node_type = "manual" }
}>
```

`node_type = "manual"` is AIDataWorkflow policy metadata. EagerDataFlow's legacy `type` field remains an implementation binding. A node may override its reuse policy with config such as:

```xnl
<TransformNode #fresh-review {
  inputs = { evidence = "flow-port://#retrieve/evidence" }
  outputs = ["review"]
  src = "vfs://./flow-code/evidence.ts#reviewEvidence"
  config = { reuse_policy = "never" }
}>
```

Semantic reuse is run-local. Generation is history metadata and is not part of the reuse fingerprint.

Runtime-bearing普通 `TransformNode`/`SinkNode` code保持 `output = fn(runtime, input, config)`。首次调用使用同名bound `runAgent`；后继节点可从declared port构造exact `{byInstanceId}`，或使用static `{byInstanceName}`调用bound `runTargetedAgent`。底层Processor始终显式接收runtime；Agent instance index/receipt与RunGraph只写同一canonical checkpoint，authored surface不暴露generic `invoke`。

See [Definition、Instance 与 Run](../flow-core/instance-run.md) for the physical hierarchy, seed exact-once rule and fresh recovery path.
