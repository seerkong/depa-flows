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

const canonicalDemos = {
  'instant-http-check': 'InstantCtrlFlow',
  'order-fulfillment': 'WorkCtrlFlow',
  'expense-approval': 'BPCtrlFlow',
  'eager-data-flow-child': 'EagerDataFlow',
  'eager-data-flow-parent': 'EagerDataFlow',
  'ai-ctrl-workflow': 'AICtrlWorkflow',
  'ai-data-workflow': 'AIDataWorkflow',
};

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
    for (const [name, form] of Object.entries(canonicalDemos)) {
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

  test('assembles the exact modular StepSpace closure for Ctrl and Data demos', () => {
    const ctrl = checkDir(demo('order-fulfillment'));
    const data = checkDir(demo('ai-data-workflow'));

    expect(ctrl.definitionStepForest.stepOrder).toEqual([
      'reserve-inventory', 'pack', 'cool-down', 'complete-fulfillment', 'fulfilled',
    ]);
    expect(ctrl.statements.map((statement) => statement.tag)).toEqual([
      'Retry', 'ExternalJob', 'Timer', 'Parallel', 'Return',
    ]);
    expect(data.definitionStepForest.stepOrder).toEqual(['entry', 'retrieve', 'summarize', 'return']);
    expect(data.statements.map((statement) => statement.tag)).toEqual([
      'EntryNode', 'TransformNode', 'TransformNode', 'ReturnNode',
    ]);
    expect(ctrl.problems).toEqual([]);
    expect(data.problems).toEqual([]);
  });

  test('does not invent StepSpace membership from an unreferenced directory entry', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-dsl-modular-'));
    temporaryDirectories.push(root);
    fs.cpSync(demo('ai-data-workflow'), root, { recursive: true });
    const unreferenced = path.join(root, 'steps', 'unreferenced');
    fs.mkdirSync(unreferenced, { recursive: true });
    fs.writeFileSync(path.join(unreferenced, 'step.xnl'), '<NotAStep #ignored>');

    const result = checkDir(root);
    expect(result.definitionStepForest.stepOrder).toEqual(['entry', 'retrieve', 'summarize', 'return']);
    expect(result.problems).toEqual([]);
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

describe('definition, instance and run documentation', () => {
  test('keeps authored AI examples on the named typed facade', async () => {
    for (const relativePath of [
      'examples/xnl-bundles/ai-ctrl-workflow/flow-code/agent.ts',
      'examples/xnl-bundles/ai-data-workflow/flow-code/evidence.ts',
    ]) {
      const source = await fs.promises.readFile(path.join(ROOT, relativePath), 'utf8');
      expect(source).toContain('.effects.runAgent(');
      expect(source).toContain('.effects.runTargetedAgent(');
      expect(source).not.toContain('.effects.invoke(');
    }
  });
  const canonicalDoc = path.join(ROOT, 'docs/flow-dsl/spec/flow-core/instance-run.md');
  const linkedDocs = [
    path.join(ROOT, 'docs/flow-dsl/README.md'),
    path.join(ROOT, 'docs/flow-dsl/foundation/depa-axioms.md'),
    path.join(ROOT, 'docs/flow-dsl/spec/work-ctrl-flow/domains.md'),
    path.join(ROOT, 'docs/flow-dsl/spec/ai-workflow/resources.md'),
    path.join(ROOT, 'docs/flow-dsl/spec/ai-workflow/ctrl-workflow.md'),
    path.join(ROOT, 'docs/flow-dsl/spec/ai-workflow/data-workflow.md'),
    path.join(ROOT, 'docs/flow-dsl/std/work-ctrl-flow/axioms.md'),
    path.join(ROOT, 'docs/flow-dsl/std/ai-ctrl-workflow/axioms.md'),
    path.join(ROOT, 'docs/flow-dsl/std/ai-data-workflow/axioms.md'),
    path.join(ROOT, 'examples/xnl-bundles/README.md'),
  ];
  const exampleDocs = [
    path.join(ROOT, 'examples/xnl-bundles/order-fulfillment/README.md'),
    path.join(ROOT, 'examples/xnl-bundles/ai-ctrl-workflow/README.md'),
    path.join(ROOT, 'examples/xnl-bundles/ai-data-workflow/README.md'),
  ];

  test('keeps the seven source bundles valid and links their runtime projection guide', () => {
    expect(Object.keys(canonicalDemos)).toHaveLength(7);
    expect(fs.readFileSync(path.join(ROOT, 'docs/flow-dsl/README.md'), 'utf8'))
      .toContain('[spec/flow-core/instance-run.md](spec/flow-core/instance-run.md)');
    expect(fs.readFileSync(path.join(ROOT, 'examples/xnl-bundles/README.md'), 'utf8'))
      .toContain('[Definition、Instance 与 Run](../../docs/flow-dsl/spec/flow-core/instance-run.md)');

    for (const file of [canonicalDoc, ...linkedDocs, ...exampleDocs]) {
      expect(fs.statSync(file).isFile()).toBe(true);
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/gu)) {
        if (/^[a-z][a-z+.-]*:/iu.test(match[1])) continue;
        expect(fs.existsSync(path.resolve(path.dirname(file), match[1]))).toBe(true);
      }
    }
  });

  test('keeps generated instance and run records outside source bundles', () => {
    for (const name of Object.keys(canonicalDemos)) {
      const root = demo(name);
      const pending = [root];
      while (pending.length > 0) {
        const current = pending.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          expect(['instance.json', 'checkpoint.json', 'runs'].includes(entry.name)).toBe(false);
          if (entry.isDirectory()) pending.push(path.join(current, entry.name));
        }
      }
    }
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
