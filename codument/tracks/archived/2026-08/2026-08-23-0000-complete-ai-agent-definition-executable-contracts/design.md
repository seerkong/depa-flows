# Design

## Closed executable resource shapes

`MessageSchema` owns one `schema` property containing a normalized JSON-Schema-compatible ResourceValue map. The projection accepts only a plain map and deep-freezes a detached value; missing, accessor-like or non-map values fail closed.

`EffectPolicy` owns `toolMode = "declared-only" | "none"`. `declared-only` authorizes only the exact ToolRefs declared by the Agent. `none` disables all tools. Unknown fields that would claim runtime behavior fail closed rather than being ignored.

Every Material selected through `MaterialBinding` owns an explicit `value` property. The projected value is detached and deeply immutable. `MaterialPort.schema`, when present, describes that value. The host validates it and delivers it in authored port order; depa-flows does not format prompts or read files.

## Public projection

Add the following additive views:

- `AIWorkflowMessageSchemaProjection`
- `AIWorkflowEffectPolicyProjection`
- `AIWorkflowMaterialValueProjection`

Typed references in Agent messages, input/output schemas, policy, MaterialPort and MaterialBinding point to these executable views while preserving `kind/ref/resource` compatibility.

The semantic fingerprint continues to use Halfcode content digests as byte authority and additionally projects the closed policy mode and selected Material value facts. Host run/session/provider/path facts remain excluded.

## Ownership

- Halfcode: load, normalized ResourceValue, identity, content digest, layers and dependency snapshot.
- depa-flows: fixed AI Agent/schema/policy/Material relation and projection semantics.
- Eidolon: JSON Schema compilation/validation, tool-policy enforcement, typed Material delivery and actor execution.

## Compatibility

Existing definitions without schemas, policy or Material ports remain valid. Existing generic typed-ref fields stay structurally compatible. Malformed standard resources now fail earlier with stable projection diagnostics.

## Verification

Use real Halfcode ResourcePackage fixtures. Cover both workflow kinds, immutable values, authored ordering, invalid schema/policy/material shapes, semantic fingerprint drift and browser-safe exports. No string search or natural-language routing is permitted.
