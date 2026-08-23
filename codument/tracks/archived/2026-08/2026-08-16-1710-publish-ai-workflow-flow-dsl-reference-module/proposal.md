# Proposal: publish AI Workflow Flow DSL reference module

## Outcome

Publish the canonical `docs/flow-dsl` knowledge tree as a deterministic, package-contained Halfcode authoring module in the dedicated `ai-workflow-flow-dsl-reference@0.1.0` package. Downstream system Skills can then copy explicitly selected reference subtrees while preserving the canonical folder structure, source version and content digests.

## Why this belongs in depa-flows

The Flow DSL specification, its profiles, examples and authoring semantics are owned by depa-flows. Halfcode owns generic ResourcePackage loading, resource mapping, Skill planning and distribution. Eidolon owns host installation, operations and system Skill delegation. The reference contents must therefore be published by depa-flows and consumed by Eidolon through Halfcode rather than copied and maintained inside Eidolon.

## Scope

- Generate a package-contained ResourcePackage module from canonical Markdown under `docs/flow-dsl`.
- Preserve source bytes and relative directory structure.
- Generate stable WikiPage resource identities and a content-digest provenance manifest.
- Expose a minimal package root returning an immutable authoring module descriptor.
- Prove explicit downstream ResourceMappings can select module content into `references/flow-dsl`.
- Publish only `ai-workflow-flow-dsl-reference@0.1.0`, using exact `halfcode-compiler.xnl@0.2.3`.

## Non-goals

- No fifth installed Eidolon system Skill or sibling Skill dependency.
- No Eidolon host paths, global/workspace policy, operations or installer behavior.
- No second ResourcePackage loader, Skill compiler or dependency-closure implementation.
- No natural-language, substring or regular-expression routing.
- No source checkout or `file:`/`workspace:` dependency in the published package.
- No registry override in package metadata or npm commands.

## Compatibility

`ai-workflow-contract@0.1.2` and `ai-workflow-logic@0.1.2` remain unchanged. Existing runtime consumers continue resolving Halfcode 0.2.2. The new package is isolated from runtime registries and depends only on exact Halfcode 0.2.3 authoring APIs.
