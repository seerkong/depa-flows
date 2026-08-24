import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EagerDataFlowRegistry } from 'eager-data-flow-contract';
import {
  loadEagerDataFlowDirectory,
  loadEagerDataFlowProfileSources,
  loadEagerDataFlowSources,
} from 'eager-data-flow-logic';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const codes = (result: ReturnType<typeof loadEagerDataFlowSources>) =>
  result.diagnostics.map((diagnostic) => diagnostic.code);

const validSource = (body?: string) => `
<EagerDataFlow #depa.test.Export apiVersion="depa.flows/v1" version="1.0.0" (
  <FlowContract #depa.test.Export {
    input = "vfs://./flow-code/types.ts#ExportInput"
    output = "vfs://./flow-code/types.ts#ExportOutput"
    inputPorts = ["raw"]
    outputPorts = ["result"]
  }>
) [
  ${body ?? `
  <EntryNode #entry>
  <TransformNode #normalize {
    inputs = { raw = "flow-port://#entry/raw" }
    outputs = ["normalized"]
    src = "vfs://./flow-code/export.ts#normalize"
  }>
  <SinkNode #audit {
    inputs = { normalized = "flow-port://#normalize/normalized" }
    src = "vfs://./flow-code/export.ts#audit"
  }>
  <TransformNode #finish {
    inputs = { normalized = "flow-port://#normalize/normalized" }
    outputs = ["result"]
    waitFor = ["flow-node://#audit"]
    src = "vfs://./flow-code/export.ts#finish"
  }>
  <ReturnNode #return {
    inputs = { result = "flow-port://#finish/result" }
  }>`}
]>
`;

describe('EagerDataFlow source loader', () => {
  test('loads an explicit AI profile root through EagerDataFlow grammar without widening the canonical loader', () => {
    const source = validSource().replace('<EagerDataFlow ', '<AIDataWorkflow ');
    const profile = loadEagerDataFlowProfileSources({ 'manifest.xnl': source }, {
      profileRoot: 'AIDataWorkflow',
    });
    const canonical = loadEagerDataFlowSources({ 'manifest.xnl': source });

    expect(profile.diagnostics).toEqual([]);
    expect(profile.plan).toMatchObject({
      form: 'EagerDataFlow',
      fqn: 'depa.test.Export',
      declarationOrder: ['entry', 'normalize', 'audit', 'finish', 'return'],
    });
    expect(canonical.plan).toBeUndefined();
    expect(codes(canonical)).toEqual(expect.arrayContaining([
      'unsupported-eager-source-root',
      'eager-data-flow-root-count',
    ]));
  });

  test('rejects a wrong explicit profile root without falling back to EagerDataFlow', () => {
    const result = loadEagerDataFlowProfileSources({ 'manifest.xnl': validSource() }, {
      profileRoot: 'AIDataWorkflow',
    });

    expect(result.plan).toBeUndefined();
    expect(codes(result)).toContain('profile-root-count');
  });

  test('loads named XNL sources and preserves distinct edge categories', () => {
    const result = loadEagerDataFlowSources([
      { name: 'flows/export/manifest.xnl', content: validSource() },
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.plan?.declarationOrder).toEqual([
      'entry',
      'normalize',
      'audit',
      'finish',
      'return',
    ]);
    expect(result.plan?.dataEdges).toEqual([
      {
        kind: 'data',
        fromNodeId: 'entry',
        fromPort: 'raw',
        toNodeId: 'normalize',
        toInput: 'raw',
        ref: 'flow-port://#entry/raw',
      },
      {
        kind: 'data',
        fromNodeId: 'normalize',
        fromPort: 'normalized',
        toNodeId: 'audit',
        toInput: 'normalized',
        ref: 'flow-port://#normalize/normalized',
      },
      {
        kind: 'data',
        fromNodeId: 'normalize',
        fromPort: 'normalized',
        toNodeId: 'finish',
        toInput: 'normalized',
        ref: 'flow-port://#normalize/normalized',
      },
      {
        kind: 'data',
        fromNodeId: 'finish',
        fromPort: 'result',
        toNodeId: 'return',
        toInput: 'result',
        ref: 'flow-port://#finish/result',
      },
    ]);
    expect(result.plan?.waitForEdges).toEqual([
      {
        kind: 'waitFor',
        fromNodeId: 'audit',
        toNodeId: 'finish',
        ref: 'flow-node://#audit',
      },
    ]);
    expect(result.plan?.subflowEdges).toEqual([]);
    expect(result.plan?.nodeById.finish?.tag).toBe('TransformNode');
  });

  test('preserves ordinary closed config objects that declare a domain kind field', () => {
    const result = loadEagerDataFlowProfileSources({
      'manifest.xnl': validSource(`
        <EntryNode #entry>
        <TransformNode #normalize {
          inputs = { raw = "flow-port://#entry/raw" }
          outputs = ["result"]
          src = "vfs://./flow-code/export.ts#normalize"
          config = {
            target = {
              kind = "holon-task-target"
              nested = { kind = "member" memberRef = "member-reviewer" }
            }
          }
        }>
        <ReturnNode #return { inputs = { result = "flow-port://#normalize/result" } }>
      `).replace('<EagerDataFlow ', '<AIDataWorkflow '),
    }, { profileRoot: 'AIDataWorkflow' });

    expect(result.diagnostics).toEqual([]);
    expect(result.plan?.nodeById.normalize).toMatchObject({
      tag: 'TransformNode',
      config: {
        target: {
          kind: 'holon-task-target',
          nested: { kind: 'member', memberRef: 'member-reviewer' },
        },
      },
    });
  });

  test('keeps filesystem loading as a thin adapter over named sources', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'eager-flow-'));
    tempDirs.push(dir);
    writeFileSync(path.join(dir, 'manifest.xnl'), validSource());

    const fromDirectory = loadEagerDataFlowDirectory(dir);
    const fromSources = loadEagerDataFlowSources(
      { 'manifest.xnl': validSource() },
      { baseUri: path.resolve(dir) },
    );

    expect(fromDirectory).toEqual(fromSources);
  });

  test('rejects the removed DataFlow root with a stable diagnostic and no alias', () => {
    const result = loadEagerDataFlowSources({
      'legacy.xnl': '<DataFlow #depa.test.Legacy apiVersion="depa.flows/v1" version="1" []>',
    });

    expect(result.plan).toBeUndefined();
    expect(codes(result)).toContain('legacy-data-flow-root');
  });

  test('rejects lazy DataGraph node tags with a stable diagnostic', () => {
    const result = loadEagerDataFlowSources({
      'manifest.xnl': validSource(`
        <EntryNode #entry>
        <ComputedNode #compute>
        <ReturnNode #return { inputs = { result = "flow-port://#entry/raw" } }>
      `),
    });

    expect(result.plan).toBeUndefined();
    expect(codes(result)).toContain('lazy-data-graph-node');
  });

  test('requires exactly one contract, entry, and return', () => {
    const result = loadEagerDataFlowSources({
      'manifest.xnl': `
        <EagerDataFlow #depa.test.Empty apiVersion="depa.flows/v1" version="1" []>
      `,
    });

    expect(codes(result)).toEqual(
      expect.arrayContaining(['flow-contract-count', 'entry-node-count', 'return-node-count']),
    );
  });

  test('validates ids, ports, and reference schemes', () => {
    const result = loadEagerDataFlowSources({
      'manifest.xnl': `
        <EagerDataFlow #depa.test.Invalid apiVersion="depa.flows/v1" version="1" (
          <FlowContract #depa.test.Other { inputPorts = ["bad.port"] outputPorts = ["result"] }>
        ) [
          <EntryNode #entry>
          <TransformNode #bad.node {
            inputs = { raw = "flow-node://#entry" }
            outputs = ["bad.port"]
            src = "./not-vfs.ts#run"
          }>
          <ReturnNode #return { inputs = { result = "flow-port://#missing/result" } }>
        ]>
      `,
    });

    expect(codes(result)).toEqual(
      expect.arrayContaining([
        'flow-contract-id-mismatch',
        'invalid-port-name',
        'invalid-node-id',
        'invalid-flow-port-ref',
        'invalid-code-ref',
        'unknown-source-node',
      ]),
    );
  });

  test('rejects cycles across the union of data and wait-for edges', () => {
    const result = loadEagerDataFlowSources({
      'manifest.xnl': validSource(`
        <EntryNode #entry>
        <TransformNode #left {
          inputs = { raw = "flow-port://#entry/raw" }
          outputs = ["left"]
          waitFor = ["flow-node://#right"]
          src = "vfs://./flow-code/export.ts#left"
        }>
        <TransformNode #right {
          inputs = { left = "flow-port://#left/left" }
          outputs = ["result"]
          src = "vfs://./flow-code/export.ts#right"
        }>
        <ReturnNode #return { inputs = { result = "flow-port://#right/result" } }>
      `),
    });

    expect(codes(result)).toContain('union-dag-cycle');
  });

  test('rejects nodes unreachable from Entry', () => {
    const result = loadEagerDataFlowSources({
      'manifest.xnl': validSource(`
        <EntryNode #entry>
        <TransformNode #orphan {
          inputs = { value = "flow-port://#source/value" }
          outputs = ["result"]
          src = "vfs://./flow-code/export.ts#orphan"
        }>
        <TransformNode #source {
          inputs = { value = "flow-port://#orphan/result" }
          outputs = ["value"]
          src = "vfs://./flow-code/export.ts#source"
        }>
        <ReturnNode #return { inputs = { result = "flow-port://#orphan/result" } }>
      `),
    });

    expect(codes(result)).toEqual(
      expect.arrayContaining(['union-dag-cycle', 'unreachable-node']),
    );
  });

  test('enforces Return input shape and forbids outgoing Return data', () => {
    const result = loadEagerDataFlowSources({
      'manifest.xnl': validSource(`
        <EntryNode #entry>
        <ReturnNode #return { inputs = { wrong = "flow-port://#entry/raw" } }>
        <SinkNode #after {
          inputs = { value = "flow-port://#return/result" }
          src = "vfs://./flow-code/export.ts#after"
        }>
      `),
    });

    expect(codes(result)).toEqual(
      expect.arrayContaining(['return-input-mismatch', 'return-outgoing-data']),
    );
  });
});

describe('EagerDataFlow subflow linking', () => {
  const childContract = {
    id: 'depa.test.Child',
    inputPorts: ['value'],
    outputPorts: ['mapped'],
  } as const;

  const registry = (overrides = {}): EagerDataFlowRegistry => ({
    'depa.test.Child': {
      form: 'EagerDataFlow',
      contract: childContract,
      subflowTargets: [],
      ...overrides,
    },
  });

  const parentSource = (flow = 'depa.test.Child', input = 'value') => `
    <EagerDataFlow #depa.test.Parent apiVersion="depa.flows/v1" version="1" (
      <FlowContract #depa.test.Parent { inputPorts = ["value"] outputPorts = ["mapped"] }>
    ) [
      <EntryNode #entry>
      <SubFlowNode #child {
        flow = "eager-data-flow://${flow}"
        inputs = { ${input} = "flow-port://#entry/value" }
      }>
      <ReturnNode #return { inputs = { mapped = "flow-port://#child/mapped" } }>
    ]>
  `;

  test('derives SubFlow outputs from a registered contract', () => {
    const result = loadEagerDataFlowSources(
      { 'manifest.xnl': parentSource() },
      { registry: registry() },
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.plan?.nodeById.child).toMatchObject({
      tag: 'SubFlowNode',
      flow: 'eager-data-flow://depa.test.Child',
      outputs: ['mapped'],
    });
    expect(result.plan?.subflowEdges).toEqual([
      {
        kind: 'subflow',
        fromFlowId: 'depa.test.Parent',
        nodeId: 'child',
        targetFlowId: 'depa.test.Child',
        ref: 'eager-data-flow://depa.test.Child',
      },
    ]);
  });

  test('rejects unregistered or non-EagerDataFlow targets', () => {
    const missing = loadEagerDataFlowSources({ 'manifest.xnl': parentSource() });
    const wrongRoot = loadEagerDataFlowSources(
      { 'manifest.xnl': parentSource() },
      {
        registry: registry({ form: 'WorkCtrlFlow' }),
      },
    );

    expect(codes(missing)).toContain('unregistered-subflow');
    expect(codes(wrongRoot)).toContain('subflow-root-mismatch');
  });

  test('requires SubFlow inputs to match the target contract exactly', () => {
    const result = loadEagerDataFlowSources(
      { 'manifest.xnl': parentSource('depa.test.Child', 'wrong') },
      { registry: registry() },
    );

    expect(codes(result)).toContain('subflow-input-mismatch');
  });

  test('rejects direct and indirect subflow recursion', () => {
    const direct = loadEagerDataFlowSources(
      { 'manifest.xnl': parentSource('depa.test.Parent') },
      {
        registry: {
          'depa.test.Parent': {
            form: 'EagerDataFlow',
            contract: {
              id: 'depa.test.Parent',
              inputPorts: ['value'],
              outputPorts: ['mapped'],
            },
            subflowTargets: [],
          },
        },
      },
    );
    const indirect = loadEagerDataFlowSources(
      { 'manifest.xnl': parentSource() },
      {
        registry: registry({ subflowTargets: ['depa.test.Parent'] }),
      },
    );

    expect(codes(direct)).toContain('recursive-subflow');
    expect(codes(indirect)).toContain('recursive-subflow');
  });
});
