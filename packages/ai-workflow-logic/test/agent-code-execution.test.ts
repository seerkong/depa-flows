import { describe, expect, test } from 'bun:test';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeLayeredResourceRegistry, createDirectoryResourcePackageReadPort, loadResourceTree } from 'halfcode-compiler.xnl/resource-core';
import { projectAIWorkflowAgentResources } from '../src/agent-resources.js';
import { depaAIResourceKindContract } from 'ai-workflow-contract';
import { resolveAIWorkflowResourceTree, createResolvedAIWorkflowContentIdentityIndex } from '../src/resource-resolution.js';
import { compileAgentContextPipeline, compileAgentMessageSource, restoreAIAgentCodeExecution } from 'ai-workflow-logic/agent-code-execution';
import { freezeAIWorkflowRunResources, projectFrozenAIAgentTaskBinding, assertFrozenAIAgentTaskBinding } from '../src/run-freeze.js';

const contextId = 'depa.flows.test.ContextPipeline.Standard';
const environment = { hostIdentity: 'context-test/v1', ambient: {} };
const fixtureRoot = join(import.meta.dir, 'fixtures/HalfcodeAIAgentResourcePackage');
const task = { workflowKind: 'AICtrlWorkflow' as const, workflowRef: 'resource://depa.flows.test.Workflow.Support' as const, nodeId: 'collect-request', agentDefinitionRef: 'resource://depa.flows.test.Agent.Support' as const };
const nativeContext = `<AgentContextPipeline #${contextId} envelopeVersion="halfcode.resource-envelope/v1" specVersion=2 { lifecycle="Active" } (
  <CodeBinding { packageName="test-code" module="./pipeline.ts" exportName="compose" }>
  <Config { value={ prefix="fact:" } }>
  <Assets [<Asset { path="word.txt" format="text" }>]>
  <DependencyRefs [<DependencyRef #prompt { kind="Prompt" ref="resource://depa.flows.test.Prompt.System" }>]>
)>`;

async function observe(root: string) {
  const tree = resolveAIWorkflowResourceTree(await loadResourceTree({ rootDir: root }));
  const layers = [{ id: 'workspace', tree }];
  const registry = composeLayeredResourceRegistry({ layers });
  return { registry, projection: projectAIWorkflowAgentResources(registry), contentIdentities: createResolvedAIWorkflowContentIdentityIndex(tree) };
}

describe('native Agent code execution', () => {
  test('executes legacy Content only through an explicit frozen compatibility binding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-legacy-code-'));
    try {
      await cp(fixtureRoot, root, { recursive: true });
      await writeFile(join(root, 'legacy.ts'), 'export function compose(runtime, input, config) { return [config.descriptor, runtime.prefix + input] }');
      const observed = await observe(root);
      const code = observed.projection.codeResources!.find(item => item.kind === 'AgentMessageSource')!;
      expect(code.mode).toBe('legacy');
      const runtime = { source: await createDirectoryResourcePackageReadPort(root), sourceRoot: '/', entryPath: '/legacy.ts', environment };
      await expect(compileAgentMessageSource(runtime, code)).rejects.toThrow('explicit builtin binding resolver');
      const compiled = await compileAgentMessageSource({ ...runtime, resolveLegacy: projection => ({
        binding: { packageName: 'legacy-test', module: './legacy.ts', moduleSpecifier: 'legacy-test/legacy.ts', exportName: 'compose' },
        config: { descriptor: projection.content },
      }) }, code);
      const result = compiled.execute({ prefix: 'real:' }, 'input');
      expect(result).toEqual([code.mode === 'legacy' ? code.content : '', 'real:input']);
      await rm(join(root, 'legacy.ts'));
      const restored = restoreAIAgentCodeExecution({ environment }, code, JSON.parse(JSON.stringify(compiled.artifact)), compiled.artifactDigest);
      expect(restored.execute({ prefix: 'real:' }, 'input')).toEqual(result);
      expect(() => restoreAIAgentCodeExecution({ environment: { ...environment, hostIdentity: 'changed/v2' } }, code, compiled.artifact, compiled.artifactDigest)).toThrow();
      await expect(compileAgentContextPipeline(runtime, code)).rejects.toThrow('Expected AgentContextPipeline');
      await expect(compileAgentMessageSource(runtime, { ...code })).rejects.toThrow('authentic');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('binds code changes into execution identity and restores old bytes without live source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-code-'));
    try {
      await cp(fixtureRoot, root, { recursive: true });
      await writeFile(join(root, 'ContextPipelines/Standard.xnl'), nativeContext);
      await writeFile(join(root, 'KindDefinitions/AgentContextPipeline/manifest.xnl'), depaAIResourceKindContract('AgentContextPipeline', 2).kindDefinitionSource);
      await writeFile(join(root, 'pipeline.ts'), 'import { value } from "./helper"; import word from "./word.txt"; export function compose(runtime, input, config) { return config.prefix + runtime.format(value + word + input) }');
      await writeFile(join(root, 'helper.ts'), 'export const value = "V1:"');
      await writeFile(join(root, 'word.txt'), 'asset:');
      const v1 = await observe(root);
      const code = v1.projection.codeResources!.find(item => item.resource.resourceId === contextId)!;
      expect(code.mode).toBe('native');
      expect(v1.projection.dependencyEdges).toContainEqual(expect.objectContaining({ fromResourceId: contextId, toResourceId: 'depa.flows.test.Prompt.System', relation: 'agent-code-dependency' }));
      const runtime = { source: await createDirectoryResourcePackageReadPort(root), sourceRoot: '/', entryPath: '/pipeline.ts', environment };
      const compiledV1 = await compileAgentContextPipeline(runtime, code);
      expect(compiledV1.execute({ format: (value: string) => `[${value}]` }, 'input')).toBe('fact:[V1:asset:input]');
      expect(() => freezeAIWorkflowRunResources({ ...v1, task })).toThrow();
      const receiptV1 = freezeAIWorkflowRunResources({ ...v1, task, codeExecutions: [compiledV1] });
      const proofV1 = projectFrozenAIAgentTaskBinding(receiptV1);
      const persisted = JSON.parse(JSON.stringify(compiledV1.artifact));
      const expectedDigest = compiledV1.artifactDigest;
      await writeFile(join(root, 'helper.ts'), 'export const value = "V2:"');
      const compiledV2 = await compileAgentContextPipeline(runtime, code);
      const receiptV2 = freezeAIWorkflowRunResources({ ...v1, task, codeExecutions: [compiledV2] });
      expect(receiptV2.semanticFingerprint).not.toBe(receiptV1.semanticFingerprint);
      expect(compiledV2.execute({ format: (value: string) => value }, '')).toBe('fact:V2:asset:');
      await rm(join(root, 'pipeline.ts'));
      await rm(join(root, 'helper.ts'));
      await rm(join(root, 'word.txt'));
      const restored = restoreAIAgentCodeExecution({ environment }, code, persisted, expectedDigest);
      expect(restored.execute({ format: (value: string) => value }, '')).toBe('fact:V1:asset:');
      const restoredProof = projectFrozenAIAgentTaskBinding(freezeAIWorkflowRunResources({ ...v1, task, codeExecutions: [restored] }));
      expect(assertFrozenAIAgentTaskBinding(restoredProof).semanticFingerprint).toBe(proofV1.semanticFingerprint);
      expect(() => restoreAIAgentCodeExecution({ environment }, code, { ...persisted, config: { prefix: 'bad' } }, expectedDigest)).toThrow();
      expect(() => freezeAIWorkflowRunResources({ ...v1, task, codeExecutions: [{ ...compiledV1 }] })).toThrow();
      const browser = await import('ai-workflow-logic/browser');
      expect('compileAgentContextPipeline' in browser).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
