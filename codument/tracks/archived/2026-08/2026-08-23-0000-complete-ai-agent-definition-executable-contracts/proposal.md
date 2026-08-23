# Complete executable AIAgentDefinition contracts

## Context

The current AI Workflow resource projection preserves schema, effect-policy and Material references, but leaves their values opaque. Eidolon therefore rejects every standard Agent that declares schemas or a policy, and only freezes Material identities without a typed delivery value. This is a valid fail-closed first profile, but not complete `AIAgentDefinition` support.

## Goals

- Define closed executable projections for `MessageSchema`, `EffectPolicy` and bound Material values.
- Preserve exact resource identity, authored order, immutable projections and Halfcode-owned dependency snapshots.
- Make the same task contract work for `AICtrlWorkflow` and `AIDataWorkflow`.
- Publish additive browser-safe types and pure projection logic; runtime enforcement remains a host responsibility.

## Non-goals

- Do not implement an actor, provider, tool registry, JSON Schema validator or Material filesystem reader in depa-flows.
- Do not add a substrate `AIAgentTask` node; `AgentTaskRef` remains the exact resource-selection tuple.
- Do not infer schema, policy or Material semantics from names, descriptions or arbitrary text.

## Impact

- `ai-workflow-contract`: additive executable projection types.
- `ai-workflow-logic`: fixed-shape projection and run-freeze fingerprint inputs.
- Flow DSL docs and fixtures: canonical executable XNL shapes.
- Public packages: smallest terminal patch release after verification.
