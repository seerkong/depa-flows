# Track: depa-flows AI resource Kinds on Halfcode 0.3

## Problem

depa-flows currently projects a mature AI Agent/Workflow/Material grammar from Halfcode 0.2 trees, but its fixture-local `KindDefinition` files still use the legacy `halfcode.resources/v1` envelope and no package exports the exact 0.3 owner, schema, semantic-contract or reader registrations. Eidolon therefore cannot migrate its shared resource registry to Halfcode 0.3 without either fabricating depa-owned fingerprints, accepting unverified resources, or creating a second grammar authority.

## Change

- Establish one public depa-flows catalog for all fourteen AI resource Kinds currently present in the canonical resource fixtures.
- Give each Kind one exact owner, v1 schema, semantic contract, `SpecRevision` and exact reader registration.
- Generate or verify authored `KindDefinition` sources from that catalog and migrate canonical sources to the 0.3 envelope.
- Move filesystem loading, projection and run-freeze onto the explicit Halfcode 0.3 authored → resolved boundary without changing workflow semantics.
- Upgrade the required AI Workflow/Ctrl/Data public package closure and prepare local release-candidate tarballs for Eidolon.
- Migrate the public `ai-workflow-flow-dsl-reference` module that Eidolon's system-skill assembly actually loads; this shared module remains depa-owned and must not be patched or re-authored inside Eidolon.
- Admit Halfcode 0.3 resource-envelope roots directly in the depa Ctrl/Data source loaders, mapping `specVersion=1` to the existing `depa.flows/v1` semantic profile without reconstructing legacy metadata in Eidolon.

## Non-goals

- Moving generic envelope, XNL parsing, catalog discovery, JSON-schema validation or spec-resolution authority out of Halfcode.
- Moving Eidolon runtime admission, provider context, actor/session history or Holon execution binding into depa-flows.
- Reworking AI Ctrl/Data scheduling, autonomous graph revision, task lifecycle or Holon assignment semantics.
- Publishing any npm package. A later explicitly authorized release must use `/Users/kongweixian/.npmrc_official`.

## Verification

Tests must load real 0.3 resource packages, resolve them with the exported depa reader profile, exercise app/Agent/Material projection and run-freeze, reject forged and legacy contracts, preserve browser-safe imports, migrate the shared Flow DSL reference module, admit Ctrl/Data resource-envelope profile roots, and repeat the critical paths from isolated packed artifacts in a fresh Bun process.
