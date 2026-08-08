import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadAICtrlWorkflowSources } from 'ai-ctrl-workflow-logic';

const root = path.resolve(import.meta.dir, '../../..');
const canonicalManifest = readFileSync(
  path.join(root, 'examples/xnl-bundles/ai-ctrl-workflow/manifest.xnl'),
  'utf8',
);

describe('AICtrlWorkflow source loader', () => {
  test('loads the canonical profile example into a WorkCtrlFlow-backed binding', () => {
    const result = loadAICtrlWorkflowSources({ 'manifest.xnl': canonicalManifest });

    expect(result.diagnostics).toEqual([]);
    expect(result.binding).toMatchObject({
      kind: 'AICtrlWorkflow',
      substrate: 'WorkCtrlFlow',
      definition: {
        form: 'WorkCtrlFlow',
        fqn: 'depa.examples.SupportReview',
      },
    });
  });

  test('returns stable diagnostics and no binding for a wrong root or invalid statement', () => {
    const wrongRoot = loadAICtrlWorkflowSources({
      'manifest.xnl': canonicalManifest.replace('<AICtrlWorkflow ', '<WorkCtrlFlow '),
    });
    const invalidStatement = loadAICtrlWorkflowSources({
      'manifest.xnl': canonicalManifest.replace('<ExternalJob #agent-review', '<TaskStep #agent-review'),
    });

    expect(wrongRoot.binding).toBeUndefined();
    expect(wrongRoot.diagnostics.map(({ code }) => code)).toContain('profile-root-missing');
    expect(invalidStatement.binding).toBeUndefined();
    expect(invalidStatement.diagnostics.map(({ code }) => code)).toContain('statement-not-allowed');
  });
});
