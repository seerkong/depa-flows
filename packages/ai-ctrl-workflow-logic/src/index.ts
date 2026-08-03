import type {
  AICtrlWorkflowController,
  AICtrlWorkflowNodeRecord,
  AICtrlWorkflowRunRecord,
} from 'ai-ctrl-workflow-contract';
import type {
  AICtrlWorkflowDefinitionBinding,
  AICtrlWorkflowRuntime,
  AIWorkflowEffectProvider,
  AIWorkflowRuntimeContext,
  AIWorkflowStateStore,
} from 'ai-workflow-contract';
import { createAIWorkflowRuntimeContext, defineAICtrlWorkflow } from 'ai-workflow-logic';
import type { FlowCodeResolver } from 'instant-ctrl-flow-contract';
import type {
  ResumeSignal,
  TickOutcome,
  WorkCtrlFlowSnapshot,
  WorkCtrlFlowRuntime,
  WorkCtrlFlowStartOptions,
  WorkCtrlFlowStore,
} from 'work-ctrl-flow-contract';
import { WorkCtrlFlowEngine, type WorkCtrlFlowDefinition, type WorkCtrlFlowEngineOptions } from 'work-ctrl-flow-logic';

export interface CreateAICtrlWorkflowRuntimeOptions<
  Effects extends AIWorkflowEffectProvider,
  Store extends AIWorkflowStateStore,
> {
  readonly runtime?: WorkCtrlFlowRuntime;
  readonly ai: AIWorkflowRuntimeContext<Effects, Store>;
}

export function createAICtrlWorkflowRuntime<
  Effects extends AIWorkflowEffectProvider,
  Store extends AIWorkflowStateStore,
>(
  options: CreateAICtrlWorkflowRuntimeOptions<Effects, Store>,
): AICtrlWorkflowRuntime<Effects, Store> {
  return {
    ...(options.runtime ?? {}),
    ai: createAIWorkflowRuntimeContext(options.ai),
  };
}

export interface CreateAICtrlWorkflowControllerOptions
  extends Omit<WorkCtrlFlowEngineOptions, 'definition' | 'runtime' | 'expectedForm'> {
  readonly binding: AICtrlWorkflowDefinitionBinding;
  readonly resolveCode: FlowCodeResolver<AICtrlWorkflowRuntime>;
  readonly resolveFlow?: WorkCtrlFlowDefinition['resolveFlow'];
  readonly ai: AIWorkflowRuntimeContext;
  readonly runtime?: WorkCtrlFlowRuntime;
}

export function createAICtrlWorkflowController(
  options: CreateAICtrlWorkflowControllerOptions,
): AICtrlWorkflowController {
  const definition: WorkCtrlFlowDefinition = {
    spec: options.binding.definition,
    resolveCode: options.resolveCode as FlowCodeResolver<WorkCtrlFlowRuntime>,
    resolveFlow: options.resolveFlow,
  };
  const engine = new WorkCtrlFlowEngine({
    ...options,
    expectedForm: 'WorkCtrlFlow',
    definition,
    runtime: createAICtrlWorkflowRuntime({ runtime: options.runtime, ai: options.ai }),
  });
  return {
    store: options.store,
    start: (treeId, startOptions) => engine.start(treeId, startOptions),
    resume: (treeId, signal) => engine.resume(treeId, signal),
    refresh: (treeId) => engine.refresh(treeId),
    getOutcome: (treeId) => engine.getOutcome(treeId),
  };
}

export function defineWorkCtrlFlowBackedAICtrlWorkflow(
  definition: AICtrlWorkflowDefinitionBinding['definition'],
): AICtrlWorkflowDefinitionBinding {
  return defineAICtrlWorkflow(definition);
}

function nodeIdFromInvocationKey(invocationKey: string): string {
  const withoutVisit = invocationKey.slice(0, invocationKey.lastIndexOf('#'));
  return withoutVisit.slice(withoutVisit.lastIndexOf('/') + 1);
}

export function projectAICtrlWorkflowRunRecord(
  snapshot: WorkCtrlFlowSnapshot,
  outcome?: TickOutcome,
): AICtrlWorkflowRunRecord {
  const nodes = new Map<string, AICtrlWorkflowNodeRecord>();
  for (const [invocationKey, result] of Object.entries(snapshot.nodeResults)) {
    nodes.set(invocationKey, {
      invocationKey,
      nodeId: nodeIdFromInvocationKey(invocationKey),
      status: result === 'Success' ? 'Succeeded' : 'Failed',
    });
  }
  for (const [invocationKey, wait] of Object.entries(snapshot.waitResults)) {
    nodes.set(invocationKey, {
      invocationKey,
      nodeId: nodeIdFromInvocationKey(invocationKey),
      status: wait.result === 'Success' ? 'Succeeded' : 'Failed',
    });
  }
  for (const handle of snapshot.openWaitHandles) {
    nodes.set(handle.invocationKey, {
      invocationKey: handle.invocationKey,
      nodeId: handle.nodeKey,
      status: 'Waiting',
    });
  }
  return {
    treeId: snapshot.treeId,
    fqn: snapshot.fqn,
    status: outcome?.status ?? snapshot.status,
    tickNo: outcome?.tickNo ?? snapshot.lastTickNo,
    openWaitHandles: snapshot.openWaitHandles,
    nodes: [...nodes.values()],
  };
}

export async function startAICtrlWorkflowRun(
  controller: AICtrlWorkflowController,
  treeId: string,
  options: WorkCtrlFlowStartOptions = {},
): Promise<AICtrlWorkflowRunRecord> {
  const outcome = await controller.start(treeId, options);
  const snapshot = await controller.store.load(treeId);
  if (!snapshot) throw new Error(`AI Ctrl Workflow snapshot missing for ${treeId}`);
  return projectAICtrlWorkflowRunRecord(snapshot, outcome);
}

export async function resumeAICtrlWorkflowRun(
  controller: AICtrlWorkflowController,
  treeId: string,
  signal: ResumeSignal,
): Promise<AICtrlWorkflowRunRecord> {
  const outcome = await controller.resume(treeId, signal);
  const snapshot = await controller.store.load(treeId);
  if (!snapshot) throw new Error(`AI Ctrl Workflow snapshot missing for ${treeId}`);
  return projectAICtrlWorkflowRunRecord(snapshot, outcome);
}

export async function getAICtrlWorkflowRunRecord(
  controller: AICtrlWorkflowController,
  treeId: string,
): Promise<AICtrlWorkflowRunRecord | undefined> {
  const snapshot = await controller.store.load(treeId);
  return snapshot ? projectAICtrlWorkflowRunRecord(snapshot, await controller.getOutcome(treeId)) : undefined;
}
