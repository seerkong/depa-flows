/**
 * Action Handler Interface
 *
 * Defines the contract for handling Action nodes (second-layer dispatch)
 */

import {
  BehaviorTreeNode,
  BehaviorTreeData,
  BehaviorResult,
  INodeConfig,
  ExecutionContext,
} from './types';

/**
 * Action handler for executing Action nodes
 *
 * Business logic implements this interface to handle specific action types
 */
export interface ActionHandler<TNodeType = string, TConfig extends INodeConfig = INodeConfig> {
  /**
   * Execute the action
   *
   * @param context - Execution context
   * @returns Promise resolving to execution result
   */
  execute(context: ExecutionContext<TNodeType, TConfig>): Promise<BehaviorResult>;
}

/**
 * Action handler registry
 *
 * Registers and retrieves action handlers based on node type
 */
export class ActionHandlerRegistry<TNodeType = string, TConfig extends INodeConfig = INodeConfig> {
  private handlers = new Map<TNodeType, ActionHandler<TNodeType, TConfig>>();

  /**
   * Register an action handler for a specific node type
   */
  register(type: TNodeType, handler: ActionHandler<TNodeType, TConfig>): this {
    this.handlers.set(type, handler);
    return this;
  }

  /**
   * Get handler for a specific node type
   */
  getHandler(type: TNodeType): ActionHandler<TNodeType, TConfig> | null {
    return this.handlers.get(type) || null;
  }

  /**
   * Check if handler exists for a type
   */
  hasHandler(type: TNodeType): boolean {
    return this.handlers.has(type);
  }
}

/**
 * Create execution context for action handlers
 */
export function createExecutionContext<
  TNodeType = string,
  TConfig extends INodeConfig = INodeConfig
>(
  node: BehaviorTreeNode<TNodeType, TConfig>,
  btData: BehaviorTreeData<TNodeType, TConfig>,
  evaluateExpression: (expr: string, btData: BehaviorTreeData<TNodeType, TConfig>, nodeKey: string) => any,
  runtime?: unknown
): ExecutionContext<TNodeType, TConfig> {
  return {
    node,
    btData,
    getVar(key: string): any {
      return btData.Vars.get(key);
    },
    setVar(key: string, value: any): void {
      btData.Vars.set(key, value);
    },
    evalExpression(expr: string): any {
      return evaluateExpression(expr, btData, node.Key);
    },
    runtime,
  };
}
