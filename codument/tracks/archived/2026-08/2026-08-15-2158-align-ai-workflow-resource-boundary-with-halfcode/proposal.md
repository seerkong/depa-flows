# Proposal: align AI workflow resource boundary with Halfcode

## Why

`ai-workflow-contract` currently publishes a second generic resource vocabulary (`AIWorkflowResourceCatalog`, a broad resource-kind list, and generic URI-containment helpers). The implementation is shallow, but its public names still imply that depa-flows owns package discovery and reference safety. Halfcode now owns ResourcePackage, Catalog, KindDefinition, normalized ResourceTree/ResourceRecord, layered composition, provenance, and dependency snapshots.

Keeping both authorities would force Eidolon and other hosts to choose between two catalogs and two containment policies. The boundary must be corrected before adding AIAgentDefinition, Material, and run-freeze semantics.

## What changes

- Add an explicit dependency on the published `halfcode-compiler.xnl/resource-core` surface.
- Project workflow-domain `AIWorkflowAppBundle` facts from Halfcode `ResourceRecord` collections; the input port is the public `ResourceRegistry.byKind` shape and therefore accepts both a loaded ResourceTree and a Halfcode effective registry without reimplementing composition.
- Add a filesystem-only loader adapter that delegates package loading and containment validation to Halfcode, while keeping the pure projector browser-safe.
- Define explicit `WorkflowBinding` children as the workflow-domain membership/entrypoint relation. They are not a generic catalog.
- Retain the published legacy catalog/ref DTO and helper signatures as deprecated compatibility adapters, but remove them from canonical docs and from the new projection path.
- Replace the previous generic catalog/resource-tree documentation with the Halfcode-owned ResourcePackage -> workflow projection boundary.

## Goals

- Halfcode is the only package/catalog/scanner/loader/containment/composition authority.
- depa-flows owns only AI workflow kinds, typed workflow membership, app-bundle projection, and workflow-specific diagnostics.
- Existing root and browser imports remain source-compatible.
- Deterministic code validates structured fields only; it never scans arbitrary text or infers business intent.

## Non-goals

- Defining AIAgentDefinition, ordered messages, MaterialPort/Binding, or run-freeze closure; those belong to the next mission track.
- Adding host roots, Eidolon filesystem policy, installers, actor/provider/session runtime, or global/workspace overlays.
- Re-exporting or copying Halfcode's ResourcePackage/Catalog schema.
- Implementing a fallback resource scanner or parsing catalog paths in depa-flows.

## Compatibility and impact

The existing `AIWorkflowResourceRef`, catalog DTOs, and ref helper functions remain available and are marked deprecated. Canonical consumers move to Halfcode `ResourceTree`/`ResourceRecord` plus `projectAIWorkflowAppBundles`. The Node filesystem entry is additive; the browser entry continues to expose only pure logic and type-only Halfcode dependencies.
