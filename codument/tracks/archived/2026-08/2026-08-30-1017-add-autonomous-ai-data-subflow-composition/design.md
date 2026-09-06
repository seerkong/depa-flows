# Design: Autonomous AI Data subflow composition

## Existing authority and exact gap

`eager-data-flow-contract` already defines `SubFlowNodePlan.flow`; the source loader resolves the registered child, derives output ports from its `FlowContract`, and rejects recursive unit call graphs. `eager-data-flow-logic/runtime.ts` invokes an injected child executable with isolated invocation state.

`ai-data-workflow-logic/src/index.ts` already recognizes `SubFlowNode` while deriving node type, but the autonomous control boundary in `src/autonomous-control.ts` admits only code/agent capabilities tagged as `TransformNode | SinkNode`. The current patch node and durable RunNode carry tag/config but no first-class `flow` field. The filesystem driver supplies `resolveCode` but no child Flow registry. Consequently a naive tag expansion would create a syntactically accepted node whose executable identity is absent or hidden in config.

## Closed subflow proposal

The frozen catalog gains a distinct subflow entry rather than pretending a child Flow is a code or Agent implementation. It projects an exact child definition identity and contract digest already admitted by the host. A controller revision operation can add or rewire a subflow only through this catalog entry. Admission checks:

- observation generation and catalog digest are current;
- child reference and contract digest equal the frozen entry;
- every input/output port matches the child contract;
- protected-node and operation-budget rules still hold;
- the resulting parent/child call graph is acyclic.

Admission lowers the proposal to the existing `AIDataWorkflowGraphPatch`; the RunGraph owner remains its only committer. Dynamic catalog creation remains outside this Track.

## Durable parent-child binding

Patch node specs and RunNode records gain an explicit closed subflow binding. It contains logical child definition/instance identity, frozen contract digest and a deterministic invocation key. It never contains a host path, executable closure or child graph.

Before starting a child, the parent checkpoint CAS-reserves an invocation identity derived from parent run, node, generation and capability identity. The runtime then calls a narrow injected port:

```text
reserve parent binding
  -> resolve/freeze child definition
  -> start-or-continue deterministic child invocation
  -> load immutable terminal receipt
  -> validate FlowContract output
  -> accept parent node result
```

The child definition/instance/run/checkpoint owner writes all child lifecycle facts. The parent stores only the binding, projected status, terminal/failure summary and immutable completion receipt. A parent revision never rewrites an earlier child history; a rerun creates a successor invocation bound to the new generation.

## Crash and concurrency semantics

- Crash after reservation: fresh resume starts the reserved child.
- Crash after child creation/effect/terminal: start-or-continue returns the same child and loads its existing facts.
- Crash before parent acceptance: the same terminal receipt is validated and committed once.
- Concurrent resumes race on the parent reservation CAS; losers reload and use the winner's binding.
- A receipt for another child identity, contract digest or parent generation is rejected before output mutation.

## Filesystem composition

The filesystem driver materializes a child executable registry from the same admitted resource closure and injects it into the existing EagerDataFlow runtime. Recovery reconstructs both the parent binding and child invocation from durable records; it does not rely on process-local maps.

## Compatibility

Existing Transform/Sink code and Agent capability shapes remain unchanged. Existing static SubFlow definitions continue to load and execute. New fields are required only for autonomous subflow operations and are covered by strict codecs so legacy checkpoints cannot silently fabricate them.
