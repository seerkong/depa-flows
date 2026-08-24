# Design: Holon organization TaskSpace profile

## Contracts

`HolonTaskTarget` is closed data containing Holon root selector, execution-binding ref/digest, TaskSpace profile/policy, requested output schema/material ports and invocation identity. It contains no physical path. These policy/executable facts are resolved and frozen during Definition→Instance admission.

`HolonTaskTarget` intentionally contains neither a Member selector nor an Agent-instance selector. The Holon coordinator first assigns an eligible Member against the TaskSpace's frozen organization snapshot. Only after that assignment may the frozen execution binding and MemberRuntime select existing Agent continuity through the established exact `runTargetedAgent` selector union (`{ byInstanceId } | { byInstanceName }`). Flow state observes only stable TaskSpace, assignment, MemberRuntime/session references and typed receipts; it cannot preselect, fabricate or persist generic actor/session authority.

At TaskSpace creation, a runtime port requests/verifies an issuer-owned `HolonEffectiveSnapshot` Resource and issuance receipt at the explicit effective instant. The TaskSpace stores those exact immutable bytes in its own content-addressed records and derives `HolonTaskSnapshotReceipt { taskSpaceId, holonRef, effectiveAt, holonSnapshotRef, holonSnapshotDigest, issuerReceiptId, executionBindingDigest, eligibleMemberRefs, eligibleRoleRefs }`. This is the TaskSpace's organization-version fact; neither Flow checkpoint nor host code can fabricate it.

The AI organization-task profile carries requested role/capability constraints, assignment receipts, opaque MemberRuntime refs and typed work/result material. These are profile facts; the shared TaskSpace kernel owns task lifecycle and claims.

## Ctrl adapter

A Ctrl node creates or references a TaskSpace, dispatches a typed organization-task command and enters Waiting with the stable space/task/receipt expectation. Resume consumes a matching terminal receipt. Compatible organization-only replan accepts a command carrying a new issuer-owned snapshot artifact+receipt, stores it as new immutable TaskSpace material, verifies every eligible target against the already frozen execution binding/Agent closure, and records old/new adoption receipts. It does not add the new organization snapshot to or rewrite the Flow instance definition. A changed binding, Agent/Material closure, workflow definition or flow code requires a linked successor Flow instance/run.

## Data adapter

A Data node treats TaskSpace settlement as an effect boundary. Declared result material is validated against output schema and mapped to MaterialPorts. Scheduling and recovery use checkpoint/TaskSpace receipts, never Member conversation history.

## Authority and recovery

TaskSpace commits snapshot/replan/settlement facts first. Flow checkpoint consumes their receipts in separate CAS transitions. A fresh process reconstructs from the frozen instance, canonical checkpoint, TaskSpace head and carried issuer-owned snapshot bytes. Live Holon or ResourcePackage changes/deletion cannot alter the run.

`ai-ctrl-workflow-*` and `ai-data-workflow-*` only bind the shared AI profile to their schedulers. No package implements its own task forest, actor registry or filesystem transaction.
