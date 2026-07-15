import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BehaviorTreeNodeKind, type BehaviorTreeNode } from 'depa-behavior-tree';
import {
  compileBundle,
  FlowCompileError,
  loadFlowBundle,
  loadFlowBundleFromSources,
  runInstantFlow,
  runInstantFlowSources,
} from '../src/index.js';

const ROOT = path.resolve(import.meta.dir, '../../..');
const demo = (name: string) => path.join(ROOT, 'examples/xnl-bundles', name);

function makeBundle(manifest: string, code: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instant-flow-'));
  fs.writeFileSync(path.join(dir, 'manifest.xnl'), manifest);
  fs.writeFileSync(path.join(dir, 'flow-code.ts'), code);
  return dir;
}

function findNode(root: BehaviorTreeNode, key: string): BehaviorTreeNode | undefined {
  if (root.Key === key) return root;
  for (const child of root.Children) {
    const found = findNode(child, key);
    if (found) return found;
  }
}

describe('canonical compile projection', () => {
  it('lowers the canonical WorkFlow profile bundle to executable internal IR', () => {
    const { spec, diagnostics } = loadFlowBundle(demo('order-fulfillment'));
    expect(diagnostics).toEqual([]);
    const plan = compileBundle(spec!, (_spec, node, { meta, attrs }) => {
      if (node.tag === 'ExternalJob' || node.tag === 'Timer') {
        return {
          Kind: BehaviorTreeNodeKind.Action,
          Type: `test.${node.tag}`,
          Key: meta.key,
          Name: meta.name,
          Status: 'Init' as never,
          Config: attrs,
          Children: [],
        };
      }
      return null;
    });

    expect(plan.Kind).toBe(BehaviorTreeNodeKind.Sequence);
    const reserve = findNode(plan, 'reserve-inventory');
    expect(reserve?.Type).toBe('flow.Retry');
    expect((reserve?.Config as { statements?: Array<{ id?: string }> }).statements?.[0]?.id).toBe('reserve-primary');
    expect(findNode(plan, 'complete-fulfillment')?.Type).toBe('flow.Parallel');
    expect(findNode(plan, 'fulfilled')?.Type).toBe('flow.Return');
  });

  it('keeps interruptible statements illegal without a profile extension', () => {
    const { spec } = loadFlowBundle(demo('order-fulfillment'));
    expect(() => compileBundle(spec!)).toThrow(FlowCompileError);
  });
});

describe('InstantFlow execution', () => {
  it('runs named sources through an injected resolver with runtime/input/config', async () => {
    const runtime = { calls: [] as unknown[] };
    const output = await runInstantFlowSources<{ value: number }>({
      'manifest.xnl': `<InstantFlow #test.Source apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.Source>
      ) [
        <Run #increment { src = "vfs://./code.ts#increment" config = { by = 2 } }>
        <Return #done>
      ]>`,
    }, {
      runtime,
      input: { value: 3 },
      resolveCode: ({ reference, flowId, nodeId, baseUri }) => {
        expect({ reference, flowId, nodeId, baseUri }).toEqual({
          reference: 'vfs://./code.ts#increment',
          flowId: 'test.Source',
          nodeId: 'increment',
          baseUri: undefined,
        });
        return (receivedRuntime, input, config) => {
          (receivedRuntime.calls as unknown[]).push({ input, config });
          return { value: (input as { value: number }).value + Number(config.by) };
        };
      },
    });

    expect(output).toEqual({ value: 5 });
    expect(runtime.calls).toEqual([{ input: { value: 3 }, config: { by: 2 } }]);
  });

  it('runs dynamic functions with runtime/input/config, loops, selects first match and short-circuits Return', async () => {
    const calls: string[] = [];
    const bundle = makeBundle(
      `<InstantFlow #test.Canonical apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.Canonical>
      ) [
        <Run #increment { src = "vfs://./flow-code.ts#increment" config = { by = 1 } }>
        <If #route (
          <Branches [
            <Branch #first { when = "vfs://./flow-code.ts#isTwo" } [
              <Run #branch { src = "vfs://./flow-code.ts#increment" config = { by = 1 } }>
            ]>
            <Branch #must-not-run { when = "vfs://./flow-code.ts#mustNotRunPredicate" } []>
            <Otherwise [ <Run #otherwise { src = "vfs://./flow-code.ts#mustNotRun" }> ]>
          ]>
        )>
        <Until #until-four { when = "vfs://./flow-code.ts#isFour" maxIterations = 3 } [
          <Run #loop { src = "vfs://./flow-code.ts#increment" config = { by = 1 } }>
        ]>
        <Return #result { src = "vfs://./flow-code.ts#result" config = { label = "done" } }>
        <Run #after-return { src = "vfs://./flow-code.ts#mustNotRun" }>
      ]>`,
      `
        export function increment(runtime, input, config) {
          runtime.calls.push('increment:' + config.by);
          return { value: input.value + config.by };
        }
        export function isTwo(runtime, input, config) {
          runtime.calls.push('isTwo:' + input.value + ':' + Object.keys(config).length);
          return input.value === 2;
        }
        export function isFour(runtime, input) {
          runtime.calls.push('isFour:' + input.value);
          return input.value === 4;
        }
        export function result(runtime, input, config) {
          runtime.calls.push('result:' + config.label);
          return { ...input, label: config.label };
        }
        export function mustNotRunPredicate() { throw new Error('later predicate ran'); }
        export function mustNotRun() { throw new Error('statement after Return ran'); }
      `,
    );

    const output = await runInstantFlow<{ value: number; label: string }>(bundle, {
      input: { value: 1 },
      runtime: { calls },
    });
    expect(output).toEqual({ value: 4, label: 'done' });
    expect(calls).toEqual([
      'increment:1',
      'isTwo:2:0',
      'increment:1',
      'isFour:3',
      'increment:1',
      'isFour:4',
      'result:done',
    ]);
  });

  it('restarts each Fallback strategy from the same input and returns current input for empty Return', async () => {
    const seen: unknown[] = [];
    const bundle = makeBundle(
      `<InstantFlow #test.Fallback apiVersion="depa.flows/v1" version="1" (
        <FlowContract #test.Fallback>
      ) [
        <Fallback #fallback [
          <Strategy #primary [ <Run #fail { src = "vfs://./flow-code.ts#fail" }> ]>
          <Strategy #replica [ <Run #succeed { src = "vfs://./flow-code.ts#succeed" }> ]>
        ]>
        <If #no-match (
          <Branches [ <Branch #never { when = "vfs://./flow-code.ts#never" } []> ]>
        )>
        <Return #result>
      ]>`,
      `
        export function fail(runtime, input) { runtime.seen.push(input); throw new Error('primary unavailable'); }
        export function succeed(runtime, input) { runtime.seen.push(input); return { source: 'replica', original: input }; }
        export function never() { return false; }
      `,
    );
    const input = { requestId: 'r1' };
    const output = await runInstantFlow(bundle, { input, runtime: { seen } });
    expect(seen).toEqual([input, input]);
    expect(output).toEqual({ source: 'replica', original: input });
  });

  it('runs the migrated InstantFlow demo end to end', async () => {
    const loaded = loadFlowBundle(demo('instant-http-check'));
    expect(loaded.spec?.flowContract).toEqual({
      id: 'depa.flows.demo.InstantHttpCheck',
      input: 'vfs://./actions/health.actions.ts#HealthCheckInput',
      output: 'vfs://./actions/health.actions.ts#HealthCheckResult',
    });

    const output = await runInstantFlow<{
      outcome: string;
      endpoint: string;
      attempts: number;
      status?: number;
    }>(demo('instant-http-check'), {
      runtime: { http: async () => ({ status: 200 }) },
    });
    expect(output).toEqual({
      outcome: 'healthy',
      endpoint: 'primary',
      attempts: 1,
      status: 200,
    });
  });

  it('executes semantic retry, foreach, parallel, race and synchronous subflow primitives', async () => {
    const source = (body: string) => `<InstantFlow #test.Orchestration apiVersion="depa.flows/v1" version="1" (
      <FlowContract #test.Orchestration>
    ) [${body}]>`;
    const functions: Record<string, (runtime: any, input: any) => any> = {
      requireArray: (_runtime, input) => Array.isArray(input),
      selectItems: (_runtime, input) => input,
      double: (_runtime, input) => input * 2,
      sum: (_runtime, input) => Object.values(input).reduce((total: number, value) => total + Number(value), 0),
      fast: async () => 'fast',
      slow: async (runtime) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (runtime.abortSignal?.aborted) throw new Error('cancelled');
        return 'slow';
      },
      flaky: (runtime, input) => {
        runtime.attempts += 1;
        if (runtime.attempts < 2) throw new Error('retry');
        return input;
      },
    };
    const resolveCode = ({ reference }: { reference: string }) => functions[reference.split('#')[1]];
    const output = await runInstantFlowSources({
      'manifest.xnl': source(`
        <Require #array { when = "vfs://./code.ts#requireArray" }>
        <ForEach #double-all { when = "vfs://./code.ts#selectItems" } [
          <Run #double { src = "vfs://./code.ts#double" }>
        ]>
        <Parallel #aggregate (
          <Lanes [
            <Lane #left [<Run #left-value { src = "vfs://./code.ts#sum" }>]>
            <Lane #right [<Run #right-value { src = "vfs://./code.ts#sum" }>]>
          ]>
        )>
        <Retry #retry { maxAttempts = 2 } [
          <Run #flaky { src = "vfs://./code.ts#flaky" }>
        ]>
        <Race #race { mode = "first-success" } (
          <Candidates [
            <Candidate #slow [<Run #slow-run { src = "vfs://./code.ts#slow" }>]>
            <Candidate #fast [<Run #fast-run { src = "vfs://./code.ts#fast" }>]>
          ]>
        )>
        <CallFlow #child { flow = "instant-flow://test.Child" }>
        <Return #done>
      `),
    }, {
      input: [1, 2],
      runtime: { attempts: 0 },
      resolveCode,
      resolveFlow: async () => ({
        spec: loadFlowBundleFromSources({
          'manifest.xnl': `<InstantFlow #test.Child apiVersion="depa.flows/v1" version="1" (
            <FlowContract #test.Child>
          ) [<Return #child-result { value = "called" }>]>`,
        }).spec!,
        resolveCode,
      }),
    });
    expect(output).toBe('called');
  });

  it('turns Require rejection and Timeout cancellation into technical flow failures', async () => {
    const resolveCode = ({ reference }: { reference: string }) => {
      if (reference.endsWith('#deny')) return () => false;
      return async (runtime: any) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (runtime.abortSignal?.aborted) throw new Error('cancelled');
        return 'late';
      };
    };
    const manifest = (statement: string) => `<InstantFlow #test.Guards apiVersion="depa.flows/v1" version="1" (
      <FlowContract #test.Guards>
    ) [${statement}]>`;
    await expect(runInstantFlowSources({
      'manifest.xnl': manifest('<Require #allowed { when = "vfs://./code.ts#deny" }>'),
    }, { resolveCode })).rejects.toMatchObject({ cause: expect.any(Error) });
    await expect(runInstantFlowSources({
      'manifest.xnl': manifest(`<Timeout #deadline { timeoutMs = 1 } [
        <Run #slow { src = "vfs://./code.ts#slow" }>
      ]>`),
    }, { resolveCode })).rejects.toMatchObject({ cause: expect.any(Error) });
  });
});
