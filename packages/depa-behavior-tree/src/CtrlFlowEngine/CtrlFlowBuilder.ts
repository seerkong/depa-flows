import {
  BehaviorTreeNode,
  BehaviorTreeNodeKind,
  BehaviorTreeNodeStatus,
  INodeConfig,
} from '../BehaviorTreeCore';
import {
  CtrlFlowNodeMeta,
  CtrlFlowNodeType,
  CheckVariableConfig,
  SetVariableConfig,
  LogConfig,
  AssertConfig,
  SleepConfig,
  RunScriptConfig,
  HttpCallConfig,
  CheckExpressionConfig,
} from './types';
import { validateNodeConfig } from './NodeConfigSchema';
import { resolveNodeKind } from './NodeTypeRegistry';

type CtrlFlowNode = BehaviorTreeNode<CtrlFlowNodeType, INodeConfig>;

let nodeCounter = 0;

function generateKey(prefix: string): string {
  nodeCounter += 1;
  return `${prefix}_${nodeCounter}`;
}

function nodeTypeToKeyPrefix(nodeType: CtrlFlowNodeType): string {
  return nodeType.toLowerCase();
}

function isMeta(value: unknown): value is CtrlFlowNodeMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return 'key' in candidate || 'name' in candidate;
}

function normalizeNodeArgs(
  arg2?: CtrlFlowNodeMeta | INodeConfig | CtrlFlowNode[],
  arg3?: INodeConfig | CtrlFlowNode[],
  arg4?: CtrlFlowNode[]
): {
  meta: CtrlFlowNodeMeta | undefined;
  config: INodeConfig;
  subNodes: CtrlFlowNode[];
} {
  if (isMeta(arg2)) {
    const config = Array.isArray(arg3) || arg3 === undefined ? {} : arg3;
    const subNodes = Array.isArray(arg3) ? arg3 : arg4 ?? [];
    return {
      meta: arg2,
      config,
      subNodes,
    };
  }

  if (arg2 === undefined) {
    const config = Array.isArray(arg3) || arg3 === undefined ? {} : arg3;
    const subNodes = Array.isArray(arg3) ? arg3 : arg4 ?? [];
    return {
      meta: undefined,
      config,
      subNodes,
    };
  }

  const config = Array.isArray(arg2) ? {} : arg2;
  const subNodes = Array.isArray(arg2) ? arg2 : Array.isArray(arg3) ? arg3 : arg4 ?? [];
  return {
    meta: undefined,
    config,
    subNodes,
  };
}

function assertValidConfig(nodeType: CtrlFlowNodeType, config: INodeConfig): void {
  const issues = validateNodeConfig(nodeType, config);
  if (issues.length === 0) {
    return;
  }

  const details = issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
  throw new Error(`Invalid config for node type ${nodeType}: ${details}`);
}

function buildCheckVariableExpression(config: CheckVariableConfig): string {
  const varName = config.variableName;
  const valueLiteral = JSON.stringify(config.expectedValue);
  switch (config.operator) {
    case 'notEquals':
      return `${varName} !== ${valueLiteral}`;
    case 'greaterThan':
      return `${varName} > ${valueLiteral}`;
    case 'lessThan':
      return `${varName} < ${valueLiteral}`;
    case 'exists':
      return `typeof ${varName} !== "undefined"`;
    case 'notExists':
      return `typeof ${varName} === "undefined"`;
    case 'equals':
    default:
      return `${varName} === ${valueLiteral}`;
  }
}

export class CtrlFlowBuilder {
  static node(
    nodeType: CtrlFlowNodeType,
    arg2?: CtrlFlowNodeMeta | INodeConfig | CtrlFlowNode[],
    arg3?: INodeConfig | CtrlFlowNode[],
    arg4?: CtrlFlowNode[]
  ): CtrlFlowNode {
    const { meta, config, subNodes } = normalizeNodeArgs(arg2, arg3, arg4);
    const kind = resolveNodeKind(nodeType);
    const key = typeof meta?.key === 'string' && meta.key.length > 0
      ? meta.key
      : generateKey(nodeTypeToKeyPrefix(nodeType));

    if (kind === BehaviorTreeNodeKind.Action && subNodes.length > 0) {
      throw new Error(`Invalid node shape for ${nodeType}: action node cannot contain subNodes.`);
    }

    assertValidConfig(nodeType, config);

    let normalizedConfig: INodeConfig = config;
    if (nodeType === CtrlFlowNodeType.CheckVariable) {
      const checkVariableConfig = config as CheckVariableConfig;
      const expressionConfig: CheckExpressionConfig = {
        ...(checkVariableConfig as unknown as CheckExpressionConfig),
        expression: buildCheckVariableExpression(checkVariableConfig),
      };
      normalizedConfig = expressionConfig;
    }

    const attr: Record<string, string | undefined> = {};
    if (meta && Object.prototype.hasOwnProperty.call(meta, 'key')) {
      attr.key = meta.key;
    }
    if (meta && Object.prototype.hasOwnProperty.call(meta, 'name')) {
      attr.name = meta.name;
    }

    return {
      Kind: kind,
      Type: nodeType,
      Key: key,
      Name: meta?.name,
      Attr: attr,
      Status: BehaviorTreeNodeStatus.Init,
      Config: normalizedConfig,
      Children: subNodes,
    };
  }

  static sequence(...subNodes: CtrlFlowNode[]): CtrlFlowNode;
  static sequence(meta: CtrlFlowNodeMeta, ...subNodes: CtrlFlowNode[]): CtrlFlowNode;
  static sequence(meta: CtrlFlowNodeMeta | undefined, subNodes: CtrlFlowNode[]): CtrlFlowNode;
  static sequence(
    metaOrFirstNode?: CtrlFlowNodeMeta | CtrlFlowNode,
    secondArg?: CtrlFlowNode | CtrlFlowNode[],
    ...restNodes: CtrlFlowNode[]
  ): CtrlFlowNode {
    if (isMeta(metaOrFirstNode)) {
      const subNodes = Array.isArray(secondArg)
        ? secondArg
        : [secondArg, ...restNodes].filter((node): node is CtrlFlowNode => node !== undefined);
      return this.node(CtrlFlowNodeType.Sequence, metaOrFirstNode, {}, subNodes);
    }

    const subNodes: CtrlFlowNode[] = [];
    if (metaOrFirstNode !== undefined) {
      subNodes.push(metaOrFirstNode);
    }
    if (Array.isArray(secondArg)) {
      subNodes.push(...secondArg);
    } else if (secondArg !== undefined) {
      subNodes.push(secondArg);
    }
    subNodes.push(...restNodes);
    return this.node(CtrlFlowNodeType.Sequence, undefined, {}, subNodes);
  }

  static selector(...subNodes: CtrlFlowNode[]): CtrlFlowNode;
  static selector(meta: CtrlFlowNodeMeta, ...subNodes: CtrlFlowNode[]): CtrlFlowNode;
  static selector(meta: CtrlFlowNodeMeta | undefined, subNodes: CtrlFlowNode[]): CtrlFlowNode;
  static selector(
    metaOrFirstNode?: CtrlFlowNodeMeta | CtrlFlowNode,
    secondArg?: CtrlFlowNode | CtrlFlowNode[],
    ...restNodes: CtrlFlowNode[]
  ): CtrlFlowNode {
    if (isMeta(metaOrFirstNode)) {
      const subNodes = Array.isArray(secondArg)
        ? secondArg
        : [secondArg, ...restNodes].filter((node): node is CtrlFlowNode => node !== undefined);
      return this.node(CtrlFlowNodeType.Selector, metaOrFirstNode, {}, subNodes);
    }

    const subNodes: CtrlFlowNode[] = [];
    if (metaOrFirstNode !== undefined) {
      subNodes.push(metaOrFirstNode);
    }
    if (Array.isArray(secondArg)) {
      subNodes.push(...secondArg);
    } else if (secondArg !== undefined) {
      subNodes.push(secondArg);
    }
    subNodes.push(...restNodes);
    return this.node(CtrlFlowNodeType.Selector, undefined, {}, subNodes);
  }

  static condition(expression: string, meta?: CtrlFlowNodeMeta): CtrlFlowNode {
    const config: CheckExpressionConfig = { expression };
    return this.node(CtrlFlowNodeType.Condition, meta, config);
  }

  static checkExpression(expression: string, meta?: CtrlFlowNodeMeta): CtrlFlowNode {
    const config: CheckExpressionConfig = { expression };
    return this.node(CtrlFlowNodeType.CheckExpression, meta, config);
  }

  static checkVariable(
    variableName: string,
    expectedValue?: unknown,
    operator: CheckVariableConfig['operator'] = 'equals',
    meta?: CtrlFlowNodeMeta
  ): CtrlFlowNode {
    const config: CheckVariableConfig = {
      variableName,
      expectedValue,
      operator,
    };
    return this.node(CtrlFlowNodeType.CheckVariable, meta, config);
  }

  static until(expression: string, ...subNodes: CtrlFlowNode[]): CtrlFlowNode;
  static until(expression: string, subNodes: CtrlFlowNode[], meta?: CtrlFlowNodeMeta): CtrlFlowNode;
  static until(expression: string, meta: CtrlFlowNodeMeta, ...subNodes: CtrlFlowNode[]): CtrlFlowNode;
  static until(
    expression: string,
    arg2?: CtrlFlowNodeMeta | CtrlFlowNode | CtrlFlowNode[],
    arg3?: CtrlFlowNodeMeta | CtrlFlowNode,
    ...restNodes: CtrlFlowNode[]
  ): CtrlFlowNode {
    let meta: CtrlFlowNodeMeta | undefined;
    let subNodes: CtrlFlowNode[] = [];

    if (isMeta(arg2)) {
      meta = arg2;
      if (Array.isArray(arg3)) {
        subNodes = arg3;
      } else {
        subNodes = [arg3, ...restNodes].filter((node): node is CtrlFlowNode => node !== undefined);
      }
    } else if (Array.isArray(arg2)) {
      subNodes = arg2;
      if (isMeta(arg3)) {
        meta = arg3;
      } else if (arg3 !== undefined) {
        subNodes = [...subNodes, arg3, ...restNodes];
      }
    } else {
      if (arg2 !== undefined) {
        subNodes.push(arg2);
      }
      if (isMeta(arg3)) {
        meta = arg3;
      } else if (arg3 !== undefined) {
        subNodes.push(arg3);
      }
      subNodes.push(...restNodes);
    }

    const config: CheckExpressionConfig = { expression };
    return this.node(CtrlFlowNodeType.Until, meta, config, subNodes);
  }

  static setVariable(variableName: string, value: unknown, meta?: CtrlFlowNodeMeta): CtrlFlowNode {
    const config: SetVariableConfig = { variableName, value };
    return this.node(CtrlFlowNodeType.SetVariable, meta, config);
  }

  static log(
    message: string,
    level: 'info' | 'warn' | 'error' | 'debug' = 'info',
    meta?: CtrlFlowNodeMeta
  ): CtrlFlowNode {
    const config: LogConfig = { message, level };
    return this.node(CtrlFlowNodeType.Log, meta, config);
  }

  static assert(
    expression: string,
    errorMessage?: string,
    options?: Partial<AssertConfig>,
    meta?: CtrlFlowNodeMeta
  ): CtrlFlowNode {
    const config: AssertConfig = { expression, ...options };
    if (errorMessage !== undefined) {
      config.errorMessage = errorMessage;
    }
    return this.node(CtrlFlowNodeType.Assert, meta, config);
  }

  static sleep(duration: number, meta?: CtrlFlowNodeMeta): CtrlFlowNode {
    const config: SleepConfig = { duration };
    return this.node(CtrlFlowNodeType.Sleep, meta, config);
  }

  static runScript(script: string, meta?: CtrlFlowNodeMeta): CtrlFlowNode {
    const config: RunScriptConfig = { script };
    return this.node(CtrlFlowNodeType.RunScript, meta, config);
  }

  static httpCall(
    url: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    options?: {
      headers?: Record<string, string>;
      body?: unknown;
      saveResponseTo?: string;
    },
    meta?: CtrlFlowNodeMeta
  ): CtrlFlowNode {
    const config: HttpCallConfig = {
      url,
      method,
    };
    if (options?.headers !== undefined) {
      config.headers = options.headers;
    }
    if (options?.body !== undefined) {
      config.body = options.body;
    }
    if (options?.saveResponseTo !== undefined) {
      config.saveResponseTo = options.saveResponseTo;
    }
    return this.node(CtrlFlowNodeType.HttpCall, meta, config);
  }
}
