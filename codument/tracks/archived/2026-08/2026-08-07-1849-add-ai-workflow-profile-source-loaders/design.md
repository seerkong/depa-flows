# Design

## Authority boundary

XNL parsing, product-root recognition, substrate grammar validation and lowering remain owned by depa-flows. Host integrations consume typed loader results and do not rewrite root tags or maintain private validators.

## Loader layering

```text
AI profile XNL sources
  -> substrate profile-root loader primitive
       -> existing substrate parser and validation rules
       -> lowered WorkCtrlFlow / EagerDataFlow definition
  -> AI workflow facade
       -> AICtrlWorkflowDefinitionBinding / AIDataWorkflowDefinitionBinding
       -> structured diagnostics
```

The ctrl primitive accepts a declared profile root and a target ctrl substrate form. It applies the target profile's allowed facets and statements while producing a substrate `FlowBundleSpec`. The eager-data primitive accepts a declared profile root and reuses all EagerDataFlow node, edge and contract validation.

Existing `loadFlowBundleFromSources` and `loadEagerDataFlowSources` retain their current root rules. Profile aliases are opt-in through new APIs; obsolete public names do not become compatibility aliases.

## Public AI facades

- `ai-ctrl-workflow-logic`: `loadAICtrlWorkflowSources(...)`
- `ai-data-workflow-logic`: `loadAIDataWorkflowSources(...)`

Successful results carry the definition binding produced by the existing `defineWorkCtrlFlowBackedAICtrlWorkflow` or `defineEagerBackedAIDataWorkflow` helpers. Failed results do not fabricate an executable binding.

## Diagnostics

Diagnostics are structured and deterministic. They cover at least:

- missing or wrong AI profile root;
- XNL parse errors;
- statements/nodes rejected by the selected substrate profile;
- invalid contract, refs, ports or DAG edges.

## Compatibility

No current substrate root is widened implicitly. The new APIs are additive and browser-safe source loaders; filesystem policy remains a host responsibility.

## Validation

- Characterization tests keep existing substrate loaders unchanged.
- Unit tests load the canonical `ai-ctrl-workflow` and `ai-data-workflow` examples.
- Negative tests assert stable diagnostics and no binding for invalid sources.
- Workspace typecheck and affected package tests must pass.
