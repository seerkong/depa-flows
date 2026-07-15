import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import type {
  EagerDataFlowAuthoringPlan,
  EagerDataFlowCode,
  EagerDataFlowRegistry,
} from 'eager-data-flow-contract';
import {
  EagerDataFlowExecutionError,
  EagerDataFlowMaterializationError,
  createFilesystemCodeResolver,
  loadEagerDataFlowDirectory,
  loadEagerDataFlowSources,
  materializeEagerDataFlowPlan,
  runEagerDataFlowSources,
} from 'eager-data-flow-logic';

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function source(flowId: string, nodes: string, inputPorts = ['value'], outputPorts = ['result']) {
  return `
    <EagerDataFlow #${flowId} apiVersion="depa.flows/v1" version="1.0.0" (
      <FlowContract #${flowId} {
        inputPorts = [${inputPorts.map((port) => `"${port}"`).join(' ')}]
        outputPorts = [${outputPorts.map((port) => `"${port}"`).join(' ')}]
      }>
    ) [${nodes}]>
  `;
}

function plan(content: string, registry?: EagerDataFlowRegistry): EagerDataFlowAuthoringPlan {
  const result = loadEagerDataFlowSources({ 'manifest.xnl': content }, { registry });
  expect(result.diagnostics).toEqual([]);
  expect(result.plan).toBeDefined();
  return result.plan!;
}

function resolver<Runtime = unknown>(functions: Record<string, EagerDataFlowCode<Runtime>>) {
  return async ({ reference }: { reference: string }) => {
    const exportName = reference.slice(reference.lastIndexOf('#') + 1);
    const fn = functions[exportName];
    if (!fn) throw new Error(`missing test export ${exportName}`);
    return fn;
  };
}

describe('EagerDataFlow materialization and scheduling', () => {
  test('starts every ready node concurrently and invokes code with runtime, input, config', async () => {
    let active = 0;
    let maxActive = 0;
    const calls: unknown[][] = [];
    const branch = (side: string): EagerDataFlowCode<{ marker: string }> => async (runtime, input, config) => {
      calls.push([runtime.marker, input.value, config.side]);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(15);
      active -= 1;
      return { [side]: `${input.value}-${config.side}` };
    };
    const flow = plan(source('depa.test.Concurrent', `
      <EntryNode #entry>
      <TransformNode #left {
        inputs = { value = "flow-port://#entry/value" }
        outputs = ["left"]
        src = "vfs://./flow-code.ts#left"
        config = { side = "L" }
      }>
      <TransformNode #right {
        inputs = { value = "flow-port://#entry/value" }
        outputs = ["right"]
        src = "vfs://./flow-code.ts#right"
        config = { side = "R" }
      }>
      <TransformNode #join {
        inputs = { left = "flow-port://#left/left" right = "flow-port://#right/right" }
        outputs = ["result"]
        src = "vfs://./flow-code.ts#join"
      }>
      <ReturnNode #return { inputs = { result = "flow-port://#join/result" } }>
    `));
    const executable = await materializeEagerDataFlowPlan(flow, {
      resolveCode: resolver({
        left: branch('left'),
        right: branch('right'),
        join: (_runtime, input) => ({ result: `${input.left}|${input.right}` }),
      }),
    });

    await expect(executable.invoke({ marker: 'runtime' }, { value: 'x' })).resolves.toEqual({
      result: 'x-L|x-R',
    });
    expect(maxActive).toBe(2);
    expect(calls).toEqual([
      ['runtime', 'x', 'L'],
      ['runtime', 'x', 'R'],
    ]);
  });

  test('honors waitFor and lets Return complete before independent work while awaiting convergence', async () => {
    const events: string[] = [];
    const flow = plan(source('depa.test.Convergence', `
      <EntryNode #entry>
      <TransformNode #fast {
        inputs = { value = "flow-port://#entry/value" }
        outputs = ["result"]
        src = "vfs://./flow-code.ts#fast"
      }>
      <SinkNode #slow {
        inputs = { value = "flow-port://#entry/value" }
        src = "vfs://./flow-code.ts#slow"
      }>
      <ReturnNode #return { inputs = { result = "flow-port://#fast/result" } }>
      <SinkNode #afterReturn {
        inputs = { value = "flow-port://#entry/value" }
        waitFor = ["flow-node://#return"]
        src = "vfs://./flow-code.ts#afterReturn"
      }>
      <SinkNode #afterSlow {
        inputs = { value = "flow-port://#entry/value" }
        waitFor = ["flow-node://#slow"]
        src = "vfs://./flow-code.ts#afterSlow"
      }>
    `));
    const executable = await materializeEagerDataFlowPlan(flow, {
      resolveCode: resolver({
        fast: () => ({ result: 'done' }),
        slow: async () => {
          events.push('slow-start');
          await sleep(25);
          events.push('slow-end');
        },
        afterReturn: () => {
          events.push('return-complete');
        },
        afterSlow: () => {
          events.push('waitFor-complete');
        },
      }),
    });

    const invocation = executable.invoke({}, { value: 1 });
    await sleep(8);
    expect(events).toContain('return-complete');
    expect(events).not.toContain('slow-end');
    await expect(invocation).resolves.toEqual({ result: 'done' });
    expect(events.indexOf('waitFor-complete')).toBeGreaterThan(events.indexOf('slow-end'));
  });

  test('validates Transform outputs atomically and requires Sink to return void', async () => {
    let downstreamRuns = 0;
    const invalidTransform = plan(source('depa.test.Atomic', `
      <EntryNode #entry>
      <TransformNode #bad {
        inputs = { value = "flow-port://#entry/value" }
        outputs = ["left" "result"]
        src = "vfs://./flow-code.ts#bad"
      }>
      <SinkNode #downstream {
        inputs = { left = "flow-port://#bad/left" }
        src = "vfs://./flow-code.ts#downstream"
      }>
      <ReturnNode #return { inputs = { result = "flow-port://#bad/result" } }>
    `));
    const atomic = await materializeEagerDataFlowPlan(invalidTransform, {
      resolveCode: resolver({
        bad: () => ({ left: 'published-too-early' }),
        downstream: () => {
          downstreamRuns += 1;
        },
      }),
    });

    await expect(atomic.invoke({}, { value: 1 })).rejects.toMatchObject({ nodeId: 'bad' });
    expect(downstreamRuns).toBe(0);

    const invalidSink = plan(source('depa.test.SinkVoid', `
      <EntryNode #entry>
      <TransformNode #pass {
        inputs = { value = "flow-port://#entry/value" }
        outputs = ["result"]
        src = "vfs://./flow-code.ts#pass"
      }>
      <SinkNode #sink {
        inputs = { value = "flow-port://#entry/value" }
        src = "vfs://./flow-code.ts#sink"
      }>
      <ReturnNode #return { inputs = { result = "flow-port://#pass/result" } }>
    `));
    const sink = await materializeEagerDataFlowPlan(invalidSink, {
      resolveCode: resolver({ pass: (_runtime, input) => ({ result: input.value }), sink: () => 'not-void' }),
    });
    await expect(sink.invoke({}, { value: 1 })).rejects.toMatchObject({ nodeId: 'sink' });
  });

  test('runs registered subflows in isolated invocations and checks the linked contract', async () => {
    const childPlan = plan(source('depa.test.Child', `
      <EntryNode #entry>
      <TransformNode #map {
        inputs = { value = "flow-port://#entry/value" }
        outputs = ["mapped"]
        src = "vfs://./child.ts#map"
      }>
      <ReturnNode #return { inputs = { mapped = "flow-port://#map/mapped" } }>
    `, ['value'], ['mapped']));
    const child = await materializeEagerDataFlowPlan(childPlan, {
      resolveCode: resolver({ map: async (_runtime, input) => {
        await sleep(input.value === 'a' ? 10 : 1);
        return { mapped: String(input.value).toUpperCase() };
      } }),
    });
    const parentPlan = plan(source('depa.test.Parent', `
      <EntryNode #entry>
      <SubFlowNode #child {
        flow = "eager-data-flow://depa.test.Child"
        inputs = { value = "flow-port://#entry/value" }
      }>
      <ReturnNode #return { inputs = { result = "flow-port://#child/mapped" } }>
    `), { 'depa.test.Child': childPlan });
    const parent = await materializeEagerDataFlowPlan(parentPlan, {
      resolveCode: resolver({}),
      subflows: { 'depa.test.Child': child },
    });

    await expect(Promise.all([
      parent.invoke({}, { value: 'a' }),
      parent.invoke({}, { value: 'b' }),
    ])).resolves.toEqual([{ result: 'A' }, { result: 'B' }]);

    await expect(materializeEagerDataFlowPlan(parentPlan, {
      resolveCode: resolver({}),
      subflows: {},
    })).rejects.toBeInstanceOf(EagerDataFlowMaterializationError);
  });

  test('chooses the primary concurrent fault by topology layer then declaration order', async () => {
    interface FaultRuntime {
      signal?: AbortSignal;
    }
    let cancellationObserved = false;
    let cancellationNotifications = 0;
    const flow = plan(source('depa.test.Faults', `
      <EntryNode #entry>
      <SinkNode #lowerLayer {
        inputs = { value = "flow-port://#entry/value" }
        src = "vfs://./flow-code.ts#lowerLayer"
      }>
      <TransformNode #advance {
        inputs = { value = "flow-port://#entry/value" }
        outputs = ["advanced"]
        src = "vfs://./flow-code.ts#advance"
      }>
      <TransformNode #deeper {
        inputs = { advanced = "flow-port://#advance/advanced" }
        outputs = ["result"]
        src = "vfs://./flow-code.ts#deeper"
      }>
      <ReturnNode #return { inputs = { result = "flow-port://#deeper/result" } }>
    `));
    const executable = await materializeEagerDataFlowPlan(flow, {
      resolveCode: resolver<FaultRuntime>({
        lowerLayer: async (runtime) => {
          await sleep(20);
          cancellationObserved = runtime.signal?.aborted === true;
          throw new Error('later lower-layer fault');
        },
        advance: () => ({ advanced: true }),
        deeper: async () => {
          await sleep(2);
          throw new Error('earlier deeper fault');
        },
      }),
    });

    try {
      await executable.invoke({}, { value: 1 }, {
        bindSignal: (runtime, signal) => ({ ...runtime, signal }),
        onCancel: () => {
          cancellationNotifications += 1;
        },
      });
      throw new Error('expected invocation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(EagerDataFlowExecutionError);
      const executionError = error as EagerDataFlowExecutionError;
      expect(executionError.nodeId).toBe('lowerLayer');
      expect(executionError.faults.map((fault) => fault.nodeId)).toEqual(['lowerLayer', 'deeper']);
      expect(cancellationObserved).toBe(true);
      expect(cancellationNotifications).toBe(1);
    }
  });

  test('offers a source-based execution API with no ambient importer', async () => {
    const result = await runEagerDataFlowSources({ 'manifest.xnl': source('depa.test.SourceApi', `
      <EntryNode #entry>
      <TransformNode #map {
        inputs = { value = "flow-port://#entry/value" }
        outputs = ["result"]
        src = "vfs://./flow-code.ts#map"
      }>
      <ReturnNode #return { inputs = { result = "flow-port://#map/result" } }>
    `) }, {
      resolveCode: resolver({ map: (_runtime, input) => ({ result: Number(input.value) + 1 }) }),
      runtime: {},
      input: { value: 41 },
    });

    expect(result).toEqual({ result: 42 });
  });

  test('executes the canonical parent and child bundles through an injected VFS importer', async () => {
    const examples = path.resolve(import.meta.dir, '../../../examples/xnl-bundles');
    const childPlan = loadEagerDataFlowDirectory(path.join(examples, 'eager-data-flow-child')).plan!;
    const resolveCode = createFilesystemCodeResolver((specifier) => import(specifier));
    const child = await materializeEagerDataFlowPlan(childPlan, { resolveCode });
    const parentResult = loadEagerDataFlowDirectory(path.join(examples, 'eager-data-flow-parent'), {
      registry: { [childPlan.fqn]: childPlan },
    });
    expect(parentResult.diagnostics).toEqual([]);
    const parent = await materializeEagerDataFlowPlan(parentResult.plan!, {
      resolveCode,
      subflows: { [childPlan.fqn]: child },
    });
    const runtime = { audits: [] as string[] };

    await expect(parent.invoke(runtime, {
      customer: { name: 'Ada', annualSpend: 12000 },
    })).resolves.toEqual({ summary: 'Ada: priority' });
    expect(runtime.audits).toEqual(['priority']);
  });
});
