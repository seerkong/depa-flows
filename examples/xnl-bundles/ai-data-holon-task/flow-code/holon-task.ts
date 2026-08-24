import type {
  AIDataWorkflowRuntime,
  FrozenHolonTaskTarget,
  HolonTaskTarget,
} from 'ai-workflow-contract';
import { holonTaskTargetFromNodeConfig } from 'ai-workflow-contract';
import {
  consumeAIDataHolonTask,
  type AIDataHolonTaskRuntime,
} from 'ai-data-workflow-logic';

export interface HolonTaskReference {
  taskSpaceId: string;
  taskId: string;
  settlementCommandId: string;
}

type Runtime = AIDataWorkflowRuntime & {
  readonly holonTasks: AIDataHolonTaskRuntime & {
    proofForNode(nodeId: string): FrozenHolonTaskTarget;
  };
};

export async function consumeOrganizationTask(
  runtime: Runtime,
  input: { task: HolonTaskReference },
  config: { holonTaskTarget: HolonTaskTarget },
) {
  const target = holonTaskTargetFromNodeConfig(config, {
    workflowKind: 'AIDataWorkflow',
    workflowRef: 'resource://depa.examples.HolonTaskResultData',
    nodeId: 'consume-task',
  });
  if (!target) throw new Error('Holon task target is required.');
  const proof = runtime.holonTasks.proofForNode('consume-task');
  if (JSON.stringify(proof.target) !== JSON.stringify(target)) throw new Error('Frozen Holon task target mismatch.');
  const settled = await consumeAIDataHolonTask(runtime.holonTasks, {
    frozenTarget: proof,
    taskSpaceId: input.task.taskSpaceId,
    taskId: input.task.taskId,
    settlementCommandId: input.task.settlementCommandId,
  }, {});
  return { result: settled.output };
}
