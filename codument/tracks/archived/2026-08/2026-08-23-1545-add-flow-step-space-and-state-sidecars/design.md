# Design: add-flow-step-space-and-state-sidecars

## 1. Evidence and constraints

- The Python `multistep-core-python-demo/process-def.xml` models process ports, step ports, one `Core` and explicit `Extension`; seed files are separate values, not live run state.
- `examples/xnl-bundles/order-fulfillment` keeps topology, config schema/data, state schema/seed and runtime-first code as separate Definition facets. Instance materialization already copies all bytes before a run.
- `task-manager-contract` defines a recursive TaskSpace while `bp-ctrl-flow-logic` keeps TaskSpace as an independent owner and binds it through exact task refs. Codument likewise separates recursive TaskSpace structure, Schedule and Hooks.
- The current `FilesystemFlowRunCheckpointStore` validates one complete logical checkpoint and atomically renames `checkpoint.json`; this authority and all deep Ctrl/Data/Agent transition invariants must remain.

No source from the excluded TypeScript translation project is part of this design.

## 2. DEPA DataTopology

| node | semantic role | authority model | owner | relation |
| --- | --- | --- | --- | --- |
| frozen StepSpace files | immutable definition facts | versioned repository | Definition/Instance materializer | assemble profile binding |
| `checkpoint.json` head | current run authority | durable CAS authority | FlowRunCheckpointStore | selects one RunStepStateIndex root |
| immutable step/core/extension records | historical/recovery material | content-addressed record | Step sidecar codec | referenced by accepted root |
| reconstructed `FlowRunCheckpoint` | owner read projection | derived observation | checkpoint loader | validates and projects head + records |
| indexes/inspection output | rebuildable observation | derived projection | inspection adapter | observes accepted head |

Only the checkpoint head decides which records are current. Writing a candidate record is not a transition. Admission is `commitFlowRunCheckpoint(runtime, input, config)`: validate the complete before/after logical values, write missing immutable records, verify bytes/digests, then CAS-replace the head. Recovery ignores records not reachable from the accepted head.

## 3. Definition StepSpace

The profile root may use either inline statements or one exact `StepSpaceRef`, never both. The referenced XNL assembles an immutable `DefinitionStepForest` containing recursive `StepGroup` and `StepRef` nodes. Each StepRef names one explicit relative `step.xnl`; that file owns the profile-neutral identity, ports, config and one Core binding. Custom facets are declared by exact `ExtensionRef { kind, src, schema? }` entries. No implicit `step-ext/` scan is allowed.

The hierarchy is an authoring and ownership structure. Ctrl profile assembly maps StepGroups/Core to its control tree. AIData assembly keeps dependency/port edges declared in step core facts; the StepForest does not become a second scheduler. Stable step ids are globally unique in one space, relative refs are containment-checked, and assembly uses explicit UTF-16 code-unit order only where order is otherwise absent.

Instance materialization copies the root, StepSpace, every referenced step/extension file and code/schema dependency byte-for-byte. The complete artifact digest covers the exact reference closure. A live source edit or deletion after admission cannot affect the instance.

## 4. Run storage layout

```text
instances/<instanceId>/runs/<runId>/
  checkpoint.json
  step-space/
    records/<recordDigest>.json
    trees/<treeDigest>.json
    receipts/<checkpointVersion>.json
```

`checkpoint.json` uses a storage-envelope schema distinct from the public logical checkpoint schema. It contains immutable run/definition identity, version, logical digest, profile root/control facts and one `runStepStateRootDigest`. That digest selects a `RunStepStateIndex`, not the immutable `DefinitionStepForest`. Tree records are immutable Merkle branch/leaf records. A leaf references one runtime step core record plus an exact closed map of extension kind → record digest. Custom extensions are allowed only when registered by the frozen definition and validated by the corresponding pure codec.

`RunStepStateIndex` membership is derived, never independently authored. Its initial identities are the frozen canonical profile binding assembled from `DefinitionStepForest`. WorkCtrl composite/runtime identities must be exact descendants admitted by the existing snapshot transition rules. AIData generated identities, updates, removals and retained tombstones must be explained by accepted patch-history facts in the logical checkpoint. A dynamic node may use only extension kinds admitted by its frozen profile/StepSpace policy. The index cannot add, remove or rename semantic members without the corresponding canonical profile fact.

The public `FlowRunCheckpointStore` API continues to load and commit complete logical checkpoints. The filesystem adapter performs the split/reconstruction internally, so in-memory stores and existing processors keep one semantic contract. A new optional StepSpace port exposes exact step/extension reads and bounded mutations without making callers write physical paths.

One step-local transition writes at most the changed records, one leaf, the logarithmic ancestor path, one receipt and one checkpoint head. Unchanged record bytes and digests remain identical. The test harness records file writes and bytes; it proves growth is bounded by changed payload + Merkle path rather than all step payloads.

## 5. Transition and recovery protocol

1. Load and normalize the accepted logical checkpoint.
2. Apply a closed step/core or extension mutation through a runtime-first Processor.
3. Reconstruct the candidate logical checkpoint and run existing profile/Agent transition validators.
4. Under the canonical run lock, recheck expected version and accepted head identity.
5. Write immutable candidates with no-follow containment and digest readback.
6. Write/verify a closed receipt binding previous head, candidate head and written records.
7. Atomically rename the new `checkpoint.json` head last.
8. After admission, best-effort cleanup may remove unreachable records only when no accepted receipt references them.

Interruption before step 7 leaves the old head authoritative. Interruption after step 7 yields the new head; cleanup cannot roll it back. Existing direct logical `checkpoint.json` files are admitted through a closed one-way import that produces the same logical value, then future commits use the new envelope. There is no dual write.

## 6. Profile mapping

- WorkCtrl/AICtrl: step-local results, waits, branch facts and orchestration attempts are split by exact canonical/composite node owner; run status, vars, open-handle index and global orchestration facts remain root/control facts. Composite membership is derived from the accepted snapshot orchestration facts. Reconstruction must still satisfy the current exact snapshot and reciprocal sidecar validators.
- AIData: each RunGraph node/result/fingerprint/invalidation projection is a runtime step-state leaf; binding, generation, declaration order, patch history and dependency graph root facts remain profile control facts. Initial membership derives from the frozen binding. Add/update/remove patches are the only authority for dynamic membership changes, update the exact affected leaves and retain tombstones.
- AI Agent: `profile.ai` is a run-level system facet. It stays in the checkpoint control projection because instance-name indexes and invocation receipts span steps; generic actor/session/conversation state remains outside Flow storage.

## 7. TaskSpace and BPCtrl relationship

StepSpace and TaskSpace share recursive tree mechanics but not semantic authority. TaskSpace owns business tasks, task statuses and human operations. StepSpace owns Flow definition steps and run-local step facts. `TaskStep` remains the only explicit bridge, storing a task ref rather than copying TaskSpace data into a step sidecar. Generic traversal utilities may be shared only when they are pure and semantic-neutral.

## 8. Packages and release

- `flow-step-space-contract`: closed DefinitionStepForest and semantic-neutral immutable record/tree contracts, runtime ports and diagnostics only. It does not own FlowRunCheckpoint admission.
- `flow-step-space-logic`: pure definition assembly, closed normalizers and semantic-neutral Merkle construction/diff mechanics. It performs no authoritative run-head mutation and exposes no host-root policy.
- `ai-workflow-logic`: owns profile partition/reconstruction, storage envelope, filesystem record/tree IO, run lock, receipts and root-last checkpoint CAS because it already owns FlowRunCheckpoint normalization and transition admission.
- Existing Ctrl/Data profile packages consume the new definition contracts through exact dependencies and preserve runtime-first Processor forms; they do not write physical sidecars directly.
- All touched publishable packages receive terminal minimum versions and exact internal dependencies. Target package manifests must contain no registry override. Pack, fresh tar consumer, publish and registry readback commands never pass a registry option and never modify npmrc.
- `ai-workflow-flow-dsl-reference` is regenerated from canonical docs and published at its terminal minimum patch after runtime packages.

## 9. Verification

Verification covers definition-local edit isolation, complete instance freeze, one-step write accounting, custom extension schema mismatch, candidate interruption at each admission boundary, CAS conflict, symlink/traversal rejection, v1 one-way import, Ctrl/Data fresh recovery, BPCtrl task-owner separation, full tests/typecheck/docs/reference, tar consumers and final fresh coding AttractorCheck.
