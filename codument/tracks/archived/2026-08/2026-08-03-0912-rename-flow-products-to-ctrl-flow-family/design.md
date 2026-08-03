# Design

## Naming model

Use two product families:

```text
ctrl-flow family
  ctrl-flow              shared grammar / AST / concept
  instant-ctrl-flow      one-shot control-flow product
  work-ctrl-flow         durable suspend/resume control-flow product
  bp-ctrl-flow           business-process control-flow product

ai-workflow family
  ai-workflow            shared umbrella across AI workflow products
  ai-ctrl-workflow       AI control-plane workflow
  ai-data-workflow       AI data-plane workflow

data-flow substrate
  eager-data-flow        eager DAG substrate
```

`CtrlFlow` remains a shared grammar and AST concept. It is not made into an authoring root by this rename.

## Canonical public names

| Old package/path | New package/path |
|---|---|
| `instant-flow-contract` | `instant-ctrl-flow-contract` |
| `instant-flow-logic` | `instant-ctrl-flow-logic` |
| `work-flow-contract` | `work-ctrl-flow-contract` |
| `work-flow-logic` | `work-ctrl-flow-logic` |
| `biz-process-contract` | `bp-ctrl-flow-contract` |
| `biz-process-logic` | `bp-ctrl-flow-logic` |
| `ai-agent-workflow-contract` | `ai-ctrl-workflow-contract` |
| `ai-agent-workflow-logic` | `ai-ctrl-workflow-logic` |

Unchanged packages:

- `ai-workflow-contract`
- `ai-workflow-logic`
- `ai-data-workflow-contract`
- `ai-data-workflow-logic`
- `eager-data-flow-contract`
- `eager-data-flow-logic`

## Type and API naming

| Old type/function prefix | New type/function prefix |
|---|---|
| `InstantFlow` | `InstantCtrlFlow` |
| `WorkFlow` | `WorkCtrlFlow` |
| `BizProcess` | `BPCtrlFlow` |
| `AIAgentWorkflow` | `AICtrlWorkflow` |

Examples:

- `runInstantFlow` → `runInstantCtrlFlow`
- `loadInstantFlowSpec` → `loadInstantCtrlFlowSpec`
- `WorkFlowEngine` → `WorkCtrlFlowEngine`
- `WorkFlowSnapshot` → `WorkCtrlFlowSnapshot`
- `BizProcessEngine` → `BPCtrlFlowEngine`
- `TaskStepResult` remains task-domain terminology unless its containing public product prefix is present.
- `createAIAgentWorkflowController` → `createAICtrlWorkflowController`
- `defineWorkFlowBackedAIAgentWorkflow` → `defineWorkCtrlFlowBackedAICtrlWorkflow`

Shared `AIWorkflow*` APIs remain shared only when they genuinely cover both `AICtrlWorkflow` and `AIDataWorkflow`.

## XNL authoring surface

Root tags:

| Old root | New root |
|---|---|
| `<InstantFlow>` | `<InstantCtrlFlow>` |
| `<WorkFlow>` | `<WorkCtrlFlow>` |
| `<BizProcess>` | `<BPCtrlFlow>` |
| `<AIAgentWorkflow>` | `<AICtrlWorkflow>` |

Resource kind / profile kind values should follow the same names:

- `InstantCtrlFlow`
- `WorkCtrlFlow`
- `BPCtrlFlow`
- `AICtrlWorkflow`
- `AIDataWorkflow`
- `EagerDataFlow`

Control-flow URI schemes should be renamed:

- `instant-ctrl-flow://<FQN>`
- `work-ctrl-flow://<FQN>`
- `bp-ctrl-flow://<FQN>`

AI workflow resource refs may continue to use the shared resource system where already defined. Product-specific kind values should use `AICtrlWorkflow` and `AIDataWorkflow`.

## Directory and docs naming

Docs should move or be rewritten to the new directory names:

- `docs/flow-dsl/std/instant-flow/` → `docs/flow-dsl/std/instant-ctrl-flow/`
- `docs/flow-dsl/std/work-flow/` → `docs/flow-dsl/std/work-ctrl-flow/`
- `docs/flow-dsl/std/biz-process/` → `docs/flow-dsl/std/bp-ctrl-flow/`
- `docs/flow-dsl/std/ai-agent-workflow/` → `docs/flow-dsl/std/ai-ctrl-workflow/`
- `docs/flow-dsl/spec/instant-flow/` → `docs/flow-dsl/spec/instant-ctrl-flow/`
- `docs/flow-dsl/spec/work-flow/` → `docs/flow-dsl/spec/work-ctrl-flow/`
- `docs/flow-dsl/spec/biz-process/` → `docs/flow-dsl/spec/bp-ctrl-flow/`
- `docs/flow-dsl/spec/ai-workflow/agent-workflow.md` → `docs/flow-dsl/spec/ai-workflow/ctrl-workflow.md`
- `examples/xnl-bundles/ai-agent-workflow/` → `examples/xnl-bundles/ai-ctrl-workflow/`

Existing example bundles for instant/work/business process should update root tags and any directory/readme labels that expose old product names.

## Codument migration scope

Update current-truth Codument assets:

- `codument/behaviors/`
- pending tracks
- active tracks
- active mission artifacts that still guide future implementation
- `codument/modeling/` and `codument/engineering/` if they are current registry truth despite config being disabled

Archived historical assets can remain as history unless validators or current automation read them as active truth. Any decision to rewrite archives should be explicit during implementation.

## No legacy public alias rule

Final state must not document old names as valid aliases. Loaders/checkers should reject old public XNL roots in current authoring mode.

Temporary aliases may exist only as implementation scaffolding within this rename track. They must be removed before the track is marked `DONE`.

## Validation strategy

Implementation should validate with:

- package manager install/build resolution after package renames
- TypeScript typecheck
- relevant unit tests
- flow-dsl checker tests
- grep/path hygiene checks for obsolete public names outside allowed historical/archive notes
- Codument validate for this track and any modified active/pending tracks
