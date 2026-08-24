import { describe, expect, it } from 'bun:test';
import {
  BP_TASK_STATUSES,
  bpTaskProfile,
  kernelStatusForBPStatus,
  taskStepResultOf,
} from '../src/index.js';

describe('TaskStepResult', () => {
  it('projects every business terminal status to ordinary result data', () => {
    expect(taskStepResultOf('approve', 'Done')).toEqual({
      taskId: 'approve',
      status: 'Done',
      outcome: 'approved',
    });
    expect(taskStepResultOf('approve', 'Refused')).toMatchObject({ outcome: 'refused' });
    expect(taskStepResultOf('approve', 'Forwarded')).toMatchObject({ outcome: 'forwarded' });
    expect(taskStepResultOf('approve', 'Abandoned', { reason: 'cancelled' })).toEqual({
      taskId: 'approve',
      status: 'Abandoned',
      outcome: 'abandoned',
      payload: { reason: 'cancelled' },
    });
  });

  it('retains BP vocabulary in a closed profile while projecting canonical kernel status', () => {
    expect(BP_TASK_STATUSES).toEqual([
      'NotStarted', 'Active', 'Delegated', 'Forwarded', 'Done', 'Refused', 'Abandoned',
    ]);
    expect(kernelStatusForBPStatus('NotStarted', false)).toBe('Ready');
    expect(kernelStatusForBPStatus('NotStarted', true)).toBe('Pending');
    expect(kernelStatusForBPStatus('Active', false)).toBe('Running');
    expect(kernelStatusForBPStatus('Delegated', false)).toBe('Waiting');
    expect(kernelStatusForBPStatus('Done', false)).toBe('Succeeded');
    expect(kernelStatusForBPStatus('Refused', false)).toBe('Succeeded');
    expect(kernelStatusForBPStatus('Forwarded', false)).toBe('Succeeded');
    expect(kernelStatusForBPStatus('Abandoned', false)).toBe('Cancelled');

    expect(bpTaskProfile({ ownerAccount: 'user:reviewer', status: 'Refused' })).toEqual({
      kind: 'task-profile',
      profileKind: 'depa.bp.task',
      schemaVersion: 1,
      facts: {
        ownerAccount: 'user:reviewer',
        status: 'Refused',
        operatorAccount: null,
        transferredBy: null,
        startedAtMs: null,
        endedAtMs: null,
        lifecycleSequence: 0,
      },
    });
  });
});
