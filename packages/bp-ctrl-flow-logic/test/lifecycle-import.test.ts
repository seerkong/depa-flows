import { describe, expect, test } from 'bun:test';
import type { BPTaskSpaceDTO } from 'bp-ctrl-flow-contract';
import { loadFlowBundleFromSources } from 'instant-ctrl-flow-logic';
import {
  legacyBPTaskSpaceToDefinition,
  taskSpaceDefinitionFromSpec,
} from '../src/taskSpace.js';

describe('BP lifecycle import authority', () => {
  test('fails closed on non-NotStarted legacy facts without an explicit import event protocol', () => {
    const legacy: BPTaskSpaceDTO = {
      id: 'legacy-active',
      name: 'Legacy active',
      version: 1,
      children: [{
        kind: 'task', id: 'approve', name: 'Approve', ownerAccount: 'user:a',
        status: 'Delegated', order: 0,
      }],
    };
    expect(() => legacyBPTaskSpaceToDefinition(legacy)).toThrow(/explicit lifecycle import/i);
  });

  test('fails closed on authored non-NotStarted BP specs', () => {
    const loaded = loadFlowBundleFromSources({
      'manifest.xnl': `<BPCtrlFlow #test.Import apiVersion="depa.flows/v1" version="1" (
        <TaskSpace #test.Import [
          <Task #approve { name = "Approve" ownerAccount = "user:a" status = "Active" order = 0 }>
        ]>
      ) [<TaskStep #step { task = "task-space://#approve" }>]>`,
    });
    expect(() => taskSpaceDefinitionFromSpec(loaded.spec!.taskSpace!, 'authored-active'))
      .toThrow(/explicit lifecycle import/i);
  });
});
