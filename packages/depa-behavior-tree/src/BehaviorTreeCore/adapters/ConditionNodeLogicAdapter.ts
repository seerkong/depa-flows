/**
 * Condition Node Logic Adapter
 *
 * 简化版：直接实现核心逻辑，不需要二次分发
 *
 * 设计说明：
 * - Condition 节点的逻辑是固定的，不需要像 Action 节点那样进行二次分发
 * - 直接在 visitNode/onFinishLeafNode 方法中编写核心逻辑
 * - 避免过度设计，保持代码简洁
 */

import { BehaviorTreeCoreRuntime } from '../BehaviorTreeCoreRuntime';
import {
  BehaviorTreeNode,
  BehaviorTreeNodeStatus,
  BehaviorTreeCmdType,
  BehaviorResult,
  INodeConfig,
  IExpressionNodeConfig,
} from '../types';

/**
 * Condition Node Logic Adapter
 *
 * Condition 节点逻辑：
 * - 求值表达式
 * - 表达式为真则成功，为假则失败
 * - 叶子节点，没有子节点
 */
export class ConditionNodeLogicAdapter<
  TNodeType = string,
  TConfig extends INodeConfig = INodeConfig
> {
  /**
   * 访问节点
   */
  visitNode(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>
  ): void {
    node.Status = BehaviorTreeNodeStatus.Started;

    // 求值表达式
    const config = node.Config as unknown as IExpressionNodeConfig;
    let conditionResult = false;

    try {
      conditionResult = runtime.evalExpression(config.expression, node.Key);
    } catch (error) {
      console.error(`Error evaluating condition: ${config.expression}`, error);
      conditionResult = false;
    }

    // 推送完成命令
    runtime.pushCommand({
      Type: BehaviorTreeCmdType.FinishLeafNode,
      NodeId: node.Key,
      Result: conditionResult ? BehaviorResult.Success : BehaviorResult.Failure,
    });
  }

  /**
   * 完成叶子节点
   */
  onFinishLeafNode(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>,
    result: BehaviorResult
  ): void {
    node.Status =
      result === BehaviorResult.Success
        ? BehaviorTreeNodeStatus.Success
        : BehaviorTreeNodeStatus.Failure;

    this.notifyParentNodeFinish(runtime, node, result);
  }

  /**
   * 子节点完成（Condition 不应该有子节点）
   */
  onChildNodeFinish(
    _runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    _node: BehaviorTreeNode<TNodeType, TConfig>,
    _childIndex: number,
    _childResult: BehaviorResult
  ): void {
    throw new Error('Condition node should not have children');
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
}
