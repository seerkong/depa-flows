/**
 * bp-ctrl-flow-contract —— BPCtrlFlow 契约（BP-1~BP-5）。
 */
import type { TaskOperation, TaskStatus } from 'task-manager-contract';
import type { TickOutcome } from 'work-ctrl-flow-contract';

/** 人工操作请求（BP-3：一切人工操作皆信号） */
export interface TaskOperationRequest {
  taskId: string;
  operation: TaskOperation;
  operatorAccount: string;
}

export interface TaskOperationResult {
  /** 操作后的任务状态 */
  taskStatus: TaskStatus;
  /** 若操作使某个 TaskStep 收敛，则为触发的新 tick 结果；否则为当前流程状态 */
  outcome: TickOutcome;
  /** 本次操作是否触发了流程推进 */
  advancedFlow: boolean;
}

export type TaskStepStatus = Extract<TaskStatus, 'Done' | 'Refused' | 'Forwarded' | 'Abandoned'>;
export type TaskStepOutcome = 'approved' | 'refused' | 'forwarded' | 'abandoned';

/** TaskStep 的业务输出。所有 outcome 都是普通 data，不表示技术执行成败。 */
export interface TaskStepResult<Payload = unknown> {
  taskId: string;
  status: TaskStepStatus;
  outcome: TaskStepOutcome;
  payload?: Payload;
}

const TASK_OUTCOME_BY_STATUS: Record<TaskStepStatus, TaskStepOutcome> = {
  Done: 'approved',
  Refused: 'refused',
  Forwarded: 'forwarded',
  Abandoned: 'abandoned',
};

export function taskStepResultOf<Payload>(
  taskId: string,
  status: TaskStepStatus,
  payload?: Payload,
): TaskStepResult<Payload> {
  return {
    taskId,
    status,
    outcome: TASK_OUTCOME_BY_STATUS[status],
    ...(payload === undefined ? {} : { payload }),
  };
}
