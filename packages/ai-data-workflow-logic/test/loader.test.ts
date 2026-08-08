import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createAIDataWorkflowRunGraph, loadAIDataWorkflowSources } from 'ai-data-workflow-logic';

const root = path.resolve(import.meta.dir, '../../..');
const canonicalManifest = readFileSync(
  path.join(root, 'examples/xnl-bundles/ai-data-workflow/manifest.xnl'),
  'utf8',
);

describe('AIDataWorkflow source loader', () => {
  test('loads the canonical profile example into an EagerDataFlow-backed binding', () => {
    const result = loadAIDataWorkflowSources({ 'manifest.xnl': canonicalManifest });

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

  test('returns stable diagnostics and no binding for a wrong root or invalid node', () => {
    const wrongRoot = loadAIDataWorkflowSources({
      'manifest.xnl': canonicalManifest.replace('<AIDataWorkflow ', '<EagerDataFlow '),
    });
    const invalidNode = loadAIDataWorkflowSources({
      'manifest.xnl': canonicalManifest.replace('<TransformNode #retrieve', '<ComputedNode #retrieve'),
    });

    expect(wrongRoot.binding).toBeUndefined();
    expect(wrongRoot.diagnostics.map(({ code }) => code)).toContain('profile-root-count');
    expect(invalidNode.binding).toBeUndefined();
    expect(invalidNode.diagnostics.map(({ code }) => code)).toContain('lazy-data-graph-node');
  });
});
