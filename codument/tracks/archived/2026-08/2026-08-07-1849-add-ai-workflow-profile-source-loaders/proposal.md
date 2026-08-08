# Proposal: add AI workflow profile source loaders

## Why

`AICtrlWorkflow` and `AIDataWorkflow` are public XNL product roots with canonical examples, contracts and runtime helpers. The current substrate loaders only accept `WorkCtrlFlow` and `EagerDataFlow` roots, so consumers cannot load the public AI workflow examples through an authority-owned API.

Leaving this gap to host integrations would force every host to rewrite or independently parse AI profile roots, creating parallel semantics and inconsistent diagnostics.

## Goal

Provide canonical source-loader APIs for both AI workflow profiles. Each loader SHALL reuse its substrate grammar and validation, lower to the corresponding substrate definition, then return the typed AI workflow definition binding plus structured diagnostics.

## Non-goals

- Implementing Eidolon resource, filesystem, actor or persistence adapters.
- Adding a second XNL parser.
- Changing WorkCtrlFlow or EagerDataFlow runtime semantics.
- Publishing packages as part of the track lifecycle.

## Changes

- Add reusable profile-root loading primitives to the ctrl and eager-data substrate logic packages.
- Add `loadAICtrlWorkflowSources` and `loadAIDataWorkflowSources` public facades to the AI workflow logic packages.
- Preserve canonical profile identity at the facade while lowering definitions to `WorkCtrlFlow` and `EagerDataFlow` substrates.
- Add stable diagnostics for missing/wrong profile roots and invalid profile bodies.
- Prove the existing canonical example manifests load without diagnostics.

## Impact

AI workflow hosts can consume one canonical parse/lower/diagnose path. Existing substrate loader APIs and runtime behavior remain compatible.
