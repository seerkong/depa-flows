# L2 · AIDataWorkflow axioms

`AIDataWorkflow` is an EagerDataFlow-backed AI workflow profile. It uses EagerDataFlow DAG nodes as the authoring substrate and adds a per-run RunGraph for iterative AI coordination.

## Substrate

- Root tag: `<AIDataWorkflow>`.
- Root `[]`: EagerDataFlow DAG nodes.
- Root `()`: `FlowContract` plus optional AI workflow resource references.
- Runtime substrate: EagerDataFlow plan plus AI RunGraph state.

The definition owns topology and static node config. The run's canonical checkpoint owns the RunGraph profile together with input/config/state/output and controller/node sidecars. Runtime status, patch history, generation history, invalidation records and reuse records are not written through a parallel graph-state store.

## RunGraph

Every run has its own mutable RunGraph. A graph patch creates a new generation and records the operation. Mature edits can be promoted by a higher-level authoring workflow, but runtime patch history is not itself the definition.

## Invalidation

When a completed node changes, the changed node and its transitive downstream dependents are invalidated. Old outputs are retained as historical generation results.

## Reuse

The default machine-node reuse policy is `semantic-hash`; manual nodes default to `never`. A canonical manual node is authored with `config = { node_type = "manual" }`; the EagerDataFlow `type` field remains an implementation binding and is not reinterpreted. Reuse is run-local unless a separate shared cache authority is introduced. Generation records history and does not enter the semantic fingerprint.

## Recovery authority

Before execution, the complete definition bundle is admitted as a frozen instance. A fresh process recompiles from that instance and restores the RunGraph from the same versioned checkpoint. Events, indexes and views may be rebuilt from the checkpoint but cannot write back to it or to the definition.
