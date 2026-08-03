# Design

## Docs

Add profile-specific docs under `docs/flow-dsl/spec/ai-workflow/` and L2 axioms under `docs/flow-dsl/std/`.

## Examples

Add one `AICtrlWorkflow` bundle and one `AIDataWorkflow` bundle under `examples/xnl-bundles/`. Each example stays XNL-only for authoring and uses `vfs://./...#Export` code refs for executable stubs.

## Checker

Extend the existing flow-dsl-check loader/rules to recognize:

- `AICtrlWorkflow` as a WorkCtrlFlow-backed CtrlFlow profile.
- `AIDataWorkflow` as an EagerDataFlow-backed DAG profile.
- Existing `EagerDataFlow` examples as first-class checkable bundles.

## Compatibility

Existing bundle checks must remain green. The checker extension should add accepted roots and DAG-node validation without relaxing removed syntax diagnostics.
