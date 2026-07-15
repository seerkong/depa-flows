/**
 * Action Node Logic Adapter
 *
 * OOP 风格的标准化组件封装
 * 遵循 output = fn(runtime, input, config) 的抽象
 *
 * 实现第二层分发：ActionType -> ActionHandler
 */

import { BehaviorTreeCoreRuntime } from '../BehaviorTreeCoreRuntime';
import {
  BehaviorTreeNode,
  BehaviorTreeNodeStatus,
  BehaviorTreeCmdType,
  BehaviorResult,
  INodeConfig,
  ExecutionContext,
  BehaviorTreeData,
} from '../types';
import { ActionHandlerRegistry } from '../ActionHandler';
import {
  runByFuncStyleAdapter,
  stdMakeNullOuterComputed,
  stdMakeIdentityInnerRuntime,
  stdMakeIdentityInnerConfig,
} from 'depa-processor';

/**
 * Action Node Logic 输入
 */
interface ActionNodeInput<TNodeType, TConfig extends INodeConfig> {
  node: BehaviorTreeNode<TNodeType, TConfig>;
  commandType: 'VisitNode' | 'FinishLeafNode' | 'FinishChildNode';
  leafResult?: BehaviorResult;
}

/**
 * Action Node Logic 输出
 */
interface ActionNodeOutput {
  success: boolean;
}

/**
 * Action Node Logic Adapter (OOP Style)
 *
 * Action 节点逻辑：
 * - 执行叶子节点的动作
 * - 第二层分发到 ActionHandler
 * - 异步执行并推送完成命令
 */
export class ActionNodeLogicAdapter<
  TNodeType = string,
  TConfig extends INodeConfig = INodeConfig
> {
  constructor(
    private actionHandlerRegistry: ActionHandlerRegistry<TNodeType, TConfig>
  ) {}

  /**
   * 将外部请求转换为内部输入（适配层）
   */
  makeInnerInput(
    _runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    request: any
  ): ActionNodeInput<TNodeType, TConfig> {
    return {
      node: request.node,
      commandType: request.commandType,
      leafResult: request.leafResult,
    };
  }

  /**
   * 执行核心业务逻辑
   */
  async runCoreLogic(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    input: ActionNodeInput<TNodeType, TConfig>
  ): Promise<ActionNodeOutput> {
    const { node, commandType } = input;

    switch (commandType) {
      case 'VisitNode':
        return await this.handleVisitNode(runtime, node);

      case 'FinishLeafNode':
        return this.handleFinishLeafNode(runtime, node, input.leafResult!);

      case 'FinishChildNode':
        throw new Error('Action node should not have children');

      default:
        throw new Error(`Unknown command type: ${commandType}`);
    }
  }

  /**
   * 处理访问节点
   */
  private async handleVisitNode(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>
  ): Promise<ActionNodeOutput> {
    node.Status = BehaviorTreeNodeStatus.Started;

    // 第二层分发：查找此 action type 的 handler
    const handler = this.actionHandlerRegistry.getHandler(node.Type);

    if (!handler) {
      console.error(`No action handler registered for type: ${node.Type}`);
      // 推送失败命令
      runtime.pushCommand({
        Type: BehaviorTreeCmdType.FinishLeafNode,
        NodeId: node.Key,
        Result: BehaviorResult.Failure,
      });
      return { success: true };
    }

    // 创建执行上下文（从 Runtime 适配）
    const context = this.createExecutionContextFromRuntime(runtime, node);

    // 使用 async/await 执行 handler
    try {
      const result = await handler.execute(context);
      // 推送完成命令
      runtime.pushCommand({
        Type: BehaviorTreeCmdType.FinishLeafNode,
        NodeId: node.Key,
        Result: result,
      });
    } catch (error) {
      console.error(`Error executing action handler:`, error);
      // 推送失败命令
      runtime.pushCommand({
        Type: BehaviorTreeCmdType.FinishLeafNode,
        NodeId: node.Key,
        Result: BehaviorResult.Failure,
      });
    }

    return { success: true };
  }

  /**
   * 处理完成叶子节点
   */
  private handleFinishLeafNode(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>,
    result: BehaviorResult
  ): ActionNodeOutput {
    node.Status =
      result === BehaviorResult.Success
        ? BehaviorTreeNodeStatus.Success
        : BehaviorTreeNodeStatus.Failure;

    this.notifyParentNodeFinish(runtime, node, result);

    return { success: true };
  }

  /**
   * 通知父节点完成
   */
  private notifyParentNodeFinish(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>,
    result: BehaviorResult
  ): void {
    if (node.Parent) {
      const parentNode = runtime.getNode(node.Parent);
      if (parentNode) {
        const childIndex = parentNode.Children.findIndex((c) => c.Key === node.Key);
        runtime.pushCommand({
          Type: BehaviorTreeCmdType.FinishChildNode,
          NodeId: node.Parent,
          ChildIndex: childIndex,
          Result: result,
        });
      }
    }
  }

  /**
   * 从 Runtime 创建 ExecutionContext（适配层）
   *
   * 将新的 BehaviorTreeCoreRuntime 适配到旧的 ExecutionContext 接口
   * 这样 ActionHandler 不需要修改就能继续工作
   */
  private createExecutionContextFromRuntime(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>
  ): ExecutionContext<TNodeType, TConfig> {
    // 创建适配的 BehaviorTreeData（为了兼容旧的 ActionHandler 接口）
    const adaptedBtData: BehaviorTreeData<TNodeType, TConfig> = {
      Vars: runtime.innerCtx.state.Vars,
      CmdStack: runtime.innerCtx.state.CmdStack,
      CmdHistory: runtime.innerCtx.state.CmdHistory,
      NodeTree: runtime.innerCtx.state.NodeTree,
      NodeMap: runtime.innerCtx.state.NodeMap,
    };

    return {
      node,
      btData: adaptedBtData,
      getVar(key: string): any {
        return runtime.getVar(key);
      },
      setVar(key: string, value: any): void {
        runtime.setVar(key, value);
      },
      evalExpression(expr: string): any {
        return runtime.evalExpression(expr, node.Key);
      },
      runtime: runtime.outerCtx.runtime,
    };
  }

  /**
   * 分发执行（标准化封装入口）
   */
  async dispatch(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    request: any
  ): Promise<ActionNodeOutput> {
    return await runByFuncStyleAdapter(
      runtime,
      request,
      null,
      stdMakeNullOuterComputed,
      stdMakeIdentityInnerRuntime,
      (rt, req, _cfg, _derived) => this.makeInnerInput(rt, req),
      stdMakeIdentityInnerConfig,
      (rt, input, _cfg) => this.runCoreLogic(rt, input),
      (_rt, _req, _cfg, _derived, result) => result
    );
  }

  /**
   * 便捷方法：访问节点
   */
  visitNode(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>
  ): void {
    this.dispatch(runtime, {
      node,
      commandType: 'VisitNode',
    });
  }

  /**
   * 便捷方法：完成叶子节点
   */
  onFinishLeafNode(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>,
    result: BehaviorResult
  ): void {
    this.dispatch(runtime, {
      node,
      commandType: 'FinishLeafNode',
      leafResult: result,
    });
  }

  /**
   * 便捷方法：子节点完成（应抛出错误）
   */
  onChildNodeFinish(
    _runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    _node: BehaviorTreeNode<TNodeType, TConfig>,
    _childIndex: number,
    _childResult: BehaviorResult
  ): void {
    throw new Error('Action node should not have children');
  }
}
