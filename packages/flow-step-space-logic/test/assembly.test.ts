import { describe, expect, test } from 'bun:test';
import {
  assembleDefinitionStepForest,
  createDefinitionStepSourceRuntime,
  normalizeDefinitionStepForest,
  buildStepMerkleTree,
  createImmutableStepRecord,
  diffStepMerkleTrees,
  mutateDefinitionStep,
} from '../src/index.js';
import type { DefinitionStepAssemblyRuntime } from 'flow-step-space-contract';

const sources = {
  'step-space.xnl': `<StepSpace #example.Space apiVersion="depa.flows/v1" version="1" [
    <StepGroup #main [
      <StepRef #first { src = "steps/first/step.xnl" }>
      <StepGroupRef #nested { src = "groups/nested.xnl" }>
    ]>
  ]>`,
  'groups/nested.xnl': `<StepGroup #nested [
    <StepRef #second { src = "steps/second/step.xnl" }>
  ]>`,
  'steps/first/step.xnl': `<Step #first (
    <Core [ <Run #first { src = "vfs://./flow-code/first.ts#run" }> ]>
    <Extensions [
      <ExtensionRef { kind = "example.audit" src = "steps/first/audit.xnl" schema = "schema://example.audit/v1" }>
    ]>
  )>`,
  'steps/first/audit.xnl': `<StepExtension #first-audit {
    kind = "example.audit"
    schema = "schema://example.audit/v1"
    value = { label = " first " }
  }>`,
  'steps/second/step.xnl': `<Step #second (
    <Core [ <Return #second> ]>
  )>`,
} as const;

const extensionCodecs = {
  resolve(kind: string) {
    return ({
    'example.audit': {
      schemaRef: 'schema://example.audit/v1',
      codec: {
        normalize(value: any) {
          if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.label !== 'string') {
            throw new Error('label is required');
          }
          return { label: value.label.trim() };
        },
      },
    },
    } as const)[kind as 'example.audit'];
  },
} as const;

function runtimeFor(candidate: Record<string, string> = sources): DefinitionStepAssemblyRuntime {
  return { ...createDefinitionStepSourceRuntime(candidate), extensionCodecs };
}

const config = {} as const;

describe('DefinitionStepForest assembly', () => {
  test('loads only the explicit closure through a runtime-first Processor', () => {
    const reads: string[] = [];
    const base = runtimeFor();
    const forest = assembleDefinitionStepForest({
      sources: {
        readSource(ref) {
          reads.push(ref);
          return base.sources.readSource(ref);
        },
      },
      extensionCodecs,
    }, { stepSpaceRef: 'step-space.xnl' }, config);

    expect(reads).toEqual([
      'step-space.xnl',
      'steps/first/step.xnl',
      'steps/first/audit.xnl',
      'groups/nested.xnl',
      'steps/second/step.xnl',
    ]);
    expect(forest.stepOrder).toEqual(['first', 'second']);
    expect(forest.steps.first.core.tag).toBe('Run');
    expect(forest.steps.first.extensions['example.audit'].value).toEqual({ label: 'first' });
    expect(forest.closure.map((entry) => entry.ref)).toEqual(reads);
    expect(forest.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(forest.steps.first.extensions)).toBe(true);
  });

  test('changes only one closure entry and the aggregate artifact digest for a local edit', () => {
    const before = assembleDefinitionStepForest(
      runtimeFor(),
      { stepSpaceRef: 'step-space.xnl' },
      config,
    );
    const after = assembleDefinitionStepForest(
      runtimeFor({
        ...sources,
        'steps/first/audit.xnl': sources['steps/first/audit.xnl'].replace(' first ', ' revised '),
      }),
      { stepSpaceRef: 'step-space.xnl' },
      config,
    );
    const beforeDigests = Object.fromEntries(before.closure.map((entry) => [entry.ref, entry.digest]));
    const afterDigests = Object.fromEntries(after.closure.map((entry) => [entry.ref, entry.digest]));

    expect(after.artifactDigest).not.toBe(before.artifactDigest);
    expect(Object.entries(afterDigests).filter(([ref, digest]) => digest !== beforeDigests[ref]))
      .toEqual([['steps/first/audit.xnl', afterDigests['steps/first/audit.xnl']]]);
  });

  const rejected: Array<[string, Record<string, string>, string, DefinitionStepAssemblyRuntime?]> = [
    ['traversal', { ...sources, 'step-space.xnl': `<StepSpace #s [ <StepRef #first { src = "../step.xnl" }> ]>` }, 'step-source-ref-invalid'],
    ['unknown extension', sources, 'step-extension-kind-undeclared', { ...createDefinitionStepSourceRuntime(sources), extensionCodecs: { resolve: () => undefined } }],
    ['duplicate step id', {
      ...sources,
      'groups/nested.xnl': `<StepGroup #nested [ <StepRef #first { src = "steps/first/step.xnl" }> ]>`,
    }, 'step-id-duplicate'],
    ['reference cycle', {
      ...sources,
      'groups/nested.xnl': `<StepGroup #nested [ <StepGroupRef #main { src = "step-space.xnl" }> ]>`,
    }, 'step-reference-cycle'],
  ];
  for (const [label, candidate, code, candidateRuntime] of rejected) {
    test(`rejects ${label} before producing a forest`, () => {
      expect(() => assembleDefinitionStepForest(
        candidateRuntime ?? runtimeFor(candidate),
        { stepSpaceRef: 'step-space.xnl' },
        config,
      )).toThrow(code);
    });
  }

  test('rejects accessor and sparse object graphs at the closed normalizer boundary', () => {
    const valid = assembleDefinitionStepForest(
      runtimeFor(),
      { stepSpaceRef: 'step-space.xnl' },
      config,
    );
    const accessor = { ...valid } as Record<string, unknown>;
    Object.defineProperty(accessor, 'stepOrder', { enumerable: true, get: () => ['first', 'second'] });
    expect(() => normalizeDefinitionStepForest(accessor)).toThrow('closed-data-accessor');

    const sparse = { ...valid, stepOrder: new Array(2) };
    expect(() => normalizeDefinitionStepForest(sparse)).toThrow('closed-data-sparse-array');
  });

  test('requires an admitted pure codec and rejects invalid extension values before forest creation', () => {
    expect(() => assembleDefinitionStepForest(
      {
        ...createDefinitionStepSourceRuntime(sources),
        extensionCodecs: {
          resolve: () => ({ schemaRef: 'schema://example.audit/v1' }),
        },
      } as never,
      { stepSpaceRef: 'step-space.xnl' },
      config,
    )).toThrow('step-extension-registration-invalid');

    expect(() => assembleDefinitionStepForest(
      runtimeFor({
        ...sources,
        'steps/first/audit.xnl': sources['steps/first/audit.xnl'].replace('" first "', '42'),
      }),
      { stepSpaceRef: 'step-space.xnl' },
      config,
    )).toThrow('step-extension-codec-invalid');
  });

  test('mutates one selected step through a digest-CAS port and normalizes its extension', () => {
    const forest = assembleDefinitionStepForest(
      runtimeFor(),
      { stepSpaceRef: 'step-space.xnl' },
      config,
    );
    let accepted = forest.steps.first;
    const writes: string[] = [];
    const runtime = {
      steps: {
        readStep(stepId: string) { return stepId === accepted.id ? accepted : undefined; },
        writeStep(step: typeof accepted, expectedDigest: typeof accepted.digest) {
          expect(expectedDigest).toBe(accepted.digest);
          writes.push(step.id);
          accepted = step;
        },
      },
      extensionCodecs,
    };

    const revised = mutateDefinitionStep(runtime, { stepId: 'first' }, {
      expectedDigest: accepted.digest,
      extensions: { 'example.audit': { label: ' revised ' } },
    }, config);
    expect(revised.extensions['example.audit'].value).toEqual({ label: 'revised' });
    expect(revised.digest).not.toBe(forest.steps.first.digest);
    expect(writes).toEqual(['first']);
    expect(() => mutateDefinitionStep(runtime, { stepId: 'first' }, {
      expectedDigest: forest.steps.first.digest,
    }, config)).toThrow('step-mutation-version-conflict');
    expect(() => mutateDefinitionStep({
      ...runtime,
      extensionCodecs: { resolve: () => ({ schemaRef: 'schema://example.audit/v1' }) },
    } as never, { stepId: 'first' }, {
      expectedDigest: accepted.digest,
      extensions: { 'example.audit': { label: 'invalid registry' } },
    }, {}))
      .toThrow('step-extension-registration-invalid');
  });
});

describe('semantic-neutral immutable Merkle mechanics', () => {
  test('reuses unaffected nodes and reports the changed logarithmic path', () => {
    const beforeRecords = Array.from({ length: 8 }, (_, index) =>
      createImmutableStepRecord(`step-${index}`, { status: 'Pending', index }));
    const afterRecords = beforeRecords.map((record, index) =>
      index === 3 ? createImmutableStepRecord(record.key, { status: 'Succeeded', index }) : record);
    const before = buildStepMerkleTree(beforeRecords);
    const after = buildStepMerkleTree(afterRecords);
    const delta = diffStepMerkleTrees(before, after);

    expect(after.rootDigest).not.toBe(before.rootDigest);
    expect(delta.addedNodeDigests.length).toBe(4);
    expect(delta.reusedNodeDigests.length).toBeGreaterThan(0);
    expect(delta.unreachableNodeDigests.length).toBe(4);
    expect(after.keyOrder).toEqual(before.keyOrder);
  });

  test('is deterministic across input order and rejects duplicate keys', () => {
    const records = [
      createImmutableStepRecord('b', { value: 2 }),
      createImmutableStepRecord('a', { value: 1 }),
    ];
    expect(buildStepMerkleTree(records).rootDigest).toBe(buildStepMerkleTree([...records].reverse()).rootDigest);
    expect(() => buildStepMerkleTree([records[0], records[0]])).toThrow('step-merkle-key-duplicate');
  });
});
