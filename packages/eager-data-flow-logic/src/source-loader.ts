import {
  parseXnl,
  wordToString,
  type DataElementNode,
  type XnlNode,
} from 'xnl-core';
import type {
  EagerDataEdge,
  EagerDataFlowAuthoringPlan,
  EagerDataFlowContract,
  EagerDataFlowDiagnostic,
  EagerDataFlowLoadResult,
  EagerDataFlowNodePlan,
  EagerDataFlowRegistryEntry,
  EagerDataFlowSourceCollection,
  EagerDataFlowValue,
  EagerSubflowEdge,
  EagerWaitForEdge,
  FlowNodeReference,
  FlowPortReference,
  LoadEagerDataFlowOptions,
} from 'eager-data-flow-contract';

const NODE_TAGS = new Set([
  'EntryNode',
  'TransformNode',
  'SinkNode',
  'SubFlowNode',
  'ReturnNode',
]);

const LAZY_NODE_TAGS = new Set([
  'SignalNode',
  'ComputedNode',
  'ProcessorNode',
  'AsyncNode',
  'ConsumerNode',
  'ComputeNode',
  'ConsumeNode',
]);

const AUXILIARY_ROOT_TAGS = new Set([
  'FlowContract',
  'FlowAuthoring',
  'Config',
  'ConfigDef',
]);

const LOCAL_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const FQN = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)+$/;
const FLOW_PORT_REF = /^flow-port:\/\/#([A-Za-z_][A-Za-z0-9_-]*)\/([A-Za-z_][A-Za-z0-9_-]*)$/;
const FLOW_NODE_REF = /^flow-node:\/\/#([A-Za-z_][A-Za-z0-9_-]*)$/;
const SUBFLOW_REF = /^eager-data-flow:\/\/([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)+)$/;
const VFS_REF = /^vfs:\/\/.+#[A-Za-z_$][A-Za-z0-9_$]*$/;

interface ParsedRoot {
  element: DataElementNode;
  source: string;
}

interface DiagnosticSink {
  diagnostics: EagerDataFlowDiagnostic[];
  note: (
    code: string,
    message: string,
    context?: Partial<Pick<EagerDataFlowDiagnostic, 'source' | 'nodeId'>>,
  ) => void;
}

const isDataElement = (node: unknown): node is DataElementNode =>
  !!node && typeof node === 'object' && (node as DataElementNode).kind === 'DataElement';

const listChildren = (element: DataElementNode): DataElementNode[] =>
  (element.body ?? []).filter(isDataElement);

const sectionChildren = (element: DataElementNode): DataElementNode[] => {
  if (!element.extend) return [];
  const order = element.extend.order ?? Object.keys(element.extend.children);
  return order.map((key) => element.extend!.children[key]).filter(isDataElement);
};

const idOf = (element: DataElementNode): string => wordToString(element.id) ?? '';

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if ('kind' in value) return undefined;
  return value as Record<string, unknown>;
};

const keysEqual = (actual: readonly string[], expected: readonly string[]): boolean => {
  if (actual.length !== expected.length) return false;
  const expectedSet = new Set(expected);
  return actual.every((key) => expectedSet.has(key));
};

function normalizeSources(sources: EagerDataFlowSourceCollection, sink: DiagnosticSink) {
  const entries = Array.isArray(sources)
    ? sources.map(({ name, content }) => ({ name, content }))
    : Object.entries(sources).map(([name, content]) => ({ name, content }));
  entries.sort((left, right) => left.name.localeCompare(right.name));

  const seen = new Set<string>();
  for (const source of entries) {
    if (seen.has(source.name)) {
      sink.note('duplicate-source-name', `XNL source name "${source.name}" is duplicated`, {
        source: source.name,
      });
    }
    seen.add(source.name);
  }
  return entries;
}

function toSerializableValue(value: unknown): EagerDataFlowValue | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const result: EagerDataFlowValue[] = [];
    for (const item of value) {
      const converted = toSerializableValue(item);
      if (converted === undefined) return undefined;
      result.push(converted);
    }
    return result;
  }
  if (value && typeof value === 'object') {
    if ((value as { kind?: string }).kind === 'Word') {
      return wordToString(value as Parameters<typeof wordToString>[0]) ?? '';
    }
    if ('kind' in value) return undefined;
    const result: Record<string, EagerDataFlowValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const converted = toSerializableValue(item);
      if (converted === undefined) return undefined;
      result[key] = converted;
    }
    return result;
  }
  return undefined;
}

function readString(
  value: unknown,
  field: string,
  nodeId: string,
  sink: DiagnosticSink,
  required = false,
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value) {
    sink.note('invalid-node-field', `${nodeId}.${field} must be a non-empty string`, { nodeId });
    return undefined;
  }
  return value;
}

function readPorts(
  value: unknown,
  owner: string,
  field: string,
  sink: DiagnosticSink,
): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((port) => typeof port !== 'string')) {
    sink.note('invalid-port-list', `${owner}.${field} must be a non-empty string list`);
    return [];
  }
  const ports = value as string[];
  const seen = new Set<string>();
  for (const port of ports) {
    if (!LOCAL_NAME.test(port)) {
      sink.note('invalid-port-name', `${owner}.${field} contains invalid port "${port}"`);
    }
    if (seen.has(port)) sink.note('duplicate-port', `${owner}.${field} contains duplicate port "${port}"`);
    seen.add(port);
  }
  return [...ports];
}

function readInputs(
  value: unknown,
  nodeId: string,
  sink: DiagnosticSink,
  required = true,
): Record<string, FlowPortReference> {
  const record = asRecord(value);
  if (!record || (required && Object.keys(record).length === 0)) {
    sink.note('invalid-inputs', `${nodeId}.inputs must be a non-empty map`, { nodeId });
    return {};
  }
  const inputs: Record<string, FlowPortReference> = {};
  for (const [input, ref] of Object.entries(record)) {
    if (!LOCAL_NAME.test(input)) {
      sink.note('invalid-port-name', `${nodeId}.inputs contains invalid input "${input}"`, { nodeId });
    }
    const refValue = typeof ref === 'string' ? ref : undefined;
    const match = refValue ? FLOW_PORT_REF.exec(refValue) : null;
    if (!match) {
      sink.note(
        'invalid-flow-port-ref',
        `${nodeId}.inputs.${input} must use flow-port://#node/port`,
        { nodeId },
      );
      continue;
    }
    inputs[input] = { ref: refValue!, nodeId: match[1], port: match[2] };
  }
  return inputs;
}

function readWaitFor(value: unknown, nodeId: string, sink: DiagnosticSink): FlowNodeReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    sink.note('invalid-wait-for', `${nodeId}.waitFor must be a list of flow-node:// refs`, { nodeId });
    return [];
  }
  const refs: FlowNodeReference[] = [];
  for (const ref of value) {
    const match = typeof ref === 'string' ? FLOW_NODE_REF.exec(ref) : null;
    if (!match) {
      sink.note('invalid-flow-node-ref', `${nodeId}.waitFor must use flow-node://#node`, { nodeId });
      continue;
    }
    refs.push({ ref, nodeId: match[1] });
  }
  return refs;
}

function readConfig(value: unknown, nodeId: string, sink: DiagnosticSink) {
  if (value === undefined) return {};
  const record = asRecord(value);
  const converted = record ? toSerializableValue(record) : undefined;
  if (!converted || Array.isArray(converted) || typeof converted !== 'object') {
    sink.note('invalid-node-config', `${nodeId}.config must be a serializable object`, { nodeId });
    return {};
  }
  return converted as Record<string, EagerDataFlowValue>;
}

function checkFields(
  attrs: Record<string, XnlNode>,
  allowed: ReadonlySet<string>,
  nodeId: string,
  sink: DiagnosticSink,
) {
  for (const field of Object.keys(attrs)) {
    if (!allowed.has(field)) {
      sink.note('node-field-not-allowed', `${nodeId}.${field} is not allowed on this node`, { nodeId });
    }
  }
}

function validateCodeRef(value: string | undefined, field: string, nodeId: string, sink: DiagnosticSink) {
  if (value !== undefined && !VFS_REF.test(value)) {
    sink.note('invalid-code-ref', `${nodeId}.${field} must use vfs://path#Export`, { nodeId });
  }
}

function validateRegistryEntry(
  target: string,
  entry: EagerDataFlowRegistryEntry,
  nodeId: string,
  sink: DiagnosticSink,
): EagerDataFlowContract | undefined {
  if (entry.form !== 'EagerDataFlow') {
    sink.note('subflow-root-mismatch', `${nodeId} target ${target} is not an EagerDataFlow`, { nodeId });
    return undefined;
  }
  if (!entry.contract || entry.contract.id !== target) {
    sink.note('subflow-contract-mismatch', `${nodeId} target ${target} has a mismatched FlowContract`, {
      nodeId,
    });
    return undefined;
  }
  const inputPorts = entry.contract.inputPorts;
  const outputPorts = entry.contract.outputPorts;
  if (
    !Array.isArray(inputPorts) ||
    !Array.isArray(outputPorts) ||
    inputPorts.length === 0 ||
    outputPorts.length === 0 ||
    [...inputPorts, ...outputPorts].some((port) => typeof port !== 'string' || !LOCAL_NAME.test(port)) ||
    new Set(inputPorts).size !== inputPorts.length ||
    new Set(outputPorts).size !== outputPorts.length
  ) {
    sink.note('invalid-subflow-contract', `${nodeId} target ${target} has invalid contract ports`, {
      nodeId,
    });
    return undefined;
  }
  return entry.contract;
}

function registryTargets(entry: EagerDataFlowRegistryEntry | undefined): string[] {
  if (!entry) return [];
  return [
    ...(entry.subflowTargets ?? []),
    ...(entry.subflowEdges ?? []).map((edge) => edge.targetFlowId),
  ];
}

function validateSubflowRecursion(
  rootFqn: string,
  localTargets: readonly string[],
  options: LoadEagerDataFlowOptions,
  sink: DiagnosticSink,
) {
  const registry = options.registry ?? {};
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  let reported = false;

  const visit = (flowId: string): void => {
    if (reported || visited.has(flowId)) return;
    if (visiting.has(flowId)) {
      const start = stack.indexOf(flowId);
      const cycle = [...stack.slice(Math.max(start, 0)), flowId];
      sink.note('recursive-subflow', `recursive subflow call graph: ${cycle.join(' -> ')}`);
      reported = true;
      return;
    }
    visiting.add(flowId);
    stack.push(flowId);
    const targets = flowId === rootFqn ? [...localTargets] : registryTargets(registry[flowId]);
    for (const target of targets) visit(target);
    stack.pop();
    visiting.delete(flowId);
    visited.add(flowId);
  };

  visit(rootFqn);
}

function validateTopology(
  nodes: readonly EagerDataFlowNodePlan[],
  dataEdges: readonly EagerDataEdge[],
  waitForEdges: readonly EagerWaitForEdge[],
  sink: DiagnosticSink,
) {
  const declarationOrder = nodes.map((node) => node.id);
  const adjacency = new Map(declarationOrder.map((id) => [id, new Set<string>()]));
  for (const edge of [...dataEdges, ...waitForEdges]) {
    adjacency.get(edge.fromNodeId)?.add(edge.toNodeId);
  }

  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  let cycleReported = false;
  const visit = (nodeId: string): void => {
    if (cycleReported || state.get(nodeId) === 2) return;
    if (state.get(nodeId) === 1) {
      const start = stack.indexOf(nodeId);
      sink.note('union-dag-cycle', `union dependency DAG contains cycle: ${[...stack.slice(start), nodeId].join(' -> ')}`);
      cycleReported = true;
      return;
    }
    state.set(nodeId, 1);
    stack.push(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) visit(target);
    stack.pop();
    state.set(nodeId, 2);
  };
  for (const nodeId of declarationOrder) visit(nodeId);

  const entry = nodes.find((node) => node.tag === 'EntryNode');
  if (!entry) return;
  const reachable = new Set<string>();
  const queue = [entry.id];
  while (queue.length) {
    const nodeId = queue.shift()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    queue.push(...(adjacency.get(nodeId) ?? []));
  }
  for (const nodeId of declarationOrder) {
    if (!reachable.has(nodeId)) {
      sink.note('unreachable-node', `node ${nodeId} is not reachable from EntryNode`, { nodeId });
    }
  }
}

export interface LoadEagerDataFlowProfileSourcesOptions extends LoadEagerDataFlowOptions {
  profileRoot: string;
}

export function loadEagerDataFlowSources(
  sources: EagerDataFlowSourceCollection,
  options: LoadEagerDataFlowOptions = {},
): EagerDataFlowLoadResult {
  return loadEagerDataSources(sources, options, 'EagerDataFlow');
}

export function loadEagerDataFlowProfileSources(
  sources: EagerDataFlowSourceCollection,
  options: LoadEagerDataFlowProfileSourcesOptions,
): EagerDataFlowLoadResult {
  if (!options.profileRoot.trim()) {
    return {
      diagnostics: [{ code: 'invalid-profile-root', message: 'profile root must be a non-empty XNL tag' }],
    };
  }
  return loadEagerDataSources(sources, options, options.profileRoot, true);
}

function loadEagerDataSources(
  sources: EagerDataFlowSourceCollection,
  options: LoadEagerDataFlowOptions,
  rootTag: string,
  profile = false,
): EagerDataFlowLoadResult {
  const diagnostics: EagerDataFlowDiagnostic[] = [];
  const sink: DiagnosticSink = {
    diagnostics,
    note: (code, message, context = {}) => diagnostics.push({ code, message, ...context }),
  };
  const normalizedSources = normalizeSources(sources, sink);
  if (normalizedSources.length === 0) {
    sink.note('empty-source-set', 'no named XNL sources were provided');
    return { diagnostics };
  }

  const roots: ParsedRoot[] = [];
  let duplicateFlowContractSection = false;
  for (const source of normalizedSources) {
    try {
      const document = parseXnl(source.content);
      for (const warning of document.warnings ?? []) {
        sink.note('xnl-parser-warning', `${warning.code}: ${warning.message}`, { source: source.name });
        if (warning.childName === 'FlowContract') duplicateFlowContractSection = true;
      }
      const sourceRoots = document.nodes.filter(isDataElement);
      if (sourceRoots.length !== 1) {
        sink.note('source-root-count', `${source.name} must contain exactly one XNL root`, {
          source: source.name,
        });
      }
      for (const element of sourceRoots) roots.push({ element, source: source.name });
    } catch (error) {
      sink.note('parse-error', `${source.name}: ${(error as Error).message}`, { source: source.name });
    }
  }

  const legacyRoots = roots.filter(({ element }) => element.tag === 'DataFlow');
  for (const root of legacyRoots) {
    sink.note('legacy-data-flow-root', 'DataFlow is removed; use the EagerDataFlow root', {
      source: root.source,
    });
  }
  for (const root of roots) {
    if (root.element.tag === 'DataGraph') {
      sink.note('lazy-data-graph-root', 'DataGraph is not an EagerDataFlow definition', {
        source: root.source,
      });
    } else if (
      root.element.tag !== rootTag &&
      root.element.tag !== 'DataFlow' &&
      !AUXILIARY_ROOT_TAGS.has(root.element.tag)
    ) {
      sink.note('unsupported-eager-source-root', `unsupported EagerDataFlow source root <${root.element.tag}>`, {
        source: root.source,
      });
    }
  }

  const flowRoots = roots.filter(({ element }) => element.tag === rootTag);
  if (flowRoots.length !== 1) {
    if (flowRoots.length > 0 || legacyRoots.length === 0) {
      sink.note(
        profile ? 'profile-root-count' : 'eager-data-flow-root-count',
        `expected exactly one ${rootTag} root, found ${flowRoots.length}`,
      );
    }
    return { diagnostics };
  }
  const { element: root, source: rootSource } = flowRoots[0];

  const scanLazyNodes = (element: DataElementNode): void => {
    if (LAZY_NODE_TAGS.has(element.tag)) {
      sink.note('lazy-data-graph-node', `<${element.tag}> belongs to lazy DataGraph and has no EagerDataFlow alias`, {
        nodeId: idOf(element) || undefined,
      });
    }
    for (const child of [...listChildren(element), ...sectionChildren(element)]) scanLazyNodes(child);
  };
  scanLazyNodes(root);

  const rootId = idOf(root);
  if (!FQN.test(rootId)) {
    sink.note('invalid-flow-id', `${rootTag} #id must be a dotted FQN, got "${rootId}"`, {
      source: rootSource,
    });
  }
  const apiVersion = typeof root.metadata.apiVersion === 'string' ? root.metadata.apiVersion : '';
  const version = typeof root.metadata.version === 'string' ? root.metadata.version : '';
  if (!apiVersion || !version) {
    sink.note('missing-flow-metadata', `${rootTag} requires apiVersion and version metadata`, {
      source: rootSource,
    });
  }

  const sections = sectionChildren(root);
  for (const section of sections) {
    if (section.tag !== 'FlowContract' && section.tag !== 'FlowAuthoring') {
      sink.note('unsupported-root-section', `<${section.tag}> is not a ${rootTag} root section`);
    }
  }
  const contractElements = [
    ...sections.filter((section) => section.tag === 'FlowContract'),
    ...roots
      .filter(({ element }) => element.tag === 'FlowContract')
      .map(({ element }) => element),
  ];
  if (contractElements.length !== 1 || duplicateFlowContractSection) {
    sink.note('flow-contract-count', `expected exactly one FlowContract, found ${contractElements.length}`);
  }
  const contractElement = contractElements[0];
  if (!contractElement) {
    sink.note('entry-node-count', `expected exactly one EntryNode, found ${listChildren(root).filter((node) => node.tag === 'EntryNode').length}`);
    sink.note('return-node-count', `expected exactly one ReturnNode, found ${listChildren(root).filter((node) => node.tag === 'ReturnNode').length}`);
    return { diagnostics };
  }

  const contractAttrs = contractElement.attributes ?? {};
  const contractId = idOf(contractElement);
  if (contractId !== rootId) {
    sink.note('flow-contract-id-mismatch', `FlowContract id "${contractId}" must equal root id "${rootId}"`);
  }
  const contract: EagerDataFlowContract = {
    id: contractId,
    inputPorts: readPorts(contractAttrs.inputPorts, contractId || 'FlowContract', 'inputPorts', sink),
    outputPorts: readPorts(contractAttrs.outputPorts, contractId || 'FlowContract', 'outputPorts', sink),
  };
  for (const field of ['input', 'output'] as const) {
    const value = contractAttrs[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !VFS_REF.test(value)) {
      sink.note('invalid-code-ref', `FlowContract.${field} must use vfs://path#Export`);
    } else {
      contract[field] = value;
    }
  }

  const nodeElements = listChildren(root);
  const entryCount = nodeElements.filter((node) => node.tag === 'EntryNode').length;
  const returnCount = nodeElements.filter((node) => node.tag === 'ReturnNode').length;
  if (entryCount !== 1) sink.note('entry-node-count', `expected exactly one EntryNode, found ${entryCount}`);
  if (returnCount !== 1) sink.note('return-node-count', `expected exactly one ReturnNode, found ${returnCount}`);

  const nodes: EagerDataFlowNodePlan[] = [];
  const nodeById: Record<string, EagerDataFlowNodePlan> = {};
  const subflowEdges: EagerSubflowEdge[] = [];
  const registry = options.registry ?? {};

  for (const [declarationIndex, element] of nodeElements.entries()) {
    if (!NODE_TAGS.has(element.tag)) {
      if (!LAZY_NODE_TAGS.has(element.tag)) {
        sink.note('unsupported-eager-node', `<${element.tag}> is not an EagerDataFlow node`);
      }
      continue;
    }
    const id = idOf(element);
    if (!LOCAL_NAME.test(id)) sink.note('invalid-node-id', `node id "${id}" must be local`, { nodeId: id });
    if (nodeById[id]) sink.note('duplicate-node-id', `node id "${id}" is duplicated`, { nodeId: id });
    const attrs = element.attributes ?? {};

    let node: EagerDataFlowNodePlan;
    if (element.tag === 'EntryNode') {
      checkFields(attrs, new Set(), id, sink);
      if ('inputs' in attrs || 'waitFor' in attrs) {
        sink.note('entry-incoming-dependency', 'EntryNode cannot have incoming dependencies', { nodeId: id });
      }
      node = { tag: 'EntryNode', id, declarationIndex, outputs: [...contract.inputPorts], waitFor: [] };
    } else if (element.tag === 'TransformNode') {
      checkFields(attrs, new Set(['inputs', 'outputs', 'waitFor', 'type', 'src', 'impl', 'config']), id, sink);
      const src = readString(attrs.src, 'src', id, sink);
      const impl = readString(attrs.impl, 'impl', id, sink);
      const type = readString(attrs.type, 'type', id, sink);
      if (Number(src !== undefined) + Number(impl !== undefined) !== 1) {
        sink.note('implementation-binding-count', `${id} must declare exactly one of src or impl`, { nodeId: id });
      }
      validateCodeRef(src, 'src', id, sink);
      validateCodeRef(impl, 'impl', id, sink);
      validateCodeRef(type, 'type', id, sink);
      node = {
        tag: 'TransformNode',
        id,
        declarationIndex,
        inputs: readInputs(attrs.inputs, id, sink),
        outputs: readPorts(attrs.outputs, id, 'outputs', sink),
        waitFor: readWaitFor(attrs.waitFor, id, sink),
        config: readConfig(attrs.config, id, sink),
        ...(type ? { type } : {}),
        ...(src ? { src } : {}),
        ...(impl ? { impl } : {}),
      };
    } else if (element.tag === 'SinkNode') {
      checkFields(attrs, new Set(['inputs', 'waitFor', 'type', 'src', 'impl', 'config']), id, sink);
      const src = readString(attrs.src, 'src', id, sink);
      const impl = readString(attrs.impl, 'impl', id, sink);
      const type = readString(attrs.type, 'type', id, sink);
      if (Number(src !== undefined) + Number(impl !== undefined) !== 1) {
        sink.note('implementation-binding-count', `${id} must declare exactly one of src or impl`, { nodeId: id });
      }
      validateCodeRef(src, 'src', id, sink);
      validateCodeRef(impl, 'impl', id, sink);
      validateCodeRef(type, 'type', id, sink);
      node = {
        tag: 'SinkNode',
        id,
        declarationIndex,
        inputs: readInputs(attrs.inputs, id, sink),
        waitFor: readWaitFor(attrs.waitFor, id, sink),
        config: readConfig(attrs.config, id, sink),
        ...(type ? { type } : {}),
        ...(src ? { src } : {}),
        ...(impl ? { impl } : {}),
      };
    } else if (element.tag === 'SubFlowNode') {
      checkFields(attrs, new Set(['flow', 'inputs', 'waitFor']), id, sink);
      const flow = readString(attrs.flow, 'flow', id, sink, true) ?? '';
      const match = SUBFLOW_REF.exec(flow);
      let outputs: string[] = [];
      const inputs = readInputs(attrs.inputs, id, sink);
      if (!match) {
        sink.note('invalid-subflow-ref', `${id}.flow must use eager-data-flow://FQN`, { nodeId: id });
      } else {
        const target = match[1];
        const registration = registry[target];
        if (!registration) {
          sink.note('unregistered-subflow', `${id} target ${target} is not registered`, { nodeId: id });
        } else {
          const targetContract = validateRegistryEntry(target, registration, id, sink);
          if (targetContract) {
            outputs = [...targetContract.outputPorts];
            if (!keysEqual(Object.keys(inputs), targetContract.inputPorts)) {
              sink.note('subflow-input-mismatch', `${id} inputs must exactly match ${target} inputPorts`, {
                nodeId: id,
              });
            }
          }
        }
        subflowEdges.push({
          kind: 'subflow',
          fromFlowId: rootId,
          nodeId: id,
          targetFlowId: target,
          ref: flow,
        });
      }
      node = {
        tag: 'SubFlowNode',
        id,
        declarationIndex,
        flow,
        inputs,
        outputs,
        waitFor: readWaitFor(attrs.waitFor, id, sink),
      };
    } else {
      checkFields(attrs, new Set(['inputs', 'waitFor']), id, sink);
      const inputs = readInputs(attrs.inputs, id, sink);
      if (!keysEqual(Object.keys(inputs), contract.outputPorts)) {
        sink.note('return-input-mismatch', `${id} inputs must exactly match FlowContract outputPorts`, {
          nodeId: id,
        });
      }
      node = {
        tag: 'ReturnNode',
        id,
        declarationIndex,
        inputs,
        waitFor: readWaitFor(attrs.waitFor, id, sink),
      };
    }

    nodes.push(node);
    if (!nodeById[id]) nodeById[id] = node;
  }

  const outputPortsByNode = new Map<string, readonly string[]>();
  for (const node of nodes) {
    outputPortsByNode.set(
      node.id,
      node.tag === 'EntryNode' || node.tag === 'TransformNode' || node.tag === 'SubFlowNode'
        ? node.outputs
        : [],
    );
  }

  const dataEdges: EagerDataEdge[] = [];
  const waitForEdges: EagerWaitForEdge[] = [];
  for (const node of nodes) {
    if (node.tag !== 'EntryNode') {
      for (const [input, reference] of Object.entries(node.inputs) as [string, FlowPortReference][]) {
        const source = nodeById[reference.nodeId];
        if (!source) {
          sink.note('unknown-source-node', `${node.id}.${input} references unknown node ${reference.nodeId}`, {
            nodeId: node.id,
          });
          continue;
        }
        if (source.tag === 'ReturnNode') {
          sink.note('return-outgoing-data', `ReturnNode ${source.id} cannot have outgoing data edges`, {
            nodeId: source.id,
          });
        }
        if (!(outputPortsByNode.get(source.id) ?? []).includes(reference.port)) {
          sink.note('unknown-source-port', `${node.id}.${input} references unknown port ${source.id}/${reference.port}`, {
            nodeId: node.id,
          });
          continue;
        }
        if (source.id === node.id) sink.note('self-dependency', `${node.id} depends on itself`, { nodeId: node.id });
        dataEdges.push({
          kind: 'data',
          fromNodeId: source.id,
          fromPort: reference.port,
          toNodeId: node.id,
          toInput: input,
          ref: reference.ref,
        });
      }
    }
    for (const reference of node.waitFor) {
      const source = nodeById[reference.nodeId];
      if (!source) {
        sink.note('unknown-wait-for-node', `${node.id}.waitFor references unknown node ${reference.nodeId}`, {
          nodeId: node.id,
        });
        continue;
      }
      if (source.id === node.id) sink.note('self-dependency', `${node.id} depends on itself`, { nodeId: node.id });
      waitForEdges.push({
        kind: 'waitFor',
        fromNodeId: source.id,
        toNodeId: node.id,
        ref: reference.ref,
      });
    }
  }

  validateTopology(nodes, dataEdges, waitForEdges, sink);
  validateSubflowRecursion(
    rootId,
    subflowEdges.map((edge) => edge.targetFlowId),
    options,
    sink,
  );

  if (diagnostics.length > 0) return { diagnostics };
  const rootAttrs = root.attributes ?? {};
  const plan: EagerDataFlowAuthoringPlan = {
    form: 'EagerDataFlow',
    fqn: rootId,
    apiVersion,
    version,
    ...(typeof rootAttrs.title === 'string' ? { title: rootAttrs.title } : {}),
    ...(options.baseUri ? { baseUri: options.baseUri } : {}),
    sourceNames: normalizedSources.map((source) => source.name),
    contract,
    nodes,
    nodeById,
    declarationOrder: nodes.map((node) => node.id),
    dataEdges,
    waitForEdges,
    subflowEdges,
    diagnostics: [],
  };
  return { plan, diagnostics };
}
