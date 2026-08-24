import type { FlowNodeSpec } from 'instant-ctrl-flow-contract';
import type {
  TaskNodeDefinition,
  TaskRecord,
  TaskRelation,
  TaskSpaceDefinition,
  TaskSpaceSnapshot,
} from 'task-manager-contract';
import {
  BP_EXECUTION_MODES,
  BP_TASK_STATUSES,
  bpTaskGroupProfile,
  bpTaskProfile,
  isBPTaskGroupProfile,
  isBPTaskProfile,
  type BPExecutionMode,
  type BPTaskDTO,
  type BPTaskGroupDTO,
  type BPTaskSpaceDTO,
  type BPTaskSpaceProfile,
  type BPTaskStatus,
  type BPTaskTreeNode,
} from 'bp-ctrl-flow-contract';

export class BPTaskProfileError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
  }
}

export function taskSpaceDefinitionFromSpec(
  spaceSpec: FlowNodeSpec,
  taskSpaceId: string,
): TaskSpaceDefinition<BPTaskSpaceProfile> {
  const tasks: TaskNodeDefinition<BPTaskSpaceProfile>[] = [];
  const relations: TaskRelation[] = [];
  const walk = (nodes: readonly FlowNodeSpec[], parentTaskId: string | null): void => {
    const sorted = [...nodes].sort((left, right) => Number(left.attrs.order ?? 0) - Number(right.attrs.order ?? 0));
    for (let index = 0; index < sorted.length; index += 1) {
      const spec = sorted[index]!;
      const taskId = requiredId(spec);
      const order = Number(spec.attrs.order ?? index);
      if (!Number.isSafeInteger(order) || order < 0) invalid(`task ${taskId} has invalid order`);
      if (spec.tag === 'Task') {
        const status = bpStatus(spec.attrs.status ?? 'NotStarted', taskId);
        assertInitialBPStatus(status, taskId);
        tasks.push({
          kind: 'task',
          taskId,
          name: String(spec.attrs.name ?? taskId),
          order,
          ...(spec.attrs.description === undefined ? {} : { description: String(spec.attrs.description) }),
          profile: bpTaskProfile({
            ownerAccount: String(spec.attrs.ownerAccount ?? ''),
            status,
          }),
          inputArtifacts: [],
        });
      } else if (spec.tag === 'TaskGroup') {
        const executionMode = bpExecutionMode(spec.attrs.executionMode ?? 'SEQUENTIAL', taskId);
        tasks.push({
          kind: 'task-group',
          taskId,
          name: String(spec.attrs.name ?? taskId),
          order,
          profile: bpTaskGroupProfile(executionMode),
          inputArtifacts: [],
          mode: executionMode.toLowerCase() as 'sequential' | 'all' | 'any',
        });
        walk(spec.children, taskId);
      } else {
        invalid(`unexpected task.space node <${spec.tag}>`);
      }
      relations.push({
        kind: 'parent-child',
        relationId: `bp:parent:${encodeURIComponent(parentTaskId ?? 'root')}:${encodeURIComponent(taskId)}`,
        parentTaskId,
        childTaskId: taskId,
        order,
      });
    }
  };
  walk(spaceSpec.children, null);
  return {
    kind: 'task-space-definition',
    taskSpaceId,
    name: String(spaceSpec.attrs.name ?? spaceSpec.id ?? taskSpaceId),
    schemaVersion: Number(spaceSpec.metadata.version ?? 1),
    tasks,
    relations,
  };
}

/** @deprecated Use `taskSpaceDefinitionFromSpec`; retained as a source migration path. */
export const taskSpaceFromSpec = taskSpaceDefinitionFromSpec;

export function legacyBPTaskSpaceToDefinition(
  legacy: BPTaskSpaceDTO,
): TaskSpaceDefinition<BPTaskSpaceProfile> {
  const tasks: TaskNodeDefinition<BPTaskSpaceProfile>[] = [];
  const relations: TaskRelation[] = [];
  const walk = (nodes: readonly BPTaskTreeNode[], parentTaskId: string | null): void => {
    for (const node of nodes) {
      if (node.kind === 'task') {
        assertInitialBPStatus(node.status, node.id);
        tasks.push({
          kind: 'task',
          taskId: node.id,
          name: node.name,
          order: node.order,
          ...(node.description === undefined ? {} : { description: node.description }),
          profile: bpTaskProfile({
            ownerAccount: node.ownerAccount,
            status: node.status,
            operatorAccount: node.operatorAccount,
            transferredBy: node.transferredBy,
            startedAtMs: node.startedAtMs,
            endedAtMs: node.endedAtMs,
            lifecycleSequence: 0,
          }),
          inputArtifacts: [],
        });
      } else {
        tasks.push({
          kind: 'task-group',
          taskId: node.id,
          name: node.name,
          order: node.order,
          mode: node.executionMode.toLowerCase() as 'sequential' | 'all' | 'any',
          profile: bpTaskGroupProfile(node.executionMode),
          inputArtifacts: [],
        });
        walk(node.children, node.id);
      }
      relations.push({
        kind: 'parent-child',
        relationId: `bp:parent:${encodeURIComponent(parentTaskId ?? 'root')}:${encodeURIComponent(node.id)}`,
        parentTaskId,
        childTaskId: node.id,
        order: node.order,
      });
    }
  };
  walk(legacy.children, null);
  return {
    kind: 'task-space-definition',
    taskSpaceId: legacy.id,
    name: legacy.name,
    schemaVersion: legacy.version,
    tasks,
    relations,
  };
}

export function bpTaskSpaceView(snapshot: TaskSpaceSnapshot): BPTaskSpaceDTO {
  const records = new Map(snapshot.tasks.map((task) => [task.taskId, task]));
  const childrenByParent = new Map<string | null, { readonly taskId: string; readonly order: number }[]>();
  for (const relation of snapshot.definition.relations) {
    if (relation.kind !== 'parent-child') continue;
    const children = childrenByParent.get(relation.parentTaskId) ?? [];
    children.push({ taskId: relation.childTaskId, order: relation.order });
    childrenByParent.set(relation.parentTaskId, children);
  }
  const project = (parentTaskId: string | null): BPTaskTreeNode[] =>
    [...(childrenByParent.get(parentTaskId) ?? [])]
      .sort((left, right) => left.order - right.order || left.taskId.localeCompare(right.taskId))
      .map(({ taskId }) => {
        const record = records.get(taskId);
        if (!record) invalid(`snapshot misses task record ${taskId}`);
        if (record.definition.kind === 'task') return bpTaskView(record);
        if (!isBPTaskGroupProfile(record.profile)) invalid(`task-group ${taskId} has no BP group profile`);
        return {
          kind: 'group',
          id: taskId,
          name: record.definition.name,
          executionMode: record.profile.facts.executionMode,
          order: record.definition.order,
          children: project(taskId),
        } satisfies BPTaskGroupDTO;
      });
  return {
    id: snapshot.taskSpaceId,
    name: snapshot.definition.name,
    version: snapshot.definition.schemaVersion,
    children: project(null),
  };
}

export function bpTaskView(record: TaskRecord): BPTaskDTO {
  if (record.definition.kind !== 'task' || !isBPTaskProfile(record.profile)) {
    invalid(`task ${record.taskId} has no BP task profile`);
  }
  const facts = record.profile.facts;
  return {
    kind: 'task',
    id: record.taskId,
    name: record.definition.name,
    ownerAccount: facts.ownerAccount,
    status: facts.status,
    order: record.definition.order,
    ...(record.definition.description === undefined ? {} : { description: record.definition.description }),
    ...(facts.operatorAccount === null ? {} : { operatorAccount: facts.operatorAccount }),
    ...(facts.transferredBy === null ? {} : { transferredBy: facts.transferredBy }),
    ...(facts.startedAtMs === null ? {} : { startedAtMs: facts.startedAtMs }),
    ...(facts.endedAtMs === null ? {} : { endedAtMs: facts.endedAtMs }),
  };
}

export function findBPNode(space: BPTaskSpaceDTO, id: string): BPTaskTreeNode | undefined {
  const walk = (nodes: readonly BPTaskTreeNode[]): BPTaskTreeNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.kind === 'group') {
        const nested = walk(node.children);
        if (nested) return nested;
      }
    }
    return undefined;
  };
  return walk(space.children);
}

export function findBPTask(space: BPTaskSpaceDTO, id: string): BPTaskDTO | undefined {
  const node = findBPNode(space, id);
  return node?.kind === 'task' ? node : undefined;
}

export function listBPTasks(space: BPTaskSpaceDTO): BPTaskDTO[] {
  const tasks: BPTaskDTO[] = [];
  const walk = (nodes: readonly BPTaskTreeNode[]): void => {
    for (const node of nodes) node.kind === 'task' ? tasks.push(node) : walk(node.children);
  };
  walk(space.children);
  return tasks;
}

export function directBPChildIds(space: BPTaskSpaceDTO): ReadonlySet<string> {
  return new Set(space.children.map(({ id }) => id));
}

export function bpTerminalStatusOf(node: BPTaskTreeNode): BPTaskStatus | undefined {
  return bpTerminalProjectionOf(node)?.status;
}

interface BPTerminalProjection {
  readonly status: BPTaskStatus;
  readonly kernelClass: 'success' | 'failure';
  readonly endedAtMs: number | undefined;
}

function bpTerminalProjectionOf(node: BPTaskTreeNode): BPTerminalProjection | undefined {
  if (node.kind === 'task') {
    if (node.status === 'Done' || node.status === 'Refused' || node.status === 'Forwarded') {
      return { status: node.status, kernelClass: 'success', endedAtMs: node.endedAtMs };
    }
    return node.status === 'Abandoned'
      ? { status: node.status, kernelClass: 'failure', endedAtMs: node.endedAtMs }
      : undefined;
  }
  const children = node.children.map(bpTerminalProjectionOf);
  if (node.executionMode === 'ANY') {
    const successful = children
      .map((projection, index) => ({ projection, index }))
      .filter((candidate): candidate is { readonly projection: BPTerminalProjection; readonly index: number } =>
        candidate.projection?.kernelClass === 'success')
      .sort((left, right) => terminalTime(left.projection) - terminalTime(right.projection)
        || left.index - right.index)[0]?.projection;
    if (successful) return successful;
    if (children.every((projection) => projection !== undefined)) {
      return {
        status: 'Refused',
        kernelClass: 'failure',
        endedAtMs: latestTerminalTime(children as readonly BPTerminalProjection[]),
      };
    }
    return undefined;
  }
  const failure = children
    .filter((projection): projection is BPTerminalProjection => projection?.kernelClass === 'failure')
    .sort((left, right) => terminalTime(left) - terminalTime(right))[0];
  if (failure) {
    return { status: 'Refused', kernelClass: 'failure', endedAtMs: failure.endedAtMs };
  }
  if (children.some((projection) => projection === undefined)) return undefined;
  const completed = children as readonly BPTerminalProjection[];
  return {
    status: completed.some(({ status }) => status === 'Refused') ? 'Refused' : 'Done',
    kernelClass: 'success',
    endedAtMs: latestTerminalTime(completed),
  };
}

function terminalTime(projection: BPTerminalProjection): number {
  return projection.endedAtMs ?? Number.NEGATIVE_INFINITY;
}

function latestTerminalTime(projections: readonly BPTerminalProjection[]): number | undefined {
  if (projections.some(({ endedAtMs }) => endedAtMs === undefined)) return undefined;
  return Math.max(...projections.map(({ endedAtMs }) => endedAtMs!));
}

function requiredId(spec: FlowNodeSpec): string {
  if (!spec.id) invalid(`<${spec.tag}> requires an id`);
  return spec.id;
}

function bpStatus(value: unknown, taskId: string): BPTaskStatus {
  if (!BP_TASK_STATUSES.includes(value as BPTaskStatus)) invalid(`task ${taskId} has invalid BP status ${String(value)}`);
  return value as BPTaskStatus;
}

function assertInitialBPStatus(status: BPTaskStatus, taskId: string): void {
  if (status !== 'NotStarted') {
    invalid(`task ${taskId} requires explicit lifecycle import events/receipts for initial status ${status}`);
  }
}

function bpExecutionMode(value: unknown, taskId: string): BPExecutionMode {
  if (!BP_EXECUTION_MODES.includes(value as BPExecutionMode)) invalid(`task-group ${taskId} has invalid executionMode ${String(value)}`);
  return value as BPExecutionMode;
}

function invalid(message: string): never {
  throw new BPTaskProfileError('bp-task-profile-invalid', message);
}
