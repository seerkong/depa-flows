import type {
  AICtrlWorkflowController,
  AICtrlWorkflowNodeRecord,
  AICtrlWorkflowRunRecord,
} from 'ai-ctrl-workflow-contract';
import type {
  AICtrlWorkflowDefinitionBinding,
  AICtrlWorkflowRunProfileState,
  AICtrlWorkflowRuntime,
  AIAgentHostEffectPort,
  FrozenAIAgentTaskBinding,
  AIWorkflowAuthoredEffects,
  AIWorkflowEffectProvider,
  AIWorkflowFlowRunCheckpoint,
  AIWorkflowProfileDurableState,
  AIWorkflowRuntimeContext,
  AIWorkflowStateProjection,
  FlowClosedObject,
  FlowClosedValue,
  FlowDefinitionArtifactIdentity,
  FlowRunCheckpointKey,
  FlowRunCheckpointRuntime,
  FlowRunStepExtensions,
} from 'ai-workflow-contract';
import {
  commitFlowRunCheckpoint,
  createAIWorkflowRuntimeContext,
  loadFlowRunCheckpoint,
  projectWorkCtrlSnapshotToCheckpointData,
  bindAIAgentProcessors,
} from 'ai-workflow-logic';
import { assertFrozenAIAgentTaskBinding } from 'ai-workflow-logic/run-freeze';
import type {
  FlowCodeResolver,
  FlowDiagnostic,
  FlowSourceCollection,
  LoadFlowSourcesOptions,
} from 'instant-ctrl-flow-contract';
import type {
  ResumeSignal,
  TickOutcome,
  WorkCtrlFlowSnapshot,
  WorkCtrlFlowRuntime,
  WorkCtrlFlowStartOptions,
  WorkCtrlFlowStore,
} from 'work-ctrl-flow-contract';
import { WorkCtrlFlowEngine, type WorkCtrlFlowDefinition, type WorkCtrlFlowEngineOptions } from 'work-ctrl-flow-logic';

export interface AICtrlWorkflowCheckpointStoreOptions {
  readonly instanceId: string;
  readonly definition: FlowDefinitionArtifactIdentity;
  readonly config: FlowClosedValue;
  readonly ai: AIWorkflowProfileDurableState;
  /** Frozen definition-derived initial facts; later saves preserve the canonical owner value. */
  readonly initialStepExtensions?: FlowRunStepExtensions;
  readonly projectOutput?: (snapshot: WorkCtrlFlowSnapshot) => FlowClosedValue;
}

function ctrlControllerSidecars(snapshot: WorkCtrlFlowSnapshot) {
  return {
    status: snapshot.status,
    lastTickNo: snapshot.lastTickNo,
    branchDecisions: snapshot.branchDecisions,
    orchestration: snapshot.orchestration,
    openWaitHandles: snapshot.openWaitHandles,
    closedWaitHandles: snapshot.closedWaitHandles,
    appliedResumeSignals: snapshot.appliedResumeSignals,
  };
}

function ctrlNodeSidecars(snapshot: WorkCtrlFlowSnapshot) {
  return {
    nodeResults: snapshot.nodeResults,
    waitResults: snapshot.waitResults,
  };
}

/** Runtime-first adapter that makes the canonical checkpoint the WorkCtrl store owner. */
export function createAICtrlWorkflowCheckpointStore(
  runtime: FlowRunCheckpointRuntime,
  options: AICtrlWorkflowCheckpointStoreOptions,
): WorkCtrlFlowStore {
  return {
    async load(treeId) {
      const checkpoint = await loadAICtrlWorkflowCheckpoint(runtime, {
        instanceId: options.instanceId,
        runId: treeId,
      });
      // WorkCtrlFlow mutates its working snapshot during a tick. The canonical
      // checkpoint remains immutable; only this detached replay copy is mutable.
      return checkpoint === undefined ? undefined : structuredClone(checkpoint.profile.snapshot);
    },
    async save(snapshot) {
      const durableSnapshot = projectWorkCtrlSnapshotToCheckpointData(snapshot);
      const key = { instanceId: options.instanceId, runId: snapshot.treeId };
      const current = await loadAICtrlWorkflowCheckpoint(runtime, key);
      const expectedVersion = current?.version ?? null;
      const checkpoint: AIWorkflowFlowRunCheckpoint = {
        schemaVersion: 'depa.flow-run-checkpoint/v1',
        instanceId: options.instanceId,
        runId: snapshot.treeId,
        definition: options.definition,
        version: current === undefined ? 0 : current.version + 1,
        input: current?.input ?? snapshot.input as FlowClosedValue,
        config: current?.config ?? options.config,
        state: durableSnapshot.vars as FlowClosedValue,
        output: options.projectOutput?.(snapshot) ?? current?.output ?? null,
        controllerSidecars: ctrlControllerSidecars(durableSnapshot) as unknown as FlowClosedObject,
        nodeSidecars: ctrlNodeSidecars(durableSnapshot) as unknown as FlowClosedObject,
        ...(current?.stepExtensions !== undefined
          ? { stepExtensions: current.stepExtensions }
          : options.initialStepExtensions === undefined
            ? {}
            : { stepExtensions: options.initialStepExtensions }),
        profile: {
          kind: 'AICtrlWorkflow',
          snapshot: durableSnapshot as unknown as FlowClosedObject,
          ai: current?.profile.kind === 'AICtrlWorkflow' ? current.profile.ai : options.ai,
        },
      };
      await commitFlowRunCheckpoint(runtime, { expectedVersion, checkpoint });
    },
    async remove(treeId) {
      throw new Error(`Canonical FlowRunCheckpoint removal is not supported for ${treeId}.`);
    },
  };
}

export async function loadAICtrlWorkflowCheckpoint(
  runtime: FlowRunCheckpointRuntime,
  input: FlowRunCheckpointKey,
): Promise<
  | (AIWorkflowFlowRunCheckpoint & { readonly profile: AICtrlWorkflowRunProfileState<WorkCtrlFlowSnapshot> })
  | undefined
> {
  const checkpoint = await loadFlowRunCheckpoint(runtime, input);
  if (checkpoint === undefined) return undefined;
  if (checkpoint.profile.kind !== 'AICtrlWorkflow') {
    throw new Error(`Flow run ${input.runId} is not an AI Ctrl Workflow checkpoint.`);
  }
  return checkpoint as AIWorkflowFlowRunCheckpoint & {
    readonly profile: AICtrlWorkflowRunProfileState<WorkCtrlFlowSnapshot>;
  };
}

export interface CreateAICtrlWorkflowRuntimeOptions<
  Effects extends AIWorkflowEffectProvider,
  Store extends AIWorkflowStateProjection,
> {
  readonly runtime?: WorkCtrlFlowRuntime;
  readonly ai: AIWorkflowRuntimeContext<Effects, Store>;
}

export function createAICtrlWorkflowRuntime<
  Effects extends AIWorkflowEffectProvider,
  Store extends AIWorkflowStateProjection,
>(
  options: CreateAICtrlWorkflowRuntimeOptions<Effects, Store>,
): AICtrlWorkflowRuntime<Effects, Store> {
  return {
    ...(options.runtime ?? {}),
    ai: createAIWorkflowRuntimeContext(options.ai),
  };
}

export interface CreateAICtrlWorkflowAgentNodeRuntimeBinderOptions {
  readonly flowInstanceId: string;
  readonly checkpointRuntime: FlowRunCheckpointRuntime;
  readonly effects: AIAgentHostEffectPort;
  readonly workflowRef: `resource://${string}`;
  readonly taskProofs: Readonly<Record<string, FrozenAIAgentTaskBinding>>;
  readonly metadata?: FlowClosedObject;
}

/** Composition seam: ordinary WorkCtrl Run nodes receive the same-named bound facade. */
export function createAICtrlWorkflowAgentNodeRuntimeBinder(
  options: CreateAICtrlWorkflowAgentNodeRuntimeBinderOptions,
): NonNullable<WorkCtrlFlowEngineOptions['bindNodeRuntime']> {
  return (runtime, identity) => {
    const workflowRuntime = runtime as AICtrlWorkflowRuntime<any, AIWorkflowStateProjection>;
    if (!workflowRuntime.ai) throw new Error('AI Ctrl node runtime requires an AI runtime context.');
    const proof = options.taskProofs[identity.nodeId];
    if (!proof) throw new Error(`AI_AGENT_TASK_PROOF_REQUIRED: no frozen proof for node ${identity.nodeId}.`);
    const taskBinding = assertFrozenAIAgentTaskBinding(proof).task;
    const effects: AIWorkflowAuthoredEffects = bindAIAgentProcessors({
      checkpointRuntime: options.checkpointRuntime,
      checkpointKey: { instanceId: options.flowInstanceId, runId: identity.treeId },
      nodeId: identity.nodeId,
      invocationKey: identity.invocationKey,
      workflowKind: 'AICtrlWorkflow',
      workflowRef: options.workflowRef,
      taskBinding,
      effects: options.effects,
      ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    });
    return Object.freeze({ ...runtime, ai: Object.freeze({ ...workflowRuntime.ai, effects }) });
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

export * from './source-loader.js';

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

export * from './holon-task.js';
