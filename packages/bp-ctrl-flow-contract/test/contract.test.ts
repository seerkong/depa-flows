import { describe, expect, it } from 'bun:test';
import { taskStepResultOf } from '../src/index.js';

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
});
