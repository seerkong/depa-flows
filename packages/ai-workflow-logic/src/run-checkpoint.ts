import {
  FLOW_INSTANCE_SCHEMA_VERSION,
  FLOW_RUN_CHECKPOINT_SCHEMA_VERSION,
  type AICtrlWorkflowRunProfileState,
  type AIDataWorkflowRunProfileState,
  type AIWorkflowFlowRunCheckpoint,
  type AIWorkflowProfileDurableState,
  type FlowClosedObject,
  type FlowClosedValue,
  type FlowDefinitionArtifactIdentity,
  type FlowDefinitionProvenance,
  type FlowInstanceDescriptor,
  type FlowRunProfileState,
  type WorkCtrlFlowRunProfileState,
} from 'ai-workflow-contract';
import { normalizeCanonicalAIAgentState } from './agent-state.js';

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

export class FlowRunContractValidationError extends Error {
  constructor(
    public readonly code: string,
    public readonly location: string,
    message: string,
  ) {
    super(`${location}: ${message}`);
    this.name = 'FlowRunContractValidationError';
  }
}

export function normalizeFlowInstanceDescriptor(value: unknown): FlowInstanceDescriptor {
  const record = exactRecord(
    value,
    ['schemaVersion', 'instanceId', 'definition', 'materializedAtMs'],
    [],
    'instance',
  );
  const schemaVersion = dataField(record, 'schemaVersion', 'instance.schemaVersion');
  if (schemaVersion !== FLOW_INSTANCE_SCHEMA_VERSION) {
    invalid('FLOW_INSTANCE_SCHEMA_INVALID', 'instance.schemaVersion', `Expected ${FLOW_INSTANCE_SCHEMA_VERSION}.`);
  }
  const instanceId = canonicalIdentity(dataField(record, 'instanceId', 'instance.instanceId'), 'instance.instanceId');
  const definition = normalizeDefinitionIdentity(dataField(record, 'definition', 'instance.definition'), 'instance.definition');
  const materializedAtMs = nonNegativeSafeInteger(
    dataField(record, 'materializedAtMs', 'instance.materializedAtMs'),
    'instance.materializedAtMs',
  );
  return Object.freeze({ schemaVersion, instanceId, definition, materializedAtMs });
}

export function normalizeFlowRunCheckpoint(value: unknown): AIWorkflowFlowRunCheckpoint {
  const record = exactRecord(
    value,
    [
      'schemaVersion',
      'runId',
      'instanceId',
      'definition',
      'version',
      'input',
      'config',
      'state',
      'output',
      'controllerSidecars',
      'nodeSidecars',
      'profile',
    ],
    ['stepExtensions'],
    'checkpoint',
  );
  const schemaVersion = dataField(record, 'schemaVersion', 'checkpoint.schemaVersion');
  if (schemaVersion !== FLOW_RUN_CHECKPOINT_SCHEMA_VERSION) {
    invalid('FLOW_RUN_CHECKPOINT_SCHEMA_INVALID', 'checkpoint.schemaVersion', `Expected ${FLOW_RUN_CHECKPOINT_SCHEMA_VERSION}.`);
  }
  const runId = canonicalIdentity(dataField(record, 'runId', 'checkpoint.runId'), 'checkpoint.runId');
  const instanceId = canonicalIdentity(dataField(record, 'instanceId', 'checkpoint.instanceId'), 'checkpoint.instanceId');
  const definition = normalizeDefinitionIdentity(dataField(record, 'definition', 'checkpoint.definition'), 'checkpoint.definition');
  const version = nonNegativeSafeInteger(dataField(record, 'version', 'checkpoint.version'), 'checkpoint.version');
  const input = cloneClosedValue(dataField(record, 'input', 'checkpoint.input'), 'checkpoint.input');
  const config = cloneClosedValue(dataField(record, 'config', 'checkpoint.config'), 'checkpoint.config');
  const state = cloneClosedValue(dataField(record, 'state', 'checkpoint.state'), 'checkpoint.state');
  const output = cloneClosedValue(dataField(record, 'output', 'checkpoint.output'), 'checkpoint.output');
  const controllerSidecars = cloneClosedObject(
    dataField(record, 'controllerSidecars', 'checkpoint.controllerSidecars'),
    'checkpoint.controllerSidecars',
  );
  const nodeSidecars = cloneClosedObject(
    dataField(record, 'nodeSidecars', 'checkpoint.nodeSidecars'),
    'checkpoint.nodeSidecars',
  );
  const stepExtensions = Object.prototype.hasOwnProperty.call(record, 'stepExtensions')
    ? normalizeRunStepExtensions(dataField(record, 'stepExtensions', 'checkpoint.stepExtensions'))
    : undefined;
  const profile = normalizeProfile(dataField(record, 'profile', 'checkpoint.profile'), runId);
  validateProfileProjection(profile, { input, state, output, controllerSidecars, nodeSidecars });
  return Object.freeze({
    schemaVersion,
    runId,
    instanceId,
    definition,
    version,
    input,
    config,
    state,
    output,
    controllerSidecars,
    nodeSidecars,
    ...(stepExtensions === undefined ? {} : { stepExtensions }),
    profile,
  });
}

function normalizeRunStepExtensions(value: unknown) {
  const root = exactRecord(value, ['schemaVersion', 'byStepId'], [], 'checkpoint.stepExtensions');
  if (dataField(root, 'schemaVersion', 'checkpoint.stepExtensions.schemaVersion') !== 'depa.flow-run-step-extensions/v1') {
    invalid('FLOW_RUN_STEP_EXTENSIONS_SCHEMA_INVALID', 'checkpoint.stepExtensions.schemaVersion', 'Step extension state schema is invalid.');
  }
  const byStepIdValue = plainRecord(dataField(root, 'byStepId', 'checkpoint.stepExtensions.byStepId'), 'checkpoint.stepExtensions.byStepId');
  const byStepId: Record<string, Record<string, { readonly schemaRef?: string; readonly revision: number; readonly value: FlowClosedValue }>> = {};
  for (const stepId of stringDataKeys(byStepIdValue, 'checkpoint.stepExtensions.byStepId').sort(compareCodeUnits)) {
    canonicalIdentity(stepId, `checkpoint.stepExtensions.byStepId.${stepId}`);
    const extensionsValue = plainRecord(dataField(byStepIdValue, stepId, `checkpoint.stepExtensions.byStepId.${stepId}`), `checkpoint.stepExtensions.byStepId.${stepId}`);
    const extensionFacts: Record<string, { readonly schemaRef?: string; readonly revision: number; readonly value: FlowClosedValue }> = {};
    for (const kind of stringDataKeys(extensionsValue, `checkpoint.stepExtensions.byStepId.${stepId}`).sort(compareCodeUnits)) {
      canonicalIdentity(kind, `checkpoint.stepExtensions.byStepId.${stepId}.${kind}`);
      const location = `checkpoint.stepExtensions.byStepId.${stepId}.${kind}`;
      const fact = exactRecord(dataField(extensionsValue, kind, location), ['revision', 'value'], ['schemaRef'], location);
      const schemaRef = Object.prototype.hasOwnProperty.call(fact, 'schemaRef')
        ? canonicalIdentity(dataField(fact, 'schemaRef', `${location}.schemaRef`), `${location}.schemaRef`)
        : undefined;
      extensionFacts[kind] = Object.freeze({
        ...(schemaRef === undefined ? {} : { schemaRef }),
        revision: nonNegativeSafeInteger(dataField(fact, 'revision', `${location}.revision`), `${location}.revision`),
        value: cloneClosedValue(dataField(fact, 'value', `${location}.value`), `${location}.value`),
      });
    }
    if (Object.keys(extensionFacts).length === 0) {
      invalid('FLOW_RUN_STEP_EXTENSIONS_EMPTY_STEP', `checkpoint.stepExtensions.byStepId.${stepId}`, 'Extension step entries cannot be empty.');
    }
    byStepId[stepId] = Object.freeze(extensionFacts);
  }
  if (Object.keys(byStepId).length === 0) {
    invalid('FLOW_RUN_STEP_EXTENSIONS_EMPTY', 'checkpoint.stepExtensions.byStepId', 'Empty extension state must be omitted.');
  }
  return Object.freeze({
    schemaVersion: 'depa.flow-run-step-extensions/v1' as const,
    byStepId: Object.freeze(byStepId),
  });
}

function validateProfileProjection(
  profile: FlowRunProfileState,
  envelope: {
    readonly input: FlowClosedValue;
    readonly state: FlowClosedValue;
    readonly output: FlowClosedValue;
    readonly controllerSidecars: FlowClosedObject;
    readonly nodeSidecars: FlowClosedObject;
  },
): void {
  if (profile.kind === 'WorkCtrlFlow' || profile.kind === 'AICtrlWorkflow') {
    validateWorkCtrlProfileProjection(profile.snapshot, envelope);
    return;
  }
  validateAIDataProfileProjection(profile.runGraph, envelope);
}

function validateWorkCtrlProfileProjection(
  value: FlowClosedObject,
  envelope: {
    readonly input: FlowClosedValue;
    readonly state: FlowClosedValue;
    readonly controllerSidecars: FlowClosedObject;
    readonly nodeSidecars: FlowClosedObject;
  },
): void {
  const snapshot = plainRecord(value, 'checkpoint.profile.snapshot');
  const expectedController = {
    status: dataField(snapshot, 'status', 'checkpoint.profile.snapshot.status'),
    lastTickNo: dataField(snapshot, 'lastTickNo', 'checkpoint.profile.snapshot.lastTickNo'),
    branchDecisions: dataField(snapshot, 'branchDecisions', 'checkpoint.profile.snapshot.branchDecisions'),
    orchestration: dataField(snapshot, 'orchestration', 'checkpoint.profile.snapshot.orchestration'),
    openWaitHandles: dataField(snapshot, 'openWaitHandles', 'checkpoint.profile.snapshot.openWaitHandles'),
    closedWaitHandles: dataField(snapshot, 'closedWaitHandles', 'checkpoint.profile.snapshot.closedWaitHandles'),
    appliedResumeSignals: dataField(snapshot, 'appliedResumeSignals', 'checkpoint.profile.snapshot.appliedResumeSignals'),
  };
  const expectedNodes = {
    nodeResults: dataField(snapshot, 'nodeResults', 'checkpoint.profile.snapshot.nodeResults'),
    waitResults: dataField(snapshot, 'waitResults', 'checkpoint.profile.snapshot.waitResults'),
  };
  const facts: readonly [string, unknown, unknown][] = [
    ['input', envelope.input, dataField(snapshot, 'input', 'checkpoint.profile.snapshot.input')],
    ['state', envelope.state, dataField(snapshot, 'vars', 'checkpoint.profile.snapshot.vars')],
    ['controllerSidecars', envelope.controllerSidecars, expectedController],
    ['nodeSidecars', envelope.nodeSidecars, expectedNodes],
  ];
  for (const [field, actual, expected] of facts) {
    if (!sameProjection(actual, expected)) {
      invalid('WORK_CTRL_ENVELOPE_PROJECTION_MISMATCH', `checkpoint.${field}`, `${field} must exactly equal its canonical snapshot projection.`);
    }
  }
}

function validateAIDataProfileProjection(
  value: FlowClosedObject,
  envelope: {
    readonly state: FlowClosedValue;
    readonly output: FlowClosedValue;
    readonly controllerSidecars: FlowClosedObject;
    readonly nodeSidecars: FlowClosedObject;
  },
): void {
  const graph = plainRecord(value, 'checkpoint.profile.runGraph');
  const nodes = plainRecord(dataField(graph, 'nodes', 'checkpoint.profile.runGraph.nodes'), 'checkpoint.profile.runGraph.nodes');
  const declarationOrder = identityArray(
    dataField(graph, 'declarationOrder', 'checkpoint.profile.runGraph.declarationOrder'),
    'checkpoint.profile.runGraph.declarationOrder',
  );
  const statuses = declarationOrder.map((nodeId) => {
    const node = plainRecord(dataField(nodes, nodeId, `checkpoint.profile.runGraph.nodes.${nodeId}`), `checkpoint.profile.runGraph.nodes.${nodeId}`);
    return String(dataField(node, 'status', `checkpoint.profile.runGraph.nodes.${nodeId}.status`));
  }).filter((status) => status !== 'Removed');
  const status = statuses.some((item) => item === 'Failed')
    ? 'Failed'
    : statuses.some((item) => item === 'Running')
      ? 'Running'
      : statuses.length > 0 && statuses.every((item) => item === 'Succeeded' || item === 'Reused')
        ? 'Succeeded'
        : 'Pending';
  const generation = dataField(graph, 'currentGeneration', 'checkpoint.profile.runGraph.currentGeneration');
  const expectedState = { status, generation };
  const expectedController = { status };
  const expectedNodes = Object.fromEntries(declarationOrder.map((nodeId) => {
    const node = plainRecord(dataField(nodes, nodeId, `checkpoint.profile.runGraph.nodes.${nodeId}`), `checkpoint.profile.runGraph.nodes.${nodeId}`);
    return [nodeId, {
      status: dataField(node, 'status', `checkpoint.profile.runGraph.nodes.${nodeId}.status`),
      generation: dataField(node, 'generation', `checkpoint.profile.runGraph.nodes.${nodeId}.generation`),
    }];
  }));
  const expectedOutput = status === 'Succeeded'
    ? terminalAIDataOutput(graph, nodes, declarationOrder)
    : null;
  const facts: readonly [string, unknown, unknown][] = [
    ['state', envelope.state, expectedState],
    ['controllerSidecars', envelope.controllerSidecars, expectedController],
    ['nodeSidecars', envelope.nodeSidecars, expectedNodes],
    ['output', envelope.output, expectedOutput],
  ];
  for (const [field, actual, expected] of facts) {
    if (!sameProjection(actual, expected)) {
      invalid('AI_DATA_ENVELOPE_PROJECTION_MISMATCH', `checkpoint.${field}`, `${field} must exactly equal its canonical RunGraph projection.`);
    }
  }
}

function sameProjection(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(cloneClosedValue(expected, 'checkpoint.projection'));
}

function terminalAIDataOutput(
  _graph: Record<string, unknown>,
  nodes: Record<string, unknown>,
  declarationOrder: readonly string[],
): unknown {
  const returnIds = declarationOrder.filter((nodeId) => {
    const node = plainRecord(dataField(nodes, nodeId, `checkpoint.profile.runGraph.nodes.${nodeId}`), `checkpoint.profile.runGraph.nodes.${nodeId}`);
    return dataField(node, 'tag', `checkpoint.profile.runGraph.nodes.${nodeId}.tag`) === 'ReturnNode';
  });
  if (returnIds.length !== 1) {
    invalid('AI_DATA_TERMINAL_RETURN_INVALID', 'checkpoint.profile.runGraph', 'Succeeded RunGraph requires exactly one ReturnNode.');
  }
  const returnNode = plainRecord(dataField(nodes, returnIds[0], `checkpoint.profile.runGraph.nodes.${returnIds[0]}`), `checkpoint.profile.runGraph.nodes.${returnIds[0]}`);
  const result = plainRecord(dataField(returnNode, 'result', `checkpoint.profile.runGraph.nodes.${returnIds[0]}.result`), `checkpoint.profile.runGraph.nodes.${returnIds[0]}.result`);
  return dataField(result, 'output', `checkpoint.profile.runGraph.nodes.${returnIds[0]}.result.output`);
}

function normalizeDefinitionIdentity(value: unknown, location: string): FlowDefinitionArtifactIdentity {
  const record = exactRecord(value, ['revision', 'digest', 'provenance'], [], location);
  const revision = canonicalIdentity(dataField(record, 'revision', `${location}.revision`), `${location}.revision`);
  const digest = dataField(record, 'digest', `${location}.digest`);
  if (typeof digest !== 'string' || !SHA256_DIGEST.test(digest)) {
    invalid('FLOW_DEFINITION_DIGEST_INVALID', `${location}.digest`, 'Expected a lowercase sha256 digest.');
  }
  const provenance = normalizeDefinitionProvenance(
    dataField(record, 'provenance', `${location}.provenance`),
    `${location}.provenance`,
  );
  return Object.freeze({ revision, digest: digest as `sha256:${string}`, provenance });
}

function normalizeDefinitionProvenance(value: unknown, location: string): FlowDefinitionProvenance {
  const record = exactRecord(value, ['authority', 'artifactRef'], ['metadata'], location);
  const authority = canonicalIdentity(dataField(record, 'authority', `${location}.authority`), `${location}.authority`);
  const artifactRef = canonicalIdentity(dataField(record, 'artifactRef', `${location}.artifactRef`), `${location}.artifactRef`);
  const hasMetadata = Object.prototype.hasOwnProperty.call(record, 'metadata');
  const metadata = !hasMetadata
    ? undefined
    : cloneClosedObject(dataField(record, 'metadata', `${location}.metadata`), `${location}.metadata`);
  return Object.freeze({ authority, artifactRef, ...(metadata === undefined ? {} : { metadata }) });
}

function normalizeProfile(value: unknown, runId: string): FlowRunProfileState {
  const base = plainRecord(value, 'checkpoint.profile');
  const kind = dataField(base, 'kind', 'checkpoint.profile.kind');
  switch (kind) {
    case 'WorkCtrlFlow': {
      const record = exactRecord(value, ['kind', 'snapshot'], [], 'checkpoint.profile');
      const profile: WorkCtrlFlowRunProfileState = {
        kind,
        snapshot: normalizeWorkCtrlSnapshot(
          dataField(record, 'snapshot', 'checkpoint.profile.snapshot'),
          runId,
          'checkpoint.profile.snapshot',
        ),
      };
      return Object.freeze(profile);
    }
    case 'AICtrlWorkflow': {
      const record = exactRecord(value, ['kind', 'snapshot', 'ai'], [], 'checkpoint.profile');
      const profile: AICtrlWorkflowRunProfileState = {
        kind,
        snapshot: normalizeWorkCtrlSnapshot(
          dataField(record, 'snapshot', 'checkpoint.profile.snapshot'),
          runId,
          'checkpoint.profile.snapshot',
        ),
        ai: normalizeAIWorkflowProfileDurableState(
          dataField(record, 'ai', 'checkpoint.profile.ai'),
          'checkpoint.profile.ai',
        ),
      };
      return Object.freeze(profile);
    }
    case 'AIDataWorkflow': {
      const record = exactRecord(value, ['kind', 'runGraph', 'ai'], [], 'checkpoint.profile');
      const profile: AIDataWorkflowRunProfileState = {
        kind,
        runGraph: normalizeAIDataRunGraph(
          dataField(record, 'runGraph', 'checkpoint.profile.runGraph'),
          runId,
          'checkpoint.profile.runGraph',
        ),
        ai: normalizeAIWorkflowProfileDurableState(
          dataField(record, 'ai', 'checkpoint.profile.ai'),
          'checkpoint.profile.ai',
        ),
      };
      return Object.freeze(profile);
    }
    default:
      invalid('FLOW_RUN_PROFILE_KIND_INVALID', 'checkpoint.profile.kind', 'Expected WorkCtrlFlow, AICtrlWorkflow or AIDataWorkflow.');
  }
}

const WORK_CTRL_SNAPSHOT_FIELDS = [
  'schemaVersion',
  'treeId',
  'fqn',
  'status',
  'vars',
  'input',
  'branchDecisions',
  'nodeResults',
  'waitResults',
  'openWaitHandles',
  'closedWaitHandles',
  'appliedResumeSignals',
  'orchestration',
  'lastTickNo',
  'updatedAtMs',
] as const;

function normalizeWorkCtrlSnapshot(value: unknown, runId: string, location: string): FlowClosedObject {
  const snapshot = cloneClosedObject(value, location);
  const record = exactRecord(snapshot, WORK_CTRL_SNAPSHOT_FIELDS, [], location);
  if (dataField(record, 'schemaVersion', `${location}.schemaVersion`) !== 'depa.flows.workflow/v4') {
    invalid('WORK_CTRL_SNAPSHOT_SCHEMA_INVALID', `${location}.schemaVersion`, 'Expected depa.flows.workflow/v4.');
  }
  const treeId = canonicalIdentity(dataField(record, 'treeId', `${location}.treeId`), `${location}.treeId`);
  if (treeId !== runId) {
    invalid('FLOW_RUN_PROFILE_IDENTITY_MISMATCH', `${location}.treeId`, 'Snapshot tree identity must equal the checkpoint run identity.');
  }
  canonicalIdentity(dataField(record, 'fqn', `${location}.fqn`), `${location}.fqn`);
  const status = dataField(record, 'status', `${location}.status`);
  if (status !== 'Waiting' && status !== 'Completed' && status !== 'Failed') {
    invalid('WORK_CTRL_SNAPSHOT_STATUS_INVALID', `${location}.status`, 'Expected Waiting, Completed or Failed.');
  }
  for (const field of ['vars', 'input'] as const) {
    plainRecord(dataField(record, field, `${location}.${field}`), `${location}.${field}`);
  }
  normalizeWorkCtrlNestedFacts(record, location);
  const openHandles = normalizeWaitHandles(
    dataField(record, 'openWaitHandles', `${location}.openWaitHandles`),
    treeId,
    'open',
    `${location}.openWaitHandles`,
  );
  const closedHandles = normalizeWaitHandles(
    dataField(record, 'closedWaitHandles', `${location}.closedWaitHandles`),
    treeId,
    'closed',
    `${location}.closedWaitHandles`,
  );
  const handleIds = [...openHandles, ...closedHandles].map((handle) => handle.waitHandleId);
  if (new Set(handleIds).size !== handleIds.length) {
    invalid('WORK_CTRL_WAIT_HANDLE_DUPLICATE', location, 'Wait handle identities must be unique across open and closed collections.');
  }
  const appliedResumeSignals = closedArray(
    dataField(record, 'appliedResumeSignals', `${location}.appliedResumeSignals`),
    `${location}.appliedResumeSignals`,
  );
  appliedResumeSignals.forEach((signal, index) => {
    canonicalIdentity(signal, `${location}.appliedResumeSignals[${index}]`);
  });
  if (new Set(appliedResumeSignals).size !== appliedResumeSignals.length) {
    invalid('WORK_CTRL_APPLIED_SIGNAL_DUPLICATE', `${location}.appliedResumeSignals`, 'Applied signal identities must be unique.');
  }
  const relatedSignals = new Set(
    closedHandles.map((handle) => `${handle.waitHandleId}:${handle.resumeToken}`),
  );
  for (const signal of appliedResumeSignals) {
    if (!relatedSignals.has(String(signal))) {
      invalid('WORK_CTRL_APPLIED_SIGNAL_UNRELATED', `${location}.appliedResumeSignals`, 'Applied signals must identify a closed wait handle and its resume token.');
    }
  }
  const orchestrationLocation = `${location}.orchestration`;
  const orchestration = exactRecord(
    dataField(record, 'orchestration', orchestrationLocation),
    ['attempts', 'deadlines', 'lanes', 'winners', 'cancellations', 'composites'],
    [],
    orchestrationLocation,
  );
  for (const field of ['attempts', 'deadlines', 'lanes', 'winners', 'cancellations', 'composites'] as const) {
    plainRecord(dataField(orchestration, field, `${orchestrationLocation}.${field}`), `${orchestrationLocation}.${field}`);
  }
  if (status === 'Completed') {
    if (openHandles.length > 0) {
      invalid('WORK_CTRL_COMPLETED_WITH_OPEN_WAIT', `${location}.openWaitHandles`, 'Completed snapshots cannot retain open wait handles.');
    }
    const composites = plainRecord(dataField(orchestration, 'composites', `${orchestrationLocation}.composites`), `${orchestrationLocation}.composites`);
    for (const key of stringDataKeys(composites, `${orchestrationLocation}.composites`)) {
      const fact = plainRecord(dataField(composites, key, `${orchestrationLocation}.composites.${key}`), `${orchestrationLocation}.composites.${key}`);
      if (['Open', 'Waiting'].includes(String(dataField(fact, 'status', `${orchestrationLocation}.composites.${key}.status`)))) {
        invalid('WORK_CTRL_COMPLETED_WITH_OPEN_COMPOSITE', `${orchestrationLocation}.composites.${key}.status`, 'Completed snapshots cannot retain open composite work.');
      }
    }
  }
  nonNegativeSafeInteger(dataField(record, 'lastTickNo', `${location}.lastTickNo`), `${location}.lastTickNo`);
  nonNegativeSafeInteger(dataField(record, 'updatedAtMs', `${location}.updatedAtMs`), `${location}.updatedAtMs`);
  return snapshot;
}

function normalizeWorkCtrlNestedFacts(snapshot: Record<string, unknown>, location: string): void {
  const branchLocation = `${location}.branchDecisions`;
  const branches = plainRecord(dataField(snapshot, 'branchDecisions', branchLocation), branchLocation);
  for (const key of stringDataKeys(branches, branchLocation).sort(compareCodeUnits)) {
    canonicalIdentity(key, `${branchLocation}.${key}`);
    const factLocation = `${branchLocation}.${key}`;
    const fact = exactRecord(dataField(branches, key, factLocation), ['ifPath', 'invocationKey', 'kind'], ['branchKey'], factLocation);
    const invocationKey = canonicalIdentity(dataField(fact, 'invocationKey', `${factLocation}.invocationKey`), `${factLocation}.invocationKey`);
    if (invocationKey !== key) invalid('WORK_CTRL_FACT_IDENTITY_MISMATCH', `${factLocation}.invocationKey`, 'Branch fact identity must equal its map key.');
    const ifPath = canonicalIdentity(dataField(fact, 'ifPath', `${factLocation}.ifPath`), `${factLocation}.ifPath`);
    const visitSeparator = invocationKey.lastIndexOf('#');
    const visitIndex = visitSeparator < 0 ? '' : invocationKey.slice(visitSeparator + 1);
    if (visitSeparator < 1 || invocationKey.slice(0, visitSeparator) !== ifPath || !/^(0|[1-9][0-9]*)$/u.test(visitIndex)) {
      invalid('WORK_CTRL_BRANCH_PATH_PROJECTION_MISMATCH', factLocation, 'Branch invocation identity must equal ifPath#visitIndex.');
    }
    const kind = dataField(fact, 'kind', `${factLocation}.kind`);
    if (!['Branch', 'Otherwise', 'NoMatch'].includes(String(kind))) invalid('WORK_CTRL_BRANCH_KIND_INVALID', `${factLocation}.kind`, 'Branch kind is not part of the public contract.');
    const hasBranchKey = Object.prototype.hasOwnProperty.call(fact, 'branchKey');
    if (kind === 'Branch' && !hasBranchKey) invalid('WORK_CTRL_BRANCH_KEY_MISSING', `${factLocation}.branchKey`, 'Branch decisions require a branch key.');
    if (hasBranchKey) {
      canonicalIdentity(dataField(fact, 'branchKey', `${factLocation}.branchKey`), `${factLocation}.branchKey`);
      if (kind !== 'Branch') invalid('WORK_CTRL_BRANCH_KEY_INVALID', `${factLocation}.branchKey`, 'Only Branch decisions can retain a branch key.');
    }
  }

  const nodeResultsLocation = `${location}.nodeResults`;
  const nodeResults = plainRecord(dataField(snapshot, 'nodeResults', nodeResultsLocation), nodeResultsLocation);
  for (const key of stringDataKeys(nodeResults, nodeResultsLocation).sort(compareCodeUnits)) {
    canonicalIdentity(key, `${nodeResultsLocation}.${key}`);
    normalizeTerminalResult(dataField(nodeResults, key, `${nodeResultsLocation}.${key}`), `${nodeResultsLocation}.${key}`);
  }

  const waitResultsLocation = `${location}.waitResults`;
  const waitResults = plainRecord(dataField(snapshot, 'waitResults', waitResultsLocation), waitResultsLocation);
  for (const key of stringDataKeys(waitResults, waitResultsLocation).sort(compareCodeUnits)) {
    canonicalIdentity(key, `${waitResultsLocation}.${key}`);
    const factLocation = `${waitResultsLocation}.${key}`;
    const fact = exactRecord(dataField(waitResults, key, factLocation), ['result'], ['payload'], factLocation);
    normalizeTerminalResult(dataField(fact, 'result', `${factLocation}.result`), `${factLocation}.result`);
  }

  const orchestrationLocation = `${location}.orchestration`;
  const orchestration = exactRecord(
    dataField(snapshot, 'orchestration', orchestrationLocation),
    ['attempts', 'deadlines', 'lanes', 'winners', 'cancellations', 'composites'],
    [],
    orchestrationLocation,
  );
  normalizeWorkCtrlAttempts(dataField(orchestration, 'attempts', `${orchestrationLocation}.attempts`), `${orchestrationLocation}.attempts`);
  normalizeWorkCtrlDeadlines(dataField(orchestration, 'deadlines', `${orchestrationLocation}.deadlines`), `${orchestrationLocation}.deadlines`);
  const lanes = normalizeWorkCtrlLanes(dataField(orchestration, 'lanes', `${orchestrationLocation}.lanes`), `${orchestrationLocation}.lanes`);
  normalizeWorkCtrlComposites(dataField(orchestration, 'composites', `${orchestrationLocation}.composites`), `${orchestrationLocation}.composites`);
  normalizeWorkCtrlWinners(dataField(orchestration, 'winners', `${orchestrationLocation}.winners`), lanes, `${orchestrationLocation}.winners`);
  normalizeWorkCtrlCancellations(dataField(orchestration, 'cancellations', `${orchestrationLocation}.cancellations`), `${orchestrationLocation}.cancellations`);
}

function normalizeTerminalResult(value: unknown, location: string): void {
  if (value !== 'Success' && value !== 'Failure' && value !== 'Cancelled') {
    invalid('WORK_CTRL_TERMINAL_RESULT_INVALID', location, 'Terminal result must be Success, Failure or Cancelled.');
  }
}

function normalizeDurableFactStatus(value: unknown, location: string): void {
  if (!['Open', 'Completed', 'Failed', 'Cancelled', 'Expired'].includes(String(value))) {
    invalid('WORK_CTRL_DURABLE_STATUS_INVALID', location, 'Durable fact status is not part of the public contract.');
  }
}

function normalizeWorkCtrlAttempts(value: unknown, location: string): void {
  for (const [key, item, itemLocation] of closedRecordEntries(value, location)) {
    const fact = exactRecord(item, ['invocationKey', 'attempt', 'maxAttempts', 'status'], ['nextAttemptAtMs'], itemLocation);
    assertFactKey(fact, key, itemLocation);
    const attempt = positiveSafeInteger(dataField(fact, 'attempt', `${itemLocation}.attempt`), `${itemLocation}.attempt`);
    const maxAttempts = positiveSafeInteger(dataField(fact, 'maxAttempts', `${itemLocation}.maxAttempts`), `${itemLocation}.maxAttempts`);
    if (attempt > maxAttempts) invalid('WORK_CTRL_ATTEMPT_RANGE_INVALID', `${itemLocation}.attempt`, 'Attempt cannot exceed maxAttempts.');
    normalizeDurableFactStatus(dataField(fact, 'status', `${itemLocation}.status`), `${itemLocation}.status`);
    if (Object.prototype.hasOwnProperty.call(fact, 'nextAttemptAtMs')) nonNegativeSafeInteger(dataField(fact, 'nextAttemptAtMs', `${itemLocation}.nextAttemptAtMs`), `${itemLocation}.nextAttemptAtMs`);
  }
}

function normalizeWorkCtrlDeadlines(value: unknown, location: string): void {
  for (const [key, item, itemLocation] of closedRecordEntries(value, location)) {
    const fact = exactRecord(item, ['invocationKey', 'deadlineAtMs', 'status'], [], itemLocation);
    assertFactKey(fact, key, itemLocation);
    nonNegativeSafeInteger(dataField(fact, 'deadlineAtMs', `${itemLocation}.deadlineAtMs`), `${itemLocation}.deadlineAtMs`);
    normalizeDurableFactStatus(dataField(fact, 'status', `${itemLocation}.status`), `${itemLocation}.status`);
  }
}

function normalizeWorkCtrlLanes(value: unknown, location: string): Map<string, { invocationKey: string; laneId: string; status: string }> {
  const output = new Map<string, { invocationKey: string; laneId: string; status: string }>();
  for (const [key, item, itemLocation] of closedRecordEntries(value, location)) {
    const fact = exactRecord(item, ['invocationKey', 'laneId', 'status', 'bodyId'], ['item', 'flowState', 'output'], itemLocation);
    const invocationKey = canonicalIdentity(dataField(fact, 'invocationKey', `${itemLocation}.invocationKey`), `${itemLocation}.invocationKey`);
    const laneId = canonicalIdentity(dataField(fact, 'laneId', `${itemLocation}.laneId`), `${itemLocation}.laneId`);
    if (key !== `${invocationKey}/${laneId}`) invalid('WORK_CTRL_LANE_IDENTITY_MISMATCH', itemLocation, 'Lane map key must equal invocationKey/laneId.');
    canonicalIdentity(dataField(fact, 'bodyId', `${itemLocation}.bodyId`), `${itemLocation}.bodyId`);
    const status = String(dataField(fact, 'status', `${itemLocation}.status`));
    normalizeDurableFactStatus(status, `${itemLocation}.status`);
    output.set(key, { invocationKey, laneId, status });
  }
  return output;
}

function normalizeWorkCtrlWinners(
  value: unknown,
  lanes: Map<string, { invocationKey: string; laneId: string; status: string }>,
  location: string,
): void {
  for (const [key, item, itemLocation] of closedRecordEntries(value, location)) {
    const fact = exactRecord(item, ['invocationKey', 'winnerId', 'mode'], [], itemLocation);
    assertFactKey(fact, key, itemLocation);
    const winnerId = canonicalIdentity(dataField(fact, 'winnerId', `${itemLocation}.winnerId`), `${itemLocation}.winnerId`);
    const mode = dataField(fact, 'mode', `${itemLocation}.mode`);
    if (mode !== 'first-success' && mode !== 'first-completed') invalid('WORK_CTRL_WINNER_MODE_INVALID', `${itemLocation}.mode`, 'Winner mode is invalid.');
    const winner = lanes.get(`${key}/${winnerId}`);
    if (!winner || (mode === 'first-success' ? winner.status !== 'Completed' : !['Completed', 'Failed'].includes(winner.status))) {
      invalid('WORK_CTRL_WINNER_PROJECTION_INVALID', itemLocation, 'Winner must project a settled lane under the same invocation.');
    }
  }
}

function normalizeWorkCtrlCancellations(value: unknown, location: string): void {
  for (const [key, item, itemLocation] of closedRecordEntries(value, location)) {
    const fact = exactRecord(item, ['invocationKey', 'reason', 'atMs'], [], itemLocation);
    assertFactKey(fact, key, itemLocation);
    if (!['SignalCancelled', 'DeadlineExceeded', 'RaceLost', 'ParentCancelled'].includes(String(dataField(fact, 'reason', `${itemLocation}.reason`)))) {
      invalid('WORK_CTRL_CANCELLATION_REASON_INVALID', `${itemLocation}.reason`, 'Cancellation reason is not part of the public contract.');
    }
    nonNegativeSafeInteger(dataField(fact, 'atMs', `${itemLocation}.atMs`), `${itemLocation}.atMs`);
  }
}

function normalizeWorkCtrlComposites(value: unknown, location: string): void {
  for (const [key, item, itemLocation] of closedRecordEntries(value, location)) {
    const fact = exactRecord(item, ['invocationKey', 'primitive', 'bodyId', 'status', 'updatedAtMs'], ['input', 'cursor', 'childTreeId'], itemLocation);
    assertFactKey(fact, key, itemLocation);
    const primitive = dataField(fact, 'primitive', `${itemLocation}.primitive`);
    if (!['Retry', 'Timeout', 'ForEach', 'Parallel', 'Race', 'CallFlow'].includes(String(primitive))) invalid('WORK_CTRL_COMPOSITE_PRIMITIVE_INVALID', `${itemLocation}.primitive`, 'Composite primitive is invalid.');
    canonicalIdentity(dataField(fact, 'bodyId', `${itemLocation}.bodyId`), `${itemLocation}.bodyId`);
    if (!['Open', 'Waiting', 'Completed', 'Failed', 'Cancelled'].includes(String(dataField(fact, 'status', `${itemLocation}.status`)))) invalid('WORK_CTRL_COMPOSITE_STATUS_INVALID', `${itemLocation}.status`, 'Composite status is invalid.');
    nonNegativeSafeInteger(dataField(fact, 'updatedAtMs', `${itemLocation}.updatedAtMs`), `${itemLocation}.updatedAtMs`);
    if (Object.prototype.hasOwnProperty.call(fact, 'cursor')) nonNegativeSafeInteger(dataField(fact, 'cursor', `${itemLocation}.cursor`), `${itemLocation}.cursor`);
    if (Object.prototype.hasOwnProperty.call(fact, 'childTreeId')) {
      canonicalIdentity(dataField(fact, 'childTreeId', `${itemLocation}.childTreeId`), `${itemLocation}.childTreeId`);
      if (primitive !== 'CallFlow') invalid('WORK_CTRL_CHILD_IDENTITY_INVALID', `${itemLocation}.childTreeId`, 'Only CallFlow composites can own a child tree identity.');
    }
  }
}

function closedRecordEntries(value: unknown, location: string): readonly [string, unknown, string][] {
  const record = plainRecord(value, location);
  return stringDataKeys(record, location).sort(compareCodeUnits).map((key) => {
    canonicalIdentity(key, `${location}.${key}`);
    const itemLocation = `${location}.${key}`;
    return [key, dataField(record, key, itemLocation), itemLocation] as const;
  });
}

function assertFactKey(fact: Record<string, unknown>, key: string, location: string): void {
  const invocationKey = canonicalIdentity(dataField(fact, 'invocationKey', `${location}.invocationKey`), `${location}.invocationKey`);
  if (invocationKey !== key) invalid('WORK_CTRL_FACT_IDENTITY_MISMATCH', `${location}.invocationKey`, 'Fact identity must equal its map key.');
}

function positiveSafeInteger(value: unknown, location: string): number {
  const normalized = nonNegativeSafeInteger(value, location);
  if (normalized === 0) invalid('FLOW_CONTRACT_POSITIVE_INTEGER_REQUIRED', location, 'Expected a positive safe integer.');
  return normalized;
}

function normalizeWaitHandles(
  value: unknown,
  treeId: string,
  collection: 'open' | 'closed',
  location: string,
): readonly { readonly waitHandleId: string; readonly resumeToken: string }[] {
  return closedArray(value, location).map((item, index) => {
    const itemLocation = `${location}[${index}]`;
    const handle = exactRecord(
      item,
      [
        'waitHandleId', 'treeId', 'nodeKey', 'invocationKey', 'waitKind', 'status',
        'signalKind', 'signalKey', 'resumeToken', 'deadlineAtMs',
      ],
      ['assignTo', 'closedAtMs', 'metadata'],
      itemLocation,
    );
    const waitHandleId = canonicalIdentity(
      dataField(handle, 'waitHandleId', `${itemLocation}.waitHandleId`),
      `${itemLocation}.waitHandleId`,
    );
    const ownerTreeId = canonicalIdentity(dataField(handle, 'treeId', `${itemLocation}.treeId`), `${itemLocation}.treeId`);
    if (ownerTreeId !== treeId) {
      invalid('FLOW_RUN_PROFILE_IDENTITY_MISMATCH', `${itemLocation}.treeId`, 'Wait handle owner must equal the snapshot tree identity.');
    }
    for (const field of ['nodeKey', 'invocationKey', 'signalKind', 'signalKey'] as const) {
      canonicalIdentity(dataField(handle, field, `${itemLocation}.${field}`), `${itemLocation}.${field}`);
    }
    const resumeToken = canonicalIdentity(dataField(handle, 'resumeToken', `${itemLocation}.resumeToken`), `${itemLocation}.resumeToken`);
    const waitKind = dataField(handle, 'waitKind', `${itemLocation}.waitKind`);
    if (waitKind !== 'external-job' && waitKind !== 'timer' && waitKind !== 'task-step') {
      invalid('WORK_CTRL_WAIT_KIND_INVALID', `${itemLocation}.waitKind`, 'Wait kind is not part of the public contract.');
    }
    const status = dataField(handle, 'status', `${itemLocation}.status`);
    if (collection === 'open' ? status !== 'Open' : !['Consumed', 'Expired', 'Cancelled'].includes(String(status))) {
      invalid('WORK_CTRL_WAIT_STATUS_INVALID', `${itemLocation}.status`, `Wait handle status does not belong in the ${collection} collection.`);
    }
    nonNegativeSafeInteger(dataField(handle, 'deadlineAtMs', `${itemLocation}.deadlineAtMs`), `${itemLocation}.deadlineAtMs`);
    if (Object.prototype.hasOwnProperty.call(handle, 'assignTo')) {
      canonicalIdentity(dataField(handle, 'assignTo', `${itemLocation}.assignTo`), `${itemLocation}.assignTo`);
    }
    if (Object.prototype.hasOwnProperty.call(handle, 'closedAtMs')) {
      nonNegativeSafeInteger(dataField(handle, 'closedAtMs', `${itemLocation}.closedAtMs`), `${itemLocation}.closedAtMs`);
      if (collection === 'open') {
        invalid('WORK_CTRL_OPEN_WAIT_HAS_CLOSED_AT', `${itemLocation}.closedAtMs`, 'Open wait handles cannot carry a close time.');
      }
    } else if (collection === 'closed') {
      invalid('WORK_CTRL_WAIT_CLOSED_AT_MISSING', `${itemLocation}.closedAtMs`, 'Closed wait handles require their close time.');
    }
    if (Object.prototype.hasOwnProperty.call(handle, 'metadata')) {
      plainRecord(dataField(handle, 'metadata', `${itemLocation}.metadata`), `${itemLocation}.metadata`);
    }
    return { waitHandleId, resumeToken };
  });
}

function normalizeAIDataRunGraph(value: unknown, runId: string, location: string): FlowClosedObject {
  const graph = cloneClosedObject(value, location);
  const record = exactRecord(
    graph,
    ['runId', 'binding', 'currentGeneration', 'nodes', 'declarationOrder', 'patchHistory', 'invalidations'],
    ['platformDefaultPolicy'],
    location,
  );
  let platformDefaultPolicy: 'semantic-hash' | 'never' | undefined;
  if (Object.prototype.hasOwnProperty.call(record, 'platformDefaultPolicy')) {
    const policy = dataField(record, 'platformDefaultPolicy', `${location}.platformDefaultPolicy`);
    if (policy !== 'semantic-hash' && policy !== 'never') {
      invalid('AI_DATA_PLATFORM_REUSE_POLICY_INVALID', `${location}.platformDefaultPolicy`, 'Platform default policy must be semantic-hash or never.');
    }
    platformDefaultPolicy = policy;
  }
  const graphRunId = canonicalIdentity(dataField(record, 'runId', `${location}.runId`), `${location}.runId`);
  if (graphRunId !== runId) {
    invalid('FLOW_RUN_PROFILE_IDENTITY_MISMATCH', `${location}.runId`, 'Run graph identity must equal the checkpoint run identity.');
  }
  const currentGeneration = nonNegativeSafeInteger(
    dataField(record, 'currentGeneration', `${location}.currentGeneration`),
    `${location}.currentGeneration`,
  );
  const bindingLocation = `${location}.binding`;
  const binding = exactRecord(
    dataField(record, 'binding', bindingLocation),
    ['kind', 'substrate', 'definition'],
    ['descriptor'],
    bindingLocation,
  );
  if (dataField(binding, 'kind', `${bindingLocation}.kind`) !== 'AIDataWorkflow'
    || dataField(binding, 'substrate', `${bindingLocation}.substrate`) !== 'EagerDataFlow') {
    invalid('AI_DATA_BINDING_INVALID', bindingLocation, 'Expected the AIDataWorkflow/EagerDataFlow binding.');
  }
  if (Object.prototype.hasOwnProperty.call(binding, 'descriptor')) {
    plainRecord(dataField(binding, 'descriptor', `${bindingLocation}.descriptor`), `${bindingLocation}.descriptor`);
  }
  normalizeAIDataDescriptor(binding, bindingLocation);
  const bindingDefinition = plainRecord(
    dataField(binding, 'definition', `${bindingLocation}.definition`),
    `${bindingLocation}.definition`,
  );
  normalizeEagerDataDefinition(bindingDefinition, `${bindingLocation}.definition`);
  validateEagerDataDefinitionReferences(bindingDefinition, `${bindingLocation}.definition`);

  const nodesLocation = `${location}.nodes`;
  const nodes = plainRecord(dataField(record, 'nodes', nodesLocation), nodesLocation);
  const nodeIds = stringDataKeys(nodes, nodesLocation).sort(compareCodeUnits);
  const definitionNodeIds = uniqueIdentityArray(
    dataField(bindingDefinition, 'declarationOrder', `${bindingLocation}.definition.declarationOrder`),
    `${bindingLocation}.definition.declarationOrder`,
  );
  for (const definitionNodeId of definitionNodeIds) {
    if (!Object.prototype.hasOwnProperty.call(nodes, definitionNodeId)) {
      invalid('AI_DATA_DEFINITION_NODE_MISSING', nodesLocation, `Definition node ${definitionNodeId} must remain in the durable RunGraph.`);
    }
  }
  const declarationOrder = uniqueIdentityArray(
    dataField(record, 'declarationOrder', `${location}.declarationOrder`),
    `${location}.declarationOrder`,
  );
  if (nodeIds.length !== declarationOrder.length
    || nodeIds.some((nodeId) => !declarationOrder.includes(nodeId))) {
    invalid('AI_DATA_DECLARATION_ORDER_INVALID', `${location}.declarationOrder`, 'Declaration order must contain every run node exactly once.');
  }
  const nodeInvalidationFacts = new Map<string, string[]>();
  const nodeGenerations = new Map<string, number>();
  const nodeStatuses = new Map<string, string>();
  const nodeResultGenerations: number[] = [];
  for (const nodeId of nodeIds) {
    canonicalIdentity(nodeId, `${nodesLocation}.${nodeId}`);
    const nodeLocation = `${nodesLocation}.${nodeId}`;
    const node = exactRecord(
      dataField(nodes, nodeId, nodeLocation),
      [
        'id', 'tag', 'nodeType', 'generation', 'status', 'declarationIndex', 'inputs',
        'outputs', 'config', 'dependsOn', 'dependents', 'reusePolicy',
      ],
      ['semanticFingerprint', 'result', 'invalidatedBy'],
      nodeLocation,
    );
    const storedId = canonicalIdentity(dataField(node, 'id', `${nodeLocation}.id`), `${nodeLocation}.id`);
    if (storedId !== nodeId) {
      invalid('AI_DATA_NODE_IDENTITY_MISMATCH', `${nodeLocation}.id`, 'Node identity must equal its map key.');
    }
    const generation = nonNegativeSafeInteger(dataField(node, 'generation', `${nodeLocation}.generation`), `${nodeLocation}.generation`);
    nodeGenerations.set(nodeId, generation);
    if (generation > currentGeneration) {
      invalid('AI_DATA_NODE_GENERATION_INVALID', `${nodeLocation}.generation`, 'Node generation cannot exceed graph generation.');
    }
    const status = dataField(node, 'status', `${nodeLocation}.status`);
    nodeStatuses.set(nodeId, String(status));
    if (!['Pending', 'Ready', 'Running', 'Succeeded', 'Failed', 'Invalidated', 'Reused', 'Removed'].includes(String(status))) {
      invalid('AI_DATA_NODE_STATUS_INVALID', `${nodeLocation}.status`, 'Node status is not part of the durable graph contract.');
    }
    canonicalIdentity(dataField(node, 'tag', `${nodeLocation}.tag`), `${nodeLocation}.tag`);
    const nodeType = canonicalIdentity(dataField(node, 'nodeType', `${nodeLocation}.nodeType`), `${nodeLocation}.nodeType`);
    nonNegativeSafeInteger(dataField(node, 'declarationIndex', `${nodeLocation}.declarationIndex`), `${nodeLocation}.declarationIndex`);
    normalizeAIDataInputs(dataField(node, 'inputs', `${nodeLocation}.inputs`), `${nodeLocation}.inputs`);
    uniqueIdentityArray(dataField(node, 'outputs', `${nodeLocation}.outputs`), `${nodeLocation}.outputs`);
    const config = plainRecord(dataField(node, 'config', `${nodeLocation}.config`), `${nodeLocation}.config`);
    const dependsOn = uniqueIdentityArray(dataField(node, 'dependsOn', `${nodeLocation}.dependsOn`), `${nodeLocation}.dependsOn`);
    const dependents = uniqueIdentityArray(dataField(node, 'dependents', `${nodeLocation}.dependents`), `${nodeLocation}.dependents`);
    normalizeReusePolicy(
      dataField(node, 'reusePolicy', `${nodeLocation}.reusePolicy`),
      nodeType,
      config,
      platformDefaultPolicy,
      `${nodeLocation}.reusePolicy`,
    );
    if (Object.prototype.hasOwnProperty.call(node, 'semanticFingerprint')) {
      normalizeSemanticFingerprint(
        dataField(node, 'semanticFingerprint', `${nodeLocation}.semanticFingerprint`),
        `${nodeLocation}.semanticFingerprint`,
      );
    }
    const hasResult = Object.prototype.hasOwnProperty.call(node, 'result');
    if (['Succeeded', 'Failed', 'Reused'].includes(String(status)) && !hasResult) {
      invalid('AI_DATA_TERMINAL_RESULT_MISSING', `${nodeLocation}.result`, 'Terminal execution nodes require a durable result.');
    }
    if (hasResult) {
      nodeResultGenerations.push(generation);
      const resultValue = dataField(node, 'result', `${nodeLocation}.result`);
      normalizeAIDataNodeResult(
        resultValue,
        nodeId,
        generation,
        String(status),
        Object.prototype.hasOwnProperty.call(node, 'semanticFingerprint')
          ? dataField(node, 'semanticFingerprint', `${nodeLocation}.semanticFingerprint`)
          : undefined,
        `${nodeLocation}.result`,
      );
      normalizeAIDataResultOutput(resultValue, node, String(status), bindingDefinition, `${nodeLocation}.result`);
    }
    const invalidationFacts: string[] = [];
    if (Object.prototype.hasOwnProperty.call(node, 'invalidatedBy')) {
      for (const [index, invalidation] of closedArray(
        dataField(node, 'invalidatedBy', `${nodeLocation}.invalidatedBy`),
        `${nodeLocation}.invalidatedBy`,
      ).entries()) {
        const normalized = normalizeAIDataInvalidation(invalidation, currentGeneration, `${nodeLocation}.invalidatedBy[${index}]`);
        if (normalized.nodeId !== nodeId) {
          invalid('AI_DATA_INVALIDATION_TARGET_MISMATCH', `${nodeLocation}.invalidatedBy[${index}].nodeId`, 'Node invalidation facts must identify their owning node.');
        }
        invalidationFacts.push(normalized.identity);
      }
    }
    nodeInvalidationFacts.set(nodeId, invalidationFacts);
    for (const dependency of dependsOn) {
      if (dependency === nodeId || !Object.prototype.hasOwnProperty.call(nodes, dependency)) {
        invalid('AI_DATA_NODE_DEPENDENCY_INVALID', `${nodeLocation}.dependsOn`, 'Dependencies must reference another run node.');
      }
    }
    for (const dependent of dependents) {
      if (dependent === nodeId || !Object.prototype.hasOwnProperty.call(nodes, dependent)) {
        invalid('AI_DATA_NODE_DEPENDENT_INVALID', `${nodeLocation}.dependents`, 'Dependents must reference another run node.');
      }
    }
    if (generation === 0) {
      normalizeInitialAIDataNodeProjection(node, nodeId, bindingDefinition, nodeLocation);
    }
  }
  normalizeAIDataDependencyProjection(nodes, declarationOrder, nodesLocation);
  normalizeAIDataInputReferenceProjection(nodes, declarationOrder, nodesLocation);
  const patchIds = new Set<string>();
  let previousPatchGeneration = 0;
  let maximumHistoryGeneration = Math.max(0, ...nodeResultGenerations);
  const removedNodeGenerations = new Map<string, number>();
  const seenRemovedNodeIds = new Set<string>();
  for (const [index, patch] of closedArray(
    dataField(record, 'patchHistory', `${location}.patchHistory`),
    `${location}.patchHistory`,
  ).entries()) {
    const normalized = normalizeAIDataPatchRecord(patch, currentGeneration, `${location}.patchHistory[${index}]`);
    const { patchId } = normalized;
    if (normalized.generation < previousPatchGeneration) {
      invalid('AI_DATA_PATCH_GENERATION_ROLLBACK', `${location}.patchHistory[${index}].generation`, 'Patch generations must be append-monotonic.');
    }
    previousPatchGeneration = normalized.generation;
    maximumHistoryGeneration = Math.max(maximumHistoryGeneration, normalized.generation);
    for (const targetNodeId of normalized.targetNodeIds) {
      if ((nodeGenerations.get(targetNodeId) ?? -1) < normalized.generation) {
        invalid('AI_DATA_PATCH_TARGET_GENERATION_INVALID', `${location}.patchHistory[${index}]`, 'Patch target generation cannot precede its patch fact.');
      }
    }
    for (const removedNodeId of normalized.removedNodeIds) {
      if (seenRemovedNodeIds.has(removedNodeId)) {
        invalid('AI_DATA_NODE_REMOVE_REPEATED', `${location}.patchHistory[${index}]`, 'A Removed tombstone cannot be removed again.');
      }
      seenRemovedNodeIds.add(removedNodeId);
      if (nodeStatuses.get(removedNodeId) !== 'Removed') {
        invalid('AI_DATA_REMOVED_NODE_STATUS_INVALID', `${location}.patchHistory[${index}]`, 'A remove operation must retain its target as a Removed node tombstone.');
      }
      removedNodeGenerations.set(removedNodeId, normalized.generation);
    }
    if (patchIds.has(patchId)) {
      invalid('AI_DATA_PATCH_ID_DUPLICATE', `${location}.patchHistory[${index}].patchId`, 'Patch identities must be unique.');
    }
    patchIds.add(patchId);
  }
  const graphInvalidationFacts: string[] = [];
  let previousInvalidationGeneration = 0;
  for (const [index, invalidation] of closedArray(
    dataField(record, 'invalidations', `${location}.invalidations`),
    `${location}.invalidations`,
  ).entries()) {
    const normalized = normalizeAIDataInvalidation(invalidation, currentGeneration, `${location}.invalidations[${index}]`);
    if (normalized.generation < previousInvalidationGeneration) {
      invalid('AI_DATA_INVALIDATION_GENERATION_ROLLBACK', `${location}.invalidations[${index}].generation`, 'Invalidation generations must be append-monotonic.');
    }
    previousInvalidationGeneration = normalized.generation;
    maximumHistoryGeneration = Math.max(maximumHistoryGeneration, normalized.generation);
    if (!Object.prototype.hasOwnProperty.call(nodes, normalized.nodeId)
      || !Object.prototype.hasOwnProperty.call(nodes, normalized.sourceNodeId)) {
      invalid('AI_DATA_INVALIDATION_ENDPOINT_INVALID', `${location}.invalidations[${index}]`, 'Invalidation endpoints must reference run graph nodes.');
    }
    if ((nodeGenerations.get(normalized.nodeId) ?? -1) < normalized.generation) {
      invalid('AI_DATA_INVALIDATION_TARGET_GENERATION_INVALID', `${location}.invalidations[${index}]`, 'Invalidation target generation cannot precede its invalidation fact.');
    }
    const targetLocation = `${nodesLocation}.${normalized.nodeId}`;
    const target = plainRecord(dataField(nodes, normalized.nodeId, targetLocation), targetLocation);
    if (nodeStatuses.get(normalized.nodeId) !== 'Invalidated'
      || nodeGenerations.get(normalized.nodeId) !== normalized.generation
      || Object.prototype.hasOwnProperty.call(target, 'result')
      || Object.prototype.hasOwnProperty.call(target, 'semanticFingerprint')) {
      invalid('AI_DATA_INVALIDATION_TARGET_PROJECTION_INVALID', `${location}.invalidations[${index}]`, 'Invalidation facts require an exact Invalidated target at the same generation without a result or fingerprint.');
    }
    graphInvalidationFacts.push(normalized.identity);
  }
  if (new Set(graphInvalidationFacts).size !== graphInvalidationFacts.length) {
    invalid('AI_DATA_INVALIDATION_DUPLICATE', `${location}.invalidations`, 'Graph invalidation facts must be unique.');
  }
  const projectedInvalidationFacts = declarationOrder.flatMap((nodeId) => nodeInvalidationFacts.get(nodeId) ?? []);
  if (graphInvalidationFacts.length !== projectedInvalidationFacts.length
    || graphInvalidationFacts.some((identity) => !projectedInvalidationFacts.includes(identity))) {
    invalid('AI_DATA_INVALIDATION_PROJECTION_MISMATCH', `${location}.invalidations`, 'Graph invalidations and node invalidatedBy facts must be reciprocal projections.');
  }
  if (maximumHistoryGeneration !== currentGeneration) {
    invalid('AI_DATA_HISTORY_GENERATION_MISMATCH', `${location}.currentGeneration`, 'Current generation must equal the latest patch or invalidation generation.');
  }
  for (const [nodeId, status] of nodeStatuses) {
    if (status === 'Removed' && removedNodeGenerations.get(nodeId) !== nodeGenerations.get(nodeId)) {
      invalid('AI_DATA_REMOVED_NODE_FACT_MISSING', `${nodesLocation}.${nodeId}.status`, 'Removed nodes require a same-generation remove patch fact.');
    }
  }
  return graph;
}

function normalizeAIDataResultOutput(
  value: unknown,
  node: Record<string, unknown>,
  nodeStatus: string,
  definition: Record<string, unknown>,
  location: string,
): void {
  const result = plainRecord(value, location);
  const hasOutput = Object.prototype.hasOwnProperty.call(result, 'output');
  const tag = String(dataField(node, 'tag', `${location}.nodeTag`));
  if (nodeStatus === 'Failed') {
    if (hasOutput) invalid('AI_DATA_FAILED_RESULT_OUTPUT_INVALID', `${location}.output`, 'Failed node results cannot retain successful output ports.');
    return;
  }
  if (nodeStatus !== 'Succeeded' && nodeStatus !== 'Reused') return;
  if (tag === 'SinkNode') {
    if (hasOutput) invalid('AI_DATA_SINK_RESULT_OUTPUT_INVALID', `${location}.output`, 'Sink node results cannot retain output ports.');
    return;
  }
  if (!hasOutput) {
    invalid('AI_DATA_RESULT_OUTPUT_MISSING', `${location}.output`, 'Successful data-producing nodes require durable output ports.');
  }
  const output = plainRecord(dataField(result, 'output', `${location}.output`), `${location}.output`);
  const expected = tag === 'ReturnNode'
    ? identityArray(
        dataField(
          plainRecord(dataField(definition, 'contract', `${location}.definitionContract`), `${location}.definitionContract`),
          'outputPorts',
          `${location}.definitionContract.outputPorts`,
        ),
        `${location}.definitionContract.outputPorts`,
      )
    : identityArray(dataField(node, 'outputs', `${location}.nodeOutputs`), `${location}.nodeOutputs`);
  const actual = stringDataKeys(output, `${location}.output`).sort(compareCodeUnits);
  const sortedExpected = [...expected].sort(compareCodeUnits);
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    invalid('AI_DATA_RESULT_OUTPUT_PROJECTION_MISMATCH', `${location}.output`, 'Result output keys must equal the node output port projection.');
  }
}

function normalizeInitialAIDataNodeProjection(
  node: Record<string, unknown>,
  nodeId: string,
  definition: Record<string, unknown>,
  location: string,
): void {
  const nodeById = plainRecord(dataField(definition, 'nodeById', `${location}.bindingNodeById`), `${location}.bindingNodeById`);
  if (!Object.prototype.hasOwnProperty.call(nodeById, nodeId)) return;
  const definitionNode = plainRecord(dataField(nodeById, nodeId, `${location}.bindingNode`), `${location}.bindingNode`);
  const projected = {
    tag: dataField(definitionNode, 'tag', `${location}.bindingNode.tag`),
    declarationIndex: dataField(definitionNode, 'declarationIndex', `${location}.bindingNode.declarationIndex`),
    inputs: Object.prototype.hasOwnProperty.call(definitionNode, 'inputs')
      ? dataField(definitionNode, 'inputs', `${location}.bindingNode.inputs`)
      : {},
    outputs: Object.prototype.hasOwnProperty.call(definitionNode, 'outputs')
      ? dataField(definitionNode, 'outputs', `${location}.bindingNode.outputs`)
      : [],
    config: Object.prototype.hasOwnProperty.call(definitionNode, 'config')
      ? dataField(definitionNode, 'config', `${location}.bindingNode.config`)
      : {},
    dependsOn: eagerDefinitionDependencies(definition, definitionNode, nodeId, location),
  };
  for (const field of ['tag', 'declarationIndex', 'inputs', 'outputs', 'config', 'dependsOn'] as const) {
    if (JSON.stringify(dataField(node, field, `${location}.${field}`)) !== JSON.stringify(projected[field])) {
      invalid('AI_DATA_NODE_PROJECTION_MISMATCH', `${location}.${field}`, `Initial run node ${field} differs from its binding projection.`);
    }
  }
}

function eagerDefinitionDependencies(
  definition: Record<string, unknown>,
  definitionNode: Record<string, unknown>,
  nodeId: string,
  location: string,
): readonly string[] {
  const dependencies = new Set<string>();
  const dataEdges = closedArray(dataField(definition, 'dataEdges', `${location}.bindingDataEdges`), `${location}.bindingDataEdges`);
  const waitEdges = closedArray(dataField(definition, 'waitForEdges', `${location}.bindingWaitEdges`), `${location}.bindingWaitEdges`);
  for (const edgeValue of [...dataEdges, ...waitEdges]) {
    const edge = plainRecord(edgeValue, `${location}.bindingEdge`);
    if (dataField(edge, 'toNodeId', `${location}.bindingEdge.toNodeId`) === nodeId) {
      dependencies.add(canonicalIdentity(dataField(edge, 'fromNodeId', `${location}.bindingEdge.fromNodeId`), `${location}.bindingEdge.fromNodeId`));
    }
  }
  for (const referenceValue of closedArray(dataField(definitionNode, 'waitFor', `${location}.bindingNode.waitFor`), `${location}.bindingNode.waitFor`)) {
    const reference = plainRecord(referenceValue, `${location}.bindingNode.waitFor`);
    dependencies.add(canonicalIdentity(dataField(reference, 'nodeId', `${location}.bindingNode.waitFor.nodeId`), `${location}.bindingNode.waitFor.nodeId`));
  }
  if (Object.prototype.hasOwnProperty.call(definitionNode, 'inputs')) {
    const inputs = plainRecord(dataField(definitionNode, 'inputs', `${location}.bindingNode.inputs`), `${location}.bindingNode.inputs`);
    for (const key of stringDataKeys(inputs, `${location}.bindingNode.inputs`).sort(compareCodeUnits)) {
      const reference = plainRecord(dataField(inputs, key, `${location}.bindingNode.inputs.${key}`), `${location}.bindingNode.inputs.${key}`);
      dependencies.add(canonicalIdentity(dataField(reference, 'nodeId', `${location}.bindingNode.inputs.${key}.nodeId`), `${location}.bindingNode.inputs.${key}.nodeId`));
    }
  }
  return [...dependencies];
}

function normalizeAIDataDependencyProjection(
  nodes: Record<string, unknown>,
  declarationOrder: readonly string[],
  location: string,
): void {
  const dependencies = new Map<string, readonly string[]>();
  for (const nodeId of declarationOrder) {
    const node = plainRecord(dataField(nodes, nodeId, `${location}.${nodeId}`), `${location}.${nodeId}`);
    dependencies.set(nodeId, identityArray(dataField(node, 'dependsOn', `${location}.${nodeId}.dependsOn`), `${location}.${nodeId}.dependsOn`));
  }
  for (const nodeId of declarationOrder) {
    const node = plainRecord(dataField(nodes, nodeId, `${location}.${nodeId}`), `${location}.${nodeId}`);
    const actual = identityArray(dataField(node, 'dependents', `${location}.${nodeId}.dependents`), `${location}.${nodeId}.dependents`);
    for (const dependency of dependencies.get(nodeId) ?? []) {
      const source = plainRecord(dataField(nodes, dependency, `${location}.${dependency}`), `${location}.${dependency}`);
      if (dataField(source, 'status', `${location}.${dependency}.status`) === 'Removed') {
        invalid('AI_DATA_REMOVED_NODE_REFERENCED', `${location}.${nodeId}.dependsOn`, 'A Removed node cannot remain a dependency.');
      }
    }
    const expected = declarationOrder.filter((candidate) => dependencies.get(candidate)?.includes(nodeId));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      invalid('AI_DATA_DEPENDENT_PROJECTION_MISMATCH', `${location}.${nodeId}.dependents`, 'Dependents must be the declaration-ordered inverse dependency projection.');
    }
  }
}

function normalizeAIDataInputReferenceProjection(
  nodes: Record<string, unknown>,
  declarationOrder: readonly string[],
  location: string,
): void {
  for (const nodeId of declarationOrder) {
    const nodeLocation = `${location}.${nodeId}`;
    const node = plainRecord(dataField(nodes, nodeId, nodeLocation), nodeLocation);
    const inputs = plainRecord(dataField(node, 'inputs', `${nodeLocation}.inputs`), `${nodeLocation}.inputs`);
    const dependsOn = identityArray(dataField(node, 'dependsOn', `${nodeLocation}.dependsOn`), `${nodeLocation}.dependsOn`);
    for (const inputName of stringDataKeys(inputs, `${nodeLocation}.inputs`).sort(compareCodeUnits)) {
      const input = dataField(inputs, inputName, `${nodeLocation}.inputs.${inputName}`);
      if (typeof input !== 'object' || input === null || Array.isArray(input)) continue;
      const reference = plainRecord(input, `${nodeLocation}.inputs.${inputName}`);
      const fields = stringDataKeys(reference, `${nodeLocation}.inputs.${inputName}`);
      if (!fields.some((field) => field === 'ref' || field === 'nodeId' || field === 'port')) continue;
      const sourceNodeId = canonicalIdentity(dataField(reference, 'nodeId', `${nodeLocation}.inputs.${inputName}.nodeId`), `${nodeLocation}.inputs.${inputName}.nodeId`);
      const sourcePort = canonicalIdentity(dataField(reference, 'port', `${nodeLocation}.inputs.${inputName}.port`), `${nodeLocation}.inputs.${inputName}.port`);
      if (dataField(reference, 'ref', `${nodeLocation}.inputs.${inputName}.ref`) !== `flow-port://#${sourceNodeId}/${sourcePort}`) {
        invalid('AI_DATA_INPUT_REF_IDENTITY_MISMATCH', `${nodeLocation}.inputs.${inputName}.ref`, 'Input ref must exactly project its source node and port.');
      }
      if (!Object.prototype.hasOwnProperty.call(nodes, sourceNodeId)) {
        invalid('AI_DATA_INPUT_SOURCE_MISSING', `${nodeLocation}.inputs.${inputName}.nodeId`, 'Input source node must exist in the RunGraph.');
      }
      const source = plainRecord(dataField(nodes, sourceNodeId, `${location}.${sourceNodeId}`), `${location}.${sourceNodeId}`);
      if (dataField(source, 'status', `${location}.${sourceNodeId}.status`) === 'Removed') {
        invalid('AI_DATA_REMOVED_NODE_REFERENCED', `${nodeLocation}.inputs.${inputName}`, 'A Removed node cannot remain an input source.');
      }
      const outputs = identityArray(dataField(source, 'outputs', `${location}.${sourceNodeId}.outputs`), `${location}.${sourceNodeId}.outputs`);
      if (!outputs.includes(sourcePort)) {
        invalid('AI_DATA_INPUT_SOURCE_PORT_MISSING', `${nodeLocation}.inputs.${inputName}.port`, 'Input source port must be declared by its source node.');
      }
      if (!dependsOn.includes(sourceNodeId)) {
        invalid('AI_DATA_INPUT_DEPENDENCY_MISMATCH', `${nodeLocation}.dependsOn`, 'Every input source must be projected by dependsOn.');
      }
    }
  }
}

function normalizeAIDataDescriptor(binding: Record<string, unknown>, location: string): void {
  if (!Object.prototype.hasOwnProperty.call(binding, 'descriptor')) return;
  const descriptorLocation = `${location}.descriptor`;
  const descriptor = exactRecord(
    dataField(binding, 'descriptor', descriptorLocation),
    ['kind', 'substrate', 'defaultReusePolicy', 'manualNodeDefaultReusePolicy'],
    [],
    descriptorLocation,
  );
  if (dataField(descriptor, 'kind', `${descriptorLocation}.kind`) !== 'AIDataWorkflow'
    || dataField(descriptor, 'substrate', `${descriptorLocation}.substrate`) !== 'EagerDataFlow'
    || !['semantic-hash', 'never'].includes(String(dataField(descriptor, 'defaultReusePolicy', `${descriptorLocation}.defaultReusePolicy`)))
    || dataField(descriptor, 'manualNodeDefaultReusePolicy', `${descriptorLocation}.manualNodeDefaultReusePolicy`) !== 'never') {
    invalid('AI_DATA_DESCRIPTOR_INVALID', descriptorLocation, 'AI Data descriptor fields do not match the public profile contract.');
  }
}

function normalizeAIDataInputs(value: unknown, location: string): void {
  const inputs = plainRecord(value, location);
  for (const name of stringDataKeys(inputs, location).sort(compareCodeUnits)) {
    canonicalIdentity(name, `${location}.${name}`);
    const input = dataField(inputs, name, `${location}.${name}`);
    if (typeof input !== 'object' || input === null || Array.isArray(input)) continue;
    const record = plainRecord(input, `${location}.${name}`);
    const fields = stringDataKeys(record, `${location}.${name}`);
    if (fields.some((field) => field === 'ref' || field === 'nodeId' || field === 'port')) {
      normalizeFlowPortReference(record, `${location}.${name}`);
    }
  }
}

function normalizeFlowPortReference(value: unknown, location: string): void {
  const reference = exactRecord(value, ['ref', 'nodeId', 'port'], [], location);
  for (const field of ['ref', 'nodeId', 'port'] as const) {
    canonicalIdentity(dataField(reference, field, `${location}.${field}`), `${location}.${field}`);
  }
}

function normalizeFlowNodeReference(value: unknown, location: string): void {
  const reference = exactRecord(value, ['ref', 'nodeId'], [], location);
  for (const field of ['ref', 'nodeId'] as const) {
    canonicalIdentity(dataField(reference, field, `${location}.${field}`), `${location}.${field}`);
  }
}

function normalizeReusePolicy(
  value: unknown,
  nodeType: string,
  config: Record<string, unknown>,
  platformDefaultPolicy: 'semantic-hash' | 'never' | undefined,
  location: string,
): void {
  const policy = exactRecord(value, ['policy', 'source', 'nodeType'], [], location);
  const policyValue = dataField(policy, 'policy', `${location}.policy`);
  if (!['semantic-hash', 'never'].includes(String(policyValue))) {
    invalid('AI_DATA_REUSE_POLICY_INVALID', `${location}.policy`, 'Reuse policy must be semantic-hash or never.');
  }
  const source = dataField(policy, 'source', `${location}.source`);
  if (!['node', 'node-type-default', 'platform-default'].includes(String(source))) {
    invalid('AI_DATA_REUSE_POLICY_SOURCE_INVALID', `${location}.source`, 'Reuse policy source is not part of the public contract.');
  }
  if (canonicalIdentity(dataField(policy, 'nodeType', `${location}.nodeType`), `${location}.nodeType`) !== nodeType) {
    invalid('AI_DATA_REUSE_POLICY_NODE_TYPE_MISMATCH', `${location}.nodeType`, 'Reuse policy node type must equal its run node.');
  }
  const explicit = config.reuse_policy ?? config.reusePolicy;
  const expected = explicit === 'semantic-hash' || explicit === 'never'
    ? { policy: explicit, source: 'node' }
    : nodeType === 'manual'
      ? { policy: 'never', source: 'node-type-default' }
      : platformDefaultPolicy !== undefined
        ? { policy: platformDefaultPolicy, source: 'platform-default' }
        : { policy: 'semantic-hash', source: 'node-type-default' };
  if (policyValue !== expected.policy || source !== expected.source) {
    invalid('AI_DATA_REUSE_POLICY_AUTHORITY_MISMATCH', location, 'Reuse policy must exactly match its node config, node-type default, or declared platform authority.');
  }
}

function normalizeSemanticFingerprint(value: unknown, location: string): void {
  const fingerprint = exactRecord(value, ['algorithm', 'value'], ['parts'], location);
  canonicalIdentity(dataField(fingerprint, 'algorithm', `${location}.algorithm`), `${location}.algorithm`);
  canonicalIdentity(dataField(fingerprint, 'value', `${location}.value`), `${location}.value`);
  if (!Object.prototype.hasOwnProperty.call(fingerprint, 'parts')) return;
  const names = new Set<string>();
  for (const [index, item] of closedArray(dataField(fingerprint, 'parts', `${location}.parts`), `${location}.parts`).entries()) {
    const partLocation = `${location}.parts[${index}]`;
    const part = exactRecord(item, ['name', 'value'], [], partLocation);
    const name = canonicalIdentity(dataField(part, 'name', `${partLocation}.name`), `${partLocation}.name`);
    canonicalIdentity(dataField(part, 'value', `${partLocation}.value`), `${partLocation}.value`);
    if (names.has(name)) invalid('AI_DATA_FINGERPRINT_PART_DUPLICATE', `${partLocation}.name`, 'Fingerprint part names must be unique.');
    names.add(name);
  }
}

function normalizeAIDataNodeResult(
  value: unknown,
  nodeId: string,
  nodeGeneration: number,
  nodeStatus: string,
  nodeFingerprint: unknown,
  location: string,
): void {
  const result = exactRecord(
    value,
    ['nodeId', 'generation', 'status'],
    ['output', 'semanticFingerprint', 'reusedFrom'],
    location,
  );
  if (canonicalIdentity(dataField(result, 'nodeId', `${location}.nodeId`), `${location}.nodeId`) !== nodeId) {
    invalid('AI_DATA_RESULT_NODE_IDENTITY_MISMATCH', `${location}.nodeId`, 'Result node identity must equal its run node.');
  }
  if (nonNegativeSafeInteger(dataField(result, 'generation', `${location}.generation`), `${location}.generation`) !== nodeGeneration) {
    invalid('AI_DATA_RESULT_GENERATION_INVALID', `${location}.generation`, 'Result generation must equal its run node generation.');
  }
  const resultStatus = String(dataField(result, 'status', `${location}.status`));
  if (!['Pending', 'Running', 'Waiting', 'Succeeded', 'Failed', 'Cancelled', 'Invalidated', 'Reused'].includes(resultStatus)) {
    invalid('AI_DATA_RESULT_STATUS_INVALID', `${location}.status`, 'Result status is not part of the public contract.');
  }
  const projectedStatus = resultStatus === 'Waiting'
    ? 'Running'
    : resultStatus === 'Cancelled'
      ? 'Failed'
      : resultStatus;
  if (nodeStatus !== 'Removed' && projectedStatus !== nodeStatus) {
    invalid('AI_DATA_RESULT_STATUS_MISMATCH', `${location}.status`, 'Result status must project to its run node status.');
  }
  if (Object.prototype.hasOwnProperty.call(result, 'semanticFingerprint')) {
    const resultFingerprint = dataField(result, 'semanticFingerprint', `${location}.semanticFingerprint`);
    normalizeSemanticFingerprint(resultFingerprint, `${location}.semanticFingerprint`);
    if (nodeFingerprint === undefined || JSON.stringify(resultFingerprint) !== JSON.stringify(nodeFingerprint)) {
      invalid('AI_DATA_RESULT_FINGERPRINT_MISMATCH', `${location}.semanticFingerprint`, 'Result fingerprint must equal its run node fingerprint.');
    }
  }
  if (Object.prototype.hasOwnProperty.call(result, 'reusedFrom')) {
    const reusedLocation = `${location}.reusedFrom`;
    const reused = exactRecord(dataField(result, 'reusedFrom', reusedLocation), ['runId', 'generation', 'nodeId'], [], reusedLocation);
    canonicalIdentity(dataField(reused, 'runId', `${reusedLocation}.runId`), `${reusedLocation}.runId`);
    nonNegativeSafeInteger(dataField(reused, 'generation', `${reusedLocation}.generation`), `${reusedLocation}.generation`);
    if (canonicalIdentity(dataField(reused, 'nodeId', `${reusedLocation}.nodeId`), `${reusedLocation}.nodeId`) !== nodeId) {
      invalid('AI_DATA_REUSED_NODE_IDENTITY_MISMATCH', `${reusedLocation}.nodeId`, 'Reused source node identity must equal its target node identity.');
    }
    if (nodeStatus !== 'Reused') {
      invalid('AI_DATA_REUSED_SOURCE_UNEXPECTED', reusedLocation, 'Only Reused nodes can retain a reusedFrom identity.');
    }
  }
  if (nodeStatus === 'Reused') {
    if (!Object.prototype.hasOwnProperty.call(result, 'reusedFrom')) {
      invalid('AI_DATA_REUSED_SOURCE_MISSING', `${location}.reusedFrom`, 'Reused nodes require their source identity.');
    }
    if (nodeFingerprint === undefined || !Object.prototype.hasOwnProperty.call(result, 'semanticFingerprint')) {
      invalid('AI_DATA_REUSED_FINGERPRINT_MISSING', location, 'Reused nodes require matching node and result fingerprints.');
    }
  }
}

function normalizeAIDataInvalidation(
  value: unknown,
  generation: number,
  location: string,
): { readonly nodeId: string; readonly sourceNodeId: string; readonly generation: number; readonly identity: string } {
  const invalidation = exactRecord(value, ['nodeId', 'generation', 'reason', 'sourceNodeId'], ['atMs'], location);
  const nodeId = canonicalIdentity(dataField(invalidation, 'nodeId', `${location}.nodeId`), `${location}.nodeId`);
  const itemGeneration = nonNegativeSafeInteger(dataField(invalidation, 'generation', `${location}.generation`), `${location}.generation`);
  if (itemGeneration > generation) invalid('AI_DATA_INVALIDATION_GENERATION_INVALID', `${location}.generation`, 'Invalidation generation cannot exceed graph generation.');
  canonicalIdentity(dataField(invalidation, 'reason', `${location}.reason`), `${location}.reason`);
  const sourceNodeId = canonicalIdentity(dataField(invalidation, 'sourceNodeId', `${location}.sourceNodeId`), `${location}.sourceNodeId`);
  if (Object.prototype.hasOwnProperty.call(invalidation, 'atMs')) {
    nonNegativeSafeInteger(dataField(invalidation, 'atMs', `${location}.atMs`), `${location}.atMs`);
  }
  return { nodeId, sourceNodeId, generation: itemGeneration, identity: JSON.stringify(invalidation) };
}

function normalizeAIDataPatchRecord(
  value: unknown,
  generation: number,
  location: string,
): {
  readonly patchId: string;
  readonly generation: number;
  readonly targetNodeIds: readonly string[];
  readonly removedNodeIds: readonly string[];
} {
  const patch = exactRecord(value, ['patchId', 'generation', 'operations'], ['reason', 'atMs'], location);
  const patchId = canonicalIdentity(dataField(patch, 'patchId', `${location}.patchId`), `${location}.patchId`);
  const patchGeneration = nonNegativeSafeInteger(dataField(patch, 'generation', `${location}.generation`), `${location}.generation`);
  if (patchGeneration === 0 || patchGeneration > generation) {
    invalid('AI_DATA_PATCH_GENERATION_INVALID', `${location}.generation`, 'Patch generation must be positive and cannot exceed graph generation.');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'reason')) canonicalIdentity(dataField(patch, 'reason', `${location}.reason`), `${location}.reason`);
  if (Object.prototype.hasOwnProperty.call(patch, 'atMs')) nonNegativeSafeInteger(dataField(patch, 'atMs', `${location}.atMs`), `${location}.atMs`);
  const targetNodeIds: string[] = [];
  const targetSet = new Set<string>();
  const removedNodeIds: string[] = [];
  for (const [index, operation] of closedArray(dataField(patch, 'operations', `${location}.operations`), `${location}.operations`).entries()) {
    const normalized = normalizeAIDataPatchOperation(operation, `${location}.operations[${index}]`);
    if (targetSet.has(normalized.nodeId)) {
      invalid('AI_DATA_PATCH_TARGET_DUPLICATE', `${location}.operations[${index}]`, `Patch targets node ${normalized.nodeId} more than once.`);
    }
    targetSet.add(normalized.nodeId);
    targetNodeIds.push(normalized.nodeId);
    if (normalized.op === 'remove-node') removedNodeIds.push(normalized.nodeId);
  }
  return { patchId, generation: patchGeneration, targetNodeIds, removedNodeIds };
}

function normalizeAIDataPatchOperation(
  value: unknown,
  location: string,
): { readonly op: 'add-node' | 'update-node' | 'remove-node'; readonly nodeId: string } {
  const operation = plainRecord(value, location);
  const op = dataField(operation, 'op', `${location}.op`);
  if (op === 'add-node') {
    const record = exactRecord(value, ['op', 'node'], [], location);
    return { op: 'add-node', nodeId: normalizeAIDataPatchNodeSpec(dataField(record, 'node', `${location}.node`), `${location}.node`) };
  }
  if (op === 'update-node') {
    const record = exactRecord(value, ['op', 'nodeId', 'changes'], [], location);
    const nodeId = canonicalIdentity(dataField(record, 'nodeId', `${location}.nodeId`), `${location}.nodeId`);
    normalizeAIDataPatchNodeChanges(dataField(record, 'changes', `${location}.changes`), `${location}.changes`);
    return { op: 'update-node', nodeId };
  }
  if (op === 'remove-node') {
    const record = exactRecord(value, ['op', 'nodeId'], [], location);
    return { op: 'remove-node', nodeId: canonicalIdentity(dataField(record, 'nodeId', `${location}.nodeId`), `${location}.nodeId`) };
  }
  invalid('AI_DATA_PATCH_OPERATION_INVALID', `${location}.op`, 'Patch operation is not part of the public contract.');
}

function normalizeAIDataPatchNodeSpec(value: unknown, location: string): string {
  const spec = exactRecord(
    value,
    ['id'],
    ['tag', 'nodeType', 'declarationIndex', 'inputs', 'outputs', 'config', 'dependsOn', 'reusePolicy'],
    location,
  );
  const nodeId = canonicalIdentity(dataField(spec, 'id', `${location}.id`), `${location}.id`);
  normalizeAIDataPatchNodeFields(spec, location);
  return nodeId;
}

function normalizeAIDataPatchNodeChanges(value: unknown, location: string): void {
  const changes = exactRecord(
    value,
    [],
    ['tag', 'nodeType', 'inputs', 'outputs', 'config', 'dependsOn', 'reusePolicy'],
    location,
  );
  normalizeAIDataPatchNodeFields(changes, location);
}

function normalizeAIDataPatchNodeFields(record: Record<string, unknown>, location: string): void {
  for (const field of ['tag', 'nodeType'] as const) {
    if (Object.prototype.hasOwnProperty.call(record, field)) canonicalIdentity(dataField(record, field, `${location}.${field}`), `${location}.${field}`);
  }
  if (Object.prototype.hasOwnProperty.call(record, 'declarationIndex')) nonNegativeSafeInteger(dataField(record, 'declarationIndex', `${location}.declarationIndex`), `${location}.declarationIndex`);
  if (Object.prototype.hasOwnProperty.call(record, 'inputs')) normalizeAIDataInputs(dataField(record, 'inputs', `${location}.inputs`), `${location}.inputs`);
  for (const field of ['outputs', 'dependsOn'] as const) {
    if (Object.prototype.hasOwnProperty.call(record, field)) uniqueIdentityArray(dataField(record, field, `${location}.${field}`), `${location}.${field}`);
  }
  if (Object.prototype.hasOwnProperty.call(record, 'config')) plainRecord(dataField(record, 'config', `${location}.config`), `${location}.config`);
  if (Object.prototype.hasOwnProperty.call(record, 'reusePolicy')) {
    const reuse = exactRecord(dataField(record, 'reusePolicy', `${location}.reusePolicy`), ['policy', 'source', 'nodeType'], [], `${location}.reusePolicy`);
    canonicalIdentity(dataField(reuse, 'nodeType', `${location}.reusePolicy.nodeType`), `${location}.reusePolicy.nodeType`);
    const policyValue = dataField(reuse, 'policy', `${location}.reusePolicy.policy`);
    if (policyValue !== 'semantic-hash' && policyValue !== 'never') {
      invalid('AI_DATA_REUSE_POLICY_INVALID', `${location}.reusePolicy.policy`, 'Reuse policy must be semantic-hash or never.');
    }
    const source = dataField(reuse, 'source', `${location}.reusePolicy.source`);
    if (source !== 'node' && source !== 'node-type-default' && source !== 'platform-default') {
      invalid('AI_DATA_REUSE_POLICY_SOURCE_INVALID', `${location}.reusePolicy.source`, 'Reuse policy source is not part of the public contract.');
    }
  }
}

function normalizeEagerDataDefinition(value: unknown, location: string): void {
  const definition = exactRecord(
    value,
    [
      'form', 'fqn', 'apiVersion', 'version', 'sourceNames', 'contract', 'nodes', 'nodeById',
      'declarationOrder', 'dataEdges', 'waitForEdges', 'subflowEdges', 'diagnostics',
    ],
    ['title', 'baseUri'],
    location,
  );
  if (dataField(definition, 'form', `${location}.form`) !== 'EagerDataFlow') {
    invalid('AI_DATA_DEFINITION_FORM_INVALID', `${location}.form`, 'Expected EagerDataFlow.');
  }
  for (const field of ['fqn', 'apiVersion', 'version'] as const) {
    canonicalIdentity(dataField(definition, field, `${location}.${field}`), `${location}.${field}`);
  }
  for (const field of ['title', 'baseUri'] as const) {
    if (Object.prototype.hasOwnProperty.call(definition, field)) {
      const normalized = canonicalIdentity(dataField(definition, field, `${location}.${field}`), `${location}.${field}`);
      if (field === 'baseUri' && isHostLocalBaseUri(normalized)) {
        invalid('AI_DATA_DEFINITION_BASE_URI_INVALID', `${location}.baseUri`, 'Durable bindings cannot retain a host-local base URI.');
      }
    }
  }
  identityArray(dataField(definition, 'sourceNames', `${location}.sourceNames`), `${location}.sourceNames`);
  normalizeEagerDataContract(dataField(definition, 'contract', `${location}.contract`), `${location}.contract`);
  const nodes = closedArray(dataField(definition, 'nodes', `${location}.nodes`), `${location}.nodes`);
  const nodeIds = nodes.map((node, index) => normalizeEagerDataNode(node, `${location}.nodes[${index}]`));
  if (new Set(nodeIds).size !== nodeIds.length) invalid('AI_DATA_DEFINITION_NODE_DUPLICATE', `${location}.nodes`, 'Definition node identities must be unique.');
  const nodeByIdLocation = `${location}.nodeById`;
  const nodeById = plainRecord(dataField(definition, 'nodeById', nodeByIdLocation), nodeByIdLocation);
  const mappedIds = stringDataKeys(nodeById, nodeByIdLocation).sort(compareCodeUnits);
  for (const nodeId of mappedIds) {
    canonicalIdentity(nodeId, `${nodeByIdLocation}.${nodeId}`);
    const mappedId = normalizeEagerDataNode(dataField(nodeById, nodeId, `${nodeByIdLocation}.${nodeId}`), `${nodeByIdLocation}.${nodeId}`);
    if (mappedId !== nodeId) invalid('AI_DATA_DEFINITION_NODE_IDENTITY_MISMATCH', `${nodeByIdLocation}.${nodeId}.id`, 'Mapped definition node identity must equal its key.');
  }
  const declarationOrder = uniqueIdentityArray(
    dataField(definition, 'declarationOrder', `${location}.declarationOrder`),
    `${location}.declarationOrder`,
  );
  if (mappedIds.length !== nodeIds.length
    || nodeIds.some((nodeId) => !mappedIds.includes(nodeId))
    || declarationOrder.length !== nodeIds.length
    || nodeIds.some((nodeId) => !declarationOrder.includes(nodeId))) {
    invalid('AI_DATA_DEFINITION_NODE_COLLECTION_MISMATCH', location, 'nodes, nodeById and declarationOrder must describe the same identities.');
  }
  for (const [index, nodeId] of nodeIds.entries()) {
    const mappedNode = dataField(nodeById, nodeId, `${nodeByIdLocation}.${nodeId}`);
    if (JSON.stringify(nodes[index]) !== JSON.stringify(mappedNode)) {
      invalid('AI_DATA_DEFINITION_NODE_PROJECTION_MISMATCH', `${nodeByIdLocation}.${nodeId}`, 'nodeById must be the exact projection of the matching nodes entry.');
    }
  }
  normalizeEagerDataEdges(dataField(definition, 'dataEdges', `${location}.dataEdges`), 'data', `${location}.dataEdges`);
  normalizeEagerDataEdges(dataField(definition, 'waitForEdges', `${location}.waitForEdges`), 'waitFor', `${location}.waitForEdges`);
  normalizeEagerDataEdges(dataField(definition, 'subflowEdges', `${location}.subflowEdges`), 'subflow', `${location}.subflowEdges`);
  for (const [index, item] of closedArray(dataField(definition, 'diagnostics', `${location}.diagnostics`), `${location}.diagnostics`).entries()) {
    const itemLocation = `${location}.diagnostics[${index}]`;
    const diagnostic = exactRecord(item, ['code', 'message'], ['source', 'nodeId'], itemLocation);
    for (const field of ['code', 'message', 'source', 'nodeId'] as const) {
      if (Object.prototype.hasOwnProperty.call(diagnostic, field)) canonicalIdentity(dataField(diagnostic, field, `${itemLocation}.${field}`), `${itemLocation}.${field}`);
    }
  }
}

function validateEagerDataDefinitionReferences(definition: Record<string, unknown>, location: string): void {
  const nodeById = plainRecord(dataField(definition, 'nodeById', `${location}.nodeById`), `${location}.nodeById`);
  const node = (nodeId: string, edgeLocation: string): Record<string, unknown> => {
    if (!Object.prototype.hasOwnProperty.call(nodeById, nodeId)) {
      invalid('AI_DATA_DEFINITION_EDGE_ENDPOINT_INVALID', edgeLocation, 'Definition edge endpoints must reference declared nodes.');
    }
    return plainRecord(dataField(nodeById, nodeId, `${location}.nodeById.${nodeId}`), `${location}.nodeById.${nodeId}`);
  };
  for (const [index, item] of closedArray(dataField(definition, 'dataEdges', `${location}.dataEdges`), `${location}.dataEdges`).entries()) {
    const edgeLocation = `${location}.dataEdges[${index}]`;
    const edge = plainRecord(item, edgeLocation);
    const fromNodeId = canonicalIdentity(dataField(edge, 'fromNodeId', `${edgeLocation}.fromNodeId`), `${edgeLocation}.fromNodeId`);
    const toNodeId = canonicalIdentity(dataField(edge, 'toNodeId', `${edgeLocation}.toNodeId`), `${edgeLocation}.toNodeId`);
    const fromPort = canonicalIdentity(dataField(edge, 'fromPort', `${edgeLocation}.fromPort`), `${edgeLocation}.fromPort`);
    const toInput = canonicalIdentity(dataField(edge, 'toInput', `${edgeLocation}.toInput`), `${edgeLocation}.toInput`);
    const source = node(fromNodeId, edgeLocation);
    const target = node(toNodeId, edgeLocation);
    const outputs = Object.prototype.hasOwnProperty.call(source, 'outputs')
      ? identityArray(dataField(source, 'outputs', `${edgeLocation}.source.outputs`), `${edgeLocation}.source.outputs`)
      : [];
    const inputs = Object.prototype.hasOwnProperty.call(target, 'inputs')
      ? plainRecord(dataField(target, 'inputs', `${edgeLocation}.target.inputs`), `${edgeLocation}.target.inputs`)
      : {};
    if (!outputs.includes(fromPort) || !Object.prototype.hasOwnProperty.call(inputs, toInput)) {
      invalid('AI_DATA_DEFINITION_EDGE_PORT_INVALID', edgeLocation, 'Data edges must reference declared source ports and target inputs.');
    }
    const targetRef = plainRecord(dataField(inputs, toInput, `${edgeLocation}.target.inputs.${toInput}`), `${edgeLocation}.target.inputs.${toInput}`);
    if (dataField(targetRef, 'nodeId', `${edgeLocation}.target.inputs.${toInput}.nodeId`) !== fromNodeId
      || dataField(targetRef, 'port', `${edgeLocation}.target.inputs.${toInput}.port`) !== fromPort
      || dataField(targetRef, 'ref', `${edgeLocation}.target.inputs.${toInput}.ref`) !== dataField(edge, 'ref', `${edgeLocation}.ref`)) {
      invalid('AI_DATA_DEFINITION_EDGE_PROJECTION_MISMATCH', edgeLocation, 'Data edge must equal the target input port projection.');
    }
  }
  for (const collection of ['waitForEdges'] as const) {
    for (const [index, item] of closedArray(dataField(definition, collection, `${location}.${collection}`), `${location}.${collection}`).entries()) {
      const edgeLocation = `${location}.${collection}[${index}]`;
      const edge = plainRecord(item, edgeLocation);
      node(canonicalIdentity(dataField(edge, 'fromNodeId', `${edgeLocation}.fromNodeId`), `${edgeLocation}.fromNodeId`), edgeLocation);
      node(canonicalIdentity(dataField(edge, 'toNodeId', `${edgeLocation}.toNodeId`), `${edgeLocation}.toNodeId`), edgeLocation);
    }
  }
}

function normalizeEagerDataContract(value: unknown, location: string): void {
  const contract = exactRecord(value, ['id', 'inputPorts', 'outputPorts'], ['input', 'output'], location);
  canonicalIdentity(dataField(contract, 'id', `${location}.id`), `${location}.id`);
  uniqueIdentityArray(dataField(contract, 'inputPorts', `${location}.inputPorts`), `${location}.inputPorts`);
  uniqueIdentityArray(dataField(contract, 'outputPorts', `${location}.outputPorts`), `${location}.outputPorts`);
  for (const field of ['input', 'output'] as const) {
    if (Object.prototype.hasOwnProperty.call(contract, field)) canonicalIdentity(dataField(contract, field, `${location}.${field}`), `${location}.${field}`);
  }
}

function normalizeEagerDataNode(value: unknown, location: string): string {
  const base = plainRecord(value, location);
  const tag = dataField(base, 'tag', `${location}.tag`);
  const shapes: Record<string, { required: readonly string[]; optional: readonly string[] }> = {
    EntryNode: { required: ['tag', 'id', 'declarationIndex', 'waitFor', 'outputs'], optional: [] },
    TransformNode: { required: ['tag', 'id', 'declarationIndex', 'waitFor', 'inputs', 'outputs', 'config'], optional: ['type', 'src', 'impl'] },
    SinkNode: { required: ['tag', 'id', 'declarationIndex', 'waitFor', 'inputs', 'config'], optional: ['type', 'src', 'impl'] },
    SubFlowNode: { required: ['tag', 'id', 'declarationIndex', 'waitFor', 'flow', 'inputs', 'outputs'], optional: [] },
    ReturnNode: { required: ['tag', 'id', 'declarationIndex', 'waitFor', 'inputs'], optional: [] },
  };
  const shape = typeof tag === 'string' ? shapes[tag] : undefined;
  if (!shape) invalid('AI_DATA_DEFINITION_NODE_TAG_INVALID', `${location}.tag`, 'Definition node tag is not part of EagerDataFlow.');
  const node = exactRecord(value, shape.required, shape.optional, location);
  const id = canonicalIdentity(dataField(node, 'id', `${location}.id`), `${location}.id`);
  nonNegativeSafeInteger(dataField(node, 'declarationIndex', `${location}.declarationIndex`), `${location}.declarationIndex`);
  for (const [index, reference] of closedArray(dataField(node, 'waitFor', `${location}.waitFor`), `${location}.waitFor`).entries()) {
    normalizeFlowNodeReference(reference, `${location}.waitFor[${index}]`);
  }
  if (Object.prototype.hasOwnProperty.call(node, 'inputs')) {
    const inputs = plainRecord(dataField(node, 'inputs', `${location}.inputs`), `${location}.inputs`);
    for (const name of stringDataKeys(inputs, `${location}.inputs`).sort(compareCodeUnits)) {
      canonicalIdentity(name, `${location}.inputs.${name}`);
      normalizeFlowPortReference(dataField(inputs, name, `${location}.inputs.${name}`), `${location}.inputs.${name}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(node, 'outputs')) uniqueIdentityArray(dataField(node, 'outputs', `${location}.outputs`), `${location}.outputs`);
  if (Object.prototype.hasOwnProperty.call(node, 'config')) plainRecord(dataField(node, 'config', `${location}.config`), `${location}.config`);
  for (const field of ['type', 'src', 'impl', 'flow'] as const) {
    if (Object.prototype.hasOwnProperty.call(node, field)) canonicalIdentity(dataField(node, field, `${location}.${field}`), `${location}.${field}`);
  }
  return id;
}

function normalizeEagerDataEdges(value: unknown, kind: 'data' | 'waitFor' | 'subflow', location: string): void {
  for (const [index, item] of closedArray(value, location).entries()) {
    const itemLocation = `${location}[${index}]`;
    const fields = kind === 'data'
      ? ['kind', 'fromNodeId', 'fromPort', 'toNodeId', 'toInput', 'ref']
      : kind === 'waitFor'
        ? ['kind', 'fromNodeId', 'toNodeId', 'ref']
        : ['kind', 'fromFlowId', 'nodeId', 'targetFlowId', 'ref'];
    const edge = exactRecord(item, fields, [], itemLocation);
    if (dataField(edge, 'kind', `${itemLocation}.kind`) !== kind) invalid('AI_DATA_DEFINITION_EDGE_KIND_INVALID', `${itemLocation}.kind`, 'Edge kind differs from its collection.');
    for (const field of fields.filter((field) => field !== 'kind')) {
      canonicalIdentity(dataField(edge, field, `${itemLocation}.${field}`), `${itemLocation}.${field}`);
    }
  }
}

function isHostLocalBaseUri(value: string): boolean {
  return value.startsWith('/')
    || value.startsWith('\\\\')
    || value.startsWith('file:')
    || /^[A-Za-z]:[\\/]/u.test(value);
}

function closedArray(value: unknown, location: string): readonly FlowClosedValue[] {
  if (!Array.isArray(value)) invalid('FLOW_CLOSED_ARRAY_REQUIRED', location, 'Expected a closed array.');
  return value as readonly FlowClosedValue[];
}

function identityArray(value: unknown, location: string): readonly string[] {
  const values = closedArray(value, location);
  return values.map((item, index) => canonicalIdentity(item, `${location}[${index}]`));
}

function uniqueIdentityArray(value: unknown, location: string): readonly string[] {
  const values = identityArray(value, location);
  if (new Set(values).size !== values.length) invalid('FLOW_IDENTITY_ARRAY_DUPLICATE', location, 'Identity arrays cannot contain duplicates.');
  return values;
}

export function normalizeAIWorkflowProfileDurableState(
  value: unknown,
  location = 'ai',
): AIWorkflowProfileDurableState {
  return normalizeCanonicalAIAgentState(value, location);
}

function cloneClosedObject(value: unknown, location: string): FlowClosedObject {
  const cloned = cloneClosedValue(value, location);
  if (typeof cloned !== 'object' || cloned === null || Array.isArray(cloned)) {
    invalid('FLOW_CLOSED_OBJECT_REQUIRED', location, 'Expected a closed plain-data object.');
  }
  return cloned as FlowClosedObject;
}

/** Public closed-data boundary for adapters that must inspect normalized records. */
export function normalizeFlowClosedObject(value: unknown, location = 'value'): FlowClosedObject {
  return cloneClosedObject(value, location);
}

function cloneClosedValue(
  value: unknown,
  location: string,
  ancestors: WeakSet<object> = new WeakSet(),
): FlowClosedValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('FLOW_CLOSED_NUMBER_INVALID', location, 'Numbers must be finite.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    invalid('FLOW_CLOSED_VALUE_INVALID', location, 'Expected JSON-compatible closed data.');
  }
  if (ancestors.has(value)) invalid('FLOW_CLOSED_CYCLE', location, 'Closed data must not contain cycles.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        invalid('FLOW_CLOSED_ARRAY_INVALID', location, 'Arrays must use the standard Array prototype.');
      }
      const keys = Reflect.ownKeys(value);
      const expected = new Set<string>(['length']);
      for (let index = 0; index < value.length; index += 1) expected.add(String(index));
      if (keys.some((key) => typeof key !== 'string' || !expected.has(key))) {
        invalid('FLOW_CLOSED_ARRAY_INVALID', location, 'Arrays must be dense and contain no additional properties.');
      }
      const output: FlowClosedValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          invalid('FLOW_CLOSED_ARRAY_INVALID', `${location}[${index}]`, 'Array entries must be enumerable data properties.');
        }
        output.push(cloneClosedValue(descriptor.value, `${location}[${index}]`, ancestors));
      }
      return Object.freeze(output);
    }
    const record = plainRecord(value, location);
    const output: Record<string, FlowClosedValue> = {};
    for (const key of stringDataKeys(record, location).sort(compareCodeUnits)) {
      Object.defineProperty(output, key, {
        value: cloneClosedValue(dataField(record, key, `${location}.${key}`), `${location}.${key}`, ancestors),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
}

/** Public closed-data normalizer for complete scalar/array/object values. */
export function normalizeFlowClosedValue(value: unknown, location = 'value'): FlowClosedValue {
  return cloneClosedValue(value, location);
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  location: string,
): Record<string, unknown> {
  const record = plainRecord(value, location);
  const allowed = new Set([...required, ...optional]);
  const keys = stringDataKeys(record, location);
  const unsupported = keys.filter((key) => !allowed.has(key));
  if (unsupported.length > 0) {
    invalid('FLOW_CONTRACT_FIELD_UNSUPPORTED', `${location}.${unsupported.sort(compareCodeUnits)[0]}`, 'Field is not part of the closed contract.');
  }
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      invalid('FLOW_CONTRACT_FIELD_MISSING', `${location}.${field}`, 'Required field is missing.');
    }
  }
  return record;
}

function plainRecord(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('FLOW_CONTRACT_OBJECT_INVALID', location, 'Expected a plain-data object.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid('FLOW_CONTRACT_OBJECT_INVALID', location, 'Expected a plain-data object.');
  }
  return value as Record<string, unknown>;
}

function stringDataKeys(record: Record<string, unknown>, location: string): string[] {
  const keys = Reflect.ownKeys(record);
  if (keys.some((key) => typeof key !== 'string')) {
    invalid('FLOW_CONTRACT_SYMBOL_FIELD', location, 'Symbol fields are not closed data.');
  }
  const strings = keys as string[];
  for (const key of strings) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      invalid('FLOW_CONTRACT_DATA_FIELD_REQUIRED', `${location}.${key}`, 'Fields must be enumerable data properties.');
    }
  }
  return strings;
}

function dataField(record: Record<string, unknown>, field: string, location: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
    invalid('FLOW_CONTRACT_DATA_FIELD_REQUIRED', location, 'Expected an enumerable data property.');
  }
  return descriptor.value;
}

function canonicalIdentity(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    invalid('FLOW_CONTRACT_IDENTITY_INVALID', location, 'Expected a non-empty canonical string.');
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown, location: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid('FLOW_CONTRACT_VERSION_INVALID', location, 'Expected a non-negative safe integer.');
  }
  return value;
}

function invalid(code: string, location: string, message: string): never {
  throw new FlowRunContractValidationError(code, location, message);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
