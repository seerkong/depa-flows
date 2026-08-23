import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkCtrlFlowRuntime } from 'work-ctrl-flow-contract';
import { createWorkCtrlFlowEngineFromDirectory } from '../src/filesystem.js';
import { FileWorkCtrlFlowStore } from '../src/stores.js';

function writeBundle(bundleDir: string, manifest: string): void {
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'manifest.xnl'), manifest);
  fs.writeFileSync(
    path.join(bundleDir, 'flow-code.ts'),
    `
      export function markLiveRevision(runtime, input) {
        runtime.liveRevisionCalls.count += 1;
        return input;
      }
    `,
  );
}

function manifest(nodes: string): string {
  return `<WorkCtrlFlow #test.DefinitionInstanceRunBaseline apiVersion="depa.flows/v1" version="1" (
    <FlowContract #test.DefinitionInstanceRunBaseline>
  ) [
    ${nodes}
  ]>`;
}

describe('current Definition/Instance/Run persistence baseline', () => {
  it('characterizes fresh resume compiling the changed live definition instead of the materialized copy', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-live-definition-baseline-'));
    const bundleDir = path.join(root, 'definition');
    const instancesDir = path.join(root, 'instances');
    const store = new FileWorkCtrlFlowStore(path.join(root, 'snapshots'));
    const treeId = 'live-definition-resume';
    const liveRevisionCalls = { count: 0 };
    const runtime: WorkCtrlFlowRuntime = { liveRevisionCalls };

    writeBundle(
      bundleDir,
      manifest('<ExternalJob #hold { signalKind = "job.completed" signalKey = "hold" }>'),
    );
    const waiting = await createWorkCtrlFlowEngineFromDirectory({
      bundleDir,
      instancesDir,
      store,
      runtime,
    }).start(treeId);

    expect(waiting.status).toBe('Waiting');
    const frozenManifest = path.join(instancesDir, treeId, 'manifest.xnl');
    expect(fs.readFileSync(frozenManifest, 'utf8')).not.toContain('#from-live-revision');

    writeBundle(
      bundleDir,
      manifest(`
        <ExternalJob #hold { signalKind = "job.completed" signalKey = "hold" }>
        <Run #from-live-revision { src = "vfs://./flow-code.ts#markLiveRevision" }>
      `),
    );

    const handle = waiting.openWaitHandles[0];
    const completed = await createWorkCtrlFlowEngineFromDirectory({
      bundleDir,
      instancesDir,
      store,
      runtime,
    }).resume(treeId, {
      signalKind: handle.signalKind,
      signalKey: handle.signalKey,
      resumeToken: handle.resumeToken,
    });

    expect(completed.status).toBe('Completed');
    expect(liveRevisionCalls.count).toBe(1);
    expect(fs.readFileSync(frozenManifest, 'utf8')).not.toContain('#from-live-revision');
  });

  it('characterizes a flat snapshot as insufficient for fresh reconstruction without a definition bundle', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-flat-snapshot-baseline-'));
    const bundleDir = path.join(root, 'definition');
    const unavailableBundleDir = path.join(root, 'definition-unavailable');
    const snapshotDir = path.join(root, 'snapshots');
    const store = new FileWorkCtrlFlowStore(snapshotDir);
    const treeId = 'flat-snapshot-only';

    writeBundle(
      bundleDir,
      manifest('<ExternalJob #hold { signalKind = "job.completed" signalKey = "hold" }>'),
    );
    const waiting = await createWorkCtrlFlowEngineFromDirectory({
      bundleDir,
      store,
      runtime: {},
    }).start(treeId);

    expect(waiting.status).toBe('Waiting');
    expect(fs.readdirSync(snapshotDir)).toEqual([`${treeId}.snapshot.json`]);

    const snapshot = JSON.parse(
      fs.readFileSync(path.join(snapshotDir, `${treeId}.snapshot.json`), 'utf8'),
    ) as Record<string, unknown>;
    expect(snapshot.treeId).toBe(treeId);
    expect(snapshot).not.toHaveProperty('definitionRevision');
    expect(snapshot).not.toHaveProperty('instanceId');
    expect(snapshot).not.toHaveProperty('runId');
    expect(snapshot).not.toHaveProperty('definition');

    fs.renameSync(bundleDir, unavailableBundleDir);

    expect(() =>
      createWorkCtrlFlowEngineFromDirectory({
        bundleDir,
        store: new FileWorkCtrlFlowStore(snapshotDir),
        runtime: {},
      }),
    ).toThrow();
    expect(await store.load(treeId)).toBeDefined();
  });
});
