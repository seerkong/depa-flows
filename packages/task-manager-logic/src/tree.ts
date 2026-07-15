/**
 * 任务树查找与组聚合（executionMode 语义，BP-2/BP-4）。
 */
import type { ExecutionMode, TaskDTO, TaskGroupDTO, TaskSpaceDTO, TaskStatus, TaskTreeNode } from 'task-manager-contract';
import { isTerminal } from './statusMachine.js';

export function findNode(space: TaskSpaceDTO, id: string): TaskTreeNode | undefined {
  const walk = (nodes: TaskTreeNode[]): TaskTreeNode | undefined => {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.kind === 'group') {
        const hit = walk(n.children);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return walk(space.children);
}

export function findTask(space: TaskSpaceDTO, id: string): TaskDTO | undefined {
  const n = findNode(space, id);
  return n?.kind === 'task' ? n : undefined;
}

export function listTasks(space: TaskSpaceDTO): TaskDTO[] {
  const out: TaskDTO[] = [];
  const walk = (nodes: TaskTreeNode[]) => {
    for (const n of nodes) (n.kind === 'task' ? out.push(n) : walk(n.children));
  };
  walk(space.children);
  return out;
}

/** 直接子节点 id 集合（TaskStep 只能绑定它们，BP-2） */
export function directChildIds(space: TaskSpaceDTO): Set<string> {
  return new Set(space.children.map((c) => c.id));
}

/**
 * 节点终态判定：Task 用自身状态；Group 按 executionMode 聚合。
 * 返回 undefined 表示尚未终态。
 * - SEQUENTIAL / ALL：全部子节点终态才终态；全 DONE（FORWARDED 视同 DONE）→ DONE，否则 REFUSED。
 * - ANY：任一 DONE/FORWARDED → DONE；全部终态且无 DONE → REFUSED。
 */
export function terminalStatusOf(node: TaskTreeNode): TaskStatus | undefined {
  if (node.kind === 'task') return isTerminal(node.status) ? node.status : undefined;
  return aggregateGroup(node);
}

const doneLike = (s: TaskStatus) => s === 'Done' || s === 'Forwarded';

function aggregateGroup(group: TaskGroupDTO): TaskStatus | undefined {
  const childStatuses = group.children.map((c) => terminalStatusOf(c));
  const mode: ExecutionMode = group.executionMode;
  if (mode === 'ANY') {
    if (childStatuses.some((s) => s !== undefined && doneLike(s))) return 'Done';
    if (childStatuses.every((s) => s !== undefined)) return 'Refused';
    return undefined;
  }
  // SEQUENTIAL / ALL
  if (childStatuses.some((s) => s === undefined)) {
    // 提前失败：任一 REFUSED/ABANDONED 即整体 REFUSED（不必等其余）
    if (childStatuses.some((s) => s !== undefined && !doneLike(s))) return 'Refused';
    return undefined;
  }
  return childStatuses.every((s) => doneLike(s!)) ? 'Done' : 'Refused';
}

/** SEQUENTIAL 组内可操作性：前序兄弟（按 order）必须 done-like */
export function isOperable(space: TaskSpaceDTO, taskId: string): boolean {
  const check = (nodes: TaskTreeNode[], mode: ExecutionMode | null): boolean => {
    const sorted = [...nodes].sort((a, b) => a.order - b.order);
    for (let i = 0; i < sorted.length; i++) {
      const n = sorted[i];
      if (n.id === taskId || (n.kind === 'group' && findInGroup(n, taskId))) {
        if (mode === 'SEQUENTIAL') {
          for (let j = 0; j < i; j++) {
            const prev = terminalStatusOf(sorted[j]);
            if (prev === undefined || !doneLike(prev)) return false;
          }
        }
        return n.id === taskId ? true : check((n as TaskGroupDTO).children, (n as TaskGroupDTO).executionMode);
      }
    }
    return false;
  };
  const findInGroup = (g: TaskGroupDTO, id: string): boolean => !!findNodeIn(g.children, id);
  const findNodeIn = (nodes: TaskTreeNode[], id: string): TaskTreeNode | undefined => {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.kind === 'group') {
        const hit = findNodeIn(n.children, id);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return check(space.children, null);
}
