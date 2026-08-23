# Proposal: AI Agent, Material, and run-freeze resources

## Problem

depa-flows can project an `AIWorkflowAppBundle` from Halfcode records, but it does not yet define the resource-domain contract needed to replace the reusable Agent and Material inventory that previously lived in application-specific code. A workflow run also has no immutable receipt that proves which Agent definition, messages, tools, policies, material bindings, and source bytes were selected.

Putting these rules in Eidolon would couple resource meaning to one host. Rebuilding catalogs, layer composition, content hashing, or dependency closure in depa-flows would create a competing authority. Keeping only configuration-like workflow DTOs would fail to represent the wider Resource-native App model.

## Desired outcome

- `AIAgentDefinition`, `MaterialPort`, and `MaterialBinding` have fixed XNL shapes and exact typed references.
- A pure, browser-safe projector turns normalized Halfcode records into immutable domain projections and typed dependency edges.
- A Node-only entry freezes one explicit workflow Agent task by calling Halfcode 0.2.2 dependency snapshot APIs with loader-owned content identities.
- A run receipt separates Halfcode proof/recovery identity from a workflow-domain semantic fingerprint suitable for selected-resource reuse.
- depa-flows does not own filesystem roots, package discovery, layer precedence, content hashing, actor/session/provider state, or execution policy.

## Scope

### In scope

- additive `ai-workflow-contract` types;
- pure projection and stable domain diagnostics;
- Node-only `ai-workflow-logic/run-freeze` entry;
- exact dependency on `halfcode-compiler.xnl@0.2.2`;
- real ResourcePackage fixtures and boundary/compatibility tests;
- Flow DSL, behavior, and modeling updates.

### Out of scope

- an Agent node in the WorkCtrlFlow substrate grammar;
- actor/provider/session implementation;
- global/workspace root selection and layer naming policy;
- resource installation or discovery;
- execution of tools, effects, prompts, or materials;
- removal of the deprecated 0.1.x DTO/ref compatibility surface.

## Compatibility

The change is additive within the package 0.1 line. Existing app projection, browser, filesystem, workflow definition, and legacy compatibility exports remain available. The Node-only freeze API is a separate subpath so the root/browser entries stay free of Node runtime dependencies.

## Success criteria

The implementation passes real Halfcode load, composition, content-identity, and dependency-snapshot flows; preserves authored message and port order; rejects invalid explicit relations with stable diagnostics; produces immutable deterministic receipts; and contains no parallel resource loader, arbitrary-string reference scan, or text-based semantic routing.
