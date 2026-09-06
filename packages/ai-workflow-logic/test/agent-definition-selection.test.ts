import { describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEPA_AI_RESOURCE_ENVELOPE_VERSION,
  DEPA_AI_RESOURCE_SPEC_VERSION,
  depaAIResourceKindContract,
  type AIAgentTaskRequirement,
  type ReviseExistingAIAgentDefinitionDecision,
} from 'ai-workflow-contract';
import {
  AIAgentDefinitionSelectionError,
  createAIAgentDefinitionSelectionOwner,
  type AIAgentDefinitionSelectionOwner,
  admitAIAgentDefinitionSelection,
  freezeSelectedAIAgentTaskBinding,
  normalizeAIAgentTaskRequirement,
  projectAIAgentDefinitionCandidates,
  projectAIWorkflowAgentResources,
  reconcileAuthoredAIAgentDefinition,
  resolveAIAgentExecutionResources,
} from 'ai-workflow-logic';
import { createAIWorkflowResourceResolutionContext } from '../src/resource-resolution.js';
import { compileAgentContextPipeline } from 'ai-workflow-logic/agent-code-execution';
import {
  RESOURCE_AUTHORING_SCHEMA_VERSION,
  applyResourceAuthoring,
  deriveResourceAuthoringRegistryRevision,
  planResourceAuthoring,
  type ResourceAuthoringPlanningAuthority,
  type ResourceAuthoringProposal,
  type ResourceAuthoringReceipt,
  type ResourceAuthoringRefreshCandidate,
  type ResourceAuthoringRuntime,
} from 'halfcode-compiler.xnl/authoring-runtime';
import {
  composeLayeredResourceRegistry,
  createDirectoryResourcePackageReadPort,
  loadResourceTree,
  resolveEffectiveResourceContentIdentities,
  sha256Digest,
  type EffectiveResourceRegistry,
  type AuthoredResourceTree,
  type ResourceLayerContentIdentityInput,
} from 'halfcode-compiler.xnl/resource-core';

const fixtureRoot = join(import.meta.dir, 'fixtures/HalfcodeAIAgentResourcePackage');

describe('autonomous AIAgentDefinition authoring and typed selection', () => {
  test('requires an authentic explicit owner for authoring while preserving ownerless reads', async () => {
    await withWorkspace(async (root) => {
      const observed = await observe(root);
      const projection = projectAIWorkflowAgentResources(observed.registry);
      const candidateSet = projectAIAgentDefinitionCandidates({ ...observed, projection });
      const requirement = normalizeAIAgentTaskRequirement(supportRequirement());
      const candidate = candidateSet.candidates[0]!;
      const decision = {
        schemaVersion: requirement.schemaVersion, mode: 'select-existing' as const,
        requirementDigest: requirement.requirementDigest, candidateSetDigest: candidateSet.candidateSetDigest,
        candidateRef: candidate.agentDefinitionRef, candidateDigest: candidate.candidateDigest, reason: 'Existing entry point',
      };
      const admission = admitAIAgentDefinitionSelection({ requirement, candidateSet, decision });
      expect(admission.status).toBe('selected');
      if (admission.status !== 'selected') throw new Error('selection required');
      const freezeInput = {
        ...observed, projection, admission, contentIdentities: resolveEffectiveResourceContentIdentities(observed),
        workflowKind: 'AICtrlWorkflow' as const, workflowRef: 'resource://depa.flows.test.Workflow.Support' as const, nodeId: 'collect-request',
      };
      expect(freezeSelectedAIAgentTaskBinding(freezeInput).task.agentDefinitionRef).toBe(candidate.agentDefinitionRef);
      expect(admitAIAgentDefinitionSelection({ requirement, candidateSet, decision: {
        schemaVersion: requirement.schemaVersion, mode: 'author-new',
        requirementDigest: requirement.requirementDigest, candidateSetDigest: candidateSet.candidateSetDigest,
        agentDefinitionRef: 'resource://depa.flows.test.Agent.Generated',
        proposal: generatedProposal(candidateSet.registryRevision), reason: 'Missing explicit owner',
      } })).toMatchObject({ status: 'rejected', code: 'selection-owner-required' });
      const selectionOwner = createAIAgentDefinitionSelectionOwner({ receiptAuthority: { loadReceipt: async () => undefined } });
      expect(Object.isFrozen(selectionOwner)).toBe(true);
      expect(() => projectAIAgentDefinitionCandidates({ ...observed, projection, selectionOwner: { ...selectionOwner } }))
        .toThrow('authentic selection owner');
      const owned = projectAIAgentDefinitionCandidates({ ...observed, projection, selectionOwner });
      expect(owned.candidateSetDigest).toBe(candidateSet.candidateSetDigest);
      expect(admitAIAgentDefinitionSelection({ requirement, candidateSet, decision }))
        .toMatchObject({ status: 'rejected', code: 'selection-owner-mismatch' });
      expect(() => freezeSelectedAIAgentTaskBinding(freezeInput)).toThrow(AIAgentDefinitionSelectionError);
      expect(() => projectAIAgentDefinitionCandidates({ ...observed, projection }))
        .toThrow('authentic selection owner');
    });
  });

  test('isolates identical workspace owners and retains pending and supersession across real refreshes', async () => {
    await withWorkspace(async (rootA) => withWorkspace(async (rootB) => {
      await writeFile(join(rootA, 'Policies/NoTools.xnl'), noToolsPolicy());
      await writeFile(join(rootB, 'Policies/NoTools.xnl'), noToolsPolicy());
      const a = await createAuthoringRuntime(rootA);
      const b = await createAuthoringRuntime(rootB);
      const requirement = normalizeAIAgentTaskRequirement(generatedRequirement());
      const ref = 'resource://depa.flows.test.Agent.Generated' as const;
      const project = (observed: ReturnType<TestAuthoringTransaction['observation']>) => {
        const projection = projectAIWorkflowAgentResources(observed.registry);
        return { ...observed, projection, candidateSet: projectAIAgentDefinitionCandidates({ ...observed, projection }) };
      };
      const select = (selectionOwner: AIAgentDefinitionSelectionOwner, candidateSet: ReturnType<typeof project>['candidateSet']) => {
        const candidate = candidateSet.candidates.find((value) => value.agentDefinitionRef === ref)!;
        return admitAIAgentDefinitionSelection({ selectionOwner, requirement, candidateSet, decision: {
          schemaVersion: requirement.schemaVersion, mode: 'select-existing',
          requirementDigest: requirement.requirementDigest, candidateSetDigest: candidateSet.candidateSetDigest,
          candidateRef: ref, candidateDigest: candidate.candidateDigest, reason: 'Exact match',
        } });
      };
      const create = (observed: ReturnType<typeof project>) => admitAIAgentDefinitionSelection({
        selectionOwner: observed.selectionOwner, requirement, candidateSet: observed.candidateSet, decision: {
          schemaVersion: requirement.schemaVersion, mode: 'author-new',
          requirementDigest: requirement.requirementDigest, candidateSetDigest: observed.candidateSet.candidateSetDigest,
          agentDefinitionRef: ref, proposal: generatedProposal(observed.candidateSet.registryRevision), reason: 'Create in this owner',
        },
      });
      const initialA = project(a.observation());
      const initialB = project(b.observation());
      expect(initialA.registry).not.toBe(initialB.registry);
      expect(initialA.layers[0]!.tree).not.toBe(initialB.layers[0]!.tree);
      expect(initialA.candidateSet.candidateSetDigest).toBe(initialB.candidateSet.candidateSetDigest);
      const createA = create(initialA);
      const createB = create(initialB);
      expect(createA.status).toBe('authoring-request');
      expect(createB.status).toBe('authoring-request');
      if (createA.status !== 'authoring-request' || createB.status !== 'authoring-request') throw new Error('independent creates required');
      const receiptA = await applyResourceAuthoring(a.runtime, planResourceAuthoring(a.runtime, createA.proposal, {}), {});
      const receiptB = await applyResourceAuthoring(b.runtime, planResourceAuthoring(b.runtime, createB.proposal, {}), {});
      const publishedA = project(a.observation());
      const publishedB = project(b.observation());
      expect(receiptA.receiptDigest).toBe(receiptB.receiptDigest);
      expect(select(a.selectionOwner, publishedA.candidateSet)).toMatchObject({ code: 'authoring-in-progress' });
      expect(select(b.selectionOwner, publishedB.candidateSet)).toMatchObject({ code: 'authoring-in-progress' });
      await expect(reconcileAuthoredAIAgentDefinition({ ...publishedB, authoringAdmission: createA,
        receipt: receiptA, receiptAuthority: a.runtime.transaction,
      })).rejects.toMatchObject({ code: 'AI_AGENT_SELECTION_OWNER_MISMATCH' });
      await expect(reconcileAuthoredAIAgentDefinition({ ...publishedA, authoringAdmission: createA,
        receipt: receiptB, receiptAuthority: b.runtime.transaction,
      })).rejects.toMatchObject({ code: 'AI_AGENT_SELECTION_OWNER_MISMATCH' });
      const settledA = await reconcileAuthoredAIAgentDefinition({ ...publishedA, authoringAdmission: createA,
        receipt: receiptA, receiptAuthority: a.runtime.transaction,
      });
      expect(select(b.selectionOwner, publishedB.candidateSet)).toMatchObject({ code: 'authoring-in-progress' });
      const settledB = await reconcileAuthoredAIAgentDefinition({ ...publishedB, authoringAdmission: createB,
        receipt: receiptB, receiptAuthority: b.runtime.transaction,
      });
      const selectedA = select(a.selectionOwner, settledA);
      const selectedB = select(b.selectionOwner, settledB);
      if (selectedA.status !== 'selected' || selectedB.status !== 'selected') throw new Error('both selections required');
      const freezeInput = {
        ...publishedA, admission: selectedA, contentIdentities: resolveEffectiveResourceContentIdentities(publishedA),
        workflowKind: 'AICtrlWorkflow' as const, workflowRef: 'resource://depa.flows.test.Workflow.Support' as const, nodeId: 'worker',
      };
      const previousExecution = freezeSelectedAIAgentTaskBinding(freezeInput);
      const independentFreeze = { ...freezeInput, ...publishedB, admission: selectedB,
        contentIdentities: resolveEffectiveResourceContentIdentities(publishedB) };
      const independentProof = freezeSelectedAIAgentTaskBinding(independentFreeze);
      const candidate = selectedA.candidate;
      const decision: ReviseExistingAIAgentDefinitionDecision = {
        schemaVersion: requirement.schemaVersion, mode: 'revise-existing',
        requirementDigest: requirement.requirementDigest, candidateSetDigest: settledA.candidateSetDigest,
        candidateRef: ref, candidateDigest: candidate.candidateDigest, reason: 'Revise only A',
        feedback: {
          observationRef: 'observation://a', attemptRef: 'attempt://a', verificationRef: 'verification://a',
          requirementDigest: requirement.requirementDigest, candidateSetDigest: settledA.candidateSetDigest,
          candidateDigest: candidate.candidateDigest, previousExecutionFingerprint: previousExecution.semanticFingerprint,
        },
        proposal: { ...createA.proposal, operation: 'update',
          authorityText: generatedAuthority().replace('Runtime-authored no-tools Worker', 'Revised owner A'),
          expected: { state: 'present', registryRevision: settledA.registryRevision,
            authorityDigest: resolveEffectiveResourceContentIdentities(publishedA).get('depa.flows.test.Agent.Generated')!.authorityDigest },
        },
      };
      expect(admitAIAgentDefinitionSelection({ selectionOwner: b.selectionOwner, requirement, candidateSet: settledA, decision, previousExecution }))
        .toMatchObject({ code: 'selection-owner-mismatch' });
      const revision = admitAIAgentDefinitionSelection({ selectionOwner: a.selectionOwner, requirement, candidateSet: settledA, decision, previousExecution });
      if (revision.status !== 'revision-request') throw new Error('revision required');
      const reobservedA = project({ ...await observe(rootA), selectionOwner: a.selectionOwner });
      expect(reobservedA.registry).not.toBe(publishedA.registry);
      expect(select(a.selectionOwner, reobservedA.candidateSet)).toMatchObject({ code: 'authoring-in-progress' });
      expect(select(b.selectionOwner, settledB).status).toBe('selected');
      expect(freezeSelectedAIAgentTaskBinding(independentFreeze).semanticFingerprint).toBe(independentProof.semanticFingerprint);
      expect(() => freezeSelectedAIAgentTaskBinding(freezeInput)).toThrow(AIAgentDefinitionSelectionError);
      for (const selectionOwner of [undefined, b.selectionOwner,
        createAIAgentDefinitionSelectionOwner({ receiptAuthority: a.runtime.transaction })]) {
        expect(() => projectAIAgentDefinitionCandidates({ ...reobservedA, selectionOwner })).toThrow('authentic selection owner');
        expect(admitAIAgentDefinitionSelection({ selectionOwner, requirement, candidateSet: settledA, decision, previousExecution }))
          .toMatchObject({ code: 'selection-owner-mismatch' });
      }
      const revisionReceipt = await applyResourceAuthoring(a.runtime, planResourceAuthoring(a.runtime, revision.proposal, {}), {});
      const revisedA = project(a.observation());
      expect(select(a.selectionOwner, revisedA.candidateSet)).toMatchObject({ code: 'authoring-in-progress' });
      const reconcile = { ...revisedA, authoringAdmission: revision, receipt: revisionReceipt, receiptAuthority: a.runtime.transaction };
      await expect(reconcileAuthoredAIAgentDefinition({ ...reconcile, selectionOwner: b.selectionOwner }))
        .rejects.toMatchObject({ code: 'AI_AGENT_SELECTION_OWNER_MISMATCH' });
      await expect(reconcileAuthoredAIAgentDefinition({ ...reconcile, ...publishedB }))
        .rejects.toMatchObject({ code: 'AI_AGENT_SELECTION_OWNER_MISMATCH' });
      const reconciled = await reconcileAuthoredAIAgentDefinition(reconcile);
      expect(select(a.selectionOwner, reconciled).status).toBe('selected');
      expect(select(a.selectionOwner, settledA)).toMatchObject({ code: 'candidate-set-stale' });
      expect(select(a.selectionOwner, reobservedA.candidateSet)).toMatchObject({ code: 'candidate-set-stale' });
      expect(select(a.selectionOwner, project(reobservedA).candidateSet)).toMatchObject({ code: 'candidate-set-stale' });
      expect(select(b.selectionOwner, settledB).status).toBe('selected');
      expect(freezeSelectedAIAgentTaskBinding(independentFreeze).semanticFingerprint).toBe(independentProof.semanticFingerprint);
      expect(previousExecution.task.agentDefinitionRef).toBe(ref);
    }));
  });

  test.each(['before-load', 'during-load'] as const)('rejects a delayed receipt whose observation was superseded by another Agent revision (%s)', async (timing) => {
    await withWorkspace(async (root) => {
      await writeFile(join(root, 'Policies/NoTools.xnl'), noToolsPolicy());
      const transaction = await createAuthoringRuntime(root);
      const { selectionOwner } = transaction;
      const project = () => {
        const observed = transaction.observation();
        const projection = projectAIWorkflowAgentResources(observed.registry);
        return { ...observed, projection, candidateSet: projectAIAgentDefinitionCandidates({ ...observed, projection }) };
      };
      const initial = project();
      const createRequirement = normalizeAIAgentTaskRequirement(generatedRequirement());
      const create = admitAIAgentDefinitionSelection({ selectionOwner, requirement: createRequirement,
        candidateSet: initial.candidateSet, decision: {
          schemaVersion: createRequirement.schemaVersion, mode: 'author-new',
          requirementDigest: createRequirement.requirementDigest, candidateSetDigest: initial.candidateSet.candidateSetDigest,
          agentDefinitionRef: 'resource://depa.flows.test.Agent.Generated',
          proposal: generatedProposal(initial.candidateSet.registryRevision), reason: 'Create another Agent',
        },
      });
      if (create.status !== 'authoring-request') throw new Error('create required');
      const createReceipt = await applyResourceAuthoring(transaction.runtime, planResourceAuthoring(transaction.runtime, create.proposal, {}), {});
      const created = project();
      const requirement = normalizeAIAgentTaskRequirement(supportRequirement());
      const candidate = created.candidateSet.candidates.find(value => value.agentDefinitionRef === 'resource://depa.flows.test.Agent.Support')!;
      const select = (candidateSet: typeof created.candidateSet) => admitAIAgentDefinitionSelection({ selectionOwner, requirement, candidateSet,
        decision: { schemaVersion: requirement.schemaVersion, mode: 'select-existing',
          requirementDigest: requirement.requirementDigest, candidateSetDigest: candidateSet.candidateSetDigest,
          candidateRef: candidate.agentDefinitionRef, candidateDigest: candidateSet.candidates.find(value => value.agentDefinitionRef === candidate.agentDefinitionRef)!.candidateDigest,
          reason: 'Use Support',
        },
      });
      const admission = select(created.candidateSet);
      if (admission.status !== 'selected') throw new Error('selection required');
      const previousExecution = freezeSelectedAIAgentTaskBinding({ ...created, admission,
        contentIdentities: resolveEffectiveResourceContentIdentities(created), workflowKind: 'AICtrlWorkflow',
        workflowRef: 'resource://depa.flows.test.Workflow.Support', nodeId: 'collect-request',
      });
      const original = await readFile(join(root, 'Agents/Support.xnl'), 'utf8');
      const revision = admitAIAgentDefinitionSelection({ selectionOwner, requirement, candidateSet: created.candidateSet, previousExecution,
        decision: { schemaVersion: requirement.schemaVersion, mode: 'revise-existing',
          requirementDigest: requirement.requirementDigest, candidateSetDigest: created.candidateSet.candidateSetDigest,
          candidateRef: candidate.agentDefinitionRef, candidateDigest: candidate.candidateDigest, reason: 'Revise Support first',
          feedback: { observationRef: 'observation://support', attemptRef: 'attempt://support', verificationRef: 'verification://support',
            requirementDigest: requirement.requirementDigest, candidateSetDigest: created.candidateSet.candidateSetDigest,
            candidateDigest: candidate.candidateDigest, previousExecutionFingerprint: previousExecution.semanticFingerprint },
          proposal: { ...generatedProposal(created.candidateSet.registryRevision), operation: 'update',
            resourceId: 'depa.flows.test.Agent.Support', documentUri: 'vfs://@/Agents/Support.xnl',
            authorityText: original.replace('Support Agent definition', 'Revised Support Agent definition'),
            expected: { state: 'present', registryRevision: created.candidateSet.registryRevision,
              authorityDigest: resolveEffectiveResourceContentIdentities(created).get('depa.flows.test.Agent.Support')!.authorityDigest },
          },
        },
      });
      if (revision.status !== 'revision-request') throw new Error('revision required');
      const revisionReceipt = await applyResourceAuthoring(transaction.runtime, planResourceAuthoring(transaction.runtime, revision.proposal, {}), {});
      const revised = project();
      const delayedInput = { ...created, authoringAdmission: create,
        receipt: createReceipt, receiptAuthority: transaction.runtime.transaction };
      let resumeLoad!: () => void;
      let loadStarted!: () => void;
      const loading = new Promise<void>(resolve => { loadStarted = resolve; });
      const resume = new Promise<void>(resolve => { resumeLoad = resolve; });
      const originalLoad = transaction.runtime.transaction.loadReceipt;
      transaction.runtime.transaction.loadReceipt = async planDigest => {
        if (timing === 'during-load' && planDigest === createReceipt.planDigest) {
          loadStarted();
          await resume;
        }
        return originalLoad(planDigest);
      };
      const delayed = timing === 'during-load' ? reconcileAuthoredAIAgentDefinition(delayedInput) : undefined;
      if (delayed) await loading;
      const reconciled = await reconcileAuthoredAIAgentDefinition({ ...revised, authoringAdmission: revision,
        receipt: revisionReceipt, receiptAuthority: transaction.runtime.transaction });
      expect(select(reconciled).status).toBe('selected');
      expect(select(created.candidateSet)).toMatchObject({ code: 'candidate-set-stale' });
      resumeLoad();
      await expect(delayed ?? reconcileAuthoredAIAgentDefinition(delayedInput))
        .rejects.toMatchObject({ code: 'AI_AGENT_AUTHORING_RECEIPT_STALE' });
      expect(select(created.candidateSet)).toMatchObject({ code: 'candidate-set-stale' });
    });
  });

  test.each([['workspace', false], ['global-then-workspace', false], ['workspace', true], ['global-then-workspace', true]] as const)('revises an authored Agent through native present CAS and durable receipts (%s, bridge=%s)', async (layerMode, bridge) => {
    await withWorkspace(async (root) => {
      await writeFile(join(root, 'Policies/NoTools.xnl'), noToolsPolicy());
      if (bridge) {
        await writeFile(join(root, 'KindDefinitions/AgentContextPipeline/manifest.xnl'), depaAIResourceKindContract('AgentContextPipeline', 2).kindDefinitionSource);
        await writeFile(join(root, 'ContextPipelines/Standard.xnl'), `<AgentContextPipeline #depa.flows.test.ContextPipeline.Standard envelopeVersion="halfcode.resource-envelope/v1" specVersion=2 { lifecycle="Active" } (
          <CodeBinding { packageName="test-selection" module="./pipeline.ts" exportName="compose" }>
          <Config { value={ prefix="resolved:" } }>
        )>`);
        await writeFile(join(root, 'pipeline.ts'), 'export function compose(runtime, input, config) { return config.prefix + runtime.value + input }');
      }
      const transaction = await createAuthoringRuntime(root, layerMode);
      const observeRevision = async () => {
        const observed = transaction.observation();
        if (!bridge) return { ...observed, executionResources: undefined, codeExecutions: undefined };
        const executionResources = resolveAIAgentExecutionResources({ resolutionContexts: new Map(observed.layers.map(layer =>
          [layer.id, createAIWorkflowResourceResolutionContext(undefined, layer.tree)])) }, observed);
        const codeRuntime = { source: await createDirectoryResourcePackageReadPort(root),
          sourceRoot: '/', entryPath: '/pipeline.ts', environment: { hostIdentity: 'selection-bridge/v1', ambient: {} } };
        const compiled = await compileAgentContextPipeline(codeRuntime,
        executionResources.projection.codeResources!.find(code => code.kind === 'AgentContextPipeline')!);
        await expect(compileAgentContextPipeline(codeRuntime,
          projectAIWorkflowAgentResources(executionResources.registry).codeResources!.find(code => code.kind === 'AgentContextPipeline')!))
          .rejects.toThrow('exact execution observation');
        expect(compiled.execute({ value: 'native:' }, 'input')).toBe('resolved:native:input');
        expect(compiled.artifact.resourceResolution).toEqual(executionResources.resolutionIdentities.get(compiled.artifact.resourceId));
        return { ...observed, executionResources, codeExecutions: [compiled] };
      };
      const requirement = normalizeAIAgentTaskRequirement(generatedRequirement());
      const initial = await observeRevision();
      const initialCandidates = projectAIAgentDefinitionCandidates({
        ...initial, projection: projectAIWorkflowAgentResources(initial.registry),
      });
      const createProposal = generatedProposal(initialCandidates.registryRevision);
      const authoring = admitAIAgentDefinitionSelection({
        selectionOwner: transaction.selectionOwner,
        requirement, candidateSet: initialCandidates,
        decision: {
          schemaVersion: requirement.schemaVersion, mode: 'author-new',
          requirementDigest: requirement.requirementDigest,
          candidateSetDigest: initialCandidates.candidateSetDigest,
          agentDefinitionRef: 'resource://depa.flows.test.Agent.Generated',
          proposal: createProposal, reason: 'Initial version',
        },
      });
      if (authoring.status !== 'authoring-request') throw new Error('create admission required');
      const createdReceipt = await applyResourceAuthoring(transaction.runtime,
        planResourceAuthoring(transaction.runtime, createProposal, {}), {});
      const observed = await observeRevision();
      const projection = projectAIWorkflowAgentResources(observed.registry);
      const candidateSet = await reconcileAuthoredAIAgentDefinition({
        ...observed, projection,
        candidateSet: projectAIAgentDefinitionCandidates({ ...observed, projection }),
        authoringAdmission: authoring, receipt: createdReceipt,
        receiptAuthority: transaction.runtime.transaction,
      });
      const candidate = candidateSet.candidates.find((value) => value.agentDefinitionRef === authoring.agentDefinitionRef)!;
      const select = (set: typeof candidateSet, value = candidate) => admitAIAgentDefinitionSelection({
        selectionOwner: transaction.selectionOwner,
        requirement, candidateSet: set,
        decision: {
          schemaVersion: requirement.schemaVersion, mode: 'select-existing',
          requirementDigest: requirement.requirementDigest, candidateSetDigest: set.candidateSetDigest,
          candidateRef: value.agentDefinitionRef, candidateDigest: value.candidateDigest, reason: 'Typed match',
        },
      });
      const selected = select(candidateSet);
      if (selected.status !== 'selected') throw new Error('selection required');
      const previousExecution = freezeSelectedAIAgentTaskBinding({
        ...observed, projection, admission: selected,
        contentIdentities: resolveEffectiveResourceContentIdentities(observed),
        workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://depa.flows.test.Workflow.Support', nodeId: 'worker',
      });
      const identity = resolveEffectiveResourceContentIdentities(observed).get('depa.flows.test.Agent.Generated')!;
      expect(identity.authorityDigest).not.toBe(candidate.contentDigest);
      const proposal: ResourceAuthoringProposal = {
        ...createProposal, operation: 'update',
        authorityText: generatedAuthority().replace('Runtime-authored no-tools Worker', 'Revised no-tools Worker'),
        expected: { state: 'present', registryRevision: candidateSet.registryRevision, authorityDigest: identity.authorityDigest },
      };
      const decision: ReviseExistingAIAgentDefinitionDecision = {
        schemaVersion: requirement.schemaVersion, mode: 'revise-existing',
        requirementDigest: requirement.requirementDigest, candidateSetDigest: candidateSet.candidateSetDigest,
        candidateRef: candidate.agentDefinitionRef, candidateDigest: candidate.candidateDigest,
        feedback: {
          observationRef: 'observation://attempt-1', attemptRef: 'attempt://worker-1', verificationRef: 'verification://worker-1',
          requirementDigest: requirement.requirementDigest, candidateSetDigest: candidateSet.candidateSetDigest,
          candidateDigest: candidate.candidateDigest, previousExecutionFingerprint: previousExecution.semanticFingerprint,
        },
        proposal, reason: 'Host feedback requests a resource revision',
      };
      const admit = (value: ReviseExistingAIAgentDefinitionDecision) => admitAIAgentDefinitionSelection({
        selectionOwner: transaction.selectionOwner,
        requirement, candidateSet, decision: value, previousExecution,
      });
      expect(admit({ ...decision, candidateDigest: sha256Digest('wrong') })).toMatchObject({ status: 'rejected', code: 'candidate-digest-mismatch' });
      for (const field of ['requirementDigest', 'candidateSetDigest', 'candidateDigest', 'previousExecutionFingerprint'] as const) {
        expect(admit({ ...decision, feedback: { ...decision.feedback, [field]: sha256Digest('wrong') } }))
          .toMatchObject({ status: 'rejected', code: 'revision-feedback-invalid' });
      }
      expect(admit({ ...decision, feedback: { ...decision.feedback, diagnosticAuthority: 'trust me' } } as never))
        .toMatchObject({ status: 'rejected', code: 'decision-invalid' });
      expect(admitAIAgentDefinitionSelection({ selectionOwner: transaction.selectionOwner, requirement, candidateSet, decision, previousExecution: { ...previousExecution } }))
        .toMatchObject({ status: 'rejected', code: 'revision-feedback-invalid' });
      expect(admit({ ...decision, proposal: { ...proposal, expected: { ...proposal.expected, authorityDigest: candidate.contentDigest } } as ResourceAuthoringProposal }))
        .toMatchObject({ status: 'rejected', code: 'authoring-proposal-invalid' });
      expect(admit({ ...decision, proposal: { ...proposal, documentUri: 'vfs://@/Agents/Foreign.xnl' } }))
        .toMatchObject({ status: 'rejected', code: 'authoring-proposal-invalid' });
      expect(admit({ ...decision, proposal: { ...proposal, expected: { ...proposal.expected, registryRevision: sha256Digest('stale-registry') } } }))
        .toMatchObject({ status: 'rejected', code: 'authoring-proposal-invalid' });
      const revision = admit(decision);
      expect(revision.status).toBe('revision-request');
      if (revision.status !== 'revision-request') throw new Error('revision admission required');
      expect(Object.isFrozen(revision.feedback)).toBe(true);
      expect(select(candidateSet)).toMatchObject({ status: 'rejected', code: 'authoring-in-progress' });
      expect(() => freezeSelectedAIAgentTaskBinding({
        ...observed, projection, admission: selected,
        contentIdentities: resolveEffectiveResourceContentIdentities(observed),
        workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://depa.flows.test.Workflow.Support', nodeId: 'pending-worker',
      })).toThrow(AIAgentDefinitionSelectionError);

      // The host transaction independently enforces authority CAS, not just admission validation.
      const staleProposal = { ...proposal, expected: { ...proposal.expected, authorityDigest: sha256Digest('stale') } } as ResourceAuthoringProposal;
      await expect(applyResourceAuthoring(transaction.runtime, planResourceAuthoring(transaction.runtime, staleProposal, {}), {})).rejects.toThrow();
      const receipt = await applyResourceAuthoring(transaction.runtime, planResourceAuthoring(transaction.runtime, proposal, {}), {});
      expect(receipt.authorityDigestBefore).toBe(identity.authorityDigest);
      expect(receipt.effectiveOrigin.layerId).toBe('workspace');
      if (layerMode === 'global-then-workspace') {
        expect(createdReceipt.effectiveOrigin.layerId).toBe('global');
        expect(await readFile(join(root, 'Agents/Generated.xnl'), 'utf8')).toBe(createProposal.authorityText);
        expect(await readFile(join(root, '.workspace/Agents/Generated.xnl'), 'utf8')).toBe(proposal.authorityText);
      }
      const refreshed = await observeRevision();
      const newProjection = projectAIWorkflowAgentResources(refreshed.registry);
      const newCandidates = projectAIAgentDefinitionCandidates({ ...refreshed, projection: newProjection });
      const reconciliation = {
        ...refreshed, projection: newProjection, candidateSet: newCandidates,
        authoringAdmission: revision, receipt, receiptAuthority: transaction.runtime.transaction,
      };
      const { receiptDigest: _digest, ...unsigned } = receipt;
      for (const patch of [{ transactionId: 'forged' }, { authorityDigestBefore: sha256Digest('wrong-before') }, { catalogId: 'foreign' }]) {
        const forged = { ...unsigned, ...patch };
        await expect(reconcileAuthoredAIAgentDefinition({ ...reconciliation,
          receipt: { ...forged, receiptDigest: sha256Digest(canonicalJson(forged)) },
        })).rejects.toBeInstanceOf(AIAgentDefinitionSelectionError);
      }
      // Exact durable load alone is insufficient: independently check all admitted authority facts.
      for (const patch of [
        { authorityDigestBefore: sha256Digest('wrong-before') },
        { effectiveOrigin: { ...receipt.effectiveOrigin, layerId: 'foreign' } },
        { authorityResourceIds: ['depa.flows.test.Agent.Foreign'] },
        { registryRevisionAfter: sha256Digest('stale-registry') },
      ]) {
        const forged = { ...unsigned, ...patch };
        const durable = { ...forged, receiptDigest: sha256Digest(canonicalJson(forged)) };
        const originalLoadReceipt = transaction.runtime.transaction.loadReceipt;
        transaction.runtime.transaction.loadReceipt = async () => durable;
        try {
          await expect(reconcileAuthoredAIAgentDefinition({ ...reconciliation, receipt: durable }))
            .rejects.toBeInstanceOf(AIAgentDefinitionSelectionError);
        } finally {
          transaction.runtime.transaction.loadReceipt = originalLoadReceipt;
        }
      }
      await expect(reconcileAuthoredAIAgentDefinition({ ...reconciliation, receipt: createdReceipt })).rejects.toBeInstanceOf(AIAgentDefinitionSelectionError);
      await expect(reconcileAuthoredAIAgentDefinition({ ...reconciliation, receiptAuthority: { loadReceipt: async () => createdReceipt } })).rejects.toBeInstanceOf(AIAgentDefinitionSelectionError);
      const reconciled = await reconcileAuthoredAIAgentDefinition(reconciliation);
      const revisedCandidate = reconciled.candidates.find((value) => value.agentDefinitionRef === candidate.agentDefinitionRef)!;
      expect(revisedCandidate.contentDigest).not.toBe(candidate.contentDigest);
      expect(candidate.authoringEvidence).not.toHaveProperty('revision');
      expect(revisedCandidate.authoringEvidence?.revision).toEqual({
        candidateRef: candidate.agentDefinitionRef,
        candidateDigest: candidate.candidateDigest,
        contentDigest: candidate.contentDigest,
        registryRevision: candidate.registryRevision,
        feedback: decision.feedback,
      });
      expect(Object.isFrozen(revisedCandidate.authoringEvidence?.revision)).toBe(true);
      expect(Object.isFrozen(revisedCandidate.authoringEvidence?.revision?.feedback)).toBe(true);
      const { candidateDigest: _candidateDigest, ...unsignedCandidate } = revisedCandidate;
      expect(revisedCandidate.candidateDigest).toBe(sha256Digest(canonicalJson(unsignedCandidate)));
      const { revision: _revision, ...createShapedEvidence } = revisedCandidate.authoringEvidence!;
      expect(revisedCandidate.candidateDigest).not.toBe(sha256Digest(canonicalJson({
        ...unsignedCandidate, authoringEvidence: createShapedEvidence,
      })));
      const revisedSelection = select(reconciled, revisedCandidate);
      if (revisedSelection.status !== 'selected') throw new Error('revised selection required');
      const nextExecution = freezeSelectedAIAgentTaskBinding({
        ...refreshed, projection: newProjection, admission: revisedSelection,
        contentIdentities: resolveEffectiveResourceContentIdentities(refreshed),
        workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://depa.flows.test.Workflow.Support', nodeId: 'worker',
      });
      if (bridge) {
        expect(nextExecution.resourceResolutions).toBeDefined();
        expect(() => freezeSelectedAIAgentTaskBinding({
          ...refreshed, projection: newProjection, admission: revisedSelection, codeExecutions: observed.codeExecutions,
          contentIdentities: resolveEffectiveResourceContentIdentities(refreshed),
          workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://depa.flows.test.Workflow.Support', nodeId: 'worker',
        })).toThrow();
      }
      expect(nextExecution.semanticFingerprint).not.toBe(previousExecution.semanticFingerprint);
      expect(previousExecution.task.agentDefinitionRef).toBe(candidate.agentDefinitionRef);
      expect(select(candidateSet)).toMatchObject({ status: 'rejected', code: 'candidate-set-stale' });
      expect(() => freezeSelectedAIAgentTaskBinding({
        ...observed, projection, admission: selected,
        contentIdentities: resolveEffectiveResourceContentIdentities(observed),
        workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://depa.flows.test.Workflow.Support', nodeId: 'stale-worker',
      })).toThrow(AIAgentDefinitionSelectionError);
      expect(admitAIAgentDefinitionSelection({
        selectionOwner: transaction.selectionOwner,
        requirement, candidateSet: reconciled, previousExecution,
        decision: { ...decision, candidateDigest: revisedCandidate.candidateDigest, candidateSetDigest: reconciled.candidateSetDigest,
          feedback: { ...decision.feedback, candidateDigest: revisedCandidate.candidateDigest, candidateSetDigest: reconciled.candidateSetDigest },
        },
      })).toMatchObject({ status: 'rejected', code: 'revision-feedback-invalid' });
    });
  });

  test('projects detached exact candidates and rejects fuzzy but typed-incompatible choice', async () => {
    await withWorkspace(async (root) => {
      await writeFile(join(root, 'Agents/ProcessRequest.xnl'), fuzzyAgent());
      const observed = await observe(root);
      const requirement = normalizeAIAgentTaskRequirement(supportRequirement());
      const candidateSet = projectAIAgentDefinitionCandidates({
        ...observed,
        projection: projectAIWorkflowAgentResources(observed.registry),
      });

      expect(candidateSet.candidates.map(({ agentDefinitionRef }) => agentDefinitionRef)).toEqual([
        'resource://depa.flows.test.Agent.ProcessRequest',
        'resource://depa.flows.test.Agent.Support',
      ]);
      expect(candidateSet.registryRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(candidateSet.candidateSetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(Object.isFrozen(candidateSet.candidates[0]?.contract.toolRefs)).toBe(true);

      const fuzzy = candidateSet.candidates[0]!;
      expect(admitAIAgentDefinitionSelection({
        requirement,
        candidateSet,
        decision: {
          schemaVersion: requirement.schemaVersion,
          mode: 'select-existing',
          requirementDigest: requirement.requirementDigest,
          candidateSetDigest: candidateSet.candidateSetDigest,
          candidateRef: fuzzy.agentDefinitionRef,
          candidateDigest: fuzzy.candidateDigest,
          reason: 'Its resource id and description resemble the objective.',
        },
      })).toMatchObject({ status: 'rejected', code: 'candidate-incompatible' });

      const support = candidateSet.candidates[1]!;
      const selected = admitAIAgentDefinitionSelection({
        requirement,
        candidateSet,
        decision: {
          schemaVersion: requirement.schemaVersion,
          mode: 'select-existing',
          requirementDigest: requirement.requirementDigest,
          candidateSetDigest: candidateSet.candidateSetDigest,
          candidateRef: support.agentDefinitionRef,
          candidateDigest: support.candidateDigest,
          reason: 'Every exact schema, tool, effect, material and context fact is compatible.',
        },
      });
      expect(selected).toMatchObject({
        status: 'selected',
        candidate: { agentDefinitionRef: 'resource://depa.flows.test.Agent.Support' },
      });

      const stale = admitAIAgentDefinitionSelection({
        requirement,
        candidateSet,
        decision: {
          schemaVersion: requirement.schemaVersion,
          mode: 'select-existing',
          requirementDigest: requirement.requirementDigest,
          candidateSetDigest: candidateSet.candidateSetDigest,
          candidateRef: support.agentDefinitionRef,
          candidateDigest: `sha256:${'0'.repeat(64)}`,
          reason: 'tampered',
        },
      });
      expect(stale).toMatchObject({ status: 'rejected', code: 'candidate-digest-mismatch' });
      expect(admitAIAgentDefinitionSelection({
        requirement,
        candidateSet,
        decision: {
          schemaVersion: requirement.schemaVersion,
          mode: 'select-existing',
          requirementDigest: requirement.requirementDigest,
          candidateSetDigest: candidateSet.candidateSetDigest,
          candidateRef: support.agentDefinitionRef,
          candidateDigest: support.candidateDigest,
          reason: 'closed-shape check',
          executableRef: 'code://forbidden',
        } as never,
      })).toMatchObject({ status: 'rejected', code: 'decision-invalid' });
    });
  });

  test('keeps author-new non-executable until a real Halfcode receipt is reconciled, then freezes it normally', async () => {
    await withWorkspace(async (root) => {
      await writeFile(join(root, 'Policies/NoTools.xnl'), noToolsPolicy());
      const transaction = await createAuthoringRuntime(root);
      const initial = transaction.observation();
      const initialProjection = projectAIWorkflowAgentResources(initial.registry);
      const initialCandidates = projectAIAgentDefinitionCandidates({
        ...initial,
        projection: initialProjection,
      });
      const requirement = normalizeAIAgentTaskRequirement(generatedRequirement());
      const proposal = generatedProposal(initialCandidates.registryRevision);

      const authoring = admitAIAgentDefinitionSelection({
        selectionOwner: transaction.selectionOwner,
        requirement,
        candidateSet: initialCandidates,
        decision: {
          schemaVersion: requirement.schemaVersion,
          mode: 'author-new',
          requirementDigest: requirement.requirementDigest,
          candidateSetDigest: initialCandidates.candidateSetDigest,
          agentDefinitionRef: 'resource://depa.flows.test.Agent.Generated',
          proposal,
          reason: 'No observed definition has the exact no-tools effect contract.',
        },
      });
      expect(authoring).toMatchObject({ status: 'authoring-request', proposal });
      expect('candidate' in authoring).toBe(false);

      const plan = planResourceAuthoring(transaction.runtime, proposal, {});
      const receipt = await applyResourceAuthoring(transaction.runtime, plan, {});
      const refreshed = transaction.observation();
      const projection = projectAIWorkflowAgentResources(refreshed.registry);
      const candidates = projectAIAgentDefinitionCandidates({ ...refreshed, projection });
      const generatedBeforeReceiptGate = candidates.candidates.find(({ agentDefinitionRef }) =>
        agentDefinitionRef === 'resource://depa.flows.test.Agent.Generated')!;
      expect(admitAIAgentDefinitionSelection({
        selectionOwner: transaction.selectionOwner,
        requirement,
        candidateSet: candidates,
        decision: {
          schemaVersion: requirement.schemaVersion,
          mode: 'select-existing',
          requirementDigest: requirement.requirementDigest,
          candidateSetDigest: candidates.candidateSetDigest,
          candidateRef: generatedBeforeReceiptGate.agentDefinitionRef,
          candidateDigest: generatedBeforeReceiptGate.candidateDigest,
          reason: 'Attempt to bypass the durable receipt gate.',
        },
      })).toMatchObject({ status: 'rejected', code: 'authoring-in-progress' });
      if (authoring.status !== 'authoring-request') throw new Error('authoring admission required');

      const { receiptDigest: _receiptDigest, ...unsignedReceipt } = receipt;
      const forgedUnsignedReceipt = { ...unsignedReceipt, transactionId: 'forged' };
      const forgedReceipt = {
        ...forgedUnsignedReceipt,
        receiptDigest: sha256Digest(canonicalJson(forgedUnsignedReceipt)),
      } satisfies ResourceAuthoringReceipt;
      await expect(reconcileAuthoredAIAgentDefinition({
        ...refreshed,
        projection,
        candidateSet: candidates,
        authoringAdmission: authoring,
        receipt: forgedReceipt,
        receiptAuthority: transaction.runtime.transaction,
      })).rejects.toBeInstanceOf(AIAgentDefinitionSelectionError);

      const reconciled = await reconcileAuthoredAIAgentDefinition({
        ...refreshed,
        projection,
        candidateSet: candidates,
        authoringAdmission: authoring,
        receipt,
        receiptAuthority: transaction.runtime.transaction,
      });
      const generated = reconciled.candidates.find(({ agentDefinitionRef }) =>
        agentDefinitionRef === 'resource://depa.flows.test.Agent.Generated')!;
      expect(generated.authoringEvidence).toMatchObject({
        schemaVersion: 'ai-workflow.agent-definition-authoring-evidence/v1',
        transactionId: receipt.transactionId,
      });
      expect(generated.authoringEvidence?.planDigest).toBe(receipt.planDigest as `sha256:${string}`);
      expect(generated.authoringEvidence?.receiptDigest).toBe(receipt.receiptDigest as `sha256:${string}`);

      const selection = admitAIAgentDefinitionSelection({
        selectionOwner: transaction.selectionOwner,
        requirement,
        candidateSet: reconciled,
        decision: {
          schemaVersion: requirement.schemaVersion,
          mode: 'select-existing',
          requirementDigest: requirement.requirementDigest,
          candidateSetDigest: reconciled.candidateSetDigest,
          candidateRef: generated.agentDefinitionRef,
          candidateDigest: generated.candidateDigest,
          reason: 'The refreshed resource now satisfies every typed constraint.',
        },
      });
      expect(selection.status).toBe('selected');
      if (selection.status !== 'selected') throw new Error('selection must be admitted');
      const proof = freezeSelectedAIAgentTaskBinding({
        selectionOwner: transaction.selectionOwner,
        registry: refreshed.registry,
        projection,
        contentIdentities: resolveEffectiveResourceContentIdentities(refreshed),
        admission: selection,
        workflowKind: 'AICtrlWorkflow',
        workflowRef: 'resource://depa.flows.test.Workflow.Support',
        nodeId: 'generated-worker',
      });
      expect(proof.task.agentDefinitionRef).toBe('resource://depa.flows.test.Agent.Generated');
      expect(proof.closureResourceIds).toContain('depa.flows.test.Policy.NoTools');

      await expect(reconcileAuthoredAIAgentDefinition({
        ...refreshed,
        projection,
        candidateSet: candidates,
        authoringAdmission: authoring,
        receipt: { ...receipt, kind: 'Prompt' },
        receiptAuthority: transaction.runtime.transaction,
      })).rejects.toBeInstanceOf(AIAgentDefinitionSelectionError);
      expect(() => freezeSelectedAIAgentTaskBinding({
        selectionOwner: transaction.selectionOwner,
        registry: refreshed.registry,
        projection,
        contentIdentities: resolveEffectiveResourceContentIdentities(refreshed),
        admission: { ...selection },
        workflowKind: 'AICtrlWorkflow',
        workflowRef: 'resource://depa.flows.test.Workflow.Support',
        nodeId: 'forged-worker',
      })).toThrow(AIAgentDefinitionSelectionError);

      const reobserved = await observe(root);
      const reprojected = projectAIWorkflowAgentResources(reobserved.registry);
      expect(() => freezeSelectedAIAgentTaskBinding({
        selectionOwner: transaction.selectionOwner,
        registry: reobserved.registry,
        projection: reprojected,
        contentIdentities: resolveEffectiveResourceContentIdentities(reobserved),
        admission: selection,
        workflowKind: 'AICtrlWorkflow',
        workflowRef: 'resource://depa.flows.test.Workflow.Support',
        nodeId: 'stale-worker',
      })).toThrow(AIAgentDefinitionSelectionError);

      await writeFile(join(root, 'ContextMaterials/AfterReceipt.xnl'), [
        '<ContextMaterial #depa.flows.test.Material.AfterReceipt envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 {',
        '  value = "changes-current-registry"',
        '}>',
        '',
      ].join('\n'));
      const changed = { ...await observe(root), selectionOwner: transaction.selectionOwner };
      const changedProjection = projectAIWorkflowAgentResources(changed.registry);
      const changedCandidates = projectAIAgentDefinitionCandidates({ ...changed, projection: changedProjection });
      await expect(reconcileAuthoredAIAgentDefinition({
        ...changed,
        projection: changedProjection,
        candidateSet: changedCandidates,
        authoringAdmission: authoring,
        receipt,
        receiptAuthority: transaction.runtime.transaction,
      })).rejects.toBeInstanceOf(AIAgentDefinitionSelectionError);
    });
  });
});

function supportRequirement(): AIAgentTaskRequirement {
  return {
    schemaVersion: 'ai-workflow.agent-definition-selection/v1',
    requirementId: 'support-request',
    objective: 'Process the support request with workspace context.',
    inputSchemaRef: 'resource://depa.flows.test.Schema.Request',
    outputSchemaRef: 'resource://depa.flows.test.Schema.Response',
    requiredToolRefs: ['resource://depa.flows.test.Tool.Lookup'],
    requiredEffectPolicyRef: 'resource://depa.flows.test.Policy.Safe',
    requiredToolMode: 'declared-only',
    requiredMaterialPortRefs: [
      'resource://depa.flows.test.Port.Request',
      'resource://depa.flows.test.Port.Context',
    ],
    requiredContextPipelineRef: 'resource://depa.flows.test.ContextPipeline.Standard',
    requiredMessageSourceRefs: ['resource://depa.flows.test.MessageSource.Workspace'],
  };
}

function generatedRequirement(): AIAgentTaskRequirement {
  return {
    schemaVersion: 'ai-workflow.agent-definition-selection/v1',
    requirementId: 'generated-no-tools-worker',
    objective: 'Create a deterministic Worker that is forbidden from invoking tools.',
    inputSchemaRef: 'resource://depa.flows.test.Schema.Request',
    outputSchemaRef: 'resource://depa.flows.test.Schema.Response',
    requiredToolRefs: [],
    requiredEffectPolicyRef: 'resource://depa.flows.test.Policy.NoTools',
    requiredToolMode: 'none',
    requiredMaterialPortRefs: [],
    requiredContextPipelineRef: 'resource://depa.flows.test.ContextPipeline.Standard',
    requiredMessageSourceRefs: ['resource://depa.flows.test.MessageSource.Workspace'],
  };
}

function fuzzyAgent(): string {
  return [
    '<AIAgentDefinition #depa.flows.test.Agent.ProcessRequest envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 {',
    '  description = "Process the support request with workspace context"',
    '} (',
    '  <MessagePrefix [',
    '    <Message #system { role = "system" promptKind = "Prompt" promptRef = "resource://depa.flows.test.Prompt.System" }>',
    '  ]>',
    '  <ToolRefs []>',
    '  <MaterialPortRefs []>',
    ')>',
    '',
  ].join('\n');
}

function noToolsPolicy(): string {
  return [
    '<EffectPolicy #depa.flows.test.Policy.NoTools envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 {',
    '  lifecycle = "Stable"',
    '  toolMode = "none"',
    '}>',
    '',
  ].join('\n');
}

function generatedAuthority(): string {
  return [
    '<AIAgentDefinition #depa.flows.test.Agent.Generated envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 {',
    '  lifecycle = "Active"',
    '  description = "Runtime-authored no-tools Worker"',
    '} (',
    '  <MessagePrefix [',
    '    <Message #system { role = "system" promptKind = "Prompt" promptRef = "resource://depa.flows.test.Prompt.System" }>',
    '    <MessageSource #workspace { kind = "AgentMessageSource" ref = "resource://depa.flows.test.MessageSource.Workspace" }>',
    '  ]>',
    '  <ContextPipeline { kind = "AgentContextPipeline" ref = "resource://depa.flows.test.ContextPipeline.Standard" }>',
    '  <InputSchemaRef { kind = "MessageSchema" ref = "resource://depa.flows.test.Schema.Request" }>',
    '  <OutputSchemaRef { kind = "MessageSchema" ref = "resource://depa.flows.test.Schema.Response" }>',
    '  <ToolRefs []>',
    '  <EffectPolicyRef { kind = "EffectPolicy" ref = "resource://depa.flows.test.Policy.NoTools" }>',
    '  <MaterialPortRefs []>',
    ')>',
    '',
  ].join('\n');
}

function generatedProposal(registryRevision: string): ResourceAuthoringProposal {
  return {
    schemaVersion: RESOURCE_AUTHORING_SCHEMA_VERSION,
    operation: 'create',
    catalogId: 'agents',
    resourceId: 'depa.flows.test.Agent.Generated',
    kind: 'AIAgentDefinition',
    envelopeVersion: DEPA_AI_RESOURCE_ENVELOPE_VERSION,
    writerSpecVersion: DEPA_AI_RESOURCE_SPEC_VERSION,
    sourceShape: 'single-file',
    documentUri: 'vfs://@/Agents/Generated.xnl',
    authorityText: generatedAuthority(),
    expected: { state: 'absent', registryRevision },
  };
}

async function observe(root: string) {
  const tree = await loadResourceTree({ rootDir: root });
  const layers = [{ id: 'workspace', tree }] as const;
  const registry = composeLayeredResourceRegistry({ layers });
  return { registry, layers };
}

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'depa-agent-selection-'));
  try {
    await cp(fixtureRoot, root, { recursive: true });
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

interface TestAuthoringTransaction {
  readonly selectionOwner: AIAgentDefinitionSelectionOwner;
  readonly runtime: ResourceAuthoringRuntime;
  observation(): {
    readonly selectionOwner: AIAgentDefinitionSelectionOwner;
    readonly registry: EffectiveResourceRegistry;
    readonly layers: readonly ResourceLayerContentIdentityInput[];
  };
}

async function createAuthoringRuntime(
  root: string,
  layerMode: 'workspace' | 'global-then-workspace' = 'workspace',
): Promise<TestAuthoringTransaction> {
  let tree: AuthoredResourceTree = await loadResourceTree({ rootDir: root });
  let layers: readonly ResourceLayerContentIdentityInput[] = [{ id: layerMode === 'workspace' ? 'workspace' : 'global', tree }];
  let registry = composeLayeredResourceRegistry({ layers });
  let registryRevision = deriveResourceAuthoringRegistryRevision({ registry, layers });
  let sequence = 0;
  const receiptsRoot = join(root, '.authoring-receipts');
  await mkdir(receiptsRoot);
  const prepared = new Map<string, {
    readonly planDigest: string;
    readonly resourceId: string;
    readonly relativePath: string;
    readonly authorityText: string;
    readonly authorityDigest: string;
    readonly authorityDigestBefore: string | null;
    candidate?: ResourceAuthoringRefreshCandidate;
    candidateRoot?: string;
  }>();
  const agentKindContract = depaAIResourceKindContract('AIAgentDefinition');
  const planningAuthority: ResourceAuthoringPlanningAuthority = {
    registryRevision,
    kindDefinitions: [{
      kind: 'AIAgentDefinition',
      specRevisions: [{
        specVersion: agentKindContract.revision.specVersion,
        schemaRef: 'vfs://./spec-v1.schema.json',
        schemaFingerprint: agentKindContract.revision.schemaFingerprint,
        contractFingerprint: agentKindContract.revision.contractFingerprint,
        semanticContract: agentKindContract.revision.semanticContract,
        stability: agentKindContract.revision.stability,
      }],
      sourceShapes: ['single-file'],
      documentCardinality: 'one',
    }],
    catalogs: [{
      catalogId: 'agents',
      resourceKind: 'AIAgentDefinition',
      sourceShape: 'single-file',
      rootUri: 'vfs://@/Agents/',
    }],
  };
  const runtime: ResourceAuthoringRuntime = {
    get planningAuthority() { return { ...planningAuthority, registryRevision }; },
    inspectAuthority({ documentUri, authorityText }) {
      const match = /<([A-Za-z][A-Za-z0-9.]*) #([^\s]+) envelopeVersion="([^"]+)" specVersion=([1-9][0-9]*)/u.exec(authorityText);
      return {
        documentUri,
        resources: match ? [{
          resourceId: match[2]!,
          kind: match[1]!,
          envelopeVersion: match[3]!,
          writerSpecVersion: Number(match[4]),
        }] : [],
      };
    },
    transaction: {
      async loadReceipt(planDigest) {
        try {
          return JSON.parse(await readFile(join(receiptsRoot, `${planDigest}.json`), 'utf8'));
        } catch { return undefined; }
      },
      async prepare(input) {
        const resourceId = /<AIAgentDefinition #([^\s]+)/u.exec(input.authorityText)![1]!;
        const relativePath = input.documentUri.slice('vfs://@/'.length);
        const currentDigest = resolveEffectiveResourceContentIdentities({ registry, layers })
          .get(resourceId)?.authorityDigest ?? null;
        if (input.expected.registryRevision !== registryRevision
          || (input.expected.state === 'absent' ? currentDigest !== null : input.expected.authorityDigest !== currentDigest)) {
          throw new Error('stale authoring expectation');
        }
        const transactionId = `tx-${++sequence}`;
        prepared.set(transactionId, {
          planDigest: input.planDigest,
          resourceId,
          relativePath,
          authorityText: input.authorityText,
          authorityDigest: input.authorityDigest,
          authorityDigestBefore: currentDigest,
        });
        return {
          transactionId,
          planDigest: input.planDigest,
          authorityDigestBefore: currentDigest,
          registryRevisionBefore: registryRevision,
        };
      },
      async refreshCandidate(input) {
        const state = prepared.get(input.transactionId);
        if (!state || state.planDigest !== input.planDigest) throw new Error('unknown prepared transaction');
        const candidateRoot = await mkdtemp(join(tmpdir(), 'depa-agent-authoring-candidate-'));
        await cp(root, candidateRoot, { recursive: true });
        await writeFile(join(candidateRoot, state.relativePath), state.authorityText);
        const candidateTree = await loadResourceTree({ rootDir: candidateRoot });
        const isOverride = layerMode === 'global-then-workspace' && state.authorityDigestBefore !== null;
        const targetLayerId = layerMode === 'workspace' || isOverride ? 'workspace' : 'global';
        const candidateLayers = isOverride
          ? [...layers.filter(({ id }) => id === 'global'), { id: targetLayerId, tree: candidateTree }]
          : [{ id: targetLayerId, tree: candidateTree }];
        const candidate = {
          transactionId: input.transactionId,
          candidateId: `candidate-${input.transactionId}`,
          targetLayerId,
          tree: candidateTree,
          registry: composeLayeredResourceRegistry({ layers: candidateLayers }),
          layers: candidateLayers,
        } satisfies ResourceAuthoringRefreshCandidate;
        state.candidate = candidate;
        state.candidateRoot = candidateRoot;
        return candidate;
      },
      async commit(input) {
        const state = prepared.get(input.transactionId);
        if (!state?.candidate || state.candidate.candidateId !== input.candidateId) {
          throw new Error('unknown authoring candidate');
        }
        const currentDigest = resolveEffectiveResourceContentIdentities({ registry, layers })
          .get(state.resourceId)?.authorityDigest ?? null;
        if (currentDigest !== state.authorityDigestBefore || registryRevision !== input.receipt.registryRevisionBefore) {
          throw new Error('stale commit CAS');
        }
        if (layerMode === 'global-then-workspace' && state.authorityDigestBefore !== null) {
          await cp(state.candidateRoot!, join(root, '.workspace'), { recursive: true });
        } else {
          await writeFile(join(root, state.relativePath), state.authorityText);
        }
        tree = state.candidate.tree;
        layers = state.candidate.layers;
        registry = state.candidate.registry;
        registryRevision = input.receipt.registryRevisionAfter;
        await writeFile(join(receiptsRoot, `${input.receipt.planDigest}.json`), JSON.stringify(input.receipt));
        if (state.candidateRoot) await rm(state.candidateRoot, { recursive: true, force: true });
        return input.receipt;
      },
      async rollback(input) {
        const state = prepared.get(input.transactionId);
        if (state?.candidateRoot) await rm(state.candidateRoot, { recursive: true, force: true });
      },
    },
  };
  const selectionOwner = createAIAgentDefinitionSelectionOwner({ receiptAuthority: runtime.transaction });
  return {
    runtime,
    selectionOwner,
    observation: () => ({ registry, layers, selectionOwner }),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
