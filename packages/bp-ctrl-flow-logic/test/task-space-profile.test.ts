import { describe, expect, it } from 'bun:test';
import type { BPTaskSpaceDTO } from 'bp-ctrl-flow-contract';
import { createTaskSpace, InMemoryTaskSpaceOwner } from 'task-manager-logic';
import {
  bpTaskSpaceView,
  legacyBPTaskSpaceToDefinition,
  taskSpaceFromSpec,
} from '../src/taskSpace.js';

const legacy: BPTaskSpaceDTO = {
  id: 'legacy-space',
  name: 'Legacy BP tasks',
  version: 7,
  children: [
    {
      kind: 'group',
      id: 'review',
      name: 'Review',
      executionMode: 'SEQUENTIAL',
      order: 0,
      children: [
        {
          kind: 'task',
          id: 'manager',
          name: 'Manager review',
          ownerAccount: 'user:manager',
          status: 'NotStarted',
          order: 0,
        },
        {
          kind: 'task',
          id: 'finance',
          name: 'Finance review',
          ownerAccount: 'user:finance',
          status: 'NotStarted',
          order: 1,
        },
      ],
    },
  ],
};

describe('BP profile projection over TaskSpace kernel', () => {
  it('migrates a legacy BP tree without adding BP fields to kernel records', async () => {
    const definition = legacyBPTaskSpaceToDefinition(legacy);
    expect(definition.relations.filter(({ kind }) => kind === 'dependency')).toEqual([]);

    const owner = new InMemoryTaskSpaceOwner();
    const created = await createTaskSpace({ owner }, {
      kind: 'task-space.create',
      commandId: 'legacy-create',
      taskSpaceId: definition.taskSpaceId,
      definition,
      createdAt: '2026-08-24T00:00:00.000Z',
    }, {});

    const manager = created.snapshot.tasks.find(({ taskId }) => taskId === 'manager')!;
    const finance = created.snapshot.tasks.find(({ taskId }) => taskId === 'finance')!;
    expect(manager).not.toHaveProperty('ownerAccount');
    expect(manager).not.toHaveProperty('operatorAccount');
    expect(manager).not.toHaveProperty('transferredBy');
    expect(manager.status).toBe('Ready');
    expect(finance.status).toBe('Pending');
    expect(finance.profile).toMatchObject({
      profileKind: 'depa.bp.task',
      facts: {
        status: 'NotStarted',
        ownerAccount: 'user:finance',
        operatorAccount: null,
        transferredBy: null,
      },
    });
    expect(bpTaskSpaceView(created.snapshot)).toEqual(legacy);
  });

  it('keeps the prior taskSpaceFromSpec export as an explicit source migration alias', () => {
    expect(taskSpaceFromSpec).toBeFunction();
    expect(taskSpaceFromSpec.name).toBe('taskSpaceDefinitionFromSpec');
  });
});
