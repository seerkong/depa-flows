import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createAIDataWorkflowRunGraph, loadAIDataWorkflow } from 'ai-data-workflow-logic';

const root = path.resolve(import.meta.dir, '../../..');
const exampleRoot = path.join(root, 'examples/xnl-bundles/ai-data-workflow');
const canonicalSources = Object.fromEntries([
  'manifest.xnl',
  'step-space.xnl',
  'steps/entry/step.xnl',
  'steps/retrieve/step.xnl',
  'steps/summarize/step.xnl',
  'steps/summarize/review-policy.xnl',
  'steps/return/step.xnl',
].map((ref) => [ref, readFileSync(path.join(exampleRoot, ...ref.split('/')), 'utf8')]));

const loaderRuntime = {
  extensionCodecs: {
    resolve: (kind: string) => kind === 'depa.example.review-policy' ? {
      schemaRef: 'schema://depa.example.review-policy/v1',
      codec: {
        normalize(value: any) {
          if (!value || typeof value !== 'object' || value.reviewDepth !== 2 || value.audience !== 'support') {
            throw new Error('review policy is invalid');
          }
          return { audience: value.audience, reviewDepth: value.reviewDepth };
        },
      },
    } : undefined,
  },
} as const;

describe('AIDataWorkflow source loader', () => {
  test('loads the canonical profile example into an EagerDataFlow-backed binding', () => {
    const result = loadAIDataWorkflow(loaderRuntime, { sources: canonicalSources }, {});

    expect(result.diagnostics).toEqual([]);
    expect(result.binding).toMatchObject({
      kind: 'AIDataWorkflow',
      substrate: 'EagerDataFlow',
      definition: {
        form: 'EagerDataFlow',
        fqn: 'depa.examples.SupportEvidenceDag',
        declarationOrder: ['entry', 'retrieve', 'summarize', 'return'],
      },
    });
    expect(result.binding!.definition.definitionStepForest!.steps.summarize.extensions)
      .toMatchObject({
        'depa.example.review-policy': {
          schemaRef: 'schema://depa.example.review-policy/v1',
          value: { audience: 'support', reviewDepth: 2 },
        },
      });
    const graph = createAIDataWorkflowRunGraph({ binding: result.binding!, runId: 'manual-policy' });
    expect(graph.nodes.summarize).toMatchObject({
      nodeType: 'manual',
      reusePolicy: {
        policy: 'never',
        source: 'node-type-default',
        nodeType: 'manual',
      },
    });
  });

  test('loads an exact Halfcode 0.3 resource root as the same depa semantic profile', () => {
    const result = loadAIDataWorkflow(loaderRuntime, { sources: {
      ...canonicalSources,
      'manifest.xnl': canonicalSources['manifest.xnl'].replace(
        'apiVersion="depa.flows/v1" version="1.0.0"',
        'envelopeVersion="halfcode.resource-envelope/v1" specVersion=1',
      ),
    } }, {});

    expect(result.diagnostics).toEqual([]);
    expect(result.binding?.definition).toMatchObject({
      apiVersion: 'depa.flows/v1',
      version: '1',
      fqn: 'depa.examples.SupportEvidenceDag',
    });
  });

  test('rejects unknown and incomplete Halfcode resource root revisions', () => {
    const resourceManifest = canonicalSources['manifest.xnl'].replace(
      'apiVersion="depa.flows/v1" version="1.0.0"',
      'envelopeVersion="halfcode.resource-envelope/v2" specVersion=1',
    );
    const unknownEnvelope = loadAIDataWorkflow(loaderRuntime, { sources: {
      ...canonicalSources,
      'manifest.xnl': resourceManifest,
    } }, {});
    const missingRevision = loadAIDataWorkflow(loaderRuntime, { sources: {
      ...canonicalSources,
      'manifest.xnl': resourceManifest
        .replace('halfcode.resource-envelope/v2', 'halfcode.resource-envelope/v1')
        .replace(' specVersion=1', ''),
    } }, {});

    expect(unknownEnvelope.binding).toBeUndefined();
    expect(unknownEnvelope.diagnostics.map(({ code }) => code)).toContain('unsupported-flow-resource-envelope');
    expect(missingRevision.binding).toBeUndefined();
    expect(missingRevision.diagnostics.map(({ code }) => code)).toContain('unsupported-flow-resource-spec-version');
  });

  test('returns stable diagnostics and no binding for a wrong root or invalid node', () => {
    const wrongRoot = loadAIDataWorkflow(loaderRuntime, { sources: {
      ...canonicalSources,
      'manifest.xnl': canonicalSources['manifest.xnl'].replace('<AIDataWorkflow ', '<EagerDataFlow '),
    } }, {});
    const invalidNode = loadAIDataWorkflow(loaderRuntime, { sources: {
      ...canonicalSources,
      'steps/retrieve/step.xnl': canonicalSources['steps/retrieve/step.xnl']
        .replace('<TransformNode #retrieve', '<ComputedNode #retrieve'),
    } }, {});

    expect(wrongRoot.binding).toBeUndefined();
    expect(wrongRoot.diagnostics.map(({ code }) => code)).toContain('profile-root-count');
    expect(invalidNode.binding).toBeUndefined();
    expect(invalidNode.diagnostics.map(({ code }) => code)).toContain('lazy-data-graph-node');
  });
});
