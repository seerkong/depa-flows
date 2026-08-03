import fs from 'node:fs';
import path from 'node:path';
import { listChildren, sectionChildren, idOf } from './load.mjs';
import { TASK_TRANSITIONS, EXECUTION_MODES as CONTRACT_EXECUTION_MODES } from 'task-manager-contract';

const CTRL_FLOW_FORMS = new Set(['InstantCtrlFlow', 'WorkCtrlFlow', 'BPCtrlFlow', 'AICtrlWorkflow']);
const DAG_FORMS = new Set(['EagerDataFlow', 'AIDataWorkflow']);
const SHARED_STATEMENTS = new Set([
  'Run',
  'If',
  'Require',
  'Fallback',
  'Retry',
  'Timeout',
  'Until',
  'ForEach',
  'Parallel',
  'Race',
  'CallFlow',
  'Return',
]);
const INTERRUPTIBLE = new Set(['ExternalJob', 'Timer', 'TaskStep']);
const LEGACY_PUBLIC_CONTROL = new Set(['Sequence', 'Selector', 'Condition']);
const LEGACY_PUBLIC_ACTION = new Set([
  'Action',
  'SetVariable',
  'Log',
  'Assert',
  'Sleep',
  'HttpCall',
  'RunScript',
]);
const WAIT_BY_FORM = {
  InstantCtrlFlow: new Set(),
  WorkCtrlFlow: new Set(['ExternalJob', 'Timer']),
  BPCtrlFlow: new Set(['ExternalJob', 'Timer', 'TaskStep']),
  AICtrlWorkflow: new Set(['ExternalJob', 'Timer']),
};
const INTERRUPTIBLE_CODE_BY_FORM = {
  InstantCtrlFlow: 'interruptible-in-instant-ctrl-flow',
  WorkCtrlFlow: 'interruptible-in-work-ctrl-flow',
  BPCtrlFlow: 'interruptible-in-bp-ctrl-flow',
  AICtrlWorkflow: 'interruptible-in-ai-ctrl-workflow',
};
const FACETS_BY_FORM = {
  InstantCtrlFlow: new Set(['flow.contract', 'config', 'config.def']),
  WorkCtrlFlow: new Set(['flow.contract', 'config', 'config.def', 'state.def', 'state.seed']),
  BPCtrlFlow: new Set(['flow.contract', 'config', 'config.def', 'state.def', 'state.seed', 'task.space']),
  AICtrlWorkflow: new Set(['flow.contract', 'config', 'config.def', 'state.def', 'state.seed']),
  EagerDataFlow: new Set(['flow.contract']),
  AIDataWorkflow: new Set(['flow.contract']),
};
const TASK_STATUS = new Set(Object.keys(TASK_TRANSITIONS));
const EXECUTION_MODES = new Set(CONTRACT_EXECUTION_MODES);

const walk = (element, visit) => {
  visit(element);
  for (const child of listChildren(element)) walk(child, visit);
  for (const section of sectionChildren(element)) walk(section, visit);
};

const walkValues = (value, visit) => {
  if (Array.isArray(value)) {
    for (const item of value) walkValues(item, visit);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) walkValues(item, visit);
  } else {
    visit(value);
  }
};

export function checkBundle(bundle) {
  const problems = [...(bundle.diagnostics ?? [])];
  const noted = new Set(problems.map((problem) => problem.code));
  const note = (code, message) => problems.push({ code, message });
  const noteOnce = (code, message) => {
    if (noted.has(code)) return;
    noted.add(code);
    note(code, message);
  };
  if (!bundle.form) return problems;

  const { form, container, fqn, statements, facets, dir } = bundle;

  if (!fqn || !fqn.includes('.')) {
    note('container-id-not-fqn', `container #id must be a dotted FQN, got "${fqn}"`);
  }
  for (const attribute of ['apiVersion', 'version']) {
    if (container.metadata?.[attribute] !== undefined) continue;
    if (container.attributes?.[attribute] !== undefined) {
      note('meta-in-attributes', `"${attribute}" is system metadata and must not be placed in { }`);
    } else {
      note('container-missing-meta', `container missing metadata "${attribute}"`);
    }
  }

  for (const name of Object.keys(facets)) {
    if (!FACETS_BY_FORM[form].has(name)) note('facet-not-allowed', `facet "${name}" is not allowed in ${form}`);
  }
  const flowContract = facets['flow.contract'];
  if (!flowContract) {
    note('missing-flow-contract', `${form} #${fqn} requires exactly one FlowContract`);
  } else {
    if (idOf(flowContract) !== fqn) note('flow-contract-id-mismatch', 'FlowContract #id must equal the enclosing flow FQN');
    for (const field of ['input', 'output']) {
      const value = flowContract.attributes?.[field];
      if (value !== undefined && (typeof value !== 'string' || !/^vfs:\/\/[^#\s]+#[A-Za-z_$][A-Za-z0-9_$]*$/.test(value))) {
        note('invalid-flow-contract-type-ref', `FlowContract.${field} must use vfs://path#Export`);
      }
    }
  }

  const configEntries = {};
  for (const entry of listChildren(facets.config).filter((element) => element.tag === 'ConfigEntry')) {
    configEntries[idOf(entry)] = entry.attributes ?? {};
  }

  const taskIds = new Set();
  const directTaskIds = new Set();
  if (facets['task.space']) {
    const taskSpace = facets['task.space'];
    for (const child of listChildren(taskSpace)) {
      if (child.tag === 'Task' || child.tag === 'TaskGroup') directTaskIds.add(idOf(child));
    }
    walk(taskSpace, (element) => {
      if (element.tag === 'SubNodes') {
        note('taskspace-subnodes-wrapper', 'SubNodes is removed; put Task and TaskGroup directly in []');
        return;
      }
      if (element.tag !== 'Task' && element.tag !== 'TaskGroup') return;

      const id = idOf(element);
      if (!id) note('task-id-missing', `<${element.tag}> is missing #id`);
      else if (taskIds.has(id)) note('task-id-duplicate', `task.space #id duplicate: ${id}`);
      else taskIds.add(id);

      if (element.tag === 'Task' && element.attributes?.status !== undefined && !TASK_STATUS.has(element.attributes.status)) {
        note('task-status-invalid', `Task #${id} status "${element.attributes.status}" is invalid`);
      }
      if (
        element.tag === 'TaskGroup'
        && element.attributes?.executionMode !== undefined
        && !EXECUTION_MODES.has(element.attributes.executionMode)
      ) {
        note('task-execution-mode-invalid', `TaskGroup #${id} executionMode "${element.attributes.executionMode}" is invalid`);
      }
    });
  }

  const stateDef = facets['state.def']?.attributes ?? null;
  const stateSeed = facets['state.seed']?.attributes ?? null;
  if (stateSeed && !stateDef) note('seed-without-def', 'state.seed is present without state.def');
  if (stateDef && stateSeed) {
    for (const key of Object.keys(stateSeed)) {
      if (!(key in stateDef)) note('seed-undeclared-field', `state.seed field "${key}" is not declared in state.def`);
    }
    for (const [key, type] of Object.entries(stateDef)) {
      if (typeof type === 'string' && !type.endsWith('?') && !(key in stateSeed)) {
        note('seed-missing-required-field', `required state.def field "${key}" is missing in state.seed`);
      }
    }
  }

  const seenIds = new Set();
  const taskStepRefs = [];
  const registerId = (element, kind = 'statement') => {
    const id = idOf(element);
    if (!id) {
      note('node-id-missing', `${kind} <${element.tag}> is missing #id`);
    } else if (seenIds.has(id)) {
      note('node-id-duplicate', `definition #id duplicate: ${id}`);
    } else {
      seenIds.add(id);
    }
    return id;
  };
  const checkVfs = (value, context) => {
    if (typeof value !== 'string' || !value.startsWith('vfs://./')) {
      note('code-ref-invalid', `${context} must be a vfs://./...#Export code ref`);
      return;
    }
    const [relative, exportName] = value.slice('vfs://./'.length).split('#');
    if (!exportName) note('code-ref-export-missing', `${context} code ref must include #Export: ${value}`);
    if (!fs.existsSync(path.join(dir, relative))) note('vfs-ref-missing', `${context} target does not exist: ${value}`);
  };
  const checkRefs = (element) => {
    walkValues(element.attributes ?? {}, (value) => {
      if (typeof value !== 'string' || !value.startsWith('config://#')) return;
      const [entryId, ...subpath] = value.slice('config://#'.length).split('/');
      if (!configEntries[entryId]) note('unresolved-config-ref', `config ref is unresolved: ${value}`);
      else if (subpath.length && !(subpath[0] in configEntries[entryId])) {
        note('unresolved-config-subpath', `config sub-path is unresolved: ${value}`);
      }
    });
  };

  const parseFlowPortRef = (value, context) => {
    if (typeof value !== 'string') {
      note('flow-port-ref-invalid', `${context} must be a flow-port://#node/port ref`);
      return undefined;
    }
    const match = /^flow-port:\/\/#([^/]+)\/(.+)$/.exec(value);
    if (!match) {
      note('flow-port-ref-invalid', `${context} must be a flow-port://#node/port ref`);
      return undefined;
    }
    return { nodeId: match[1], port: match[2] };
  };

  const parseFlowNodeRef = (value, context) => {
    if (typeof value !== 'string') {
      note('flow-node-ref-invalid', `${context} must be a flow-node://#node ref`);
      return undefined;
    }
    const match = /^flow-node:\/\/#(.+)$/.exec(value);
    if (!match) {
      note('flow-node-ref-invalid', `${context} must be a flow-node://#node ref`);
      return undefined;
    }
    return match[1];
  };

  const checkDagNodes = () => {
    const inputPorts = flowContract?.attributes?.inputPorts;
    const outputPorts = flowContract?.attributes?.outputPorts;
    if (!Array.isArray(inputPorts) || !inputPorts.every((port) => typeof port === 'string')) {
      note('flow-contract-ports-invalid', `${form} FlowContract.inputPorts must be a string array`);
    }
    if (!Array.isArray(outputPorts) || !outputPorts.every((port) => typeof port === 'string')) {
      note('flow-contract-ports-invalid', `${form} FlowContract.outputPorts must be a string array`);
    }

    const nodeIds = new Set();
    const outputPortsByNode = new Map();
    let entryCount = 0;
    let returnCount = 0;

    for (const node of statements) {
      const id = registerId(node, 'dag node');
      checkRefs(node);
      if (!id) continue;
      nodeIds.add(id);
      if (node.tag === 'EntryNode') {
        entryCount += 1;
        outputPortsByNode.set(id, new Set(Array.isArray(inputPorts) ? inputPorts : []));
      } else if (node.tag === 'TransformNode') {
        const outputs = node.attributes?.outputs;
        if (!Array.isArray(outputs) || !outputs.every((port) => typeof port === 'string')) {
          note('transform-outputs-invalid', `TransformNode #${id} outputs must be a string array`);
        }
        outputPortsByNode.set(id, new Set(Array.isArray(outputs) ? outputs : []));
      } else if (node.tag === 'SubFlowNode') {
        if (typeof node.attributes?.flow !== 'string' || !/^eager-data-flow:\/\/[\w.-]+$/.test(node.attributes.flow)) {
          note('subflow-ref-invalid', `SubFlowNode #${id} flow must use eager-data-flow://<FQN>`);
        }
        outputPortsByNode.set(id, undefined);
      } else if (node.tag === 'SinkNode') {
        outputPortsByNode.set(id, new Set());
      } else if (node.tag === 'ReturnNode') {
        returnCount += 1;
        outputPortsByNode.set(id, new Set());
      } else {
        note('unknown-dag-node-tag', `unknown DAG node tag <${node.tag}>`);
      }
    }

    if (entryCount !== 1) note('entry-node-cardinality', `${form} requires exactly one EntryNode`);
    if (returnCount !== 1) note('return-node-cardinality', `${form} requires exactly one ReturnNode`);

    for (const node of statements) {
      const id = idOf(node);
      if (!id) continue;
      if (node.tag === 'TransformNode' || node.tag === 'SinkNode') {
        const src = node.attributes?.src ?? node.attributes?.impl;
        if (!src) note('dag-node-missing-src', `${node.tag} #${id} is missing src`);
        else checkVfs(src, `${node.tag} #${id} src`);
      }
      if (node.tag === 'EntryNode') continue;
      const inputs = node.attributes?.inputs;
      if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
        note('dag-node-inputs-invalid', `${node.tag} #${id} inputs must be an object`);
      } else {
        for (const [inputName, ref] of Object.entries(inputs)) {
          const parsed = parseFlowPortRef(ref, `${node.tag} #${id} input ${inputName}`);
          if (!parsed) continue;
          if (!nodeIds.has(parsed.nodeId)) {
            note('flow-port-unknown-node', `${node.tag} #${id} references unknown node ${parsed.nodeId}`);
            continue;
          }
          const allowedPorts = outputPortsByNode.get(parsed.nodeId);
          if (allowedPorts && !allowedPorts.has(parsed.port)) {
            note('flow-port-unknown-port', `${node.tag} #${id} references unknown port ${parsed.nodeId}/${parsed.port}`);
          }
        }
      }
      for (const ref of node.attributes?.waitFor ?? []) {
        const nodeId = parseFlowNodeRef(ref, `${node.tag} #${id} waitFor`);
        if (nodeId && !nodeIds.has(nodeId)) {
          note('flow-node-unknown-node', `${node.tag} #${id} waits for unknown node ${nodeId}`);
        }
      }
      if (node.tag === 'ReturnNode' && Array.isArray(outputPorts) && inputs && typeof inputs === 'object' && !Array.isArray(inputs)) {
        const actual = Object.keys(inputs).sort();
        const expected = [...outputPorts].sort();
        if (actual.join('\0') !== expected.join('\0')) {
          note('return-node-output-mismatch', `ReturnNode #${id} inputs must match FlowContract.outputPorts`);
        }
      }
    }
  };

  const checkStatements = (items) => {
    for (const statement of items) {
      const tag = statement.tag;
      const id = registerId(statement);
      checkRefs(statement);

      if (LEGACY_PUBLIC_CONTROL.has(tag)) {
        noteOnce('legacy-public-control-node', 'public Sequence/Selector/Condition nodes are removed; use statements, If, or Fallback');
        continue;
      }
      if (LEGACY_PUBLIC_ACTION.has(tag) || tag.includes('.')) {
        noteOnce('legacy-public-action-node', 'public behavior-tree action nodes are removed; use Run with a direct code ref');
        continue;
      }
      if (!SHARED_STATEMENTS.has(tag) && !INTERRUPTIBLE.has(tag)) {
        note('unknown-statement-tag', `unknown statement tag <${tag}>`);
        continue;
      }

      if (statement.attributes?.assignTo !== undefined) {
        const code = tag === 'TaskStep' ? 'taskstep-assignto-forbidden' : 'assign-to-forbidden';
        note(code, `<${tag} #${id}> must pass output through the statement data chain, not assignTo`);
      }

      if (tag === 'Run') {
        if (!statement.attributes?.src) note('run-missing-src', `Run #${id} is missing src`);
        else checkVfs(statement.attributes.src, `Run #${id} src`);
      } else if (tag === 'Require') {
        if (!statement.attributes?.when) note('require-missing-when', `Require #${id} is missing when`);
        else checkVfs(statement.attributes.when, `Require #${id} when`);
      } else if (tag === 'If') {
        const branchesSections = sectionChildren(statement).filter((section) => section.tag === 'Branches');
        if (branchesSections.length !== 1 || sectionChildren(statement).length !== 1) {
          note('if-branches-cardinality', `If #${id} must contain exactly one Branches section in ()`);
        }
        for (const branches of branchesSections) {
          const entries = listChildren(branches);
          const otherwiseIndexes = entries
            .map((entry, index) => entry.tag === 'Otherwise' ? index : -1)
            .filter((index) => index >= 0);
          if (otherwiseIndexes.length > 1) note('otherwise-duplicate', `If #${id} has more than one Otherwise`);
          if (otherwiseIndexes.some((index) => index !== entries.length - 1)) {
            note('otherwise-not-last', `If #${id} Otherwise must be the final Branches entry`);
          }
          for (const entry of entries) {
            if (entry.tag === 'Branch') {
              const branchId = registerId(entry, 'branch');
              if (!entry.attributes?.when) note('branch-missing-when', `Branch #${branchId} is missing when`);
              else checkVfs(entry.attributes.when, `Branch #${branchId} when`);
              checkRefs(entry);
              checkStatements(listChildren(entry));
            } else if (entry.tag === 'Otherwise') {
              checkStatements(listChildren(entry));
            } else {
              note('if-invalid-branch', `Branches in If #${id} may contain only Branch or Otherwise`);
            }
          }
        }
      } else if (tag === 'Fallback') {
        const strategies = listChildren(statement);
        if (!strategies.length) note('fallback-empty', `Fallback #${id} must contain at least one Strategy`);
        for (const strategy of strategies) {
          if (strategy.tag !== 'Strategy') {
            note('fallback-invalid-strategy', `Fallback #${id} may contain only Strategy entries`);
            continue;
          }
          registerId(strategy, 'strategy');
          checkStatements(listChildren(strategy));
        }
      } else if (tag === 'Until') {
        if (!statement.attributes?.when) note('until-missing-when', `Until #${id} is missing when`);
        else checkVfs(statement.attributes.when, `Until #${id} when`);
        checkStatements(listChildren(statement));
      } else if (tag === 'Retry') {
        const maxAttempts = statement.attributes?.maxAttempts;
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
          note('invalid-positive-integer', `Retry #${id} maxAttempts must be a positive integer`);
        }
        checkStatements(listChildren(statement));
      } else if (tag === 'Timeout') {
        const timeoutMs = statement.attributes?.timeoutMs;
        if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
          note('invalid-timeout', `Timeout #${id} timeoutMs must be a non-negative number`);
        }
        checkStatements(listChildren(statement));
      } else if (tag === 'ForEach') {
        if (!statement.attributes?.when) note('foreach-missing-when', `ForEach #${id} is missing when`);
        else checkVfs(statement.attributes.when, `ForEach #${id} when`);
        const concurrency = statement.attributes?.concurrency;
        if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
          note('invalid-positive-integer', `ForEach #${id} concurrency must be a positive integer`);
        }
        checkStatements(listChildren(statement));
      } else if (tag === 'Parallel' || tag === 'Race') {
        const sectionTag = tag === 'Parallel' ? 'Lanes' : 'Candidates';
        const itemTag = tag === 'Parallel' ? 'Lane' : 'Candidate';
        const sections = sectionChildren(statement).filter((section) => section.tag === sectionTag);
        if (sections.length !== 1 || sectionChildren(statement).length !== 1) {
          note('invalid-concurrent-domain', `${tag} #${id} requires exactly one ${sectionTag} section`);
        }
        for (const section of sections) {
          const entries = listChildren(section);
          if (!entries.length) note('empty-concurrent-domain', `${tag} #${id} requires at least one ${itemTag}`);
          for (const entry of entries) {
            if (entry.tag !== itemTag) {
              note('invalid-concurrent-item', `${sectionTag} in ${tag} #${id} may contain only ${itemTag}`);
              continue;
            }
            registerId(entry, itemTag.toLowerCase());
            checkStatements(listChildren(entry));
          }
        }
        if (tag === 'Parallel' && statement.attributes?.join !== undefined && statement.attributes.join !== 'all') {
          note('invalid-parallel-join', `Parallel #${id} join currently only supports "all"`);
        }
        if (tag === 'Race' && !['first-success', 'first-completed'].includes(statement.attributes?.mode)) {
          note('invalid-race-mode', `Race #${id} mode must be "first-success" or "first-completed"`);
        }
      } else if (tag === 'CallFlow') {
        if (typeof statement.attributes?.flow !== 'string' || !/^(instant-ctrl-flow|work-ctrl-flow|bp-ctrl-flow):\/\/[\w.-]+$/.test(statement.attributes.flow)) {
          note('invalid-flow-ref', `CallFlow #${id} flow must use a product flow URI`);
        }
      } else if (tag === 'Return') {
        const hasSrc = statement.attributes?.src !== undefined;
        const hasValue = statement.attributes?.value !== undefined;
        if (hasSrc && hasValue) note('return-source-conflict', `Return #${id} cannot declare both src and value`);
        if (hasSrc) checkVfs(statement.attributes.src, `Return #${id} src`);
      } else {
        if (!WAIT_BY_FORM[form].has(tag)) {
          note(INTERRUPTIBLE_CODE_BY_FORM[form], `<${tag} #${id}> is illegal in ${form}`);
        }
        if (tag === 'ExternalJob') {
          for (const attribute of ['signalKind', 'signalKey']) {
            if (!statement.attributes?.[attribute]) note('externaljob-missing-attr', `ExternalJob #${id} is missing ${attribute}`);
          }
        } else if (tag === 'Timer') {
          if (statement.attributes?.durationMs === undefined) note('timer-missing-duration', `Timer #${id} is missing durationMs`);
        } else if (tag === 'TaskStep') {
          const ref = statement.attributes?.task;
          if (typeof ref !== 'string' || !ref.startsWith('task-space://#')) {
            note('taskstep-ref-malformed', `TaskStep #${id} task ref is malformed: ${ref}`);
          } else {
            const taskId = ref.slice('task-space://#'.length);
            taskStepRefs.push(taskId);
            if (!taskIds.has(taskId)) note('unresolved-task-ref', `TaskStep #${id} task ref is unresolved: ${taskId}`);
            else if (!directTaskIds.has(taskId)) {
              note('task-ref-not-direct-child', `TaskStep #${id} must bind a direct TaskSpace child, but ${taskId} is nested`);
            }
          }
        }
      }
    }
  };

  if (DAG_FORMS.has(form)) {
    checkDagNodes();
  } else if (CTRL_FLOW_FORMS.has(form)) {
    checkStatements(statements);
  }

  for (const taskId of new Set(taskStepRefs)) {
    if (taskStepRefs.filter((candidate) => candidate === taskId).length > 1) {
      note('task-multi-step', `task is bound by multiple TaskSteps: ${taskId}`);
    }
  }

  return problems;
}
