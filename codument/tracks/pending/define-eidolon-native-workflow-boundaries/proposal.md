# Proposal

## Summary

Define the Eidolon-native integration boundary for AI Ctrl Workflow and AI Data Workflow.

This track turns the agreed discussion into durable Codument design and decisions: workflow contracts, runtime effects, native tools, authoring tools, profile enablement, and recovery must have clear owners before implementation continues.

## Goals

- Establish where workflow contracts, native tools, effect handlers, and profile enablement live in Eidolon-facing packages.
- Make authoring workspace operations first-class native tools, not an MCP-only leftover.
- Ensure workflow execution reuses Eidolon actor/session/fiber/tool/provider/runtime-control persistence instead of creating workflow-specific special cases.
- Define workflow persistence as a thin workflow facts layer with references to Eidolon-owned runtime facts.
- Preserve depa-flows library boundaries: AI Ctrl Workflow remains WorkCtrlFlow-backed, AI Data Workflow remains EagerDataFlow-backed, and effect execution remains embedded/programmatic.

## Non-goals

- Do not implement Eidolon source changes in this track.
- Do not introduce a new flow engine.
- Do not expose internal workflow effect handlers as direct AI tools.
- Do not duplicate Eidolon conversation, tool-call, provider-call, checkpoint, actor, member, holon, or detached-task storage.
- Do not reintroduce `.sparrow` resource conventions or XML authoring formats.

## Proposed behavior

The system should expose workflow as an Eidolon-native profile capability. The AI-facing tool surface must include both runtime operations and authoring workspace operations. Runtime effects remain internal scheduler adapters that call Eidolon’s existing actor/fiber/tool/provider/human-input mechanisms.

Workflow-owned persistence should store only workflow definitions, run graph structure, node generation/history, invalidation/reuse policy, material bindings, node status references, and workflow-level audit decisions. Everything else is represented by references to Eidolon-owned facts.

## Compatibility

- depa-flows remains the portable workflow library and keeps its current package boundaries.
- Eidolon integration is an adapter/profile layer over the existing library contracts.
- MCP-backed tools may continue to exist, but the native Eidolon workflow capability should not depend on MCP for first-party workflow authoring or execution.

## Acceptance

- `design.md` records the package map, tool/effect split, authoring tool scope, fact authority boundary, and recovery strategy.
- `decisions.xnl` records accepted decisions for placement and authority.
- `behavior_deltas/eidolon-workflow-integration/delta.xml` captures the externally visible requirements that future implementation tracks must satisfy.
- `track.xml` provides an executable Codument task plan for implementation readiness.
