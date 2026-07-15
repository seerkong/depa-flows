/**
 * Logic Flow Engine
 *
 * Automated logic flow execution engine based on behavior trees.
 * Registers only core action handlers by default.
 * Extensions can inject additional handlers via the constructor option.
 */

import {
  BehaviorTreeEngine,
  ActionHandlerRegistry,
  ActionHandler,
  BehaviorTreeNode,
  BehaviorTreeData,
  INodeConfig,
  BehaviorTreeNodeStatus,
} from '../BehaviorTreeCore';
import { CtrlFlowNodeType, CtrlFlowResult } from './types';
import { evaluateExpression } from './ExpressionEvaluator';
import {
  SetVariableActionHandler,
  LogActionHandler,
  AssertActionHandler,
  SleepActionHandler,
  RunScriptActionHandler,
  HttpCallActionHandler,
} from './ActionHandlers';

export interface CtrlFlowEngineOptions {
  runtime?: unknown;
  /**
   * Additional action handlers to register alongside the core handlers.
   * Keys are node type strings, values are ActionHandler instances.
   */
  additionalHandlers?: Record<string, ActionHandler<CtrlFlowNodeType, INodeConfig>>;
}

/**
 * Logic Flow engine for executing logic flow behavior trees
 */
export class CtrlFlowEngine {
  private engine: BehaviorTreeEngine<CtrlFlowNodeType, INodeConfig>;
  private actionRegistry: ActionHandlerRegistry<CtrlFlowNodeType, INodeConfig>;
  private logs: string[] = [];
  private runtime?: unknown;

  constructor(options?: CtrlFlowEngineOptions) {
    this.runtime = options?.runtime;

    // Create action handler registry
    this.actionRegistry = new ActionHandlerRegistry<CtrlFlowNodeType, INodeConfig>();

    // Register core action handlers
    this.registerCoreHandlers();

    // Register additional handlers from extensions
    if (options?.additionalHandlers) {
      for (const [nodeType, handler] of Object.entries(options.additionalHandlers)) {
        this.actionRegistry.register(nodeType, handler);
      }
    }

    // Create behavior tree engine
    this.engine = new BehaviorTreeEngine<CtrlFlowNodeType, INodeConfig>(
      this.actionRegistry,
      evaluateExpression
    );
  }

  /**
   * Register core action handlers only
   */
  private registerCoreHandlers(): void {
    this.actionRegistry
      .register(CtrlFlowNodeType.SetVariable, new SetVariableActionHandler())
      .register(CtrlFlowNodeType.Log, new LogActionHandler(this.logs))
      .register(CtrlFlowNodeType.Assert, new AssertActionHandler())
      .register(CtrlFlowNodeType.Sleep, new SleepActionHandler())
      .register(CtrlFlowNodeType.RunScript, new RunScriptActionHandler())
      .register(CtrlFlowNodeType.HttpCall, new HttpCallActionHandler());
  }

  /**
   * Run a test behavior tree
   */
  async runTest(
    testTree: BehaviorTreeNode<CtrlFlowNodeType, INodeConfig>
  ): Promise<CtrlFlowResult> {
    const startTime = Date.now();
    // IMPORTANT: Do not reassign this.logs, otherwise the LogActionHandler
    // will keep a reference to the old array and result.logs will stay empty.
    // Instead, clear the existing array so handlers continue to push into it.
    this.logs.length = 0;
    const errors: string[] = [];

    // Create behavior tree data
    const btData: BehaviorTreeData<CtrlFlowNodeType, INodeConfig> = {
      NodeTree: testTree,
      Vars: new Map(),
      CmdStack: [],
      CmdHistory: [],
      NodeMap: new Map(),
    };

    try {
      // Execute the behavior tree
      await this.engine.start(btData, this.runtime);

      // Wait for completion
      // For async actions (like Sleep), handlers may push commands after the initial
      // start() call has drained the command stack. We need to periodically
      // resume processing pending commands until the tree reaches a terminal state.
      while (!this.engine.isComplete(btData)) {
        // Allow async handlers (setTimeout, network calls, etc.) to progress
        await new Promise((resolve) => setTimeout(resolve, 10));
        // Process any commands that were scheduled by async handlers
        await this.engine.runPendingCommands(btData, this.runtime);
      }

      const duration = Date.now() - startTime;
      const success = btData.NodeTree.Status === BehaviorTreeNodeStatus.Success;

      // Collect errors from failed nodes
      this.collectErrors(btData.NodeTree, errors);

      // Convert variables map to object
      const variables: Record<string, any> = {};
      btData.Vars.forEach((value, key) => {
        variables[key] = value;
      });

      return {
        success,
        duration,
        logs: this.logs,
        errors,
        variables,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      errors.push(`Test execution error: ${error}`);

      return {
        success: false,
        duration,
        logs: this.logs,
        errors,
        variables: {},
      };
    }
  }

  /**
   * Collect error messages from failed nodes
   */
  private collectErrors(
    node: BehaviorTreeNode<CtrlFlowNodeType, INodeConfig>,
    errors: string[]
  ): void {
    for (const child of node.Children) {
      this.collectErrors(child, errors);
    }

    if (node.Status === BehaviorTreeNodeStatus.Failure) {
      const attrError = node.Attr?.error;
      const suffix = attrError ? `: ${attrError}` : '';
      errors.push(`Node "${node.Key}" failed (Kind: ${node.Kind}, Type: ${node.Type})${suffix}`);
    }
  }

  /**
   * Get logs from the last test run
   */
  getLogs(): string[] {
    return [...this.logs];
  }

  /**
   * Clear logs
   */
  clearLogs(): void {
    this.logs = [];
  }
}
