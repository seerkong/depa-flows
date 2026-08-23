import { describe, it, expect } from 'bun:test';
import path from 'node:path';
import { compareDurableLaneIds, WorkCtrlFlowEngine, WorkCtrlFlowLoadError } from '../src/engine.js';
import { createWorkCtrlFlowEngineFromDirectory } from '../src/filesystem.js';
import { InMemoryWorkCtrlFlowStore, FileWorkCtrlFlowStore } from '../src/stores.js';
import { FLOW_STATE_KEY, loadFlowBundleFromSources } from 'instant-ctrl-flow-logic/browser';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dir, '../../..');
const demo = (name: string) => path.join(ROOT, 'examples/xnl-bundles', name);

const runtime = (nowRef: { t: number }) => ({
  now: () => nowRef.t,
  reserveInventory: async (_endpoint: string, input: unknown) => ({
    ...(input as Record<string, unknown> | undefined),
    reservationId: 'R-1',
    notifyAttempts: 0,
    notified: false,
  }),
  notifyCustomer: async () => true,
});

const packed = { reservationId: 'R-1', notifyAttempts: 0, notified: false, parcelId: 'P-1' };

function makeEngine(store = new InMemoryWorkCtrlFlowStore(), nowRef = { t: 1_000_000 }) {
  return {
    engine: createWorkCtrlFlowEngineFromDirectory({
      bundleDir: demo('order-fulfillment'),
      instancesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wf-inst-')),
      store,
      runtime: runtime(nowRef),
    }),
    store,
    nowRef,
  };
}

describe('WorkCtrlFlow 引擎：中断/恢复/幂等', () => {
  it('orders durable lane identities by explicit numeric and UTF-16 rules', () => {
    const identities = ['中2', 'lane10', 'lane02', 'lane2', 'ä1', 'lane1', '中1'];
    const expected = ['lane1', 'lane2', 'lane02', 'lane10', 'ä1', '中1', '中2'];
    expect([...identities].sort(compareDurableLaneIds)).toEqual(expected);
    expect([...identities].reverse().sort(compareDurableLaneIds)).toEqual(expected);
  });
  it('constructs from a named-source spec with injected resolver, store and clock', async () => {
    const loaded = loadFlowBundleFromSources({
      'manifest.xnl': `<WorkCtrlFlow #test.SourceWork apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.SourceWork>
      ) [
        <Run #prepare { src = "vfs://./code.ts#prepare" config = { ready = true } }>
        <ExternalJob #hold { signalKind = "job.completed" signalKey = "hold" }>
      ]>`,
    }, { baseUri: 'app://flows/source-work' });
    const store = new InMemoryWorkCtrlFlowStore();
    const engine = new WorkCtrlFlowEngine({
      definition: {
        spec: loaded.spec!,
        resolveCode: (request) => {
          expect(request.baseUri).toBe('app://flows/source-work');
          return (_runtime, input, config) => ({ ...(input as object), ...config });
        },
      },
      store,
      clock: { now: () => 1234 },
    });

    const outcome = await engine.start('source-work', { input: { id: 1 } });
    expect(outcome.status).toBe('Waiting');
    expect((outcome.vars[FLOW_STATE_KEY] as { current: unknown }).current).toEqual({ id: 1, ready: true });
    expect((await store.load('source-work'))?.updatedAtMs).toBe(1234);
  });

  it('start → 在 ExternalJob 处挂起（登记 WaitHandle、seed 生效）', async () => {
    const { engine } = makeEngine();
    const out = await engine.start('t1');
    expect(out.status).toBe('Waiting');
    expect(out.openWaitHandles).toHaveLength(1);
    const h = out.openWaitHandles[0];
    expect(h.nodeKey).toBe('pack');
    expect(h.signalKind).toBe('job.completed');
    expect(h.signalKey).toBe('pack');
    expect(h.deadlineAtMs).toBe(1_000_000 + 86_400_000);
    // state.seed 生效（M-D4）
    expect(out.vars.notified).toBe(false);
    expect(out.vars.notifyAttempts).toBe(0);
  });

  it('resume(pack) → Timer 挂起 → fireDueTimers → 完成；副作用不重复', async () => {
    const { engine, nowRef } = makeEngine();
    const started = await engine.start('t2');
    const h = started.openWaitHandles[0];

    const afterPack = await engine.resume('t2', {
      signalKind: 'job.completed',
      signalKey: 'pack',
      resumeToken: h.resumeToken,
      payload: packed,
    });
    expect(afterPack.status).toBe('Waiting');
    expect(afterPack.openWaitHandles[0].waitKind).toBe('timer');

    nowRef.t += 60_001; // 越过 Timer durationMs
    const done = await engine.fireDueTimers('t2');
    expect(done.status).toBe('Completed');
  });

  it('跨引擎实例恢复（进程重启模拟，WF-1 状态外置）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'));
    const nowRef = { t: 5_000_000 };
    const bundleDir = demo('order-fulfillment');
    const definitionSources = Object.fromEntries([
      'manifest.xnl',
      'step-space.xnl',
      'steps/reserve-inventory/step.xnl',
      'steps/pack/step.xnl',
      'steps/cool-down/step.xnl',
      'steps/fulfilled/step.xnl',
      'steps/complete-fulfillment/step.xnl',
    ].map((relativePath) => [relativePath, fs.readFileSync(path.join(bundleDir, relativePath), 'utf8')]));
    expect(loadFlowBundleFromSources(definitionSources).spec?.flowContract).toEqual({
      id: 'depa.flows.demo.OrderFulfillment',
      input: 'vfs://./actions/fulfillment.actions.ts#FulfillmentInput',
      output: 'vfs://./actions/fulfillment.actions.ts#FulfillmentResult',
    });
    const mk = () =>
      createWorkCtrlFlowEngineFromDirectory({
        bundleDir,
        instancesDir: path.join(dir, 'instances'),
        store: new FileWorkCtrlFlowStore(path.join(dir, 'snapshots')),
        runtime: runtime(nowRef),
      });

    const h = (await mk().start('t3')).openWaitHandles[0];
    // “重启”：全新实例 + 同一存储
    const afterPack = await mk().resume('t3', {
      signalKind: 'job.completed',
      signalKey: 'pack',
      resumeToken: h.resumeToken,
      payload: packed,
    });
    expect(afterPack.status).toBe('Waiting');
    nowRef.t += 120_000;
    const done = await mk().fireDueTimers('t3');
    expect(done.status).toBe('Completed');
    expect((done.vars[FLOW_STATE_KEY] as { current: unknown }).current).toEqual({
      outcome: 'fulfilled',
      reservationId: 'R-1',
      parcelId: 'P-1',
      notificationAttempts: 1,
    });
  });

  it('persists deadline facts across engine instances and does not replay completed effects', async () => {
    const store = new InMemoryWorkCtrlFlowStore();
    const nowRef = { t: 1_000_000 };
    const instancesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-facts-'));
    const calls = { reserve: 0 };
    const options = {
      bundleDir: demo('order-fulfillment'),
      instancesDir,
      store,
      runtime: {
        ...runtime(nowRef),
        reserveInventory: async (_endpoint: string, input: unknown) => {
          calls.reserve += 1;
          return { ...(input as object), reservationId: 'R-1' };
        },
      },
    };

    const waiting = await createWorkCtrlFlowEngineFromDirectory(options).start('facts');
    expect(calls.reserve).toBe(1);
    const firstHandle = waiting.openWaitHandles[0];
    expect((await store.load('facts'))!.orchestration.deadlines[firstHandle.invocationKey]).toEqual({
      invocationKey: firstHandle.invocationKey,
      deadlineAtMs: firstHandle.deadlineAtMs,
      status: 'Open',
    });

    const resumed = await createWorkCtrlFlowEngineFromDirectory(options).resume('facts', {
      signalKind: firstHandle.signalKind,
      signalKey: firstHandle.signalKey,
      resumeToken: firstHandle.resumeToken,
      payload: packed,
    });
    expect(resumed.status).toBe('Waiting');
    expect(calls.reserve).toBe(1);
    expect((await store.load('facts'))!.orchestration.deadlines[firstHandle.invocationKey].status).toBe('Completed');
  });

  it('scheduler resumes a nested wait body across ticks and engine instances without replaying Run', async () => {
    const loaded = loadFlowBundleFromSources({
      'manifest.xnl': `<WorkCtrlFlow #test.DurableBody apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.DurableBody>
      ) [
        <Retry #durable { maxAttempts = 2 } [
          <Run #once { src = "vfs://./code.ts#once" }>
          <ExternalJob #approval { signalKind = "job.completed" signalKey = "approval" }>
          <Timer #settle { durationMs = 100 }>
        ]>
      ]>`,
    });
    const store = new InMemoryWorkCtrlFlowStore();
    const nowRef = { t: 10_000 };
    const calls = { once: 0 };
    const make = () => new WorkCtrlFlowEngine({
      definition: {
        spec: loaded.spec!,
        resolveCode: () => (_runtime, input) => {
          calls.once += 1;
          return input;
        },
      },
      store,
      runtime: { now: () => nowRef.t },
    });

    const started = await make().start('durable-body');
    expect(started.status).toBe('Waiting');
    expect(started.openWaitHandles[0].nodeKey).toBe('approval');
    expect(started.openWaitHandles[0].invocationKey).toBe('durable#0/attempt:1/approval#0');
    expect(calls.once).toBe(1);

    const afterJob = await make().resume('durable-body', {
      signalKind: 'job.completed',
      signalKey: 'approval',
      resumeToken: started.openWaitHandles[0].resumeToken,
    });
    expect(afterJob.status).toBe('Waiting');
    expect(afterJob.openWaitHandles[0].nodeKey).toBe('settle');
    expect(calls.once).toBe(1);

    nowRef.t += 101;
    const completed = await make().fireDueDeadlines('durable-body');
    expect(completed.status).toBe('Completed');
    expect(calls.once).toBe(1);
    expect((await store.load('durable-body'))!.orchestration.composites['durable#0']).toMatchObject({
      primitive: 'Retry',
      bodyId: 'attempt:1',
      status: 'Completed',
    });
  });

  it('persists Retry attempts and backoff across fresh engine instances', async () => {
    const loaded = loadFlowBundleFromSources({
      'manifest.xnl': `<WorkCtrlFlow #test.Retry apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.Retry>
      ) [<Retry #retry { maxAttempts = 2 backoffMs = 50 } [
        <Run #unstable { src = "vfs://./code.ts#unstable" }>
      ]>]>`,
    });
    const store = new InMemoryWorkCtrlFlowStore();
    const now = { t: 100 };
    let calls = 0;
    const make = () => new WorkCtrlFlowEngine({
      definition: {
        spec: loaded.spec!,
        resolveCode: () => (_runtime, input) => {
          calls += 1;
          if (calls === 1) throw new Error('first attempt');
          return input;
        },
      },
      store,
      runtime: { now: () => now.t },
    });
    expect((await make().start('retry')).status).toBe('Waiting');
    expect((await store.load('retry'))!.orchestration.attempts['retry#0']).toMatchObject({
      attempt: 2,
      nextAttemptAtMs: 150,
    });
    now.t = 151;
    expect((await make().fireDueDeadlines('retry')).status).toBe('Completed');
    expect(calls).toBe(2);
  });

  it('persists Timeout deadline and cancels its nested wait after restart', async () => {
    const loaded = loadFlowBundleFromSources({
      'manifest.xnl': `<WorkCtrlFlow #test.Timeout apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.Timeout>
      ) [<Timeout #limited { timeoutMs = 20 } [
        <ExternalJob #slow { signalKind = "job.completed" signalKey = "slow" }>
      ]>]>`,
    });
    const store = new InMemoryWorkCtrlFlowStore();
    const now = { t: 10 };
    const make = () => new WorkCtrlFlowEngine({
      definition: { spec: loaded.spec!, resolveCode: () => () => undefined },
      store,
      runtime: { now: () => now.t },
    });
    expect((await make().start('timeout')).openWaitHandles).toHaveLength(2);
    now.t = 31;
    expect((await make().fireDueDeadlines('timeout')).status).toBe('Failed');
    const snapshot = (await store.load('timeout'))!;
    expect(snapshot.orchestration.deadlines['limited#0'].status).toBe('Expired');
    expect(Object.values(snapshot.orchestration.cancellations).some((fact) => fact.reason === 'DeadlineExceeded')).toBe(true);
  });

  it('captures ForEach items once and resumes each stable item lane across instances', async () => {
    const loaded = loadFlowBundleFromSources({
      'manifest.xnl': `<WorkCtrlFlow #test.ForEach apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.ForEach>
      ) [<ForEach #each { when = "vfs://./code.ts#items" } [
        <ExternalJob #work { signalKind = "job.completed" }>
      ]>]>`,
    });
    const store = new InMemoryWorkCtrlFlowStore();
    let selections = 0;
    const make = () => new WorkCtrlFlowEngine({
      definition: {
        spec: loaded.spec!,
        resolveCode: () => () => {
          selections += 1;
          return ['a', 'b'];
        },
      },
      store,
    });
    let out = await make().start('foreach');
    expect(out.openWaitHandles).toHaveLength(2);
    for (const handle of [...out.openWaitHandles]) {
      out = await make().resume('foreach', {
        signalKind: handle.signalKind,
        signalKey: handle.signalKey,
        resumeToken: handle.resumeToken,
        payload: handle.invocationKey,
      });
    }
    expect(out.status).toBe('Completed');
    expect(selections).toBe(1);
    expect(Object.values((await store.load('foreach'))!.orchestration.lanes)).toHaveLength(2);
  });

  it('persists Parallel lanes and Race winner while cancelling loser waits', async () => {
    const source = (race: boolean) => loadFlowBundleFromSources({
      'manifest.xnl': `<WorkCtrlFlow #test.${race ? 'Race' : 'Parallel'} apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.${race ? 'Race' : 'Parallel'}>
      ) [<${race ? 'Race' : 'Parallel'} #fork ${race ? '{ mode = "first-success" }' : ''} (
        <${race ? 'Candidates' : 'Lanes'} [
          <${race ? 'Candidate' : 'Lane'} #one [<ExternalJob #job-one { signalKey = "one" }>]>
          <${race ? 'Candidate' : 'Lane'} #two [<ExternalJob #job-two { signalKey = "two" }>]>
        ]>
      )>]>`,
    }).spec!;
    const parallelStore = new InMemoryWorkCtrlFlowStore();
    const parallel = () => new WorkCtrlFlowEngine({
      definition: { spec: source(false), resolveCode: () => () => undefined },
      store: parallelStore,
    });
    let out = await parallel().start('parallel');
    expect(out.openWaitHandles).toHaveLength(2);
    for (const handle of [...out.openWaitHandles]) {
      out = await parallel().resume('parallel', {
        signalKind: handle.signalKind, signalKey: handle.signalKey, resumeToken: handle.resumeToken,
      });
    }
    expect(out.status).toBe('Completed');

    const raceStore = new InMemoryWorkCtrlFlowStore();
    const race = () => new WorkCtrlFlowEngine({
      definition: { spec: source(true), resolveCode: () => () => undefined },
      store: raceStore,
    });
    const waiting = await race().start('race');
    const winner = waiting.openWaitHandles.find((handle) => handle.signalKey === 'one')!;
    expect((await race().resume('race', {
      signalKind: winner.signalKind, signalKey: winner.signalKey, resumeToken: winner.resumeToken,
    })).status).toBe('Completed');
    const raceSnapshot = (await raceStore.load('race'))!;
    expect(raceSnapshot.orchestration.winners['fork#0'].winnerId).toBe('one');
    expect(Object.values(raceSnapshot.orchestration.cancellations).some((fact) => fact.reason === 'RaceLost')).toBe(true);

    const cancellationFacts = structuredClone(raceSnapshot.orchestration.cancellations);
    raceSnapshot.status = 'Waiting';
    await raceStore.save(raceSnapshot); // crash after winner facts, before the enclosing tick status
    expect((await race().resume('race', {
      signalKind: winner.signalKind, signalKey: winner.signalKey, resumeToken: winner.resumeToken,
    })).status).toBe('Completed');
    expect((await raceStore.load('race'))!.orchestration.cancellations).toEqual(cancellationFacts);
  });

  it('executes ready Parallel lanes concurrently and lets Race completion order choose the winner', async () => {
    const source = (race: boolean) => loadFlowBundleFromSources({
      'manifest.xnl': `<WorkCtrlFlow #test.Async${race ? 'Race' : 'Parallel'} apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.Async${race ? 'Race' : 'Parallel'}>
      ) [<${race ? 'Race' : 'Parallel'} #fork ${race ? '{ mode = "first-success" }' : ''} (
        <${race ? 'Candidates' : 'Lanes'} [
          <${race ? 'Candidate' : 'Lane'} #slow [<Run #slow-run { src = "vfs://./code.ts#slow" }>]>
          <${race ? 'Candidate' : 'Lane'} #fast [<Run #fast-run { src = "vfs://./code.ts#fast" }>]>
        ]>
      )>]>`,
    }).spec!;
    let parallelActive = 0;
    let parallelPeak = 0;
    const parallelResolver = ({ reference }: { reference: string }) => async () => {
      parallelActive += 1;
      parallelPeak = Math.max(parallelPeak, parallelActive);
      await new Promise((resolve) => setTimeout(resolve, reference.endsWith('#fast') ? 5 : 15));
      parallelActive -= 1;
      return reference.endsWith('#fast') ? 'fast-output' : 'slow-output';
    };
    const parallel = await new WorkCtrlFlowEngine({
      definition: { spec: source(false), resolveCode: parallelResolver },
      store: new InMemoryWorkCtrlFlowStore(),
    }).start('async-parallel');
    expect(parallel.status).toBe('Completed');
    expect(parallelPeak).toBe(2);

    const raceStore = new InMemoryWorkCtrlFlowStore();
    const raceResolver = ({ reference }: { reference: string }) => async () => {
      await new Promise((resolve) => setTimeout(resolve, reference.endsWith('#fast') ? 5 : 15));
      return reference.endsWith('#fast') ? 'fast-output' : 'slow-output';
    };
    const race = await new WorkCtrlFlowEngine({
      definition: { spec: source(true), resolveCode: raceResolver },
      store: raceStore,
    }).start('async-race');
    expect(race.status).toBe('Completed');
    expect((await raceStore.load('async-race'))!.orchestration.winners['fork#0'].winnerId).toBe('fast');
  });

  it('persists a Race winner without awaiting an abort-insensitive loser and ignores its late completion', async () => {
    const loaded = loadFlowBundleFromSources({
      'manifest.xnl': `<WorkCtrlFlow #test.DetachedRace apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.DetachedRace>
      ) [<Race #fork { mode = "first-success" } (
        <Candidates [
          <Candidate #blocked [<Run #blocked-run { src = "vfs://./code.ts#blocked" }>]>
          <Candidate #winner [<Run #winner-run { src = "vfs://./code.ts#winner" }>]>
        ]>
      )>]>`,
    });
    let releaseLoser!: (value: string) => void;
    const loserResult = new Promise<string>((resolve) => {
      releaseLoser = resolve;
    });
    let blockedCalls = 0;
    let winnerCalls = 0;
    const store = new InMemoryWorkCtrlFlowStore();
    const makeEngine = () => new WorkCtrlFlowEngine({
      definition: {
        spec: loaded.spec!,
        resolveCode: ({ reference }) => {
          if (reference.endsWith('#blocked')) {
            return async () => {
              blockedCalls += 1;
              return loserResult;
            };
          }
          return async () => {
            winnerCalls += 1;
            return 'winner-output';
          };
        },
      },
      store,
    });

    const outcome = await Promise.race([
      makeEngine().start('detached-race'),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 250)),
    ]);
    expect(outcome).not.toBe('timed-out');
    expect((outcome as { status: string }).status).toBe('Completed');

    const settled = (await store.load('detached-race'))!;
    expect(settled.orchestration.winners['fork#0']).toMatchObject({ winnerId: 'winner' });
    expect(settled.orchestration.lanes['fork#0/blocked'].status).toBe('Cancelled');
    expect(settled.orchestration.cancellations['fork#0/blocked']).toMatchObject({
      reason: 'RaceLost',
    });

    expect((await makeEngine().refresh('detached-race')).status).toBe('Completed');
    expect({ blockedCalls, winnerCalls }).toEqual({ blockedCalls: 1, winnerCalls: 1 });

    releaseLoser('late-loser-output');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterLateCompletion = (await store.load('detached-race'))!;
    expect(afterLateCompletion.orchestration.winners['fork#0']).toMatchObject({ winnerId: 'winner' });
    expect(afterLateCompletion.orchestration.lanes['fork#0/blocked']).toMatchObject({
      status: 'Cancelled',
    });
    expect(afterLateCompletion.orchestration.lanes['fork#0/blocked'].output).toBeUndefined();
  });

  it('enforces ForEach concurrency and passes node config to the selector', async () => {
    const loaded = loadFlowBundleFromSources({
      'manifest.xnl': `<WorkCtrlFlow #test.BoundedEach apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.BoundedEach>
      ) [<ForEach #each {
        when = "vfs://./code.ts#items"
        concurrency = 2
        config = { tenant = "acme" }
      } [<Run #work { src = "vfs://./code.ts#work" }>]>]>`,
    });
    let active = 0;
    let peak = 0;
    let selectorConfig: Readonly<Record<string, unknown>> | undefined;
    const engine = new WorkCtrlFlowEngine({
      definition: {
        spec: loaded.spec!,
        resolveCode: ({ reference }) => reference.endsWith('#items')
          ? (_runtime, _input, config) => {
              selectorConfig = config;
              return [1, 2, 3, 4];
            }
          : async (_runtime, input) => {
              active += 1;
              peak = Math.max(peak, active);
              await new Promise((resolve) => setTimeout(resolve, 20));
              active -= 1;
              return input;
            },
      },
      store: new InMemoryWorkCtrlFlowStore(),
    });
    expect((await engine.start('bounded-each')).status).toBe('Completed');
    expect(peak).toBe(2);
    expect(selectorConfig).toEqual({ tenant: 'acme' });
  });

  it('runs synchronous InstantCtrlFlow CallFlow and persists a durable child lifecycle', async () => {
    const parent = loadFlowBundleFromSources({
      'manifest.xnl': `<WorkCtrlFlow #test.Parent apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.Parent>
      ) [<CallFlow #child { flow = "instant-ctrl-flow://test.Child" }>]>`,
    }).spec!;
    const child = loadFlowBundleFromSources({
      'manifest.xnl': `<InstantCtrlFlow #test.Child apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.Child>
      ) [<Return #done { src = "vfs://./code.ts#done" }>]>`,
    }).spec!;
    const sync = new WorkCtrlFlowEngine({
      definition: {
        spec: parent,
        resolveCode: () => () => undefined,
        resolveFlow: async () => ({ spec: child, resolveCode: () => (_runtime, input) => ({ input, ok: true }) }),
      },
      store: new InMemoryWorkCtrlFlowStore(),
    });
    expect((await sync.start('sync-child')).status).toBe('Completed');

    const durableParent = loadFlowBundleFromSources({
      'manifest.xnl': `<WorkCtrlFlow #test.DurableParent apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.DurableParent>
      ) [<CallFlow #child { flow = "work-ctrl-flow://test.Child" }>]>`,
    }).spec!;
    const store = new InMemoryWorkCtrlFlowStore();
    let complete = false;
    let childStarts = 0;
    let childInspects = 0;
    const make = () => new WorkCtrlFlowEngine({
      definition: { spec: durableParent, resolveCode: () => () => undefined },
      store,
      durableChildren: {
        start: async (_ref, treeId) => {
          childStarts += 1;
          return { treeId, status: 'Waiting' };
        },
        inspect: async (_ref, treeId) => {
          childInspects += 1;
          return { treeId, status: complete ? 'Completed' : 'Waiting', output: 'child-output' };
        },
      },
    });
    expect((await make().start('durable-parent')).status).toBe('Waiting');
    complete = true;
    expect((await make().refresh('durable-parent')).status).toBe('Completed');
    expect((await make().refresh('durable-parent')).status).toBe('Completed');
    expect({ childStarts, childInspects }).toEqual({ childStarts: 1, childInspects: 1 });
    expect((await store.load('durable-parent'))!.orchestration.composites['child#0'].childTreeId).toBe(
      'durable-parent:child#0:child',
    );

    const mismatched = new WorkCtrlFlowEngine({
      definition: {
        spec: parent,
        resolveCode: () => () => undefined,
        resolveFlow: async () => ({ spec: { ...child, fqn: 'test.Other' }, resolveCode: () => () => undefined }),
      },
      store: new InMemoryWorkCtrlFlowStore(),
    });
    expect((await mismatched.start('mismatched-flow')).status).toBe('Failed');

    const wrongChildId = new WorkCtrlFlowEngine({
      definition: { spec: durableParent, resolveCode: () => () => undefined },
      store: new InMemoryWorkCtrlFlowStore(),
      durableChildren: {
        start: async () => ({ treeId: 'wrong', status: 'Waiting' }),
        inspect: async () => ({ treeId: 'wrong', status: 'Waiting' }),
      },
    });
    expect((await wrongChildId.start('wrong-child')).status).toBe('Failed');
  });

  it('幂等（WF-4）：重复投递同一 ResumeSignal 不改变流程', async () => {
    const { engine } = makeEngine();
    const h = (await engine.start('t4')).openWaitHandles[0];
    const sig = { signalKind: 'job.completed', signalKey: 'pack', resumeToken: h.resumeToken };
    const first = await engine.resume('t4', sig);
    expect(first.status).toBe('Waiting'); // 停在 Timer
    const second = await engine.resume('t4', sig); // 重复投递
    expect(second.status).toBe('Waiting');
    expect(second.openWaitHandles).toEqual(first.openWaitHandles);
    expect(second.tickNo).toBe(first.tickNo); // 未触发新 tick
  });

  it('resumeToken 错误 → 拒绝且状态不变', async () => {
    const { engine } = makeEngine();
    await engine.start('t5');
    await expect(
      engine.resume('t5', { signalKind: 'job.completed', signalKey: 'pack', resumeToken: 'wrong' }),
    ).rejects.toThrow('resume token mismatch');
    const out = await engine.getOutcome('t5');
    expect(out!.openWaitHandles).toHaveLength(1);
  });

  it('未匹配任何 open handle 的信号被拒绝', async () => {
    const { engine } = makeEngine();
    await engine.start('t6');
    await expect(
      engine.resume('t6', { signalKind: 'job.completed', signalKey: 'nope', resumeToken: 'x' }),
    ).rejects.toThrow(WorkCtrlFlowLoadError);
  });

  it('中断等价性（WF-6）：分段恢复与信号即时到达的最终 vars 等价', async () => {
    // 路径 A：三段式（start → resume → timer）
    const a = makeEngine();
    const h = (await a.engine.start('tA')).openWaitHandles[0];
    await a.engine.resume('tA', { signalKind: 'job.completed', signalKey: 'pack', resumeToken: h.resumeToken, payload: packed });
    a.nowRef.t += 60_001;
    const outA = await a.engine.fireDueTimers('tA');

    // 路径 B：每步之间“重启”（新实例同存储）
    const store = new InMemoryWorkCtrlFlowStore();
    const nowRef = { t: 1_000_000 };
    const instancesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-eq-'));
    const mk = () => createWorkCtrlFlowEngineFromDirectory({ bundleDir: demo('order-fulfillment'), instancesDir, store, runtime: runtime(nowRef) });
    const hb = (await mk().start('tB')).openWaitHandles[0];
    await mk().resume('tB', { signalKind: 'job.completed', signalKey: 'pack', resumeToken: hb.resumeToken, payload: packed });
    nowRef.t += 60_001;
    const outB = await mk().fireDueTimers('tB');

    expect(outA.status).toBe('Completed');
    expect(outB.status).toBe('Completed');
    const clean = (v: Record<string, unknown>) => JSON.parse(JSON.stringify(v));
    expect(clean(outB.vars)).toEqual(clean(outA.vars));
  });

  it('form 收窄：InstantCtrlFlow bundle 交给 WorkCtrlFlow 引擎 → form-mismatch', () => {
    expect(
      () =>
        createWorkCtrlFlowEngineFromDirectory({
          bundleDir: demo('instant-http-check'),
          instancesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wf-form-')),
          store: new InMemoryWorkCtrlFlowStore(),
        }),
    ).toThrow('expected WorkCtrlFlow');
  });
});

describe('deadline 与句柄生命周期（track refactor-status-enums）', () => {
  it('ExternalJob 超时：fireDueDeadlines → 节点 Failure、流程 Failed、句柄 Expired 入 closed', async () => {
    const { engine, nowRef, store } = makeEngine();
    await engine.start('dl1');
    nowRef.t += 86_400_001; // 越过 pack 的 timeoutMs
    const out = await engine.fireDueDeadlines('dl1');
    expect(out.status).toBe('Failed');
    const snap = (await store.load('dl1'))!;
    expect(snap.openWaitHandles).toHaveLength(0);
    expect(snap.closedWaitHandles).toHaveLength(1);
    expect(snap.closedWaitHandles[0].status).toBe('Expired');
    expect(snap.closedWaitHandles[0].nodeKey).toBe('pack');
    expect(snap.orchestration.deadlines['pack#0'].status).toBe('Expired');
    expect(snap.orchestration.cancellations['pack#0']).toMatchObject({
      invocationKey: 'pack#0',
      reason: 'DeadlineExceeded',
    });
  });

  it('正常 resume：句柄 Consumed 入 closed（审计）', async () => {
    const { engine, store } = makeEngine();
    const h = (await engine.start('dl2')).openWaitHandles[0];
    await engine.resume('dl2', { signalKind: 'job.completed', signalKey: 'pack', resumeToken: h.resumeToken });
    const snap = (await store.load('dl2'))!;
    expect(snap.closedWaitHandles.map((x) => x.status)).toContain('Consumed');
  });

  it('Cancelled 贯通：outcome=Cancelled → 流程 Failed、视图节点 Cancelled、句柄 Cancelled', async () => {
    const { engine, store } = makeEngine();
    const h = (await engine.start('dl3')).openWaitHandles[0];
    const out = await engine.resume('dl3', {
      signalKind: 'job.completed',
      signalKey: 'pack',
      resumeToken: h.resumeToken,
      outcome: 'Cancelled',
    });
    expect(out.status).toBe('Failed'); // 树语义按 Failure 收敛
    const snap = (await store.load('dl3'))!;
    expect(snap.waitResults[h.invocationKey].result).toBe('Cancelled');
    expect(snap.closedWaitHandles[0].status).toBe('Cancelled');
    expect(snap.orchestration.cancellations[h.invocationKey]).toMatchObject({
      reason: 'SignalCancelled',
    });
  });
});
