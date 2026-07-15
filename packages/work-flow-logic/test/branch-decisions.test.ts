import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BranchDecision, WorkFlowRuntime, WorkFlowStore } from 'work-flow-contract';
import { createWorkFlowEngineFromDirectory } from '../src/filesystem.js';
import { FileWorkFlowStore, InMemoryWorkFlowStore } from '../src/stores.js';

function makeBundle(branches: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-decisions-bundle-'));
  fs.writeFileSync(
    path.join(dir, 'manifest.xnl'),
    `<WorkFlow #test.BranchDecisions apiVersion="depa.flows/v1" version="1" (
      <FlowContract #test.BranchDecisions>
    ) [
      <If #route (
        <Branches [${branches}]>
      )>
      <Return #done>
    ]>`,
  );
  fs.writeFileSync(
    path.join(dir, 'flow-code.ts'),
    `
      export function predicate(runtime) {
        runtime.predicateCalls.count += 1;
        return runtime.matches;
      }

      export async function observePersistedDecision(runtime, input) {
        const snapshot = await runtime.store.load(runtime.treeId);
        runtime.decisionSeenByBody = snapshot?.branchDecisions?.['route#0'];
        return input;
      }
    `,
  );
  return dir;
}

function runtime(
  store: WorkFlowStore,
  treeId: string,
  predicateCalls: { count: number },
  matches: boolean,
): WorkFlowRuntime {
  return { store, treeId, predicateCalls, matches };
}

describe('persisted If branch decisions', () => {
  it('persists the selected branch before entering its body and reuses it on resume', async () => {
    const store = new InMemoryWorkFlowStore();
    const treeId = 'selected-branch';
    const predicateCalls = { count: 0 };
    const flowRuntime = runtime(store, treeId, predicateCalls, true);
    const engine = createWorkFlowEngineFromDirectory({
      bundleDir: makeBundle(`
        <Branch #selected { when = "vfs://./flow-code.ts#predicate" } [
          <Run #observe { src = "vfs://./flow-code.ts#observePersistedDecision" }>
          <ExternalJob #hold { signalKind = "job.completed" signalKey = "hold" }>
        ]>
        <Branch #later { when = "vfs://./flow-code.ts#predicate" } []>
      `),
      instancesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-decisions-instances-')),
      store,
      runtime: flowRuntime,
    });

    const waiting = await engine.start(treeId);
    const expectedDecision: BranchDecision = {
      ifPath: 'route',
      invocationKey: 'route#0',
      kind: 'Branch',
      branchKey: 'selected',
    };
    expect(waiting.status).toBe('Waiting');
    expect(predicateCalls.count).toBe(1);
    expect(flowRuntime.decisionSeenByBody).toEqual(expectedDecision);
    expect((await store.load(treeId))!.branchDecisions['route#0']).toEqual(expectedDecision);

    const handle = waiting.openWaitHandles[0];
    const completed = await engine.resume(treeId, {
      signalKind: handle.signalKind,
      signalKey: handle.signalKey,
      resumeToken: handle.resumeToken,
    });
    expect(completed.status).toBe('Completed');
    expect(predicateCalls.count).toBe(1);
  });

  it('reuses the selected branch from a file snapshot in a fresh engine instance', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-decisions-restart-'));
    const store = new FileWorkFlowStore(path.join(root, 'snapshots'));
    const treeId = 'restart-branch';
    const predicateCalls = { count: 0 };
    const flowRuntime = runtime(store, treeId, predicateCalls, true);
    const options = {
      bundleDir: makeBundle(`
        <Branch #selected { when = "vfs://./flow-code.ts#predicate" } [
          <ExternalJob #hold { signalKind = "job.completed" signalKey = "hold" }>
        ]>
      `),
      instancesDir: path.join(root, 'instances'),
      store,
      runtime: flowRuntime,
    };

    const waiting = await createWorkFlowEngineFromDirectory(options).start(treeId);
    expect(predicateCalls.count).toBe(1);
    const handle = waiting.openWaitHandles[0];
    const completed = await createWorkFlowEngineFromDirectory(options).resume(treeId, {
      signalKind: handle.signalKind,
      signalKey: handle.signalKey,
      resumeToken: handle.resumeToken,
    });

    expect(completed.status).toBe('Completed');
    expect(predicateCalls.count).toBe(1);
    expect((await store.load(treeId))!.branchDecisions['route#0'].branchKey).toBe('selected');
  });

  it.each([
    {
      name: 'Otherwise',
      branches: `
        <Branch #never { when = "vfs://./flow-code.ts#predicate" } []>
        <Otherwise #fallback []>
      `,
      expected: { kind: 'Otherwise', branchKey: 'fallback' },
    },
    {
      name: 'NoMatch',
      branches: `<Branch #never { when = "vfs://./flow-code.ts#predicate" } []>`,
      expected: { kind: 'NoMatch' },
    },
  ])('records an explicit $name decision', async ({ branches, expected }) => {
    const store = new InMemoryWorkFlowStore();
    const treeId = `decision-${expected.kind}`;
    const predicateCalls = { count: 0 };
    const engine = createWorkFlowEngineFromDirectory({
      bundleDir: makeBundle(branches),
      instancesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-decisions-instances-')),
      store,
      runtime: runtime(store, treeId, predicateCalls, false),
    });

    const outcome = await engine.start(treeId);
    expect(outcome.status).toBe('Completed');
    expect(predicateCalls.count).toBe(1);
    expect((await store.load(treeId))!.branchDecisions['route#0']).toEqual({
      ifPath: 'route',
      invocationKey: 'route#0',
      ...expected,
    });
  });
});
