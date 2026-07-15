/**
 * NodeLogic Interface
 *
 * Defines the contract for node execution logic based on NodeKind
 */

import {
  BehaviorTreeNode,
  BehaviorTreeData,
  BehaviorResult,
  BehaviorTreeNodeStatus,
  BehaviorTreeCmdType,
  INodeConfig,
} from './types';

/**
 * Base interface for node execution logic
 *
 * Each NodeKind (Sequence, Selector, Condition, Action, Until) has its own NodeLogic implementation
 */
export interface NodeLogic<TNodeType = string, TConfig extends INodeConfig = INodeConfig> {
  /**
   * Called when visiting a node for the first time
   *
   * @param node - The node being visited
   * @param btData - Runtime behavior tree data
   */
  visitNode(node: BehaviorTreeNode<TNodeType, TConfig>, btData: BehaviorTreeData<TNodeType, TConfig>): void;

  /**
   * Called when a child node finishes execution
   *
   * @param node - The parent node
   * @param childIndex - Index of the finished child
   * @param childResult - Result of the child execution
   * @param btData - Runtime behavior tree data
   */
  onChildNodeFinish(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    childIndex: number,
    childResult: BehaviorResult,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void;

  /**
   * Called when a leaf node finishes execution
   *
   * @param node - The leaf node
   * @param result - Execution result
   * @param btData - Runtime behavior tree data
   */
  onFinishLeafNode(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    result: BehaviorResult,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void;
}

/**
 * Base class for NodeLogic implementations
 * Provides common utilities for node logic
 */
export abstract class NodeLogicBase<TNodeType = string, TConfig extends INodeConfig = INodeConfig>
  implements NodeLogic<TNodeType, TConfig> {

  abstract visitNode(node: BehaviorTreeNode<TNodeType, TConfig>, btData: BehaviorTreeData<TNodeType, TConfig>): void;

  abstract onChildNodeFinish(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    childIndex: number,
    childResult: BehaviorResult,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void;

  abstract onFinishLeafNode(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    result: BehaviorResult,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void;

  /**
   * Get the first executable child (Status = Init)
   */
  protected getFirstExecutableChild(
    node: BehaviorTreeNode<TNodeType, TConfig>
  ): BehaviorTreeNode<TNodeType, TConfig> | null {
    return node.Children.find((child) => child.Status === 'Init') || null;
  }

  /**
   * Get the next executable child after the given index
   */
  protected getNextExecutableChild(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    currentIndex: number
  ): BehaviorTreeNode<TNodeType, TConfig> | null {
    for (let i = currentIndex + 1; i < node.Children.length; i++) {
      if (node.Children[i].Status === 'Init') {
        return node.Children[i];
      }
    }
    return null;
  }

  /**
   * Mark remaining children as omitted
   */
  protected markRemainingChildrenAsOmitted(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    fromIndex: number
  ): void {
    for (let i = fromIndex + 1; i < node.Children.length; i++) {
      if (node.Children[i].Status === BehaviorTreeNodeStatus.Init) {
        node.Children[i].Status = BehaviorTreeNodeStatus.Omitted;
      }
    }
  }

  /**
   * Push a command to visit a child node
   */
  protected pushVisitNodeCmd(
    childNode: BehaviorTreeNode<TNodeType, TConfig>,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    btData.CmdStack.push({
      Type: BehaviorTreeCmdType.VisitNode,
      NodeId: childNode.Key,
    });
  }

  /**
   * Notify parent that this node finished
   */
  protected notifyParentNodeFinish(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    result: BehaviorResult,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    if (!node.Parent) {
      // Root node finished
      return;
    }

    const parentNode = btData.NodeMap.get(node.Parent);
    if (!parentNode) {
      throw new Error(`Parent node not found: ${node.Parent}`);
    }

    const childIndex = parentNode.Children.findIndex((child) => child.Key === node.Key);
    if (childIndex === -1) {
      throw new Error(`Child node not found in parent: ${node.Key}`);
    }

    btData.CmdStack.push({
      Type: BehaviorTreeCmdType.FinishChildNode,
      NodeId: parentNode.Key,
      ChildIndex: childIndex,
      Result: result,
    });
  }

  /**
   * Convert node status to behavior result
   */
  protected statusToResult(status: string): BehaviorResult {
    switch (status) {
      case BehaviorTreeNodeStatus.Success:
        return BehaviorResult.Success;
      case BehaviorTreeNodeStatus.Failure:
        return BehaviorResult.Failure;
      default:
        return BehaviorResult.Running;
    }
  }
}
