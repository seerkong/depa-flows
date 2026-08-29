import { describe, expect, test } from 'bun:test';
import type {
  AIDataControlAdmission,
  AIDataControlBudget,
  AIDataControlCapabilityCatalog,
  AIDataControlDecision,
  AIDataControlGoal,
  AIDataControlIterationReceipt,
  AIDataControlObservation,
  AIDataControlVerifierFact,
} from 'ai-data-workflow-contract';
import { AI_DATA_CONTROL_SCHEMA_VERSION } from 'ai-data-workflow-contract';
import type { EagerDataFlowAuthoringPlan } from 'eager-data-flow-contract';
import {
  admitAIDataControlDecision,
  AIDataControlProtocolError,
  applyAIDataWorkflowGraphPatch,
  createAIDataControlRuntime,
  createAIDataWorkflowRunGraph,
  defineEagerBackedAIDataWorkflow,
  freezeAIDataControlCapabilityCatalog,
  normalizeAIDataControlDecision,
  projectAIDataControlObservation,
  recordAIDataWorkflowNodeResult,
} from 'ai-data-workflow-logic';

const goal: AIDataControlGoal = {
  schemaVersion: 'depa.ai-data-control/v1',
  goalId: 'goal-1',
  objective: 'Produce a verified normalized result.',
  verifierRef: 'resource://tests/verifier',
  requiredOutputSchemaRef: 'schema://tests/result/v1',
};

const budget: AIDataControlBudget = {
  schemaVersion: 'depa.ai-data-control/v1',
  limits: {
    maxIterations: 6,
    maxOperationsPerDecision: 3,
    maxNoProgressIterations: 2,
    maxTokens: 20_000,
    deadlineEpochMs: 2_000,
  },
  usage: {
    iteration: 1,
    noProgressIterations: 0,
    tokensUsed: 1_200,
    nowEpochMs: 1_000,
  },
};

const catalog: AIDataControlCapabilityCatalog = {
  schemaVersion: 'depa.ai-data-control/v1',
  catalogId: 'catalog-1',
  digest: 'digest:catalog-1',
  foundationNodes: {
    entry: {
      protected: true,
      inputSchemaRefs: {},
      outputSchemaRefs: { material: 'schema://tests/material/v1' },
    },
  },
  capabilities: {
    normalize: {
      capabilityId: 'normalize',
      tag: 'TransformNode',
      nodeType: 'data',
      inputSchemaRefs: { material: 'schema://tests/material/v1' },
      outputSchemaRefs: { result: 'schema://tests/result/v1' },
      fixedConfig: { mode: 'strict' },
      implementation: {
        kind: 'code',
        codeRef: 'resource://tests/code/normalize',
      },
    },
    inspect: {
      capabilityId: 'inspect',
      tag: 'TransformNode',
      nodeType: 'agent',
      inputSchemaRefs: { material: 'schema://tests/material/v1' },
      outputSchemaRefs: { report: 'schema://tests/report/v1' },
      fixedConfig: {},
      implementation: {
        kind: 'agent',
        agentDefinitionRef: 'resource://tests/agent/worker',
        taskProofRef: 'resource://tests/proofs/worker',
      },
    },
    consumeResult: {
      capabilityId: 'consumeResult',
      tag: 'TransformNode',
      nodeType: 'data',
      inputSchemaRefs: { result: 'schema://tests/result/v1' },
      outputSchemaRefs: { report: 'schema://tests/report/v1' },
      fixedConfig: {},
      implementation: {
        kind: 'code',
        codeRef: 'resource://tests/code/consume-result',
      },
    },
    normalizeAlternate: {
      capabilityId: 'normalizeAlternate',
      tag: 'TransformNode',
      nodeType: 'data',
      inputSchemaRefs: { material: 'schema://tests/material/v1' },
      outputSchemaRefs: { alternate: 'schema://tests/alternate/v1' },
      fixedConfig: {},
      implementation: {
        kind: 'code',
        codeRef: 'resource://tests/code/normalize-alternate',
      },
    },
  },
};

const verifier: AIDataControlVerifierFact = {
  schemaVersion: 'depa.ai-data-control/v1',
  factId: 'verify-1',
  goalId: 'goal-1',
  graphGeneration: 0,
  status: 'not-run',
  verifierRef: 'resource://tests/verifier',
  requiredOutputSchemaRef: 'schema://tests/result/v1',
  diagnostics: [],
};

const observation: AIDataControlObservation = {
  schemaVersion: 'depa.ai-data-control/v1',
  observationId: 'observation-1',
  observationDigest: 'digest:observation-1',
  goalId: goal.goalId,
  catalogDigest: catalog.digest,
  graph: {
    runId: 'run-1',
    generation: 0,
    digest: 'digest:graph-1',
    nodes: [{
      nodeId: 'entry',
      tag: 'EntryNode',
      nodeType: 'data',
      status: 'Succeeded',
      protected: true,
      dependsOn: [],
      inputSchemaRefs: {},
      outputSchemaRefs: { material: 'schema://tests/material/v1' },
    }],
  },
  verifier,
  budget: {
    iteration: 1,
    remainingIterations: 5,
    remainingOperations: 3,
    noProgressIterations: 0,
    remainingNoProgressIterations: 2,
    remainingTokens: 18_800,
    remainingMs: 1_000,
  },
  feedback: [],
};

const decision: AIDataControlDecision = {
  schemaVersion: 'depa.ai-data-control/v1',
  kind: 'revise',
  decisionId: 'decision-1',
  goalId: goal.goalId,
  observationId: observation.observationId,
  observationDigest: observation.observationDigest,
  catalogDigest: catalog.digest,
  reason: 'Add the missing normalization step.',
  operations: [{
    op: 'add-capability',
    nodeId: 'normalize-1',
    capabilityId: 'normalize',
    inputs: {
      material: {
        kind: 'port',
        nodeId: 'entry',
        port: 'material',
        schemaRef: 'schema://tests/material/v1',
      },
    },
  }],
};

const admission: AIDataControlAdmission = {
  schemaVersion: 'depa.ai-data-control/v1',
  kind: 'patch',
  decisionId: decision.decisionId,
  decisionDigest: 'digest:decision-1',
  patch: {
    patchId: 'control:decision-1',
    generation: 1,
    reason: decision.reason,
    operations: [],
  },
};

const receipt: AIDataControlIterationReceipt = {
  schemaVersion: 'depa.ai-data-control/v1',
  iteration: 1,
  observationId: observation.observationId,
  observationDigest: observation.observationDigest,
  decisionId: decision.decisionId,
  decisionDigest: admission.decisionDigest,
  admissionKind: admission.kind,
  generationBefore: 0,
  generationAfter: 1,
};

describe('AI Data cybernetic control contracts', () => {
  test('closes provider-neutral goal, catalog, observation, decision and receipt facts', () => {
    expect(AI_DATA_CONTROL_SCHEMA_VERSION).toBe('depa.ai-data-control/v1');
    expect(catalog.capabilities.normalize.implementation.kind).toBe('code');
    expect(catalog.capabilities.inspect.implementation.kind).toBe('agent');
    expect(decision.operations[0]).toMatchObject({ capabilityId: 'normalize' });
    expect(receipt).toMatchObject({ admissionKind: 'patch', generationAfter: 1 });
  });

  test('round-trips without provider objects, functions or host services', () => {
    const protocolFacts = { goal, budget, catalog, observation, decision, admission, receipt };
    const encoded = JSON.stringify(protocolFacts);
    expect(JSON.parse(encoded)).toEqual(protocolFacts);
    expect(encoded).not.toContain('provider');
    expect(encoded).not.toContain('function');
    expect(encoded).not.toContain('checkpointRuntime');
  });

  test('keeps executable references out of controller-authored operations', () => {
    const invalidDecision: AIDataControlDecision = {
      ...decision,
      operations: [{
        op: 'add-capability',
        nodeId: 'illegal',
        capabilityId: 'normalize',
        inputs: {},
        // @ts-expect-error executable refs belong to the frozen catalog, not the decision
        codeRef: 'resource://controller-authored/code',
      }],
    };
    expect(invalidDecision.kind).toBe('revise');
  });
});

const controlPlan: EagerDataFlowAuthoringPlan = {
  form: 'EagerDataFlow',
  fqn: 'depa.flows.test.CyberneticControl',
  apiVersion: 'depa.flows/v1',
  version: '1',
  sourceNames: ['control.xnl'],
  contract: {
    id: 'depa.flows.test.CyberneticControl',
    inputPorts: ['material'],
    outputPorts: ['output'],
  },
  nodes: [
    {
      tag: 'EntryNode',
      id: 'entry',
      declarationIndex: 0,
      waitFor: [],
      outputs: ['material'],
    },
    {
      tag: 'ReturnNode',
      id: 'return',
      declarationIndex: 1,
      waitFor: [],
      inputs: {},
    },
  ],
  nodeById: {},
  declarationOrder: ['entry', 'return'],
  dataEdges: [],
  waitForEdges: [],
  subflowEdges: [],
  diagnostics: [],
};
controlPlan.nodeById = Object.fromEntries(controlPlan.nodes.map((node) => [node.id, node]));

const controlBinding = defineEagerBackedAIDataWorkflow(controlPlan);
const controlRuntime = createAIDataControlRuntime();
const frozenCatalog = freezeAIDataControlCapabilityCatalog(controlRuntime, {
  schemaVersion: AI_DATA_CONTROL_SCHEMA_VERSION,
  catalogId: 'catalog-1',
  foundationNodes: catalog.foundationNodes,
  capabilities: catalog.capabilities,
}, {});

function verifierFor(generation: number, status: 'not-run' | 'passed' | 'failed' = 'not-run'): AIDataControlVerifierFact {
  return {
    ...verifier,
    factId: `verify-${generation}-${status}`,
    graphGeneration: generation,
    status,
  };
}

function observe(
  graph: ReturnType<typeof createAIDataWorkflowRunGraph>,
  options: {
    readonly verifier?: AIDataControlVerifierFact;
    readonly budget?: AIDataControlBudget;
    readonly feedback?: AIDataControlObservation['feedback'];
  } = {},
): AIDataControlObservation {
  return projectAIDataControlObservation(controlRuntime, {
    goal,
    budget: options.budget ?? budget,
    catalog: frozenCatalog,
    graph,
    verifier: options.verifier ?? verifierFor(graph.currentGeneration),
    feedback: options.feedback ?? [],
  }, { maxObservedNodes: 20 });
}

function reviseDecision(
  current: AIDataControlObservation,
  decisionId: string,
  operation: Extract<AIDataControlDecision, { kind: 'revise' }>['operations'][number],
): AIDataControlDecision {
  return {
    schemaVersion: AI_DATA_CONTROL_SCHEMA_VERSION,
    kind: 'revise',
    decisionId,
    goalId: goal.goalId,
    observationId: current.observationId,
    observationDigest: current.observationDigest,
    catalogDigest: frozenCatalog.digest,
    reason: `Apply ${decisionId}`,
    operations: [operation],
  };
}

describe('AI Data cybernetic control Processors', () => {
  test('normalizes the closed decision grammar and rejects controller-authored executable fields', () => {
    const valid = normalizeAIDataControlDecision(controlRuntime, JSON.parse(JSON.stringify(decision)), {});
    expect(valid).toEqual(decision);
    expect(Object.isFrozen(valid)).toBe(true);
    expect(() => normalizeAIDataControlDecision(controlRuntime, {
      ...decision,
      operations: [{
        ...decision.operations[0],
        codeRef: 'resource://controller-authored/code',
      }],
    }, {})).toThrow(AIDataControlProtocolError);
  });

  test('bounds untrusted decision operations and depth before digesting them', () => {
    expect(() => normalizeAIDataControlDecision(controlRuntime, {
      ...decision,
      operations: Array.from({ length: 65 }, (_, index) => ({
        op: 'remove-node',
        nodeId: `node-${index}`,
      })),
    }, {})).toThrow('decision.operations exceeds the normalization limit 64');

    let deepLiteral: unknown = 'leaf';
    for (let depth = 0; depth < 40; depth += 1) deepLiteral = { nested: deepLiteral };
    expect(() => normalizeAIDataControlDecision(controlRuntime, {
      ...decision,
      operations: [{
        op: 'add-capability',
        nodeId: 'deep',
        capabilityId: 'normalize',
        inputs: {
          material: {
            kind: 'literal',
            schemaRef: 'schema://tests/material/v1',
            value: deepLiteral,
          },
        },
      }],
    }, {})).toThrow('decision exceeds depth 32');
  });

  test('admits two distinct capability revisions across consecutive canonical generations', () => {
    const generationZero = createAIDataWorkflowRunGraph({ binding: controlBinding, runId: 'control-run' });
    const firstObservation = observe(generationZero);
    expect(firstObservation.graph.nodes.find((node) => node.nodeId === 'return')?.dependsOn).toEqual([]);
    const firstDecision = reviseDecision(firstObservation, 'decision-normalize', {
      op: 'add-capability',
      nodeId: 'normalize-1',
      capabilityId: 'normalize',
      inputs: {
        material: {
          kind: 'port',
          nodeId: 'entry',
          port: 'material',
          schemaRef: 'schema://tests/material/v1',
        },
      },
    });
    const firstAdmission = admitAIDataControlDecision(controlRuntime, {
      goal,
      budget,
      catalog: frozenCatalog,
      graph: generationZero,
      verifier: firstObservation.verifier,
      observation: firstObservation,
      decision: firstDecision,
    }, {});
    expect(firstAdmission.kind).toBe('patch');
    if (firstAdmission.kind !== 'patch') throw new Error('first decision was not admitted');
    expect(firstAdmission.patch).toMatchObject({ generation: 1, patchId: 'control:decision-normalize' });
    expect(firstAdmission.patch.operations[0]).toMatchObject({
      op: 'add-node',
      node: {
        id: 'normalize-1',
        tag: 'TransformNode',
        nodeType: 'data',
        outputs: ['result'],
        inputs: { material: { nodeId: 'entry', port: 'material' } },
      },
    });

    const generationOne = applyAIDataWorkflowGraphPatch(generationZero, firstAdmission.patch);
    const secondBudget = { ...budget, usage: { ...budget.usage, iteration: 2 } };
    const secondObservation = observe(generationOne, {
      budget: secondBudget,
      verifier: verifierFor(1, 'failed'),
    });
    const secondDecision = reviseDecision(secondObservation, 'decision-inspect', {
      op: 'add-capability',
      nodeId: 'inspect-1',
      capabilityId: 'inspect',
      inputs: {
        material: {
          kind: 'port',
          nodeId: 'entry',
          port: 'material',
          schemaRef: 'schema://tests/material/v1',
        },
      },
    });
    const secondAdmission = admitAIDataControlDecision(controlRuntime, {
      goal,
      budget: secondBudget,
      catalog: frozenCatalog,
      graph: generationOne,
      verifier: secondObservation.verifier,
      observation: secondObservation,
      decision: secondDecision,
    }, {});
    expect(secondAdmission.kind).toBe('patch');
    if (secondAdmission.kind !== 'patch') throw new Error('second decision was not admitted');
    expect(secondAdmission.patch).toMatchObject({ generation: 2, patchId: 'control:decision-inspect' });
    expect(secondAdmission.patch.operations).not.toEqual(firstAdmission.patch.operations);
  });

  test('rejects stale, open and schema-incompatible proposals without mutating the graph', () => {
    const graph = createAIDataWorkflowRunGraph({ binding: controlBinding, runId: 'rejection-run' });
    const current = observe(graph);
    const before = JSON.stringify(graph);
    const cases: readonly AIDataControlDecision[] = [
      { ...reviseDecision(current, 'stale', {
        op: 'remove-node', nodeId: 'entry',
      }), observationDigest: 'digest:stale' },
      reviseDecision(current, 'protected', {
        op: 'remove-node', nodeId: 'entry',
      }),
      reviseDecision(current, 'unknown-capability', {
        op: 'add-capability', nodeId: 'unknown', capabilityId: 'not-in-catalog', inputs: {},
      }),
      reviseDecision(current, 'bad-schema', {
        op: 'add-capability',
        nodeId: 'bad-schema',
        capabilityId: 'normalize',
        inputs: {
          material: {
            kind: 'port', nodeId: 'entry', port: 'material', schemaRef: 'schema://tests/wrong/v1',
          },
        },
      }),
    ];
    const codes = cases.map((candidate) => {
      const result = admitAIDataControlDecision(controlRuntime, {
        goal, budget, catalog: frozenCatalog, graph, verifier: current.verifier, observation: current, decision: candidate,
      }, {});
      expect(result.kind).toBe('rejected');
      return result.kind === 'rejected' ? result.feedback[0]?.code : undefined;
    });
    expect(codes).toEqual([
      'STALE_OBSERVATION',
      'PROTECTED_NODE',
      'UNKNOWN_CAPABILITY',
      'INPUT_CONTRACT_MISMATCH',
    ]);
    expect(JSON.stringify(graph)).toBe(before);
  });

  test('revalidates unchanged downstream ports against a rewired upstream contract', () => {
    const generationZero = createAIDataWorkflowRunGraph({ binding: controlBinding, runId: 'downstream-contract-run' });
    const firstObservation = observe(generationZero);
    const firstDecision: AIDataControlDecision = {
      schemaVersion: AI_DATA_CONTROL_SCHEMA_VERSION,
      kind: 'revise',
      decisionId: 'build-pipeline',
      goalId: goal.goalId,
      observationId: firstObservation.observationId,
      observationDigest: firstObservation.observationDigest,
      catalogDigest: frozenCatalog.digest,
      reason: 'Build a typed two-node pipeline.',
      operations: [
        {
          op: 'add-capability',
          nodeId: 'normalize-1',
          capabilityId: 'normalize',
          inputs: {
            material: {
              kind: 'port', nodeId: 'entry', port: 'material', schemaRef: 'schema://tests/material/v1',
            },
          },
        },
        {
          op: 'add-capability',
          nodeId: 'consume-1',
          capabilityId: 'consumeResult',
          inputs: {
            result: {
              kind: 'port', nodeId: 'normalize-1', port: 'result', schemaRef: 'schema://tests/result/v1',
            },
          },
        },
      ],
    };
    const pipeline = admitAIDataControlDecision(controlRuntime, {
      goal,
      budget,
      catalog: frozenCatalog,
      graph: generationZero,
      verifier: firstObservation.verifier,
      observation: firstObservation,
      decision: firstDecision,
    }, {});
    if (pipeline.kind !== 'patch') throw new Error('pipeline setup was not admitted');
    const generationOne = applyAIDataWorkflowGraphPatch(generationZero, pipeline.patch);
    const secondBudget = { ...budget, usage: { ...budget.usage, iteration: 2 } };
    const current = observe(generationOne, {
      budget: secondBudget,
      verifier: verifierFor(1, 'failed'),
    });
    const incompatible = reviseDecision(current, 'break-upstream-output', {
      op: 'rewire-capability',
      nodeId: 'normalize-1',
      capabilityId: 'normalizeAlternate',
      inputs: {
        material: {
          kind: 'port', nodeId: 'entry', port: 'material', schemaRef: 'schema://tests/material/v1',
        },
      },
    });
    const before = JSON.stringify(generationOne);
    expect(admitAIDataControlDecision(controlRuntime, {
      goal,
      budget: secondBudget,
      catalog: frozenCatalog,
      graph: generationOne,
      verifier: current.verifier,
      observation: current,
      decision: incompatible,
    }, {})).toMatchObject({
      kind: 'rejected', feedback: [{ code: 'INPUT_CONTRACT_MISMATCH', nodeId: 'consume-1' }],
    });
    expect(JSON.stringify(generationOne)).toBe(before);
  });

  test('admits completion only from the exact latest passing verifier fact', () => {
    const generationZero = createAIDataWorkflowRunGraph({ binding: controlBinding, runId: 'completion-run' });
    const initialObservation = observe(generationZero);
    const normalization = admitAIDataControlDecision(controlRuntime, {
      goal,
      budget,
      catalog: frozenCatalog,
      graph: generationZero,
      verifier: initialObservation.verifier,
      observation: initialObservation,
      decision: reviseDecision(initialObservation, 'completion-normalize', {
        op: 'add-capability',
        nodeId: 'normalize-1',
        capabilityId: 'normalize',
        inputs: {
          material: {
            kind: 'port',
            nodeId: 'entry',
            port: 'material',
            schemaRef: 'schema://tests/material/v1',
          },
        },
      }),
    }, {});
    if (normalization.kind !== 'patch') throw new Error('normalization was not admitted');
    const graph = applyAIDataWorkflowGraphPatch(generationZero, normalization.patch);
    const pendingObservation = observe(graph);
    const base = {
      schemaVersion: AI_DATA_CONTROL_SCHEMA_VERSION,
      kind: 'complete' as const,
      decisionId: 'complete-1',
      goalId: goal.goalId,
      observationId: pendingObservation.observationId,
      observationDigest: pendingObservation.observationDigest,
      catalogDigest: frozenCatalog.digest,
      reason: 'Verifier says the required result exists.',
      verifierFactId: pendingObservation.verifier.factId,
      outputNodeId: 'normalize-1',
      outputPort: 'result',
      outputSchemaRef: goal.requiredOutputSchemaRef,
    };
    const rejected = admitAIDataControlDecision(controlRuntime, {
      goal, budget, catalog: frozenCatalog, graph, verifier: pendingObservation.verifier, observation: pendingObservation, decision: base,
    }, {});
    expect(rejected).toMatchObject({
      kind: 'rejected', feedback: [{ code: 'VERIFIER_REQUIRED' }],
    });

    const { observationDigest: _oldDigest, ...pendingContent } = pendingObservation;
    const forgedContent = {
      ...pendingContent,
      verifier: {
      ...pendingObservation.verifier,
      factId: 'forged-pass',
      status: 'passed',
      } as const,
    };
    const forgedProjection: AIDataControlObservation = {
      ...forgedContent,
      observationDigest: controlRuntime.stableDigest(forgedContent),
    };
    const forged = admitAIDataControlDecision(controlRuntime, {
      goal,
      budget,
      catalog: frozenCatalog,
      graph,
      verifier: pendingObservation.verifier,
      observation: forgedProjection,
      decision: {
        ...base,
        observationId: forgedProjection.observationId,
        observationDigest: forgedProjection.observationDigest,
        verifierFactId: forgedProjection.verifier.factId,
      },
    }, {});
    expect(forged).toMatchObject({
      kind: 'rejected', feedback: [{ code: 'STALE_OBSERVATION' }],
    });

    const settledGraph = recordAIDataWorkflowNodeResult(graph, 'normalize-1', {
      nodeId: 'normalize-1',
      generation: 1,
      status: 'Succeeded',
      output: { result: { normalized: true } },
    });
    const passedObservation = observe(settledGraph, { verifier: verifierFor(1, 'passed') });
    const accepted = admitAIDataControlDecision(controlRuntime, {
      goal,
      budget,
      catalog: frozenCatalog,
      graph: settledGraph,
      verifier: passedObservation.verifier,
      observation: passedObservation,
      decision: {
        ...base,
        observationId: passedObservation.observationId,
        observationDigest: passedObservation.observationDigest,
        verifierFactId: passedObservation.verifier.factId,
      },
    }, {});
    expect(accepted).toMatchObject({
      kind: 'complete',
      verifierFactId: passedObservation.verifier.factId,
      outputSchemaRef: goal.requiredOutputSchemaRef,
    });
  });

  test('rejects an identical rewire as terminal no progress', () => {
    const generationZero = createAIDataWorkflowRunGraph({ binding: controlBinding, runId: 'no-progress-run' });
    const firstObservation = observe(generationZero);
    const add = reviseDecision(firstObservation, 'add-before-no-progress', {
      op: 'add-capability',
      nodeId: 'normalize-1',
      capabilityId: 'normalize',
      inputs: {
        material: {
          kind: 'port', nodeId: 'entry', port: 'material', schemaRef: 'schema://tests/material/v1',
        },
      },
    });
    const admitted = admitAIDataControlDecision(controlRuntime, {
      goal, budget, catalog: frozenCatalog, graph: generationZero, verifier: firstObservation.verifier, observation: firstObservation, decision: add,
    }, {});
    if (admitted.kind !== 'patch') throw new Error('setup patch was not admitted');
    const generationOne = applyAIDataWorkflowGraphPatch(generationZero, admitted.patch);
    const firstNoProgressObservation = observe(generationOne, { verifier: verifierFor(1, 'failed') });
    const firstUnchanged = reviseDecision(firstNoProgressObservation, 'first-identical-rewire', {
      op: 'rewire-capability',
      nodeId: 'normalize-1',
      capabilityId: 'normalize',
      inputs: {
        material: {
          kind: 'port', nodeId: 'entry', port: 'material', schemaRef: 'schema://tests/material/v1',
        },
      },
    });
    expect(admitAIDataControlDecision(controlRuntime, {
      goal,
      budget,
      catalog: frozenCatalog,
      graph: generationOne,
      verifier: firstNoProgressObservation.verifier,
      observation: firstNoProgressObservation,
      decision: firstUnchanged,
    }, {})).toMatchObject({
      kind: 'rejected', terminal: false, feedback: [{ code: 'NO_PROGRESS' }],
    });

    const noProgressBudget = { ...budget, usage: { ...budget.usage, noProgressIterations: 1 } };
    const current = observe(generationOne, {
      budget: noProgressBudget,
      verifier: verifierFor(1, 'failed'),
    });
    const unchanged = reviseDecision(current, 'identical-rewire', {
      op: 'rewire-capability',
      nodeId: 'normalize-1',
      capabilityId: 'normalize',
      inputs: {
        material: {
          kind: 'port', nodeId: 'entry', port: 'material', schemaRef: 'schema://tests/material/v1',
        },
      },
    });
    expect(admitAIDataControlDecision(controlRuntime, {
      goal,
      budget: noProgressBudget,
      catalog: frozenCatalog,
      graph: generationOne,
      verifier: current.verifier,
      observation: current,
      decision: unchanged,
    }, {})).toMatchObject({
      kind: 'rejected', terminal: true, feedback: [{ code: 'NO_PROGRESS' }],
    });
  });

  test('terminates revisions from generic iteration, no-progress, token and deadline budgets', () => {
    const graph = createAIDataWorkflowRunGraph({ binding: controlBinding, runId: 'budget-run' });
    const exhaustedBudgets: readonly AIDataControlBudget[] = [
      { ...budget, usage: { ...budget.usage, iteration: budget.limits.maxIterations } },
      { ...budget, usage: { ...budget.usage, noProgressIterations: budget.limits.maxNoProgressIterations } },
      { ...budget, usage: { ...budget.usage, tokensUsed: budget.limits.maxTokens } },
      { ...budget, usage: { ...budget.usage, nowEpochMs: budget.limits.deadlineEpochMs } },
    ];
    for (const exhausted of exhaustedBudgets) {
      const current = observe(graph, { budget: exhausted });
      const result = admitAIDataControlDecision(controlRuntime, {
        goal,
        budget: exhausted,
        catalog: frozenCatalog,
        graph,
        verifier: current.verifier,
        observation: current,
        decision: reviseDecision(current, `budget-${exhaustedBudgets.indexOf(exhausted)}`, {
          op: 'add-capability', nodeId: 'next', capabilityId: 'normalize', inputs: {},
        }),
      }, {});
      expect(result).toMatchObject({
        kind: 'rejected', terminal: true, feedback: [{ code: 'BUDGET_EXHAUSTED' }],
      });
    }
  });

  test('reconstructs identical observations and admissions from JSON facts', () => {
    const graph = createAIDataWorkflowRunGraph({ binding: controlBinding, runId: 'recovery-run' });
    const current = observe(graph);
    const reconstructed = JSON.parse(JSON.stringify({ goal, budget, catalog: frozenCatalog, graph, observation: current }));
    const decision = reviseDecision(reconstructed.observation, 'recovered', {
      op: 'add-capability',
      nodeId: 'normalize-recovered',
      capabilityId: 'normalize',
      inputs: {
        material: {
          kind: 'port', nodeId: 'entry', port: 'material', schemaRef: 'schema://tests/material/v1',
        },
      },
    });
    expect(projectAIDataControlObservation(controlRuntime, {
      goal: reconstructed.goal,
      budget: reconstructed.budget,
      catalog: reconstructed.catalog,
      graph: reconstructed.graph,
      verifier: verifierFor(0),
      feedback: [],
    }, { maxObservedNodes: 20 })).toEqual(current);
    expect(admitAIDataControlDecision(controlRuntime, {
      ...reconstructed,
      verifier: reconstructed.observation.verifier,
      decision,
    }, {})).toEqual(admitAIDataControlDecision(controlRuntime, {
      goal, budget, catalog: frozenCatalog, graph, verifier: current.verifier, observation: current, decision,
    }, {}));
  });
});
