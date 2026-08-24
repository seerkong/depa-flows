import type {
  AICtrlWorkflowRuntime,
  FrozenHolonTaskTarget,
  HolonTaskTarget,
} from 'ai-workflow-contract';
import { holonTaskTargetFromNodeConfig } from 'ai-workflow-contract';
import {
  observeAICtrlHolonTask,
  openAICtrlHolonTask,
  type AICtrlHolonTaskRuntime,
} from 'ai-ctrl-workflow-logic';

export interface HolonTaskCtrlInput {
  caseId: string;
  request: string;
}

export interface HolonTaskCtrlResult {
  taskSpaceId: string;
  taskId: string;
  status: string;
}

type Runtime = AICtrlWorkflowRuntime & {
  readonly holonTasks: AICtrlHolonTaskRuntime & {
    proofForNode(nodeId: string): FrozenHolonTaskTarget;
  };
};

interface OpenConfig {
  readonly taskSpaceId: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly commandId: string;
  readonly holonTaskTarget: HolonTaskTarget;
}

export function openOrganizationTask(runtime: Runtime, _input: HolonTaskCtrlInput, config: OpenConfig) {
  const target = holonTaskTargetFromNodeConfig(config, {
    workflowKind: 'AICtrlWorkflow',
    workflowRef: 'resource://depa.examples.HolonTaskReviewCtrl',
    nodeId: 'open-task',
  });
  if (!target) throw new Error('Holon task target is required.');
  const proof = runtime.holonTasks.proofForNode('open-task');
  if (JSON.stringify(proof.target) !== JSON.stringify(target)) throw new Error('Frozen Holon task target mismatch.');
  return openAICtrlHolonTask(runtime.holonTasks, {
    frozenTarget: proof,
    commandId: config.commandId,
    taskSpaceId: config.taskSpaceId,
    taskId: config.taskId,
    taskName: config.taskName,
    createdAt: '2026-01-01T00:00:01.000Z',
  }, { maxTasks: 64, maxRelations: 128, maxLeaseDurationMs: 300_000 });
}

export function observeOrganizationTask(
  runtime: Runtime,
  _input: unknown,
  config: { taskSpaceId: string; taskId: string; settlementCommandId: string },
) {
  return observeAICtrlHolonTask(runtime.holonTasks, config, {});
}

export function toCtrlResult(_runtime: Runtime, input: { taskSpaceId?: string; taskId?: string; kind?: string }) {
  return {
    taskSpaceId: input.taskSpaceId ?? 'support-review-space',
    taskId: input.taskId ?? 'support-review-task',
    status: input.kind ?? 'waiting',
  } satisfies HolonTaskCtrlResult;
}
