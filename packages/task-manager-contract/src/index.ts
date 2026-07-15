/**
 * task-manager-contract —— 任务树与状态机契约（BP-1）。
 */

export type TaskStatus =
  | 'NotStarted'
  | 'Active'
  | 'Delegated'
  | 'Forwarded'
  | 'Done'
  | 'Refused'
  | 'Abandoned';

export const EXECUTION_MODES = ['SEQUENTIAL', 'ANY', 'ALL'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** 状态转移表（BP-1）；终态：DONE / REFUSED / FORWARDED / ABANDONED */
export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  NotStarted: ['Active', 'Abandoned'],
  Active: ['Done', 'Refused', 'Forwarded', 'Delegated', 'NotStarted', 'Abandoned'],
  Delegated: ['Active', 'Abandoned'],
  Forwarded: [],
  Done: [],
  Refused: [],
  Abandoned: [],
};

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['Done', 'Refused', 'Forwarded', 'Abandoned']);

/** 人工操作词汇（BP-3：一切人工操作皆信号的载荷） */
export type TaskOperation = 'start' | 'complete' | 'refuse' | 'forward' | 'delegate' | 'reactivate' | 'abandon';

export const OPERATION_TARGET: Record<TaskOperation, TaskStatus> = {
  start: 'Active',
  complete: 'Done',
  refuse: 'Refused',
  forward: 'Forwarded',
  delegate: 'Delegated',
  reactivate: 'Active',
  abandon: 'Abandoned',
};

export interface TaskDTO {
  kind: 'task';
  id: string;
  name: string;
  ownerAccount: string;
  status: TaskStatus;
  order: number;
  description?: string;
  operatorAccount?: string;
  transferredBy?: string;
  startedAtMs?: number;
  endedAtMs?: number;
}

export interface TaskGroupDTO {
  kind: 'group';
  id: string;
  name: string;
  executionMode: ExecutionMode;
  order: number;
  children: TaskTreeNode[];
}

export type TaskTreeNode = TaskDTO | TaskGroupDTO;

export interface TaskSpaceDTO {
  id: string;
  name: string;
  version: number;
  children: TaskTreeNode[];
}

/** 任务树外置存储（运行期副本；制品内 status 是初始状态，M-D4 同理） */
export interface TaskSpaceStore {
  load(spaceId: string): Promise<TaskSpaceDTO | undefined>;
  save(spaceId: string, space: TaskSpaceDTO): Promise<void>;
  remove(spaceId: string): Promise<void>;
}
