import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadFlowBundle } from '../src/filesystem.js';
import { loadFlowBundleFromSources } from '../src/loader.js';

const created: string[] = [];

function bundle(files: Readonly<Record<string, string | undefined>>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'depa-flow-loader-'));
  created.push(dir);
  for (const [name, source] of Object.entries(files)) {
    if (source === undefined) continue;
    writeFileSync(path.join(dir, name), source);
  }
  return dir;
}

function manifest(form: 'InstantFlow' | 'WorkFlow' | 'BizProcess', body: string): string {
  return `<${form} #depa.flows.test.Loader apiVersion="depa.flows/v1" version="1.0.0" (
    <FlowContract #depa.flows.test.Loader>
  ) [${body}]>`;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('canonical flow bundle loading', () => {
  it.each(['InstantFlow', 'WorkFlow', 'BizProcess'] as const)(
    'loads %s from named sources without a filesystem base',
    (form) => {
      const result = loadFlowBundleFromSources({
        'manifest.xnl': manifest(form, '<Return #done { value = { ok = true } }>'),
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.spec).toMatchObject({ form, sourceNames: ['manifest.xnl'], dir: '' });
      expect(result.spec?.baseUri).toBeUndefined();
    },
  );

  it.each(['InstantFlow', 'WorkFlow', 'BizProcess'] as const)(
    'keeps the %s form and projects product-root statements in declaration order',
    (form) => {
      const result = loadFlowBundle(bundle({
        'manifest.xnl': manifest(form, `
          <Run #load { src = "vfs://./flow-code/test.ts#load" }>
          <Return #done { value = { ok = true } }>
        `),
      }));

      expect(result.diagnostics).toEqual([]);
      expect(result.spec?.form).toBe(form);
      expect(result.spec?.statements.map(({ tag, id }) => ({ tag, id }))).toEqual([
        { tag: 'Run', id: 'load' },
        { tag: 'Return', id: 'done' },
      ]);
    },
  );

  it('projects config, config.def, state.def, state.seed and task.space facets', () => {
    const result = loadFlowBundle(bundle({
      'manifest.xnl': manifest('BizProcess', '<TaskStep #review { task = "task-space://#review_task" }>'),
      'config.xnl': '<Config [ <ConfigEntry #pricing { currency = "TRY" }> ]>',
      'config.def.xnl': '<ConfigDef [ <ConfigEntryDef #pricing { currency = "string" }> ]>',
      'state.def.xnl': '<StateDef #order_state { attempt = "number" }>',
      'state.seed.xnl': '<StateSeed #order_state { attempt = 0 }>',
      'task.space.xnl': '<TaskSpace #space_order version=1 [ <Task #review_task { status = "NotStarted" order = 0 }> ]>',
    }));

    expect(result.diagnostics).toEqual([]);
    expect(result.spec?.config).toEqual({ pricing: { currency: 'TRY' } });
    expect(result.spec?.configDef).toEqual({ pricing: { currency: 'string' } });
    expect(result.spec?.stateDef).toEqual({ attempt: 'number' });
    expect(result.spec?.stateSeed).toEqual({ attempt: 0 });
    expect(result.spec?.taskSpace).toMatchObject({
      tag: 'TaskSpace',
      id: 'space_order',
      metadata: { version: 1 },
      children: [{ tag: 'Task', id: 'review_task' }],
    });
  });

  it('keeps directory loading as the same source projection with only baseUri added', () => {
    const files = {
      'manifest.xnl': manifest('WorkFlow', '<Return #done>'),
      'state.seed.xnl': '<StateSeed #state { count = 1 }>',
    };
    const directory = loadFlowBundle(bundle(files));
    const sources = loadFlowBundleFromSources(files, { baseUri: directory.spec?.baseUri });
    expect(directory).toEqual(sources);
  });

  it('projects inline facets without mixing them into product-root statements', () => {
    const result = loadFlowBundle(bundle({
      'flow.xnl': `
        <WorkFlow #depa.flows.test.Inline apiVersion="depa.flows/v1" version="1.0.0" (
          <FlowContract #depa.flows.test.Inline>
          <Config [ <ConfigEntry #runtime { retries = 2 }> ]>
          <ConfigDef [ <ConfigEntryDef #runtime { retries = "number" }> ]>
          <StateDef #inline_state { attempt = "number" }>
          <StateSeed #inline_state { attempt = 0 }>
        ) [
          <Run #work { src = "vfs://./flow-code/test.ts#work" }>
        ]>
      `,
    }));

    expect(result.diagnostics).toEqual([]);
    expect(result.spec?.statements.map((statement) => statement.tag)).toEqual(['Run']);
    expect(result.spec?.config).toEqual({ runtime: { retries: 2 } });
    expect(result.spec?.configDef).toEqual({ runtime: { retries: 'number' } });
    expect(result.spec?.stateDef).toEqual({ attempt: 'number' });
    expect(result.spec?.stateSeed).toEqual({ attempt: 0 });
  });

  it.each([
    [
      'instant-http-check',
      'InstantFlow',
      'depa.flows.demo.InstantHttpCheck',
      'vfs://./actions/health.actions.ts#HealthCheckInput',
      'vfs://./actions/health.actions.ts#HealthCheckResult',
    ],
    [
      'order-fulfillment',
      'WorkFlow',
      'depa.flows.demo.OrderFulfillment',
      'vfs://./actions/fulfillment.actions.ts#FulfillmentInput',
      'vfs://./actions/fulfillment.actions.ts#FulfillmentResult',
    ],
    [
      'expense-approval',
      'BizProcess',
      'depa.flows.demo.ExpenseApproval',
      'vfs://./actions/expense.actions.ts#ExpenseApprovalInput',
      'vfs://./actions/expense.actions.ts#ExpenseApprovalOutput',
    ],
  ] as const)(
    'projects the canonical %s FlowContract for materialization consumers',
    (bundleName, form, id, input, output) => {
      const result = loadFlowBundle(path.join(path.resolve(import.meta.dir, '../../..'), 'examples/xnl-bundles', bundleName));

      expect(result.diagnostics).toEqual([]);
      expect(result.spec).toMatchObject({
        form,
        flowContract: { id, input, output },
      });
    },
  );

  it.each(['InstantFlow', 'WorkFlow', 'BizProcess'] as const)('projects the %s FlowContract callable boundary', (form) => {
    const result = loadFlowBundleFromSources({
      'manifest.xnl': `<${form} #depa.flows.test.Contract apiVersion="depa.flows/v1" version="1.0.0" (
        <FlowContract #depa.flows.test.Contract {
          input = "vfs://./flow-code/types.ts#Input"
          output = "vfs://./flow-code/types.ts#Output"
        }>
      ) [<Return #done>]>`,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.spec?.flowContract).toEqual({
      id: 'depa.flows.test.Contract',
      input: 'vfs://./flow-code/types.ts#Input',
      output: 'vfs://./flow-code/types.ts#Output',
    });
  });

  it('rejects an invalid CtrlFlow FlowContract boundary', () => {
    const result = loadFlowBundleFromSources({
      'manifest.xnl': `<InstantFlow #depa.flows.test.Contract apiVersion="depa.flows/v1" version="1.0.0" (
        <FlowContract #depa.flows.test.Other { input = "Input" }>
      ) [<Return #done>]>`,
    });
    expect(result.spec?.diagnostics.map(({ code }) => code)).toContain('flow-contract-id-mismatch');
    expect(result.spec?.diagnostics.map(({ code }) => code)).toContain('invalid-flow-contract-type-ref');
  });

  it('rejects a missing CtrlFlow FlowContract', () => {
    const result = loadFlowBundleFromSources({
      'manifest.xnl': '<InstantFlow #depa.flows.test.Missing apiVersion="depa.flows/v1" version="1.0.0" [<Return #done>]>',
    });
    expect(result.diagnostics.map(({ code }) => code)).toContain('missing-flow-contract');
  });

  it.each([
    ['InstantFlow', 'ExternalJob'],
    ['InstantFlow', 'Timer'],
    ['InstantFlow', 'TaskStep'],
    ['WorkFlow', 'TaskStep'],
  ] as const)('rejects %s capability <%s> with a stable diagnostic', (form, tag) => {
    const result = loadFlowBundleFromSources({
      'manifest.xnl': manifest(form, `<${tag} #unsupported>`),
    });
    expect(result.diagnostics.map(({ code }) => code)).toEqual(['statement-not-allowed']);
  });

  it.each(['InstantFlow', 'WorkFlow', 'BizProcess'] as const)(
    'accepts the shared orchestration primitive matrix in %s',
    (form) => {
      const result = loadFlowBundleFromSources({
        'manifest.xnl': manifest(form, `
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
          <CallFlow #call { flow = "instant-flow://depa.flows.Child" }>
        `),
      });

      expect(result.diagnostics).toEqual([]);
    },
  );

  it('rejects invalid orchestration policies before runtime', () => {
    const result = loadFlowBundleFromSources({
      'manifest.xnl': manifest('InstantFlow', `
        <Retry #retry { maxAttempts = 0 } [<Return #retry-result>]>
        <Timeout #timeout { timeoutMs = -1 } [<Return #timeout-result>]>
        <Race #race { mode = "fastest" } (<Candidates []>)>
      `),
    });
    expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'invalid-positive-integer',
      'invalid-timeout',
      'empty-concurrent-domain',
      'invalid-race-mode',
    ]));
  });
});

describe('removed authoring shapes', () => {
  it.each([
    {
      name: 'Tree domain',
      files: {
        'manifest.xnl': manifest('InstantFlow', '<Run #ok { src = "vfs://./a.ts#run" }>'),
        'tree.xnl': '<Tree [ <Sequence #legacy> ]>',
      },
      code: 'legacy-tree-domain',
    },
    {
      name: 'action.types domain',
      files: {
        'manifest.xnl': manifest('InstantFlow', '<Run #ok { src = "vfs://./a.ts#run" }>'),
        'action.types.xnl': '<ActionTypes [ <ActionType #legacy.Action { src = "vfs://./a.ts#Action" }> ]>',
      },
      code: 'legacy-action-types-domain',
    },
    {
      name: 'standalone CtrlFlow root',
      files: { 'manifest.xnl': '<CtrlFlow #depa.flows.test.Legacy [ <Run #legacy> ]>' },
      code: 'legacy-ctrl-flow-root',
    },
    {
      name: 'standalone Tree root',
      files: { 'tree.xnl': '<Tree [ <Run #legacy> ]>' },
      code: 'legacy-tree-domain',
    },
    ...(['Sequence', 'Selector', 'Condition'] as const).map((tag) => ({
      name: `public ${tag}`,
      files: { 'manifest.xnl': manifest('InstantFlow', `<${tag} #legacy>`) },
      code: 'legacy-public-control-node',
    })),
    {
      name: 'public behavior-tree action',
      files: { 'manifest.xnl': manifest('InstantFlow', '<SetVariable #legacy { assignTo = "x" value = 1 }>') },
      code: 'legacy-public-action-node',
    },
    {
      name: 'registered dotted action',
      files: { 'manifest.xnl': manifest('InstantFlow', '<legacy.Action #run>') },
      code: 'legacy-public-action-node',
    },
  ])('rejects $name with a stable diagnostic and no executable spec', ({ files, code }) => {
    const result = loadFlowBundle(bundle(files));

    expect(result.spec).toBeUndefined();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  });
});
