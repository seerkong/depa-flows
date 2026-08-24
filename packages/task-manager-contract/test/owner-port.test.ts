import { describe, expect, test } from 'bun:test';
import {
  TASK_SPACE_COMMIT_RESULT_KINDS,
  type TaskArtifactBody,
  type TaskCommandId,
  type TaskCommandReceipt,
  type TaskHistoryEvent,
  type TaskSpaceCommit,
  type TaskSpaceCommitResult,
  type TaskSpaceId,
  type TaskSpaceOwnerPort,
  type TaskSpaceSnapshot,
} from '../src/index.js';

class ContractOnlyOwner implements TaskSpaceOwnerPort {
  readSnapshot(_taskSpaceId: TaskSpaceId): Promise<TaskSpaceSnapshot | undefined> {
    return Promise.resolve(undefined);
  }

  readReceiptByCommand(
    _taskSpaceId: TaskSpaceId,
    _commandId: TaskCommandId,
  ): Promise<TaskCommandReceipt | undefined> {
    return Promise.resolve(undefined);
  }

  readHistory(_taskSpaceId: TaskSpaceId): Promise<readonly TaskHistoryEvent[]> {
    return Promise.resolve([]);
  }

  readArtifact(_taskSpaceId: TaskSpaceId, _digest: `sha256:${string}`): Promise<TaskArtifactBody | undefined> {
    return Promise.resolve(undefined);
  }

  compareAndSwap(_commit: TaskSpaceCommit): Promise<TaskSpaceCommitResult> {
    return Promise.resolve({
      kind: 'revision-conflict',
      taskSpaceId: 'space-1',
      expectedRevision: 1,
      actualRevision: 2,
    });
  }
}

describe('backend-neutral TaskSpace owner port', () => {
  test('closes accepted, replayed and conflict CAS outcomes', async () => {
    expect(TASK_SPACE_COMMIT_RESULT_KINDS).toEqual([
      'commit-accepted',
      'command-replayed',
      'revision-conflict',
    ]);
    const result = await new ContractOnlyOwner().compareAndSwap({} as TaskSpaceCommit);
    expect(result.kind).toBe('revision-conflict');
  });
});
