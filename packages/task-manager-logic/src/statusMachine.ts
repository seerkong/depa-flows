/**
 * 任务状态机（BP-1）：转移合法性 + started_at/ended_at 语义。
 */
import {
  OPERATION_TARGET,
  TASK_TRANSITIONS,
  TERMINAL_STATUSES,
  type TaskDTO,
  type TaskOperation,
  type TaskStatus,
} from 'task-manager-contract';

export class TaskTransitionError extends Error {
  constructor(public taskId: string, public from: TaskStatus, public to: TaskStatus) {
    super(`illegal task transition ${from} -> ${to} (task ${taskId})`);
  }
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** 应用一次人工操作；非法转移抛 TaskTransitionError。返回同一 task 对象（原地更新）。 */
export function applyOperation(
  task: TaskDTO,
  operation: TaskOperation,
  operatorAccount: string,
  nowMs: number,
): TaskDTO {
  const to = OPERATION_TARGET[operation];
  if (!canTransition(task.status, to)) throw new TaskTransitionError(task.id, task.status, to);
  const from = task.status;
  task.status = to;
  task.operatorAccount = operatorAccount;
  if (to === 'Active' && from !== 'Active') task.startedAtMs ??= nowMs;
  if (isTerminal(to)) task.endedAtMs = nowMs;
  if (operation === 'delegate' || operation === 'forward') task.transferredBy = operatorAccount;
  return task;
}
