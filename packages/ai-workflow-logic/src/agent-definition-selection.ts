import type {
  AIAgentDefinitionAuthoringEvidence,
  AIAgentDefinitionCandidate,
  AIAgentDefinitionCandidateContract,
  AIAgentDefinitionCandidateSet,
  AIAgentDefinitionSelectionAdmission,
  AIAgentDefinitionSelectionDecision,
  AIAgentTaskRequirement,
  AIAgentTaskRequirementProjection,
  AuthorNewAIAgentDefinitionAdmission,
  AIWorkflowAgentResourceProjection,
  AIWorkflowDefinitionResourceKind,
  FrozenAIAgentTaskBinding,
  SelectedAIAgentDefinitionAdmission,
  CompiledAIAgentCodeExecution,
  ReviseExistingAIAgentDefinitionAdmission,
  ReviseExistingAIAgentDefinitionDecision,
} from 'ai-workflow-contract';
import { AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION } from 'ai-workflow-contract';
import {
  RESOURCE_AUTHORING_SCHEMA_VERSION,
  deriveResourceAuthoringRegistryRevision,
  type ResourceAuthoringProposal,
  type ResourceAuthoringReceipt,
  type ResourceAuthoringTransactionPort,
} from 'halfcode-compiler.xnl/authoring-runtime';
import {
  RESOURCE_ENVELOPE_VERSION,
  resolveEffectiveResourceContentIdentities,
  sha256Digest,
  type EffectiveResourceRegistry,
  type ResourceContentIdentity,
  type ResourceLayerContentIdentityInput,
  type ResourceOrigin,
  type Sha256Digest,
} from 'halfcode-compiler.xnl/resource-core';
import { sourceRegistryForAIWorkflowAgentResourceProjection } from './agent-resource-brand.js';
import { assertAIAgentExecutionResources, type AIAgentExecutionResourceObservation } from './agent-execution-resources.js';
import {
  freezeAIWorkflowRunResources,
  frozenAIAgentTaskAgentContentDigest,
  projectFrozenAIAgentTaskBinding,
} from './run-freeze.js';

export type AIAgentDefinitionSelectionErrorCode =
  | 'AI_AGENT_REQUIREMENT_INVALID'
  | 'AI_AGENT_CANDIDATE_PROJECTION_UNTRUSTED'
  | 'AI_AGENT_CANDIDATE_CONTENT_IDENTITY_MISSING'
  | 'AI_AGENT_SELECTION_OWNER_MISMATCH'
  | 'AI_AGENT_AUTHORING_RECEIPT_INVALID'
  | 'AI_AGENT_AUTHORING_RECEIPT_STALE'
  | 'AI_AGENT_AUTHORING_RECEIPT_RESOURCE_MISMATCH'
  | 'AI_AGENT_SELECTION_ADMISSION_UNTRUSTED';

export class AIAgentDefinitionSelectionError extends Error {
  constructor(
    public readonly code: AIAgentDefinitionSelectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AIAgentDefinitionSelectionError';
  }
}

export interface ProjectAIAgentDefinitionCandidatesInput {
  readonly executionResources?: AIAgentExecutionResourceObservation;
  /** Reuse one owner for all observations of the same resource host. */
  readonly selectionOwner?: AIAgentDefinitionSelectionOwner;
  readonly registry: EffectiveResourceRegistry;
  readonly projection: AIWorkflowAgentResourceProjection;
  readonly layers: readonly ResourceLayerContentIdentityInput[];
}

export interface ReconcileAuthoredAIAgentDefinitionInput
  extends ProjectAIAgentDefinitionCandidatesInput {
  readonly candidateSet: AIAgentDefinitionCandidateSet;
  readonly authoringAdmission: AuthorNewAIAgentDefinitionAdmission | ReviseExistingAIAgentDefinitionAdmission;
  readonly receipt: ResourceAuthoringReceipt;
  readonly receiptAuthority: Pick<ResourceAuthoringTransactionPort, 'loadReceipt'>;
}

export interface AdmitAIAgentDefinitionSelectionInput {
  readonly selectionOwner?: AIAgentDefinitionSelectionOwner;
  readonly requirement: AIAgentTaskRequirementProjection;
  readonly candidateSet: AIAgentDefinitionCandidateSet;
  readonly decision: AIAgentDefinitionSelectionDecision;
  /** Required for revise-existing; an authentic immutable proof from the previous execution. */
  readonly previousExecution?: FrozenAIAgentTaskBinding;
}

export interface FreezeSelectedAIAgentTaskBindingInput {
  readonly executionResources?: AIAgentExecutionResourceObservation;
  readonly selectionOwner?: AIAgentDefinitionSelectionOwner;
  readonly codeExecutions?: readonly CompiledAIAgentCodeExecution[];
  readonly registry: EffectiveResourceRegistry;
  readonly projection: AIWorkflowAgentResourceProjection;
  readonly contentIdentities: ReadonlyMap<string, ResourceContentIdentity>;
  readonly admission: SelectedAIAgentDefinitionAdmission;
  readonly workflowKind: AIWorkflowDefinitionResourceKind;
  readonly workflowRef: `resource://${string}`;
  readonly nodeId: string;
}

interface CandidateSetAuthority {
  readonly executionResources?: AIAgentExecutionResourceObservation;
  readonly selectionOwner?: AIAgentDefinitionSelectionOwner;
  readonly generation: number;
  readonly registry: EffectiveResourceRegistry;
  readonly projection: AIWorkflowAgentResourceProjection;
  readonly layers: readonly ResourceLayerContentIdentityInput[];
}

interface AuthoringAdmissionAuthority {
  readonly candidateSetAuthority: CandidateSetAuthority;
  readonly candidateSet: AIAgentDefinitionCandidateSet;
  readonly requirement: AIAgentTaskRequirementProjection;
  readonly proposalDigest: Sha256Digest;
  readonly before?: {
    readonly authorityDigest: Sha256Digest;
    readonly effectiveOrigin: ResourceOrigin;
    readonly authorityResourceIds: readonly string[];
  };
}

const authenticRequirements = new WeakSet<object>();
const candidateSetAuthorities = new WeakMap<object, CandidateSetAuthority>();
const selectedAdmissionAuthorities = new WeakMap<object, CandidateSetAuthority>();
const authoringAdmissionAuthorities = new WeakMap<object, AuthoringAdmissionAuthority>();
declare const selectionOwnerBrand: unique symbol;

/** Process-local state dependency. It is not a resource identity or a serializable receipt. */
export interface AIAgentDefinitionSelectionOwner {
  readonly [selectionOwnerBrand]: true;
}

interface SelectionOwnerState {
  readonly pending: Map<`resource://${string}`, object>;
  readonly receiptAuthority: Pick<ResourceAuthoringTransactionPort, 'loadReceipt'>;
  generation: number;
}

export interface CreateAIAgentDefinitionSelectionOwnerInput {
  readonly receiptAuthority: Pick<ResourceAuthoringTransactionPort, 'loadReceipt'>;
}

const selectionOwnerStates = new WeakMap<AIAgentDefinitionSelectionOwner, SelectionOwnerState>();
// This association prevents removing/changing the explicit owner on the same observation.
// Pending state lives with the stable owner, never with this per-observation guard.
const registryOwners = new WeakMap<EffectiveResourceRegistry, {
  readonly owner: AIAgentDefinitionSelectionOwner;
  readonly generation: number;
}>();

export function createAIAgentDefinitionSelectionOwner(
  input: CreateAIAgentDefinitionSelectionOwnerInput,
): AIAgentDefinitionSelectionOwner {
  const owner = Object.freeze({}) as AIAgentDefinitionSelectionOwner;
  selectionOwnerStates.set(owner, { pending: new Map(), generation: 0, receiptAuthority: input.receiptAuthority });
  return owner;
}

function ownerMatches(
  authority: CandidateSetAuthority,
  owner: AIAgentDefinitionSelectionOwner | undefined,
): boolean {
  return authority.selectionOwner === owner
    && registryOwners.get(authority.registry)?.owner === owner
    && (owner === undefined || selectionOwnerStates.has(owner));
}

function isSuperseded(authority: CandidateSetAuthority): boolean {
  if (!authority.selectionOwner) return false;
  const generation = selectionOwnerStates.get(authority.selectionOwner)!.generation;
  return authority.generation !== generation
    || registryOwners.get(authority.registry)?.generation !== generation;
}

function pendingFor(authority: CandidateSetAuthority): SelectionOwnerState['pending'] | undefined {
  return authority.selectionOwner === undefined
    ? undefined : selectionOwnerStates.get(authority.selectionOwner)?.pending;
}

export function normalizeAIAgentTaskRequirement(
  value: AIAgentTaskRequirement,
): AIAgentTaskRequirementProjection {
  const input = closedRecord(value, 'requirement');
  exactKeys(input, [
    'schemaVersion',
    'requirementId',
    'objective',
    'inputSchemaRef',
    'outputSchemaRef',
    'requiredToolRefs',
    'requiredEffectPolicyRef',
    'requiredToolMode',
    'requiredMaterialPortRefs',
    'requiredContextPipelineRef',
    'requiredMessageSourceRefs',
  ], 'requirement');
  if (input.schemaVersion !== AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION) {
    invalidRequirement('requirement.schemaVersion is invalid.');
  }
  const requirementId = nonEmptyString(input.requirementId, 'requirement.requirementId');
  const objective = stringValue(input.objective, 'requirement.objective');
  const requiredToolMode = optionalString(input.requiredToolMode, 'requirement.requiredToolMode');
  if (requiredToolMode !== undefined && requiredToolMode !== 'declared-only' && requiredToolMode !== 'none') {
    invalidRequirement('requirement.requiredToolMode is invalid.');
  }
  const requirement = Object.freeze({
    schemaVersion: AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION,
    requirementId,
    objective,
    ...optionalRef('inputSchemaRef', input.inputSchemaRef, 'requirement.inputSchemaRef'),
    ...optionalRef('outputSchemaRef', input.outputSchemaRef, 'requirement.outputSchemaRef'),
    requiredToolRefs: exactRefSet(input.requiredToolRefs, 'requirement.requiredToolRefs'),
    ...optionalRef('requiredEffectPolicyRef', input.requiredEffectPolicyRef, 'requirement.requiredEffectPolicyRef'),
    ...(requiredToolMode === undefined ? {} : { requiredToolMode }),
    requiredMaterialPortRefs: exactRefSet(input.requiredMaterialPortRefs, 'requirement.requiredMaterialPortRefs'),
    ...optionalRef('requiredContextPipelineRef', input.requiredContextPipelineRef, 'requirement.requiredContextPipelineRef'),
    requiredMessageSourceRefs: exactRefSet(input.requiredMessageSourceRefs, 'requirement.requiredMessageSourceRefs'),
  }) satisfies AIAgentTaskRequirement;
  const projection = Object.freeze({
    schemaVersion: AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION,
    requirement,
    requirementDigest: digest({
      schemaVersion: AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION,
      requirement,
    }),
  }) satisfies AIAgentTaskRequirementProjection;
  authenticRequirements.add(projection);
  return projection;
}

export function projectAIAgentDefinitionCandidates(
  input: ProjectAIAgentDefinitionCandidatesInput,
): AIAgentDefinitionCandidateSet {
  assertProjectionAuthority(input);
  const ownerState = input.selectionOwner === undefined ? undefined : selectionOwnerStates.get(input.selectionOwner);
  const registeredOwner = registryOwners.get(input.registry);
  if ((input.selectionOwner !== undefined && !ownerState)
    || (registeredOwner && registeredOwner.owner !== input.selectionOwner)) {
    throw new AIAgentDefinitionSelectionError(
      'AI_AGENT_SELECTION_OWNER_MISMATCH',
      'Candidate projection requires the authentic selection owner already bound to this registry observation.',
    );
  }
  if (input.selectionOwner && !registeredOwner) {
    registryOwners.set(input.registry, { owner: input.selectionOwner, generation: ownerState!.generation });
  }
  const contentIdentities = resolveEffectiveResourceContentIdentities({
    registry: input.registry,
    layers: input.layers,
  });
  const registryRevision = asDigest(deriveResourceAuthoringRegistryRevision({
    registry: input.registry,
    layers: input.layers,
  }), 'registry revision');
  const candidates = (input.executionResources?.projection ?? input.projection).agentDefinitions
    .map((agent): AIAgentDefinitionCandidate => {
      const identity = contentIdentities.get(agent.resource.resourceId);
      if (!identity) {
        throw new AIAgentDefinitionSelectionError(
          'AI_AGENT_CANDIDATE_CONTENT_IDENTITY_MISSING',
          `AIAgentDefinition '${agent.resource.resourceId}' has no effective content identity.`,
        );
      }
      const contract = Object.freeze({
        ...(agent.inputSchema === undefined ? {} : { inputSchemaRef: agent.inputSchema.ref }),
        ...(agent.outputSchema === undefined ? {} : { outputSchemaRef: agent.outputSchema.ref }),
        toolRefs: sortedUnique(agent.tools.map(({ ref }) => ref)),
        ...(agent.effectPolicy === undefined ? {} : {
          effectPolicyRef: agent.effectPolicy.ref,
          effectToolMode: agent.effectPolicy.toolMode,
        }),
        materialPortRefs: sortedUnique(agent.materialPorts.map(({ ref }) => ref)),
        ...(agent.contextPipeline === undefined ? {} : { contextPipelineRef: agent.contextPipeline.ref }),
        messageSourceRefs: sortedUnique(agent.messagePrefix
          .filter((item) => item.type === 'message-source')
          .map(({ source }) => source.ref)),
      }) satisfies AIAgentDefinitionCandidateContract;
      const unsigned = Object.freeze({
        schemaVersion: AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION,
        agentDefinitionRef: resourceRef(agent.resource.resourceId),
        contentDigest: identity.contentDigest,
        registryRevision,
        contract,
      });
      return Object.freeze({
        ...unsigned,
        candidateDigest: digest(unsigned),
      });
    })
    .sort((left, right) => compareCodeUnits(left.agentDefinitionRef, right.agentDefinitionRef));
  const candidateSet = Object.freeze({
    schemaVersion: AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION,
    registryRevision,
    candidates: Object.freeze(candidates),
    candidateSetDigest: candidateSetDigest(registryRevision, candidates),
  }) satisfies AIAgentDefinitionCandidateSet;
  candidateSetAuthorities.set(candidateSet, Object.freeze({
    executionResources: input.executionResources,
    selectionOwner: input.selectionOwner,
    generation: registryOwners.get(input.registry)?.generation ?? 0,
    registry: input.registry,
    projection: input.projection,
    layers: input.layers,
  }));
  return candidateSet;
}

export async function reconcileAuthoredAIAgentDefinition(
  input: ReconcileAuthoredAIAgentDefinitionInput,
): Promise<AIAgentDefinitionCandidateSet> {
  const authoringAuthority = authoringAdmissionAuthorities.get(input.authoringAdmission as object);
  const authority = candidateSetAuthorities.get(input.candidateSet);
  if (!authority || !input.selectionOwner || !ownerMatches(authority, input.selectionOwner)
    || authoringAuthority?.candidateSetAuthority.selectionOwner !== input.selectionOwner) {
    throw new AIAgentDefinitionSelectionError(
      'AI_AGENT_SELECTION_OWNER_MISMATCH',
      'Authoring reconciliation requires the same explicit owner as its pending admission and current observation.',
    );
  }
  const ownerState = selectionOwnerStates.get(input.selectionOwner)!;
  if (input.receiptAuthority !== ownerState.receiptAuthority) {
    throw new AIAgentDefinitionSelectionError(
      'AI_AGENT_SELECTION_OWNER_MISMATCH',
      'Authoring reconciliation requires the receipt authority explicitly bound to this selection owner.',
    );
  }
  if (isSuperseded(authority)) {
    throw new AIAgentDefinitionSelectionError(
      'AI_AGENT_AUTHORING_RECEIPT_STALE',
      'Authoring reconciliation cannot restore a superseded registry observation.',
    );
  }
  if (!authority
    || authority.registry !== input.registry
    || authority.projection !== input.projection
    || authority.executionResources !== input.executionResources
    || authority.layers !== input.layers
    || !authoringAuthority
    || candidateSetAuthorities.get(authoringAuthority.candidateSet)
      !== authoringAuthority.candidateSetAuthority
    || authoringAuthority.requirement.requirementDigest
      !== input.authoringAdmission.requirementDigest
    || ownerState.pending.get(input.authoringAdmission.agentDefinitionRef)
      !== input.authoringAdmission
    || authoringAuthority.proposalDigest !== digest(input.authoringAdmission.proposal)) {
    throw new AIAgentDefinitionSelectionError(
      'AI_AGENT_CANDIDATE_PROJECTION_UNTRUSTED',
      'Authoring reconciliation requires the exact pending admission and candidate projection for this registry observation.',
    );
  }
  validateReceiptShapeAndDigest(input.receipt);
  const durableReceipt = await input.receiptAuthority.loadReceipt(input.receipt.planDigest).catch(() => undefined);
  if (!durableReceipt || canonicalJson(durableReceipt) !== canonicalJson(input.receipt)) {
    throw new AIAgentDefinitionSelectionError(
      'AI_AGENT_AUTHORING_RECEIPT_INVALID',
      'The supplied receipt is not the immutable receipt loaded from the Halfcode transaction authority.',
    );
  }
  validateReceiptShapeAndDigest(durableReceipt);
  if (isSuperseded(authority)
    || ownerState.pending.get(input.authoringAdmission.agentDefinitionRef) !== input.authoringAdmission) {
    throw new AIAgentDefinitionSelectionError(
      'AI_AGENT_AUTHORING_RECEIPT_STALE',
      'The pending admission or registry observation was superseded while loading the durable receipt.',
    );
  }
  const proposal = input.authoringAdmission.proposal;
  const currentRevision = asDigest(deriveResourceAuthoringRegistryRevision({
    registry: input.registry,
    layers: input.layers,
  }), 'current registry revision');
  if (input.receipt.registryRevisionAfter !== currentRevision
    || input.candidateSet.registryRevision !== currentRevision) {
    throw new AIAgentDefinitionSelectionError(
      'AI_AGENT_AUTHORING_RECEIPT_STALE',
      'The authoring receipt does not describe the current effective registry revision.',
    );
  }
  const entry = input.registry.byId.get(input.receipt.resourceId);
  const resource = entry?.resource;
  const identities = resolveEffectiveResourceContentIdentities({
    registry: input.registry,
    layers: input.layers,
  });
  const identity = identities.get(input.receipt.resourceId);
  const effectiveOrigin = entry?.effectiveOrigin;
  const authorityResourceIds = [...input.registry.byId.values()]
    .filter((value) => value.resource && sameOrigin(value.effectiveOrigin, effectiveOrigin))
    .map(({ resourceId }) => resourceId)
    .sort(compareCodeUnits);
  const candidate = input.candidateSet.candidates.find(({ agentDefinitionRef }) =>
    agentDefinitionRef === resourceRef(input.receipt.resourceId));
  if (!resource
    || resource.kind !== 'AIAgentDefinition'
    || input.authoringAdmission.agentDefinitionRef !== resourceRef(input.receipt.resourceId)
    || input.receipt.operation !== proposal.operation
    || input.receipt.catalogId !== proposal.catalogId
    || input.receipt.resourceId !== proposal.resourceId
    || input.receipt.kind !== proposal.kind
    || input.receipt.envelopeVersion !== proposal.envelopeVersion
    || input.receipt.writerSpecVersion !== proposal.writerSpecVersion
    || input.receipt.sourceShape !== proposal.sourceShape
    || input.receipt.documentUri !== proposal.documentUri
    || input.receipt.authorityDigestBefore !== (authoringAuthority.before?.authorityDigest ?? null)
    || input.receipt.authorityDigestAfter !== sha256Digest(proposal.authorityText)
    || input.receipt.registryRevisionBefore !== proposal.expected.registryRevision
    || input.receipt.kind !== 'AIAgentDefinition'
    || resource.metadata.envelopeVersion !== input.receipt.envelopeVersion
    || resource.metadata.specVersion !== input.receipt.writerSpecVersion
    || resource.sourceShape !== input.receipt.sourceShape
    || resource.documentUri !== input.receipt.documentUri
    || !identity
    || identity.authorityDigest !== input.receipt.authorityDigestAfter
    || identity.contentDigest !== input.receipt.contentDigest
    || !effectiveOrigin
    || !sameReceiptOrigin(effectiveOrigin, input.receipt.effectiveOrigin)
    || (authoringAuthority.before !== undefined
      && canonicalJson(authorityResourceIds) !== canonicalJson(authoringAuthority.before.authorityResourceIds))
    || canonicalJson(authorityResourceIds) !== canonicalJson([...input.receipt.authorityResourceIds].sort(compareCodeUnits))
    || !candidate
    || candidate.contentDigest !== input.receipt.contentDigest) {
    throw new AIAgentDefinitionSelectionError(
      'AI_AGENT_AUTHORING_RECEIPT_RESOURCE_MISMATCH',
      'The authoring receipt does not exactly match the current AIAgentDefinition content, origin, authority unit, and candidate.',
    );
  }
  const evidence = Object.freeze({
    schemaVersion: 'ai-workflow.agent-definition-authoring-evidence/v1' as const,
    planDigest: asDigest(input.receipt.planDigest, 'receipt plan digest'),
    transactionId: input.receipt.transactionId,
    receiptDigest: asDigest(input.receipt.receiptDigest, 'receipt digest'),
    ...(input.authoringAdmission.status === 'revision-request' ? {
      revision: Object.freeze({
        candidateRef: input.authoringAdmission.candidate.agentDefinitionRef,
        candidateDigest: input.authoringAdmission.candidate.candidateDigest,
        contentDigest: input.authoringAdmission.candidate.contentDigest,
        registryRevision: input.authoringAdmission.candidate.registryRevision,
        feedback: input.authoringAdmission.feedback,
      }),
    } : {}),
  }) satisfies AIAgentDefinitionAuthoringEvidence;
  const candidates = Object.freeze(input.candidateSet.candidates.map((value) => {
    if (value !== candidate) return value;
    const unsigned = Object.freeze({
      schemaVersion: value.schemaVersion,
      agentDefinitionRef: value.agentDefinitionRef,
      contentDigest: value.contentDigest,
      registryRevision: value.registryRevision,
      contract: value.contract,
      authoringEvidence: evidence,
    });
    return Object.freeze({ ...unsigned, candidateDigest: digest(unsigned) });
  }));
  const reconciled = Object.freeze({
    ...input.candidateSet,
    candidates,
    candidateSetDigest: candidateSetDigest(input.candidateSet.registryRevision, candidates),
  }) satisfies AIAgentDefinitionCandidateSet;
  if (authoringAuthority.before) ownerState.generation += 1;
  registryOwners.set(input.registry, { owner: input.selectionOwner, generation: ownerState.generation });
  candidateSetAuthorities.set(reconciled, Object.freeze({ ...authority, generation: ownerState.generation }));
  ownerState.pending.delete(input.authoringAdmission.agentDefinitionRef);
  return reconciled;
}

export function admitAIAgentDefinitionSelection(
  input: AdmitAIAgentDefinitionSelectionInput,
): AIAgentDefinitionSelectionAdmission {
  if (!isValidDecision(input.decision)) {
    return rejection('decision-invalid', 'The selection decision is not one closed, canonical decision value.');
  }
  if (!authenticRequirements.has(input.requirement as object)
    || input.decision.requirementDigest !== input.requirement.requirementDigest) {
    return rejection('requirement-stale', 'The decision is not bound to the current normalized task requirement.');
  }
  const candidateSetAuthority = candidateSetAuthorities.get(input.candidateSet);
  if (candidateSetAuthority && !ownerMatches(candidateSetAuthority, input.selectionOwner)) {
    return rejection('selection-owner-mismatch', 'Selection requires the same explicit owner as its candidate observation.');
  }
  if (!candidateSetAuthority
    || isSuperseded(candidateSetAuthority)
    || input.decision.candidateSetDigest !== input.candidateSet.candidateSetDigest) {
    return rejection('candidate-set-stale', 'The decision is not bound to the current authentic candidate set.');
  }
  if (input.decision.mode === 'select-existing') {
    const decision = input.decision;
    const candidate = input.candidateSet.candidates.find(({ agentDefinitionRef }) =>
      agentDefinitionRef === decision.candidateRef);
    if (!candidate) return rejection('candidate-missing', 'The selected candidate is absent from the current set.');
    if (pendingFor(candidateSetAuthority)?.has(candidate.agentDefinitionRef)) {
      return rejection(
        'authoring-in-progress',
        'An in-flight authoring transition must reconcile its durable Halfcode receipt before this definition is selectable.',
      );
    }
    if (candidate.candidateDigest !== decision.candidateDigest) {
      return rejection('candidate-digest-mismatch', 'The selected candidate digest is stale or forged.');
    }
    if (!isCompatible(input.requirement.requirement, candidate.contract)) {
      return rejection('candidate-incompatible', 'The selected candidate does not satisfy the typed task requirement.');
    }
    const admission = Object.freeze({
      schemaVersion: AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION,
      status: 'selected' as const,
      requirementDigest: input.requirement.requirementDigest,
      candidateSetDigest: input.candidateSet.candidateSetDigest,
      candidate,
      reason: stringValue(decision.reason, 'decision.reason'),
    }) satisfies SelectedAIAgentDefinitionAdmission;
    selectedAdmissionAuthorities.set(admission, candidateSetAuthority);
    return admission;
  }
  if (!input.selectionOwner) {
    return rejection('selection-owner-required', 'Authoring requires an explicit stable selection owner shared across registry refreshes.');
  }
  const pending = pendingFor(candidateSetAuthority)!;
  if (input.decision.mode === 'revise-existing') {
    const decision = input.decision;
    const candidate = input.candidateSet.candidates.find(({ agentDefinitionRef }) => agentDefinitionRef === decision.candidateRef);
    if (!candidate) return rejection('candidate-missing', 'The revision candidate is absent from the current set.');
    if (candidate.candidateDigest !== decision.candidateDigest) {
      return rejection('candidate-digest-mismatch', 'The revision candidate digest is stale or forged.');
    }
    if (!matchesRevisionFeedback(input, decision, candidate)) {
      return rejection('revision-feedback-invalid', 'Revision feedback must match the exact candidate, requirement, observation and authentic prior execution.');
    }
    const before = revisionAuthority(candidateSetAuthority, candidate);
    if (!before || !isValidAuthoringProposal(decision.proposal, decision.candidateRef, input.candidateSet, before.authorityDigest)
      || decision.proposal.documentUri !== before.effectiveOrigin.documentUri) {
      return rejection('authoring-proposal-invalid', 'Revision requires an exact native update/present proposal against the effective authority digest and document.');
    }
    if (pending.has(candidate.agentDefinitionRef)) {
      return rejection('authoring-in-progress', 'An authoring request for this exact Agent definition is already in flight.');
    }
    const proposal = cloneAuthoringProposal(decision.proposal);
    const admission = Object.freeze({
      schemaVersion: AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION,
      status: 'revision-request' as const,
      requirementDigest: input.requirement.requirementDigest,
      candidateSetDigest: input.candidateSet.candidateSetDigest,
      agentDefinitionRef: candidate.agentDefinitionRef,
      candidate,
      feedback: Object.freeze({ ...decision.feedback }),
      proposal,
      reason: decision.reason,
    }) satisfies ReviseExistingAIAgentDefinitionAdmission;
    authoringAdmissionAuthorities.set(admission, Object.freeze({
      candidateSetAuthority, candidateSet: input.candidateSet, requirement: input.requirement,
      proposalDigest: digest(proposal), before,
    }));
    pending.set(candidate.agentDefinitionRef, admission);
    return admission;
  }
  if (!isValidAuthoringProposal(input.decision.proposal, input.decision.agentDefinitionRef, input.candidateSet)) {
    return rejection('authoring-proposal-invalid', 'The author-new decision is not one exact Halfcode create proposal for the current registry.');
  }
  const proposal = cloneAuthoringProposal(input.decision.proposal);
  const admission = Object.freeze({
    schemaVersion: AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION,
    status: 'authoring-request' as const,
    requirementDigest: input.requirement.requirementDigest,
    candidateSetDigest: input.candidateSet.candidateSetDigest,
    agentDefinitionRef: input.decision.agentDefinitionRef,
    proposal,
    reason: stringValue(input.decision.reason, 'decision.reason'),
  }) satisfies AuthorNewAIAgentDefinitionAdmission;
  if (pending.has(admission.agentDefinitionRef)) {
    return rejection('authoring-in-progress', 'An authoring request for this exact Agent definition is already in flight.');
  }
  authoringAdmissionAuthorities.set(admission, Object.freeze({
    candidateSetAuthority,
    candidateSet: input.candidateSet,
    requirement: input.requirement,
    proposalDigest: digest(proposal),
  }));
  pending.set(admission.agentDefinitionRef, admission);
  return admission;
}

export function freezeSelectedAIAgentTaskBinding(
  input: FreezeSelectedAIAgentTaskBindingInput,
): FrozenAIAgentTaskBinding {
  const authority = selectedAdmissionAuthorities.get(input.admission as object);
  if (!authority
    || !ownerMatches(authority, input.selectionOwner)
    || isSuperseded(authority)
    || pendingFor(authority)?.has(input.admission.candidate.agentDefinitionRef)
    || authority.registry !== input.registry
    || authority.projection !== input.projection
    || authority.executionResources !== input.executionResources
    || input.contentIdentities.get(resourceId(input.admission.candidate.agentDefinitionRef))?.contentDigest
      !== input.admission.candidate.contentDigest) {
    throw new AIAgentDefinitionSelectionError(
      'AI_AGENT_SELECTION_ADMISSION_UNTRUSTED',
      'Selected task freeze requires the exact admission produced by typed selection.',
    );
  }
  return projectFrozenAIAgentTaskBinding(freezeAIWorkflowRunResources({
    executionResources: input.executionResources,
    codeExecutions: input.codeExecutions,
    registry: input.registry,
    projection: input.projection,
    task: {
      workflowKind: input.workflowKind,
      workflowRef: input.workflowRef,
      nodeId: nonEmptyString(input.nodeId, 'task.nodeId'),
      agentDefinitionRef: input.admission.candidate.agentDefinitionRef,
    },
    contentIdentities: input.contentIdentities,
  }));
}

function isValidDecision(value: AIAgentDefinitionSelectionDecision): boolean {
  try {
    const decision = closedRecord(value, 'decision');
    if (decision.schemaVersion !== AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION
      || !isDigest(decision.requirementDigest)
      || !isDigest(decision.candidateSetDigest)) return false;
    stringValue(decision.reason, 'decision.reason');
    if (decision.mode === 'select-existing') {
      exactKeys(decision, [
        'schemaVersion',
        'mode',
        'requirementDigest',
        'candidateSetDigest',
        'candidateRef',
        'candidateDigest',
        'reason',
      ], 'decision');
      exactRef(decision.candidateRef, 'decision.candidateRef');
      return isDigest(decision.candidateDigest);
    }
    if (decision.mode === 'author-new') {
      exactKeys(decision, [
        'schemaVersion',
        'mode',
        'requirementDigest',
        'candidateSetDigest',
        'agentDefinitionRef',
        'proposal',
        'reason',
      ], 'decision');
      exactRef(decision.agentDefinitionRef, 'decision.agentDefinitionRef');
      return true;
    }
    if (decision.mode === 'revise-existing') {
      exactKeys(decision, ['schemaVersion', 'mode', 'requirementDigest', 'candidateSetDigest',
        'candidateRef', 'candidateDigest', 'feedback', 'proposal', 'reason'], 'decision');
      exactRef(decision.candidateRef, 'decision.candidateRef');
      const feedback = closedRecord(decision.feedback, 'decision.feedback');
      exactKeys(feedback, ['observationRef', 'attemptRef', 'verificationRef', 'requirementDigest',
        'candidateSetDigest', 'candidateDigest', 'previousExecutionFingerprint'], 'decision.feedback');
      for (const key of ['observationRef', 'attemptRef', 'verificationRef'] as const) {
        nonEmptyString(feedback[key], `decision.feedback.${key}`);
      }
      return isDigest(decision.candidateDigest)
        && ['requirementDigest', 'candidateSetDigest', 'candidateDigest', 'previousExecutionFingerprint']
          .every((key) => isDigest(feedback[key]));
    }
    return false;
  } catch {
    return false;
  }
}

function assertProjectionAuthority(input: ProjectAIAgentDefinitionCandidatesInput): void {
  if (input.executionResources) assertAIAgentExecutionResources(input.executionResources, input.registry, input.layers);
  if (sourceRegistryForAIWorkflowAgentResourceProjection(input.projection) !== input.registry) {
    throw new AIAgentDefinitionSelectionError(
      'AI_AGENT_CANDIDATE_PROJECTION_UNTRUSTED',
      'Candidate projection requires the exact immutable Agent resource projection produced for this registry.',
    );
  }
}

function isCompatible(
  requirement: AIAgentTaskRequirement,
  candidate: AIAgentDefinitionCandidateContract,
): boolean {
  return optionalExact(requirement.inputSchemaRef, candidate.inputSchemaRef)
    && optionalExact(requirement.outputSchemaRef, candidate.outputSchemaRef)
    && containsAll(candidate.toolRefs, requirement.requiredToolRefs)
    && optionalExact(requirement.requiredEffectPolicyRef, candidate.effectPolicyRef)
    && optionalExact(requirement.requiredToolMode, candidate.effectToolMode)
    && containsAll(candidate.materialPortRefs, requirement.requiredMaterialPortRefs)
    && optionalExact(requirement.requiredContextPipelineRef, candidate.contextPipelineRef)
    && containsAll(candidate.messageSourceRefs, requirement.requiredMessageSourceRefs);
}

function matchesRevisionFeedback(
  input: AdmitAIAgentDefinitionSelectionInput,
  decision: ReviseExistingAIAgentDefinitionDecision,
  candidate: AIAgentDefinitionCandidate,
): boolean {
  try {
    const execution = input.previousExecution;
    return execution !== undefined
      && frozenAIAgentTaskAgentContentDigest(execution) === candidate.contentDigest
      && execution.task.agentDefinitionRef === candidate.agentDefinitionRef
      && execution.semanticFingerprint === decision.feedback.previousExecutionFingerprint
      && decision.feedback.requirementDigest === input.requirement.requirementDigest
      && decision.feedback.candidateSetDigest === input.candidateSet.candidateSetDigest
      && decision.feedback.candidateDigest === candidate.candidateDigest;
  } catch {
    return false;
  }
}

function revisionAuthority(
  authority: CandidateSetAuthority,
  candidate: AIAgentDefinitionCandidate,
): AuthoringAdmissionAuthority['before'] {
  const id = resourceId(candidate.agentDefinitionRef);
  const entry = authority.registry.byId.get(id);
  const identity = resolveEffectiveResourceContentIdentities(authority).get(id);
  if (!entry?.resource || entry.resource.kind !== 'AIAgentDefinition'
    || entry.resource.sourceShape !== 'single-file' || !entry.effectiveOrigin
    || !identity || identity.contentDigest !== candidate.contentDigest) return undefined;
  return Object.freeze({
    authorityDigest: asDigest(identity.authorityDigest, 'previous authority digest'),
    effectiveOrigin: Object.freeze({ ...entry.effectiveOrigin }),
    authorityResourceIds: Object.freeze([...authority.registry.byId.values()]
      .filter((value) => value.resource && sameOrigin(value.effectiveOrigin, entry.effectiveOrigin))
      .map(({ resourceId }) => resourceId).sort(compareCodeUnits)),
  });
}

function isValidAuthoringProposal(
  value: ResourceAuthoringProposal,
  definitionRef: `resource://${string}`,
  candidateSet: AIAgentDefinitionCandidateSet,
  authorityDigestBefore?: Sha256Digest,
): boolean {
  try {
    const proposal = closedRecord(value, 'proposal');
    exactKeys(proposal, [
      'schemaVersion',
      'operation',
      'catalogId',
      'resourceId',
      'kind',
      'envelopeVersion',
      'writerSpecVersion',
      'sourceShape',
      'documentUri',
      'authorityText',
      'expected',
    ], 'proposal');
    const expected = closedRecord(proposal.expected, 'proposal.expected');
    exactKeys(expected, authorityDigestBefore === undefined
      ? ['state', 'registryRevision'] : ['state', 'registryRevision', 'authorityDigest'], 'proposal.expected');
    return proposal.schemaVersion === RESOURCE_AUTHORING_SCHEMA_VERSION
      && proposal.operation === (authorityDigestBefore === undefined ? 'create' : 'update')
      && proposal.kind === 'AIAgentDefinition'
      && proposal.sourceShape === 'single-file'
      && expected.state === (authorityDigestBefore === undefined ? 'absent' : 'present')
      && (authorityDigestBefore === undefined || (expected.authorityDigest === authorityDigestBefore
        && sha256Digest(stringValue(proposal.authorityText, 'proposal.authorityText')) !== authorityDigestBefore))
      && expected.registryRevision === candidateSet.registryRevision
      && definitionRef === resourceRef(nonEmptyString(proposal.resourceId, 'proposal.resourceId'))
      && (authorityDigestBefore !== undefined
        || !candidateSet.candidates.some(({ agentDefinitionRef }) => agentDefinitionRef === definitionRef))
      && nonEmptyString(proposal.catalogId, 'proposal.catalogId').length > 0
      && proposal.envelopeVersion === RESOURCE_ENVELOPE_VERSION
      && Number.isSafeInteger(proposal.writerSpecVersion)
      && Number(proposal.writerSpecVersion) > 0
      && /^vfs:\/\/@\/.+\.xnl$/u.test(nonEmptyString(proposal.documentUri, 'proposal.documentUri'))
      && stringValue(proposal.authorityText, 'proposal.authorityText').length > 0;
  } catch {
    return false;
  }
}

function cloneAuthoringProposal(value: ResourceAuthoringProposal): ResourceAuthoringProposal {
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    operation: value.operation,
    catalogId: value.catalogId,
    resourceId: value.resourceId,
    kind: value.kind,
    envelopeVersion: value.envelopeVersion,
    writerSpecVersion: value.writerSpecVersion,
    sourceShape: value.sourceShape,
    documentUri: value.documentUri,
    authorityText: value.authorityText,
    expected: Object.freeze({ ...value.expected }),
  });
}

function validateReceiptShapeAndDigest(receiptValue: ResourceAuthoringReceipt): void {
  try {
    const receipt = closedRecord(receiptValue, 'receipt');
    exactKeys(receipt, [
      'schemaVersion',
      'planDigest',
      'transactionId',
      'operation',
      'catalogId',
      'resourceId',
      'kind',
      'envelopeVersion',
      'writerSpecVersion',
      'sourceShape',
      'documentUri',
      'authorityDigestBefore',
      'authorityDigestAfter',
      'registryRevisionBefore',
      'registryRevisionAfter',
      'contentDigest',
      'effectiveOrigin',
      'authorityResourceIds',
      'receiptDigest',
    ], 'receipt');
    const origin = closedRecord(receipt.effectiveOrigin, 'receipt.effectiveOrigin');
    exactKeys(origin, ['layerId', 'layerIndex', 'packageId', 'documentUri', 'logicalPath'], 'receipt.effectiveOrigin');
    if (receipt.schemaVersion !== RESOURCE_AUTHORING_SCHEMA_VERSION
      || (receipt.operation !== 'create' && receipt.operation !== 'update')
      || receipt.sourceShape !== 'single-file'
      || receipt.envelopeVersion !== RESOURCE_ENVELOPE_VERSION
      || !Number.isSafeInteger(receipt.writerSpecVersion)
      || Number(receipt.writerSpecVersion) <= 0
      || (receipt.authorityDigestBefore !== null && !isDigest(receipt.authorityDigestBefore))
      || !isDigest(receipt.planDigest)
      || !isDigest(receipt.authorityDigestAfter)
      || !isDigest(receipt.registryRevisionBefore)
      || !isDigest(receipt.registryRevisionAfter)
      || !isDigest(receipt.contentDigest)
      || !isDigest(receipt.receiptDigest)
      || !Array.isArray(receipt.authorityResourceIds)
      || receipt.authorityResourceIds.some((value) => typeof value !== 'string' || value.length === 0)
      || new Set(receipt.authorityResourceIds).size !== receipt.authorityResourceIds.length
      || canonicalJson(receipt.authorityResourceIds) !== canonicalJson([...receipt.authorityResourceIds].sort(compareCodeUnits))
      || !Number.isSafeInteger(origin.layerIndex)
      || (origin.logicalPath !== undefined && typeof origin.logicalPath !== 'string')) {
      throw new Error('invalid receipt fields');
    }
    for (const field of ['transactionId', 'catalogId', 'resourceId', 'kind', 'envelopeVersion', 'documentUri'] as const) {
      nonEmptyString(receipt[field], `receipt.${field}`);
    }
    for (const field of ['layerId', 'packageId', 'documentUri'] as const) {
      nonEmptyString(origin[field], `receipt.effectiveOrigin.${field}`);
    }
    const { receiptDigest, ...unsigned } = receipt;
    if (receiptDigest !== digest(unsigned)) throw new Error('receipt digest mismatch');
  } catch (cause) {
    if (cause instanceof AIAgentDefinitionSelectionError) throw cause;
    throw new AIAgentDefinitionSelectionError(
      'AI_AGENT_AUTHORING_RECEIPT_INVALID',
      'The Halfcode authoring receipt is malformed or its content digest is forged.',
    );
  }
}

function candidateSetDigest(
  registryRevision: Sha256Digest,
  candidates: readonly AIAgentDefinitionCandidate[],
): Sha256Digest {
  return digest({
    schemaVersion: AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION,
    registryRevision,
    candidates: candidates.map(({ agentDefinitionRef, candidateDigest }) => ({
      agentDefinitionRef,
      candidateDigest,
    })),
  });
}

function rejection(
  code: Extract<AIAgentDefinitionSelectionAdmission, { status: 'rejected' }>['code'],
  message: string,
): AIAgentDefinitionSelectionAdmission {
  return Object.freeze({
    schemaVersion: AI_AGENT_DEFINITION_SELECTION_SCHEMA_VERSION,
    status: 'rejected' as const,
    code,
    message,
  });
}

function sameOrigin(
  left: ResourceOrigin | undefined,
  right: ResourceOrigin | undefined,
): boolean {
  if (!left || !right) return false;
  return canonicalJson(left) === canonicalJson(right);
}

function sameReceiptOrigin(
  effective: ResourceOrigin,
  receipt: ResourceAuthoringReceipt['effectiveOrigin'],
): boolean {
  return canonicalJson(effective) === canonicalJson(receipt);
}

function containsAll(haystack: readonly string[], needles: readonly string[]): boolean {
  const available = new Set(haystack);
  return needles.every((value) => available.has(value));
}

function optionalExact<T>(required: T | undefined, actual: T | undefined): boolean {
  return required === undefined || required === actual;
}

function optionalRef<K extends string>(
  key: K,
  value: unknown,
  location: string,
): { readonly [P in K]?: `resource://${string}` } {
  return value === undefined ? {} : { [key]: exactRef(value, location) } as { readonly [P in K]: `resource://${string}` };
}

function exactRefSet(value: unknown, location: string): readonly `resource://${string}`[] {
  if (!Array.isArray(value)) invalidRequirement(`${location} must be an array.`);
  return sortedUnique(value.map((item, index) => exactRef(item, `${location}[${index}]`)));
}

function exactRef(value: unknown, location: string): `resource://${string}` {
  const text = nonEmptyString(value, location);
  if (!/^resource:\/\/[^\s/][^\s]*$/u.test(text)) invalidRequirement(`${location} must be one exact resource:// reference.`);
  return text as `resource://${string}`;
}

function resourceRef(resourceId: string): `resource://${string}` {
  return `resource://${resourceId}`;
}

function resourceId(ref: `resource://${string}`): string {
  return ref.slice('resource://'.length);
}

function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort(compareCodeUnits));
}

function closedRecord(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${location} must be closed own-data.`);
  }
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new Error(`${location}.${key} must be a data property.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], location: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new Error(`${location}.${extra.sort(compareCodeUnits)[0]} is unsupported.`);
}

function stringValue(value: unknown, location: string): string {
  if (typeof value !== 'string') throw new Error(`${location} must be a string.`);
  return value;
}

function optionalString(value: unknown, location: string): string | undefined {
  return value === undefined ? undefined : stringValue(value, location);
}

function nonEmptyString(value: unknown, location: string): string {
  const text = stringValue(value, location);
  if (text.length === 0 || text.trim() !== text) throw new Error(`${location} must be a canonical non-empty string.`);
  return text;
}

function invalidRequirement(message: string): never {
  throw new AIAgentDefinitionSelectionError('AI_AGENT_REQUIREMENT_INVALID', message);
}

function asDigest(value: string, location: string): Sha256Digest {
  if (!isDigest(value)) throw new Error(`${location} is not a sha256 digest.`);
  return value;
}

function isDigest(value: unknown): value is Sha256Digest {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function digest(value: unknown): Sha256Digest {
  return sha256Digest(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON cannot encode non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = closedRecord(value, 'canonical value');
  return `{${Object.keys(record).sort(compareCodeUnits).map((key) => {
    const item = record[key];
    if (item === undefined) throw new Error('Canonical JSON cannot encode undefined.');
    return `${JSON.stringify(key)}:${canonicalJson(item)}`;
  }).join(',')}}`;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
