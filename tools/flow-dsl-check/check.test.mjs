import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDir } from './check.mjs';
import { idOf } from './load.mjs';

const ROOT = path.resolve(import.meta.dir, '../..');
const demo = (name) => path.join(ROOT, 'examples/xnl-bundles', name);
const fixture = (name) => path.join(import.meta.dir, 'fixtures', name);
const codes = (result) => result.problems.map((problem) => problem.code);
const temporaryDirectories = [];

function temporaryBundle(form, body, extraFiles = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-dsl-check-'));
  temporaryDirectories.push(dir);
  fs.writeFileSync(path.join(dir, 'manifest.xnl'), `<${form} #depa.flows.test.Profile apiVersion="depa.flows/v1" version="1" (
    <FlowContract #depa.flows.test.Profile {
      input = "vfs://./code.ts#Input"
      output = "vfs://./code.ts#Output"
    }>
  ) [${body}]>`);
  fs.writeFileSync(path.join(dir, 'code.ts'), `
    export interface Input {}
    export interface Output {}
    export function predicate() { return true; }
    export function items() { return []; }
  `);
  for (const [name, content] of Object.entries(extraFiles)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('canonical bundle loading', () => {
  test('loads direct product-root statements for all demos', () => {
    const expected = {
      'instant-http-check': 'InstantCtrlFlow',
      'order-fulfillment': 'WorkCtrlFlow',
      'expense-approval': 'BPCtrlFlow',
      'eager-data-flow-child': 'EagerDataFlow',
      'eager-data-flow-parent': 'EagerDataFlow',
      'ai-ctrl-workflow': 'AICtrlWorkflow',
      'ai-data-workflow': 'AIDataWorkflow',
    };

    for (const [name, form] of Object.entries(expected)) {
      const result = checkDir(demo(name));
      expect(result.form).toBe(form);
      expect(result.problems).toEqual([]);
    }
  });

  test('loads the InstantCtrlFlow contract without treating it as a statement', () => {
    const result = checkDir(demo('instant-http-check'));

    expect(result.statements.map((statement) => statement.tag)).toEqual(['Run', 'Require', 'Timeout', 'Return']);
    expect(Object.keys(result.facets)).toEqual(['flow.contract']);
  });

  test.each([
    [
      'instant-http-check',
      'depa.flows.demo.InstantHttpCheck',
      'vfs://./actions/health.actions.ts#HealthCheckInput',
      'vfs://./actions/health.actions.ts#HealthCheckResult',
    ],
    [
      'order-fulfillment',
      'depa.flows.demo.OrderFulfillment',
      'vfs://./actions/fulfillment.actions.ts#FulfillmentInput',
      'vfs://./actions/fulfillment.actions.ts#FulfillmentResult',
    ],
    [
      'expense-approval',
      'depa.flows.demo.ExpenseApproval',
      'vfs://./actions/expense.actions.ts#ExpenseApprovalInput',
      'vfs://./actions/expense.actions.ts#ExpenseApprovalOutput',
    ],
  ])('exposes the %s FlowContract type references to fixture validation', (name, id, input, output) => {
    const result = checkDir(demo(name));
    const contract = result.facets['flow.contract'];

    expect(result.problems).toEqual([]);
    expect(idOf(contract)).toBe(id);
    expect(contract.attributes).toMatchObject({ input, output });
  });
});

describe('canonical statement rules', () => {
  test('validates config refs inside statement config', () => {
    const resultCodes = codes(checkDir(fixture('bad-config-ref')));

    expect(resultCodes).toContain('unresolved-config-ref');
    expect(resultCodes).toContain('unresolved-config-subpath');
  });

  test('validates If/Branches/Branch/Otherwise structure', () => {
    const resultCodes = codes(checkDir(fixture('bad-if-shape')));

    expect(resultCodes).toContain('if-branches-cardinality');
    expect(resultCodes).toContain('branch-missing-when');
    expect(resultCodes).toContain('otherwise-not-last');
    expect(resultCodes).toContain('otherwise-duplicate');
  });

  test('validates Run, Fallback, Until and Return contracts', () => {
    const resultCodes = codes(checkDir(fixture('bad-core-statements')));

    expect(resultCodes).toContain('run-missing-src');
    expect(resultCodes).toContain('fallback-invalid-strategy');
    expect(resultCodes).toContain('until-missing-when');
    expect(resultCodes).toContain('return-source-conflict');
  });
});

describe('profile rules', () => {
  test.each(['InstantCtrlFlow', 'WorkCtrlFlow', 'BPCtrlFlow', 'AICtrlWorkflow'])(
    'accepts shared orchestration primitives in %s',
    (form) => {
      const result = checkDir(temporaryBundle(form, `
        <Require #required { when = "vfs://./code.ts#predicate" }>
        <Retry #retry { maxAttempts = 2 } [<Return #retry-result>]>
        <Timeout #timeout { timeoutMs = 10 } [<Return #timeout-result>]>
        <ForEach #each { when = "vfs://./code.ts#items" concurrency = 2 } [<Return #each-result>]>
        <Parallel #parallel { join = "all" } (
          <Lanes [<Lane #lane [<Return #lane-result>]>]>
        )>
        <Race #race { mode = "first-success" } (
          <Candidates [<Candidate #candidate [<Return #candidate-result>]>]>
        )>
        <CallFlow #call { flow = "instant-ctrl-flow://depa.flows.Child" }>
      `));

      expect(result.problems).toEqual([]);
    },
  );

  test.each([
    ['InstantCtrlFlow', '<ExternalJob #unsupported { signalKind = "job.completed" signalKey = "job" }>', 'interruptible-in-instant-ctrl-flow'],
    ['InstantCtrlFlow', '<Timer #unsupported { durationMs = 1 }>', 'interruptible-in-instant-ctrl-flow'],
    ['InstantCtrlFlow', '<TaskStep #unsupported { task = "task-space://#task" }>', 'interruptible-in-instant-ctrl-flow'],
    ['WorkCtrlFlow', '<TaskStep #unsupported { task = "task-space://#task" }>', 'interruptible-in-work-ctrl-flow'],
    ['AICtrlWorkflow', '<TaskStep #unsupported { task = "task-space://#task" }>', 'interruptible-in-ai-ctrl-workflow'],
  ])('%s rejects %s with stable code %s', (form, statement, expectedCode) => {
    const resultCodes = codes(checkDir(temporaryBundle(form, statement)));

    expect(resultCodes).toContain(expectedCode);
  });

  test('rejects persistent statements in InstantCtrlFlow', () => {
    expect(codes(checkDir(fixture('bad-interruptible-instant')))).toContain('interruptible-in-instant-ctrl-flow');
  });

  test('validates state seed fields', () => {
    expect(codes(checkDir(fixture('bad-seed-field')))).toContain('seed-undeclared-field');
  });

  test('validates TaskStep refs, direct-child binding and removed assignTo', () => {
    const resultCodes = codes(checkDir(fixture('bad-task-ref')));

    expect(resultCodes).toContain('unresolved-task-ref');
    expect(resultCodes).toContain('task-ref-not-direct-child');
    expect(resultCodes).toContain('taskstep-assignto-forbidden');
  });
});

describe('removed authoring syntax', () => {
  test.each([
    ['legacy-tree', 'legacy-tree-domain'],
    ['legacy-action-types', 'legacy-action-types-domain'],
    ['legacy-ctrl-flow', 'legacy-ctrl-flow-root'],
    ['legacy-data-flow', 'legacy-data-flow-root'],
    ['legacy-public-control', 'legacy-public-control-node'],
    ['legacy-public-action', 'legacy-public-action-node'],
  ])('rejects %s with stable diagnostic %s', (name, diagnostic) => {
    expect(codes(checkDir(fixture(name)))).toContain(diagnostic);
  });
});
