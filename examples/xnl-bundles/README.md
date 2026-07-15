# XNL flow bundles

These examples use XNL definitions plus external TypeScript code refs. Each product root owns its ordered CtrlFlow statements directly in `[]`; facets remain inline in `()` or in their canonical files.

| bundle | product root | profile-specific statements |
|---|---|---|
| `instant-http-check/` | `InstantFlow` | none; the flow completes in one invocation |
| `order-fulfillment/` | `WorkFlow` | `ExternalJob`, `Timer` |
| `expense-approval/` | `BizProcess` | `ExternalJob`, `Timer`, `TaskStep` |

The shared public statements are `Run`, `If` with `Branches` / `Branch` / `Otherwise`, `Fallback` with `Strategy`, `Until`, and `Return`. Statement output becomes the next statement input. All `src` and `when` exports are ordinary functions following:

```text
output = fn(runtime, input, config)
```

Physical code refs use `vfs://./path#Export`. TaskStep refs use `task-space://#id`. The removed Tree, action registry, behavior-tree control nodes, expression conditions, and handler objects are not compatibility surfaces.
