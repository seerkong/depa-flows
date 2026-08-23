# Design: versioned Flow DSL reference module

## Authority boundary

`docs/flow-dsl` is the sole content authority. The generated tree is a build projection and is never edited by hand. Halfcode 0.2.3 remains the sole ResourcePackage and Skill composition authority. The public depa loader only locates a package-contained module and returns its descriptor.

| Concern | Owner |
| --- | --- |
| Flow DSL content, profiles and authoring semantics | depa-flows `docs/flow-dsl` |
| ResourcePackage loading and normalized records | Halfcode |
| ResourceMappings, Skill planning and file distribution | Halfcode |
| Host Skill identity, installation and operations | Eidolon |

## Generated module layout

The build creates `packages/ai-workflow-flow-dsl-reference/dist/resource-module/`:

```text
manifest.xnl
KindDefinitions/WikiPage/manifest.xnl
WikiPages/<stable-full-path-id>/manifest.xnl
content/<canonical docs/flow-dsl tree>
content/.depa-flow-dsl-provenance.json
```

Only canonical Markdown files are inputs. Paths are normalized as safe POSIX-relative paths and sorted with a fixed UTF-16 code-unit comparator. Every copied file must remain byte-identical. Stable resource identities use the full relative path, so repeated leaf names such as `axioms.md` cannot collide.

The WikiPage KindDefinition is mechanically copied and byte-checked from the package-contained Halfcode 0.2.3 Resource DSL module; depa-flows does not rewrite that generic contract. Each WikiPage uses an explicit `vfs://@/content/<relative-path>` material reference. The generated provenance manifest records schema version, module/package version, source root identity, ordered relative path and `sha256:` content digest for every copied document. It is also copied downstream with the reference tree.

## Public seam

`ai-workflow-flow-dsl-reference` exports one loader and one frozen module identity:

```ts
loadAIWorkflowFlowDslReferenceModule(): AuthoringModuleDescriptor
```

The descriptor has fixed module id `DepaFlowsFlowDslReference`, package name, family and `scope: "shared"`; `resourceRootDir` is resolved relative to the installed package. Each call returns a fresh deeply frozen descriptor. The package does not accept or return runtime registries and does not expose apply, install or host path APIs.

## Downstream composition

This track does not define an Eidolon Skill. A downstream authoring Skill includes the module in its Halfcode assembly and uses fixed ResourceMappings with `vfs://module/DepaFlowsFlowDslReference/` to copy chosen module paths from `content/` into `references/flow-dsl/`. It does not declare a sibling Skill dependency, so the compiled installation still contains only the intended four system Skills. This keeps selection policy in the Skill owner while the depa module supplies the complete canonical versioned source.

The fixture proves folder preservation and byte identity. It must not discover references by scanning prompt text or infer relevance from names.

## Release and publication

- `ai-workflow-flow-dsl-reference`: initial terminal-smallest `0.1.0`.
- `halfcode-compiler.xnl`: its only exact runtime dependency at `0.2.3`.
- `ai-workflow-contract` and `ai-workflow-logic`: unchanged at `0.1.2`.
- The package publishes compiled `dist` only.
- The manifest may retain `publishConfig.access = public` but must not contain `publishConfig.registry`.
- Publication commands must not provide a registry argument; the user's active npm configuration is the only registry selection authority.

Before publication, a local tarball consumer must import the package and load the module using only packed content. After publication, a registry-only consumer repeats the same checks and the recorded version, shasum, integrity, file count and dependencies must match the reviewed candidate.

## Failure model

Generation fails before replacing output if a source path is unsafe, a file cannot be decoded where textual generation is required, resource identities collide, source bytes change during the build, or the generated ResourcePackage is invalid. Package checks fail if runtime packages change or host policy enters the module. Publication stops if candidate metadata or user npm authentication is inconsistent.
