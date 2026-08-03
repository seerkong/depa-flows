import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FLOW_STATE_KEY,
  createFilesystemFlowCodeResolver,
  loadFlowBundle,
  loadFlowBundleFromSources,
} from 'instant-ctrl-flow-logic';
import type { TickOutcome, WorkCtrlFlowStore } from 'work-ctrl-flow-contract';
import type { TaskSpaceStore } from 'task-manager-contract';
import { InMemoryTaskSpaceStore, TaskTransitionError } from 'task-manager-logic';
import { InMemoryWorkCtrlFlowStore } from 'work-ctrl-flow-logic';
import { BPCtrlFlowEngine } from '../src/engine.js';
import { createBPCtrlFlowEngineFromDirectory, defaultBPCtrlFlowTaskDependencies } from '../src/filesystem.js';

const ROOT = path.resolve(import.meta.dir, '../../..');
const demo = () => path.join(ROOT, 'examples/xnl-bundles/expense-approval');

interface Harness {
  instancesDir: string;
  store: WorkCtrlFlowStore;
  taskStore: TaskSpaceStore;
  payouts: unknown[];
}

function makeHarness(): Harness {
  return {
    instancesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bp-inst-')),
    store: new InMemoryWorkCtrlFlowStore(),
    taskStore: new InMemoryTaskSpaceStore(),
    payouts: [],
  };
}

function makeEngine(harness = makeHarness()) {
  return createBPCtrlFlowEngineFromDirectory({
    bundleDir: demo(),
    instancesDir: harness.instancesDir,
    store: harness.store,
    taskStore: harness.taskStore,
    runtime: {
      now: () => 42_000,
      notify: async () => {},
      payout: async (expense: unknown) => {
        harness.payouts.push(expense);
        return { payoutId: 'pay-1' };
      },
    },
  });
}

function currentData(outcome: TickOutcome): unknown {
  return (outcome.vars[FLOW_STATE_KEY] as { current: unknown }).current;
}

describe('BPCtrlFlow canonical compiler wiring', () => {
  it('constructs from a preloaded definition with injected snapshot and task stores', async () => {
    const harness = makeHarness();
    const loaded = loadFlowBundle(demo());
    const engine = new BPCtrlFlowEngine({
      definition: { spec: loaded.spec!, resolveCode: createFilesystemFlowCodeResolver() },
      store: harness.store,
      taskStore: harness.taskStore,
      tasks: defaultBPCtrlFlowTaskDependencies,
      clock: { now: () => 42_000 },
      runtime: { notify: async () => {}, payout: async () => ({ payoutId: 'unused' }) },
    });

    const outcome = await engine.start('preloaded');
    expect(outcome.status).toBe('Waiting');
    expect((await engine.tasks('preloaded')).find((task) => task.id === 'task_manager_approve')?.status).toBe('Active');
  });

  it('executes Run functions and opens the first TaskStep from root statements', async () => {
    const engine = makeEngine();
    const outcome = await engine.start('b1');
    expect(outcome.status).toBe('Waiting');
    expect(outcome.openWaitHandles[0].signalKey).toBe('task_manager_approve');
    const tasks = await engine.tasks('b1');
    expect(tasks.find((task) => task.id === 'task_manager_approve')?.status).toBe('Active');
    expect(tasks.find((task) => task.id === 'task_finance_approve')?.status).toBe('NotStarted');
  });

  it('keeps invalid task transitions as technical faults', async () => {
    const engine = makeEngine();
    await engine.start('b2');
    await expect(
      engine.operateTask('b2', { taskId: 'task_manager_approve', operation: 'start', operatorAccount: 'user:x' }),
    ).rejects.toThrow(TaskTransitionError);
  });

  it('routes approved TaskStepResult data through finance approval and payout', async () => {
    const harness = makeHarness();
    const engine = makeEngine(harness);
    await engine.start('approved');

    const manager = await engine.operateTask('approved', {
      taskId: 'task_manager_approve',
      operation: 'complete',
      operatorAccount: 'user:manager',
    });
    expect(manager.taskStatus).toBe('Done');
    expect(manager.outcome.status).toBe('Waiting');
    expect(manager.outcome.openWaitHandles[0].signalKey).toBe('grp_finance');

    const managerSnapshot = await harness.store.load('approved');
    expect(managerSnapshot?.waitResults['manager-approval#0'].payload).toEqual({
      taskId: 'task_manager_approve',
      status: 'Done',
      outcome: 'approved',
      payload: { expenseId: 'exp-demo-001', amount: 8800, currency: 'CNY' },
    });

    const finance = await engine.operateTask('approved', {
      taskId: 'task_finance_approve',
      operation: 'complete',
      operatorAccount: 'user:finance',
    });
    expect(finance.outcome.status).toBe('Completed');
    expect(finance.outcome.errors).toEqual([]);
    expect(currentData(finance.outcome)).toEqual({
      outcome: 'paid',
      expense: { expenseId: 'exp-demo-001', amount: 8800, currency: 'CNY' },
      payoutId: 'pay-1',
    });
    expect(harness.payouts).toHaveLength(1);
  });

  it('routes refused TaskStepResult as normal data instead of technical Failure', async () => {
    const engine = makeEngine();
    await engine.start('refused');
    const result = await engine.operateTask('refused', {
      taskId: 'task_manager_approve',
      operation: 'refuse',
      operatorAccount: 'user:manager',
    });

    expect(result.taskStatus).toBe('Refused');
    expect(result.outcome.status).toBe('Completed');
    expect(result.outcome.errors).toEqual([]);
    expect(currentData(result.outcome)).toEqual({
      taskId: 'task_manager_approve',
      status: 'Refused',
      outcome: 'refused',
      payload: { expenseId: 'exp-demo-001', amount: 8800, currency: 'CNY' },
    });
  });

  it('routes forwarded TaskStepResult through an ordinary If branch', async () => {
    const engine = makeEngine();
    await engine.start('forwarded');
    const result = await engine.operateTask('forwarded', {
      taskId: 'task_manager_approve',
      operation: 'forward',
      operatorAccount: 'user:manager',
    });

    expect(result.taskStatus).toBe('Forwarded');
    expect(result.outcome.status).toBe('Completed');
    expect(result.outcome.errors).toEqual([]);
    expect(currentData(result.outcome)).toMatchObject({
      taskId: 'task_manager_approve',
      status: 'Forwarded',
      outcome: 'forwarded',
    });
  });

  it('resumes both TaskSteps through fresh engine instances', async () => {
    const harness = makeHarness();
    expect(loadFlowBundle(demo()).spec?.flowContract).toEqual({
      id: 'depa.flows.demo.ExpenseApproval',
      input: 'vfs://./actions/expense.actions.ts#ExpenseApprovalInput',
      output: 'vfs://./actions/expense.actions.ts#ExpenseApprovalOutput',
    });
    await makeEngine(harness).start('restart');

    const afterManager = await makeEngine(harness).operateTask('restart', {
      taskId: 'task_manager_approve',
      operation: 'complete',
      operatorAccount: 'user:manager',
    });
    expect(afterManager.outcome.status).toBe('Waiting');
    expect(afterManager.outcome.openWaitHandles[0].signalKey).toBe('grp_finance');

    const afterFinance = await makeEngine(harness).operateTask('restart', {
      taskId: 'task_finance_approve',
      operation: 'complete',
      operatorAccount: 'user:finance',
    });
    expect(afterFinance.outcome.status).toBe('Completed');
    expect(currentData(afterFinance.outcome)).toMatchObject({ outcome: 'paid', payoutId: 'pay-1' });
    expect(harness.payouts).toHaveLength(1);
  });

  it('writes task status facts to the materialized task.space facet', async () => {
    const harness = makeHarness();
    harness.instancesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-annotation-'));
    const engine = makeEngine(harness);
    await engine.start('b3');
    const file = path.join(harness.instancesDir, 'b3', 'task.space.xnl');
    expect(fs.readFileSync(file, 'utf8')).toContain('status = "Active"');
  });

  it('rejects a WorkCtrlFlow definition at the BPCtrlFlow boundary', () => {
    expect(() => createBPCtrlFlowEngineFromDirectory({
      bundleDir: path.join(ROOT, 'examples/xnl-bundles/order-fulfillment'),
      instancesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bp-form-')),
      store: new InMemoryWorkCtrlFlowStore(),
      taskStore: new InMemoryTaskSpaceStore(),
    })).toThrow('expected BPCtrlFlow');
  });

  it('inherits durable composite recovery across fresh engine instances without replaying effects', async () => {
    const loaded = loadFlowBundleFromSources({
      'manifest.xnl': `<BPCtrlFlow #test.DurableBiz apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.DurableBiz>
        <TaskSpace #test.DurableBiz [
          <Task #approve {
            name = "Approve"
            ownerAccount = "user:approver"
            status = "NotStarted"
            order = 0
          }>
        ]>
      ) [
        <Retry #durable { maxAttempts = 2 } [
          <Run #once { src = "vfs://./code.ts#once" }>
          <TaskStep #approval { task = "task-space://#approve" }>
        ]>
      ]>`,
    });
    const store = new InMemoryWorkCtrlFlowStore();
    const taskStore = new InMemoryTaskSpaceStore();
    let calls = 0;
    const make = () => new BPCtrlFlowEngine({
      definition: {
        spec: loaded.spec!,
        resolveCode: () => (_runtime, input) => {
          calls += 1;
          return input;
        },
      },
      store,
      taskStore,
      tasks: defaultBPCtrlFlowTaskDependencies,
    });

    const waiting = await make().start('durable-biz');
    expect(waiting.status).toBe('Waiting');
    expect(waiting.openWaitHandles[0].invocationKey).toBe('durable#0/attempt:1/approval#0');
    expect(calls).toBe(1);

    const completed = await make().operateTask('durable-biz', {
      taskId: 'approve',
      operation: 'complete',
      operatorAccount: 'user:approver',
    });
    expect(completed.outcome.status).toBe('Completed');
    expect(calls).toBe(1);
    expect((await store.load('durable-biz'))!.orchestration.composites['durable#0']).toMatchObject({
      primitive: 'Retry',
      status: 'Completed',
    });
  });
});
