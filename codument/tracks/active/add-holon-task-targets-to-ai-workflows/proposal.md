# Track: Holon task targets for AI Workflows

## Problem

AI Ctrl/Data workflows can invoke exact Agent definitions, but a complex node cannot yet delegate work to an organization-owned TaskSpace. Without an explicit target contract, host code would be tempted to resolve live Holon state, route by prose or copy task/actor facts into workflow checkpoints.

## Change

- Add an AI organization-task profile over the shared TaskSpace kernel.
- Add a closed `HolonTaskTarget` whose policy/execution binding is frozen at instance admission and whose exact issuer-owned organization snapshot is frozen when the TaskSpace is created.
- Keep Member selection and Agent-instance continuity out of `HolonTaskTarget`: the Holon coordinator assigns a Member after TaskSpace creation, and only the frozen execution binding/MemberRuntime may subsequently use the existing targeted Agent selector surface.
- Extend Flow DSL/freeze proof for task-target nodes.
- Add thin Ctrl wait/resume/replan and Data material-output adapters.
- Persist only stable TaskSpace and actor/session references plus receipts in flow state.

## Non-goals

- Holon master-data storage or `HolonExecutionBinding` definition.
- Member actor creation/routing inside depa-flows.
- Fuzzy member selection, organization-name routing or actor conversation persistence.
- Mission 2 remote execution.

## Verification

Modular Ctrl/Data XNL bundles, exact freeze proof, changed/deleted live source recovery, TaskSpace settlement handoff, explicit replan and static rejection of parallel kernel/actor authority.
