/**
 * bundle task.space 域（FlowNodeSpec 投影）→ TaskSpaceDTO（制品内 status 是初始状态，M-D4 同理）。
 */
import type { FlowNodeSpec } from 'instant-ctrl-flow-contract';
import type { TaskDTO, TaskGroupDTO, TaskSpaceDTO, TaskStatus, TaskTreeNode, ExecutionMode } from 'task-manager-contract';

function toNode(spec: FlowNodeSpec): TaskTreeNode {
  if (spec.tag === 'Task') {
    const t: TaskDTO = {
      kind: 'task',
      id: spec.id ?? '',
      name: String(spec.attrs.name ?? spec.id ?? ''),
      ownerAccount: String(spec.attrs.ownerAccount ?? ''),
      status: (spec.attrs.status as TaskStatus) ?? 'NotStarted',
      order: Number(spec.attrs.order ?? 0),
      description: spec.attrs.description as string | undefined,
    };
    return t;
  }
  if (spec.tag === 'TaskGroup') {
    const g: TaskGroupDTO = {
      kind: 'group',
      id: spec.id ?? '',
      name: String(spec.attrs.name ?? spec.id ?? ''),
      executionMode: (spec.attrs.executionMode as ExecutionMode) ?? 'SEQUENTIAL',
      order: Number(spec.attrs.order ?? 0),
      children: spec.children.map(toNode),
    };
    return g;
  }
  throw new Error(`unexpected task.space node <${spec.tag}>`);
}

export function taskSpaceFromSpec(spaceSpec: FlowNodeSpec, spaceId: string): TaskSpaceDTO {
  return {
    id: spaceId,
    name: String(spaceSpec.attrs.name ?? spaceSpec.id ?? ''),
    version: Number(spaceSpec.metadata.version ?? 1),
    children: spaceSpec.children.map(toNode),
  };
}
