/**
 * Selector Node Logic Adapter
 *
 * 简化版：直接实现核心逻辑，不需要二次分发
 *
 * 设计说明：
 * - Selector 节点的逻辑是固定的，不需要像 Action 节点那样进行二次分发
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
} from '../types';

/**
 * Selector Node Logic Adapter
 *
 * Selector 节点逻辑：
 * - 按顺序尝试子节点
 * - 任何子节点成功则整个 Selector 成功
 * - 所有子节点失败则 Selector 失败
 */
export class SelectorNodeLogicAdapter<
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

    const firstChild = this.getFirstExecutableChild(node);
    if (firstChild) {
      runtime.pushCommand({
        Type: BehaviorTreeCmdType.VisitNode,
        NodeId: firstChild.Key,
      });
    } else {
      // 没有子节点或全部被省略 - 失败
      node.Status = BehaviorTreeNodeStatus.Failure;
      this.notifyParentNodeFinish(runtime, node, BehaviorResult.Failure);
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
    if (childResult === BehaviorResult.Success) {
      // 任何子节点成功 -> selector 成功
      node.Status = BehaviorTreeNodeStatus.Success;
      this.markRemainingChildrenAsOmitted(node, childIndex);
      this.notifyParentNodeFinish(runtime, node, BehaviorResult.Success);
    } else if (childResult === BehaviorResult.Failure) {
      // 子节点失败，尝试下一个
      const nextChild = this.getNextExecutableChild(node, childIndex);
      if (nextChild) {
        runtime.pushCommand({
          Type: BehaviorTreeCmdType.VisitNode,
          NodeId: nextChild.Key,
        });
      } else {
        // 所有子节点失败
        node.Status = BehaviorTreeNodeStatus.Failure;
        this.notifyParentNodeFinish(runtime, node, BehaviorResult.Failure);
      }
    }
    // Running 状态由外部处理
  }

  /**
   * 完成叶子节点（Selector 不是叶子节点）
   */
  onFinishLeafNode(
    _runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    _node: BehaviorTreeNode<TNodeType, TConfig>,
    _result: BehaviorResult
  ): void {
    throw new Error('Selector node should not be a leaf node');
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
