import { BehaviorTreeNode, INodeConfig } from '../BehaviorTreeCore';
import {
  CtrlFlowNodeMeta,
  CtrlFlowNodeType,
  AssertConfig,
} from './types';
import { CtrlFlowBuilder } from './CtrlFlowBuilder';

type CtrlFlowNode = BehaviorTreeNode<CtrlFlowNodeType, INodeConfig>;

export class CtrlFlowDsl {
  static node(
    nodeType: CtrlFlowNodeType,
    metaOrConfig?: CtrlFlowNodeMeta | INodeConfig | CtrlFlowNode[],
    configOrSubNodes?: INodeConfig | CtrlFlowNode[],
    subNodes?: CtrlFlowNode[]
  ): CtrlFlowNode {
    return CtrlFlowBuilder.node(nodeType, metaOrConfig, configOrSubNodes, subNodes);
  }

  static sequence(...children: CtrlFlowNode[]): CtrlFlowNode {
    return CtrlFlowBuilder.sequence(...children);
  }

  static selector(...children: CtrlFlowNode[]): CtrlFlowNode {
    return CtrlFlowBuilder.selector(...children);
  }

  static condition(expression: string, meta?: CtrlFlowNodeMeta): CtrlFlowNode {
    return CtrlFlowBuilder.condition(expression, meta);
  }

  static checkExpression(expression: string, meta?: CtrlFlowNodeMeta): CtrlFlowNode {
    return CtrlFlowBuilder.checkExpression(expression, meta);
  }

  static checkVariable(
    variableName: string,
    expectedValue?: unknown,
    operator: 'equals' | 'notEquals' | 'greaterThan' | 'lessThan' | 'exists' | 'notExists' = 'equals',
    meta?: CtrlFlowNodeMeta
  ): CtrlFlowNode {
    return CtrlFlowBuilder.checkVariable(variableName, expectedValue, operator, meta);
  }

  static until(expression: string, ...children: CtrlFlowNode[]): CtrlFlowNode {
    return CtrlFlowBuilder.until(expression, ...children);
  }

  static setVariable(variableName: string, value: unknown, meta?: CtrlFlowNodeMeta): CtrlFlowNode {
    return CtrlFlowBuilder.setVariable(variableName, value, meta);
  }

  static log(message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info', meta?: CtrlFlowNodeMeta): CtrlFlowNode {
    return CtrlFlowBuilder.log(message, level, meta);
  }

  static assert(
    expression: string,
    errorMessage?: string,
    options?: Partial<AssertConfig>,
    meta?: CtrlFlowNodeMeta
  ): CtrlFlowNode {
    return CtrlFlowBuilder.assert(expression, errorMessage, options, meta);
  }

  static sleep(duration: number, meta?: CtrlFlowNodeMeta): CtrlFlowNode {
    return CtrlFlowBuilder.sleep(duration, meta);
  }

  static runScript(script: string, meta?: CtrlFlowNodeMeta): CtrlFlowNode {
    return CtrlFlowBuilder.runScript(script, meta);
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
    return CtrlFlowBuilder.httpCall(url, method, options, meta);
  }
}
