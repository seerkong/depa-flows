import type {
  AIAgentEffectConfig,
  AIAgentHostRunResult,
  AIAgentInstanceReference,
  AIAgentInvocation,
  AIAgentInvocationReceipt,
  AIAgentProcessorRuntime,
  AIAgentRunResult,
  AIAgentSelector,
  AIWorkflowAuthoredEffects,
  AIWorkflowFlowRunCheckpoint,
  AIWorkflowProfileDurableState,
  FlowClosedValue,
} from 'ai-workflow-contract';
import {
  AIAgentInvocationError,
  normalizeAIAgentEffectConfig,
  normalizeAIAgentInvocation,
  normalizeAIAgentSelector,
  normalizeCanonicalAIAgentState,
  assertAIAgentNodeTaskBinding,
} from './agent-state.js';
import { normalizeFlowClosedObject, normalizeFlowClosedValue } from './run-checkpoint.js';

export { AIAgentInvocationError, normalizeAIAgentEffectConfig, normalizeAIAgentInvocation, normalizeAIAgentSelector } from './agent-state.js';

function fail(code: string, location: string, message: string): never {
  throw new AIAgentInvocationError(code, location, message);
}

function profileAI(checkpoint: AIWorkflowFlowRunCheckpoint): AIWorkflowProfileDurableState {
  if (checkpoint.profile.kind !== 'AICtrlWorkflow' && checkpoint.profile.kind !== 'AIDataWorkflow') {
    return fail('AI_AGENT_PROFILE_REQUIRED', 'checkpoint.profile.kind', 'Agent invocation requires an AI workflow profile.');
  }
  return normalizeCanonicalAIAgentState(checkpoint.profile.ai, 'checkpoint.profile.ai');
}

async function loadCheckpoint(runtime: AIAgentProcessorRuntime): Promise<AIWorkflowFlowRunCheckpoint> {
  const checkpoint = await runtime.checkpointRuntime.checkpointStore.load(runtime.checkpointKey) as AIWorkflowFlowRunCheckpoint | undefined;
  if (!checkpoint) fail('AI_AGENT_CHECKPOINT_NOT_FOUND', 'runtime.checkpointKey', 'Canonical Flow checkpoint does not exist.');
  if (checkpoint.instanceId !== runtime.checkpointKey.instanceId || checkpoint.runId !== runtime.checkpointKey.runId) {
    fail('AI_AGENT_CHECKPOINT_IDENTITY_MISMATCH', 'runtime.checkpointKey', 'Loaded checkpoint identity differs from the requested run.');
  }
  return checkpoint;
}

function withAI(checkpoint: AIWorkflowFlowRunCheckpoint, ai: AIWorkflowProfileDurableState): AIWorkflowFlowRunCheckpoint {
  if (checkpoint.profile.kind === 'AICtrlWorkflow') return { ...checkpoint, version: checkpoint.version + 1, profile: { ...checkpoint.profile, ai } };
  if (checkpoint.profile.kind === 'AIDataWorkflow') return { ...checkpoint, version: checkpoint.version + 1, profile: { ...checkpoint.profile, ai } };
  return fail('AI_AGENT_PROFILE_REQUIRED', 'checkpoint.profile.kind', 'Agent invocation requires an AI workflow profile.');
}

async function commitAI(runtime: AIAgentProcessorRuntime, checkpoint: AIWorkflowFlowRunCheckpoint, ai: AIWorkflowProfileDurableState): Promise<AIWorkflowFlowRunCheckpoint> {
  return runtime.checkpointRuntime.checkpointStore.commit({ expectedVersion: checkpoint.version, checkpoint: withAI(checkpoint, normalizeCanonicalAIAgentState(ai)) }) as Promise<AIWorkflowFlowRunCheckpoint>;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function semanticFacts(config: AIAgentEffectConfig, invocationMetadata?: Readonly<Record<string, FlowClosedValue>>): Readonly<Record<string, FlowClosedValue>> {
  return normalizeFlowClosedObject({
    materialRefs: config.materialRefs ?? [],
    effectPolicy: config.effectPolicy ?? null,
    invocationMetadata: invocationMetadata ?? null,
  }, 'semanticFacts');
}

function assertTaskAuthority(runtime: AIAgentProcessorRuntime, config: AIAgentEffectConfig): void {
  if (!runtime.taskBinding) fail('AI_AGENT_TASK_BINDING_REQUIRED', 'runtime.taskBinding', 'A frozen Agent task binding is required.');
  assertAIAgentNodeTaskBinding(runtime.taskBinding, {
    workflowKind: runtime.workflowKind,
    workflowRef: runtime.workflowRef,
    nodeId: runtime.nodeId,
  }, config);
}

function assertSameInvocation(receipt: AIAgentInvocationReceipt, runtime: AIAgentProcessorRuntime, mode: 'new' | 'targeted', input: FlowClosedValue, config: AIAgentEffectConfig, invocationMetadata?: Readonly<Record<string, FlowClosedValue>>): void {
  if (receipt.nodeId !== runtime.nodeId || receipt.mode !== mode || receipt.agentDefinitionRef !== config.agentDefinitionRef || !same(receipt.input, input) || receipt.generation !== runtime.generation || !same(receipt.semanticFacts, semanticFacts(config, invocationMetadata))) {
    fail('AI_AGENT_INVOCATION_KEY_CONFLICT', `checkpoint.profile.ai.invocationsByKey.${runtime.invocationKey}`, 'Invocation key is already bound to different facts.');
  }
  if (mode === 'new' && receipt.instanceName !== config.instanceName) fail('AI_AGENT_INVOCATION_KEY_CONFLICT', `checkpoint.profile.ai.invocationsByKey.${runtime.invocationKey}.instanceName`, 'Invocation key has another name intent.');
}

function resultFromReceipt(ai: AIWorkflowProfileDurableState, receipt: AIAgentInvocationReceipt): AIAgentRunResult {
  if (receipt.status !== 'completed' || receipt.instanceId === undefined || receipt.output === undefined) fail('AI_AGENT_COMPLETED_INVOCATION_INCOMPLETE', 'receipt', 'Completed receipt is incomplete.');
  const instance = ai.instancesById[receipt.instanceId];
  if (!instance) fail('AI_AGENT_INSTANCE_ID_NOT_FOUND', 'receipt.instanceId', 'Completed receipt instance is missing.');
  return Object.freeze({
    output: receipt.output,
    instance,
    receipt: Object.freeze({ invocationKey: receipt.invocationKey, nodeId: receipt.nodeId, status: 'completed' as const }),
  });
}

function pendingReceipt(runtime: AIAgentProcessorRuntime, mode: 'new' | 'targeted', input: FlowClosedValue, config: AIAgentEffectConfig, instance?: AIAgentInstanceReference, invocationMetadata?: Readonly<Record<string, FlowClosedValue>>): AIAgentInvocationReceipt {
  const instanceName = mode === 'targeted' ? instance?.instanceName : config.instanceName;
  return Object.freeze({
    invocationKey: runtime.invocationKey,
    nodeId: runtime.nodeId,
    status: 'pending',
    mode,
    agentDefinitionRef: config.agentDefinitionRef,
    input,
    semanticFacts: semanticFacts(config, invocationMetadata),
    ...(instanceName === undefined ? {} : { instanceName }),
    ...(instance === undefined ? {} : { instanceId: instance.instanceId }),
    ...(runtime.generation === undefined ? {} : { generation: runtime.generation }),
    ...(runtime.metadata === undefined ? {} : { metadata: normalizeFlowClosedObject(runtime.metadata, 'runtime.metadata') }),
  });
}

function reserveName(ai: AIWorkflowProfileDurableState, receipt: AIAgentInvocationReceipt): void {
  if (receipt.instanceName === undefined) return;
  if (ai.instanceIdByName[receipt.instanceName] !== undefined) fail('AI_AGENT_INSTANCE_NAME_ALREADY_BOUND', 'config.instanceName', 'Instance name is already bound.');
  for (const existing of Object.values(ai.invocationsByKey)) {
    if (existing.invocationKey !== receipt.invocationKey && existing.status === 'pending' && existing.instanceName === receipt.instanceName) {
      fail('AI_AGENT_INSTANCE_NAME_RESERVED', 'config.instanceName', 'Instance name is already reserved by another invocation.');
    }
  }
}

function resolveSelector(ai: AIWorkflowProfileDurableState, selector: AIAgentSelector, config: AIAgentEffectConfig): AIAgentInstanceReference {
  const instanceId = 'byId' in selector ? selector.byId : ai.instanceIdByName[selector.byName];
  if (instanceId === undefined) fail('AI_AGENT_INSTANCE_NAME_NOT_FOUND', 'selector.byName', 'Named Agent instance does not exist.');
  const instance = ai.instancesById[instanceId];
  if (!instance) fail('AI_AGENT_INSTANCE_ID_NOT_FOUND', 'selector', 'Agent instance does not exist.');
  if (instance.instanceName !== undefined && ai.instanceIdByName[instance.instanceName] !== instance.instanceId) fail('AI_AGENT_INSTANCE_INDEX_CONFLICT', 'checkpoint.profile.ai', 'Agent instance indexes are not reciprocal.');
  if (instance.agentDefinitionRef !== config.agentDefinitionRef) fail('AI_AGENT_DEFINITION_CONFLICT', 'config.agentDefinitionRef', 'Target instance is bound to another Agent definition.');
  return instance;
}

function normalizeHostResult(result: AIAgentHostRunResult, config: AIAgentEffectConfig, expected?: AIAgentInstanceReference): { output: FlowClosedValue; instance: AIAgentInstanceReference; hostReceipt?: Record<string, FlowClosedValue> } {
  const output = normalizeFlowClosedValue(result.output, 'hostResult.output');
  const source = result.instance;
  if (!source || typeof source !== 'object') fail('AI_AGENT_HOST_INSTANCE_INVALID', 'hostResult.instance', 'Host result must contain an instance reference.');
  const candidate = normalizeCanonicalAIAgentState({
    schemaVersion: 'depa.ai-agent-state/v1',
    instancesById: {
      [source.instanceId]: {
        authority: source.authority,
        instanceId: source.instanceId,
        ...(source.instanceName === undefined ? {} : { instanceName: source.instanceName }),
        ...(source.sessionId === undefined ? {} : { sessionId: source.sessionId }),
        ...(source.metadata === undefined ? {} : { metadata: source.metadata }),
        agentDefinitionRef: source.agentDefinitionRef ?? config.agentDefinitionRef,
      },
    },
    instanceIdByName: source.instanceName === undefined ? {} : { [source.instanceName]: source.instanceId },
    invocationsByKey: {},
  }, 'hostResult.state');
  const instance = candidate.instancesById[source.instanceId];
  if (!instance || instance.agentDefinitionRef !== config.agentDefinitionRef) fail('AI_AGENT_HOST_DEFINITION_CONFLICT', 'hostResult.instance.agentDefinitionRef', 'Host instance uses another Agent definition.');
  if (config.instanceName !== undefined && instance.instanceName !== config.instanceName) fail('AI_AGENT_HOST_NAME_CONFLICT', 'hostResult.instance.instanceName', 'Host instance did not preserve the reserved name.');
  if (expected && (instance.instanceId !== expected.instanceId || instance.authority !== expected.authority)) fail('AI_AGENT_HOST_TARGET_CONFLICT', 'hostResult.instance', 'Host targeted result differs from the selected instance.');
  return { output, instance, ...(result.hostReceipt === undefined ? {} : { hostReceipt: normalizeFlowClosedObject(result.hostReceipt, 'hostResult.hostReceipt') }) };
}

async function complete(runtime: AIAgentProcessorRuntime, checkpoint: AIWorkflowFlowRunCheckpoint, pending: AIAgentInvocationReceipt, host: AIAgentHostRunResult, config: AIAgentEffectConfig, expected?: AIAgentInstanceReference): Promise<AIAgentRunResult> {
  const normalized = normalizeHostResult(host, config, expected);
  const latest = await loadCheckpoint(runtime);
  const ai = profileAI(latest);
  const accepted = ai.invocationsByKey[runtime.invocationKey];
  if (accepted?.status === 'completed') return resultFromReceipt(ai, accepted);
  if (!accepted || !same(accepted, pending)) fail('AI_AGENT_INVOCATION_RESERVATION_CHANGED', 'checkpoint.profile.ai', 'Invocation reservation changed before completion.');
  const prior = ai.instancesById[normalized.instance.instanceId];
  if (prior && !same(prior, normalized.instance)) fail('AI_AGENT_INSTANCE_ID_CONFLICT', 'hostResult.instance.instanceId', 'Instance id is already bound to different facts.');
  if (normalized.instance.instanceName !== undefined) {
    const priorId = ai.instanceIdByName[normalized.instance.instanceName];
    if (priorId !== undefined && priorId !== normalized.instance.instanceId) fail('AI_AGENT_INSTANCE_NAME_ALREADY_BOUND', 'hostResult.instance.instanceName', 'Instance name is already bound to another id.');
  }
  const completed: AIAgentInvocationReceipt = Object.freeze({ ...pending, status: 'completed', instanceId: normalized.instance.instanceId, output: normalized.output, ...(normalized.hostReceipt === undefined ? {} : { hostReceipt: normalized.hostReceipt }) });
  const nextAI = normalizeCanonicalAIAgentState({
    ...ai,
    instancesById: { ...ai.instancesById, [normalized.instance.instanceId]: normalized.instance },
    instanceIdByName: normalized.instance.instanceName === undefined ? ai.instanceIdByName : { ...ai.instanceIdByName, [normalized.instance.instanceName]: normalized.instance.instanceId },
    invocationsByKey: { ...ai.invocationsByKey, [runtime.invocationKey]: completed },
  });
  try {
    const committed = await commitAI(runtime, latest, nextAI);
    return resultFromReceipt(profileAI(committed), completed);
  } catch (error) {
    const converged = await loadCheckpoint(runtime);
    if (converged.version <= latest.version) throw error;
    const convergedAI = profileAI(converged);
    const acceptedCompletion = convergedAI.invocationsByKey[pending.invocationKey];
    if (!acceptedCompletion || acceptedCompletion.status !== 'completed'
      || acceptedCompletion.nodeId !== pending.nodeId
      || acceptedCompletion.mode !== pending.mode
      || acceptedCompletion.agentDefinitionRef !== pending.agentDefinitionRef
      || acceptedCompletion.instanceId !== normalized.instance.instanceId
      || acceptedCompletion.instanceName !== normalized.instance.instanceName
      || acceptedCompletion.generation !== pending.generation
      || !same(acceptedCompletion.input, pending.input)
      || !same(acceptedCompletion.semanticFacts, pending.semanticFacts)) throw error;
    const acceptedInstance = convergedAI.instancesById[normalized.instance.instanceId];
    if (!acceptedInstance || !same(acceptedInstance, normalized.instance)) throw error;
    return resultFromReceipt(convergedAI, acceptedCompletion);
  }
}

export async function runAgent<Input extends FlowClosedValue = FlowClosedValue, Output extends FlowClosedValue = FlowClosedValue>(runtime: AIAgentProcessorRuntime, input: Input, configInput: AIAgentEffectConfig): Promise<AIAgentRunResult<Output>> {
  const inputValue = normalizeFlowClosedValue(input, 'input') as Input;
  const config = normalizeAIAgentEffectConfig(configInput);
  assertTaskAuthority(runtime, config);
  let checkpoint = await loadCheckpoint(runtime);
  let ai = profileAI(checkpoint);
  let receipt = ai.invocationsByKey[runtime.invocationKey];
  if (receipt) {
    assertSameInvocation(receipt, runtime, 'new', inputValue, config);
    if (receipt.status === 'completed') return resultFromReceipt(ai, receipt) as AIAgentRunResult<Output>;
  } else {
    receipt = pendingReceipt(runtime, 'new', inputValue, config);
    reserveName(ai, receipt);
    try {
      checkpoint = await commitAI(runtime, checkpoint, { ...ai, invocationsByKey: { ...ai.invocationsByKey, [runtime.invocationKey]: receipt } });
    } catch (error) {
      const latest = await loadCheckpoint(runtime);
      if (latest.version <= checkpoint.version) throw error;
      const latestAI = profileAI(latest);
      const accepted = latestAI.invocationsByKey[runtime.invocationKey];
      if (accepted) {
        assertSameInvocation(accepted, runtime, 'new', inputValue, config);
        checkpoint = latest;
      } else {
        reserveName(latestAI, receipt);
        checkpoint = await commitAI(runtime, latest, { ...latestAI, invocationsByKey: { ...latestAI.invocationsByKey, [runtime.invocationKey]: receipt } });
      }
    }
    ai = profileAI(checkpoint);
    receipt = ai.invocationsByKey[runtime.invocationKey]!;
  }
  if (receipt.status === 'completed') return resultFromReceipt(ai, receipt) as AIAgentRunResult<Output>;
  const host = await runtime.effects.runAgent({ invocationKey: runtime.invocationKey, flowInstanceId: runtime.checkpointKey.instanceId, runId: runtime.checkpointKey.runId, nodeId: runtime.nodeId, ...(runtime.generation === undefined ? {} : { generation: runtime.generation }), input: inputValue, agentDefinitionRef: config.agentDefinitionRef, ...(config.instanceName === undefined ? {} : { instanceName: config.instanceName }), ...(config.materialRefs === undefined ? {} : { materialRefs: config.materialRefs }), ...(config.effectPolicy === undefined ? {} : { effectPolicy: config.effectPolicy }), ...(runtime.signal === undefined ? {} : { signal: runtime.signal }), ...(runtime.metadata === undefined ? {} : { metadata: runtime.metadata }) });
  return complete(runtime, checkpoint, receipt, host, config) as Promise<AIAgentRunResult<Output>>;
}

export async function runTargetedAgent<Input extends FlowClosedValue = FlowClosedValue, Output extends FlowClosedValue = FlowClosedValue>(runtime: AIAgentProcessorRuntime, selectorInput: AIAgentSelector, invocationInput: AIAgentInvocation<Input>, configInput: AIAgentEffectConfig): Promise<AIAgentRunResult<Output>> {
  const selector = normalizeAIAgentSelector(selectorInput);
  const invocation = normalizeAIAgentInvocation<Input>(invocationInput);
  const config = normalizeAIAgentEffectConfig(configInput);
  assertTaskAuthority(runtime, config);
  let checkpoint = await loadCheckpoint(runtime);
  let ai = profileAI(checkpoint);
  const instance = resolveSelector(ai, selector, config);
  let receipt = ai.invocationsByKey[runtime.invocationKey];
  if (receipt) {
    assertSameInvocation(receipt, runtime, 'targeted', invocation.payload, config, invocation.metadata);
    if (receipt.instanceId !== instance.instanceId) fail('AI_AGENT_INVOCATION_TARGET_CONFLICT', 'selector', 'Invocation key is reserved for another instance.');
    if (receipt.status === 'completed') return resultFromReceipt(ai, receipt) as AIAgentRunResult<Output>;
  } else {
    receipt = pendingReceipt(runtime, 'targeted', invocation.payload, config, instance, invocation.metadata);
    try {
      checkpoint = await commitAI(runtime, checkpoint, { ...ai, invocationsByKey: { ...ai.invocationsByKey, [runtime.invocationKey]: receipt } });
    } catch (error) {
      const latest = await loadCheckpoint(runtime);
      if (latest.version <= checkpoint.version) throw error;
      const latestAI = profileAI(latest);
      const resolved = resolveSelector(latestAI, selector, config);
      if (resolved.instanceId !== instance.instanceId) fail('AI_AGENT_SELECTOR_CHANGED', 'selector', 'Selector resolved to another instance after checkpoint conflict.');
      const accepted = latestAI.invocationsByKey[runtime.invocationKey];
      if (accepted) {
        assertSameInvocation(accepted, runtime, 'targeted', invocation.payload, config, invocation.metadata);
        checkpoint = latest;
      } else {
        checkpoint = await commitAI(runtime, latest, { ...latestAI, invocationsByKey: { ...latestAI.invocationsByKey, [runtime.invocationKey]: receipt } });
      }
    }
    ai = profileAI(checkpoint);
    receipt = ai.invocationsByKey[runtime.invocationKey]!;
  }
  if (receipt.status === 'completed') return resultFromReceipt(ai, receipt) as AIAgentRunResult<Output>;
  const host = await runtime.effects.runTargetedAgent({ invocationKey: runtime.invocationKey, flowInstanceId: runtime.checkpointKey.instanceId, runId: runtime.checkpointKey.runId, nodeId: runtime.nodeId, ...(runtime.generation === undefined ? {} : { generation: runtime.generation }), input: invocation.payload, instance, agentDefinitionRef: config.agentDefinitionRef, ...(config.materialRefs === undefined ? {} : { materialRefs: config.materialRefs }), ...(config.effectPolicy === undefined ? {} : { effectPolicy: config.effectPolicy }), ...(runtime.signal === undefined ? {} : { signal: runtime.signal }), metadata: { ...(runtime.metadata ?? {}), ...(invocation.metadata ?? {}) } });
  return complete(runtime, checkpoint, receipt, host, config, instance) as Promise<AIAgentRunResult<Output>>;
}

export function bindAIAgentProcessors(runtime: AIAgentProcessorRuntime): AIWorkflowAuthoredEffects {
  return Object.freeze({
    runAgent: <Input extends FlowClosedValue, Output extends FlowClosedValue>(input: Input, config: AIAgentEffectConfig) => runAgent<Input, Output>(runtime, input, config),
    runTargetedAgent: <Input extends FlowClosedValue, Output extends FlowClosedValue>(selector: AIAgentSelector, invocation: AIAgentInvocation<Input>, config: AIAgentEffectConfig) => runTargetedAgent<Input, Output>(runtime, selector, invocation, config),
  });
}
