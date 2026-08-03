# Design

## Shape

`ai-data-workflow-contract` defines RunGraph, RunNode, GraphPatch, invalidation and reuse record contracts.

`ai-data-workflow-logic` provides pure helpers:

- `createAIDataWorkflowRunGraph` from EagerDataFlowAuthoringPlan.
- `applyAIDataWorkflowGraphPatch` for add/update/remove node patches.
- `invalidateAIDataWorkflowNode` for transitive downstream invalidation.
- `createAIDataWorkflowSemanticFingerprint` for reuse semantics.
- `findReusableAIDataWorkflowNodeResult` for run-local semantic reuse.

## Generation vs reuse

Generation records history and patch lineage. It must not enter the reuse fingerprint. Reuse compares node kind, effective inputs, config, material revisions and effect policy.

## Scope

Reuse is run-local only. Cross-run shared cache is out of scope.
