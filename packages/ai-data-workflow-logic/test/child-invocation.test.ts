import { describe, expect, test } from 'bun:test';
import type {
  AIDataWorkflowChildInvocationIdentity,
  AIDataWorkflowRunGraph,
} from 'ai-data-workflow-contract';
import {
  acceptAIDataWorkflowChildTerminalReceipt,
  AIDataWorkflowChildInvocationError,
  createAIDataWorkflowChildInvocationIdentity,
  normalizeAIDataWorkflowChildFreezeReceipt,
  normalizeAIDataWorkflowChildInvocationIdentity,
  normalizeAIDataWorkflowChildInvocationObservation,
  normalizeAIDataWorkflowChildTerminalReceipt,
  reserveAIDataWorkflowChildInvocation,
  recordAIDataWorkflowChildFreezeReceipt,
} from 'ai-data-workflow-logic';

const identity: AIDataWorkflowChildInvocationIdentity = {
  schemaVersion: 'depa.ai-data-child-invocation/v1',
  invocationKey: 'parent-run/child/2',
  parentInstanceId: 'parent-instance',
  parentRunId: 'parent-run',
  parentNodeId: 'child',
  parentGeneration: 2,
  childInstanceId: 'parent-instance/child/2',
  childRunId: 'parent-run/child/2',
  subflow: {
    kind: 'autonomous',
    schemaVersion: 'depa.ai-data-subflow-binding/v1',
    capabilityId: 'child-capability',
    catalogDigest: 'sha256:catalog',
    definitionRef: 'resource://depa.flows.test.Child',
    flowRef: 'eager-data-flow://depa.flows.test.Child',
    contractDigest: 'sha256:contract',
  },
};

describe('AI Data child invocation boundary', () => {
  test('settles A to B to C through nested canonical RunGraphs', () => {
    const makeGraph = (
      runId: string,
      definitionRef: `resource://${string}`,
      flowRef: `eager-data-flow://${string}`,
    ): AIDataWorkflowRunGraph => ({
      runId,
      binding: {} as AIDataWorkflowRunGraph['binding'],
      currentGeneration: 0,
      nodes: {
        child: {
          id: 'child', tag: 'SubFlowNode', nodeType: 'subflow', generation: 0, status: 'Pending',
          declarationIndex: 0, inputs: {}, outputs: ['result'], config: {},
          subflow: {
            kind: 'autonomous', schemaVersion: 'depa.ai-data-subflow-binding/v1',
            capabilityId: `capability:${runId}`, catalogDigest: 'sha256:catalog',
            definitionRef, flowRef, contractDigest: `sha256:contract:${runId}`,
          },
          dependsOn: [], dependents: [], reusePolicy: { policy: 'never', source: 'node', nodeType: 'subflow' },
        },
      },
      declarationOrder: ['child'], patchHistory: [], invalidations: [],
    });
    const runChild = (
      graph: AIDataWorkflowRunGraph,
      parentInstanceId: string,
      output: string,
    ): AIDataWorkflowRunGraph => {
      const childIdentity = createAIDataWorkflowChildInvocationIdentity({ graph, parentInstanceId, nodeId: 'child' });
      const reserved = reserveAIDataWorkflowChildInvocation({ graph, identity: childIdentity });
      const frozen = recordAIDataWorkflowChildFreezeReceipt({
        graph: reserved,
        nodeId: 'child',
        receipt: {
          schemaVersion: 'depa.ai-data-child-invocation/v1', invocationKey: childIdentity.invocationKey,
          childInstanceId: childIdentity.childInstanceId, childRunId: childIdentity.childRunId,
          definitionRef: childIdentity.subflow.definitionRef, flowRef: childIdentity.subflow.flowRef,
          contractDigest: childIdentity.subflow.contractDigest,
          definitionRevision: 'r1', definitionDigest: `sha256:definition:${childIdentity.childRunId}`,
        },
      });
      return acceptAIDataWorkflowChildTerminalReceipt({
        graph: frozen,
        nodeId: 'child',
        receipt: {
          schemaVersion: 'depa.ai-data-child-invocation/v1', invocationKey: childIdentity.invocationKey,
          childInstanceId: childIdentity.childInstanceId, childRunId: childIdentity.childRunId,
          definitionRef: childIdentity.subflow.definitionRef, flowRef: childIdentity.subflow.flowRef,
          contractDigest: childIdentity.subflow.contractDigest, status: 'Succeeded',
          output: { result: output }, receiptDigest: `sha256:receipt:${childIdentity.childRunId}`,
        },
      });
    };

    const bGraph = runChild(
      makeGraph('B-run', 'resource://flow/C', 'eager-data-flow://flow.C'),
      'B-instance',
      'C-output',
    );
    const aGraph = runChild(
      makeGraph('A-run', 'resource://flow/B', 'eager-data-flow://flow.B'),
      'A-instance',
      String((bGraph.nodes.child.result?.output as { result?: unknown } | undefined)?.result),
    );
    expect(bGraph.nodes.child.childInvocation?.parentRunId).toBe('B-run');
    expect(aGraph.nodes.child.childInvocation?.parentRunId).toBe('A-run');
    expect(aGraph.nodes.child.result?.output).toEqual({ result: 'C-output' });
  });

  test('derives one deterministic identity and rejects a competing reservation', () => {
    const graph = {
      runId: identity.parentRunId,
      binding: {} as AIDataWorkflowRunGraph['binding'],
      currentGeneration: identity.parentGeneration,
      nodes: {
        child: {
          id: 'child', tag: 'SubFlowNode', nodeType: 'subflow', generation: 2, status: 'Pending',
          declarationIndex: 0, inputs: {}, outputs: ['result'], config: {}, subflow: identity.subflow,
          dependsOn: [], dependents: [], reusePolicy: { policy: 'never', source: 'node', nodeType: 'subflow' },
        },
      },
      declarationOrder: ['child'],
      patchHistory: [],
      invalidations: [],
    } satisfies AIDataWorkflowRunGraph;
    const derived = createAIDataWorkflowChildInvocationIdentity({
      graph,
      parentInstanceId: identity.parentInstanceId,
      nodeId: 'child',
    });
    expect(createAIDataWorkflowChildInvocationIdentity({
      graph,
      parentInstanceId: identity.parentInstanceId,
      nodeId: 'child',
    })).toEqual(derived);

    const reserved = reserveAIDataWorkflowChildInvocation({ graph, identity: derived });
    expect(reserved.nodes.child.status).toBe('Running');
    expect(reserveAIDataWorkflowChildInvocation({ graph: reserved, identity: derived })).toBe(reserved);
    expect(() => reserveAIDataWorkflowChildInvocation({
      graph: reserved,
      identity: { ...derived, invocationKey: 'competing-child' },
    })).toThrow('already reserved another child');
  });

  test('derives distinct child identities for two parent nodes targeting the same Flow', () => {
    const sharedNode = {
      tag: 'SubFlowNode' as const, nodeType: 'subflow' as const, generation: 1, status: 'Pending' as const,
      declarationIndex: 0, inputs: {}, outputs: ['result'], config: {}, subflow: identity.subflow,
      dependsOn: [] as string[], dependents: [] as string[],
      reusePolicy: { policy: 'never' as const, source: 'node' as const, nodeType: 'subflow' as const },
    };
    const graph = {
      runId: 'shared-flow-parent', binding: {} as AIDataWorkflowRunGraph['binding'], currentGeneration: 1,
      nodes: {
        first: { ...sharedNode, id: 'first' },
        second: { ...sharedNode, id: 'second', declarationIndex: 1 },
      },
      declarationOrder: ['first', 'second'], patchHistory: [], invalidations: [],
    } satisfies AIDataWorkflowRunGraph;
    const first = createAIDataWorkflowChildInvocationIdentity({ graph, parentInstanceId: 'parent', nodeId: 'first' });
    const second = createAIDataWorkflowChildInvocationIdentity({ graph, parentInstanceId: 'parent', nodeId: 'second' });
    expect(first.invocationKey).not.toBe(second.invocationKey);
    expect(first.childRunId).not.toBe(second.childRunId);
  });

  test('normalizes one exact resolve, observe and settle lifecycle', () => {
    const reserved = normalizeAIDataWorkflowChildInvocationIdentity(identity);
    const freeze = normalizeAIDataWorkflowChildFreezeReceipt({
      schemaVersion: 'depa.ai-data-child-invocation/v1',
      invocationKey: reserved.invocationKey,
      childInstanceId: reserved.childInstanceId,
      childRunId: reserved.childRunId,
      definitionRef: reserved.subflow.definitionRef,
      flowRef: reserved.subflow.flowRef,
      contractDigest: reserved.subflow.contractDigest,
      definitionRevision: 'child-r1',
      definitionDigest: 'sha256:child-definition',
    }, reserved);
    const observation = normalizeAIDataWorkflowChildInvocationObservation({
      schemaVersion: 'depa.ai-data-child-invocation/v1',
      invocationKey: reserved.invocationKey,
      childInstanceId: reserved.childInstanceId,
      childRunId: reserved.childRunId,
      status: 'Succeeded',
    }, reserved);
    const receipt = normalizeAIDataWorkflowChildTerminalReceipt({
      schemaVersion: 'depa.ai-data-child-invocation/v1',
      invocationKey: reserved.invocationKey,
      childInstanceId: reserved.childInstanceId,
      childRunId: reserved.childRunId,
      definitionRef: reserved.subflow.definitionRef,
      flowRef: reserved.subflow.flowRef,
      contractDigest: reserved.subflow.contractDigest,
      status: observation.status,
      output: { result: 'ok' },
      receiptDigest: 'sha256:child-receipt',
    }, reserved);

    expect(freeze.definitionRevision).toBe('child-r1');
    expect(receipt).toEqual(expect.objectContaining({ status: 'Succeeded', output: { result: 'ok' } }));
    expect(Object.isFrozen(reserved)).toBe(true);
  });

  test('accepts one exact frozen terminal receipt as the parent result', () => {
    const graph = {
      runId: identity.parentRunId,
      binding: {} as AIDataWorkflowRunGraph['binding'],
      currentGeneration: identity.parentGeneration,
      nodes: {
        child: {
          id: 'child', tag: 'SubFlowNode', nodeType: 'subflow', generation: 2, status: 'Running',
          declarationIndex: 0, inputs: {}, outputs: ['result'], config: {}, subflow: identity.subflow,
          childInvocation: identity,
          dependsOn: [], dependents: [], reusePolicy: { policy: 'never', source: 'node', nodeType: 'subflow' },
        },
      },
      declarationOrder: ['child'],
      patchHistory: [],
      invalidations: [],
    } satisfies AIDataWorkflowRunGraph;
    const freeze = {
      schemaVersion: 'depa.ai-data-child-invocation/v1' as const,
      invocationKey: identity.invocationKey,
      childInstanceId: identity.childInstanceId,
      childRunId: identity.childRunId,
      definitionRef: identity.subflow.definitionRef,
      flowRef: identity.subflow.flowRef,
      contractDigest: identity.subflow.contractDigest,
      definitionRevision: 'child-r1',
      definitionDigest: 'sha256:child-definition',
    };
    const frozen = recordAIDataWorkflowChildFreezeReceipt({ graph, nodeId: 'child', receipt: freeze });
    const receipt = {
      schemaVersion: 'depa.ai-data-child-invocation/v1' as const,
      invocationKey: identity.invocationKey,
      childInstanceId: identity.childInstanceId,
      childRunId: identity.childRunId,
      definitionRef: identity.subflow.definitionRef,
      flowRef: identity.subflow.flowRef,
      contractDigest: identity.subflow.contractDigest,
      status: 'Succeeded' as const,
      output: { result: 'accepted' },
      receiptDigest: 'sha256:accepted-receipt',
    };
    const accepted = acceptAIDataWorkflowChildTerminalReceipt({ graph: frozen, nodeId: 'child', receipt });
    expect(accepted.nodes.child.result?.output).toEqual({ result: 'accepted' });
    expect(accepted.nodes.child.childTerminalReceipt).toEqual(receipt);
    expect(acceptAIDataWorkflowChildTerminalReceipt({ graph: accepted, nodeId: 'child', receipt })).toBe(accepted);

    expect(() => acceptAIDataWorkflowChildTerminalReceipt({
      graph: frozen,
      nodeId: 'child',
      receipt: { ...receipt, output: { another: 'port' } },
    })).toThrow('does not match its FlowContract');
  });

  test('rejects a receipt for another child or non-terminal status', () => {
    expect(() => normalizeAIDataWorkflowChildTerminalReceipt({
      schemaVersion: 'depa.ai-data-child-invocation/v1',
      invocationKey: identity.invocationKey,
      childInstanceId: identity.childInstanceId,
      childRunId: 'another-child-run',
      definitionRef: identity.subflow.definitionRef,
      flowRef: identity.subflow.flowRef,
      contractDigest: identity.subflow.contractDigest,
      status: 'Succeeded',
      output: { result: 'forged' },
      receiptDigest: 'sha256:forged',
    }, identity)).toThrow(AIDataWorkflowChildInvocationError);

    expect(() => normalizeAIDataWorkflowChildTerminalReceipt({
      schemaVersion: 'depa.ai-data-child-invocation/v1',
      invocationKey: identity.invocationKey,
      childInstanceId: identity.childInstanceId,
      childRunId: identity.childRunId,
      definitionRef: identity.subflow.definitionRef,
      flowRef: identity.subflow.flowRef,
      contractDigest: identity.subflow.contractDigest,
      status: 'Running',
      receiptDigest: 'sha256:not-terminal',
    }, identity)).toThrow('status must be terminal');
  });

  test('rejects undeclared lifecycle fields before a host operation can run', () => {
    expect(() => normalizeAIDataWorkflowChildInvocationIdentity({
      ...identity,
      hostPath: '/tmp/child',
    })).toThrow('fields are invalid');
  });
});
