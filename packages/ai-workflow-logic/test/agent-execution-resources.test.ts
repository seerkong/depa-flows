import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { composeLayeredResourceRegistry, digestCanonical, loadResourceTree, resolveEffectiveResourceContentIdentities } from 'halfcode-compiler.xnl/resource-core';
import { createKindSpecRevision, createKindSubjectOwner, createReaderProfile, KindReaderRegistry } from 'halfcode-compiler.xnl/kind-definition';
import { depaAIResourceKindContract } from 'ai-workflow-contract';
import { resolveAIAgentExecutionResources, projectAIWorkflowAgentResources, projectAIAgentDefinitionCandidates, normalizeAIAgentTaskRequirement, admitAIAgentDefinitionSelection, freezeSelectedAIAgentTaskBinding } from 'ai-workflow-logic';
import { createAIWorkflowResourceResolutionContext } from '../src/resource-resolution.js';
import { freezeAIWorkflowRunResources } from '../src/run-freeze.js';

const fixture = join(import.meta.dir, 'fixtures/HalfcodeAIAgentResourcePackage');
const task = { workflowKind: 'AICtrlWorkflow' as const, workflowRef: 'resource://depa.flows.test.Workflow.Support' as const, nodeId: 'collect-request', agentDefinitionRef: 'resource://depa.flows.test.Agent.Support' as const };
async function observe() {
  const tree = await loadResourceTree({ rootDir: fixture });
  const layers = [{ id: 'workspace', tree }];
  const registry = composeLayeredResourceRegistry({ layers });
  const runtime = { resolutionContexts: new Map([['workspace', createAIWorkflowResourceResolutionContext(undefined, tree)]]) };
  return { layers, registry, runtime, projection: projectAIWorkflowAgentResources(registry), contentIdentities: resolveEffectiveResourceContentIdentities({ registry, layers }) };
}

describe('authored authority to resolved execution resources', () => {
  test('binds authentic observations and authored content identities through selection and ordinary freeze', async () => {
    const input = await observe();
    const executionResources = resolveAIAgentExecutionResources(input.runtime, input);
    const candidates = projectAIAgentDefinitionCandidates({ ...input, executionResources });
    expect(candidates.candidates[0]!.contentDigest).toBe(input.contentIdentities.get('depa.flows.test.Agent.Support')!.contentDigest);
    expect(executionResources.registry).not.toBe(input.registry);
    expect(executionResources.resolvedResources.get('depa.flows.test.Agent.Support')!.stage).toBe('resolved');
    expect(Object.isFrozen(executionResources.resolvedResources.get('depa.flows.test.Agent.Support'))).toBe(true);
    expect('set' in executionResources.resolvedResources).toBe(false);
    executionResources.resolvedResources.forEach((_record, _id, map) => expect('set' in map).toBe(false));
    const requirement = normalizeAIAgentTaskRequirement({ schemaVersion: 'ai-workflow.agent-definition-selection/v1', requirementId: 'bridge', objective: 'Select', requiredToolRefs: [], requiredMaterialPortRefs: [], requiredMessageSourceRefs: [] });
    const candidate = candidates.candidates[0]!;
    const admission = admitAIAgentDefinitionSelection({ requirement, candidateSet: candidates, decision: { schemaVersion: requirement.schemaVersion, mode: 'select-existing', requirementDigest: requirement.requirementDigest, candidateSetDigest: candidates.candidateSetDigest, candidateRef: candidate.agentDefinitionRef, candidateDigest: candidate.candidateDigest, reason: 'Exact' } });
    if (admission.status !== 'selected') throw new Error('selection required');
    const selected = { ...input, ...task, admission, executionResources };
    const proof = freezeSelectedAIAgentTaskBinding(selected);
    const receipt = freezeAIWorkflowRunResources({ ...input, task, executionResources });
    expect(proof.semanticFingerprint).toBe(receipt.semanticFingerprint);
    expect(proof.resourceResolutions).toEqual(receipt.resourceResolutions);
    expect(receipt.resourceResolutions!.map(item => item.resourceId)).toEqual([...receipt.dependencySnapshot.closure.map(item => item.resourceId)].sort());
    expect(receipt.dependencySnapshot.closure.find(item => item.resourceId === candidate.agentDefinitionRef.slice(11))!.contentDigest).toBe(candidate.contentDigest);
    expect(freezeAIWorkflowRunResources({ ...input, task }).resourceResolutions).toBeUndefined();
    expect(freezeAIWorkflowRunResources({ ...input, task }).semanticFingerprint).not.toBe(receipt.semanticFingerprint);
    expect(() => freezeAIWorkflowRunResources({ ...executionResources, task })).toThrow('authored registry');
    expect(() => freezeSelectedAIAgentTaskBinding({ ...selected, executionResources: undefined })).toThrow();
    const other = resolveAIAgentExecutionResources(input.runtime, input);
    expect(() => freezeSelectedAIAgentTaskBinding({ ...selected, executionResources: other })).toThrow();
    expect(() => projectAIAgentDefinitionCandidates({ ...input, executionResources: { ...executionResources } })).toThrow();
    expect(() => freezeAIWorkflowRunResources({ ...input, task, executionResources: { ...executionResources } })).toThrow();
    expect(() => freezeAIWorkflowRunResources({ ...input, task, contentIdentities: new Map(), executionResources })).toThrow();
    const foreign = await observe();
    expect(() => projectAIAgentDefinitionCandidates({ ...foreign, executionResources })).toThrow();
    expect(() => resolveAIAgentExecutionResources({ resolutionContexts: new Map() }, input)).toThrow();
    expect(() => resolveAIAgentExecutionResources({ resolutionContexts: new Map([['workspace', undefined as never]]) }, input)).toThrow('Reader context');
    expect(() => resolveAIAgentExecutionResources({ resolutionContexts: new Map([...input.runtime.resolutionContexts, ['extra', input.runtime.resolutionContexts.get('workspace')!]]) }, input)).toThrow();
    expect(Object.isFrozen(executionResources)).toBe(true);
    expect('set' in executionResources.resolutionIdentities).toBe(false);
    executionResources.resolutionIdentities.forEach((_value, _key, map) => expect('set' in map).toBe(false));
    input.runtime.resolutionContexts.clear();
    expect(freezeSelectedAIAgentTaskBinding(selected).semanticFingerprint).toBe(proof.semanticFingerprint);
    input.layers.push(...foreign.layers);
    expect(() => projectAIAgentDefinitionCandidates({ ...input, executionResources })).toThrow();
  });

  test('rejects a reader value that diverges from the Kind projector node protocol', async () => {
    const input = await observe();
    const base = input.runtime.resolutionContexts.get('workspace')!;
    const readers = new KindReaderRegistry();
    for (const reader of base.readers.all()) readers.register(reader.readerId === depaAIResourceKindContract('AgentContextPipeline').reader.readerId
      ? { ...reader, read: () => ({ transformed: 'different-business-output' }) } : reader);
    expect(() => resolveAIAgentExecutionResources({ resolutionContexts: new Map([['workspace', { ...base, readers }]]) }, input))
      .toThrow('preserves the resolved node input protocol');
  });

  test('resolves mixed v1/v2 code layers and an explicit host-owned Kind using complete contexts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-bridge-kinds-'));
    const overlayRoot = await mkdtemp(join(tmpdir(), 'agent-bridge-overlay-'));
    try {
      await cp(fixture, root, { recursive: true });
      const owner = createKindSubjectOwner({ kind: 'HostFact', subjectFqn: 'test.host.Kind.HostFact', ownerPackageId: 'test-host',
        ownerPackageFingerprint: digestCanonical('test-host/v1'), sourceShapes: ['single-file'], documentCardinality: 'one' });
      const revision = createKindSpecRevision({ kind: owner.kind, subjectFqn: owner.subjectFqn, specVersion: 1, specSchema: true,
        semanticContract: { semanticValidatorFingerprint: digestCanonical('host-validator'), referenceProjectionFingerprint: digestCanonical('host-refs'), compilerInputFingerprint: digestCanonical('host-input') },
        sourceContractFingerprint: owner.sourceContract.sourceContractFingerprint, stability: 'stable' });
      const reader = { readerId: 'test.host.reader.v1', subjectFqn: owner.subjectFqn, readerSpecVersion: 1,
        contractFingerprint: revision.contractFingerprint, readerImplementationFingerprint: digestCanonical('host-reader/v1'),
        compatibilityPolicy: 'exact' as const, read: () => ({ hostOwned: true }) };
      await mkdir(join(root, 'KindDefinitions/HostFact'));
      await mkdir(join(root, 'HostFacts'));
      await writeFile(join(root, 'KindDefinitions/HostFact/manifest.xnl'), `<KindDefinition #${owner.subjectFqn} envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 {
        resourceKind="HostFact" subjectFqn="${owner.subjectFqn}" sourceShapes=["single-file"] documentCardinality="one"
      } (<SpecRevisions [<SpecRevision #v1 { specVersion=1 schemaRef="vfs://./spec-v1.schema.json"
        schemaFingerprint="${revision.schemaFingerprint}" contractFingerprint="${revision.contractFingerprint}"
        semanticValidatorFingerprint="${revision.semanticContract.semanticValidatorFingerprint}"
        referenceProjectionFingerprint="${revision.semanticContract.referenceProjectionFingerprint}"
        compilerInputFingerprint="${revision.semanticContract.compilerInputFingerprint}" stability="stable"
      }>]>)>`);
      await writeFile(join(root, 'HostFacts/First.xnl'), '<HostFact #test.host.Fact.First envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 { value="host" }>');
      await writeFile(join(root, 'manifest.xnl'), (await readFile(join(root, 'manifest.xnl'), 'utf8')).replace('<Catalogs [', '<Catalogs [<Catalog #host { kind="HostFact" shape="single-file" root="vfs://./HostFacts/" }>'));
      await writeFile(join(root, 'KindDefinitions/AgentContextPipeline/manifest.xnl'), depaAIResourceKindContract('AgentContextPipeline', 2).kindDefinitionSource);
      await writeFile(join(root, 'ContextPipelines/Legacy.xnl'), (await readFile(join(root, 'ContextPipelines/Standard.xnl'), 'utf8')).replace('#depa.flows.test.ContextPipeline.Standard', '#test.host.Context.Legacy'));
      await cp(root, overlayRoot, { recursive: true });
      await writeFile(join(overlayRoot, 'ContextPipelines/Standard.xnl'), `<AgentContextPipeline #depa.flows.test.ContextPipeline.Standard envelopeVersion="halfcode.resource-envelope/v1" specVersion=2 { lifecycle="Active" } (
        <CodeBinding { packageName="test-host" module="./context.ts" exportName="compose" }>
      )>`);
      const layers = [{ id: 'global', tree: await loadResourceTree({ rootDir: root }) }, { id: 'workspace', tree: await loadResourceTree({ rootDir: overlayRoot }) }];
      const registry = composeLayeredResourceRegistry({ layers });
      const contexts = new Map(layers.map(layer => {
        const base = createAIWorkflowResourceResolutionContext(undefined, layer.tree);
        base.contracts.registerOwner(owner).registerRevision(revision);
        base.readers.register(reader);
        return [layer.id, { ...base, readerProfile: createReaderProfile('test-host/full-context/v1', [...base.readerProfile.readers.values(), reader]) }] as const;
      }));
      const execution = resolveAIAgentExecutionResources({ resolutionContexts: contexts }, { registry, layers });
      expect(execution.resolutionIdentities.get('test.host.Fact.First')!.readerId).toBe(reader.readerId);
      expect(execution.resolvedResources.get('test.host.Fact.First')!.readerValue).toEqual({ hostOwned: true });
      expect(execution.resolvedResources.get('depa.flows.test.ContextPipeline.Standard')!.source)
        .toBe(layers[1]!.tree.registry.byKind.get('AgentContextPipeline')!.find(record => record.resourceId === 'depa.flows.test.ContextPipeline.Standard')!);
      expect(execution.resolutionIdentities.get('test.host.Context.Legacy')!.readerSpecVersion).toBe(2);
      expect(execution.projection.codeResources!.find(code => code.resource.resourceId === 'test.host.Context.Legacy')!.mode).toBe('legacy');
      expect(execution.projection.codeResources!.find(code => code.resource.resourceId === 'depa.flows.test.ContextPipeline.Standard')!.mode).toBe('native');
      expect(execution.registry.byId.get('depa.flows.test.ContextPipeline.Standard')!.shadowed).toEqual(registry.byId.get('depa.flows.test.ContextPipeline.Standard')!.shadowed);
      expect(() => resolveAIAgentExecutionResources({ resolutionContexts: new Map(layers.map(layer => [layer.id, createAIWorkflowResourceResolutionContext(undefined, layer.tree)])) }, { registry, layers })).toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(overlayRoot, { recursive: true, force: true });
    }
  });

  test('replays native tombstone and shadow topology through the native composer', async () => {
    const input = await observe();
    const overlay = await loadResourceTree({ rootDir: join(import.meta.dir, 'fixtures/HalfcodeAIAgentUnrelatedOverlay') });
    const deleted = 'depa.flows.test.Material.Unused';
    const layers = [...input.layers, { id: 'overlay', tree: overlay, tombstones: [{ resourceId: 'depa.flows.test.Binding.Overflow.A', expectedKind: 'MaterialBinding', reason: 'removed' }] }];
    const registry = composeLayeredResourceRegistry({ layers });
    const execution = resolveAIAgentExecutionResources({ resolutionContexts: new Map([...input.runtime.resolutionContexts, ['overlay', createAIWorkflowResourceResolutionContext(undefined, overlay)]]) }, { registry, layers });
    expect(execution.registry.byId.get('depa.flows.test.Binding.Overflow.A')!.resource).toBeUndefined();
    expect(execution.resolutionIdentities.has('depa.flows.test.Binding.Overflow.A')).toBe(false);
    expect(execution.resolvedResources.has('depa.flows.test.Binding.Overflow.A')).toBe(false);
    expect(execution.registry.byId.get(deleted)?.shadowed).toEqual(registry.byId.get(deleted)?.shadowed);
    expect(execution.registry.byId.get('depa.flows.test.Binding.Overflow.A')!.tombstones).toEqual(registry.byId.get('depa.flows.test.Binding.Overflow.A')!.tombstones);
  });
});
