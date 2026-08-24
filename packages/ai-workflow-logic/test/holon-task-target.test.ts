import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalHolonEffectiveSnapshotBytes,
  canonicalHolonEffectiveSnapshotIssuanceReceiptBytes,
  computeHolonEffectiveSnapshotTreeDigest,
  validateHolonEffectiveSnapshotIssuanceReceipt,
  type HolonEffectiveSnapshotTree,
} from 'holarchy-core-contract';
import {
  holonTaskTargetFromNodeConfig,
  normalizeHolonTaskTarget,
  type HolonTaskTarget,
} from 'ai-workflow-contract';
import { createHolonTaskSpace } from '../src/holon-task.js';
import {
  observeAICtrlHolonTask,
  openAICtrlHolonTask,
  replanAICtrlHolonTask,
} from '../../ai-ctrl-workflow-logic/src/index.js';
import { consumeAIDataHolonTask } from '../../ai-data-workflow-logic/src/index.js';
import {
  AIWorkflowRunResourceFreezeError,
  assertFrozenHolonTaskTarget,
  freezeAIWorkflowHolonTaskTarget,
  projectFrozenHolonTaskTarget,
} from '../src/run-freeze.js';
import { claimTask, InMemoryTaskSpaceOwner, settleTask, startTask } from 'task-manager-logic';
import { FileTaskSpaceOwner, taskArtifactBodyFromBytes } from '../../task-manager-file-support/src/index.js';
import { composeLayeredResourceRegistry, createResourceContentIdentity, sha256Digest, type EffectiveResourceRegistry, type ResourceContentIdentity, type ResourceRecord } from 'halfcode-compiler.xnl/resource-core';

const digest = `sha256:${'1'.repeat(64)}` as const;
const target = (): HolonTaskTarget => normalizeHolonTaskTarget({
  kind: 'holon-task-target',
  schemaVersion: 'ai-workflow.holon-task-target/v1',
  invocation: {
    workflowKind: 'AICtrlWorkflow',
    workflowRef: 'resource://workflow.review',
    nodeId: 'delegate-review',
    invocationId: 'review-1',
  },
  holon: {
    rootHolonRef: 'holon-review-team',
    effectiveAt: '2026-01-01T00:00:00.000Z',
  },
  executionBinding: {
    ref: 'resource://binding.review-team',
    digest,
  },
  taskSpace: {
    profileRef: 'resource://task-profile.review',
    policyRef: 'resource://task-policy.review',
    requiredRoleRefs: ['role-reviewer'],
    requiredCapabilityRefs: ['resource://capability.requirements-review'],
  },
  output: {
    schemaRef: 'resource://schema.review-result',
    materialPortRefs: ['resource://port.review-result'],
  },
});

async function issuedSnapshot(input: Readonly<{
  effectiveAt?: string;
  snapshotId?: string;
  sourceRevision?: string;
}> = {}) {
  const created = { createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'test' };
  const selected = {
    ...created,
    effectiveDate: '2026-01-01',
    effectiveState: true as const,
    changeSetId: 'test',
  };
  const tree: HolonEffectiveSnapshotTree = {
    apiVersion: 'holon.workbench/v1',
    kind: 'HolonEffectiveSnapshot',
    snapshotId: input.snapshotId ?? 'snapshot-review-team',
    rootHolonRef: 'holon-review-team',
    effectiveAt: input.effectiveAt ?? '2026-01-01T00:00:00.000Z',
    sourceRevision: input.sourceRevision ?? 'revision-1',
    records: [
      { kind: 'OrganizationalSubject', id: 'subject-review-team', subjectType: 'holon' },
      { kind: 'Holon', id: 'holon-review-team', subjectId: 'subject-review-team', code: 'review-team', ...created },
      { kind: 'HolonVersion', id: 'holon-review-team:v1', holonId: 'holon-review-team', name: 'Review Team', purpose: 'Review', boundary: 'Requirements', sequence: 1, ...selected },
      { kind: 'OrganizationalSubject', id: 'subject-reviewer', subjectType: 'member' },
      { kind: 'Member', id: 'member-reviewer', subjectId: 'subject-reviewer', ...created },
      { kind: 'MemberVersion', id: 'member-reviewer:v1', memberId: 'member-reviewer', displayName: 'Reviewer', principalKind: 'ai', sequence: 2, ...selected },
      { kind: 'HolonMembership', id: 'membership-reviewer', ...created },
      { kind: 'HolonMembershipVersion', id: 'membership-reviewer:v1', membershipId: 'membership-reviewer', parentHolonId: 'holon-review-team', subjectId: 'subject-reviewer', mode: 'primary', sequence: 3, ...selected },
      { kind: 'Role', id: 'role-reviewer', holonId: 'holon-review-team', ...created },
      { kind: 'RoleVersion', id: 'role-reviewer:v1', roleId: 'role-reviewer', name: 'Reviewer', purpose: 'Review', domains: ['requirements'], accountabilities: ['review'], policies: [], capabilityRequirements: ['requirements-review'], sequence: 4, ...selected },
      { kind: 'RoleAssignment', id: 'assignment-reviewer', ...created },
      { kind: 'RoleAssignmentVersion', id: 'assignment-reviewer:v1', roleAssignmentId: 'assignment-reviewer', membershipId: 'membership-reviewer', roleId: 'role-reviewer', sequence: 5, ...selected },
    ],
  };
  const snapshot = Object.freeze({ ...tree, treeDigest: await computeHolonEffectiveSnapshotTreeDigest(tree) });
  const issuanceReceipt = validateHolonEffectiveSnapshotIssuanceReceipt({
    snapshotRef: snapshot.snapshotId,
    sourceAuthorityId: 'holarchy-file-xnl-test',
    sourceRevision: snapshot.sourceRevision,
    effectiveAt: snapshot.effectiveAt,
    treeDigest: snapshot.treeDigest,
    issuedAt: '2026-01-01T00:00:01.000Z',
  }, snapshot);
  return {
    snapshotBytes: await canonicalHolonEffectiveSnapshotBytes(snapshot),
    issuanceReceiptBytes: canonicalHolonEffectiveSnapshotIssuanceReceiptBytes(issuanceReceipt, snapshot),
  };
}

describe('Holon task target and TaskSpace snapshot admission', () => {
  test('normalizes closed target data without Member or Agent preselection', () => {
    const normalized = target();
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.taskSpace.requiredRoleRefs)).toBe(true);
    expect('memberRef' in normalized).toBe(false);
    expect('agentSelector' in normalized).toBe(false);
    expect('path' in normalized).toBe(false);
  });

  test('rejects paths, preselection fields and programmatic accessor data without running getters', () => {
    expect(() => normalizeHolonTaskTarget({ ...target(), path: '/tmp/holon' })).toThrow('Unsupported field');
    expect(() => normalizeHolonTaskTarget({ ...target(), memberRef: 'member-reviewer' })).toThrow('Unsupported field');
    let calls = 0;
    const accessor = { ...target() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'agentSelector', {
      enumerable: true,
      get() { calls += 1; return { byInstanceName: 'reviewer' }; },
    });
    expect(() => normalizeHolonTaskTarget(accessor)).toThrow('accessor');
    expect(calls).toBe(0);
  });

  test('stores canonical issuer bytes as TaskSpace artifacts and binds one snapshot receipt', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const issued = await issuedSnapshot();
    const result = await createHolonTaskSpace({
      taskManager: { owner },
      organizationSnapshots: { async readEffectiveSnapshot() { return issued; } },
    }, {
      commandId: 'create-review-task-space',
      taskSpaceId: 'space-review-1',
      taskId: 'review-task',
      taskName: 'Review requirements',
      target: target(),
      createdAt: '2026-01-01T00:00:02.000Z',
    }, {
      maxTasks: 16,
      maxRelations: 32,
      maxLeaseDurationMs: 60_000,
    });

    expect(result.snapshot.revision).toBe(0);
    expect(result.snapshotReceipt).toMatchObject({
      taskSpaceId: 'space-review-1',
      holonRef: 'holon-review-team',
      holonSnapshotRef: 'snapshot-review-team',
      executionBindingDigest: digest,
      eligibleMemberRefs: ['member-reviewer'],
      eligibleRoleRefs: ['role-reviewer'],
    });
    const task = result.snapshot.tasks[0]!;
    expect(task.profile.profileKind).toBe('depa.ai.organization-task');
    expect(task.profile.facts.snapshotReceipt).toEqual(result.snapshotReceipt);
    expect(task.definition.inputArtifacts).toHaveLength(2);
    for (const ref of task.definition.inputArtifacts) {
      expect(await owner.readArtifact('space-review-1', ref.digest)).toMatchObject({
        digest: ref.digest,
        mediaType: ref.mediaType,
        sizeBytes: ref.sizeBytes,
      });
    }
  });

  test('fails before TaskSpace mutation when issuer bytes do not bind the target', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const issued = await issuedSnapshot();
    const mismatched = normalizeHolonTaskTarget({
      ...target(),
      holon: { rootHolonRef: 'holon-other', effectiveAt: '2026-01-01T00:00:00.000Z' },
    });
    await expect(createHolonTaskSpace({
      taskManager: { owner },
      organizationSnapshots: { async readEffectiveSnapshot() { return issued; } },
    }, {
      commandId: 'create-mismatch',
      taskSpaceId: 'space-mismatch',
      taskId: 'review-task',
      taskName: 'Review requirements',
      target: mismatched,
      createdAt: '2026-01-01T00:00:02.000Z',
    }, { maxTasks: 16, maxRelations: 32, maxLeaseDurationMs: 60_000 })).rejects.toThrow('SNAPSHOT_TARGET_MISMATCH');
    expect(await owner.readSnapshot('space-mismatch')).toBeUndefined();
  });

  test('reads the same closed target from Ctrl/Data node config and binds it to node identity', () => {
    const ctrl = target();
    expect(holonTaskTargetFromNodeConfig({ holonTaskTarget: ctrl, localSetting: true }, {
      workflowKind: 'AICtrlWorkflow',
      workflowRef: 'resource://workflow.review',
      nodeId: 'delegate-review',
    })).toEqual(ctrl);
    expect(holonTaskTargetFromNodeConfig({ localSetting: true }, {
      workflowKind: 'AICtrlWorkflow',
      workflowRef: 'resource://workflow.review',
      nodeId: 'delegate-review',
    })).toBeUndefined();
    expect(() => holonTaskTargetFromNodeConfig({ holonTaskTarget: ctrl }, {
      workflowKind: 'AIDataWorkflow',
      workflowRef: 'resource://workflow.review',
      nodeId: 'delegate-review',
    })).toThrow('authored node');
  });

  test('freezes exact target closure and rejects forged proof or missing members', () => {
    const frozen = targetFreezeFixture();
    const receipt = freezeAIWorkflowHolonTaskTarget(frozen);
    const proof = projectFrozenHolonTaskTarget(receipt);
    expect(proof.target).toBe(receipt.target);
    expect(proof.closureResourceIds).toEqual([
      'binding.review-team',
      'capability.requirements-review',
      'port.review-result',
      'schema.review-result',
      'task-policy.review',
      'task-profile.review',
      'workflow.review',
    ]);
    expect(assertFrozenHolonTaskTarget(proof)).toBe(proof);
    expect(() => assertFrozenHolonTaskTarget({ ...proof })).toThrow(AIWorkflowRunResourceFreezeError);

    const missing = targetFreezeFixture('port.review-result');
    try {
      freezeAIWorkflowHolonTaskTarget(missing);
      throw new Error('expected missing closure to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AIWorkflowRunResourceFreezeError);
      expect((error as AIWorkflowRunResourceFreezeError).diagnostics.map(({ code }) => code))
        .toContain('AI_RUN_HOLON_TARGET_CLOSURE_MISSING');
    }
  });

  test('Ctrl create/reference/wait/settle consumes exact TaskSpace receipts idempotently', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const issued = await issuedSnapshot();
    const runtime = {
      taskManager: { owner },
      organizationSnapshots: { async readEffectiveSnapshot() { return issued; } },
    };
    const proof = projectFrozenHolonTaskTarget(freezeAIWorkflowHolonTaskTarget(targetFreezeFixture()));
    const openInput = {
      frozenTarget: proof,
      commandId: 'ctrl-open-review',
      taskSpaceId: 'space-ctrl-review',
      taskId: 'review-task',
      taskName: 'Review requirements',
      createdAt: '2026-01-01T00:00:02.000Z',
    } as const;
    const config = { maxTasks: 16, maxRelations: 32, maxLeaseDurationMs: 60_000 };
    expect((await openAICtrlHolonTask(runtime, openInput, config)).created).toBe(true);
    expect((await openAICtrlHolonTask(runtime, openInput, config)).created).toBe(false);
    expect(await observeAICtrlHolonTask(runtime, {
      taskSpaceId: openInput.taskSpaceId,
      taskId: openInput.taskId,
      settlementCommandId: 'ctrl-settle-review',
    }, {})).toMatchObject({ kind: 'waiting', observedRevision: 0 });

    const claimed = await claimTask(runtime.taskManager, {
      kind: 'task.claim', commandId: 'ctrl-claim-review', taskSpaceId: openInput.taskSpaceId,
      expectedRevision: 0, taskId: openInput.taskId, assigneeRef: 'member-runtime://reviewer',
      claimedAt: '2026-01-01T00:00:03.000Z', leaseDurationMs: 60_000,
    }, config);
    const started = await startTask(runtime.taskManager, {
      kind: 'task.start', commandId: 'ctrl-start-review', taskSpaceId: openInput.taskSpaceId,
      expectedRevision: claimed.snapshot.revision, claim: claimed.receipt.claim,
      occurredAt: '2026-01-01T00:00:04.000Z',
    }, config);
    await settleTask(runtime.taskManager, {
      kind: 'task.settle', commandId: 'ctrl-settle-review', taskSpaceId: openInput.taskSpaceId,
      expectedRevision: started.snapshot.revision, claim: claimed.receipt.claim,
      occurredAt: '2026-01-01T00:00:05.000Z', outputArtifacts: [], result: { approved: true },
    }, config);
    const observed = await observeAICtrlHolonTask(runtime, {
      taskSpaceId: openInput.taskSpaceId,
      taskId: openInput.taskId,
      settlementCommandId: 'ctrl-settle-review',
    }, {});
    expect(observed).toMatchObject({ kind: 'settled', receipt: { status: 'Succeeded' }, task: { status: 'Succeeded' } });
    expect(await observeAICtrlHolonTask(runtime, {
      taskSpaceId: openInput.taskSpaceId,
      taskId: openInput.taskId,
      settlementCommandId: 'ctrl-settle-review',
    }, {})).toEqual(observed);
  });

  test('Ctrl organization-only replan retains old terminal facts and adopts a new snapshot in a successor task', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const first = await issuedSnapshot();
    const second = await issuedSnapshot({
      effectiveAt: '2026-01-02T00:00:00.000Z',
      snapshotId: 'snapshot-review-team-v2',
      sourceRevision: 'revision-2',
    });
    const runtime = {
      taskManager: { owner },
      organizationSnapshots: {
        async readEffectiveSnapshot(input: { effectiveAt: string }) {
          return input.effectiveAt === '2026-01-02T00:00:00.000Z' ? second : first;
        },
      },
    };
    const initialProof = projectFrozenHolonTaskTarget(freezeAIWorkflowHolonTaskTarget(targetFreezeFixture()));
    await openAICtrlHolonTask(runtime, {
      frozenTarget: initialProof,
      commandId: 'ctrl-open-replan',
      taskSpaceId: 'space-ctrl-replan',
      taskId: 'review-v1',
      taskName: 'Review v1',
      createdAt: '2026-01-01T00:00:02.000Z',
    }, { maxTasks: 16, maxRelations: 32, maxLeaseDurationMs: 60_000 });
    const successorTarget = normalizeHolonTaskTarget({
      ...target(),
      holon: { rootHolonRef: 'holon-review-team', effectiveAt: '2026-01-02T00:00:00.000Z' },
    });
    const successorProof = projectFrozenHolonTaskTarget(freezeAIWorkflowHolonTaskTarget(
      targetFreezeFixture(undefined, successorTarget),
    ));
    const replanned = await replanAICtrlHolonTask(runtime, {
      frozenSuccessorTarget: successorProof,
      taskSpaceId: 'space-ctrl-replan',
      previousTaskId: 'review-v1',
      successorTaskId: 'review-v2',
      successorTaskName: 'Review v2',
      cancelCommandId: 'ctrl-cancel-v1',
      replanCommandId: 'ctrl-replan-v2',
      planId: 'plan-v2',
      replannedAt: '2026-01-02T00:00:02.000Z',
    }, { maxTasks: 16, maxRelations: 32, maxLeaseDurationMs: 60_000 });
    expect(replanned.snapshot.tasks.map(({ taskId, status }) => [taskId, status])).toEqual([
      ['review-v1', 'Cancelled'],
      ['review-v2', 'Ready'],
    ]);
    expect(replanned.adoptionReceipt).toMatchObject({
      previousTaskId: 'review-v1', successorTaskId: 'review-v2',
      successorIssuerReceiptId: replanned.successorSnapshotReceipt.issuerReceiptId,
    });
    expect(replanned.snapshot.tasks[1]!.profile.facts.snapshotAdoptions).toEqual([replanned.adoptionReceipt]);
    expect(replanned.snapshot.tasks[0]!.profile.facts.snapshotReceipt)
      .not.toEqual(replanned.snapshot.tasks[1]!.profile.facts.snapshotReceipt);

    const otherTarget = normalizeHolonTaskTarget({
      ...successorTarget,
      executionBinding: { ref: 'resource://binding.other', digest },
    });
    const otherProof = projectFrozenHolonTaskTarget(freezeAIWorkflowHolonTaskTarget(
      targetFreezeFixture(undefined, otherTarget),
    ));
    await expect(replanAICtrlHolonTask(runtime, {
      frozenSuccessorTarget: otherProof,
      taskSpaceId: 'space-ctrl-replan',
      previousTaskId: 'review-v2',
      successorTaskId: 'review-v3',
      successorTaskName: 'Review v3',
      cancelCommandId: 'ctrl-cancel-v2',
      replanCommandId: 'ctrl-replan-v3',
      planId: 'plan-v3',
      replannedAt: '2026-01-03T00:00:02.000Z',
    }, { maxTasks: 16, maxRelations: 32, maxLeaseDurationMs: 60_000 }))
      .rejects.toThrow('SUCCESSOR_INSTANCE_REQUIRED');
    expect((await owner.readSnapshot('space-ctrl-replan'))?.revision).toBe(replanned.snapshot.revision);
  });

  test('Data fresh reconstruction consumes only exact settlement material and TaskSpace receipts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'depa-holon-data-task-'));
    try {
      const owner = new FileTaskSpaceOwner({ root });
      const issued = await issuedSnapshot();
      const runtime = {
        taskManager: { owner },
        organizationSnapshots: { async readEffectiveSnapshot() { return issued; } },
      };
      const proof = projectFrozenHolonTaskTarget(freezeAIWorkflowHolonTaskTarget(targetFreezeFixture()));
      const config = { maxTasks: 16, maxRelations: 32, maxLeaseDurationMs: 60_000 };
      await openAICtrlHolonTask(runtime, {
        frozenTarget: proof,
        commandId: 'data-open-review',
        taskSpaceId: 'space-data-review',
        taskId: 'review-task',
        taskName: 'Review requirements',
        createdAt: '2026-01-01T00:00:02.000Z',
      }, config);
      const claimed = await claimTask(runtime.taskManager, {
        kind: 'task.claim', commandId: 'data-claim-review', taskSpaceId: 'space-data-review',
        expectedRevision: 0, taskId: 'review-task', assigneeRef: 'member-runtime://reviewer',
        claimedAt: '2026-01-01T00:00:03.000Z', leaseDurationMs: 60_000,
      }, config);
      const started = await startTask(runtime.taskManager, {
        kind: 'task.start', commandId: 'data-start-review', taskSpaceId: 'space-data-review',
        expectedRevision: claimed.snapshot.revision, claim: claimed.receipt.claim,
        occurredAt: '2026-01-01T00:00:04.000Z',
      }, config);
      const body = taskArtifactBodyFromBytes(
        new TextEncoder().encode(JSON.stringify({ approved: true, summary: 'accepted' })),
        'application/json',
      );
      const artifact = Object.freeze({
        kind: 'task-artifact-ref' as const,
        digest: body.digest,
        mediaType: body.mediaType,
        sizeBytes: body.sizeBytes,
        name: 'resource://port.review-result',
      });
      await settleTask(runtime.taskManager, {
        kind: 'task.settle', commandId: 'data-settle-review', taskSpaceId: 'space-data-review',
        expectedRevision: started.snapshot.revision, claim: claimed.receipt.claim,
        occurredAt: '2026-01-01T00:00:05.000Z', outputArtifacts: [artifact], artifactBodies: [body],
      }, config);

      let validationCalls = 0;
      const freshRuntime = {
        taskManager: { owner: new FileTaskSpaceOwner({ root }) },
        materials: {
          async validateSettlementMaterial(input: {
            schemaRef: string;
            materials: readonly { materialPortRef: string; body: { data: string } }[];
          }) {
            validationCalls += 1;
            expect(input.schemaRef).toBe('resource://schema.review-result');
            expect(input.materials.map(({ materialPortRef }) => materialPortRef))
              .toEqual(['resource://port.review-result']);
            return JSON.parse(Buffer.from(input.materials[0]!.body.data, 'base64').toString('utf8'));
          },
        },
      };
      const result = await consumeAIDataHolonTask(freshRuntime, {
        frozenTarget: proof,
        taskSpaceId: 'space-data-review',
        taskId: 'review-task',
        settlementCommandId: 'data-settle-review',
      }, {});
      expect(result).toMatchObject({
        kind: 'ai-data-holon-task-settlement',
        taskSpaceId: 'space-data-review',
        taskId: 'review-task',
        materialDigests: [body.digest],
        output: { approved: true, summary: 'accepted' },
      });
      expect(validationCalls).toBe(1);
      expect(Object.isFrozen(result.output)).toBe(true);
      await expect(consumeAIDataHolonTask({
        taskManager: freshRuntime.taskManager,
        materials: {
          async validateSettlementMaterial() {
            throw new Error('MESSAGE_SCHEMA_VALIDATION_FAILED');
          },
        },
      }, {
        frozenTarget: proof,
        taskSpaceId: 'space-data-review',
        taskId: 'review-task',
        settlementCommandId: 'data-settle-review',
      }, {})).rejects.toThrow('MESSAGE_SCHEMA_VALIDATION_FAILED');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function targetFreezeFixture(omit?: string, targetInput: HolonTaskTarget = target()) {
  const kinds: Record<string, string> = {
    'workflow.review': 'AICtrlWorkflow',
    'binding.review-team': 'HolonExecutionBinding',
    'binding.other': 'HolonExecutionBinding',
    'task-profile.review': 'HolonTaskProfile',
    'task-policy.review': 'HolonTaskPolicy',
    'capability.requirements-review': 'Capability',
    'schema.review-result': 'MessageSchema',
    'port.review-result': 'MaterialPort',
  };
  const records = Object.entries(kinds)
    .filter(([resourceId]) => resourceId !== omit)
    .map(([resourceId, kind]) => resourceRecord(resourceId, kind));
  const identities = new Map(records.map((record) => [record.resourceId, contentIdentity(record)]));
  const bindingId = targetInput.executionBinding.ref.slice('resource://'.length);
  const targetValue = normalizeHolonTaskTarget({
    ...targetInput,
    executionBinding: {
      ref: targetInput.executionBinding.ref,
      digest: identities.get(bindingId)!.contentDigest,
    },
  });
  return {
    registry: effectiveRegistry(records),
    target: targetValue,
    contentIdentities: identities,
  };
}

function resourceRecord(resourceId: string, kind: string): ResourceRecord {
  return {
    resourceId,
    kind,
    metadata: { apiVersion: 'eidolon.ai/v1', version: '1.0.0' },
    sourceShape: 'single-file',
    logicalPath: `${resourceId}.xnl`,
    documentUri: `vfs://@/${resourceId}.xnl`,
    format: 'xnl',
    node: { tag: kind, resourceId, metadata: {}, properties: {}, body: [], subdomains: {} },
  };
}

function contentIdentity(record: ResourceRecord): ResourceContentIdentity {
  return createResourceContentIdentity({
    resourceId: record.resourceId,
    authorityDigest: sha256Digest(record.resourceId),
    contributions: [{ key: 'resource', digest: sha256Digest(JSON.stringify(record)), sourceUri: record.documentUri }],
  });
}

function effectiveRegistry(records: readonly ResourceRecord[]): EffectiveResourceRegistry {
  const byKind = new Map<string, ResourceRecord[]>();
  for (const record of records) {
    byKind.set(record.kind, [...(byKind.get(record.kind) ?? []), record]);
  }
  const manifest = resourceRecord('fixture.package', 'ResourcePackage');
  return composeLayeredResourceRegistry({
    layers: [{
      id: 'test',
      tree: {
        manifest,
        registry: { byKind, kindDefinitions: new Map() },
        diagnostics: [],
      },
    }],
  });
}
