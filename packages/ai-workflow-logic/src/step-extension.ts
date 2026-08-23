import type {
  FlowClosedValue,
  FlowRunCheckpointRuntime,
  FlowRunStepExtensions,
  RunStepExtensionMutationConfig,
  RunStepExtensionMutationInvocation,
  RunStepExtensionSelector,
} from 'ai-workflow-contract';
import type { DefinitionStepExtensionCodecRegistryPort } from 'flow-step-space-contract';
import {
  validateCheckpointAgainstFrozenProfile,
  type FlowRunProfileAuthorityPort,
} from './checkpoint-profile.js';
import { normalizeFlowClosedValue } from './run-checkpoint.js';

export interface RunStepExtensionMutationRuntime extends FlowRunCheckpointRuntime {
  readonly profileAuthority: FlowRunProfileAuthorityPort;
  readonly extensionCodecs: DefinitionStepExtensionCodecRegistryPort;
}

/** Targeted Processor: output = fn(runtime, selector, invocation, config). */
export async function mutateRunStepExtension(
  runtime: RunStepExtensionMutationRuntime,
  selector: RunStepExtensionSelector,
  invocation: RunStepExtensionMutationInvocation,
  config: RunStepExtensionMutationConfig,
) {
  exactOwnData(config, [], 'config');
  const selectorRecord = exactOwnData(selector, ['instanceId', 'runId', 'stepId', 'kind'], 'selector');
  const normalizedSelector = Object.fromEntries(['instanceId', 'runId', 'stepId', 'kind'].map((name) => [
    name,
    ownDataValue(selectorRecord, name, `selector.${name}`),
  ])) as unknown as RunStepExtensionSelector;
  for (const [name, value] of Object.entries(normalizedSelector)) {
    if (typeof value !== 'string' || !value || value !== value.trim()) throw new Error(`Run step extension selector ${name} is invalid.`);
  }
  const invocationRecord = exactOwnData(invocation, ['expectedRevision', 'value'], 'invocation');
  const expectedRevision = ownDataValue(invocationRecord, 'expectedRevision', 'invocation.expectedRevision');
  const invocationValue = ownDataValue(invocationRecord, 'value', 'invocation.value') as FlowClosedValue;
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) {
    throw new Error('Run step extension expectedRevision is invalid.');
  }
  const checkpoint = await runtime.checkpointStore.load({
    instanceId: normalizedSelector.instanceId,
    runId: normalizedSelector.runId,
  });
  if (!checkpoint) throw new Error(`Run ${normalizedSelector.runId} does not exist.`);
  const normalized = checkpoint;
  const authority = validateCheckpointAgainstFrozenProfile(normalized, runtime);
  if (!authority) throw new Error('Run step extension mutation requires frozen profile authority.');
  const definition = authority.extensionsByStepId[normalizedSelector.stepId]?.[normalizedSelector.kind];
  const fact = normalized.stepExtensions?.byStepId[normalizedSelector.stepId]?.[normalizedSelector.kind];
  if (!definition || !fact) throw new Error(`Run step extension ${normalizedSelector.stepId}/${normalizedSelector.kind} is not admitted.`);
  if (fact.revision !== expectedRevision) {
    throw new Error(`Run step extension revision conflict: expected ${String(expectedRevision)}, actual ${fact.revision}.`);
  }
  const registration = runtime.extensionCodecs.resolve(normalizedSelector.kind);
  if (!registration?.codec || registration.schemaRef !== definition.schemaRef) {
    throw new Error(`Run step extension codec is unavailable for ${normalizedSelector.stepId}/${normalizedSelector.kind}.`);
  }
  const value = normalizeFlowClosedValue(registration.codec.normalize(invocationValue as never, {
    kind: normalizedSelector.kind,
    ...(definition.schemaRef === undefined ? {} : { schemaRef: definition.schemaRef }),
    sourceRef: `frozen-step://${normalizedSelector.stepId}/${normalizedSelector.kind}`,
    stepId: normalizedSelector.stepId,
  }), `runStepExtension.${normalizedSelector.stepId}.${normalizedSelector.kind}`);
  const stepExtensions: FlowRunStepExtensions = {
    schemaVersion: 'depa.flow-run-step-extensions/v1',
    byStepId: {
      ...normalized.stepExtensions!.byStepId,
      [normalizedSelector.stepId]: {
        ...normalized.stepExtensions!.byStepId[normalizedSelector.stepId],
        [normalizedSelector.kind]: {
          ...(definition.schemaRef === undefined ? {} : { schemaRef: definition.schemaRef }),
          revision: fact.revision + 1,
          value,
        },
      },
    },
  };
  return runtime.checkpointStore.commit({
    expectedVersion: normalized.version,
    checkpoint: {
      ...normalized,
      version: normalized.version + 1,
      stepExtensions,
    },
  });
}

function exactOwnData(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a plain own-data object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain own-data object.`);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw new Error(`${label} contains a symbol field.`);
  const actual = (keys as string[]).sort(compareCodeUnits);
  const expected = [...fields].sort(compareCodeUnits);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} fields are invalid.`);
  for (const key of actual) ownDataValue(value as Record<string, unknown>, key, `${label}.${key}`);
  return value as Record<string, unknown>;
}

function ownDataValue(record: Record<string, unknown>, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error(`${label} must be an enumerable own-data field.`);
  return descriptor.value;
}

const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
