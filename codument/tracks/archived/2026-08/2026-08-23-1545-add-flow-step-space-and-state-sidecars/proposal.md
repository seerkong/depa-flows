# Track: add-flow-step-space-and-state-sidecars

## Problem

The restored Definition → Instance → Run model has one correct durable owner, but its physical `checkpoint.json` rewrites a full Ctrl snapshot or Data RunGraph after each accepted node transition. Large workflows therefore couple a local step edit or state change to a whole-graph serialization, and custom step state has no first-class, schema-bound extension boundary.

The earlier Python fixture preserved process/step ports, one `Core` and explicit `Extension` nodes; depa's `order-fulfillment` bundle preserves separate config/state facets; `task-manager-*`, `bp-ctrl-flow-*` and Codument TaskSpace preserve recursively-addressed task forests and bridge them without copying their authority. Those ideas were partially distilled, but there is no equivalent generic Step domain in the current Flow runtime.

## Goal

Introduce a profile-neutral StepSpace/StepForest contract for modular Flow definitions and a step-local physical persistence codec for Flow run state. A run still has exactly one current durable authority: `checkpoint.json` selects one immutable content-addressed StepForest root. Step core facts and registered extension facts live beside the checkpoint as immutable records; unreferenced candidates never become current truth.

Local definition changes SHALL touch one referenced step/extension file. Local runtime transitions SHALL write the changed step/extension records plus the Merkle path and checkpoint head, rather than rewriting every unaffected step payload. Full logical `FlowRunCheckpoint` validation, version CAS, terminal immutability, profile invariants and fresh recovery remain mandatory.

## Scope

- New `flow-step-space-contract` and `flow-step-space-logic` packages.
- An exact XNL StepSpace/StepForest definition form with explicit `StepRef` and extension references; no directory discovery.
- Ctrl and Data profile assembly from StepSpace into the existing canonical profile bindings.
- A versioned filesystem checkpoint codec with immutable step/extension records, root-last CAS admission, one-way legacy checkpoint import and full logical read reconstruction.
- Complete Definition/Instance copying, docs/examples/reference regeneration, package release at terminal minimum versions, and a fresh registry consumer.

## Non-goals

- StepSpace does not replace TaskSpace and does not copy task status. BPCtrl keeps an exact bridge between one Flow step and the independently owned TaskSpace.
- The StepForest authoring hierarchy does not replace AIData dependency edges or profile schedulers.
- No second live checkpoint, mutable sidecar head, directory scanner, host path policy, natural-language routing or profile-specific state authority is introduced.
- Eidolon dependency adoption is a following mission track after the depa packages are published.

## Success

An order-fulfillment Ctrl bundle and a non-trivial AIData bundle can be authored with external StepRefs and extension facets, frozen into an instance, run through multiple local transitions, and recovered from a fresh process. A one-step update leaves unrelated immutable records byte-identical, writes logarithmically many StepForest index records, and admits the new state only by one checkpoint CAS. Interrupted candidates are ignored or recovered without exposing partial state.
