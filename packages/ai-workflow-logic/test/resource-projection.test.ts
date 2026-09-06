import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type {
  ResourceNode,
  ResourceRecord,
  ResourceRegistry,
  ResourceValue,
} from 'halfcode-compiler.xnl/resource-core';
import type { AIWorkflowAppBundleManifest } from 'ai-workflow-contract';
import {
  AIWorkflowResourceProjectionError,
  projectAIWorkflowAppBundles,
} from 'ai-workflow-logic';
import { loadAIWorkflowResourcePackage } from 'ai-workflow-logic/filesystem';

const fixtureRoot = join(import.meta.dir, 'fixtures/HalfcodeAIWorkflowPackage');

describe('Halfcode-backed AI workflow resource projection', () => {
  test('loads the ResourcePackage through Halfcode and projects ordered workflow bindings', async () => {
    const loaded = await loadAIWorkflowResourcePackage({ rootDir: fixtureRoot });

    expect(loaded.authoredTree.stage).toBe('authored');
    expect(loaded.tree.stage).toBe('resolved');
    expect(loaded.tree.readerProfileId).toBe('depa.flows.ai-resources.v1');
    expect(loaded.tree.receipts).toHaveLength(7);
    expect(loaded.tree.manifest.kind).toBe('ResourcePackage');
    expect(loaded.tree.manifest.resourceId).toBe('depa.flows.test.resource_package');
    expect(loaded.appBundles).toHaveLength(1);
    expect(loaded.appBundles[0]).toMatchObject({
      kind: 'AIWorkflowAppBundle',
      fqn: 'depa.flows.test.SupportAgent',
      packageResourceId: 'depa.flows.test.resource_package',
    });
    expect(loaded.appBundles[0]?.workflowBindings.map((binding) => [
      binding.id,
      binding.kind,
      binding.ref,
      binding.entrypoint,
    ])).toEqual([
      ['primary', 'AICtrlWorkflow', 'resource://depa.flows.test.SupportAgent.Workflow', true],
      ['evidence', 'AIDataWorkflow', 'resource://depa.flows.test.SupportAgent.Evidence', false],
    ]);
    expect(loaded.appBundles[0]?.entrypoints.map((binding) => binding.id)).toEqual(['primary']);
    expect(Object.isFrozen(loaded.appBundles)).toBe(true);
    expect(Object.isFrozen(loaded.appBundles[0]?.workflowBindings)).toBe(true);
    expect((loaded.appBundles[0]?.resource as { stage?: string } | undefined)?.stage).toBe('resolved');
  });

  test('surfaces Halfcode loader diagnostics instead of applying a depa fallback policy', async () => {
    try {
      await loadAIWorkflowResourcePackage({
        rootDir: fixtureRoot,
        manifestPath: 'manifest.xml',
      });
      throw new Error('expected Halfcode loading to fail');
    } catch (error) {
      expect((error as { name?: string }).name).toBe('ResourceValidationError');
      expect((error as { diagnostics?: readonly { code: string }[] }).diagnostics?.[0]?.code)
        .toBe('RESOURCE_AUTHORITY_FORMAT_UNSUPPORTED');
    }
  });

  test('projects the public Halfcode registry read port without filesystem access', () => {
    const ctrl = record('AICtrlWorkflow', 'depa.flows.test.Workflow');
    const app = record('AIWorkflowAppBundle', 'depa.flows.test.App', {
      WorkflowBindings: node('WorkflowBindings', undefined, {}, [
        node('WorkflowBinding', 'main', {
          kind: 'AICtrlWorkflow',
          ref: 'resource://depa.flows.test.Workflow',
          entrypoint: true,
        }),
      ]),
    });

    const bundles = projectAIWorkflowAppBundles(registry(app, ctrl), {
      packageResourceId: 'depa.flows.test.package',
    });

    expect(bundles[0]?.resource).toBe(app);
    expect(bundles[0]?.entrypoints[0]?.resource).toBe(ctrl);
  });

  test.each([
    {
      name: 'missing binding id',
      binding: node('WorkflowBinding', undefined, {
        kind: 'AICtrlWorkflow',
        ref: 'resource://depa.flows.test.Workflow',
        entrypoint: true,
      }),
      code: 'AI_WORKFLOW_BINDING_ID_MISSING',
    },
    {
      name: 'unsupported workflow kind',
      binding: node('WorkflowBinding', 'main', {
        kind: 'PromptFragment',
        ref: 'resource://depa.flows.test.Workflow',
        entrypoint: true,
      }),
      code: 'AI_WORKFLOW_BINDING_KIND_INVALID',
    },
    {
      name: 'non-resource ref',
      binding: node('WorkflowBinding', 'main', {
        kind: 'AICtrlWorkflow',
        ref: 'vfs://@/Workflows/Main.xnl',
        entrypoint: true,
      }),
      code: 'AI_WORKFLOW_BINDING_REF_INVALID',
    },
    {
      name: 'wrong target kind',
      binding: node('WorkflowBinding', 'main', {
        kind: 'AIDataWorkflow',
        ref: 'resource://depa.flows.test.Workflow',
        entrypoint: true,
      }),
      code: 'AI_WORKFLOW_BINDING_TARGET_KIND_MISMATCH',
    },
  ])('fails closed for $name', ({ binding, code }) => {
    const app = record('AIWorkflowAppBundle', 'depa.flows.test.App', {
      WorkflowBindings: node('WorkflowBindings', undefined, {}, [binding]),
    });
    expectProjectionError(registry(app, record('AICtrlWorkflow', 'depa.flows.test.Workflow')), code);
  });

  test('fails closed for duplicate binding ids and for an app without an entrypoint', () => {
    const duplicate = node('WorkflowBinding', 'main', {
      kind: 'AICtrlWorkflow',
      ref: 'resource://depa.flows.test.Workflow',
      entrypoint: true,
    });
    const duplicateApp = record('AIWorkflowAppBundle', 'depa.flows.test.Duplicate', {
      WorkflowBindings: node('WorkflowBindings', undefined, {}, [duplicate, duplicate]),
    });
    expectProjectionError(
      registry(duplicateApp, record('AICtrlWorkflow', 'depa.flows.test.Workflow')),
      'AI_WORKFLOW_BINDING_ID_DUPLICATE',
    );

    const noEntryApp = record('AIWorkflowAppBundle', 'depa.flows.test.NoEntry', {
      WorkflowBindings: node('WorkflowBindings', undefined, {}, [
        node('WorkflowBinding', 'member', {
          kind: 'AICtrlWorkflow',
          ref: 'resource://depa.flows.test.Workflow',
          entrypoint: false,
        }),
      ]),
    });
    expectProjectionError(
      registry(noEntryApp, record('AICtrlWorkflow', 'depa.flows.test.Workflow')),
      'AI_WORKFLOW_APP_ENTRYPOINT_MISSING',
    );
  });

  test('keeps the pure projector available from the browser entry', async () => {
    const browser = await import('ai-workflow-logic/browser');
    const legacyManifest: AIWorkflowAppBundleManifest = {
      kind: 'AIWorkflowAppBundle',
      fqn: 'depa.flows.test.Legacy',
      catalog: { id: 'legacy', entries: [] },
    };
    expect(browser.projectAIWorkflowAppBundles).toBe(projectAIWorkflowAppBundles);
    expect(browser.parseAIWorkflowResourceRef('resource://depa.flows.test.Legacy')?.target)
      .toBe(legacyManifest.fqn);
  });
});

function expectProjectionError(registryView: Pick<ResourceRegistry, 'byKind'>, code: string): void {
  try {
    projectAIWorkflowAppBundles(registryView);
    throw new Error('expected projection to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(AIWorkflowResourceProjectionError);
    expect((error as AIWorkflowResourceProjectionError).diagnostics.map((item) => item.code)).toContain(code);
  }
}

function registry(...records: ResourceRecord[]): Pick<ResourceRegistry, 'byKind'> {
  const byKind = new Map<string, ResourceRecord[]>();
  for (const item of records) {
    const values = byKind.get(item.kind) ?? [];
    values.push(item);
    byKind.set(item.kind, values);
  }
  return { byKind };
}

function record(
  kind: string,
  resourceId: string,
  subdomains: Readonly<Record<string, ResourceNode>> = {},
): ResourceRecord {
  return {
    kind,
    fqn: resourceId,
    resourceId,
    metadata: { envelopeVersion: 'halfcode.resource-envelope/v1', specVersion: 1 },
    sourceShape: 'single-file',
    logicalPath: `${kind}/${resourceId}.xnl`,
    documentUri: `vfs://@/${kind}/${resourceId}.xnl`,
    format: 'xnl',
    node: node(kind, resourceId, {}, [], subdomains),
  };
}

function node(
  tag: string,
  resourceId?: string,
  properties: Readonly<Record<string, ResourceValue>> = {},
  body: readonly ResourceValue[] = [],
  subdomains: Readonly<Record<string, ResourceNode>> = {},
): ResourceNode {
  return {
    tag,
    ...(resourceId === undefined ? {} : { resourceId }),
    metadata: {},
    properties,
    body,
    subdomains,
  };
}
