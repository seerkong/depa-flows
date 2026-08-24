# Holon-targeted organization tasks

An AI Ctrl or AI Data node may delegate complex work to a profile-neutral TaskSpace targeted at one frozen Holon organization snapshot. This is a task boundary, not a shortcut for selecting a Member or Agent.

## Authored target

The node config carries one closed `holonTaskTarget`:

```xnl
config = {
  holonTaskTarget = {
    kind = "holon-task-target"
    schemaVersion = "ai-workflow.holon-task-target/v1"
    invocation = {
      workflowKind = "AICtrlWorkflow"
      workflowRef = "resource://example.ReviewWorkflow"
      nodeId = "open-review"
      invocationId = "review-1"
    }
    holon = {
      rootHolonRef = "review-holon"
      effectiveAt = "2026-01-01T00:00:00.000Z"
    }
    executionBinding = {
      ref = "resource://example.Binding.Review"
      digest = "sha256:..."
    }
    taskSpace = {
      profileRef = "resource://example.TaskProfile.Review"
      policyRef = "resource://example.TaskPolicy.Review"
      requiredRoleRefs = ["reviewer"]
      requiredCapabilityRefs = ["resource://example.Capability.Review"]
    }
    output = {
      schemaRef = "resource://example.Schema.Review"
      materialPortRefs = ["resource://example.Port.Review"]
    }
  }
}
```

Definition→Instance admission freezes the complete target ResourcePackage closure and issues an authentic node proof. The config cannot contain a filesystem path, Member selector, Agent selector, actor/session identity or conversation/history. A coordinator assigns an eligible Member only after TaskSpace creation; a MemberRuntime may then use the already established exact Agent selector surface.

## TaskSpace authority

The Ctrl adapter is a normal runtime-first Processor. It stores the issuer-owned `HolonEffectiveSnapshot` and issuance receipt bytes as content-addressed TaskSpace artifacts, creates an AI organization-task profile, and returns stable space/task/snapshot receipt identities. Waiting/resume observes an exact settlement command receipt. It does not infer completion from an actor or conversation.

An organization-only replan first validates the complete successor snapshot, then idempotently cancels the old nonterminal task and appends a successor task carrying the new immutable snapshot artifacts plus an old/new adoption receipt. The old terminal facts remain in the forest. A changed execution binding, workflow executable identity or Agent/Material closure requires a linked successor Flow Instance/Run rather than rewriting the admitted Instance.

## Data material boundary

The Data adapter reconstructs the terminal TaskRecord and settlement receipt from the TaskSpace owner. Every output artifact must name exactly one declared `MaterialPort`; its digest, media type and size must match full artifact readback. The runtime's frozen ResourcePackage validator validates those materials against the declared `MessageSchema`, and only then returns deep-frozen closed output data.

Fresh reconstruction uses the frozen target proof, canonical Flow checkpoint and TaskSpace files. It has no Holon live-source or Member/Actor history port, so later organization edits or deleted authoring files cannot change an admitted run.

See the modular [AI Ctrl example](../../../../examples/xnl-bundles/ai-ctrl-holon-task/README.md) and [AI Data example](../../../../examples/xnl-bundles/ai-data-holon-task/README.md).
