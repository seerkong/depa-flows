import { describe, expect, test } from 'bun:test';
import { TASK_STATUSES } from 'task-manager-contract';
import { TASK_TRANSITIONS, TaskManagerError, assertTaskTransition, canTransition, isTerminal } from '../src/index.js';

describe('neutral TaskSpace state machine', () => {
  test('contains one closed transition table entry for every kernel status', () => {
    expect(Object.keys(TASK_TRANSITIONS)).toEqual([...TASK_STATUSES]);
    expect(canTransition('Pending', 'Ready')).toBe(true);
    expect(canTransition('Ready', 'Claimed')).toBe(true);
    expect(canTransition('Claimed', 'Running')).toBe(true);
    expect(canTransition('Running', 'Waiting')).toBe(true);
    expect(canTransition('Waiting', 'Succeeded')).toBe(true);
  });

  test('keeps all terminal facts immutable', () => {
    for (const status of ['Succeeded', 'Failed', 'Cancelled'] as const) {
      expect(isTerminal(status)).toBe(true);
      expect(() => assertTaskTransition('task-1', status, 'Ready')).toThrow(TaskManagerError);
      expect(TASK_TRANSITIONS[status]).toEqual([]);
    }
  });
});
