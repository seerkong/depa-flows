# Proposal

## Summary

Rename the public flow product family to make the control-flow lineage explicit and to separate AI control workflow from AI data workflow.

This is a breaking canonical rename. The final public surface should converge on:

| Product family | Canonical package/path name | Canonical type/root name | Previous public name |
|---|---|---|---|
| shared control-flow grammar | `ctrl-flow` | `CtrlFlow` | already conceptual |
| instant control flow | `instant-ctrl-flow` | `InstantCtrlFlow` | `InstantFlow` / `instant-flow` |
| durable control flow | `work-ctrl-flow` | `WorkCtrlFlow` | `WorkFlow` / `work-flow` |
| business-process control flow | `bp-ctrl-flow` | `BPCtrlFlow` | `BizProcess` / `biz-process` |
| AI workflow umbrella | `ai-workflow` | `AIWorkflow` | unchanged umbrella |
| AI control workflow | `ai-ctrl-workflow` | `AICtrlWorkflow` | `AIAgentWorkflow` / `ai-agent-workflow` |
| AI data workflow | `ai-data-workflow` | `AIDataWorkflow` | unchanged |
| eager data-flow substrate | `eager-data-flow` | `EagerDataFlow` | unchanged |

## Goals

- Rename packages, imports, exported TypeScript APIs, runtime helpers, docs, examples, behavior capabilities and checker rules to the canonical naming matrix.
- Update XNL public root tags for control products and AI control workflow:
  - `<InstantFlow>` → `<InstantCtrlFlow>`
  - `<WorkFlow>` → `<WorkCtrlFlow>`
  - `<BizProcess>` → `<BPCtrlFlow>`
  - `<AIAgentWorkflow>` → `<AICtrlWorkflow>`
- Update control-flow URI schemes:
  - `instant-flow://` → `instant-ctrl-flow://`
  - `work-flow://` → `work-ctrl-flow://`
  - `biz-process://` → `bp-ctrl-flow://`
- Preserve `AIWorkflow` / `ai-workflow` only for shared AI workflow surfaces that cover both `AICtrlWorkflow` and `AIDataWorkflow`.
- Preserve `AIDataWorkflow` / `ai-data-workflow` and `EagerDataFlow` / `eager-data-flow`.
- Update pending and active Codument artifacts that guide future work, especially the Eidolon integration boundary track.

## Non-goals

- Do not introduce a new runtime engine.
- Do not change runtime semantics beyond public naming.
- Do not keep long-term public aliases for old names.
- Do not rename `AIDataWorkflow` or `EagerDataFlow`.
- Do not make `CtrlFlow` a standalone public definition root.

## Compatibility stance

This track chooses a clean break because the product surface is still under construction. Temporary internal migration shims may be used during implementation, but they must be removed before completion. Final loaders, docs and tests should treat old public roots and package names as obsolete.

Archived historical Codument can remain historical unless it affects current execution or future planning. Pending/active Codument and behavior registries should be updated to the new canonical names.

## Acceptance

- All packages build under the new package names.
- Tests import and assert new names.
- XNL examples use the new root tags and directory names.
- flow-dsl docs describe the canonical product matrix.
- Checker rules accept new roots/schemes and reject old public roots where those roots are part of current authoring surface.
- Codument behavior deltas and current active/pending planning material no longer use old names as current canonical truth.
