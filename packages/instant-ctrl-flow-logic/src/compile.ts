import {
  BehaviorTreeNodeKind,
  CtrlFlowDsl,
  type BehaviorTreeNode,
  type CtrlFlowNodeType,
  type INodeConfig,
} from 'depa-behavior-tree';
import type { FlowBundleSpec, FlowNodeSpec } from 'instant-ctrl-flow-contract';

export type CtrlNode = BehaviorTreeNode<CtrlFlowNodeType, INodeConfig>;

const INTERRUPTIBLE = new Set(['ExternalJob', 'Timer', 'TaskStep']);
const VIEW_ATTRS = new Set(['status', 'iterations', 'runStatus', 'tickNo']);

export class FlowCompileError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
  }
}

function resolveConfigValue(spec: FlowBundleSpec, value: unknown, where: string): unknown {
  if (typeof value === 'string' && value.startsWith('config://#')) {
    const [id, ...subpath] = value.slice('config://#'.length).split('/');
    let current: unknown = spec.config[id];
    if (current === undefined) throw new FlowCompileError('unresolved-config-ref', `${where}: ${value}`);
    for (const key of subpath) {
      if (!current || typeof current !== 'object' || !(key in current)) {
        throw new FlowCompileError('unresolved-config-subpath', `${where}: ${value}`);
      }
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }
  if (Array.isArray(value)) return value.map((item) => resolveConfigValue(spec, item, where));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveConfigValue(spec, item, where)]),
    );
  }
  return value;
}

function resolvedAttrs(spec: FlowBundleSpec, node: FlowNodeSpec): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(node.attrs)
      .filter(([key]) => !VIEW_ATTRS.has(key))
      .map(([key, value]) => [key, resolveConfigValue(spec, value, `node #${node.id ?? node.tag}`)]),
  );
}

function statementConfig(attrs: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const config = attrs.config;
  return Object.freeze(config && typeof config === 'object' && !Array.isArray(config) ? { ...config } : {});
}

const action = (type: string, key: string, config: Record<string, unknown> = {}): CtrlNode =>
  CtrlFlowDsl.node(type as CtrlFlowNodeType, { key }, config as INodeConfig);

const sequence = (key: string, children: CtrlNode[]): CtrlNode =>
  CtrlFlowDsl.node('Sequence' as CtrlFlowNodeType, { key }, {}, children);

const selector = (key: string, children: CtrlNode[]): CtrlNode =>
  CtrlFlowDsl.node('Selector' as CtrlFlowNodeType, { key }, {}, children);

export interface CompileHelpers {
  meta: { key: string; name?: string };
  attrs: Record<string, unknown>;
  compileStatements(nodes: FlowNodeSpec[], key: string): CtrlNode;
}

export type CompileExtension = (
  spec: FlowBundleSpec,
  node: FlowNodeSpec,
  helpers: CompileHelpers,
) => CtrlNode | null;

function compileStatement(
  spec: FlowBundleSpec,
  node: FlowNodeSpec,
  extension: CompileExtension | undefined,
  path: string,
): CtrlNode {
  const key = node.id ?? path;
  const attrs = resolvedAttrs(spec, node);
  const compileStatements = (nodes: FlowNodeSpec[], bodyKey: string) =>
    sequence(bodyKey, nodes.map((child, index) => compileStatement(spec, child, extension, `${bodyKey}.${index}`)));
  const helpers: CompileHelpers = { meta: { key, name: node.id }, attrs, compileStatements };

  const extended = extension?.(spec, node, helpers);
  if (extended) return extended;

  if (INTERRUPTIBLE.has(node.tag)) {
    throw new FlowCompileError('interruptible-in-instant-ctrl-flow', `<${node.tag} #${node.id}> illegal in InstantCtrlFlow`);
  }

  switch (node.tag) {
    case 'Run':
      return action('flow.Run', key, { src: String(attrs.src ?? ''), config: statementConfig(attrs) });
    case 'Return':
      return action('flow.Return', key, {
        src: attrs.src === undefined ? undefined : String(attrs.src),
        hasValue: Object.prototype.hasOwnProperty.call(attrs, 'value'),
        value: attrs.value,
        config: statementConfig(attrs),
      });
    case 'If': {
      const ifPath = key;
      const branches = node.sections.Branches?.children ?? [];
      const choices = branches.map((branch, index) => {
        const branchKey = branch.id ?? `${key}.branch.${index}`;
        if (branch.tag === 'Otherwise') {
          return sequence(`${branchKey}.__choice`, [
            action('flow.Otherwise', `${branchKey}.__otherwise`, {
              ifPath,
              branchKey,
              decisionKind: 'Otherwise',
            }),
            compileStatements(branch.children, `${branchKey}.__body`),
          ]);
        }
        if (branch.tag !== 'Branch') {
          throw new FlowCompileError('invalid-if-branch', `<If #${key}> contains <${branch.tag}>`);
        }
        const branchAttrs = resolvedAttrs(spec, branch);
        return sequence(`${branchKey}.__choice`, [
          action('flow.Predicate', `${branchKey}.__predicate`, {
            ifPath,
            branchKey,
            src: String(branchAttrs.when ?? ''),
            config: statementConfig(branchAttrs),
          }),
          compileStatements(branch.children, `${branchKey}.__body`),
        ]);
      });
      if (!branches.some((branch) => branch.tag === 'Otherwise')) {
        choices.push(action('flow.Otherwise', `${key}.__no_match`, { ifPath, decisionKind: 'NoMatch' }));
      }
      return sequence(key, [
        action('flow.IfStart', `${key}.__start`, { ifPath }),
        selector(`${key}.__branches`, choices),
      ]);
    }
    case 'Fallback': {
      const strategies = node.children.map((strategy, index) => {
        if (strategy.tag !== 'Strategy') {
          throw new FlowCompileError('invalid-fallback-strategy', `<Fallback #${key}> contains <${strategy.tag}>`);
        }
        const strategyKey = strategy.id ?? `${key}.strategy.${index}`;
        return sequence(`${strategyKey}.__strategy`, [
          action('flow.StrategyStart', `${strategyKey}.__start`, { fallbackKey: key }),
          compileStatements(strategy.children, `${strategyKey}.__body`),
        ]);
      });
      if (!strategies.length) throw new FlowCompileError('empty-fallback', `<Fallback #${key}> has no Strategy`);
      return sequence(key, [
        action('flow.FallbackStart', `${key}.__start`, { fallbackKey: key }),
        selector(`${key}.__strategies`, strategies),
      ]);
    }
    case 'Until': {
      const predicateKey = `${key}.__predicate_value`;
      const predicateConfig = {
        predicateKey,
        src: String(attrs.when ?? ''),
        config: statementConfig(attrs),
        maxIterations: Number(attrs.maxIterations ?? 9999),
      };
      const initial = action('flow.UntilPredicate', `${key}.__check.initial`, { ...predicateConfig, countIteration: false });
      const repeated = action('flow.UntilPredicate', `${key}.__check.repeat`, { ...predicateConfig, countIteration: true });
      const body = sequence(`${key}.__body`, [compileStatements(node.children, `${key}.__statements`), repeated]);
      const until = CtrlFlowDsl.node(
        'Until' as CtrlFlowNodeType,
        { key: `${key}.__until` },
        { expression: `getVar("__flow_execution__").untilValues[${JSON.stringify(predicateKey)}] === true` },
        [body],
      );
      return sequence(key, [initial, until]);
    }
    case 'Require':
      return action('flow.Require', key, {
        src: String(attrs.when ?? ''),
        config: statementConfig(attrs),
      });
    case 'Retry':
    case 'Timeout':
      return action(`flow.${node.tag}`, key, {
        ...attrs,
        config: statementConfig(attrs),
        statements: node.children,
      });
    case 'ForEach':
      return action('flow.ForEach', key, {
        ...attrs,
        src: String(attrs.when ?? ''),
        config: statementConfig(attrs),
        statements: node.children,
      });
    case 'Parallel': {
      const lanes = node.sections.Lanes?.children ?? [];
      return action('flow.Parallel', key, {
        ...attrs,
        items: lanes.map((lane) => ({ id: lane.id, statements: lane.children })),
      });
    }
    case 'Race': {
      const candidates = node.sections.Candidates?.children ?? [];
      return action('flow.Race', key, {
        ...attrs,
        items: candidates.map((candidate) => ({ id: candidate.id, statements: candidate.children })),
      });
    }
    case 'CallFlow':
      return action('flow.CallFlow', key, {
        flow: String(attrs.flow ?? ''),
        config: statementConfig(attrs),
      });
    default:
      throw new FlowCompileError('unknown-node-tag', `unknown statement tag <${node.tag}>`);
  }
}

export function compileNode(spec: FlowBundleSpec, node: FlowNodeSpec, extension?: CompileExtension): CtrlNode {
  return compileStatement(spec, node, extension, node.id ?? node.tag);
}

export function compileBundle(spec: FlowBundleSpec, extension?: CompileExtension): CtrlNode {
  const root = sequence('__statements__', spec.statements.map((node, index) =>
    compileStatement(spec, node, extension, `statement.${index}`),
  ));
  root.Kind = BehaviorTreeNodeKind.Sequence;
  return root;
}
