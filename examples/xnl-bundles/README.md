# XNL flow bundles

These examples use XNL definitions plus external TypeScript code refs. Each product root owns its ordered CtrlFlow statements directly in `[]`; facets remain inline in `()` or in their canonical files.

| bundle | product root | profile-specific statements |
|---|---|---|
| `instant-http-check/` | `InstantCtrlFlow` | none; the flow completes in one invocation |
| `order-fulfillment/` | `WorkCtrlFlow` | `ExternalJob`, `Timer` |
| `expense-approval/` | `BPCtrlFlow` | `ExternalJob`, `Timer`, `TaskStep` |
| `eager-data-flow-child/` | `EagerDataFlow` | `EntryNode`, `TransformNode`, `ReturnNode` |
| `eager-data-flow-parent/` | `EagerDataFlow` | `SubFlowNode`, `SinkNode`, `waitFor` |
| `ai-ctrl-workflow/` | `AICtrlWorkflow` | WorkCtrlFlow-backed AI runtime/effect boundary |
| `ai-data-workflow/` | `AIDataWorkflow` | EagerDataFlow-backed RunGraph boundary |

The shared public statements are `Run`, `If` with `Branches` / `Branch` / `Otherwise`, `Fallback` with `Strategy`, `Until`, and `Return`. Statement output becomes the next statement input. All `src` and `when` exports are ordinary functions following:

```text
output = fn(runtime, input, config)
```

Physical code refs use `vfs://./path#Export`. TaskStep refs use `task-space://#id`. Eager DAG refs use `flow-port://#node/port` and `flow-node://#node`. AI workflow examples use runtime-injected roots/effects and do not derive runtime state locations from authoring paths. The removed Tree, action registry, behavior-tree control nodes, expression conditions, and handler objects are not compatibility surfaces.
