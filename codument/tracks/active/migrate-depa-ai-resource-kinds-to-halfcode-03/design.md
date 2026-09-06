# Design: exact AI resource authority over Halfcode 0.3

## Authority map

Halfcode owns the resource envelope, XNL decoding, package/catalog containment, JSON-schema validation, versioned owner/revision/reader registries, authored/resolved tree stages and dependency-snapshot proof. depa-flows owns only the closed AI resource grammar and semantics. Eidolon consumes the resolved records and remains responsible for runtime admission and actor execution.

The depa catalog covers the resource closure already exercised by `packages/ai-workflow-logic/test/fixtures`:

- orchestration: `AIWorkflowAppBundle`, `AICtrlWorkflow`, `AIDataWorkflow`;
- agent: `AIAgentDefinition`, `AgentMessageSource`, `AgentContextPipeline`, `Prompt`, `Tool`;
- schema/policy/binding: `MessageSchema`, `EffectPolicy`, `MaterialPort`, `MaterialBinding`;
- value material used by the reference closure: `RequestMaterial`, `ContextMaterial`.

Every Kind maps to a stable depa-owned subject identity in one exported catalog, one owner package identity, one source contract and one v1 revision. Fingerprints are computed by Halfcode APIs from frozen canonical facts. The package exports registrations and rendered `KindDefinition` source; checked-in fixture sources are verification material, not an independent authority.

## Reader and semantic boundary

The v1 schema admits the authored `PortableSpec` shape required by each Kind. Exact readers return a detached validated spec representation suitable for the existing registry-wide projectors. Reader implementation fingerprints name the canonical projection/normalization operation; they are not handwritten placeholder hashes.

Cross-resource semantics stay in the existing projectors:

- `projectAIWorkflowAppBundles` owns app/workflow binding checks;
- `projectAIWorkflowAgentResources` owns Agent message-prefix/context-pipeline, schema/policy, Tool, MaterialPort/Binding relations and dependency edges;
- Ctrl/Data profile loaders own their substrate-specific graph parsing;
- run-freeze owns selected closure validation, Halfcode dependency snapshot delegation and domain semantic fingerprints.

The Halfcode reader resolves one resource revision. It must not duplicate registry-wide reference checks that require other records. Conversely, registry projectors must receive a resolved tree and must not reinterpret envelope or KindDefinition fingerprints.

## Authored → resolved migration

Halfcode 0.3 separates `AuthoredResourceTree` from `ResolvedResourceTree`. The Node filesystem adapter loads authored bytes, then resolves them with:

1. Halfcode core ResourcePackage/KindDefinition registrations;
2. the depa AI Kind owner/revision/reader catalog;
3. one explicit reader profile selecting the exact v1 reader for each subject;
4. an empty migration registry for this initial exact-only release;
5. Halfcode's JSON-schema validator.

Projection and run-freeze accept the resolved registry. Compatibility helpers may preserve existing function names, but they may not accept a legacy tree or silently synthesize contract facts. The browser entry receives only structural types and pure projections; Node loading and snapshot implementations remain behind `./filesystem` and `./run-freeze`.

## Package and release closure

The owner catalog belongs to `ai-workflow-contract`; reader-profile assembly and filesystem resolution belong to `ai-workflow-logic`. Ctrl/Data packages consume those shared contracts and must not create profile-local owners. Public versions are advanced as one exact dependency closure, with `halfcode-compiler.xnl@0.3.0` and `holarchy-core-contract@0.2.0` where used.

Eidolon's system-skill generator also consumes `ai-workflow-flow-dsl-reference` as a separate shared authoring module. That module remains owned and generated here: its ResourcePackage and WikiPage documents use the 0.3 envelope, its WikiPage KindDefinition is copied from the Halfcode-owned Resource DSL module, and its public package advances to an exact Halfcode 0.3 dependency. Eidolon may consume the resulting tarball but may not duplicate or rewrite this source module.

Release evidence consists of local tarballs, SHA/integrity facts, install order, package metadata checks and an isolated Bun consumer that loads and resolves real XNL. Registry authentication/version preflight may read `/Users/kongweixian/.npmrc_official`; this Track does not publish.

## Workflow profile source boundary

The Ctrl and Data source loaders remain the depa owner of workflow-profile semantics. They accept two explicit authored roots: the existing standalone Flow DSL form with `apiVersion=depa.flows/v1` plus `version`, and the Halfcode resource form with `envelopeVersion=halfcode.resource-envelope/v1` plus numeric `specVersion=1`. The latter deterministically projects the same `depa.flows/v1` semantic API and version `1`; Eidolon must not rewrite resource bytes to fabricate legacy metadata. Unknown envelopes, absent spec revisions and mixed incomplete metadata continue to fail closed.

## Existing-work protection

The repository already contains uncommitted autonomous subflow, Agent-definition selection and Holon task-target changes. This Track may edit overlapping manifests and resource paths only after preserving those semantics. It must not reset, reformat wholesale or replace those changes. Tests for those capabilities are part of the regression surface because the 0.3 contract closure is their shared input boundary.
