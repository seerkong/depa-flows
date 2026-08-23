# Design: domain projection over Halfcode proof authority

## Layering

```text
ResourcePackage XNL
  -> Halfcode loadResourceTreeWithContentIdentities
  -> Halfcode composeLayeredResourceRegistry
  -> depa projectAIWorkflowAgentResources (pure/browser-safe)
  -> depa freezeAIWorkflowRunResources (Node-only)
  -> Halfcode buildResourceDependencySnapshot
  -> immutable AIWorkflowRunResourceFreezeReceipt
```

Halfcode is the single writer for generic resource facts: package/catalog parsing, containment, identities, provenance, layer precedence, tombstones, canonical digests, typed-edge closure, and snapshot revisions. depa-flows owns only the fixed meaning of AI workflow resource kinds and their domain receipt projection. Eidolon later supplies roots, layer order, and runtime persistence.

## Pure public read port

`projectAIWorkflowAgentResources` accepts `AIWorkflowResourceRegistryView`, the existing `Pick<ResourceRegistry, "byKind">` port. It creates an invocation-local exact-id index solely to resolve declared relations. The index is not returned or cached and therefore is not a second registry.

The projection returns deeply immutable ordered arrays:

- `agentDefinitions`;
- `materialPorts`;
- `materialBindings`;
- `dependencyEdges` using Halfcode's public typed edge contract.

It never reads files, evaluates prompts, searches arbitrary properties for URI-looking text, or infers meaning from names or natural language.

## Fixed XNL resource shapes

### AIAgentDefinition

```xnl
<AIAgentDefinition #depa.flows.Agent.Support {
  apiVersion = "depa.flows/v1"
  version = "1.0.0"
}>
  <Messages>
    <Message #system { role = "system" promptKind = "Prompt" promptRef = "resource://depa.flows.Prompt.Support.System" }>
    <Message #user { role = "user" promptKind = "Prompt" promptRef = "resource://depa.flows.Prompt.Support.User" }>
  </Messages>
  <ToolRefs>
    <ToolRef #lookup { kind = "Tool" ref = "resource://depa.flows.Tool.Lookup" }>
  </ToolRefs>
  <MaterialPortRefs>
    <MaterialPortRef #request { kind = "MaterialPort" ref = "resource://depa.flows.Port.Request" }>
  </MaterialPortRefs>
</AIAgentDefinition>
```

Optional `InputSchemaRef`, `OutputSchemaRef`, `EffectPolicyRef`, and per-message `SchemaRef` are single fixed child nodes with explicit `kind` and `ref`. Message roles are exactly `system`, `developer`, `user`, or `assistant`. Messages and MaterialPortRefs preserve authored body order.

### MaterialPort

```xnl
<MaterialPort #depa.flows.Port.Request {
  materialKind = "RequestMaterial"
  required = true
  cardinality = "one"
}>
  <SchemaRef { kind = "MessageSchema" ref = "resource://depa.flows.Schema.Request" }>
</MaterialPort>
```

`cardinality` is exactly `one` or `many`. `SchemaRef` is optional and explicit.

### MaterialBinding

```xnl
<MaterialBinding #depa.flows.Binding.Support.Request>
  <AgentTaskRef {
    workflowKind = "AICtrlWorkflow"
    workflowRef = "resource://depa.flows.Workflow.Support"
    nodeId = "collect-request"
    agentDefinitionRef = "resource://depa.flows.Agent.Support"
  }>
  <PortRef { kind = "MaterialPort" ref = "resource://depa.flows.Port.Request" }>
  <MaterialRef { kind = "RequestMaterial" ref = "resource://depa.flows.Material.Request.001" }>
</MaterialBinding>
```

The task reference is a resource-selection contract. It does not add an AgentTask node to WorkCtrlFlow or EagerDataFlow and carries no run/session/generation/provider/actor facts.

## Typed relations

The projector emits only these closed relation values:

- `agent-message-prompt`, `agent-message-schema`;
- `agent-input-schema`, `agent-output-schema`;
- `agent-tool`, `agent-effect-policy`, `agent-material-port`;
- `material-port-schema`;
- `material-binding-port`, `material-binding-material`.

The freeze step adds `workflow-agent-task` and `workflow-material-binding`. Halfcode validates endpoints, computes closure, and binds content identities. Ordinary text containing a resource-like substring creates no edge.

## Run-freeze boundary

`ai-workflow-logic/run-freeze` exports:

```ts
freezeAIWorkflowRunResources({
  registry,
  projection,
  task,
  contentIdentities,
}): AIWorkflowRunResourceFreezeReceipt
```

The registry must be an authentic `EffectiveResourceRegistry` produced by Halfcode. The method selects the exact Agent and bindings for the exact task tuple, verifies that every binding port belongs to that Agent, applies required/cardinality constraints, and checks material kinds. It then delegates roots, edges, and content identities to `buildResourceDependencySnapshot`.

Bindings are ordered by authored Agent MaterialPortRefs. For a `many` port, matching binding ids use explicit UTF-16 code-unit order. A `one` port rejects more than one binding.

## Receipt and two revisions

The receipt contains:

- schema version and exact task tuple;
- ordered selected binding resource ids;
- complete immutable Halfcode dependency snapshot for proof and recovery;
- a SHA-256 domain semantic fingerprint.

The Halfcode snapshot revision intentionally includes the effective registry revision and provenance. The semantic fingerprint binds only selected domain facts, typed relations, and reachable `{resourceId, kind, contentDigest}` tuples. It excludes unrelated unreachable resources and host facts such as roots, run id, session id, generation, actor, or provider. This separation permits semantic reuse without weakening the complete freeze proof.

## Runtime and packaging

- package root and `/browser`: pure projector only, with Halfcode imports used as types;
- `/filesystem`: existing Halfcode loader adapter;
- `/run-freeze`: Node/server-only Halfcode composition/snapshot runtime.

No root/browser re-export may import the run-freeze entry.

## Failure model

Projection and freeze errors contain stable domain codes, locations, and messages. Any invalid fixed structure or relation aborts the complete projection/receipt. There is no partial output and no fallback interpretation.

## Verification

Tests use a real Halfcode ResourcePackage and published 0.2.2 APIs. Boundary coverage includes malformed and duplicate nodes, exact-kind mismatch, similar ids, authored order, required/cardinality rules, unrelated resource revision behavior, input mutation, Unicode ordering, browser imports, exact public dependency metadata, a fresh packed-artifact consumer, and static checks for authority separation.
