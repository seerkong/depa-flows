# L2 · AICtrlWorkflow axioms

`AICtrlWorkflow` is a WorkCtrlFlow-backed AI workflow profile. It uses the same CtrlFlow statement grammar as WorkCtrlFlow and inherits durable waiting, snapshot and resume semantics.

## Substrate

- Root tag: `<AICtrlWorkflow>`.
- Root `[]`: ordered CtrlFlow statements.
- Root `()`: `FlowContract` plus optional AI workflow resource references.
- Runtime substrate: WorkCtrlFlow.

The definition is still XNL authoring. Runtime messages, material bindings, state store entries and effect results are run facts, not definition facts.

## Runtime context

The host wrapper injects:

- global AI workflow state root;
- workspace AI workflow state root;
- state store;
- embedded effect provider.

The workflow definition must not derive these roots from process cwd, environment variables or hidden authoring directories.

## Effects

AI/tool effects are invoked through the embedded provider in runtime context. A statement may call code with `vfs://./...#Export`; that code may use `runtime.ai.effects` or the shared invocation helper. The definition does not name a CLI.

## Canonical checkpoint profile

Each run has one canonical checkpoint owner. Its `AICtrlWorkflow` profile contains the WorkCtrl snapshot and closed AI durable state, while the common envelope owns input/config/state/output and controller/node sidecars. These facts advance in one versioned transition; there is no parallel AI run-record store.

Events, indexes and views are readonly projections. External runtime state is retained only through opaque identities and receipts. A fresh process resumes from the frozen instance plus checkpoint, without reading the live definition.
