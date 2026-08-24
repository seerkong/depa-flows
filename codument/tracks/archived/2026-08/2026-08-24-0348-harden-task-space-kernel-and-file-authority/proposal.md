# Track: Harden TaskSpace kernel and file authority

## Problem

`task-manager-*` expresses an early BP-shaped task model (`Delegated`, `Forwarded`, `Refused` are kernel statuses) and does not yet provide the closed, recoverable owner needed for complex workflow nodes. Kernel lifecycle, claims, product outcomes and filesystem concerns are not separated strongly enough for reuse by BP, AI Ctrl and AI Data profiles.

## Change

- Make `task-manager-contract` the profile-neutral closed TaskSpace data/port package.
- Make `task-manager-logic` the pure/runtime-first transition and CAS orchestration package.
- Freeze a neutral lifecycle, owner-issued claim token, heartbeat/expiry recovery, append-only history and content-addressed artifact authority; map BP words through a BP profile instead of retaining them as kernel status.
- Add `task-manager-file-support` for containment, lock, journal, content-addressed records and head-last fsync admission.
- Keep BP-specific TaskStep semantics in `bp-ctrl-flow-*`.
- Provide a profile envelope for later AI organization tasks.

## Non-goals

- Importing or implementing Codument TaskSpace.
- Adding Holon or Agent fields to the kernel.
- Database or distributed TaskSpace storage.
- Changing FlowRunCheckpoint into the TaskSpace owner.

## Verification

State-machine/property tests, forest integrity, competing claims, heartbeat/expiry/attempt recovery, idempotent settlement, terminal immutability, history/artifact readback, crash recovery, path boundaries, BP compatibility, exact package closure and fresh consumer.
