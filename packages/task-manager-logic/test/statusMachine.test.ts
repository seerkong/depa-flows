import { describe, it, expect } from 'bun:test';
import { applyOperation, canTransition, TaskTransitionError } from '../src/statusMachine.js';
import { terminalStatusOf } from '../src/tree.js';
import type { TaskDTO, TaskGroupDTO } from 'task-manager-contract';

const task = (status: TaskDTO['status'], id = 't1'): TaskDTO => ({
  kind: 'task', id, name: id, ownerAccount: 'user:a', status, order: 0,
});

describe('任务状态机', () => {
  it('合法转移表', () => {
    expect(canTransition('NotStarted', 'Active')).toBe(true);
    expect(canTransition('Active', 'Done')).toBe(true);
    expect(canTransition('Active', 'Delegated')).toBe(true);
    expect(canTransition('Delegated', 'Active')).toBe(true);
    expect(canTransition('Active', 'NotStarted')).toBe(true);
  });

  it('终态不可再转移', () => {
    for (const s of ['Done', 'Refused', 'Forwarded', 'Abandoned'] as const) {
      expect(canTransition(s, 'Active')).toBe(false);
      expect(() => applyOperation(task(s), 'start', 'user:x', 1)).toThrow(TaskTransitionError);
    }
  });

  it('NOT_STARTED 不能直接 DONE', () => {
    expect(() => applyOperation(task('NotStarted'), 'complete', 'user:x', 1)).toThrow(TaskTransitionError);
  });

  it('时间戳语义：ACTIVE 记 startedAt，终态记 endedAt', () => {
    const t = task('NotStarted');
    applyOperation(t, 'start', 'user:m', 100);
    expect(t.startedAtMs).toBe(100);
    applyOperation(t, 'complete', 'user:m', 200);
    expect(t.endedAtMs).toBe(200);
    expect(t.operatorAccount).toBe('user:m');
  });

  it('委派链：ACTIVE → DELEGATED → ACTIVE → DONE', () => {
    const t = task('NotStarted');
    applyOperation(t, 'start', 'user:m', 1);
    applyOperation(t, 'delegate', 'user:m', 2);
    expect(t.status).toBe('Delegated');
    expect(t.transferredBy).toBe('user:m');
    applyOperation(t, 'reactivate', 'user:d', 3);
    applyOperation(t, 'complete', 'user:d', 4);
    expect(t.status).toBe('Done');
  });
});

describe('组聚合（executionMode）', () => {
  const group = (mode: TaskGroupDTO['executionMode'], ...statuses: TaskDTO['status'][]): TaskGroupDTO => ({
    kind: 'group', id: 'g', name: 'g', executionMode: mode, order: 0,
    children: statuses.map((s, i) => ({ ...task(s, `t${i}`), order: i })),
  });

  it('SEQUENTIAL/ALL：全 DONE → DONE；任一 REFUSED 提前 → REFUSED；未全终态 → 未收敛', () => {
    expect(terminalStatusOf(group('SEQUENTIAL', 'Done', 'Done'))).toBe('Done');
    expect(terminalStatusOf(group('ALL', 'Done', 'Refused'))).toBe('Refused');
    expect(terminalStatusOf(group('SEQUENTIAL', 'Done', 'Refused', 'NotStarted'))).toBe('Refused');
    expect(terminalStatusOf(group('SEQUENTIAL', 'Done', 'Active'))).toBeUndefined();
  });

  it('ANY：任一 DONE → DONE；全部失败终态 → REFUSED', () => {
    expect(terminalStatusOf(group('ANY', 'Refused', 'Done'))).toBe('Done');
    expect(terminalStatusOf(group('ANY', 'Refused', 'Abandoned'))).toBe('Refused');
    expect(terminalStatusOf(group('ANY', 'Refused', 'Active'))).toBeUndefined();
  });

  it('FORWARDED 视同 DONE', () => {
    expect(terminalStatusOf(group('ALL', 'Forwarded', 'Done'))).toBe('Done');
  });
});
