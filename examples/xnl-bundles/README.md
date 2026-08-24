# XNL flow bundles

These examples use XNL definitions plus external TypeScript code refs. A product root either owns topology directly in `[]` or declares one exact `StepSpaceRef`; the two forms are mutually exclusive. Facets remain inline in `()` or in their canonical files.

| bundle | product root | profile-specific statements |
|---|---|---|
| `instant-http-check/` | `InstantCtrlFlow` | none; the flow completes in one invocation |
| `order-fulfillment/` | `WorkCtrlFlow` | `ExternalJob`, `Timer` |
| `expense-approval/` | `BPCtrlFlow` | `ExternalJob`, `Timer`, `TaskStep` |
| `eager-data-flow-child/` | `EagerDataFlow` | `EntryNode`, `TransformNode`, `ReturnNode` |
| `eager-data-flow-parent/` | `EagerDataFlow` | `SubFlowNode`, `SinkNode`, `waitFor` |
| `ai-ctrl-workflow/` | `AICtrlWorkflow` | WorkCtrlFlow-backed AI runtime/effect boundary |
| `ai-data-workflow/` | `AIDataWorkflow` | EagerDataFlow-backed RunGraph boundary |
| `ai-ctrl-holon-task/` | `AICtrlWorkflow` | frozen Holon target → TaskSpace create/wait/settlement |
| `ai-data-holon-task/` | `AIDataWorkflow` | TaskSpace settlement → validated MaterialPort value |

`order-fulfillment/`, `ai-data-workflow/`, `ai-ctrl-holon-task/` and
`ai-data-holon-task/` are modular fixtures. Their
`step-space.xnl` files enumerate every Step explicitly; nested `steps/` directories are
only storage locations and are never scanned to invent membership. Step Core facts map
back to the same WorkCtrl/EagerDataFlow bindings used by inline definitions.

持久产品遵守 [Definition、Instance 与 Run](../../docs/flow-dsl/spec/flow-core/instance-run.md) 的三层 hierarchy。这里列出的七个目录始终是 source Definition bundles；runtime 将完整 bundle 录取到注入的 support root，并把每个 run 的唯一可变事实写入 instance 同级 `runs/<run-id>/checkpoint.json`。不要把生成的 `instance.json`、`checkpoint.json`、events、index 或 status view 放回这些目录。

五个带物理生命周期说明的示例是 [order-fulfillment](order-fulfillment/README.md)、[ai-ctrl-workflow](ai-ctrl-workflow/README.md)、[ai-data-workflow](ai-data-workflow/README.md)、[ai-ctrl-holon-task](ai-ctrl-holon-task/README.md) 与 [ai-data-holon-task](ai-data-holon-task/README.md)。所有目录仍由同一个 bundle checker 作为 canonical source fixtures 逐一验证。

The shared public statements are `Run`, `If` with `Branches` / `Branch` / `Otherwise`, `Fallback` with `Strategy`, `Until`, and `Return`. Statement output becomes the next statement input. All `src` and `when` exports are ordinary functions following:

```text
output = fn(runtime, input, config)
```

Physical code refs use `vfs://./path#Export`. TaskStep refs use `task-space://#id`. Eager DAG refs use `flow-port://#node/port` and `flow-node://#node`. AI workflow examples use runtime-injected roots/effects and do not derive runtime state locations from authoring paths. Runtime-bearing code keeps `runtime` as the first Processor parameter. `runAgent` and `runTargetedAgent` are runtime-first Processors; their same-named bound facade preserves that authority while hiding only the already-bound runtime. The bundles do not define a runtime-less shortcut. The removed Tree, action registry, behavior-tree control nodes, expression conditions, and handler objects are not compatibility surfaces.
