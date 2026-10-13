import type {
  AIWorkflowFlowRunCheckpoint,
  FlowClosedObject,
  FlowClosedValue,
  FlowDefinitionArtifactIdentity,
  FlowRunProfileState,
  FlowRunStepExtensions,
} from 'ai-workflow-contract';
import type { DefinitionStepExtensionCodecRegistryPort } from 'flow-step-space-contract';
import { normalizeFlowClosedValue } from './run-checkpoint.js';
import { FlowRunCheckpointTransitionError } from './errors.js';

export interface FrozenRunStepExtensionDefinition {
  readonly schemaRef?: string;
  readonly initialValue: FlowClosedValue;
}

export interface FrozenFlowRunProfileAuthority {
  readonly profileKind: FlowRunProfileState['kind'];
  readonly definitionStepIds: readonly string[];
  readonly definitionInvocationOwners?: Readonly<Record<string, string>>;
  readonly binding?: FlowClosedObject;
  readonly extensionsByStepId: Readonly<
    Record<string, Readonly<Record<string, FrozenRunStepExtensionDefinition>>>
  >;
}

export interface FlowRunProfileAuthorityRequest {
  readonly instanceId: string;
  readonly definition: FlowDefinitionArtifactIdentity;
  readonly profileKind: FlowRunProfileState['kind'];
}

/** Runtime-only adapter over a materialized frozen instance definition. */
export interface FlowRunProfileAuthorityPort {
  load(request: FlowRunProfileAuthorityRequest): FrozenFlowRunProfileAuthority;
}

export interface FlowRunCheckpointAdmissionRuntime {
  readonly profileAuthority?: FlowRunProfileAuthorityPort;
  readonly extensionCodecs: DefinitionStepExtensionCodecRegistryPort;
}

const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const stable = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort(compareCodeUnits).map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
};

export function createInitialRunStepExtensions(
  authority: FrozenFlowRunProfileAuthority,
): FlowRunStepExtensions | undefined {
  const byStepId: Record<string, Record<string, {
    readonly schemaRef?: string;
    readonly revision: number;
    readonly value: FlowClosedValue;
  }>> = {};
  for (const stepId of Object.keys(authority.extensionsByStepId).sort(compareCodeUnits)) {
    const kinds = authority.extensionsByStepId[stepId];
    const facts: Record<string, { readonly schemaRef?: string; readonly revision: number; readonly value: FlowClosedValue }> = {};
    for (const kind of Object.keys(kinds).sort(compareCodeUnits)) {
      const extension = kinds[kind];
      facts[kind] = Object.freeze({
        ...(extension.schemaRef === undefined ? {} : { schemaRef: extension.schemaRef }),
        revision: 0,
        value: normalizeFlowClosedValue(extension.initialValue, `profile.extensions.${stepId}.${kind}`),
      });
    }
    if (Object.keys(facts).length > 0) byStepId[stepId] = Object.freeze(facts);
  }
  return Object.keys(byStepId).length === 0
    ? undefined
    : Object.freeze({
        schemaVersion: 'depa.flow-run-step-extensions/v1' as const,
        byStepId: Object.freeze(byStepId),
      });
}

export function validateCheckpointAgainstFrozenProfile(
  checkpoint: AIWorkflowFlowRunCheckpoint,
  runtime: FlowRunCheckpointAdmissionRuntime,
  options: { readonly requireAIDataAuthority?: boolean } = {},
): FrozenFlowRunProfileAuthority | undefined {
  const authority = runtime.profileAuthority?.load({
    instanceId: checkpoint.instanceId,
    definition: checkpoint.definition,
    profileKind: checkpoint.profile.kind,
  });
  if (!authority) {
    if (checkpoint.stepExtensions !== undefined) {
      throw new FlowRunCheckpointTransitionError('Run step extension facts require frozen profile authority.');
    }
    if (options.requireAIDataAuthority && checkpoint.profile.kind === 'AIDataWorkflow') {
      throw new FlowRunCheckpointTransitionError('AI Data checkpoint admission requires frozen profile authority.');
    }
    return undefined;
  }
  if (authority.profileKind !== checkpoint.profile.kind) {
    throw new FlowRunCheckpointTransitionError('Frozen profile kind differs from the checkpoint profile.');
  }
  const ids = [...authority.definitionStepIds];
  if (ids.some((id) => typeof id !== 'string' || !id || id !== id.trim()) || new Set(ids).size !== ids.length) {
    throw new FlowRunCheckpointTransitionError('Frozen profile step membership is invalid.');
  }
  if (Object.entries(authority.definitionInvocationOwners ?? {}).some(([key, owner]) => !key || !ids.includes(owner)))
    throw new FlowRunCheckpointTransitionError('Frozen compiled action ownership is invalid.');
  for (const stepId of Object.keys(authority.extensionsByStepId)) {
    if (!ids.includes(stepId)) {
      throw new FlowRunCheckpointTransitionError(`Frozen extension step ${stepId} is not a definition member.`);
    }
  }
  if (checkpoint.profile.kind === 'AIDataWorkflow') {
    if (!authority.binding) throw new FlowRunCheckpointTransitionError('Frozen AI Data authority is missing its binding.');
    if (stable(checkpoint.profile.runGraph.binding) !== stable(authority.binding)) {
      throw new FlowRunCheckpointTransitionError('AI Data binding differs from the materialized frozen definition.');
    }
    const binding = authority.binding as Record<string, FlowClosedValue>;
    const definition = binding.definition as Record<string, FlowClosedValue> | undefined;
    if (!definition || stable(definition.declarationOrder) !== stable(ids)) {
      throw new FlowRunCheckpointTransitionError('Frozen AI Data binding and StepSpace membership differ.');
    }
  }
  const initial = createInitialRunStepExtensions(authority);
  if (initial === undefined) {
    if (checkpoint.stepExtensions !== undefined) {
      throw new FlowRunCheckpointTransitionError('Checkpoint contains extensions absent from the frozen definition.');
    }
    return authority;
  }
  const actual = checkpoint.stepExtensions;
  if (!actual) throw new FlowRunCheckpointTransitionError('Checkpoint omits extensions required by the frozen definition.');
  if (stable(Object.keys(actual.byStepId).sort(compareCodeUnits)) !== stable(Object.keys(initial.byStepId).sort(compareCodeUnits))) {
    throw new FlowRunCheckpointTransitionError('Checkpoint extension step membership differs from the frozen definition.');
  }
  for (const stepId of Object.keys(initial.byStepId).sort(compareCodeUnits)) {
    const expectedKinds = Object.keys(initial.byStepId[stepId]).sort(compareCodeUnits);
    const actualKinds = Object.keys(actual.byStepId[stepId] ?? {}).sort(compareCodeUnits);
    if (stable(actualKinds) !== stable(expectedKinds)) {
      throw new FlowRunCheckpointTransitionError(`Checkpoint extension kinds differ for ${stepId}.`);
    }
    for (const kind of expectedKinds) {
      const definition = authority.extensionsByStepId[stepId][kind];
      const fact = actual.byStepId[stepId][kind];
      if (definition.schemaRef !== fact.schemaRef) {
        throw new FlowRunCheckpointTransitionError(`Checkpoint extension schema differs for ${stepId}/${kind}.`);
      }
      const registration = runtime.extensionCodecs.resolve(kind);
      if (!registration?.codec || typeof registration.codec.normalize !== 'function') {
        throw new FlowRunCheckpointTransitionError(`Checkpoint extension ${stepId}/${kind} has no runtime codec.`);
      }
      if (registration.schemaRef !== definition.schemaRef) {
        throw new FlowRunCheckpointTransitionError(`Runtime codec schema differs for ${stepId}/${kind}.`);
      }
      let normalized: FlowClosedValue;
      try {
        normalized = normalizeFlowClosedValue(registration.codec.normalize(fact.value as never, {
          kind,
          ...(definition.schemaRef === undefined ? {} : { schemaRef: definition.schemaRef }),
          sourceRef: `frozen-step://${stepId}/${kind}`,
          stepId,
        }), `checkpoint.stepExtensions.${stepId}.${kind}`);
      } catch (error) {
        throw new FlowRunCheckpointTransitionError(
          `Checkpoint extension codec rejected ${stepId}/${kind}: ${(error as Error).message}`,
        );
      }
      if (stable(normalized) !== stable(fact.value)) {
        throw new FlowRunCheckpointTransitionError(`Checkpoint extension ${stepId}/${kind} is not normalized.`);
      }
      if (checkpoint.version === 0 && (fact.revision !== 0 || stable(fact.value) !== stable(definition.initialValue))) {
        throw new FlowRunCheckpointTransitionError(`Initial checkpoint extension ${stepId}/${kind} differs from the frozen definition.`);
      }
    }
  }
  return authority;
}
