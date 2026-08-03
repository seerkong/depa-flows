# Design

## Package shape

This track establishes two foundation packages:

- `ai-workflow-contract`：shared public contracts for AI workflow profiles.
- `ai-workflow-logic`：small substrate adapters and pure helper functions that depend on existing flow contracts.

The package boundary is intentionally small. Later tracks may split profile-specific packages if implementation volume demands it, but the first foundation should keep the shared vocabulary in one place so AI Ctrl Workflow and AI Data Workflow do not drift.

## Dependency direction

- Contract package may depend on existing contract packages only.
- Logic package may depend on foundation contract plus existing logic/contract packages.
- Core helpers must not import host-specific wrapper implementations.
- Runtime path roots and effect providers are inputs supplied by the caller.

## Core vocabulary

- `AIWorkflowKind`：`AICtrlWorkflow` or `AIDataWorkflow`.
- `AIWorkflowDefinitionRef`：logical resource reference for a workflow definition.
- `AIWorkflowRunRef`：stable run id and generation identity.
- `AIWorkflowRuntimeRoots`：wrapper-provided global and workspace state roots.
- `AIWorkflowEffectProvider`：embedded provider interface invoked through runtime.
- `AIWorkflowStateStore`：load/save/append interface for run state and event facts.

## Substrate bindings

Foundation types must make the substrate explicit:

- AI Ctrl Workflow profile declares WorkCtrlFlow as its substrate.
- AI Data Workflow profile declares EagerDataFlow as its substrate.

This is not just documentation; the exported descriptors should encode the substrate so downstream logic cannot silently switch to another flow engine.

## Path hygiene

Tracked artifacts may contain logical refs such as `vfs://`, `resource://`, package names, and `.eidolon` as a product-level runtime root name. They must not contain host absolute paths or references to external source projects.

External evidence stays in ignored `analysis/` or `reports/`.

## Validation

- TypeScript typecheck should pass after package additions.
- A lightweight test should assert foundation descriptors and default reuse policy vocabulary.
- A path hygiene search should confirm no forbidden host path references in tracked files touched by this track.
