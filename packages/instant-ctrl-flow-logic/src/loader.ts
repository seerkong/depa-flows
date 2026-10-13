/**
 * flow bundle 加载：多文件（域按文件根 tag 发现）/ 单文件（() 内联区段）同构。
 * 规范真源：docs/flow-dsl/spec/flow-core/{files,domains}.md。
 * 完整 lint 由 tools/flow-dsl-check 承担；此处只做引擎必需的结构化与硬校验。
 */
import { parseXnl } from 'xnl-core';
import {
  assembleDefinitionStepProfile,
  createDefinitionStepSourceRuntime,
} from 'flow-step-space-logic/browser';
import type { DefinitionStepForest, DefinitionStepSourceCollection } from 'flow-step-space-contract';
import type {
  FlowBundleSpec,
  CtrlFlowContract,
  FlowDiagnostic,
  FlowForm,
  FlowNodeSpec,
  FlowSourceCollection,
  LoadFlowSourcesOptions,
} from 'instant-ctrl-flow-contract';

const FORMS = ['InstantCtrlFlow', 'WorkCtrlFlow', 'BPCtrlFlow'] as const satisfies readonly FlowForm[];

const FACETS = {
  'flow.contract': { tag: 'FlowContract', uriScheme: 'flow-contract://' },
  'config': { tag: 'Config', uriScheme: 'config://' },
  'config.def': { tag: 'ConfigDef', uriScheme: 'config-def://' },
  'state.def': { tag: 'StateDef', uriScheme: 'state-def://' },
  'state.seed': { tag: 'StateSeed', uriScheme: 'state-seed://' },
  'task.space': { tag: 'TaskSpace', uriScheme: 'task-space://' },
} as const;

type FacetName = keyof typeof FACETS;

const TAG_TO_FACET = Object.fromEntries(
  Object.entries(FACETS).map(([name, descriptor]) => [descriptor.tag, name]),
) as Record<string, FacetName | undefined>;

const ALLOWED_FACETS: Record<FlowForm, ReadonlySet<FacetName>> = {
  InstantCtrlFlow: new Set(['flow.contract', 'config', 'config.def']),
  WorkCtrlFlow: new Set(['flow.contract', 'config', 'config.def', 'state.def', 'state.seed']),
  BPCtrlFlow: new Set(['flow.contract', 'config', 'config.def', 'state.def', 'state.seed', 'task.space']),
};

const LEGACY_PUBLIC_CONTROL_NODES = new Set(['Sequence', 'Selector', 'Condition']);
const LEGACY_PUBLIC_ACTION_NODES = new Set(['SetVariable', 'Log', 'Assert', 'Sleep', 'HttpCall', 'RunScript']);
const COMMON_STATEMENTS = new Set([
  'Run',
  'RunBlock',
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
const PROFILE_STATEMENTS: Record<FlowForm, ReadonlySet<string>> = {
  InstantCtrlFlow: new Set(COMMON_STATEMENTS),
  WorkCtrlFlow: new Set([...COMMON_STATEMENTS, 'ExternalJob', 'Timer']),
  BPCtrlFlow: new Set([...COMMON_STATEMENTS, 'ExternalJob', 'Timer', 'TaskStep']),
};
const CODE_REF = /^vfs:\/\/[^#\s]+#[A-Za-z_$][A-Za-z0-9_$]*$/;
const HALF_CODE_RESOURCE_ENVELOPE_VERSION = 'halfcode.resource-envelope/v1';
const DEPA_FLOW_SEMANTIC_API_VERSION = 'depa.flows/v1';
const DEPA_FLOW_RESOURCE_SPEC_VERSION = 1;

interface XnlEl {
  kind: string;
  tag: string;
  id?: { namespace: string[]; name: string };
  metadata: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  body?: unknown[];
  extend?: { order?: string[]; children: Record<string, XnlEl> };
}

interface FlowRootIdentityProjection {
  apiVersion: string;
  version: string;
  diagnostic?: { code: string; message: string };
}

function projectFlowRootIdentity(metadata: Readonly<Record<string, unknown>>): FlowRootIdentityProjection {
  const legacyApiVersion = typeof metadata.apiVersion === 'string' ? metadata.apiVersion : undefined;
  const legacyVersion = typeof metadata.version === 'string' ? metadata.version : undefined;
  const hasLegacyMetadata = metadata.apiVersion !== undefined || metadata.version !== undefined;
  const hasResourceMetadata = metadata.envelopeVersion !== undefined || metadata.specVersion !== undefined;
  if (hasLegacyMetadata && hasResourceMetadata) {
    return {
      apiVersion: '',
      version: '',
      diagnostic: {
        code: 'mixed-flow-root-metadata',
        message: 'flow root must use either depa apiVersion/version or Halfcode envelopeVersion/specVersion metadata',
      },
    };
  }
  if (hasResourceMetadata) {
    if (metadata.envelopeVersion !== HALF_CODE_RESOURCE_ENVELOPE_VERSION) {
      return {
        apiVersion: '',
        version: '',
        diagnostic: {
          code: 'unsupported-flow-resource-envelope',
          message: `flow resource root requires envelopeVersion "${HALF_CODE_RESOURCE_ENVELOPE_VERSION}"`,
        },
      };
    }
    if (metadata.specVersion !== DEPA_FLOW_RESOURCE_SPEC_VERSION) {
      return {
        apiVersion: '',
        version: '',
        diagnostic: {
          code: 'unsupported-flow-resource-spec-version',
          message: `flow resource root requires numeric specVersion ${DEPA_FLOW_RESOURCE_SPEC_VERSION}`,
        },
      };
    }
    return {
      apiVersion: DEPA_FLOW_SEMANTIC_API_VERSION,
      version: String(DEPA_FLOW_RESOURCE_SPEC_VERSION),
    };
  }
  if (legacyApiVersion && legacyVersion) return { apiVersion: legacyApiVersion, version: legacyVersion };
  return {
    apiVersion: legacyApiVersion ?? '',
    version: legacyVersion ?? '',
    diagnostic: {
      code: 'container-missing-meta',
      message: 'container missing metadata "apiVersion" or "version"',
    },
  };
}

const isEl = (n: unknown): n is XnlEl =>
  !!n && typeof n === 'object' && ((n as XnlEl).kind === 'DataElement' || (n as XnlEl).kind === 'TextElement');

const els = (arr?: unknown[]): XnlEl[] => (arr ?? []).filter(isEl);

const listChildren = (el: XnlEl): XnlEl[] => els(el.body);

const sectionChildren = (el: XnlEl): XnlEl[] => {
  if (!el.extend) return [];
  const order = el.extend.order ?? Object.keys(el.extend.children);
  return order.map((k) => el.extend!.children[k]);
};

const idOf = (el: XnlEl): string | undefined => {
  if (!el.id) return undefined;
  const ns = el.id.namespace?.length ? el.id.namespace.join('.') + '.' : '';
  return ns + el.id.name;
};

function toNodeSpec(el: XnlEl): FlowNodeSpec {
  const sections: Record<string, FlowNodeSpec> = {};
  for (const sec of sectionChildren(el)) sections[sec.tag] = toNodeSpec(sec);
  return {
    tag: el.tag,
    id: idOf(el),
    metadata: { ...(el.metadata ?? {}) },
    attrs: { ...(el.attributes ?? {}) },
    children: listChildren(el).map(toNodeSpec),
    sections,
  };
}

export interface LoadResult {
  spec?: FlowBundleSpec;
  diagnostics: FlowDiagnostic[];
}

export interface LoadCtrlFlowProfileSourcesOptions extends LoadFlowSourcesOptions {
  profileRoot: string;
  substrateForm: FlowForm;
}

export function loadFlowBundleFromSources(
  sources: FlowSourceCollection,
  options: LoadFlowSourcesOptions = {},
): LoadResult {
  return loadCtrlFlowSources(sources, options);
}

export function loadCtrlFlowProfileFromSources(
  sources: FlowSourceCollection,
  options: LoadCtrlFlowProfileSourcesOptions,
): LoadResult {
  if (!options.profileRoot.trim()) {
    return {
      diagnostics: [{ code: 'invalid-profile-root', message: 'profile root must be a non-empty XNL tag' }],
    };
  }
  return loadCtrlFlowSources(sources, options, {
    rootTag: options.profileRoot,
    substrateForm: options.substrateForm,
  });
}

function loadCtrlFlowSources(
  sources: FlowSourceCollection,
  options: LoadFlowSourcesOptions,
  profile?: { rootTag: string; substrateForm: FlowForm },
): LoadResult {
  const diagnostics: FlowDiagnostic[] = [];
  const note = (code: string, message: string) => diagnostics.push({ code, message });
  const noted = new Set<string>();
  const noteOnce = (code: string, message: string) => {
    if (noted.has(code)) return;
    noted.add(code);
    note(code, message);
  };
  const noteLegacyTag = (tag: string) => {
    if (tag === 'Tree') {
      noteOnce('legacy-tree-domain', 'Tree authoring is removed; product-root [] must contain statements directly');
    } else if (tag === 'ActionTypes' || tag === 'ActionType') {
      noteOnce('legacy-action-types-domain', 'action.types authoring is removed; code refs belong on statements');
    } else if (tag === 'CtrlFlow') {
      noteOnce('legacy-ctrl-flow-root', '<CtrlFlow> is removed; use product-root statements directly');
    } else if (LEGACY_PUBLIC_CONTROL_NODES.has(tag)) {
      noteOnce(
        'legacy-public-control-node',
        'public Sequence/Selector/Condition authoring is removed; use ordered statements, If, or Fallback',
      );
    } else if (LEGACY_PUBLIC_ACTION_NODES.has(tag) || tag.includes('.')) {
      noteOnce(
        'legacy-public-action-node',
        'public behavior-tree and registered action nodes are removed; use Run with a direct vfs:// code ref',
      );
    }
  };

  let definitionStepForest: DefinitionStepForest | undefined;
  let effectiveSources = sources;
  const definitionSources: DefinitionStepSourceCollection = Array.isArray(sources)
    ? sources.map((source) => ({ ref: source.name, content: source.content }))
    : Object.entries(sources).map(([ref, content]) => ({ ref, content }));
  const stepRuntime = createDefinitionStepSourceRuntime(definitionSources);
  for (const candidateRoot of profile ? [profile.rootTag] : FORMS) {
    const assembled = assembleDefinitionStepProfile(
      stepRuntime,
      { sources: definitionSources },
      { ...(options.stepSpace ?? {}), profileRoot: candidateRoot },
    );
    if (assembled.diagnostics.length > 0) {
      return { diagnostics: assembled.diagnostics.map(({ code, message }) => ({ code, message })) };
    }
    if (assembled.forest) {
      effectiveSources = assembled.sources as FlowSourceCollection;
      definitionStepForest = assembled.forest;
      break;
    }
  }

  const sourceEntries = (Array.isArray(effectiveSources)
    ? effectiveSources.map((source) => ({
        name: 'name' in source ? source.name : source.ref,
        content: source.content,
      }))
    : Object.entries(effectiveSources).map(([name, content]) => ({ name, content })))
    .filter(({ name }) => name.endsWith('.xnl'))
    .sort((left, right) => left.name.localeCompare(right.name));
  const sourceNames = sourceEntries.map(({ name }) => name);
  if (!sourceEntries.length) {
    note('empty-bundle', `no .xnl sources in ${options.baseUri ?? 'named source collection'}`);
    return { diagnostics };
  }

  const fileRoots: Record<string, { el: XnlEl; file: string }> = {};
  for (const { name: f, content } of sourceEntries) {
    let doc: { nodes: unknown[]; warnings?: { code?: string; message?: string }[] };
    try {
      doc = parseXnl(content) as typeof doc;
    } catch (e) {
      note('parse-error', `${f}: ${(e as Error).message}`);
      continue;
    }
    for (const w of doc.warnings ?? []) note('parser-warning', `${f}: ${w.code ?? w.message}`);
    for (const el of els(doc.nodes)) {
      if (fileRoots[el.tag]) note('duplicate-file-root', `root <${el.tag}> in both ${fileRoots[el.tag].file} and ${f}`);
      fileRoots[el.tag] = { el, file: f };
    }
  }

  for (const tag of Object.keys(fileRoots)) noteLegacyTag(tag);

  const form = profile?.substrateForm ?? FORMS.find((candidate) => fileRoots[candidate]);
  if (!form) {
    if (noted.size) return { diagnostics };
    note('no-container', `no container root found in ${options.baseUri ?? 'named source collection'}`);
    return { diagnostics };
  }
  const rootTag = profile?.rootTag ?? form;
  const rootEntry = fileRoots[rootTag];
  if (!rootEntry) {
    note(
      profile ? 'profile-root-missing' : 'no-container',
      profile
        ? `expected profile root <${rootTag}> in ${options.baseUri ?? 'named source collection'}`
        : `no container root found in ${options.baseUri ?? 'named source collection'}`,
    );
    return { diagnostics };
  }
  const container = rootEntry.el;
  const containerFile = rootEntry.file;

  // Facet discovery is physical; toNodeSpec remains a pure XNL-to-contract projection.
  const facets: Partial<Record<FacetName, XnlEl>> = {};
  for (const [tag, { el, file }] of Object.entries(fileRoots)) {
    const name = TAG_TO_FACET[tag];
    if (!name || file === containerFile) continue;
    if (file !== `${name}.xnl`) {
      note(
        'domain-file-name-mismatch',
        `facet "${name}" (${FACETS[name].uriScheme}) root <${tag}> in ${file}, expected ${name}.xnl`,
      );
    }
    facets[name] = el;
  }
  for (const sec of sectionChildren(container)) {
    noteLegacyTag(sec.tag);

    const name = TAG_TO_FACET[sec.tag];
    if (!name) continue;
    if (facets[name]) note('domain-double-definition', `facet "${name}" defined both inline and as file`);
    else facets[name] = sec;
  }

  const visitStatement = (el: XnlEl): void => {
    noteLegacyTag(el.tag);
    for (const child of listChildren(el)) visitStatement(child);
    for (const section of sectionChildren(el)) visitStatement(section);
  };
  const statementEls = listChildren(container);
  for (const statement of statementEls) visitStatement(statement);

  const blockSections = sectionChildren(container).filter(s => s.tag === 'Blocks');
  if (blockSections.length && form !== 'InstantCtrlFlow') note('unsupported-block-profile', 'Blocks persistence is only validated for InstantCtrlFlow');
  if (blockSections.length > 1) note('duplicate-blocks', 'only one Blocks section is allowed');
  const blockEls = blockSections.flatMap(listChildren);
  const blockIds = new Set<string>();
  for (const block of blockEls) {
    const id = idOf(block);
    if (block.tag !== 'Block' || !id) note('invalid-block', 'Blocks requires named Block children');
    else if (blockIds.has(id)) note('duplicate-block', `duplicate block #${id}`);
    else blockIds.add(id);
  }
  const blockRefs = new Map<string, Set<string>>();
  const seenIds = new Set<string>();
  const requireCodeRef = (el: XnlEl, field: string) => {
    const value = el.attributes?.[field];
    if (typeof value !== 'string' || !CODE_REF.test(value)) {
      note('invalid-code-ref', `<${el.tag} #${idOf(el) ?? ''}>.${field} must use vfs://path#Export`);
    }
  };
  const requirePositiveInteger = (el: XnlEl, field: string, required = false) => {
    const value = el.attributes?.[field];
    if (value === undefined && !required) return;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      note('invalid-positive-integer', `<${el.tag} #${idOf(el) ?? ''}>.${field} must be a positive integer`);
    }
  };
  const validateBody = (nodes: XnlEl[]): void => {
    for (const node of nodes) {
      const id = idOf(node);
      if (!PROFILE_STATEMENTS[form].has(node.tag)) {
        note('statement-not-allowed', `<${node.tag} #${id ?? ''}> is not allowed in ${form}`);
        continue;
      }
      if (!id) note('statement-missing-id', `<${node.tag}> requires #id`);
      else if (seenIds.has(id)) note('duplicate-statement-id', `statement #${id} is duplicated`);
      else seenIds.add(id);

      if (node.tag === 'Run') requireCodeRef(node, 'src');
      if (node.tag === 'RunBlock') {
        const ref = node.attributes?.block;
        if (typeof ref !== 'string' || !/^block:\/\/#[-\w.]+$/.test(ref) || !blockIds.has(ref.slice(9))) {
          note('unresolved-block-ref', `<RunBlock #${id ?? ''}> requires an existing flow-local block://#id`);
        }
        if (listChildren(node).length) note('run-block-body', 'RunBlock cannot have an inline body');
        if (node.attributes?.config !== undefined || node.attributes?.input !== undefined) note('block-context-override', 'RunBlock preserves caller context and accepts no input/config override');
      }
      if (node.tag === 'Require' || node.tag === 'Until' || node.tag === 'ForEach') requireCodeRef(node, 'when');
      if (node.tag === 'Retry') requirePositiveInteger(node, 'maxAttempts', true);
      if (node.tag === 'Timeout') {
        const timeoutMs = node.attributes?.timeoutMs;
        if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
          note('invalid-timeout', `<Timeout #${id ?? ''}>.timeoutMs must be a non-negative number`);
        }
      }
      if (node.tag === 'Until') {
        requirePositiveInteger(node, 'maxIterations');
        if (node.attributes?.onExhausted !== undefined && !['fail', 'complete'].includes(String(node.attributes.onExhausted))) {
          note('invalid-on-exhausted', `<Until #${id ?? ''}>.onExhausted must be fail or complete`);
        }
      }
      if (node.tag === 'ForEach') {
        requirePositiveInteger(node, 'concurrency');
        requirePositiveInteger(node, 'maxItems');
        const maxItems = node.attributes?.maxItems;
        if (maxItems !== undefined && (typeof maxItems !== 'number' || maxItems > 1000)) note('invalid-max-items', `<ForEach #${id ?? ''}>.maxItems must be 1..1000`);
        const concurrency = node.attributes?.concurrency;
        if (concurrency !== undefined && typeof concurrency === 'number' && concurrency > Math.min(32, typeof maxItems === 'number' ? maxItems : 1000)) note('invalid-concurrency', `<ForEach #${id ?? ''}>.concurrency exceeds its bounded capacity`);
      }
      if (node.tag === 'CallFlow') {
        const target = node.attributes?.flow;
        if (typeof target !== 'string' || !/^(?:instant-ctrl-flow|work-ctrl-flow|bp-ctrl-flow):\/\/[\w.-]+$/.test(target)) {
          note('invalid-flow-ref', `<CallFlow #${id ?? ''}>.flow must use a product flow URI`);
        }
      }
      if (node.tag === 'Return' && node.attributes?.src !== undefined) requireCodeRef(node, 'src');

      if (node.tag === 'If') {
        const sections = sectionChildren(node);
        const branchesSection = sections.filter((section) => section.tag === 'Branches');
        if (branchesSection.length !== 1) {
          note('invalid-if-branches', `<If #${id ?? ''}> requires exactly one Branches section`);
        } else {
          const branches = listChildren(branchesSection[0]);
          if (!branches.length) note('empty-if-branches', `<If #${id ?? ''}> requires at least one Branch`);
          branches.forEach((branch, index) => {
            if (branch.tag !== 'Branch' && branch.tag !== 'Otherwise') {
              note('invalid-if-branch', `<If #${id ?? ''}> contains <${branch.tag}>`);
              return;
            }
            if (branch.tag === 'Otherwise' && index !== branches.length - 1) {
              note('otherwise-not-last', `<Otherwise> in <If #${id ?? ''}> must be last`);
            }
            if (branch.tag === 'Branch') requireCodeRef(branch, 'when');
            validateBody(listChildren(branch));
          });
        }
      } else if (node.tag === 'Fallback') {
        const strategies = listChildren(node);
        if (!strategies.length) note('empty-fallback', `<Fallback #${id ?? ''}> requires at least one Strategy`);
        for (const strategy of strategies) {
          if (strategy.tag !== 'Strategy') note('invalid-fallback-strategy', `<Fallback #${id ?? ''}> contains <${strategy.tag}>`);
          else validateBody(listChildren(strategy));
        }
      } else if (node.tag === 'Parallel' || node.tag === 'Race') {
        const sectionTag = node.tag === 'Parallel' ? 'Lanes' : 'Candidates';
        const itemTag = node.tag === 'Parallel' ? 'Lane' : 'Candidate';
        const sections = sectionChildren(node).filter((section) => section.tag === sectionTag);
        if (sections.length !== 1) {
          note('invalid-concurrent-domain', `<${node.tag} #${id ?? ''}> requires exactly one ${sectionTag} section`);
        } else {
          const items = listChildren(sections[0]);
          if (!items.length) note('empty-concurrent-domain', `<${node.tag} #${id ?? ''}> requires at least one ${itemTag}`);
          for (const item of items) {
            if (item.tag !== itemTag) note('invalid-concurrent-item', `<${sectionTag}> contains <${item.tag}>`);
            else validateBody(listChildren(item));
          }
        }
        if (node.tag === 'Parallel' && node.attributes?.join !== undefined && node.attributes.join !== 'all') {
          note('invalid-parallel-join', `<Parallel #${id ?? ''}>.join currently only supports "all"`);
        }
        if (
          node.tag === 'Race'
          && node.attributes?.mode !== 'first-success'
          && node.attributes?.mode !== 'first-completed'
        ) {
          note('invalid-race-mode', `<Race #${id ?? ''}>.mode must be "first-success" or "first-completed"`);
        }
      } else {
        validateBody(listChildren(node));
      }
    }
  };
  validateBody(statementEls);
  const refs = (nodes: XnlEl[], result = new Set<string>()): Set<string> => {
    for (const n of nodes) {
      if (n.tag === 'RunBlock' && typeof n.attributes?.block === 'string') result.add(n.attributes.block.slice(9));
      refs(listChildren(n), result); refs(sectionChildren(n), result);
    }
    return result;
  };
  for (const block of blockEls) {
    validateBody(listChildren(block));
    blockRefs.set(idOf(block) ?? '', refs(listChildren(block)));
  }
  const visited = new Set<string>(), active = new Set<string>();
  const checkBlock = (id: string): void => {
    if (active.has(id)) { note('recursive-block', `block reference cycle at #${id}`); return; }
    if (visited.has(id)) return;
    active.add(id); for (const target of blockRefs.get(id) ?? []) checkBlock(target);
    active.delete(id); visited.add(id);
  };
  for (const id of blockIds) checkBlock(id);

  for (const name of Object.keys(facets) as FacetName[]) {
    if (!ALLOWED_FACETS[form].has(name)) {
      noteOnce(
        'facet-not-allowed',
        `${form} does not allow facet "${name}" (${FACETS[name].uriScheme})`,
      );
    }
  }

  if (noted.size) return { diagnostics };

  const config: Record<string, Record<string, unknown>> = {};
  if (facets.config) {
    for (const e of listChildren(facets.config).filter((e) => e.tag === 'ConfigEntry')) {
      config[idOf(e) ?? ''] = { ...(e.attributes ?? {}) };
    }
  }

  const configDef: Record<string, Record<string, unknown>> = {};
  if (facets['config.def']) {
    for (const e of listChildren(facets['config.def']).filter((e) => e.tag === 'ConfigEntryDef')) {
      configDef[idOf(e) ?? ''] = { ...(e.attributes ?? {}) };
    }
  }

  const fqn = idOf(container) ?? '';
  const contractNode = facets['flow.contract'];
  const contractId = contractNode ? idOf(contractNode) : undefined;
  const contractAttrs = contractNode?.attributes ?? {};
  const flowContract: CtrlFlowContract = contractNode
    ? {
      id: contractId ?? '',
      ...(typeof contractAttrs.input === 'string' ? { input: contractAttrs.input } : {}),
      ...(typeof contractAttrs.output === 'string' ? { output: contractAttrs.output } : {}),
    }
    : { id: fqn };
  if (!contractNode) note('missing-flow-contract', `${form} #${fqn} requires exactly one FlowContract`);
  if (contractNode && contractId !== fqn) note('flow-contract-id-mismatch', 'FlowContract #id must equal the enclosing flow FQN');
  for (const field of ['input', 'output'] as const) {
    const value = contractAttrs[field];
    if (value !== undefined && (typeof value !== 'string' || !CODE_REF.test(value))) {
      note('invalid-flow-contract-type-ref', `FlowContract.${field} must use vfs://path#Export`);
    }
  }
  const stateDef = facets['state.def']
    ? (Object.fromEntries(
        Object.entries(facets['state.def'].attributes ?? {}).map(([k, v]) => [k, String(v)]),
      ) as Record<string, string>)
    : undefined;
  const stateSeed = facets['state.seed'] ? { ...(facets['state.seed'].attributes ?? {}) } : undefined;
  const taskSpace = facets['task.space'] ? toNodeSpec(facets['task.space']) : undefined;
  const rootIdentity = projectFlowRootIdentity(container.metadata ?? {});
  if (rootIdentity.diagnostic) note(rootIdentity.diagnostic.code, rootIdentity.diagnostic.message);
  const spec: FlowBundleSpec = {
    form,
    fqn,
    apiVersion: rootIdentity.apiVersion,
    version: rootIdentity.version,
    title: container.attributes?.title as string | undefined,
    sourceNames,
    baseUri: options.baseUri,
    dir: options.baseUri ?? '',
    statements: statementEls.map(toNodeSpec),
    blocks: Object.fromEntries(blockEls.filter(b => idOf(b)).map(b => [idOf(b)!, listChildren(b).map(toNodeSpec)])),
    ...(definitionStepForest ? { definitionStepForest } : {}),
    flowContract,
    config,
    configDef,
    stateDef,
    stateSeed,
    taskSpace,
    diagnostics,
  };
  if (!fqn.includes('.')) note('container-id-not-fqn', `container #id must be a dotted FQN, got "${fqn}"`);
  return { spec, diagnostics };
}
