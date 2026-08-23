import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FlowDefinitionProvenance } from 'work-ctrl-flow-contract';
import {
  computeFlowBundleDigest,
  createMaterializedWorkCtrlFlowEngineFromDirectory,
  readFlowInstanceDescriptor,
} from '../src/filesystem.js';
import { FileWorkCtrlFlowStore } from '../src/stores.js';

const provenance: FlowDefinitionProvenance = {
  authority: 'resource-package',
  artifactRef: 'resource://depa.flows.test.MaterializedWorkflow',
  metadata: { packageRevision: 'package-r1' },
};

function writeDefinition(bundleDir: string, revision: 'R1' | 'R2'): void {
  fs.mkdirSync(path.join(bundleDir, 'actions'), { recursive: true });
  fs.mkdirSync(path.join(bundleDir, 'assets', 'nested'), { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, 'manifest.xnl'),
    `<WorkCtrlFlow #test.MaterializedWorkflow apiVersion="depa.flows/v1" version="${revision}" (
      <FlowContract #test.MaterializedWorkflow>
    ) [
      <Run #before { src = "vfs://./actions/flow.ts#before" }>
      <ExternalJob #hold { signalKind = "job.completed" signalKey = "hold" }>
      <Run #after { src = "vfs://./actions/flow.ts#after" }>
    ]>`,
  );
  fs.writeFileSync(
    path.join(bundleDir, 'state.seed.xnl'),
    `<StateSeed #test.MaterializedWorkflowState { seedRevision = "${revision}" attempts = 0 }>`,
  );
  fs.writeFileSync(
    path.join(bundleDir, 'actions', 'flow.ts'),
    `
      export function before(runtime, input) {
        runtime.observe("${revision}-before");
        return input;
      }
      export function after(runtime, input) {
        runtime.observe("${revision}-after");
        return input;
      }
    `,
  );
  fs.writeFileSync(path.join(bundleDir, 'assets', 'nested', 'context.txt'), `context-${revision}\n`);
}

function createFixture(revision: 'R1' | 'R2' = 'R1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-materialized-engine-'));
  const bundleDir = path.join(root, 'definition');
  const instancesDir = path.join(root, 'instances');
  const snapshotsDir = path.join(root, 'snapshots');
  writeDefinition(bundleDir, revision);
  return { root, bundleDir, instancesDir, snapshotsDir };
}

function engineFor(options: {
  bundleDir?: string;
  instancesDir: string;
  snapshotsDir: string;
  instanceId: string;
  revision?: string;
  expectedDigest?: `sha256:${string}`;
  events: string[];
  onObserve?: (event: string) => void;
}) {
  return createMaterializedWorkCtrlFlowEngineFromDirectory({
    bundleDir: options.bundleDir,
    instancesDir: options.instancesDir,
    instanceId: options.instanceId,
    source: options.revision
      ? {
          revision: options.revision,
          provenance,
          ...(options.expectedDigest === undefined ? {} : { expectedDigest: options.expectedDigest }),
        }
      : undefined,
    store: new FileWorkCtrlFlowStore(options.snapshotsDir),
    runtime: { observe: (event: string) => {
      options.onObserve?.(event);
      options.events.push(event);
    } },
    clock: { now: () => 1_800_000_000_000 },
  });
}

describe('materialized WorkCtrlFlow directory engine', () => {
  test('persists an unexecuted run snapshot before the first node and resumes it in a fresh engine', async () => {
    const fixture = createFixture('R1');
    const durableStore = new FileWorkCtrlFlowStore(fixture.snapshotsDir);
    let interruptAfterFirstCommit = true;
    const store = {
      load: (treeId: string) => durableStore.load(treeId),
      async save(snapshot: Parameters<typeof durableStore.save>[0]) {
        await durableStore.save(snapshot);
        if (interruptAfterFirstCommit) {
          interruptAfterFirstCommit = false;
          throw new Error('commit acknowledgement deferred');
        }
      },
      remove: (treeId: string) => durableStore.remove(treeId),
    };
    const events: string[] = [];
    const first = createMaterializedWorkCtrlFlowEngineFromDirectory({
      bundleDir: fixture.bundleDir,
      instancesDir: fixture.instancesDir,
      instanceId: 'pre-node-instance',
      source: { revision: 'R1', provenance },
      store,
      runtime: { observe: (event: string) => events.push(event) },
    });

    await expect(first.start('pre-node-run')).rejects.toThrow('commit acknowledgement deferred');
    const unexecuted = (await durableStore.load('pre-node-run'))!;
    expect(unexecuted.lastTickNo).toBe(0);
    expect(unexecuted.nodeResults).toEqual({});
    expect(events).toEqual([]);

    const recovered = await createMaterializedWorkCtrlFlowEngineFromDirectory({
      instancesDir: fixture.instancesDir,
      instanceId: 'pre-node-instance',
      store: durableStore,
      runtime: { observe: (event: string) => events.push(event) },
    }).refresh('pre-node-run');
    expect(recovered.status).toBe('Waiting');
    expect(recovered.tickNo).toBe(1);
    expect(events).toEqual(['R1-before']);
  });

  test('admits a complete verified bundle before execution and isolates R1/R2 instances', async () => {
    const fixture = createFixture('R1');
    const eventsA: string[] = [];
    const digestR1 = computeFlowBundleDigest(fixture.bundleDir);
    const instanceA = path.join(fixture.instancesDir, 'instance-a');
    let observedAfterAdmission = false;
    const engineA = engineFor({
      ...fixture,
      instanceId: 'instance-a',
      revision: 'R1',
      expectedDigest: digestR1,
      events: eventsA,
      onObserve: () => {
        expect(fs.existsSync(path.join(instanceA, 'instance.json'))).toBe(true);
        expect(fs.existsSync(path.join(instanceA, 'definition', 'manifest.xnl'))).toBe(true);
        observedAfterAdmission = true;
      },
    });

    const waitingA = await engineA.start('run-a-1');
    expect(observedAfterAdmission).toBe(true);
    expect(eventsA).toEqual(['R1-before']);
    expect(fs.existsSync(path.join(instanceA, 'instance.json'))).toBe(true);
    expect(fs.readFileSync(path.join(instanceA, 'definition', 'assets', 'nested', 'context.txt'), 'utf8'))
      .toBe('context-R1\n');
    expect(readFlowInstanceDescriptor(instanceA).definition).toEqual({
      revision: 'R1',
      digest: digestR1,
      provenance,
    });

    writeDefinition(fixture.bundleDir, 'R2');
    const digestR2 = computeFlowBundleDigest(fixture.bundleDir);
    const handleA = waitingA.openWaitHandles[0];
    const resumedA = await engineFor({
      ...fixture,
      bundleDir: undefined,
      instanceId: 'instance-a',
      events: eventsA,
    }).resume('run-a-1', {
      signalKind: handleA.signalKind,
      signalKey: handleA.signalKey,
      resumeToken: handleA.resumeToken,
    });

    expect(resumedA.status).toBe('Completed');
    expect(eventsA).toEqual(['R1-before', 'R1-after']);

    const frozenOnly = engineFor({
      ...fixture,
      instanceId: 'instance-a',
      revision: 'R2',
      events: eventsA,
    });
    expect((await frozenOnly.start('run-a-1')).status).toBe('Completed');
    expect((await frozenOnly.start('run-a-2')).status).toBe('Waiting');
    expect(eventsA).toEqual(['R1-before', 'R1-after', 'R1-before']);

    const eventsB: string[] = [];
    await engineFor({
      ...fixture,
      instanceId: 'instance-b',
      revision: 'R2',
      expectedDigest: digestR2,
      events: eventsB,
    }).start('run-b-1');
    expect(eventsB).toEqual(['R2-before']);
    expect(readFlowInstanceDescriptor(path.join(fixture.instancesDir, 'instance-b')).definition.revision)
      .toBe('R2');
    expect(digestR2).not.toBe(digestR1);
  });

  test('keeps state.seed byte-identical and applies it once for every new run under one instance', async () => {
    const fixture = createFixture('R1');
    const seedBytes = fs.readFileSync(path.join(fixture.bundleDir, 'state.seed.xnl'));
    const store = new FileWorkCtrlFlowStore(fixture.snapshotsDir);
    const events: string[] = [];
    const engine = createMaterializedWorkCtrlFlowEngineFromDirectory({
      bundleDir: fixture.bundleDir,
      instancesDir: fixture.instancesDir,
      instanceId: 'shared-instance',
      source: { revision: 'R1', provenance },
      store,
      runtime: { observe: (event: string) => events.push(event) },
    });

    const first = await engine.start('run-1');
    const second = await engine.start('run-2');
    expect(first.vars.seedRevision).toBe('R1');
    expect(second.vars.seedRevision).toBe('R1');

    const firstSnapshot = (await store.load('run-1'))!;
    firstSnapshot.vars.seedRevision = 'evolved';
    await store.save(firstSnapshot);
    const firstHandle = first.openWaitHandles[0];
    const resumed = await engine.resume('run-1', {
      signalKind: firstHandle.signalKind,
      signalKey: firstHandle.signalKey,
      resumeToken: firstHandle.resumeToken,
    });

    expect(resumed.vars.seedRevision).toBe('evolved');
    expect((await store.load('run-2'))!.vars.seedRevision).toBe('R1');
    expect(fs.readFileSync(path.join(fixture.instancesDir, 'shared-instance', 'definition', 'state.seed.xnl')))
      .toEqual(seedBytes);
    expect(fs.readFileSync(path.join(fixture.bundleDir, 'state.seed.xnl'))).toEqual(seedBytes);
  });

  test('leaves no admitted instance or run when digest or schema readback fails', async () => {
    const digestFixture = createFixture('R1');
    const digestStore = new FileWorkCtrlFlowStore(digestFixture.snapshotsDir);
    const wrongDigest = `sha256:${'0'.repeat(64)}` as const;
    const digestEngine = createMaterializedWorkCtrlFlowEngineFromDirectory({
      bundleDir: digestFixture.bundleDir,
      instancesDir: digestFixture.instancesDir,
      instanceId: 'digest-mismatch',
      source: { revision: 'R1', provenance, expectedDigest: wrongDigest },
      store: digestStore,
      runtime: { observe: () => undefined },
    });

    await expect(digestEngine.start('digest-run')).rejects.toThrow();
    expect(await digestStore.load('digest-run')).toBeUndefined();
    expect(fs.existsSync(path.join(digestFixture.instancesDir, 'digest-mismatch'))).toBe(false);

    const schemaFixture = createFixture('R1');
    fs.writeFileSync(path.join(schemaFixture.bundleDir, 'manifest.xnl'), '<WorkCtrlFlow');
    const schemaStore = new FileWorkCtrlFlowStore(schemaFixture.snapshotsDir);
    const schemaEngine = createMaterializedWorkCtrlFlowEngineFromDirectory({
      bundleDir: schemaFixture.bundleDir,
      instancesDir: schemaFixture.instancesDir,
      instanceId: 'schema-mismatch',
      source: { revision: 'R1', provenance },
      store: schemaStore,
      runtime: { observe: () => undefined },
    });

    await expect(schemaEngine.start('schema-run')).rejects.toThrow();
    expect(await schemaStore.load('schema-run')).toBeUndefined();
    expect(fs.existsSync(path.join(schemaFixture.instancesDir, 'schema-mismatch'))).toBe(false);
    expect(fs.existsSync(schemaFixture.instancesDir)
      ? fs.readdirSync(schemaFixture.instancesDir).filter((name) => name.includes('.candidate-'))
      : []).toEqual([]);
  });
});
