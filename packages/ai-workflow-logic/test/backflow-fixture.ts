import type { AIWorkflowFlowRunCheckpoint, WorkflowTaskDelegation, WorkflowDelegationEffectPort,FlowClosedObject } from 'ai-workflow-contract';
import { InMemoryFlowRunCheckpointStore, normalizeFlowRunCheckpoint, type WorkflowDelegationRuntime } from 'ai-workflow-logic';

export const target = { owner: 'anchor', providerScope: 'workspace:one', targetId: 'session:one' } as const;
export const delegation = (nodeId = 'draft'): WorkflowTaskDelegation => ({
  kind: 'workflow.task-delegation/v1',
  task: { nodeId, agentDefinitionRef: `resource://${nodeId}`, input: { task: nodeId } },
  context: { mode: 'fresh', owner: target.owner, providerScope: target.providerScope },
  sessionPolicy: 'shared', materials: [],
});

export async function fixture(effects: WorkflowDelegationEffectPort, tasks: WorkflowTaskDelegation[] = [delegation()],config:FlowClosedObject={}) {
  const snapshot = {
    schemaVersion: 'depa.flows.workflow/v4', treeId: 'run', fqn: 'Flow', status: 'Waiting',
    vars: {}, input: {}, branchDecisions: {}, nodeResults: {}, waitResults: {}, openWaitHandles: [], closedWaitHandles: [], appliedResumeSignals: [],
    orchestration: { attempts: {}, deadlines: {}, lanes: {}, winners: {}, cancellations: {}, composites: {} }, lastTickNo: 0, updatedAtMs: 0,
  };
  const initial = normalizeFlowRunCheckpoint({
    schemaVersion: 'depa.flow-run-checkpoint/v1', instanceId: 'instance', runId: 'run', version: 0,
    definition: { revision: 'r1', digest: `sha256:${'a'.repeat(64)}`, provenance: { authority: 'resource-package', artifactRef: 'resource://Flow' } },
    input: {}, config: { ...config,workflowDelegations: Object.fromEntries(tasks.map(task => [task.task.nodeId, { ...task, task: { ...task.task, input: null } }])) },
    state: {}, output: null,
    controllerSidecars: { status: 'Waiting', lastTickNo: 0, branchDecisions: {}, orchestration: snapshot.orchestration, openWaitHandles: [], closedWaitHandles: [], appliedResumeSignals: [] },
    nodeSidecars: { nodeResults: {}, waitResults: {} },
    profile: { kind: 'AICtrlWorkflow', snapshot, ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} } },
  }) as AIWorkflowFlowRunCheckpoint;
  const store = new InMemoryFlowRunCheckpointStore();
  await store.commit({ expectedVersion: null, checkpoint: initial });
  const key = { instanceId: 'instance', runId: 'run' };
  const runtime = (nodeId = 'draft', generation = 0, dependencies: Record<string, string> = {}): WorkflowDelegationRuntime => ({
    checkpointRuntime: { checkpointStore: store }, checkpointKey: key,
    nodeId, invocationKey: `${nodeId}#${generation}`, visit: 'body', generation,
    workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://Flow',
    taskBinding: { workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://Flow', nodeId, agentDefinitionRef: `resource://${nodeId}` },
    dependencyInvocations: dependencies, effects,
  });
  return { store, runtime, read: async () => (await store.load(key))! as AIWorkflowFlowRunCheckpoint };
}
