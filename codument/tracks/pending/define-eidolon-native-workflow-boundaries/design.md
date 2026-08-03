# Design

## Principle

Workflow is an orchestration capability, not a second Eidolon runtime.

The depa-flows library owns portable workflow definitions and execution semantics. Eidolon owns actors, sessions, fibers, conversation history, tool/provider calls, checkpoints, runtime-control evidence, member/holon state, and detached task records. Native workflow integration must connect these systems by reference, not by duplicating state.

## Package and directory placement

### depa-flows library side

- `packages/ai-workflow-contract`
  - Shared AI workflow contracts that are portable across host runtimes.
  - Effect request/result contracts and workflow run/reference types.
- `packages/ai-workflow-logic`
  - Library-level effect provider registry and embedded provider mechanics.
  - No dependency on Eidolon session directories or ambient process state.
- `packages/ai-ctrl-workflow-*`
  - AI Ctrl Workflow profile over `WorkCtrlFlow`.
- `packages/ai-data-workflow-*`
  - AI Data Workflow profile over `EagerDataFlow`.

### Eidolon native side

- `cell/packages/ai-workflow-contract`
  - Eidolon-specific workflow contract/data-subgraph declarations if workflow becomes native Eidolon state.
  - Shared type bridge from depa-flows workflow facts to Eidolon actor/fiber/domain refs.
- `cell/packages/ai-organ-logic/src/workflow/tools`
  - Workflow native `ToolDef` implementations.
  - Includes runtime tools and authoring workspace tools.
  - Follows existing standardized component protocol patterns: outer/inner types, logic, prompt XNL, and optional manifest bundle.
- `cell/packages/ai-organ-logic/src/workflow/effects`
  - Runtime adapter/effect handlers that map workflow node effects to Eidolon mechanisms.
  - Internal scheduler-facing APIs, not model-visible tools.
- `cell/packages/ai-organ-logic/src/composer/AIAgent`
  - Only imports/registers workflow tool bundles.
  - Does not own workflow tool implementation.
- `cell/packages/mod-ai-kernel`
  - Enables workflow as an AI-kernel profile capability.
  - Installs workflow tool bundle/catalog/prompt capability into profile composition.

## Native tool surface

The native workflow tool surface should include both execution and authoring.

Runtime/control tools:

- start workflow run
- inspect workflow run
- resume workflow run
- get node status/output refs
- apply safe run-graph patch
- promote mature run-graph changes back to workflow definition

Authoring workspace tools:

- list/read workflow resources
- create/patch/validate workflow definitions
- create/patch/validate app bundle resources
- author material ports and material bindings
- propose graph patches
- inspect invalidation/reuse consequences
- review run records and workflow audit history

These should be native Eidolon `ToolDef`s, not only MCP-backed functions. MCP may remain an integration option, but first-party workflow functionality should be available through the same native tool chain as other built-in Eidolon tools.

## Effect boundary

Effect handlers are internal workflow runtime adapters.

- AI agent task node:
  - Resolve `agentType` through the existing agent registry.
  - Start work through existing child/delegate actor creation.
  - Use `sync_wait` for short blocking nodes and detached actor/task records for long-running autonomous nodes.
  - Store actor/fiber/task refs in workflow node state.
- Tool/effect node:
  - Execute through existing tool registry and actor turn machinery so tool-call facts and runtime-control evidence remain Eidolon-owned.
- Human/input/approval node:
  - Use existing mailbox, control signal, questionnaire, or coordination mechanisms.
  - Do not create workflow-specific blocking files.

Internal effect handlers must not be exposed as direct AI tools. Direct exposure would let a model bypass workflow scheduler checks, RunGraph generation rules, invalidation/reuse policy, and audit recording.

## Workflow facts authority

Workflow owns:

- workflow definitions
- run graph structure
- node generation history
- invalidation and reuse policy
- material ports and material bindings
- node status refs
- workflow-level audit decisions
- graph patch and promote records

Workflow does not own:

- actor registry or actor mutable state
- fiber scheduler state
- conversation history and message projections
- LLM/provider call facts
- tool-call lifecycle and outputs
- runtime-control effect WAL as live truth
- checkpoint snapshots as live truth
- member, holon, and detached-task truth
- mailbox/control-signal durable authority

Workflow node records should store references such as `actorKey`, `actorId`, `fiberId`, optional `taskId`, material refs, tool-call ids, provider-call ids, and domain fact ids.

## Recovery strategy

Recovery order:

1. Let Eidolon recover VM, actors, fibers, conversation domains, tool/provider domains, runtime-control gate, and snapshot-derived indexes through its existing session recovery path.
2. Load workflow facts from the workflow sidecar/domain.
3. Reconcile each workflow node ref against restored actor/fiber/task/domain facts.
4. Mark nodes runnable, waiting, completed, failed, or needing repair based on authoritative Eidolon facts.
5. Continue workflow scheduling only after reconciliation has rebuilt a coherent RunGraph view.

Runtime-control evidence remains audit/recovery material. It should not become the workflow node-state authority.

## Resource and path boundary

Resource authoring remains XNL-only and follows depa-flows flow-dsl resource standards. Eidolon host integration injects global and workspace-level roots; workflow logic must not discover state roots from ambient `cwd`, hidden sparrow directories, or environment guesses.

The `.eidolon` convention belongs to the Eidolon host layer. The portable depa-flows packages should accept explicit runtime roots/capabilities from the host.

## Implementation readiness tasks

Future implementation should proceed in small tracks:

1. Add/adjust Eidolon workflow contract and data-subgraph declarations.
2. Add workflow effect adapters under the workflow effect directory.
3. Add native runtime and authoring tools under the workflow tools directory.
4. Register the workflow tool bundle through composer aggregation.
5. Enable workflow capability through the AI kernel profile.
6. Add recovery tests proving workflow facts reconcile against restored actor/fiber/task refs.
