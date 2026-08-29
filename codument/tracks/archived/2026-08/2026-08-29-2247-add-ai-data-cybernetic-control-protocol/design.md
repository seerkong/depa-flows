# Design: add-ai-data-cybernetic-control-protocol

## Authority model

| Fact | Grade | Owner | Rule |
|---|---:|---|---|
| `AIDataWorkflowRunGraph` in accepted checkpoint | canonical runtime fact | existing RunGraph/checkpoint owner | the only graph read by execution |
| current verifier fact | canonical verification fact | injected host verifier port | the only fact allowed to authorize completion |
| `AIDataControlObservation` | derived projection | observation Processor | rebuildable; never committed as graph authority |
| controller response | proposal | external Agent | cannot directly name executable implementation details |
| `AIDataControlAdmission` | transition candidate | admission Processor | either one admitted patch/outcome or typed rejection feedback |
| `AIDataControlIterationReceipt` | appendable evidence | host loop | records digests and outcome; never drives graph execution |

The new code does not call `applyAIDataWorkflowGraphPatch`. It produces a normalized `AIDataWorkflowGraphPatch` for the existing owner to commit. This keeps `state' = applyAIDataWorkflowGraphPatch(state, admittedPatch)` as the only graph transition.

## Closed data protocol

All public values use the `depa.ai-data-control/v1` schema marker and JSON-serializable fields.

### Goal and budget

`AIDataControlGoal` carries a stable goal id, objective, verifier reference and required output schema reference. `AIDataControlBudget` freezes maximum iterations, patch operations, no-progress rounds and optional token/deadline limits. The protocol never invents defaults at admission time; the host constructs the complete budget once.

### Frozen capability catalog

Each `AIDataControlCapability` gives the controller a semantic `capabilityId`, a fixed node tag/type, exact input and output port schema refs, fixed config, and an implementation proof:

- code capability: one frozen `codeRef`;
- agent capability: one frozen `agentDefinitionRef` plus `taskProofRef`.

The controller decision references `capabilityId`; it cannot submit `src`, `impl`, code refs or Agent definition refs. Admission resolves the selected capability into the existing graph patch node spec. A catalog digest is carried by every observation and decision, so a decision from a different closure is stale.

### Observation

`projectAIDataControlObservation(runtime, input, config)` derives:

- graph generation and deterministic graph digest;
- bounded node summaries with status and typed ports;
- latest verifier fact and prior admission feedback;
- remaining iteration/no-progress/token/deadline budget;
- frozen goal/catalog digests.

The runtime contains no business methods; clock/digest dependencies are explicit data/effect ports. Projection is deterministic for the same input.

### Decision

The controller returns one closed union:

- `revise`: a non-empty list of `add-capability`, `rewire-capability`, or `remove-node` operations;
- `complete`: references the exact PASS verifier observation;
- `fail`: an explicit bounded terminal reason.

Revision input bindings are either a typed predecessor port reference or a closed literal with an explicit schema ref. This lets admission compare every required input against the catalog contract before a patch exists.

### Admission

`admitAIDataControlDecision(runtime, input, config)` performs a pure validation and normalization pass:

1. run an iterative bounded JSON preflight before digesting controller output, then reject schema, goal, catalog or observation digest mismatch;
2. require the observation's verifier projection to equal the independently supplied host-owned current verifier fact;
3. reject exhausted iteration/deadline/token/no-progress budgets;
4. reject operations beyond the budget, duplicate targets and protected/bootstrap targets;
5. resolve every capability only through the frozen catalog;
6. prove required/extra input ports and exact schema compatibility against the post-decision candidate, including unchanged downstream consumers;
7. translate valid operations to an `AIDataWorkflowGraphPatch` whose generation is exactly `currentGeneration + 1`;
8. reject a semantically unchanged patch as no progress, becoming terminal only when the next no-progress count reaches the frozen limit;
9. admit `complete` only for the independent exact latest verifier PASS fact and required output schema.

Rejection returns typed feedback and no patch. It does not throw for controller-correctable errors; malformed host-owned protocol inputs remain programming errors.

## Control flow

```text
canonical checkpoint graph
  -> project observation
  -> Agent decision (proposal only)
  -> admit decision
       -> rejected feedback -> next observation
       -> admitted patch -> existing graph owner commit -> execute -> verify -> next observation
       -> admitted completion/failure -> terminal host outcome
```

The host may preserve the controller Agent instance across iterations with `runAgent` followed by `runTargetedAgent`, but that lifecycle belongs to the later host Track. This package only makes every turn's input/output typed and replayable.

## Package mapping

- `ai-data-workflow-contract`: public data contracts only.
- `ai-data-workflow-logic`: pure observation, digest and admission Processors.
- `ai-workflow-*`: unchanged Agent/checkpoint substrate.
- Eidolon: later host adapter and resource-managed Agent lifecycle.

No provider name, prompt text, filesystem path or host service type enters these packages.

## Verification strategy

Focused tests construct a real generation-zero RunGraph and cover:

- two different admitted revisions from two successive observations;
- frozen code and Agent capabilities, exact port schemas and protected nodes;
- stale decisions and invalid proposals yielding feedback with byte-equivalent graph input;
- forged verifier projections, incompatible downstream rewires and oversized/deep controller JSON;
- completion before/after verifier PASS;
- exhausted budgets and no-progress termination;
- JSON round-trip/reconstruction producing the same observation and admission result;
- absence of provider/host imports in the public packages.

Full workspace typecheck/tests ensure the new public surface does not weaken existing patch or Agent semantics.
