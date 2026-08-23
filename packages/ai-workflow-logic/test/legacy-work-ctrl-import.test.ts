import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  FlowDefinitionArtifactIdentity,
  FlowRunCheckpointRuntime,
} from 'ai-workflow-contract';
import type { WorkCtrlFlowSnapshot } from '../../work-ctrl-flow-contract/src/index.js';
import {
  createCanonicalMaterializedWorkCtrlFlowEngine,
  FilesystemFlowRunCheckpointStore,
  FilesystemLegacyWorkCtrlSnapshotReader,
  LegacyWorkCtrlImportConflictError,
  convertLegacyWorkCtrlSnapshotToCheckpoint,
  importLegacyWorkCtrlSnapshot,
  type LegacyWorkCtrlImportRuntime,
} from 'ai-workflow-logic/checkpoint-filesystem';
import { commitFlowRunCheckpoint } from 'ai-workflow-logic';
import {
  FileWorkCtrlFlowStore,
  materializeFlowInstance,
} from 'work-ctrl-flow-logic';

function bundle(root: string): string {
  const source = path.join(root, 'definition-source');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'manifest.xnl'), `<WorkCtrlFlow #depa.flows.test.LegacyImport apiVersion="depa.flows/v1" version="1" (
    <FlowContract #depa.flows.test.LegacyImport>
  ) [
    <ExternalJob #approval { signalKind = "job.completed" signalKey = "approval" }>
    <Return #done>
  ]>
`);
  return source;
}

function legacySnapshot(treeId: string, status: 'Waiting' | 'Completed' = 'Completed'): WorkCtrlFlowSnapshot {
  return {
    schemaVersion: 'depa.flows.workflow/v4',
    treeId,
    fqn: 'depa.flows.test.LegacyImport',
    status,
    vars: {
      retained: 'legacy-state',
      __flow_execution__: {
        current: { result: 'ready' },
        ...(status === 'Completed' ? { output: { result: 'ready' } } : {}),
        returned: status === 'Completed',
        selections: {},
        fallbackInputs: {},
        untilIterations: {},
        untilValues: {},
      },
    },
    input: { request: 'prepare' },
    branchDecisions: {},
    nodeResults: status === 'Completed' ? { 'approval#0': 'Success', 'done#0': 'Success' } : {},
    waitResults: {},
    openWaitHandles: status === 'Waiting' ? [{
      waitHandleId: `${treeId}:approval#0:job.completed:approval`,
      treeId,
      nodeKey: 'approval',
      invocationKey: 'approval#0',
      waitKind: 'external-job',
      status: 'Open',
      signalKind: 'job.completed',
      signalKey: 'approval',
      resumeToken: 'resume-approval',
      deadlineAtMs: 0,
      metadata: { imported: true },
    }] : [],
    closedWaitHandles: [],
    appliedResumeSignals: [],
    orchestration: {
      attempts: {}, deadlines: {}, lanes: {}, winners: {}, cancellations: {}, composites: {},
    },
    lastTickNo: 1,
    updatedAtMs: 42,
  };
}

async function fixture(legacyTreeId = 'legacy-tree', status: 'Waiting' | 'Completed' = 'Completed') {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-flow-import-'));
  const legacyRoot = path.join(storeRoot, 'legacy-flat');
  const legacyStore = new FileWorkCtrlFlowStore(legacyRoot);
  await legacyStore.save(legacySnapshot(legacyTreeId, status));
  const instance = materializeFlowInstance({
    definitionDir: bundle(storeRoot),
    instancesDir: path.join(storeRoot, 'instances'),
    instanceId: 'instance-1',
    source: {
      revision: 'workflow-r1',
      provenance: {
        authority: 'resource-package',
        artifactRef: 'resource://depa.flows.test.LegacyImport',
      },
    },
    materializedAtMs: 7,
  });
  const checkpointStore = new FilesystemFlowRunCheckpointStore({ storeRoot });
  const runtime: LegacyWorkCtrlImportRuntime = {
    checkpointStore,
    legacyReader: new FilesystemLegacyWorkCtrlSnapshotReader({ legacyRoot }),
  };
  const legacyFile = path.join(legacyRoot, `${encodeURIComponent(legacyTreeId)}.snapshot.json`);
  return {
    storeRoot,
    legacyRoot,
    legacyFile,
    definition: instance.descriptor.definition,
    checkpointStore,
    runtime,
  };
}

function importInput(definition: FlowDefinitionArtifactIdentity, runId: string) {
  return {
    legacyTreeId: 'legacy-tree',
    target: { instanceId: 'instance-1', runId },
    definition,
    config: { mode: 'standard' },
  } as const;
}

describe('one-way legacy WorkCtrl snapshot import', () => {
  test('reads the existing flat snapshot explicitly without changing its bytes', async () => {
    const { runtime, legacyFile } = await fixture();
    const before = fs.readFileSync(legacyFile);
    const read = await runtime.legacyReader.read('legacy-tree');

    expect(read?.snapshot).toEqual(legacySnapshot('legacy-tree'));
    expect(read?.identity.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fs.readFileSync(legacyFile)).toEqual(before);
  });

  test('purely converts then imports version zero before recording completion', async () => {
    const { runtime, checkpointStore, definition, legacyFile, storeRoot } = await fixture();
    const before = fs.readFileSync(legacyFile);
    const read = (await runtime.legacyReader.read('legacy-tree'))!;
    const candidate = convertLegacyWorkCtrlSnapshotToCheckpoint(read.snapshot, {
      target: { instanceId: 'instance-1', runId: 'run-1' },
      definition,
      config: { mode: 'standard' },
    });
    expect(candidate).toMatchObject({
      version: 0,
      input: { request: 'prepare' },
      state: { retained: 'legacy-state' },
      output: { result: 'ready' },
      profile: { kind: 'WorkCtrlFlow', snapshot: { treeId: 'run-1' } },
    });

    const receipt = await importLegacyWorkCtrlSnapshot(runtime, importInput(definition, 'run-1'));
    expect(receipt).toMatchObject({
      schemaVersion: 'depa.flow-legacy-import-receipt/v1',
      legacyTreeId: 'legacy-tree',
      target: { instanceId: 'instance-1', runId: 'run-1' },
      acceptedCheckpointVersion: 0,
    });
    expect((await checkpointStore.load({ instanceId: 'instance-1', runId: 'run-1' }))?.profile.kind)
      .toBe('WorkCtrlFlow');
    expect(fs.existsSync(path.join(
      storeRoot, 'instances', 'instance-1', 'runs', 'run-1', 'legacy-import.receipt.json',
    ))).toBe(true);
    expect(fs.readFileSync(legacyFile)).toEqual(before);
  });

  test('resumes a waiting import signal under only the canonical target identity', async () => {
    const { runtime, definition, storeRoot, checkpointStore } = await fixture('legacy-tree', 'Waiting');
    const receipt = await importLegacyWorkCtrlSnapshot(runtime, importInput(definition, 'canonical-run'));
    expect(receipt.legacyTreeId).toBe('legacy-tree');
    const imported = await checkpointStore.load({ instanceId: 'instance-1', runId: 'canonical-run' });
    expect(imported).toMatchObject({
      version: 0,
      controllerSidecars: {
        openWaitHandles: [{
          treeId: 'canonical-run',
          waitHandleId: 'canonical-run:approval#0:job.completed:approval',
        }],
      },
      profile: {
        snapshot: {
          treeId: 'canonical-run',
          status: 'Waiting',
          openWaitHandles: [{
            treeId: 'canonical-run',
            waitHandleId: 'canonical-run:approval#0:job.completed:approval',
            resumeToken: 'resume-approval',
          }],
        },
      },
    });

    const engine = createCanonicalMaterializedWorkCtrlFlowEngine({
      storeRoot,
      instanceId: 'instance-1',
      checkpointConfig: { mode: 'standard' },
    });
    expect((await engine.resume('canonical-run', {
      signalKind: 'job.completed',
      signalKey: 'approval',
      resumeToken: 'resume-approval',
      payload: { accepted: true },
    })).status).toBe('Completed');
    const completed = await checkpointStore.load({ instanceId: 'instance-1', runId: 'canonical-run' });
    expect(completed?.version).toBeGreaterThan(0);
    expect(completed).toMatchObject({
      runId: 'canonical-run',
      profile: {
        snapshot: {
          treeId: 'canonical-run',
          openWaitHandles: [],
          closedWaitHandles: [{
            treeId: 'canonical-run',
            waitHandleId: 'canonical-run:approval#0:job.completed:approval',
            status: 'Consumed',
          }],
        },
      },
    });
    expect(fs.readdirSync(path.join(storeRoot, 'instances', 'instance-1', 'runs'))).toEqual(['canonical-run']);
  });

  test('recovers the window after checkpoint acceptance but before receipt creation', async () => {
    const { runtime, checkpointStore, definition, storeRoot } = await fixture();
    const read = (await runtime.legacyReader.read('legacy-tree'))!;
    const candidate = convertLegacyWorkCtrlSnapshotToCheckpoint(read.snapshot, {
      target: { instanceId: 'instance-1', runId: 'interrupted-run' },
      definition,
      config: { mode: 'standard' },
    });
    await commitFlowRunCheckpoint({ checkpointStore } as FlowRunCheckpointRuntime, {
      expectedVersion: null,
      checkpoint: candidate,
    });
    const receiptFile = path.join(
      storeRoot, 'instances', 'instance-1', 'runs', 'interrupted-run', 'legacy-import.receipt.json',
    );
    expect(fs.existsSync(receiptFile)).toBe(false);
    const receiptStagingFile = path.join(
      storeRoot, 'instances', 'instance-1', 'runs', 'interrupted-run', 'legacy-import.receipt.staging.json',
    );
    fs.writeFileSync(receiptStagingFile, '{partial');

    const freshRuntime: LegacyWorkCtrlImportRuntime = {
      checkpointStore: new FilesystemFlowRunCheckpointStore({ storeRoot }),
      legacyReader: new FilesystemLegacyWorkCtrlSnapshotReader({ legacyRoot: path.join(storeRoot, 'legacy-flat') }),
    };
    const receipt = await importLegacyWorkCtrlSnapshot(
      freshRuntime,
      importInput(definition, 'interrupted-run'),
    );
    expect(receipt.acceptedCheckpointVersion).toBe(0);
    expect(fs.existsSync(receiptFile)).toBe(true);
    expect(fs.existsSync(receiptStagingFile)).toBe(false);
  });

  test('returns the same receipt after canonical-only transitions and never overwrites the run', async () => {
    const { runtime, checkpointStore, definition, legacyFile } = await fixture('legacy-tree', 'Waiting');
    const before = fs.readFileSync(legacyFile);
    const first = await importLegacyWorkCtrlSnapshot(runtime, importInput(definition, 'advanced-run'));
    const current = (await checkpointStore.load({ instanceId: 'instance-1', runId: 'advanced-run' }))!;
    if (current.profile.kind !== 'WorkCtrlFlow') throw new Error('expected WorkCtrlFlow checkpoint');
    await checkpointStore.commit({
      expectedVersion: 0,
      checkpoint: {
        ...current,
        version: 1,
        state: { retained: 'canonical-state' },
        output: { result: 'canonical-result' },
        profile: {
          ...current.profile,
          snapshot: {
            ...current.profile.snapshot,
            vars: { retained: 'canonical-state' },
          },
        },
      },
    });

    const repeated = await importLegacyWorkCtrlSnapshot(runtime, importInput(definition, 'advanced-run'));
    expect(repeated).toEqual(first);
    expect(await checkpointStore.load({ instanceId: 'instance-1', runId: 'advanced-run' })).toMatchObject({
      version: 1,
      state: { retained: 'canonical-state' },
      output: { result: 'canonical-result' },
    });
    expect(fs.readFileSync(legacyFile)).toEqual(before);
  });

  test('fails closed for conflicting definition, target contents, or legacy identity', async () => {
    const { runtime, checkpointStore, definition, legacyRoot } = await fixture();
    await expect(importLegacyWorkCtrlSnapshot(runtime, importInput({
      ...definition,
      revision: 'workflow-r2',
    }, 'definition-conflict'))).rejects.toMatchObject({ code: 'flow-run-definition-mismatch' });

    const conflicting = convertLegacyWorkCtrlSnapshotToCheckpoint(legacySnapshot('legacy-tree'), {
      target: { instanceId: 'instance-1', runId: 'target-conflict' },
      definition,
      config: { mode: 'different' },
    });
    await checkpointStore.commit({ expectedVersion: null, checkpoint: conflicting });
    await expect(importLegacyWorkCtrlSnapshot(
      runtime,
      importInput(definition, 'target-conflict'),
    )).rejects.toBeInstanceOf(LegacyWorkCtrlImportConflictError);

    fs.writeFileSync(
      path.join(legacyRoot, `${encodeURIComponent('other-tree')}.snapshot.json`),
      JSON.stringify(legacySnapshot('different-tree')),
    );
    await expect(runtime.legacyReader.read('other-tree')).rejects.toMatchObject({
      code: 'legacy-work-ctrl-identity-mismatch',
    });
  });
});
