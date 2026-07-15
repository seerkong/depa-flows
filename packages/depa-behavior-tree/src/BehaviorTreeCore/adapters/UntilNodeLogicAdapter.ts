/**
 * Until Node Logic Adapter
 *
 * 简化版：直接实现核心逻辑，不需要二次分发
 *
 * 设计说明：
 * - Until 节点的逻辑是固定的，不需要像 Action 节点那样进行二次分发
 * - 直接在 visitNode/onChildNodeFinish 方法中编写核心逻辑
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

// 最大迭代次数，防止死循环
const MAX_UNTIL_ITERATIONS = 9999;

/**
 * Until Node Logic Adapter
 *
 * Until 节点逻辑：
 * - 循环执行子节点，直到条件满足
 * - 条件满足时成功
 * - 任何子节点失败则整体失败
 */
export class UntilNodeLogicAdapter<
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

    // 检查终止条件
    const config = node.Config as unknown as IExpressionNodeConfig;
    let conditionMet = false;

    try {
      conditionMet = runtime.evalExpression(config.expression, node.Key);
    } catch (error) {
      console.error(`Error evaluating until condition: ${config.expression}`, error);
      conditionMet = false;
    }

    if (conditionMet) {
      // 条件已满足，成功完成
      node.Status = BehaviorTreeNodeStatus.Success;
      this.notifyParentNodeFinish(runtime, node, BehaviorResult.Success);
    } else {
      // 条件未满足，执行子节点
      const firstChild = this.getFirstExecutableChild(node);
      if (firstChild) {
        runtime.pushCommand({
          Type: BehaviorTreeCmdType.VisitNode,
          NodeId: firstChild.Key,
        });
      } else {
        // 没有子节点 - 无法继续
        node.Status = BehaviorTreeNodeStatus.Failure;
        this.notifyParentNodeFinish(runtime, node, BehaviorResult.Failure);
      }
    }
  }

  /**
   * 子节点完成
   */
  onChildNodeFinish(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>,
    childIndex: number,
    childResult: BehaviorResult
  ): void {
    // 如果任何子节点失败，Until 节点应立即失败
    if (childResult === BehaviorResult.Failure) {
      node.Status = BehaviorTreeNodeStatus.Failure;
      this.markRemainingChildrenAsOmitted(node, childIndex);
      this.notifyParentNodeFinish(runtime, node, BehaviorResult.Failure);
      return;
    }

    // 再次检查终止条件
    const config = node.Config as unknown as IExpressionNodeConfig;
    let conditionMet = false;

    try {
      conditionMet = runtime.evalExpression(config.expression, node.Key);
    } catch (error) {
      console.error(`Error evaluating until condition: ${config.expression}`, error);
      conditionMet = false;
    }

    if (conditionMet) {
      // 条件已满足，成功完成
      node.Status = BehaviorTreeNodeStatus.Success;
      this.markRemainingChildrenAsOmitted(node, childIndex);
      this.notifyParentNodeFinish(runtime, node, BehaviorResult.Success);
    } else {
      // 条件未满足，继续循环
      const nextChild = this.getNextExecutableChild(node, childIndex);
      if (nextChild) {
        // 执行下一个子节点
        runtime.pushCommand({
          Type: BehaviorTreeCmdType.VisitNode,
          NodeId: nextChild.Key,
        });
      } else {
        // 从第一个子节点重新开始循环
        // 跟踪迭代次数以避免死循环
        const counterKey = `__until_iterations_${node.Key}`;
        const currentIterations = (runtime.getVar(counterKey) as number | undefined) ?? 0;
        const nextIterations = currentIterations + 1;
        runtime.setVar(counterKey, nextIterations);

        if (nextIterations >= MAX_UNTIL_ITERATIONS) {
          // 中止循环以防止无限执行
          console.warn(
            `Until node "${node.Key}" exceeded max iterations (${MAX_UNTIL_ITERATIONS}), aborting loop.`
          );
          node.Status = BehaviorTreeNodeStatus.Failure;
          this.notifyParentNodeFinish(runtime, node, BehaviorResult.Failure);
          return;
        }

        // 重置所有子节点（及其后代）为 Init 状态
        node.Children.forEach((child) => {
          this.resetSubtree(child);
        });

        const firstChild = this.getFirstExecutableChild(node);
        if (firstChild) {
          runtime.pushCommand({
            Type: BehaviorTreeCmdType.VisitNode,
            NodeId: firstChild.Key,
          });
        } else {
          // 没有子节点 - 无法继续
          node.Status = BehaviorTreeNodeStatus.Failure;
          this.notifyParentNodeFinish(runtime, node, BehaviorResult.Failure);
        }
      }
    }
  }

  /**
   * 完成叶子节点（Until 不是叶子节点）
   */
  onFinishLeafNode(
    _runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    _node: BehaviorTreeNode<TNodeType, TConfig>,
    _result: BehaviorResult
  ): void {
    throw new Error('Until node should not be a leaf node');
  }

  /**
   * 获取第一个可执行的子节点
   */
  private getFirstExecutableChild(
    node: BehaviorTreeNode<TNodeType, TConfig>
  ): BehaviorTreeNode<TNodeType, TConfig> | null {
    for (const child of node.Children) {
      if (child.Status === BehaviorTreeNodeStatus.Init) {
        return child;
      }
    }
    return null;
  }

  /**
   * 获取下一个可执行的子节点
   */
  private getNextExecutableChild(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    currentIndex: number
  ): BehaviorTreeNode<TNodeType, TConfig> | null {
    for (let i = currentIndex + 1; i < node.Children.length; i++) {
      const child = node.Children[i];
      if (child.Status === BehaviorTreeNodeStatus.Init) {
        return child;
      }
    }
    return null;
  }

  /**
   * 标记剩余子节点为已省略
   */
  private markRemainingChildrenAsOmitted(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    currentIndex: number
  ): void {
    for (let i = currentIndex + 1; i < node.Children.length; i++) {
      node.Children[i].Status = BehaviorTreeNodeStatus.Omitted;
    }
  }

  /**
   * 重置节点及其所有后代的状态为 Init，使它们可以重新运行
   */
  private resetSubtree(node: BehaviorTreeNode<TNodeType, TConfig>): void {
    node.Status = BehaviorTreeNodeStatus.Init;
    node.Children.forEach((child) => this.resetSubtree(child));
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
