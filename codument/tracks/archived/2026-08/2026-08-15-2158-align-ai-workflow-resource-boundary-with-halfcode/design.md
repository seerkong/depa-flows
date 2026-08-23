# Design: Halfcode-owned resource authority, depa-owned workflow projection

## Authority boundary

```text
XNL ResourcePackage
  -> halfcode-compiler.xnl/resource-core loadResourceTree
  -> Halfcode ResourceTree / EffectiveResourceRegistry.byKind
  -> depa-flows projectAIWorkflowAppBundles
  -> AIWorkflowAppBundleProjection + workflow-specific diagnostics
```

Halfcode owns ResourcePackage, Catalog, KindDefinition, directory enumeration, URI containment, identity uniqueness, normalized records, layering, tombstones, provenance, revision, and dependency snapshots. depa-flows receives normalized records and never opens or walks resource directories in its pure projection layer.

## Consumer port

The pure projector accepts `Pick<ResourceRegistry, "byKind">`. This is the smallest published Halfcode read port required by the workflow domain. A legacy `ResourceTree.registry` satisfies it, and the new `EffectiveResourceRegistry` satisfies it structurally. depa-flows therefore does not copy the effective-registry contract or depend on an unpublished Halfcode type.

The filesystem entry calls Halfcode `loadResourceTree` and passes `tree.registry` to the pure projector. There is no fallback scanner, catalog parser, or path normalization in depa-flows.

## Workflow app projection

`AIWorkflowAppBundle` remains a workflow-domain resource kind. Its XNL record has a `WorkflowBindings` subdomain whose ordered body contains explicit `WorkflowBinding` nodes:

```xnl
<WorkflowBinding #primary {
  kind = "AICtrlWorkflow"
  ref = "resource://depa.flows.demo.SupportAgent.Workflow"
  entrypoint = true
}>
```

The projector validates only this declared structure:

- binding id is present and unique within the app;
- kind is exactly `AICtrlWorkflow` or `AIDataWorkflow`;
- ref uses the exact `resource://` identity form;
- the referenced normalized record exists and its kind matches;
- at least one binding is an entrypoint.

It preserves authored binding order and returns immutable projection arrays. It does not inspect prompts, arbitrary string properties, filenames, or natural language.

## Compatibility adapter

The previously published generic DTO/ref names remain at the package root with deprecation annotations. They are a transition surface only:

- no new code path consumes `AIWorkflowResourceCatalog`;
- canonical docs no longer present it as the resource authority;
- `parseAIWorkflowResourceRef` remains unchanged for source/runtime compatibility but is not used by loading or projection;
- removal can occur only in a separately announced major compatibility track.

This isolates, rather than expands, the old authority while preventing a breaking patch release.

## Browser and filesystem split

- `ai-workflow-logic` and `ai-workflow-logic/browser` export the pure projector; Halfcode imports are type-only.
- `ai-workflow-logic/filesystem` imports the Node Halfcode loader and returns both the authoritative ResourceTree and derived app projections.

No browser bundle imports `node:fs` through the new path.

## Package/version strategy

The contract and logic packages advance from `0.1.0` to `0.1.1`. They depend exactly on published Halfcode `0.2.1`, whose resource-core export already contains ResourceTree, ResourceRecord, ResourceRegistry, and `loadResourceTree`. The projector's structural registry port remains compatible with the newer additive Halfcode composition seam without claiming its type authority.

## Validation

- RED/GREEN tests load a real ResourcePackage fixture through Halfcode and project two workflow records.
- Pure tests inject normalized records and exercise missing, duplicate, wrong-kind, invalid-ref, and missing-entrypoint diagnostics.
- Browser import smoke proves the projector remains available without importing the filesystem adapter.
- Full Bun tests, TypeScript, Flow DSL check, dependency/static scans, and package dry-run form the executor gate.

## Risks

- The deprecated generic ref parser still exists for compatibility. Mitigation: it is explicitly non-canonical, unused by new paths, and covered by an architecture test that prevents new production imports.
- A future Halfcode major may change ResourceRegistry. Mitigation: depend on its public type and package version rather than an internal source path.
- Domain relation names could become a second catalog. Mitigation: the projector accepts only `WorkflowBindings` and only workflow kinds; it has no arbitrary kind/source/path fields.
