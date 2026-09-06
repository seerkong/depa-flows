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

  test('loads an exact Halfcode 0.3 resource root as the same depa semantic profile', () => {
    const resourceManifest = canonicalManifest.replace(
      'apiVersion="depa.flows/v1" version="1.0.0"',
      'envelopeVersion="halfcode.resource-envelope/v1" specVersion=1',
    );
    const result = loadAICtrlWorkflowSources({ 'manifest.xnl': resourceManifest });

    expect(result.diagnostics).toEqual([]);
    expect(result.binding?.definition).toMatchObject({
      apiVersion: 'depa.flows/v1',
      version: '1',
      fqn: 'depa.examples.SupportReview',
    });
  });

  test('rejects unknown and incomplete Halfcode resource root revisions', () => {
    const resourceManifest = canonicalManifest.replace(
      'apiVersion="depa.flows/v1" version="1.0.0"',
      'envelopeVersion="halfcode.resource-envelope/v2" specVersion=1',
    );
    const unknownEnvelope = loadAICtrlWorkflowSources({ 'manifest.xnl': resourceManifest });
    const missingRevision = loadAICtrlWorkflowSources({
      'manifest.xnl': resourceManifest
        .replace('halfcode.resource-envelope/v2', 'halfcode.resource-envelope/v1')
        .replace(' specVersion=1', ''),
    });

    expect(unknownEnvelope.binding).toBeUndefined();
    expect(unknownEnvelope.diagnostics.map(({ code }) => code)).toContain('unsupported-flow-resource-envelope');
    expect(missingRevision.binding).toBeUndefined();
    expect(missingRevision.diagnostics.map(({ code }) => code)).toContain('unsupported-flow-resource-spec-version');
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
