/**
 * Behavior Tree Engine
 *
 * Core execution engine with two-layer dispatch:
 * 1. First layer: NodeKind -> NodeLogic (via DispatchEngine)
 * 2. Second layer: Action NodeType -> ActionHandler (via ActionHandlerRegistry)
 *
 * 重构后使用 BehaviorTreeCoreRuntime 和 NodeLogicDispatcher
 * 保持外部 API 不变以兼容现有测试
 */

import { ActionHandlerRegistry } from './ActionHandler';
import { BehaviorTreeCoreRuntime } from './BehaviorTreeCoreRuntime';
import { NodeLogicDispatcher } from './NodeLogicDispatcher';
import {
  BehaviorTreeNode,
  BehaviorTreeData,
  BehaviorTreeCmdType,
  BehaviorTreeNodeStatus,
  INodeConfig,
} from './types';

/**
 * Expression evaluator function type
 */
export type ExpressionEvaluator<TNodeType, TConfig extends INodeConfig> = (
  expr: string,
  btData: BehaviorTreeData<TNodeType, TConfig>,
  nodeKey: string
) => any;

/**
 * Behavior tree execution engine
 */
export class BehaviorTreeEngine<TNodeType = string, TConfig extends INodeConfig = INodeConfig> {
  private nodeLogicDispatcher: NodeLogicDispatcher<TNodeType, TConfig>;
  private evaluateExpression: ExpressionEvaluator<TNodeType, TConfig>;
  private currentRuntime?: BehaviorTreeCoreRuntime<TNodeType, TConfig>;
  private currentBtData?: BehaviorTreeData<TNodeType, TConfig>;

  constructor(
    actionHandlerRegistry: ActionHandlerRegistry<TNodeType, TConfig>,
    evaluateExpression: ExpressionEvaluator<TNodeType, TConfig>
  ) {
    // 保存表达式求值器（用于适配旧接口）
    this.evaluateExpression = evaluateExpression;

    // 初始化第一层分发：NodeKind -> NodeLogic (使用 DispatchEngine)
    this.nodeLogicDispatcher = new NodeLogicDispatcher<TNodeType, TConfig>(
      actionHandlerRegistry
    );
  }

  /**
   * Start executing the behavior tree
   *
   * 适配层：将旧的 BehaviorTreeData 接口转换为新的 Runtime
   */
  async start(btData: BehaviorTreeData<TNodeType, TConfig>, runtime?: unknown): Promise<void> {
    // 创建 Runtime（从 BehaviorTreeData 适配）
    this.currentRuntime = this.createRuntimeFromBtData(btData, runtime);
    this.currentBtData = btData;

    // 初始化 Runtime 状态
    this.currentRuntime.initializeState(btData.NodeTree);

    // 推送初始访问命令
    this.currentRuntime.pushCommand({
      Type: BehaviorTreeCmdType.VisitNode,
      NodeId: this.currentRuntime.innerCtx.state.NodeTree.Key,
    });

    // 处理命令
    await this.runPendingCommandsInternal(this.currentRuntime);

    // 同步 Runtime 状态回 BehaviorTreeData（保持向后兼容）
    this.syncRuntimeToBtData(this.currentRuntime, btData);
  }

  /**
   * Continue processing pending commands (for async operations)
   *
   * 公开方法供 CtrlFlowEngine 等调用，用于处理异步操作添加的命令
   */
  async runPendingCommands(btData: BehaviorTreeData<TNodeType, TConfig>, runtime?: unknown): Promise<void> {
    if (!this.currentRuntime || !this.currentBtData || this.currentBtData !== btData) {
      // 如果没有当前runtime或btData不匹配，说明没有正在执行的树
      return;
    }

    if (runtime !== undefined) {
      this.currentRuntime.outerCtx.runtime = runtime;
    }

    // 处理待处理的命令
    await this.runPendingCommandsInternal(this.currentRuntime);

    // 同步状态
    this.syncRuntimeToBtData(this.currentRuntime, btData);
  }

  /**
   * Process all pending commands in the stack
   *
   * 使用新的 Runtime 和 Dispatcher
   */
  private async runPendingCommandsInternal(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>
  ): Promise<void> {
    while (runtime.innerCtx.state.CmdStack.length > 0) {
      const cmd = runtime.popCommand()!;

      const node = runtime.getNode(cmd.NodeId);
      if (!node) {
        console.error(`Node not found: ${cmd.NodeId}`);
        continue;
      }

      // 使用 Dispatcher 进行分发
      try {
        switch (cmd.Type) {
          case BehaviorTreeCmdType.VisitNode:
            await this.nodeLogicDispatcher.visitNode(runtime, node);
            break;

          case BehaviorTreeCmdType.FinishLeafNode:
            await this.nodeLogicDispatcher.finishLeafNode(runtime, node, cmd.Result!);
            break;

          case BehaviorTreeCmdType.FinishChildNode:
            await this.nodeLogicDispatcher.finishChildNode(
              runtime,
              node,
              cmd.ChildIndex!,
              cmd.Result!
            );
            break;

          default:
            console.error(`Unknown command type: ${cmd.Type}`);
        }
      } catch (error) {
        console.error(`Error executing command:`, error);
        runtime.recordError(cmd.NodeId, error as Error);
      }

      // Allow async operations to complete
      await this.waitForAsyncOperations();
    }
  }

  /**
   * 从 BehaviorTreeData 创建 Runtime（适配层）
   */
  private createRuntimeFromBtData(
    btData: BehaviorTreeData<TNodeType, TConfig>,
    runtime?: unknown
  ): BehaviorTreeCoreRuntime<TNodeType, TConfig> {
    return new BehaviorTreeCoreRuntime<TNodeType, TConfig>({
      callback: {
        evaluateExpression: (expr: string, runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>, nodeKey: string) => {
          // 适配旧的 evaluateExpression 接口
          const adaptedBtData: BehaviorTreeData<TNodeType, TConfig> = {
            Vars: runtime.innerCtx.state.Vars,
            CmdStack: runtime.innerCtx.state.CmdStack,
            CmdHistory: runtime.innerCtx.state.CmdHistory,
            NodeTree: runtime.innerCtx.state.NodeTree,
            NodeMap: runtime.innerCtx.state.NodeMap,
          };
          return this.evaluateExpression(expr, adaptedBtData, nodeKey);
        },
      },
      options: {
        enableHistory: true,
      },
      outerCtx: {
        initialVars: new Map(btData.Vars),
        runtime,
      },
    });
  }

  /**
   * 同步 Runtime 状态回 BehaviorTreeData（保持向后兼容）
   */
  private syncRuntimeToBtData(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    btData.Vars = runtime.innerCtx.state.Vars;
    btData.CmdStack = runtime.innerCtx.state.CmdStack;
    btData.CmdHistory = runtime.innerCtx.state.CmdHistory;
    btData.NodeTree = runtime.innerCtx.state.NodeTree;
    btData.NodeMap = runtime.innerCtx.state.NodeMap;
  }

  /**
   * Wait for async operations (allows action handlers to push commands)
   */
  private async waitForAsyncOperations(): Promise<void> {
    // setImmediate is Node-specific and unavailable in browser service workers.
    // Use it when available, otherwise fall back to queueMicrotask / setTimeout.
    return new Promise((resolve) => {
      if (typeof setImmediate === 'function') {
        setImmediate(resolve);
        return;
      }

      if (typeof queueMicrotask === 'function') {
        queueMicrotask(resolve);
        return;
      }

      setTimeout(resolve, 0);
    });
  }

  /**
   * Get current executing node
   */
  getCurrentNode(btData: BehaviorTreeData<TNodeType, TConfig>): BehaviorTreeNode<TNodeType, TConfig> | null {
    // Find first Started node
    return this.findNodeByStatus(btData.NodeTree, BehaviorTreeNodeStatus.Started);
  }

  /**
   * Find node by status
   */
  private findNodeByStatus(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    status: BehaviorTreeNodeStatus
  ): BehaviorTreeNode<TNodeType, TConfig> | null {
    if (node.Status === status) {
      return node;
    }

    for (const child of node.Children) {
      const found = this.findNodeByStatus(child, status);
      if (found) {
        return found;
      }
    }

    return null;
  }

  /**
   * Check if execution is complete
   */
  isComplete(btData: BehaviorTreeData<TNodeType, TConfig>): boolean {
    return (
      btData.CmdStack.length === 0 &&
      (btData.NodeTree.Status === BehaviorTreeNodeStatus.Success ||
        btData.NodeTree.Status === BehaviorTreeNodeStatus.Failure)
    );
  }

  /**
   * Get final result
   */
  getResult(btData: BehaviorTreeData<TNodeType, TConfig>): 'Success' | 'Failure' | 'Running' {
    if (btData.NodeTree.Status === BehaviorTreeNodeStatus.Success) {
      return 'Success';
    } else if (btData.NodeTree.Status === BehaviorTreeNodeStatus.Failure) {
      return 'Failure';
    } else {
      return 'Running';
    }
  }
}
