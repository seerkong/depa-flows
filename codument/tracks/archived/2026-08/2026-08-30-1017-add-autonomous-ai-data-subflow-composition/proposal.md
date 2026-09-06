# Track: Autonomous AI Data subflow composition

## Problem

AI Data Workflow already uses the canonical EagerDataFlow RunGraph and the underlying runtime already understands `SubFlowNode`. The autonomous controller, however, freezes a catalog that admits only `TransformNode` and `SinkNode`; its patch shape also drops the child Flow identity. As a result, an AI Data controller cannot decompose a goal into a nested data graph without inventing another planning graph or asking host code to smuggle child identity through untyped config.

The missing behavior is not a new `GoalGraph`. It is a typed, durable way for the existing controller to propose a `SubFlowNode`, reserve one child invocation, and later observe the child terminal receipt through the same parent RunGraph/checkpoint authority.

## Change

- Add a closed autonomous subflow capability/proposal shape instead of widening ordinary code/agent capability tags.
- Preserve the exact child Flow resource/contract identity in graph patches, RunGraph records and codecs.
- Add explicit runtime ports for resolve/freeze/start-or-continue/load/settle of child invocations.
- Reserve a deterministic child invocation identity in the parent checkpoint before dispatch, then recover the same child after crashes.
- Validate child outputs against the frozen FlowContract before accepting parent node output.
- Keep graph mutation, generation, invalidation and parent completion under the existing AI Data RunGraph checkpoint CAS owner.

## Non-goals

- No `GoalGraph`, controller-owned graph copy or second scheduler.
- No dynamic Capability Catalog expansion; the current catalog remains a frozen projection.
- No AI-specific child runtime in the generic EagerDataFlow kernel.
- No host filesystem path, executable object or child internal graph in parent facts.
- No dynamic `AIAgentDefinition` authoring; that is a later Mission Track.

## Verification

Use admission/type tests, nested A→B→C execution, recursion rejection, parent/child checkpoint crash injection, concurrent resume, fresh-process recovery and filesystem materialization tests. Every crash point must converge on one child invocation and accepted child effects must not replay.
